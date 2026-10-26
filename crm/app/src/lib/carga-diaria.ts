// Carga diaria del banco (25/10/2026, Augusto): ¿está todo al día? Para cada fuente (extracto de cada cuenta, reportes de cheques) se compara la fecha
// de la última carga con lo que corresponde. Es un aviso: no bloquea nada. No sabe de feriados (si hay uno, avisa de más; se resuelve subiendo igual el archivo).
// Prueba: scripts/test-carga-diaria.ts
export type EstadoCarga = "al_dia" | "atrasada" | "sin_datos";

const masDias = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay(); // 0 domingo … 6 sábado
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

/** Fecha (AAAA-MM-DD) en Argentina de un instante guardado en UTC: lo que se sube a las 22 hs del 25 es del 25, no del 26. */
export function fechaArgentina(instante: string): string {
  return new Date(instante).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

/** La más reciente de dos fechas AAAA-MM-DD (ignora las vacías). */
export function masReciente(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = a ? String(a).slice(0, 10) : "", y = b ? String(b).slice(0, 10) : "";
  return (x > y ? x : y) || null;
}

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

// ─── 26/10/2026 — Finanzas simple (Augusto): el Excel "Movimientos" una vez por mes (al cierre); los reportes de eCheq todos los días hábiles ───

/** Último día del mes anterior a `hoy` (AAAA-MM-DD). */
export function cierreMesAnterior(hoy: string): string {
  return masDias(`${hoy.slice(0, 7)}-01`, -1);
}

/** Para lo que se carga una vez por mes, al cierre: al día = la última carga es del último día del mes anterior o después (el banco da 60 días). */
export function estadoCargaMensual(ultima: string | null | undefined, hoy: string): { estado: EstadoCarga; dias: number | null } {
  if (!ultima) return { estado: "sin_datos", dias: null };
  const f = String(ultima).slice(0, 10);
  return { estado: f >= cierreMesAnterior(hoy) ? "al_dia" : "atrasada", dias: diasEntre(f, hoy) };
}

/**
 * Dirección de los cheques de una carga anotada en el registro ("cheques_cargados"). Las nuevas traen `direcciones`;
 * las viejas solo los nombres de los archivos ("25-10-2026-eCheqs-emitidos.xls"): emitidos, anulados, cedidos, denegados-salida y caducados-salida son de cheques propios.
 */
export function direccionesDeCarga(resultado: { direcciones?: unknown; reportes?: unknown } | null | undefined): Set<"emitido" | "recibido"> {
  const out = new Set<"emitido" | "recibido">();
  const dirs = Array.isArray(resultado?.direcciones) ? resultado!.direcciones : null;
  if (dirs) { for (const d of dirs) if (d === "emitido" || d === "recibido") out.add(d); return out; }
  for (const n of Array.isArray(resultado?.reportes) ? resultado!.reportes : []) {
    const t = String(n || "").toLowerCase();
    if (!/echeq/.test(t)) continue;
    out.add(/emitidos|anulados|cedidos|-salida/.test(t) ? "emitido" : "recibido");
  }
  return out;
}

/**
 * Dos Excel de la misma cuenta en una misma subida: se usa el más nuevo (último día que trae; si empatan, el bajado después; si no, el que trae más líneas).
 * Devuelve los índices que se usan y un aviso por cada cuenta con archivos de más. Los archivos sin cuenta se dejan (ya avisan solos).
 */
export function elegirExcelMasNuevos(archivos: { nombre: string; cuentaId: string | null; saldoFecha: string | null; lineas: number; modificado: number }[]): { usar: number[]; avisos: string[] } {
  const porCuenta = new Map<string, number[]>();
  const usar: number[] = [];
  archivos.forEach((a, k) => {
    if (!a.cuentaId) usar.push(k);
    else porCuenta.set(a.cuentaId, [...(porCuenta.get(a.cuentaId) || []), k]);
  });
  const avisos: string[] = [];
  for (const ks of porCuenta.values()) {
    const orden = [...ks].sort((x, y) => {
      const a = archivos[x], b = archivos[y];
      return String(b.saldoFecha || "").localeCompare(String(a.saldoFecha || "")) || b.modificado - a.modificado || b.lineas - a.lineas;
    });
    usar.push(orden[0]);
    if (orden.length > 1) {
      const otros = orden.slice(1).map((k) => archivos[k].nombre);
      avisos.push(`${otros.join(", ")} y ${archivos[orden[0]].nombre} son de la misma cuenta: se usa el más nuevo (${archivos[orden[0]].nombre}); ${otros.length > 1 ? "los otros no se cargan" : "el otro no se carga"}.`);
    }
  }
  return { usar: usar.sort((a, b) => a - b), avisos };
}
