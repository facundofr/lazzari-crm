/**
 * Datos comunes para emitir una factura de venta (una sola regla para Ventas y Facturación):
 * - condiciones de venta y su vencimiento,
 * - condición sugerida según la ficha del cliente,
 * - puntos de venta de cada sociedad,
 * - precio neto de un renglón de presupuesto.
 *
 * Prueba: npx tsx scripts/test-factura-condicion.ts
 */

export const CONDICIONES_VENTA = [
  "Contado", "Cta. Cte.", "15 días", "30 días", "45 días", "60 días", "90 días",
  "Cheque 30 días", "Cheque 60 días", "Cheque 90 días",
] as const;

const DIAS_CONDICION: Record<string, number> = {
  "Contado": 0, "Cta. Cte.": 30,
  "15 días": 15, "30 días": 30, "45 días": 45, "60 días": 60, "90 días": 90,
  "Cheque 30 días": 30, "Cheque 60 días": 60, "Cheque 90 días": 90,
};

function sumarDias(fechaBase: string, dias: number): string {
  const d = new Date(fechaBase + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Vencimiento de la factura según la condición de venta ("" si la condición no tiene plazo conocido). */
export function calcFechaVencimiento(condicion: string, fechaBase: string, diasCliente?: number | null): string {
  if (!fechaBase) return "";
  // "Cta. Cte." usa los días de la ficha del cliente si los tiene.
  if (condicion === "Cta. Cte." && diasCliente && diasCliente > 0) return sumarDias(fechaBase, diasCliente);
  const dias = DIAS_CONDICION[condicion];
  if (dias == null) return "";
  return sumarDias(fechaBase, dias);
}

/** Condición de venta sugerida desde la ficha del cliente (días de cuenta corriente y forma de pago). */
export function condicionVentaCliente(diasCC: number | null | undefined, formaPago: string | null | undefined): string {
  const dias = Number(diasCC) || 0;
  if (dias <= 0) return "Contado";
  if ((formaPago || "").toLowerCase().includes("cheque") && [30, 60, 90].includes(dias)) return `Cheque ${dias} días`;
  const directa = `${dias} días`;
  if ((CONDICIONES_VENTA as readonly string[]).includes(directa)) return directa;
  // Plazo que no está en la lista: cuenta corriente con los días del cliente.
  return "Cta. Cte.";
}

/** Puntos de venta ARCA de cada sociedad (el primero es el de siempre). */
export function puntosVentaSociedad(nombreSociedad: string | null | undefined): number[] {
  return nombreSociedad === "Grupo LA" ? [10] : [15, 16];
}

/** Factura A (discrimina IVA) para responsables inscriptos y monotributistas; B para el resto. */
export function tipoFacturaPorCondicionIva(condicionIva: string | null | undefined): "FA" | "FB" {
  return ["RI", "RESPONSABLE INSCRIPTO", "MONOTRIBUTO", "MONOTRIBUTISTA"].includes((condicionIva || "").toUpperCase()) ? "FA" : "FB";
}

/** Precio neto de un renglón de presupuesto: precio_venta, o el total dividido cantidad sin IVA. */
export function precioNetoItemPresupuesto(it: { cantidad: number | string | null; precio_venta: number | string | null; iva_porcentaje: number | string | null; total: number | string | null }): number {
  if (it.precio_venta != null) return Number(it.precio_venta) || 0;
  const iva = Number(it.iva_porcentaje ?? 21);
  const cantidad = Number(it.cantidad) || 1;
  return it.total ? Number(it.total) / cantidad / (1 + iva / 100) : 0;
}

/** Pasa precios de renglones entre factura A (neto) y B (final) sin cambiar el total. */
export function convertirItemsEntreAyB<T extends { precio_unitario: number; iva_porcentaje: number }>(items: T[], deA: boolean, aA: boolean): T[] {
  if (deA === aA) return items;
  return items.map((it) => {
    const factor = 1 + (it.iva_porcentaje ?? 21) / 100;
    const precio = deA ? it.precio_unitario * factor : it.precio_unitario / factor;
    return { ...it, precio_unitario: Math.round((precio + Number.EPSILON) * 100) / 100 };
  });
}

/** Convierte un precio de la moneda del presupuesto a la de la factura. */
export function convertirPrecioMoneda(precio: number, desde: string, hacia: string, tipoCambio: number): number {
  if (desde === hacia || !(tipoCambio > 0)) return precio;
  return desde === "USD" ? Math.round(precio * tipoCambio * 100) / 100 : Math.round(precio / tipoCambio * 100) / 100;
}
