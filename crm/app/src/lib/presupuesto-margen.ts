// Ganancia y margen de un presupuesto, para la lista de Presupuestos (solo interno, nunca bloquea).
// Regla de Augusto (14/10/2026): se descuentan gastos e impuestos sobre la venta:
//   · PR manual (sin ARCA, facturado por afuera del sistema electrónico) → 2 %
//   · PR con factura A o B (ARCA, facturado o por facturar)               → 7 %
// Margen = (venta neta de gastos / costo − 1) × 100, igual que "Margen neto" de la ventana del PR.
// Es la ÚNICA regla de margen (auditoría H43, Augusto 28/10 "neto en todos"): la usan la lista, la ventana del PR,
// el aviso al guardar y Presupuestos nuevo (IA).
import { convertirCostoPR, esCostoUsd, tcParaCosto } from "./dolar-presupuesto";
import { esRenglonDeFlete } from "./finanzas-lazza";

export const GASTOS_PR_ARCA = 7;
export const GASTOS_PR_MANUAL = 2;
export const MARGEN_MINIMO_PR = 15;

export interface PRMargenEntrada {
  moneda: string;
  tipoCambio?: number | null;
  tipoCambioDivisas?: number | null;
  modalidadEmision?: string | null;
  /** Flete interno (en la moneda del PR): suma al costo, nunca se le cobra al cliente. */
  costoEnvioInterno?: number | null;
  items: { cantidad: number; precioVenta: number; precioCosto: number; costoMoneda?: string | null }[];
}

export interface PRMargen {
  gastosPct: number;
  venta: number;
  costo: number;
  ganancia: number;
  /** null si el PR no tiene costos cargados (no se puede calcular). */
  margenPct: number | null;
  /** Renglones con costo en otra moneda y sin dólar cargado: quedan fuera de la cuenta (antes daban márgenes absurdos). */
  sinDolar: number;
}

export function gastosPorcentajePR(modalidadEmision?: string | null): number {
  return modalidadEmision === "manual" ? GASTOS_PR_MANUAL : GASTOS_PR_ARCA;
}

/** Margen neto en %: (venta × (1 − gastos %) / costo − 1) × 100, a un decimal. null sin costo o sin venta. */
export function margenNetoPct(venta: number, costo: number, gastosPct: number): number | null {
  if (!(costo > 0) || !(venta > 0)) return null;
  const ganancia = Math.round((venta * (1 - gastosPct / 100) - costo) * 100) / 100;
  return Math.round((ganancia * 1000) / costo) / 10;
}

/**
 * Renglón al que le falta el costo (avisos "sin costo" del PR; nunca frenan).
 * El flete no cuenta: su costo es la factura del transportista en Transportes, no va en el PR
 * (Augusto 29/10/2026). Misma regla que Finanzas (`esRenglonDeFlete`).
 */
export const faltaCosto = (costo: number | string | null | undefined, descripcion: string | null | undefined) =>
  !(Number(costo) > 0) && !esRenglonDeFlete(descripcion);

/** Costo en la moneda del PR. null si hay que pasarlo de moneda y no hay dólar (no se toma el número tal cual). */
export function costoEnMonedaPR(costo: number, costoMoneda: string | null | undefined, prMoneda: string, tc: number, tcDivisas = 0): number | null {
  const cm = costoMoneda || "ARS";
  const hayQueConvertir = esCostoUsd(cm) !== (prMoneda === "USD");
  if (hayQueConvertir && costo > 0 && !(tcParaCosto(cm, Number(tc) || 0, Number(tcDivisas) || 0) > 0)) return null;
  return convertirCostoPR(costo, cm, prMoneda, Number(tc) || 0, Number(tcDivisas) || 0);
}

export function margenPR(pr: PRMargenEntrada): PRMargen {
  const gastosPct = gastosPorcentajePR(pr.modalidadEmision);
  let venta = 0;
  let costo = 0;
  let sinDolar = 0;
  for (const it of pr.items || []) {
    const cant = Number(it.cantidad) || 0;
    const c = costoEnMonedaPR(Number(it.precioCosto) || 0, it.costoMoneda, pr.moneda, Number(pr.tipoCambio) || 0, Number(pr.tipoCambioDivisas) || 0);
    if (c === null) { sinDolar++; continue; }
    venta += cant * (Number(it.precioVenta) || 0);
    costo += cant * c;
  }
  costo += Math.max(0, Number(pr.costoEnvioInterno) || 0);
  const ventaNeta = venta * (1 - gastosPct / 100);
  const ganancia = Math.round((ventaNeta - costo) * 100) / 100;
  const margenPct = margenNetoPct(venta, costo, gastosPct);
  return { gastosPct, venta: Math.round(venta * 100) / 100, costo: Math.round(costo * 100) / 100, ganancia, margenPct, sinDolar };
}
