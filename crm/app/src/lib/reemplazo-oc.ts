/**
 * Reemplazo de un renglón de OC por lo que realmente facturó el proveedor (otra medida, otro artículo).
 * La OC queda igual a la factura; el PR conserva lo vendido (descripción, cantidad y precio de venta)
 * y solo cambia el costo, pasado a la unidad del PR con una equivalencia que confirma el usuario.
 * Ej.: factura 5000 m a $504, PR 10 rollos → equivalencia 500 → costo $252.000 por rollo.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cuántas unidades de la factura forman 1 unidad del PR/OC original (5000 ÷ 10 = 500). */
export function equivalenciaSugerida(cantidadFactura: number, cantidadOriginal: number): number {
  const f = Number(cantidadFactura), o = Number(cantidadOriginal);
  if (!(f > 0) || !(o > 0)) return 1;
  return Math.round((f / o) * 10000) / 10000;
}

/** Costo por unidad del PR: costo unitario de la factura × equivalencia. */
export function costoPorUnidadPR(costoUnitarioFactura: number, equivalencia: number): number {
  return r2(Number(costoUnitarioFactura) * (Number(equivalencia) > 0 ? Number(equivalencia) : 1));
}

export interface AvisoCostoPR {
  /** Variación del costo en % (positiva = sube). null si no se puede comparar (moneda distinta o sin costo previo). */
  variacionPct: number | null;
  /** Markup que queda con el precio de venta fijo (mismo cálculo que la columna "Markup" del PR). */
  markupNuevo: number | null;
  /** true = mostrar aviso (cambio > 5 % en un PR sin facturar, o siempre en uno facturado, como informativo). */
  avisar: boolean;
  /** true = markup debajo del mínimo (15 %): el aviso va en rojo. */
  bajoMinimo: boolean;
  texto: string;
}

export const MARKUP_MINIMO = 15;
export const UMBRAL_CAMBIO_COSTO = 5;

/** Nunca frena: solo arma el texto del aviso. */
export function avisoCambioCostoPR(p: {
  articulo: string;
  costoViejo: number;
  costoNuevo: number;
  mismaMoneda: boolean;
  markupNuevo: number | null;
  facturado: boolean;
}): AvisoCostoPR {
  const variacionPct = p.mismaMoneda && p.costoViejo > 0 ? r2(((p.costoNuevo - p.costoViejo) / p.costoViejo) * 100) : null;
  const bajoMinimo = p.markupNuevo !== null && p.markupNuevo < MARKUP_MINIMO;
  const cambioGrande = variacionPct === null || Math.abs(variacionPct) > UMBRAL_CAMBIO_COSTO;
  const avisar = p.facturado || cambioGrande || bajoMinimo;
  const varTxt = variacionPct === null ? "el costo cambió" : `el costo ${variacionPct >= 0 ? "subió" : "bajó"} ${Math.abs(variacionPct).toLocaleString("es-AR")} %`;
  const mkTxt = p.markupNuevo === null ? "" : `; markup ${p.markupNuevo.toLocaleString("es-AR")} %${bajoMinimo ? ` (debajo del ${MARKUP_MINIMO} %)` : ""}`;
  const texto = p.facturado
    ? `«${p.articulo}» (PR ya facturado, informativo): ${varTxt}${mkTxt}.`
    : `«${p.articulo}»: ${varTxt}${mkTxt}. Tenelo en cuenta antes de facturar.`;
  return { variacionPct, markupNuevo: p.markupNuevo, avisar, bajoMinimo, texto };
}
