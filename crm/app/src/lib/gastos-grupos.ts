/**
 * Pestañas (grupos) de Finanzas › Gastos editables (Augusto 03/11/2026: "dejame que pueda crear una pestaña nueva y ponerle con el
 * nombre que yo quiera, o editar las que están ahí, así Nati puede reordenar toda la parte de reportes, contabilidad y gastos").
 * Tabla gastos_grupos (migración 20261103210000): clave (lo que se guarda en el gasto, no cambia al renombrar), nombre, orden,
 * línea del Estado de resultados y oculta. `linea` null = la regla de siempre de clasificarGasto (solo las 9 de base).
 * Sin la tabla (o si falla la lectura) se usan las 9 de siempre: nada se traba.
 * Prueba: npx tsx scripts/test-gastos-grupos.ts
 */
import { GRUPOS, GRUPO_TRANSPORTES, nombreGrupo } from "./gastos-lazza";
import type { FueraId, LineaId } from "./contabilidad";

export type LineaGrupo = LineaId | FueraId;
export interface GrupoGasto { id?: string; clave: string; nombre: string; orden: number; linea: LineaGrupo | null; oculto: boolean; base: boolean }

/** Las 9 de hoy (mismo orden y nombres que la pantalla antes de la tabla). */
export const GRUPOS_BASE: GrupoGasto[] = GRUPOS.map((clave, i) => ({ clave, nombre: nombreGrupo(clave), orden: i + 1, linea: null, oculto: false, base: true }));

/** Líneas a las que puede ir una pestaña (las calculadas solas, como Ventas, Costo, IIBB o Ganancias, no). */
export const LINEAS_PESTANA: { id: LineaGrupo; nombre: string }[] = [
  { id: "administrativos", nombre: "Gastos administrativos" },
  { id: "colaboradores_lsj", nombre: "Colaboradores L-S-J" },
  { id: "colaborador_m", nombre: "Colaborador M" },
  { id: "comisiones", nombre: "Comisiones de venta" },
  { id: "consultoria", nombre: "Consultoría" },
  { id: "compras_sin_factura", nombre: "Compras sin factura" },
  { id: "credito_fiscal_iva", nombre: "Compra de crédito fiscal IVA" },
  { id: "bancarios", nombre: "Gastos bancarios" },
  { id: "intereses", nombre: "Intereses" },
  { id: "retiros", nombre: "Retiros de accionistas (fuera del resultado)" },
  { id: "impuestos_pago", nombre: "Impuestos que son pago (fuera del resultado, van al Cashflow)" },
];
const LINEAS_VALIDAS = new Set<string>([...LINEAS_PESTANA.map((l) => l.id), "transportes"]);
export const nombreLinea = (l: LineaGrupo | null) => (l ? LINEAS_PESTANA.find((x) => x.id === l)?.nombre || l : "Como hasta ahora (reglas de siempre)");

/** Filas de la tabla → pestañas en orden. Sin filas (tabla sin correr o error), las 9 de base. Las de base que falten se agregan al final. */
export function armarGrupos(filas: { id?: string; clave: string; nombre: string; orden?: number | null; linea?: string | null; oculto?: boolean | null; base?: boolean | null }[] | null | undefined): GrupoGasto[] {
  if (!filas?.length) return GRUPOS_BASE.map((g) => ({ ...g }));
  const out: GrupoGasto[] = filas.filter((f) => String(f.clave || "").trim()).map((f) => ({
    id: f.id, clave: f.clave, nombre: String(f.nombre || "").trim() || f.clave, orden: Number(f.orden) || 0,
    linea: f.linea && LINEAS_VALIDAS.has(f.linea) ? (f.linea as LineaGrupo) : null, oculto: !!f.oculto,
    base: !!f.base || (GRUPOS as readonly string[]).includes(f.clave),
  }));
  let max = Math.max(0, ...out.map((g) => g.orden));
  for (const b of GRUPOS_BASE) if (!out.some((g) => g.clave === b.clave)) out.push({ ...b, orden: ++max });
  return out.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
}

/** Nombre que se ve de una clave (si no está en la tabla, el de siempre). */
export function nombreDeGrupo(grupos: GrupoGasto[], clave: string | null | undefined): string {
  return grupos.find((g) => g.clave === clave)?.nombre || nombreGrupo(clave);
}

/** Claves de las pestañas nuevas (las que no son de base): grupoDe las respeta en vez de deducir el grupo por la categoría. */
export const clavesExtra = (grupos: GrupoGasto[]): string[] => grupos.filter((g) => !(GRUPOS as readonly string[]).includes(g.clave)).map((g) => g.clave);

/** Pestañas que se pueden elegir al cargar un gasto: las visibles, menos Transportes (sale de las facturas de transporte). */
export const gruposElegibles = (grupos: GrupoGasto[], actual?: string | null): GrupoGasto[] =>
  grupos.filter((g) => g.clave !== GRUPO_TRANSPORTES && (!g.oculto || g.clave === actual));

/** A cada gasto le pone la línea de su pestaña (si la pestaña tiene una elegida); clasificarGasto la usa antes que la regla de siempre. */
export function conLineaDeGrupo<T extends { grupo?: string | null }>(gastos: T[], grupos: GrupoGasto[]): (T & { linea_grupo?: LineaGrupo | null })[] {
  const linea = new Map(grupos.filter((g) => g.linea).map((g) => [g.clave, g.linea as LineaGrupo]));
  if (!linea.size) return gastos;
  return gastos.map((g) => (g.grupo && linea.has(g.grupo) ? { ...g, linea_grupo: linea.get(g.grupo)! } : g));
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Revisa el nombre de una pestaña nueva o renombrada: no vacío, no repetido (sin mirar tildes ni mayúsculas). Devuelve el error o null. */
export function errorNombre(nombre: string, grupos: GrupoGasto[], clavePropia?: string): string | null {
  const n = nombre.trim();
  if (!n) return "Poné un nombre.";
  if (n.length > 40) return "El nombre es muy largo (hasta 40 letras).";
  const igual = grupos.find((g) => g.clave !== clavePropia && (sinAcentos(g.nombre) === sinAcentos(n) || sinAcentos(g.clave) === sinAcentos(n)));
  return igual ? `Ya hay una pestaña "${igual.nombre}".` : null;
}

/** Clave para una pestaña nueva: su nombre (si choca con una clave existente, con un número al final). */
export function claveNueva(nombre: string, grupos: GrupoGasto[]): string {
  const base = nombre.trim().replace(/\s+/g, " ");
  const usadas = new Set(grupos.map((g) => sinAcentos(g.clave)));
  if (!usadas.has(sinAcentos(base))) return base;
  for (let i = 2; ; i++) if (!usadas.has(sinAcentos(`${base} ${i}`))) return `${base} ${i}`;
}

/** Nuevo orden al mover una pestaña un lugar (dir -1 arriba, +1 abajo): devuelve las que cambian de número. */
export function moverGrupo(grupos: GrupoGasto[], clave: string, dir: -1 | 1): { clave: string; orden: number }[] {
  const lista = [...grupos].sort((a, b) => a.orden - b.orden);
  const i = lista.findIndex((g) => g.clave === clave);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= lista.length) return [];
  [lista[i], lista[j]] = [lista[j], lista[i]];
  return lista.map((g, k) => ({ clave: g.clave, orden: k + 1 })).filter((x) => grupos.find((g) => g.clave === x.clave)!.orden !== x.orden);
}
