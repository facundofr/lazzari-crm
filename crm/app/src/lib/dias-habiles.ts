// Días hábiles bancarios en Argentina (para saber cuándo se debita un cheque y cuándo rescatar del FCI).
// Sábados, domingos, feriados nacionales y el Día del Bancario (6/11, solo cierran los bancos).
// ⚠️ La lista de feriados móviles hay que revisarla cada año (decreto de feriados puente y trasladables).

const FERIADOS = new Set<string>([
  // 2026
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-23", "2026-03-24", "2026-04-02", "2026-04-03",
  "2026-05-01", "2026-05-25", "2026-06-15", "2026-06-20", "2026-07-09", "2026-07-10", "2026-08-17",
  "2026-10-12", "2026-11-06", "2026-11-23", "2026-12-07", "2026-12-08", "2026-12-25",
  // 2027 (fijos + Carnaval y Semana Santa; faltan trasladables y puentes)
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-24", "2027-03-25", "2027-03-26", "2027-04-02",
  "2027-05-01", "2027-05-25", "2027-06-20", "2027-07-09", "2027-11-06", "2027-12-08", "2027-12-25",
]);

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function esDiaHabil(fecha: string): boolean {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dia !== 0 && dia !== 6 && !FERIADOS.has(fecha);
}

/** El mismo día si es hábil; si no, el próximo hábil (un cheque que vence un domingo se debita el lunes). */
export function diaHabilDesde(fecha: string): string {
  let f = fecha;
  while (!esDiaHabil(f)) f = sumarDias(f, 1);
  return f;
}

/** Último día hábil anterior a la fecha (sin contarla). */
export function diaHabilAnterior(fecha: string): string {
  let f = sumarDias(fecha, -1);
  while (!esDiaHabil(f)) f = sumarDias(f, -1);
  return f;
}

/** Lunes de la semana de la fecha. */
export function lunesDeLaSemana(fecha: string): string {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia);
}

export { sumarDias };
