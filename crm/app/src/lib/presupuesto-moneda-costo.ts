// Costo en la moneda equivocada (Augusto 29/10/2026, caso PR-2026-1142: costo $ 36.425 cargado como US$,
// Reportes de septiembre con $ 54,9 M de costo para una venta de $ 49 mil). Solo avisa, nunca frena ni cambia nada solo.
// Un renglón es sospechoso si con su moneda el costo da absurdo contra la venta (más del doble o menos del 10 %)
// y con la otra moneda da normal (costo entre 30 % y 105 % de la venta). Si ninguna da normal, no se adivina.
import { convertirCostoPR, esCostoUsd, tcParaCosto } from "./dolar-presupuesto";

export const COSTO_RARO_MAX = 2;
export const COSTO_RARO_MIN = 0.1;
const COSTO_NORMAL_MIN = 0.3;
const COSTO_NORMAL_MAX = 1.05;

/** true si el costo (ya en la moneda de la venta) es absurdo contra la venta. */
export function costoRaro(costo: number, venta: number): boolean {
  if (!(costo > 0) || !(venta > 0)) return false;
  const r = costo / venta;
  return r > COSTO_RARO_MAX || r < COSTO_RARO_MIN;
}

export interface MonedaCostoSospechosa {
  /** Moneda que da un margen normal: "ARS" si estaba en US$, "USD" (billete) si estaba en $. */
  sugerida: "ARS" | "USD";
  /** Costo unitario en la moneda del PR, con la moneda cargada y con la sugerida. */
  costoActual: number;
  costoSugerido: number;
}

/**
 * @param ventaUnit precio de venta unitario neto, en la moneda del PR
 * @param tcReferencia dólar del día, para cuando el PR todavía no tiene dólar cargado
 */
export function monedaCostoSospechosa(
  costoUnit: number, costoMoneda: string | null | undefined, ventaUnit: number,
  prMoneda: string, tc: number, tcDivisas: number, tcReferencia = 0,
): MonedaCostoSospechosa | null {
  const costo = Number(costoUnit) || 0;
  const venta = Number(ventaUnit) || 0;
  if (!(costo > 0) || !(venta > 0)) return null;
  const actual = String(costoMoneda || "ARS");
  const sugerida: "ARS" | "USD" = esCostoUsd(actual) ? "ARS" : "USD";
  const t = tcParaCosto(actual, Number(tc) || 0, Number(tcDivisas) || 0) || (Number(tcReferencia) || 0);
  if (!(t > 0)) return null;
  const costoActual = convertirCostoPR(costo, actual, prMoneda, t, t);
  const costoSugerido = convertirCostoPR(costo, sugerida, prMoneda, t, t);
  if (!costoRaro(costoActual, venta)) return null;
  const r = costoSugerido / venta;
  if (r < COSTO_NORMAL_MIN || r > COSTO_NORMAL_MAX) return null;
  return { sugerida, costoActual, costoSugerido };
}
