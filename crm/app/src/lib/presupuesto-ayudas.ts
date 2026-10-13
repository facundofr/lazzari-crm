// Ayudas de la ventana de presupuestos (Augusto 13/10): último precio vendido al cliente,
// búsqueda en la lista de costos mientras se escribe y resumen de totales/margen. Funciones puras.
import { normalizarTexto, palabrasBusqueda, coincideTodas } from "@/lib/buscar-texto";

export const MARGEN_MINIMO_PR = 15;

/** Clave para comparar artículos: el código (sin mayúsculas ni espacios) o, si no tiene, la descripción. */
export function claveArticulo(codigo: string | null | undefined, descripcion?: string | null): string {
  const c = normalizarTexto(codigo).replace(/\s+/g, "");
  if (c) return `c:${c}`;
  const d = normalizarTexto(descripcion).replace(/\s+/g, " ").trim();
  return d ? `d:${d}` : "";
}

export interface PRVendido {
  numero: string;
  fecha: string; // YYYY-MM-DD
  moneda: string;
  items: Array<{ codigo: string; descripcion: string; precioVenta: number }>;
}
export interface UltimoPrecio { precio: number; moneda: string; fecha: string; numero: string }

/** Último precio (neto, sin IVA) al que se le vendió cada artículo al cliente. */
export function ultimosPrecios(prs: PRVendido[]): Map<string, UltimoPrecio> {
  const out = new Map<string, UltimoPrecio>();
  for (const pr of prs) {
    for (const it of pr.items) {
      const precio = Number(it.precioVenta) || 0;
      if (!(precio > 0)) continue;
      const k = claveArticulo(it.codigo, it.descripcion);
      if (!k) continue;
      const prev = out.get(k);
      if (!prev || pr.fecha > prev.fecha || (pr.fecha === prev.fecha && pr.numero > prev.numero)) {
        out.set(k, { precio, moneda: pr.moneda, fecha: pr.fecha, numero: pr.numero });
      }
    }
  }
  return out;
}

/** Filas de la lista de costos que tienen todas las palabras buscadas (sin tildes). Primero las que empiezan con el código. */
export function buscarEnLista<T extends { _txt: string; codigo: string; codigo_interno?: string | null }>(filas: T[], q: string, max = 8): T[] {
  const palabras = palabrasBusqueda(q);
  if (!palabras.length || palabras.join("").length < 3) return [];
  const exactos: T[] = [];
  const resto: T[] = [];
  const p0 = palabras[0];
  for (const f of filas) {
    if (!coincideTodas(f._txt, palabras)) continue;
    const cod = normalizarTexto(f.codigo_interno || f.codigo);
    (cod.startsWith(p0) ? exactos : resto).push(f);
    if (exactos.length >= max) break;
  }
  return [...exactos, ...resto].slice(0, max);
}

/** Busca un artículo de la lista por código (interno o del proveedor), sin mayúsculas ni espacios. */
export function filaPorCodigo<T extends { codigo: string; codigo_interno?: string | null }>(filas: T[], codigo: string): T | null {
  const c = normalizarTexto(codigo).replace(/\s+/g, "");
  if (!c) return null;
  const n = (x: string | null | undefined) => normalizarTexto(x).replace(/\s+/g, "");
  return filas.find((f) => n(f.codigo_interno) === c) || filas.find((f) => n(f.codigo) === c) || null;
}

export interface RenglonResumen { cantidad: number; neto: number; costo: number; iva: number }
export interface ResumenPR {
  subtotal: number; iva: number; total: number; costo: number;
  margen: number | null;      // % sobre el costo
  ganancia: number | null;    // subtotal − costo
  bajoMargen: number;         // renglones con costo y margen < mínimo
}

/** Totales del presupuesto: subtotal, IVA, total, margen real y ganancia (todo en la moneda del PR). */
export function resumenPresupuesto(renglones: RenglonResumen[], margenMinimo = MARGEN_MINIMO_PR): ResumenPR {
  let subtotal = 0, iva = 0, costo = 0, bajoMargen = 0;
  for (const r of renglones) {
    const sub = r.cantidad * r.neto;
    subtotal += sub;
    iva += sub * (r.iva / 100);
    costo += r.cantidad * r.costo;
    if (r.costo > 0 && r.neto > 0 && ((r.neto / r.costo) - 1) * 100 < margenMinimo) bajoMargen++;
  }
  const hay = costo > 0 && subtotal > 0;
  return {
    subtotal, iva, total: subtotal + iva, costo,
    margen: hay ? ((subtotal / costo) - 1) * 100 : null,
    ganancia: hay ? subtotal - costo : null,
    bajoMargen,
  };
}
