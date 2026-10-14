// "Observaciones" del presupuesto sale impreso en el PDF y en el texto que se le manda al cliente.
// El sistema anota solo, ahí, renglones de ajuste de costo/margen ("[09/10/2026 07:05] FC ...: costo 37259 → 37529 (margen 43.59% → 42.56%)"):
// son INTERNOS y nunca tienen que llegar al cliente. Esta función deja solo lo que escribió una persona.

// Renglón automático: empieza con fecha entre corchetes, o muestra un cambio de margen/costo.
const RENGLON_AUTOMATICO = /^\s*\[\d{1,2}\/\d{1,2}\/\d{2,4}[\s,\]]|\(margen\s+-?[\d.,]+\s*%\s*(?:→|->)|\bcosto\s+[\d.,]+\s*(?:ARS|USD)?\s*(?:→|->)/i;

export function observacionesParaCliente(texto?: string | null): string {
  if (!texto) return "";
  return String(texto)
    .split(/\r?\n/)
    .filter((linea) => !RENGLON_AUTOMATICO.test(linea))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
