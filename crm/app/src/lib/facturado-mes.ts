// "Facturado del mes" — UNA sola cuenta para Dashboard, Finanzas y el recuadro de gastos fijos.
// Regla: facturas emitidas del mes MENOS notas de crédito del mes, SIN IVA (neto), pesos y dólares por separado.
// Una factura anulada y la NC que la anuló desaparecen juntas (no se resta dos veces): `filtrarParaGestion`.
import { equivalenteARS, esNotaCredito, filtrarParaGestion, normalizarMoneda, periodoDeFecha } from "./reportes-comprobantes";

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FacturaNetoEntrada {
  id?: string | null;
  fecha?: string | null;
  tipo?: string | null;
  estado?: string | null;
  moneda?: string | null;
  subtotal?: number | string | null;
  total?: number | string | null;
  tipo_cambio?: number | string | null;
  factura_origen_id?: string | null;
}

export interface FacturadoMoneda {
  /** Neto de las facturas del período. */
  facturas: number;
  /** Neto de las NC del período (positivo: es lo que se resta). */
  nc: number;
  /** facturas − nc */
  neto: number;
}

export interface FacturadoMes {
  ARS: FacturadoMoneda;
  USD: FacturadoMoneda;
  /** ARS + USD al tipo de cambio de cada comprobante (los que no tienen TC no suman). */
  equivalenteARS: number;
}

function netoDe(r: FacturaNetoEntrada): number {
  const sub = Number(r.subtotal);
  return Number.isFinite(sub) && r.subtotal !== null && r.subtotal !== undefined && r.subtotal !== "" ? sub : Number(r.total) || 0;
}

/**
 * @param periodo "YYYY-MM"
 * @param opts.hastaDia solo cuenta hasta ese día del mes (para comparar contra el mismo tramo del mes anterior)
 * @param opts.idsAnulados ids de facturas anuladas de cualquier fecha (para no restar la NC de una factura anulada)
 */
export function facturadoMesNeto(
  rows: FacturaNetoEntrada[],
  periodo: string,
  opts: { hastaDia?: number; idsAnulados?: Iterable<string> } = {},
): FacturadoMes {
  const out: FacturadoMes = {
    ARS: { facturas: 0, nc: 0, neto: 0 },
    USD: { facturas: 0, nc: 0, neto: 0 },
    equivalenteARS: 0,
  };
  for (const r of filtrarParaGestion(rows as any[], opts.idsAnulados ?? [])) {
    if (periodoDeFecha(r.fecha) !== periodo) continue;
    if (opts.hastaDia && Number(String(r.fecha).slice(8, 10)) > opts.hastaDia) continue;
    const m = normalizarMoneda(r.moneda);
    const neto = netoDe(r);
    if (esNotaCredito(r.tipo)) out[m].nc += neto; else out[m].facturas += neto;
    const eq = equivalenteARS(esNotaCredito(r.tipo) ? -neto : neto, r.moneda, r.tipo_cambio);
    if (eq !== null) out.equivalenteARS += eq;
  }
  for (const m of ["ARS", "USD"] as const) {
    out[m].facturas = redondear(out[m].facturas);
    out[m].nc = redondear(out[m].nc);
    out[m].neto = redondear(out[m].facturas - out[m].nc);
  }
  out.equivalenteARS = redondear(out.equivalenteARS);
  return out;
}
