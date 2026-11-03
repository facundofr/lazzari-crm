/**
 * CBU que llegan por mail (Augusto 03/11/2026: "si tenés los datos 100 % correctos, actualizame los datos bancarios… No inventes
 * ningún dato"). El agente de correo lee el CBU de las facturas de proveedores (datos.factura) y de la cuenta desde la que paga un
 * cliente (datos.pago.cuenta_origen); acá se decide cuáles son seguros:
 * - el CBU tiene 22 dígitos y pasa los dos dígitos verificadores (`cbuValido`);
 * - el mail dice de quién es la cuenta (CUIT del emisor o de quien paga) y ese CUIT es el de una ficha de esta sociedad;
 * - el titular de la cuenta tiene el MISMO CUIT que la ficha (si el mail no dice el CUIT del titular, no es seguro);
 * - el mail viene de una dirección de esa ficha (su mail o el de un contacto) o de su mismo dominio (gmail y similares: la dirección exacta).
 * Un CBU distinto al que ya tiene la ficha se avisa aparte (⚠ puede ser una estafa de "cambiamos de cuenta"). Nada se guarda solo.
 * Prueba: npx tsx scripts/test-cbu.ts
 */

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** CBU o CVU de 22 dígitos con los dos dígitos verificadores bien (bloque de 8 y bloque de 14). */
export function cbuValido(cbu: unknown): boolean {
  const d = digitos(cbu);
  if (d.length !== 22 || /^0+$/.test(d)) return false;
  const dv = (bloque: string, pesos: number[]) => (10 - (pesos.reduce((s, p, i) => s + p * Number(bloque[i]), 0) % 10)) % 10;
  return dv(d.slice(0, 7), [7, 1, 3, 9, 7, 1, 3]) === Number(d[7]) && dv(d.slice(8, 21), [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]) === Number(d[21]);
}

export type TipoFicha = "cliente" | "proveedor";
export interface FichaBancaria { id: string; tipo: TipoFicha; nombre: string; cuit: string | null; cbu: string | null; correos: string[] }
export interface DatoBancarioMail {
  mailId: string; fecha: string; remitente: string; asunto: string; tipo: TipoFicha;
  /** De quién es la cuenta según el mail: el emisor de la factura (proveedor) o quien paga (cliente). */
  cuit: string | null;
  cbu: string | null; alias: string | null; banco: string | null; titular: string | null; cuitTitular: string | null;
}
export interface PropuestaCbu {
  ficha: FichaBancaria; dato: DatoBancarioMail; cbu: string;
  /** nuevo = la ficha no tiene CBU; distinto = tiene otro (⚠ confirmar con el cliente o proveedor por teléfono). */
  estado: "nuevo" | "distinto";
}
export interface DescarteCbu { dato: DatoBancarioMail; motivo: string }

/** Los datos bancarios que leyó el agente en cada mail (filas de agente_mail_procesados). */
export function datosBancariosDeMails(filas: { id: string; fecha_mail?: string | null; remitente?: string | null; asunto?: string | null; datos?: any }[]): DatoBancarioMail[] {
  const out: DatoBancarioMail[] = [];
  for (const f of filas) {
    const base = { mailId: f.id, fecha: String(f.fecha_mail || "").slice(0, 10), remitente: String(f.remitente || ""), asunto: String(f.asunto || "") };
    const fac = f.datos?.factura;
    if (fac && (fac.cbu || fac.alias)) {
      out.push({ ...base, tipo: "proveedor", cuit: digitos(fac.cuit) || null, cbu: digitos(fac.cbu) || null, alias: fac.alias ? String(fac.alias).trim() : null,
        banco: fac.banco ? String(fac.banco).trim() : null, titular: fac.titular_cuenta ? String(fac.titular_cuenta).trim() : null, cuitTitular: digitos(fac.cuit_titular) || null });
    }
    const pago = f.datos?.pago;
    const co = pago?.cuenta_origen;
    if (pago && pago.direccion === "recibido" && co?.cbu) {
      out.push({ ...base, tipo: "cliente", cuit: digitos(pago.cliente_cuit) || null, cbu: digitos(co.cbu) || null, alias: null, banco: null,
        titular: co.titular ? String(co.titular).trim() : null, cuitTitular: digitos(co.cuit_titular) || null });
    }
  }
  return out;
}

const GENERICOS = new Set(["gmail.com", "hotmail.com", "hotmail.com.ar", "yahoo.com", "yahoo.com.ar", "outlook.com", "outlook.com.ar", "live.com", "icloud.com", "fibertel.com.ar", "arnet.com.ar", "speedy.com.ar"]);
const direccion = (s: string) => (s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] || "").toLowerCase();
const dominio = (mail: string) => mail.split("@")[1] || "";

/** El mail viene de esa ficha: su dirección exacta, o su mismo dominio si no es un dominio genérico (gmail, hotmail…). */
export function remitenteDeFicha(remitente: string, correos: string[]): boolean {
  const r = direccion(remitente);
  if (!r) return false;
  const propios = correos.map(direccion).filter(Boolean);
  if (propios.includes(r)) return true;
  const dom = dominio(r);
  return !!dom && !GENERICOS.has(dom) && propios.some((c) => dominio(c) === dom);
}

/** Qué CBU del mail se pueden guardar con seguridad y por qué se descartan los otros. Uno por ficha y CBU (el mail más nuevo). */
export function proponerCbu(datos: DatoBancarioMail[], fichas: FichaBancaria[]): { propuestas: PropuestaCbu[]; descartes: DescarteCbu[] } {
  const propuestas: PropuestaCbu[] = [];
  const descartes: DescarteCbu[] = [];
  const vistos = new Set<string>();
  for (const dato of [...datos].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    const no = (motivo: string) => descartes.push({ dato, motivo });
    if (!dato.cbu) { no("El mail trae alias pero no el CBU completo"); continue; }
    if (!cbuValido(dato.cbu)) { no("El CBU no pasa los dígitos verificadores"); continue; }
    const candidatas = fichas.filter((f) => f.tipo === dato.tipo && dato.cuit && digitos(f.cuit) === dato.cuit);
    if (!dato.cuit || !candidatas.length) { no(`El CUIT del mail no es de ningún ${dato.tipo} de esta sociedad`); continue; }
    if (candidatas.length > 1) { no(`Hay ${candidatas.length} fichas con ese CUIT`); continue; }
    const ficha = candidatas[0];
    if (!dato.cuitTitular) { no("El mail no dice el CUIT del titular de la cuenta"); continue; }
    if (dato.cuitTitular !== digitos(ficha.cuit)) { no("El titular de la cuenta tiene otro CUIT"); continue; }
    if (!remitenteDeFicha(dato.remitente, ficha.correos)) { no("El mail no viene de una dirección de la ficha"); continue; }
    if (digitos(ficha.cbu) === dato.cbu) continue; // ya lo tiene
    const clave = `${ficha.id}|${dato.cbu}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    propuestas.push({ ficha, dato, cbu: dato.cbu, estado: digitos(ficha.cbu).length ? "distinto" : "nuevo" });
  }
  return { propuestas, descartes };
}
