// Precios de la IA: US$ por millón de tokens (entrada / salida). Una sola tabla para Configuración › Uso de IA,
// el tope diario del agente de correo y el tope de la Ayuda (auditoría P09, 02/11/2026).
// Fuente: precios oficiales de Anthropic (API directa), confirmados el 02/11/2026. Es una estimación: sirve para
// tener una idea del gasto, no para facturar.
// Prueba: npx tsx scripts/test-precios-ia.ts

export interface PrecioIA { entrada: number; salida: number }

// De lo más específico a lo más general: gana el primer prefijo que coincide
// ("claude-opus-5-5" tiene que ir antes que "claude-opus-5"). Los IDs con fecha ("claude-haiku-4-5-20251001") entran por prefijo.
const TABLA: Array<[string, PrecioIA]> = [
  ["claude-fable-5", { entrada: 10, salida: 50 }],
  ["claude-opus-5-5", { entrada: 4, salida: 20 }],
  ["claude-opus-5", { entrada: 5, salida: 25 }],
  ["claude-opus-4-8", { entrada: 5, salida: 25 }],
  ["claude-opus-4-7", { entrada: 5, salida: 25 }],
  ["claude-opus-4-6", { entrada: 5, salida: 25 }],
  ["claude-sonnet-5", { entrada: 2, salida: 10 }],
  ["claude-sonnet-4-6", { entrada: 3, salida: 15 }],
  ["claude-sonnet-4-5", { entrada: 3, salida: 15 }],
  ["claude-haiku-5-5", { entrada: 0.1, salida: 0.5 }],
  ["claude-haiku-4-5", { entrada: 1, salida: 5 }],
];

// Modelo desconocido: el de su familia de la generación actual; sin familia, Opus 5.5 (el que más usa el CRM).
const POR_FAMILIA: Array<[string, PrecioIA]> = [
  ["opus", { entrada: 4, salida: 20 }],
  ["sonnet", { entrada: 2, salida: 10 }],
  ["haiku", { entrada: 0.1, salida: 0.5 }],
  ["fable", { entrada: 10, salida: 50 }],
];

export function precioIA(modelo: string | null | undefined): PrecioIA {
  const m = String(modelo || "").trim().toLowerCase();
  const exacto = TABLA.find(([prefijo]) => m.startsWith(prefijo));
  if (exacto) return exacto[1];
  const familia = POR_FAMILIA.find(([nombre]) => m.includes(nombre));
  return familia ? familia[1] : TABLA[1][1];
}

/** Costo estimado en US$ de una llamada. */
export function costoIAUSD(modelo: string | null | undefined, tokensEntrada: number, tokensSalida: number): number {
  const p = precioIA(modelo);
  return ((Number(tokensEntrada) || 0) * p.entrada + (Number(tokensSalida) || 0) * p.salida) / 1_000_000;
}
