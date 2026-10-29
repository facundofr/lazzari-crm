/**
 * José Alvarez (Augusto 29/10/2026): además de transportista interno (sus viajes se liquidan en Transportes), es vendedor y le
 * prestó plata a Lazzari en US$. Cada mes se le paga:
 *  - Comisión: 90% del margen SIN IVA (venta neta − costo, el mismo costo de Reportes) de lo que facturó en el mes, al cierre
 *    del mes (no se espera a cobrar). Las NC de sus facturas restan.
 *  - Interés del préstamo: $ 150.000 fijos por mes, en pesos (gasto fijo "Interés préstamo José Alvarez").
 * El pago del mes P lleva la comisión del mes anterior y el interés del mes P (como el del 06/10: comisión de septiembre + interés).
 * Solo sugiere: se carga con el botón, confirmando. Funciones puras. Prueba: npx tsx scripts/test-jose-alvarez.ts
 */
export const JOSE_ALVAREZ = {
  nombre: "José Alvarez",
  vendedorId: "5a101eec-e92e-422c-90ec-51d61fdba118",
  fijoInteresId: "6a1f0c10-0001-4e00-9a00-0000000000a1",
  porcentajeComision: 0.9,
  interes: 150_000,
  /** Primer mes en que se usa la tarjeta (antes los pagos se cargaron a mano). */
  desde: "2026-10",
} as const;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "2026-09" → "septiembre 2026" */
export const mesTexto = (periodo: string) => `${MESES[Number(periodo.slice(5, 7)) - 1] || periodo} ${periodo.slice(0, 4)}`;
/** Detalle de los gastos (también sirve para saber si ya están cargados). */
export const detalleComision = (periodo: string) => `Comisión ${mesTexto(periodo)} — ${JOSE_ALVAREZ.nombre}`;
export const detalleInteres = (periodo: string) => `Interés préstamo ${JOSE_ALVAREZ.nombre} — ${mesTexto(periodo)}`;

export interface FilaMargen {
  presupuestoId: string | null;
  venta: { neto: number };
  costo: { neto: number };
}

/**
 * Comisión de José en un mes, desde las filas de Reportes de ese mes (una por factura o NC, en $).
 * `prsDeJose`: los presupuestos donde José es el vendedor. Solo cuentan esas facturas (y sus NC).
 */
export function comisionDelMes(filas: FilaMargen[], prsDeJose: Set<string>, porcentaje: number = JOSE_ALVAREZ.porcentajeComision) {
  const suyas = filas.filter((f) => f.presupuestoId && prsDeJose.has(f.presupuestoId));
  const venta = r2(suyas.reduce((s, f) => s + f.venta.neto, 0));
  const costo = r2(suyas.reduce((s, f) => s + f.costo.neto, 0));
  const margen = r2(venta - costo);
  return { facturas: suyas.length, venta, costo, margen, comision: margen > 0 ? r2(margen * porcentaje) : 0 };
}
