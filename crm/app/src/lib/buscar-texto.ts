// Búsqueda sin tildes ni mayúsculas: "pantalon" encuentra "Pantalón" (Augusto 13/10).

/** Pasa a minúsculas y saca tildes/diéresis (ñ queda como n). */
export function normalizarTexto(texto: string | null | undefined): string {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Palabras de la búsqueda, ya normalizadas. */
export function palabrasBusqueda(q: string): string[] {
  return normalizarTexto(q).split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

/** true si TODAS las palabras aparecen en el texto (ya normalizado). */
export function coincideTodas(textoNormalizado: string, palabras: string[]): boolean {
  return palabras.every((w) => textoNormalizado.includes(w));
}
