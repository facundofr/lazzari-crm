// OC pagadas que todavía no llegaron ("a reclamar") y avisos de atraso. Solo avisan: nunca traban nada.

export const DIAS_PAGADA_SIN_RECIBIR = 7;
export const DIAS_SIN_RECIBIR = 30;

export interface OCReclamoInput {
  activa: boolean; // no cancelada ni borrador
  pagada: boolean;
  recibidaCompleta: boolean;
  fecha: string; // fecha de la OC (AAAA-MM-DD)
  pagadaAt: string | null; // cuándo quedó pagada (fecha o fecha-hora ISO)
}

export type AvisoAtrasoOC =
  | { tipo: "pagada_sin_recibir"; dias: number }
  | { tipo: "sin_recibir"; dias: number };

/** Días enteros entre dos fechas AAAA-MM-DD (o ISO); negativo si `desde` es posterior. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10));
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Pagada y todavía sin recibir completa: hay que reclamarle la entrega al proveedor. */
export function ocAReclamar(oc: OCReclamoInput): boolean {
  return oc.activa && oc.pagada && !oc.recibidaCompleta;
}

/** Aviso de atraso: pagada hace más de 7 días sin recibir, o sin recibir hace más de 30 días desde la OC. */
export function avisoAtrasoOC(oc: OCReclamoInput, hoy: string): AvisoAtrasoOC | null {
  if (!oc.activa || oc.recibidaCompleta) return null;
  if (oc.pagada && oc.pagadaAt) {
    const dias = diasEntre(oc.pagadaAt.slice(0, 10), hoy);
    if (dias > DIAS_PAGADA_SIN_RECIBIR) return { tipo: "pagada_sin_recibir", dias };
  }
  const dias = diasEntre(oc.fecha.slice(0, 10), hoy);
  if (dias > DIAS_SIN_RECIBIR) return { tipo: "sin_recibir", dias };
  return null;
}
