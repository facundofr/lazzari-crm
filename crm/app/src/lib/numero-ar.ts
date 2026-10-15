// Números escritos a la argentina: punto de miles y coma decimal. Funciones puras (prueba: scripts/test-numero-ar.ts).
//   "1.000" = mil · "1.250.000" = 1250000 · "1,5" = 1,5 · "1.000,50" = 1000,5
//   Un punto que NO va seguido de exactamente 3 números se toma como decimal ("29.9", "0.5"), para no romper lo que ya se escribía así.

/** Texto escrito → número (NaN si no es un número). */
export function parseNumeroAR(texto: string): number {
  const s = String(texto ?? "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  if (!/^-?[\d.,]+$/.test(s)) return NaN;
  if (s.includes(",")) {
    // Coma = decimal; los puntos son de miles.
    if (s.indexOf(",") !== s.lastIndexOf(",")) return NaN;
    return Number(s.replace(/\./g, "").replace(",", "."));
  }
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  if ((s.match(/\./g) || []).length > 1) return NaN;
  return Number(s);
}

/** Mientras se escribe: deja pasar estados intermedios ("1.", "1,", "1.0", "1.00"). */
export function textoNumeroValido(texto: string): boolean {
  return /^-?[\d.,]*$/.test(String(texto ?? "").replace(/\s/g, ""));
}

/** Cantidad (Augusto 14/10/2026: las cantidades no llevan coma): solo enteros, el punto es de miles.
 *  "1.000" = mil · "300" = 300 · "29.9", "1,5" → NaN (no es una cantidad válida). */
export function parseCantidadAR(texto: string): number {
  const s = String(texto ?? "").trim().replace(/\s/g, "");
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  return NaN;
}

/** Mientras se escribe una cantidad: solo números y puntos de miles (la coma no entra). */
export function textoCantidadValido(texto: string): boolean {
  return /^[\d.]*$/.test(String(texto ?? "").replace(/\s/g, ""));
}

/** Renglones con descripción y cantidad pero sin precio (para avisar antes de enviar o descargar; nunca frena). */
export function renglonesSinPrecio<T extends { cantidad: number; precio: number; descripcion?: string }>(items: T[]): T[] {
  return (items || []).filter((r) => String(r.descripcion ?? "").trim() && Number(r.cantidad) > 0 && !(Number(r.precio) > 0));
}

/** Número → texto con coma decimal, sin separador de miles (para un casillero que se edita). */
export function numeroAEditable(n: number, maxDecimales = 4): string {
  if (!Number.isFinite(n) || n === 0) return "";
  return n.toLocaleString("es-AR", { maximumFractionDigits: maxDecimales, useGrouping: false });
}

/** Cantidad para mostrar: punto de miles y coma decimal ("1.000", "29,9"). */
export function formatCantidad(n: number | string | null | undefined, maxDecimales = 4): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString("es-AR", { maximumFractionDigits: maxDecimales });
}

/** Avisos de un renglón (nunca frenan): cantidad con decimales (Augusto: las cantidades SIEMPRE son enteras), precio en 0. */
export function avisosRenglon(r: { cantidad: number; unidad?: string | null; precio: number; descripcion?: string }): string[] {
  const out: string[] = [];
  const cant = Number(r.cantidad) || 0;
  const unidad = String(r.unidad || "UN").trim().toUpperCase();
  if (cant > 0 && !Number.isInteger(Math.round(cant * 10000) / 10000)) out.push(`cantidad con decimales (${formatCantidad(cant)} ${unidad})`);
  if (String(r.descripcion ?? "x").trim() && cant > 0 && !(Number(r.precio) > 0)) out.push("precio en 0");
  return out;
}
