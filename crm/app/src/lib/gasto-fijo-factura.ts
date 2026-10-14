// Gasto fijo atado a un proveedor (ej. honorarios del contador): ¿ya llegó la factura de este mes?
// Solo avisa, nunca frena (regla 1).
import { normalizarTexto } from "./buscar-texto";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface FacturaParaGasto {
  id: string;
  proveedor_id: string;
  fecha: string; // YYYY-MM-DD
  total: number;
  estado?: string;
  tipo_comprobante?: string | null;
}

export interface EstadoFacturaMes {
  mes: string; // YYYY-MM
  mesNombre: string; // "octubre"
  factura: FacturaParaGasto | null;
  /** true si falta la factura del mes (el aviso). */
  falta: boolean;
}

function esNotaCredito(tipo?: string | null): boolean {
  return /^NC|NOTA.*CR/i.test(tipo ?? "");
}

/**
 * Busca la factura del proveedor con fecha en el mes de `hoy` (YYYY-MM-DD).
 * No cuenta notas de crédito ni anuladas. Si hay varias, la más reciente.
 */
export function facturaDelMes(proveedorId: string | null | undefined, facturas: FacturaParaGasto[], hoy: string): EstadoFacturaMes {
  const mes = hoy.slice(0, 7);
  const mesNombre = MESES[Number(mes.slice(5, 7)) - 1] ?? mes;
  if (!proveedorId) return { mes, mesNombre, factura: null, falta: false };
  const delMes = facturas
    .filter((f) => f.proveedor_id === proveedorId && f.fecha?.slice(0, 7) === mes && f.estado !== "anulada" && !esNotaCredito(f.tipo_comprobante))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const factura = delMes[0] ?? null;
  return { mes, mesNombre, factura, falta: !factura };
}

// ── Pago del mes (impuestos, débitos: pestaña Gastos) ─────────────────

export interface PagoParaGasto {
  id: string;
  gasto_fijo_id?: string | null;
  fecha: string; // YYYY-MM-DD
  monto: number;
}

export interface EstadoPagoMes {
  mes: string;
  mesNombre: string;
  pagado: number;
  pagos: PagoParaGasto[];
  falta: boolean;
  /** Días que faltan para el vencimiento (negativo = vencido). null si no tiene día. */
  diasAlVencimiento: number | null;
}

/** ¿Se cargó en Gastos el pago de este gasto fijo en el mes de `hoy`? */
export function pagoDelMes(gastoFijoId: string, pagos: PagoParaGasto[], hoy: string, diaVencimiento?: number | null): EstadoPagoMes {
  const mes = hoy.slice(0, 7);
  const mesNombre = MESES[Number(mes.slice(5, 7)) - 1] ?? mes;
  const delMes = pagos.filter((p) => p.gasto_fijo_id === gastoFijoId && p.fecha?.slice(0, 7) === mes);
  const pagado = Math.round(delMes.reduce((s, p) => s + (Number(p.monto) || 0), 0) * 100) / 100;
  let diasAlVencimiento: number | null = null;
  if (diaVencimiento && diaVencimiento >= 1) {
    const [y, m] = mes.split("-").map(Number);
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const vence = Date.UTC(y, m - 1, Math.min(diaVencimiento, ultimo));
    const hoyMs = Date.UTC(y, m - 1, Number(hoy.slice(8, 10)));
    diasAlVencimiento = Math.round((vence - hoyMs) / 86_400_000);
  }
  return { mes, mesNombre, pagado, pagos: delMes, falta: delMes.length === 0, diasAlVencimiento };
}

// ── Sugerir a qué gasto fijo corresponde un gasto (por el texto) ──────

const sinTildes = normalizarTexto;
const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "en", "por", "para", "con", "mes", "mensual", "pago", "cuenta"]);
// Palabras que en un VEP o comprobante identifican cada impuesto aunque no estén en la descripción del gasto fijo.
const ALIAS: [RegExp, RegExp][] = [
  [/\biva\b/, /\biva\b|f\.?\s?2002|ddjj iva/],
  [/sicore|retenci/, /sicore|retenc|f\.?\s?744/],
  [/autonom/, /autonom|f\.?\s?1003|aportes? personal/],
  [/convenio|multilateral|iibb|ingresos brutos/, /convenio|multilateral|sifere|cm ?0[35]|ingresos brutos|iibb/],
  [/seguridad e higiene|higiene|tasa/, /seguridad e higiene|higiene|t\.?i\.?s\.?h|tasa municipal|municipalidad/],
  [/monotribut/, /monotribut|f\.?\s?152/],
];

/** Devuelve el id del gasto fijo que mejor coincide con el texto, o null si no hay uno claro. */
export function sugerirGastoFijo(texto: string, gastosFijos: { id: string; descripcion: string; activo?: boolean }[]): string | null {
  const t = sinTildes(texto || "");
  if (!t.trim()) return null;
  let mejor: { id: string; puntos: number } | null = null;
  let empate = false;
  for (const g of gastosFijos) {
    if (g.activo === false) continue;
    const d = sinTildes(g.descripcion);
    let puntos = 0;
    for (const [enGasto, enTexto] of ALIAS) if (enGasto.test(d) && enTexto.test(t)) puntos += 3;
    for (const palabra of d.split(/[^a-z0-9]+/)) {
      if (palabra.length < 3 || VACIAS.has(palabra)) continue;
      if (new RegExp(`\\b${palabra}`).test(t)) puntos += 1;
    }
    if (puntos === 0) continue;
    if (!mejor || puntos > mejor.puntos) { mejor = { id: g.id, puntos }; empate = false; }
    else if (puntos === mejor.puntos) empate = true;
  }
  return mejor && !empate ? mejor.id : null;
}

// ── SICORE: monto automático = retenciones de Ganancias del mes anterior ──

/** Suma las retenciones de Ganancias de las OP (no anuladas) del mes anterior a `hoy`. */
export function montoSicore(ops: { fecha: string; estado?: string | null; retencion: number }[], hoy: string): { mes: string; monto: number } {
  const [y, m] = hoy.slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const monto = ops
    .filter((o) => o.fecha?.slice(0, 7) === prev && o.estado !== "anulada")
    .reduce((s, o) => s + (Number(o.retencion) || 0), 0);
  return { mes: prev, monto: Math.round(monto * 100) / 100 };
}
