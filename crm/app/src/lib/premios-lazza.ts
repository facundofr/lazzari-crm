/**
 * Premios del mes (Augusto 28/10/2026): solo Lazzari, sobre el neto facturado del mes (las mismas cifras de Objetivos).
 *  - Mes bueno ($ 80.000.000): $ 200.000 para cada uno. Mes muy bueno ($ 96.000.000): $ 400.000 para cada uno. Por debajo de bueno no hay premio.
 *  - Se paga con el sueldo del mes siguiente (no hay condición de cobro).
 *  - El sistema solo sugiere: el gasto lo carga Augusto con el botón, confirmando. Nunca se carga solo.
 * Funciones puras. Prueba: npx tsx scripts/test-premios-lazza.ts
 */
import { OBJETIVOS_MES, nivelObjetivo, type NivelObjetivo } from "./finanzas-lazza";

/** Quiénes cobran premio. Los nombres son los de los sueldos fijos de Gastos. */
export const PERSONAS_PREMIO = ["Jerónimo Casadidio", "Mariana Santinelli", "Sebastián Pereyra", "Augusto Lazzari"] as const;
/** Premio por persona según el nivel del mes. */
export const PREMIO_POR_PERSONA: Record<NivelObjetivo, number> = { debajo: 0, minimo: 0, bueno: 200_000, muy_bueno: 400_000 };

export interface PremioMes {
  nivel: NivelObjetivo;
  porPersona: number;
  personas: readonly string[];
  total: number;
}

export function premioDelMes(neto: number): PremioMes {
  const nivel = nivelObjetivo(neto).nivel;
  const porPersona = PREMIO_POR_PERSONA[nivel];
  return { nivel, porPersona, personas: PERSONAS_PREMIO, total: porPersona * PERSONAS_PREMIO.length };
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-10" → "octubre" */
export const nombreMesPremio = (periodo: string) => MESES[Number(periodo.slice(5, 7)) - 1] || periodo;
/** "2026-01" → "2025-12" */
export function mesAnterior(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}
/** "2026-12" → "2027-01" */
export function mesSiguiente(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Detalle del gasto, igual para todos: "Premio octubre — Jerónimo Casadidio". Sirve también para saber si ya está cargado. */
export const detallePremio = (periodo: string, persona: string) => `Premio ${nombreMesPremio(periodo)} — ${persona}`;

/** Qué premios faltan cargar del mes `periodo`: los que no están entre los detalles ya cargados (sin importar mayúsculas). */
export function premiosPorCargar(periodo: string, neto: number, yaCargados: string[]): { detalle: string; persona: string; monto: number }[] {
  const p = premioDelMes(neto);
  if (p.porPersona <= 0) return [];
  // Ya cargado (auditoría de la plata, 29/10/2026): el mismo texto, o un premio de ese mes que nombra a la persona aunque le
  // hayan cambiado el resto del detalle. Antes solo el texto exacto: si se editaba, se podía volver a cargar.
  const hechos = yaCargados.map(normalizar);
  const delMes = normalizar(`Premio ${nombreMesPremio(periodo)}`);
  return p.personas
    .map((persona) => ({ detalle: detallePremio(periodo, persona), persona, monto: p.porPersona }))
    .filter((x) => !hechos.some((d) => d === normalizar(x.detalle) || (d.startsWith(delMes) && d.includes(normalizar(x.persona)))));
}

export const MONTOS_PREMIO = { bueno: OBJETIVOS_MES.bueno, muyBueno: OBJETIVOS_MES.muyBueno } as const;
