/**
 * Lista de costos — reglas comerciales por proveedor (etapa 1, solo para mostrar: nada frena).
 * Semáforo de vigencia de cada lista, texto de los descuentos opcionales, avisos y redondeo de venta.
 * Prueba: scripts/test-lista-costos.ts
 */

export interface ReglaProveedor {
  proveedor_lista: string;
  moneda: string | null;
  vigencia_texto: string | null;
  vigencia_hasta: string | null;
  desc1: number | null;
  desc2: number | null;
  en_cascada: boolean;
  como_se_calcula: string | null;
  condiciones: string | null;
}

export type TipoOpcional = "pago_anticipado" | "cantidad" | "volumen_mensual" | "excepcional";
export interface DescuentoOpcional {
  proveedor_lista: string;
  tipo: TipoOpcional;
  porcentaje: number;
  monto_minimo: number | null;
  condicion: string | null;
  requiere_autorizacion: boolean;
  activo: boolean;
}

export interface MargenVenta { orden: number; rubro: string; margen: number; aplica_a: string | null }

export interface RedondeoConfig {
  texto?: string | null;
  ARS?: { multiplo: number; multiplo_menor: number; umbral_menor: number; hacia: "arriba" | "abajo" };
  USD?: { decimales: number; hacia: "arriba" | "abajo" };
}

// ── Semáforo de vigencia (Augusto 14/10: 🟢 hasta 30 días, 🟡 de 30 a 60, 🔴 más de 60 o sin fecha) ──
export const DIAS_VERDE = 30;
export const DIAS_AMARILLO = 60;
/** Con fecha de vencimiento: amarillo la última semana. */
export const DIAS_AVISO_VENCE = 7;

export type ColorSemaforo = "verde" | "amarillo" | "rojo";
export interface Semaforo { color: ColorSemaforo; texto: string; dias: number | null; pedirActualizacion: boolean }

const MESES: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
  jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dia = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const DIA_MS = 86400000;

/** Fecha de hoy (sin hora) en UTC, para contar días enteros. */
export function hoyUTC(ahora = new Date()): number {
  return dia(ahora.getFullYear(), ahora.getMonth() + 1, ahora.getDate());
}

/**
 * Primera fecha que aparece en el texto de vigencia: "06/10/2026", "20/05" (año inferido), "1 de septiembre",
 * "Octubre 2026" o "sept. 2026" (cuenta desde el 1° del mes). Si no tiene año y quedaría en el futuro, es del año anterior.
 */
export function fechaDeTexto(texto: string | null | undefined, hoy: number): number | null {
  const t = sinTildes(String(texto || ""));
  if (!t.trim()) return null;
  const anioHoy = new Date(hoy).getUTCFullYear();
  const sinAnio = (m: number, d: number) => { const f = dia(anioHoy, m, d); return f > hoy ? dia(anioHoy - 1, m, d) : f; };
  const candidatos: Array<{ pos: number; fecha: number }> = [];
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const d = +m[1], mes = +m[2];
    if (mes < 1 || mes > 12 || d < 1 || d > 31) continue;
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    candidatos.push({ pos: m.index!, fecha: y ? dia(y, mes, d) : sinAnio(mes, d) });
  }
  for (const m of t.matchAll(/\b(\d{1,2}) de ([a-z]+)\.?(?: (?:de )?(\d{4}))?/g)) {
    const mes = MESES[m[2]];
    if (!mes) continue;
    candidatos.push({ pos: m.index!, fecha: m[3] ? dia(+m[3], mes, +m[1]) : sinAnio(mes, +m[1]) });
  }
  for (const m of t.matchAll(/\b([a-z]+)\.? (?:de )?(\d{4})\b/g)) {
    const mes = MESES[m[1]];
    if (!mes) continue;
    // "1 de septiembre de 2026" ya se tomó arriba con el día: no repetir.
    if (candidatos.some((c) => c.pos < m.index! && m.index! - c.pos <= 6)) continue;
    candidatos.push({ pos: m.index!, fecha: dia(+m[2], mes, 1) });
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => a.pos - b.pos);
  return candidatos[0].fecha;
}

/** Semáforo de una regla. Solo informa: en rojo sugiere "Pedir actualización", nunca bloquea. */
export function semaforoVigencia(regla: Pick<ReglaProveedor, "vigencia_texto" | "vigencia_hasta"> | null | undefined, hoy = hoyUTC()): Semaforo {
  if (!regla) return { color: "rojo", texto: "Sin regla cargada", dias: null, pedirActualizacion: true };
  if (regla.vigencia_hasta) {
    const [y, m, d] = String(regla.vigencia_hasta).slice(0, 10).split("-").map(Number);
    const faltan = Math.round((dia(y, m, d) - hoy) / DIA_MS);
    if (faltan < 0) return { color: "rojo", texto: `Vencida hace ${-faltan} días`, dias: faltan, pedirActualizacion: true };
    if (faltan <= DIAS_AVISO_VENCE) return { color: "amarillo", texto: faltan === 0 ? "Vence hoy" : `Vence en ${faltan} días`, dias: faltan, pedirActualizacion: false };
    return { color: "verde", texto: `Vigente hasta ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`, dias: faltan, pedirActualizacion: false };
  }
  const fecha = fechaDeTexto(regla.vigencia_texto, hoy);
  if (fecha === null) return { color: "rojo", texto: "Sin fecha", dias: null, pedirActualizacion: true };
  const dias = Math.max(0, Math.round((hoy - fecha) / DIA_MS));
  const texto = dias === 0 ? "Lista de hoy" : `Lista de hace ${dias} días`;
  if (dias <= DIAS_VERDE) return { color: "verde", texto, dias, pedirActualizacion: false };
  if (dias <= DIAS_AMARILLO) return { color: "amarillo", texto, dias, pedirActualizacion: false };
  return { color: "rojo", texto, dias, pedirActualizacion: true };
}

export const EMOJI_SEMAFORO: Record<ColorSemaforo, string> = { verde: "🟢", amarillo: "🟡", rojo: "🔴" };

// ── Opcionales (no incluidos en el costo) ──
const NOMBRE_OPCIONAL: Record<TipoOpcional, string> = {
  pago_anticipado: "pago anticipado",
  cantidad: "por cantidad",
  volumen_mensual: "por volumen del mes",
  excepcional: "excepcional",
};
const fmtPct = (n: number) => `${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;

/** Chip corto: "+5 % pago anticipado". */
export function chipOpcional(o: Pick<DescuentoOpcional, "tipo" | "porcentaje">): string {
  return `+${fmtPct(o.porcentaje)} ${NOMBRE_OPCIONAL[o.tipo] || o.tipo}`;
}

/** Texto completo: "5 % pago anticipado — Solo en pedidos de más de $1.750.000 + IVA (con autorización)". */
export function textoOpcional(o: DescuentoOpcional): string {
  const extra = [o.condicion, o.requiere_autorizacion ? "con autorización" : null].filter(Boolean).join(" · ");
  return `${fmtPct(o.porcentaje)} ${NOMBRE_OPCIONAL[o.tipo] || o.tipo}${extra ? ` — ${extra}` : ""}`;
}

/** Descuentos sobre lista que ya están dentro del costo: "Lista − 6 % − 20 % (en cascada)". */
export function textoDescuentosLista(r: Pick<ReglaProveedor, "desc1" | "desc2" | "en_cascada">): string {
  const ds = [r.desc1, r.desc2].filter((d): d is number => d != null && Number(d) > 0).map(Number);
  if (!ds.length) return "";
  return `Lista ${ds.map((d) => `− ${fmtPct(d)}`).join(" ")}${ds.length > 1 && r.en_cascada ? " (en cascada)" : ""}`;
}

/** La regla pide revisar algo a mano ("Verificar", "consultar", "a definir"). */
export function pideVerificar(r: Pick<ReglaProveedor, "como_se_calcula" | "condiciones"> | null | undefined): boolean {
  if (!r) return false;
  return /verificar|consultar|a definir/.test(sinTildes(`${r.como_se_calcula || ""} ${r.condiciones || ""}`));
}

// ── Redondeo del precio de venta (igual que la web) ──
export function redondearVenta(precio: number, moneda: string, cfg: RedondeoConfig | null | undefined): number {
  if (!(precio > 0)) return precio;
  const arriba = (x: number, paso: number) => Math.ceil(Math.round(x / paso * 1e6) / 1e6) * paso;
  const abajo = (x: number, paso: number) => Math.floor(Math.round(x / paso * 1e6) / 1e6) * paso;
  if (String(moneda).toUpperCase().startsWith("USD")) {
    const dec = cfg?.USD?.decimales ?? 2;
    const paso = 1 / 10 ** dec;
    const r = cfg?.USD?.hacia === "abajo" ? abajo(precio, paso) : arriba(precio, paso);
    return Math.round(r * 10 ** dec) / 10 ** dec;
  }
  const a = cfg?.ARS;
  if (!a) return precio;
  const paso = precio < a.umbral_menor ? a.multiplo_menor : a.multiplo;
  return a.hacia === "abajo" ? abajo(precio, paso) : arriba(precio, paso);
}

/** Margen sobre el costo en % (venta 140 / costo 100 → 40). */
export function margenSobreCosto(costo: number, venta: number): number | null {
  if (!(costo > 0) || !(venta > 0)) return null;
  return Math.round((venta / costo - 1) * 1000) / 10;
}
