/**
 * Precio unitario que se manda a /api/facturacion para un renglón de presupuesto.
 *
 * Cómo guarda el precio cada presupuesto (PR):
 * - PR electrónico (A o B): guarda el precio NETO (sin IVA).
 * - PR manual: guarda el precio FINAL (con IVA incluido).
 *
 * Cómo lo espera el servidor de facturación:
 * - Factura A (FA / FCEA): precio NETO; el IVA se suma aparte.
 * - Factura B (FB / FCEB): precio FINAL (IVA incluido); el servidor lo discrimina.
 *
 * Es la misma regla que usaba Ventas (ventas/page.tsx). La usan Ventas y la
 * facturación masiva para que las dos manden lo mismo.
 *
 * IMPORTANTE: esto no se puede probar en local (regla de ARCA). Hay que
 * verificarlo en producción con una factura controlada (una FB y una FA chicas)
 * antes de usar la facturación masiva de nuevo.
 */

export type TipoFacturaPrecio = string;

export function redondearPlata(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** FA, FCEA, NCA, NDA, NCEA… (termina en "A"). */
export function esComprobanteA(tipo: TipoFacturaPrecio): boolean {
  return String(tipo || "").toUpperCase().endsWith("A");
}

export function precioUnitarioParaFactura(params: {
  tipo: TipoFacturaPrecio;
  sourceIsManual: boolean;
  precioNeto: number;
  ivaPorcentaje: number;
}): number {
  const iva = Number.isFinite(params.ivaPorcentaje) ? params.ivaPorcentaje : 21;
  const factor = 1 + iva / 100;
  const precio = Number(params.precioNeto) || 0;
  if (esComprobanteA(params.tipo)) {
    // A: el servidor quiere neto. Un PR manual tiene precio final → se le saca el IVA.
    return params.sourceIsManual ? redondearPlata(precio / factor) : redondearPlata(precio);
  }
  // B: el servidor quiere precio final. Un PR manual ya lo tiene; uno electrónico tiene neto → se le suma el IVA.
  return params.sourceIsManual ? redondearPlata(precio) : redondearPlata(precio * factor);
}
