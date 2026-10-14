// Ganancia y margen de un presupuesto, para la lista de Presupuestos (solo interno, nunca bloquea).
// Regla de Augusto (14/10/2026): se descuentan gastos e impuestos sobre la venta:
//   · PR manual (sin ARCA, facturado por afuera del sistema electrónico) → 2 %
//   · PR con factura A o B (ARCA, facturado o por facturar)               → 7 %
// Margen = (venta neta de gastos / costo − 1) × 100, igual que "Margen neto" de la ventana del PR.
import { convertirCostoPR } from "./dolar-presupuesto";

export const GASTOS_PR_ARCA = 7;
export const GASTOS_PR_MANUAL = 2;
export const MARGEN_MINIMO_PR = 15;

export interface PRMargenEntrada {
  moneda: string;
  tipoCambio?: number | null;
  tipoCambioDivisas?: number | null;
  modalidadEmision?: string | null;
  items: { cantidad: number; precioVenta: number; precioCosto: number; costoMoneda?: string | null }[];
}

export interface PRMargen {
  gastosPct: number;
  venta: number;
  costo: number;
  ganancia: number;
  /** null si el PR no tiene costos cargados (no se puede calcular). */
  margenPct: number | null;
}

export function gastosPorcentajePR(modalidadEmision?: string | null): number {
  return modalidadEmision === "manual" ? GASTOS_PR_MANUAL : GASTOS_PR_ARCA;
}

export function margenPR(pr: PRMargenEntrada): PRMargen {
  const gastosPct = gastosPorcentajePR(pr.modalidadEmision);
  let venta = 0;
  let costo = 0;
  for (const it of pr.items || []) {
    const cant = Number(it.cantidad) || 0;
    venta += cant * (Number(it.precioVenta) || 0);
    costo += cant * convertirCostoPR(
      Number(it.precioCosto) || 0, it.costoMoneda || "ARS", pr.moneda,
      Number(pr.tipoCambio) || 0, Number(pr.tipoCambioDivisas) || 0,
    );
  }
  const ventaNeta = venta * (1 - gastosPct / 100);
  const ganancia = Math.round((ventaNeta - costo) * 100) / 100;
  const margenPct = costo > 0 && venta > 0 ? Math.round((ganancia * 1000) / costo) / 10 : null;
  return { gastosPct, venta: Math.round(venta * 100) / 100, costo: Math.round(costo * 100) / 100, ganancia, margenPct };
}
