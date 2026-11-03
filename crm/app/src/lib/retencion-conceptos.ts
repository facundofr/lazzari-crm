/**
 * Reglas de retención de Ganancias (RG 830, Anexo VIII según RG 4525) por concepto, para inscriptos.
 * Confirmado por el contador el 13/10/2026: bienes, servicios, transporte de carga y honorarios.
 * Los demás conceptos (alquileres, intereses, comisiones, etc.) no tienen regla propia todavía:
 * siguen con el mínimo y la alícuota que ya usaban (config de la sociedad y alícuota del proveedor).
 */
import { isResponsableInscripto } from "@/lib/fiscal-condition";
import { roundPaymentMoney } from "@/lib/payment-money";

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

// ── La cuenta de la Orden de pago (P08, auditoría 02/11/2026) ──
// Antes estaba escrita dentro de components/orden-pago-nueva.tsx y sin prueba; ahora la OP usa estas dos funciones (misma cuenta,
// mismo redondeo) y lib/plan-pagos → calcularRetencionGanancias también. Prueba: scripts/test-retencion-conceptos.ts.

export interface ProveedorFiscal {
  condicion_iva?: string | null;
  alicuota_ganancias?: number | null;
  concepto_retencion_ganancias?: string | null;
  exclusion_retencion?: boolean | null;
  exclusion_retencion_desde?: string | null;
  exclusion_retencion_hasta?: string | null;
}

/** Certificado de exclusión vigente en esa fecha (la de la OP, no la de hoy). */
export function proveedorExcluido(p: ProveedorFiscal | null | undefined, fecha: string): boolean {
  return Boolean(p?.exclusion_retencion)
    && (!p!.exclusion_retencion_desde || p!.exclusion_retencion_desde <= fecha)
    && (!p!.exclusion_retencion_hasta || p!.exclusion_retencion_hasta >= fecha);
}

/** Mínimo no imponible del mes según el concepto del proveedor (sin regla propia: el de la sociedad). */
export function minimoDelConcepto(concepto: string | null | undefined, minimoBienes: number): number {
  return reglaPorConcepto(concepto, minimoBienes)?.minimo ?? minimoBienes;
}

/**
 * Paso 1 (al elegir el proveedor o cambiar la fecha o las facturas): ¿se retiene y a qué alícuota? La persona lo puede cambiar.
 * Excluido en la fecha de la OP → no. No inscripto o sociedad que no retiene → no. Si el acumulado del mes (bases sin IVA de
 * pagos anteriores + esta) llega al mínimo del concepto → sí, con la alícuota del proveedor, la del concepto o la global
 * (honorarios: la que resulta de la escala).
 */
export function propuestaRetencionOP(o: {
  proveedor: ProveedorFiscal | null | undefined;
  /** Condición frente al IVA con la que trabaja la OP (la del proveedor o la consultada). */
  condicionIva: string | null | undefined;
  aplicaSociedad: boolean;
  minimoBienes: number;
  tasaGlobal: number;
  fecha: string;
  basePrevia: number;
  baseEstaOP: number;
}): { aplica: boolean; pct: number; excluido: boolean } {
  if (proveedorExcluido(o.proveedor, o.fecha)) return { aplica: false, pct: 0, excluido: true };
  if (!isResponsableInscripto(o.condicionIva) || !o.aplicaSociedad) return { aplica: false, pct: 0, excluido: false };
  const acumulado = o.basePrevia + o.baseEstaOP;
  const regla = reglaPorConcepto(o.proveedor?.concepto_retencion_ganancias, o.minimoBienes);
  const minimo = regla ? regla.minimo : o.minimoBienes;
  if (acumulado < minimo) return { aplica: false, pct: 0, excluido: false };
  return { aplica: true, pct: pctRetencion(regla, acumulado - minimo, o.proveedor?.alicuota_ganancias, o.tasaGlobal), excluido: false };
}

/**
 * Paso 2: el importe (Art. 26 y 29 RG 830). Retención sobre lo que el acumulado del mes supera el mínimo, a la alícuota elegida,
 * menos lo ya retenido en el mes; si no llega al importe mínimo de retención, 0. Un importe escrito a mano manda.
 * `baseGanancias` es la parte de esta OP sujeta a retención (toda la base si el mes ya había superado el mínimo; si no, el excedente).
 */
export function importeRetencionOP(o: {
  aplica: boolean;
  pct: number;
  minimo: number;
  basePrevia: number;
  baseEstaOP: number;
  retenidoMes: number;
  minimoRetencion: number;
  manual?: number | null;
}): { baseGanancias: number; bruta: number; retencion: number } {
  const baseGanancias = !o.aplica ? 0 : o.basePrevia >= o.minimo ? o.baseEstaOP : (o.basePrevia + o.baseEstaOP) - o.minimo;
  const bruta = !o.aplica || baseGanancias <= 0 ? 0
    : Math.max(0, Math.max(0, (o.basePrevia + o.baseEstaOP) - o.minimo) * (o.pct / 100) - o.retenidoMes);
  const retencion = o.manual !== null && o.manual !== undefined ? roundPaymentMoney(o.manual)
    : bruta < o.minimoRetencion ? 0 : roundPaymentMoney(bruta);
  return { baseGanancias, bruta, retencion };
}
