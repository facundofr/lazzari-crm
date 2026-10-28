// Presupuestos nuevo: lógica pura (sin pantalla ni base) para que la IA arme el PR.
// Todo es sugerencia: ninguna función bloquea; devuelven avisos para mostrar.
// Prueba: scripts/test-presupuesto-ia.ts
import { margenNetoPct, GASTOS_PR_ARCA } from "./presupuesto-margen";

export const MARGEN_MINIMO_IA = 15;

export type Confianza = "alta" | "media" | "baja" | "ninguna" | "manual";
export type Semaforo = "verde" | "amarillo" | "rojo";

export const redondear2 = (n: number) => Math.round(n * 100) / 100;

/** Margen sobre el costo, en % ((precio / costo − 1) × 100). null si no hay costo. */
export function margenSobreCosto(precio: number, costo: number): number | null {
  if (!(costo > 0) || !(precio >= 0)) return null;
  return redondear2((precio / costo - 1) * 100);
}

export type UltimoPrecio = { precio: number; fecha: string; numero?: string };

export interface EntradaPrecio {
  /** Costo del artículo en la moneda del presupuesto. */
  costo: number | null;
  /** Precio de venta de la lista de costos, en la moneda del presupuesto. */
  ventaLista: number | null;
  /** Último precio vendido a ESTE cliente (misma moneda del presupuesto), si hay. */
  ultimo?: UltimoPrecio | null;
  margenMinimo?: number;
  /** Gastos e impuestos sobre la venta (lib/presupuesto-margen). Sin dato: 7 % (PR por ARCA). */
  gastosPct?: number;
}

export interface PrecioPropuesto {
  precio: number;
  origen: "ultimo" | "lista" | "sin_precio";
  margenPct: number | null;
  /** Aviso corto para el vendedor (vacío si no hay nada que decir). */
  nota: string;
  bajoMinimo: boolean;
}

/**
 * Precio que propone la IA:
 *  1) el último precio vendido a este cliente, si todavía deja el margen mínimo con el costo de hoy (coherencia con el cliente);
 *  2) si no, el precio de la lista (su margen ya viene definido en la lista).
 * Nunca fuerza un mínimo: si queda bajo el margen mínimo, avisa y deja el precio.
 */
export function proponerPrecio(e: EntradaPrecio): PrecioPropuesto {
  const min = e.margenMinimo ?? MARGEN_MINIMO_IA;
  // Margen NETO de gastos e impuestos: la misma regla que la lista y la ventana del PR (auditoría H43).
  const gastos = e.gastosPct ?? GASTOS_PR_ARCA;
  const margenNeto = (precio: number, costo: number) => margenNetoPct(precio, costo, gastos);
  const costo = e.costo && e.costo > 0 ? e.costo : null;
  const lista = e.ventaLista && e.ventaLista > 0 ? redondear2(e.ventaLista) : null;
  const ult = e.ultimo && e.ultimo.precio > 0 ? e.ultimo : null;

  const margenUlt = ult ? margenNeto(ult.precio, costo ?? 0) : null;
  // Si no hay costo no se puede juzgar el margen del último precio: se usa igual (es lo que ya pagó el cliente).
  const usarUltimo = !!ult && (costo === null || (margenUlt !== null && margenUlt >= min));

  let precio = 0;
  let origen: PrecioPropuesto["origen"] = "sin_precio";
  let nota = "";
  if (usarUltimo && ult) {
    precio = redondear2(ult.precio); origen = "ultimo";
    nota = `Mismo precio que la última vez (${ult.numero ? ult.numero + ", " : ""}${ult.fecha.slice(0, 10)})`;
    if (lista !== null && lista > precio * 1.03) nota += `; la lista hoy está en ${lista.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  } else if (lista !== null) {
    precio = lista; origen = "lista";
    if (ult && margenUlt !== null) nota = `La última vez se vendió a ${ult.precio.toLocaleString("es-AR", { maximumFractionDigits: 2 })} (margen hoy ${margenUlt}%): se usa la lista`;
  } else {
    nota = "Sin precio de lista: cargalo a mano";
  }

  const margenPct = costo !== null && precio > 0 ? margenNeto(precio, costo) : null;
  const bajoMinimo = margenPct !== null && margenPct < min;
  if (bajoMinimo) nota = `${nota ? nota + ". " : ""}Margen ${margenPct}% (mínimo ${min}%)`;
  return { precio, origen, margenPct, nota, bajoMinimo };
}

export interface EntradaSemaforo {
  confianza: Confianza;
  tieneArticulo: boolean;
  precio: number;
  cantidad: number;
  bajoMinimo: boolean;
  sinCosto?: boolean;
  avisoExtra?: boolean;
}

/** verde = se puede aceptar de una; amarillo = mirar; rojo = falta algo. */
export function semaforoLinea(l: EntradaSemaforo): Semaforo {
  if (!l.tieneArticulo || !(l.precio > 0) || !(l.cantidad > 0) || l.confianza === "ninguna") return "rojo";
  if (l.confianza === "alta" || l.confianza === "manual") {
    if (l.bajoMinimo || l.sinCosto || l.avisoExtra || !Number.isInteger(l.cantidad)) return "amarillo";
    return "verde";
  }
  return "amarillo";
}

// ── Cliente: de lo que leyó la IA (CUIT, empresa, mail) al cliente del CRM ──

export interface ClienteBasico { id: string; razon_social: string; cuit?: string | null; email?: string | null; email_facturacion?: string | null }
export interface ClienteExtraido { empresa?: string; cuit?: string; email?: string; contacto?: string }
export interface ClienteCandidato { cliente: ClienteBasico; puntaje: number; motivo: string }

const sinAcentos = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soloDigitos = (t: string) => String(t || "").replace(/\D/g, "");
const STOP_EMPRESA = new Set(["sa", "srl", "s", "a", "r", "l", "sociedad", "anonima", "de", "la", "el", "los", "y", "sas", "ltda", "cia", "co", "argentina", "arg"]);
const palabrasEmpresa = (t: string) => sinAcentos(t).replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length >= 2 && !STOP_EMPRESA.has(w));
const dominio = (mail: string) => { const m = String(mail || "").toLowerCase().match(/@([a-z0-9.-]+)/); return m ? m[1] : ""; };
const DOMINIOS_COMUNES = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.ar", "hotmail.com.ar", "live.com", "icloud.com", "lazzari.com.ar"]);

/** Ordena los clientes del CRM de más a menos parecido a lo que leyó la IA. Solo devuelve los que tienen alguna coincidencia. */
export function buscarClientes(clientes: ClienteBasico[], ex: ClienteExtraido): ClienteCandidato[] {
  const cuit = soloDigitos(ex.cuit || "");
  const pEx = palabrasEmpresa(ex.empresa || "");
  const dom = dominio(ex.email || "");
  const out: ClienteCandidato[] = [];
  for (const c of clientes) {
    let puntaje = 0; const motivos: string[] = [];
    if (cuit.length === 11 && soloDigitos(c.cuit || "") === cuit) { puntaje += 100; motivos.push("mismo CUIT"); }
    if (pEx.length) {
      const pc = palabrasEmpresa(c.razon_social);
      const comunes = pEx.filter(w => pc.some(x => x === w || (w.length >= 5 && (x.startsWith(w) || w.startsWith(x)))));
      if (comunes.length) {
        const frac = comunes.length / Math.max(pEx.length, pc.length || 1);
        const p = Math.round(60 * frac) + (comunes.length === pEx.length && comunes.length === pc.length ? 20 : 0);
        if (p >= 20) { puntaje += p; motivos.push("nombre parecido"); }
      }
    }
    if (dom && !DOMINIOS_COMUNES.has(dom)) {
      const doms = [c.email, c.email_facturacion].map(m => dominio(m || ""));
      if (doms.includes(dom)) { puntaje += 40; motivos.push("mismo dominio de mail"); }
    }
    if (puntaje > 0) out.push({ cliente: c, puntaje, motivo: motivos.join(" + ") });
  }
  return out.sort((a, b) => b.puntaje - a.puntaje || a.cliente.razon_social.localeCompare(b.cliente.razon_social, "es"));
}

/** ¿Alcanza para preseleccionar solo el primero? (CUIT igual, o claramente mejor que el segundo). */
export function clienteSeguro(c: ClienteCandidato[]): boolean {
  if (!c.length) return false;
  if (c[0].puntaje >= 100) return true;
  return c[0].puntaje >= 70 && (c.length === 1 || c[0].puntaje - c[1].puntaje >= 30);
}

// ── Último precio vendido a un cliente ──

export interface RenglonHistorico { codigo: string | null; descripcion: string; precio_venta: number; moneda: string; fecha: string; numero: string }

const claveDesc = (d: string) => sinAcentos(d).replace(/[^a-z0-9]+/g, " ").trim();

/** Último precio (más nuevo) del mismo artículo vendido a ese cliente en la misma moneda. Coincide por código o por descripción exacta. */
export function ultimoPrecioCliente(historial: RenglonHistorico[], codigos: string[], descripcion: string, moneda: "ARS" | "USD"): UltimoPrecio | null {
  const cods = new Set(codigos.map(c => String(c || "").trim().toLowerCase()).filter(Boolean));
  const dk = claveDesc(descripcion);
  let mejor: RenglonHistorico | null = null;
  for (const h of historial) {
    if (!(h.precio_venta > 0)) continue;
    if ((String(h.moneda || "").toUpperCase().startsWith("USD") ? "USD" : "ARS") !== moneda) continue;
    const porCodigo = !!h.codigo && cods.has(String(h.codigo).trim().toLowerCase());
    const porDesc = !!dk && claveDesc(h.descripcion) === dk;
    if (!porCodigo && !porDesc) continue;
    if (!mejor || String(h.fecha) > String(mejor.fecha)) mejor = h;
  }
  return mejor ? { precio: mejor.precio_venta, fecha: String(mejor.fecha), numero: mejor.numero } : null;
}

// ── Avisos del presupuesto completo (nunca frenan) ──

export interface EntradaAvisos {
  moneda: "ARS" | "USD";
  cotizacionModalidad?: string | null;
  clienteMonedaPredeterminada?: string | null;
  lineas: Array<{ incluir: boolean; precio: number; costo: number | null; cantidad: number; margenPct: number | null; descripcion: string; sinTc?: boolean }>;
  margenMinimo?: number;
  /** Gastos e impuestos sobre la venta para el margen total (neto, H43). Sin dato: 7 %. */
  gastosPct?: number;
}

export function avisosPresupuesto(e: EntradaAvisos): string[] {
  const min = e.margenMinimo ?? MARGEN_MINIMO_IA;
  const out: string[] = [];
  const act = e.lineas.filter(l => l.incluir);
  const sinPrecio = act.filter(l => !(l.precio > 0));
  if (sinPrecio.length) out.push(`${sinPrecio.length} renglón(es) sin precio: ${sinPrecio.slice(0, 3).map(l => l.descripcion.slice(0, 28)).join(", ")}${sinPrecio.length > 3 ? "…" : ""}`);
  const bajos = act.filter(l => l.margenPct !== null && l.margenPct < min);
  if (bajos.length) out.push(`${bajos.length} renglón(es) con margen menor a ${min}%`);
  const dec = act.filter(l => !Number.isInteger(l.cantidad) && l.cantidad > 0);
  if (dec.length) out.push(`${dec.length} cantidad(es) con decimales`);
  let venta = 0, costo = 0;
  for (const l of act) if (l.costo && l.costo > 0 && l.precio > 0) { venta += l.precio * l.cantidad; costo += l.costo * l.cantidad; }
  if (costo > 0) { const m = margenNetoPct(venta, costo, e.gastosPct ?? GASTOS_PR_ARCA); if (m !== null && m < min) out.push(`Margen neto total ${m}% (mínimo ${min}%)`); }
  if (e.moneda === "USD" && e.clienteMonedaPredeterminada) {
    const pref = e.clienteMonedaPredeterminada === "USD" ? "billetes" : e.clienteMonedaPredeterminada === "USD Divisa" ? "divisas" : null;
    if (pref && e.cotizacionModalidad && e.cotizacionModalidad !== pref) out.push(`Este cliente cotiza en USD ${pref === "divisas" ? "divisa" : "billete"} y el presupuesto está en el otro`);
  }
  return out;
}
