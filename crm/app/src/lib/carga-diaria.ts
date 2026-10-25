// Carga diaria del banco (25/10/2026, Augusto): ¿está todo al día? Para cada fuente (extracto de cada cuenta, reportes de cheques) se compara la fecha
// de la última carga con lo que corresponde. Es un aviso: no bloquea nada. No sabe de feriados (si hay uno, avisa de más; se resuelve subiendo igual el archivo).
// Prueba: scripts/test-carga-diaria.ts
export type EstadoCarga = "al_dia" | "atrasada" | "sin_datos";

const masDias = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay(); // 0 domingo … 6 sábado
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

/** Último día hábil (lunes a viernes) hasta `hoy` incluido: si hoy es sábado o domingo, el viernes. */
export function ultimoDiaHabil(hoy: string): string {
  let f = hoy;
  while (diaSemana(f) === 0 || diaSemana(f) === 6) f = masDias(f, -1);
  return f;
}

/** Para lo que se carga todos los días hábiles: ¿la última carga (AAAA-MM-DD…) cubre el último día hábil? */
export function estadoCarga(ultima: string | null | undefined, hoy: string): { estado: EstadoCarga; dias: number | null } {
  if (!ultima) return { estado: "sin_datos", dias: null };
  const f = String(ultima).slice(0, 10);
  return { estado: f >= ultimoDiaHabil(hoy) ? "al_dia" : "atrasada", dias: diasEntre(f, hoy) };
}

/** Para lo que no se carga todos los días (CC INDU, caja de ahorro, FCI): al día = la última carga es de los últimos `maxDias` días (por defecto 7). */
export function estadoCargaSemanal(ultima: string | null | undefined, hoy: string, maxDias = 7): { estado: EstadoCarga; dias: number | null } {
  if (!ultima) return { estado: "sin_datos", dias: null };
  const dias = diasEntre(String(ultima), hoy);
  return { estado: dias <= maxDias ? "al_dia" : "atrasada", dias };
}
