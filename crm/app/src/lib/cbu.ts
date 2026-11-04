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

/**
 * Banco del CBU por sus 3 primeros números (código de entidad del BCRA); en un CVU (empieza con 000), la billetera.
 * Augusto 04/11/2026: el banco que leía la IA del comprobante era el de ORIGEN (BBVA) y quedó mal en 3 fichas; el CBU no se equivoca.
 * Solo los códigos conocidos: si no está, null (se deja lo que diga el comprobante o la persona).
 */
const BANCOS_POR_CODIGO: Record<string, string> = {
  "007": "Banco Galicia", "011": "Banco Nación", "014": "Banco Provincia", "015": "ICBC", "017": "BBVA", "020": "Banco de Córdoba",
  "027": "Banco Supervielle", "029": "Banco Ciudad", "034": "Banco Patagonia", "044": "Banco Hipotecario", "072": "Banco Santander",
  "143": "Brubank", "150": "HSBC", "191": "Banco Credicoop", "285": "Banco Macro", "299": "Banco Comafi", "322": "Banco Industrial",
  "330": "Banco de Santa Fe", "384": "Wilobank", "386": "Banco de Entre Ríos", "389": "Banco Columbia", "453": "Naranja X",
};
const BILLETERAS_CVU: [string, string][] = [["00000031", "Mercado Pago"], ["00000079", "Ualá"], ["00001683", "Lemon"]];
export function bancoDelCbu(cbu: unknown): string | null {
  const d = digitos(cbu);
  if (d.length !== 22) return null;
  if (d.startsWith("000")) return BILLETERAS_CVU.find(([p]) => d.startsWith(p))?.[1] ?? null;
  return BANCOS_POR_CODIGO[d.slice(0, 3)] ?? null;
}
const normalBanco = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bbanco\b|\bde la\b|\bdel\b|\bde\b|[^a-z0-9]/g, "");

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

// ── Datos bancarios cargados a mano en la OP (Augusto 03/11/2026: "Si cargo algún dato bancario a la hora de hacer alguna OP,
// dejame guardarlo para que ya quede en ese proveedor"). Se guarda solo con el botón; los avisos informan y nunca frenan.
export interface DatosBancariosProveedor { cbu: string | null; alias_bancario: string | null; banco: string | null; titular_cuenta: string | null; cuit_titular_cuenta: string | null }
export const CAMPOS_BANCARIOS: (keyof DatosBancariosProveedor)[] = ["cbu", "alias_bancario", "banco", "titular_cuenta", "cuit_titular_cuenta"];

/** Qué cambia en la ficha del proveedor y qué avisar antes de guardar (CBU mal, ficha con otro CBU, titular con otro CUIT). */
export function cambiosBancarios(ficha: Partial<DatosBancariosProveedor> & { cuit?: string | null }, nuevo: Partial<DatosBancariosProveedor>): { cambios: Partial<DatosBancariosProveedor>; avisos: string[] } {
  const limpio = (k: keyof DatosBancariosProveedor, v: unknown) => {
    const t = String(v ?? "").trim();
    if (!t) return null;
    return k === "cbu" || k === "cuit_titular_cuenta" ? digitos(t) || null : t;
  };
  const cambios: Partial<DatosBancariosProveedor> = {};
  for (const k of CAMPOS_BANCARIOS) {
    if (!(k in nuevo)) continue;
    const v = limpio(k, nuevo[k]);
    if (v !== limpio(k, ficha[k])) cambios[k] = v;
  }
  const avisos: string[] = [];
  if (cambios.cbu) {
    if (!cbuValido(cambios.cbu)) avisos.push(`El CBU ${cambios.cbu} no da bien los dígitos verificadores (${cambios.cbu.length} dígitos): revisalo.`);
    const viejo = limpio("cbu", ficha.cbu);
    if (viejo) avisos.push(`⚠ El proveedor ya tenía otro CBU (${viejo}). Un "cambiamos de cuenta" puede ser una estafa: confirmalo por teléfono.`);
  }
  const cuitTit = "cuit_titular_cuenta" in cambios ? cambios.cuit_titular_cuenta : limpio("cuit_titular_cuenta", ficha.cuit_titular_cuenta);
  if ((cambios.cbu || cambios.cuit_titular_cuenta) && cuitTit && digitos(ficha.cuit) && cuitTit !== digitos(ficha.cuit)) {
    avisos.push(`El titular de la cuenta (CUIT ${cuitTit}) no es el CUIT del proveedor (${digitos(ficha.cuit)}).`);
  }
  // 04/11/2026: el banco tiene que ser el del CBU (avisa, no frena).
  const cbuFinal = "cbu" in cambios ? cambios.cbu : limpio("cbu", ficha.cbu);
  const bancoFinal = "banco" in cambios ? cambios.banco : limpio("banco", ficha.banco);
  const delCbu = bancoDelCbu(cbuFinal);
  const parecido = (x: string, y: string) => !!x && !!y && (x.includes(y) || y.includes(x));
  if ((cambios.cbu || "banco" in cambios) && delCbu && bancoFinal && !parecido(normalBanco(bancoFinal), normalBanco(delCbu))) {
    avisos.push(`El CBU es de ${delCbu} y el banco dice ${bancoFinal}: revisalo.`);
  }
  return { cambios, avisos };
}

/** El CBU de destino que leyó la IA en el comprobante de la transferencia, si es válido y no es el de la ficha. */
export function cbuNuevoDelComprobante(pagos: { cbu_destino?: unknown; alias_destino?: unknown; destinatario?: unknown; cuit_destinatario?: unknown; banco_destino?: unknown }[], fichaCbu: string | null | undefined): { cbu: string; alias: string | null; titular: string | null; cuitTitular: string | null; banco: string | null } | null {
  for (const p of pagos) {
    const cbu = digitos(p.cbu_destino);
    if (!cbuValido(cbu) || cbu === digitos(fichaCbu)) continue;
    const txt = (v: unknown) => String(v ?? "").trim() || null;
    const cuit = digitos(p.cuit_destinatario);
    // 04/11/2026 (Mateo): el banco es el de la cuenta de destino. "banco" del comprobante es el de origen (el nuestro, BBVA):
    // antes se proponía ese y quedaba mal en la ficha. Si no se lee el de destino, va vacío.
    return { cbu, alias: txt(p.alias_destino), titular: txt(p.destinatario), cuitTitular: cuit.length === 11 ? cuit : null, banco: bancoDelCbu(cbu) ?? txt(p.banco_destino) };
  }
  return null;
}
