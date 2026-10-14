// Tope mensual de gasto del botón "Preguntarle a la IA" de la Ayuda (pedido de Augusto 14/10/2026: B con tope US$ 5).
// Se calcula con la tabla ia_uso (funcion = "chat_ia"). Al llegar al tope, la Ayuda sigue andando sin IA.

export const TOPE_MENSUAL_IA_USD = 5;
export const FUNCION_CHAT_IA = "chat_ia";

// claude-haiku-4-5, USD por millón de tokens. El caché escribe a 1,25× y lee a 0,1× del precio de entrada.
const ENTRADA = 1;
const SALIDA = 5;

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * Tokens de entrada "equivalentes" (los que se cobran a precio normal): entrada + 1,25 × escritura de caché + 0,1 × lectura.
 * Se guardan así en ia_uso para que Configuración → Uso de IA y el tope muestren el costo real.
 */
export function tokensEntradaEquivalentes(u: Usage): number {
  return Math.round((Number(u.input_tokens) || 0) + 1.25 * (Number(u.cache_creation_input_tokens) || 0) + 0.1 * (Number(u.cache_read_input_tokens) || 0));
}

export function costoUSD(tokensEntrada: number, tokensSalida: number): number {
  return (tokensEntrada * ENTRADA + tokensSalida * SALIDA) / 1_000_000;
}

/** Primer día del mes (YYYY-MM-01) en hora de Argentina. */
export function inicioDeMesAR(ahora = new Date()): string {
  const ar = new Date(ahora.getTime() - 3 * 60 * 60 * 1000);
  return `${ar.getUTCFullYear()}-${String(ar.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
