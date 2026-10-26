// Control día por día del extracto (25/10/2026, Augusto): al subir un Excel "Movimientos" se compara cada día contra lo ya guardado, línea por línea (fecha + importe).
// Avisa, sin bloquear ni cambiar nada: (1) líneas guardadas que el banco ya no trae ese día, (2) líneas que el banco trae en un día que ya estaba cargado y no están guardadas.
// No se compara el primer ni el último día del archivo (pueden venir cortados si se bajó a media jornada), ni los días anteriores al primer día guardado,
// ni se avisa de líneas nuevas después del último día guardado (es lo normal de una carga diaria).
// El texto y el saldo no se usan: la base y el Excel los traen distintos. Prueba: scripts/test-control-dia.ts
export interface LineaControl { fecha: string; importe: number }
export interface DiaControl {
  fecha: string;
  /** Guardadas en la base y que el Excel no trae ese día. */
  sobranEnBase: number[];
  /** Que trae el Excel, en un día que ya estaba cargado, y no están guardadas. */
  faltanEnBase: number[];
}
export interface ResultadoControl { diasComparados: number; diferencias: DiaControl[] }

const cent = (v: number) => Math.round(v * 100);

/** Multiconjunto `a` − `b` (por importe en centavos). */
function restar(a: number[], b: number[]): number[] {
  const cuenta = new Map<number, number>();
  for (const x of b) cuenta.set(cent(x), (cuenta.get(cent(x)) || 0) + 1);
  const out: number[] = [];
  for (const x of a) {
    const c = cuenta.get(cent(x)) || 0;
    if (c > 0) cuenta.set(cent(x), c - 1); else out.push(x);
  }
  return out;
}

/**
 * Descarta, de las líneas que parecen nuevas, las que ya están guardadas aunque cambie el saldo o el texto (la base y el Excel los traen distintos).
 * Por cada fecha + importe: lo que trae el archivo menos lo que ya hay guardado; solo pueden entrar esas líneas de más.
 * Así un Excel que se pisa con lo ya cargado no duplica nada, y una línea realmente nueva (aunque repita importe ese día) sí entra.
 */
export function limitarPorGuardadas<T extends LineaControl>(candidatas: T[], archivo: LineaControl[], guardadas: LineaControl[]): T[] {
  const clave = (l: LineaControl) => `${l.fecha}|${cent(l.importe)}`;
  const contar = (ls: LineaControl[]) => { const m = new Map<string, number>(); for (const l of ls) m.set(clave(l), (m.get(clave(l)) || 0) + 1); return m; };
  const nArchivo = contar(archivo), nBase = contar(guardadas);
  const permitidas = new Map<string, number>();
  for (const [k, n] of nArchivo) permitidas.set(k, Math.max(0, n - (nBase.get(k) || 0)));
  return candidatas.filter((l) => {
    const k = clave(l), p = permitidas.get(k) ?? 0;
    if (p <= 0) return false;
    permitidas.set(k, p - 1);
    return true;
  });
}

export function controlPorDia(archivo: LineaControl[], base: LineaControl[]): ResultadoControl {
  if (!archivo.length) return { diasComparados: 0, diferencias: [] };
  const fechasArchivo = archivo.map((l) => l.fecha).sort();
  const primero = fechasArchivo[0], ultimo = fechasArchivo[fechasArchivo.length - 1];
  const fechasBase = base.map((l) => l.fecha).sort();
  const primeraBase = fechasBase[0] || "", ultimaBase = fechasBase[fechasBase.length - 1] || "";
  const porDia = (ls: LineaControl[]) => {
    const m = new Map<string, number[]>();
    for (const l of ls) m.set(l.fecha, [...(m.get(l.fecha) || []), l.importe]);
    return m;
  };
  const a = porDia(archivo), b = porDia(base);
  const fechas = [...new Set([...a.keys(), ...[...b.keys()].filter((f) => f >= primero && f <= ultimo)])].sort();
  const diferencias: DiaControl[] = [];
  let diasComparados = 0;
  for (const f of fechas) {
    if (f === primero || f === ultimo) continue; // el primer y el último día del archivo pueden venir cortados
    if (!base.length || f < primeraBase) continue; // antes de lo guardado no hay con qué comparar
    diasComparados++;
    const enArchivo = a.get(f) || [], enBase = b.get(f) || [];
    const sobran = restar(enBase, enArchivo);
    const faltan = f < ultimaBase ? restar(enArchivo, enBase) : [];
    if (sobran.length || faltan.length) diferencias.push({ fecha: f, sobranEnBase: sobran, faltanEnBase: faltan });
  }
  return { diasComparados, diferencias };
}

/** Línea ya guardada, con lo necesario para corregirle el texto. */
export interface GuardadaTexto extends LineaControl { id: string; descripcion: string }

/**
 * Líneas provisorias (25/10/2026, Augusto): lo que entra de la hoja "Movimientos del Día" trae un texto y un código provisorios
 * (ej. un pago a ARCA aparece como "BANELCO #062", extracción). Cuando llega el Excel siguiente, el mismo movimiento viene en
 * "Movimientos Históricos" con el texto y el código definitivos. Devuelve qué líneas guardadas corregir: solo las del último día que
 * ya estaba cargado en adelante (`desde`), solo si el cruce por fecha + importe es único de los dos lados, y solo si el texto cambió.
 * No toca clasificación ni estado: solo la descripción.
 */
export function textosDefinitivos(
  archivo: Array<LineaControl & { concepto: string; provisoria?: boolean }>,
  guardadas: GuardadaTexto[],
  desde: string | null | undefined,
): Array<{ id: string; viejo: string; nuevo: string }> {
  if (!desde) return [];
  const clave = (l: LineaControl) => `${l.fecha}|${cent(l.importe)}`;
  const agrupar = <T extends LineaControl>(ls: T[]) => { const m = new Map<string, T[]>(); for (const l of ls) m.set(clave(l), [...(m.get(clave(l)) || []), l]); return m; };
  const definitivas = agrupar(archivo.filter((l) => !l.provisoria && l.fecha >= desde));
  const candidatas = agrupar(guardadas.filter((g) => g.fecha >= desde));
  const out: Array<{ id: string; viejo: string; nuevo: string }> = [];
  for (const [k, gs] of candidatas) {
    const ds = definitivas.get(k) || [];
    if (gs.length !== 1 || ds.length !== 1) continue;
    if (gs[0].descripcion.trim() !== ds[0].concepto.trim()) out.push({ id: gs[0].id, viejo: gs[0].descripcion, nuevo: ds[0].concepto });
  }
  return out;
}
