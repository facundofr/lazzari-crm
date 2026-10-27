/**
 * Reglas de retención de Ganancias (RG 830, Anexo VIII según RG 4525) por concepto, para inscriptos.
 * Confirmado por el contador el 13/10/2026: bienes, servicios, transporte de carga y honorarios.
 * Los demás conceptos (alquileres, intereses, comisiones, etc.) no tienen regla propia todavía:
 * siguen con el mínimo y la alícuota que ya usaban (config de la sociedad y alícuota del proveedor).
 */

export const MINIMO_SERVICIOS = 67170;
export const RETENCION_BIENES_PCT = 2;
export const RETENCION_SERVICIOS_PCT = 2;
export const RETENCION_TRANSPORTE_PCT = 0.25;

/** Conceptos de la ficha del proveedor (proveedores.concepto_retencion_ganancias). */
export const CONCEPTOS_RG830: Record<string, string> = {
  compraventa_bienes: "Compraventa de bienes",
  servicios: "Servicios y locaciones",
  honorarios: "Honorarios profesionales",
  alquileres_inmuebles: "Alquileres de inmuebles",
  alquileres_muebles: "Alquileres de muebles",
  intereses_financieros: "Intereses (financieras)",
  intereses_otros: "Intereses (otros)",
  transporte: "Transporte de carga",
  fletes: "Fletes",
  comisiones: "Comisiones",
  publicidad: "Publicidad y propaganda",
  seguros: "Seguros",
};

/** Alícuota que se carga al elegir el concepto: la ficha del proveedor y la lista «Sin concepto» de Retenciones. */
export const ALICUOTA_POR_CONCEPTO: Record<string, number> = {
  compraventa_bienes: 2, servicios: 2, honorarios: 2, alquileres_inmuebles: 6, alquileres_muebles: 2, intereses_financieros: 3,
  intereses_otros: 6, transporte: 0.25, fletes: 0.25, comisiones: 2, publicidad: 2, seguros: 2,
};

/** Escala de honorarios (código 116): [más de, importe fijo, % sobre el excedente]. */
export const ESCALA_HONORARIOS: Array<[number, number, number]> = [
  [0, 0, 5],
  [8000, 400, 9],
  [16000, 1120, 12],
  [24000, 2080, 15],
  [32000, 3280, 19],
  [48000, 6320, 23],
  [64000, 10000, 27],
  [96000, 18640, 31],
];

export interface ReglaRetencion {
  minimo: number;
  /** null = honorarios: se calcula con la escala sobre lo que supera el mínimo. */
  pct: number | null;
}

/** Retención según la escala de honorarios sobre una base (lo que supera el mínimo). */
export function retencionEscala(base: number): number {
  if (!(base > 0)) return 0;
  let tramo = ESCALA_HONORARIOS[0];
  for (const t of ESCALA_HONORARIOS) if (base > t[0]) tramo = t;
  return tramo[1] + (base - tramo[0]) * (tramo[2] / 100);
}

/**
 * Alícuota a usar sobre el excedente del mínimo. Honorarios: la que resulta de la escala.
 * Resto: la del proveedor si la tiene, si no la del concepto, si no la global de la sociedad.
 */
export function pctRetencion(regla: ReglaRetencion | null, excedente: number, alicuotaProveedor: number | null | undefined, tasaGlobal: number): number {
  if (regla && regla.pct === null) return excedente > 0 ? Math.round((retencionEscala(excedente) / excedente) * 10000) / 100 : 0;
  return alicuotaProveedor != null ? Number(alicuotaProveedor) : regla?.pct ?? tasaGlobal;
}

/**
 * Regla del concepto del proveedor. Sin concepto cargado se toma "bienes" (lo que más compra Lazzari).
 * `minimoBienes` es el mínimo configurado en la sociedad (hoy $224.000).
 * Devuelve null si el concepto no tiene regla propia (se usa lo de siempre).
 */
export function reglaPorConcepto(concepto: string | null | undefined, minimoBienes: number): ReglaRetencion | null {
  switch ((concepto || "compraventa_bienes").trim()) {
    case "compraventa_bienes": return { minimo: minimoBienes, pct: RETENCION_BIENES_PCT };
    case "servicios": return { minimo: MINIMO_SERVICIOS, pct: RETENCION_SERVICIOS_PCT };
    case "transporte":
    case "fletes": return { minimo: MINIMO_SERVICIOS, pct: RETENCION_TRANSPORTE_PCT };
    case "honorarios": return { minimo: MINIMO_SERVICIOS, pct: null };
    default: return null;
  }
}
