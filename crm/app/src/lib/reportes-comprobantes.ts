/**
 * Reglas puras para sumar comprobantes en Reportes y Dashboard (sin base de datos).
 *
 * - Las notas de crédito (tipo que empieza con "NC": NCA, NCB, NCEA, "NC A", "NC"…) restan.
 * - ARS y USD nunca se suman entre sí: cada total va por moneda.
 * - Los meses salen del texto de la fecha ("2026-10-01" → "2026-10"), sin pasar por Date (evita el corrimiento de zona horaria).
 * - Gestión (ventas, rankings, gráficos): se excluyen los comprobantes anulados y también las NC cuya factura
 *   de origen está anulada (la NC total anula la factura; si se sacan las dos, no se resta dos veces).
 * - Libro IVA: entra todo lo que existe fiscalmente. En ventas, una factura "anulada" que tiene CAE sigue
 *   en el libro (se compensa con su NC); en compras, "anulada" es un registro dado de baja y no entra.
 */

export type Moneda = "ARS" | "USD";

export function normalizarMoneda(moneda?: string | null): Moneda {
  return String(moneda || "").toUpperCase().includes("USD") ? "USD" : "ARS";
}

export function esNotaCredito(tipo?: string | null): boolean {
  return String(tipo || "").toUpperCase().replace(/\s+/g, "").startsWith("NC");
}

export function signoComprobante(tipo?: string | null): 1 | -1 {
  return esNotaCredito(tipo) ? -1 : 1;
}

/** "2026-10-01" → "2026-10". Si la fecha no tiene formato válido devuelve "". */
export function periodoDeFecha(fecha?: string | null): string {
  const p = String(fecha || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(p) ? p : "";
}

/** Suma (o resta) meses a un período "YYYY-MM". */
export function sumarMeses(periodo: string, n: number): string {
  const [y, m] = periodo.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const yy = Math.floor(total / 12);
  const mm = total - yy * 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

/** Primer día del mes que está `mesesAtras` meses antes del mes de `hoy` ("YYYY-MM-DD"). 0 = mes actual. */
export function inicioDeMesHace(hoy: string, mesesAtras: number): string {
  return `${sumarMeses(periodoDeFecha(hoy), -mesesAtras)}-01`;
}

export interface ComprobanteGestion {
  id?: string | null;
  estado?: string | null;
  tipo?: string | null;
  factura_origen_id?: string | null;
}

/**
 * Deja los comprobantes que cuentan para gestión: saca los anulados y las NC cuya factura de origen
 * está anulada. `idsAnulados` son los ids de facturas anuladas (de cualquier fecha); se suman también
 * los anulados que vengan en `rows`.
 */
export function filtrarParaGestion<T extends ComprobanteGestion>(rows: T[], idsAnulados: Iterable<string> = []): T[] {
  const anulados = new Set<string>(idsAnulados);
  for (const r of rows) if (r.estado === "anulada" && r.id) anulados.add(r.id);
  return rows.filter((r) => {
    if (r.estado === "anulada") return false;
    if (esNotaCredito(r.tipo) && r.factura_origen_id && anulados.has(r.factura_origen_id)) return false;
    return true;
  });
}

export interface ComprobanteMonto {
  fecha?: string | null;
  tipo?: string | null;
  total?: number | string | null;
  moneda?: string | null;
}

export function montoFirmado(r: ComprobanteMonto): number {
  return signoComprobante(r.tipo) * (Number(r.total) || 0);
}

export type TotalesMoneda = Record<Moneda, number>;

/** Totales por mes y por moneda, con NC en negativo. Ignora fechas inválidas. */
export function totalesMensuales(rows: ComprobanteMonto[]): Record<string, TotalesMoneda> {
  const out: Record<string, TotalesMoneda> = {};
  for (const r of rows) {
    const periodo = periodoDeFecha(r.fecha);
    if (!periodo) continue;
    if (!out[periodo]) out[periodo] = { ARS: 0, USD: 0 };
    out[periodo][normalizarMoneda(r.moneda)] += montoFirmado(r);
  }
  for (const k of Object.keys(out)) {
    out[k].ARS = redondear(out[k].ARS);
    out[k].USD = redondear(out[k].USD);
  }
  return out;
}

/**
 * Pasa un monto a pesos: ARS queda igual; USD se multiplica por la cotización de la factura
 * (o por `tcRespaldo` si la factura no la tiene). Devuelve null si no hay cotización.
 */
export function equivalenteARS(monto: number, moneda?: string | null, tipoCambio?: number | string | null, tcRespaldo?: number | null): number | null {
  if (normalizarMoneda(moneda) === "ARS") return monto;
  const tc = Number(tipoCambio) > 0 ? Number(tipoCambio) : Number(tcRespaldo) > 0 ? Number(tcRespaldo) : 0;
  return tc > 0 ? monto * tc : null;
}

// ── Libro IVA ──────────────────────────────────────────────────────

export function incluirEnLibroIVAVentas(f: { estado?: string | null; cae?: string | null }): boolean {
  return f.estado !== "anulada" || Boolean(String(f.cae || "").trim());
}

export function incluirEnLibroIVACompras(f: { estado?: string | null }): boolean {
  return f.estado !== "anulada";
}

export interface FilaLibroIVA {
  tipo?: string | null;
  moneda?: string | null;
  neto_gravado: number;
  iva: number;
  percepciones?: number;
  total: number;
  tipo_cambio?: number | null;
}

/** Devuelve la fila con los importes con signo (NC en negativo) y la moneda normalizada. */
export function firmarFilaLibro<T extends FilaLibroIVA>(fila: T): T & { moneda: Moneda; signo: 1 | -1 } {
  const signo = signoComprobante(fila.tipo);
  // `|| 0` evita el "-0" (se vería "-$ 0,00").
  const firmar = (v: unknown) => signo * Math.abs(Number(v) || 0) || 0;
  return {
    ...fila,
    moneda: normalizarMoneda(fila.moneda),
    signo,
    neto_gravado: firmar(fila.neto_gravado),
    iva: firmar(fila.iva),
    percepciones: firmar(fila.percepciones),
    total: firmar(fila.total),
  };
}

export interface TotalesLibro {
  cantidad: number;
  neto_gravado: number;
  iva: number;
  percepciones: number;
  total: number;
}

export interface TotalesLibroIVA {
  ARS: TotalesLibro;
  USD: TotalesLibro;
  /** Solo los comprobantes en USD que tienen cotización guardada, pasados a pesos con esa cotización. */
  USDenARS: TotalesLibro;
  /** Cantidad de comprobantes en USD sin cotización guardada (no se pueden pasar a pesos). */
  usdSinCotizacion: number;
}

const vacio = (): TotalesLibro => ({ cantidad: 0, neto_gravado: 0, iva: 0, percepciones: 0, total: 0 });

/** Totales del libro por moneda. Espera filas ya firmadas con `firmarFilaLibro`. */
export function totalesLibroIVA(filas: FilaLibroIVA[]): TotalesLibroIVA {
  const t: TotalesLibroIVA = { ARS: vacio(), USD: vacio(), USDenARS: vacio(), usdSinCotizacion: 0 };
  const sumar = (dst: TotalesLibro, f: FilaLibroIVA, factor: number) => {
    dst.cantidad += 1;
    dst.neto_gravado += (Number(f.neto_gravado) || 0) * factor;
    dst.iva += (Number(f.iva) || 0) * factor;
    dst.percepciones += (Number(f.percepciones) || 0) * factor;
    dst.total += (Number(f.total) || 0) * factor;
  };
  for (const f of filas) {
    const moneda = normalizarMoneda(f.moneda);
    sumar(t[moneda], f, 1);
    if (moneda === "USD") {
      const tc = Number(f.tipo_cambio) || 0;
      if (tc > 0) sumar(t.USDenARS, f, tc);
      else t.usdSinCotizacion += 1;
    }
  }
  for (const k of ["ARS", "USD", "USDenARS"] as const) {
    const x = t[k];
    x.neto_gravado = redondear(x.neto_gravado);
    x.iva = redondear(x.iva);
    x.percepciones = redondear(x.percepciones);
    x.total = redondear(x.total);
  }
  return t;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
