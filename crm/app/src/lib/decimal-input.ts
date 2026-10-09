/**
 * Convierte lo que escribe el usuario en un número.
 *
 * Acepta coma o punto como separador decimal y también separadores de miles:
 *   "834,77" / "834.77"             → 834.77
 *   "1.241.525,27" / "1,241,525.27" → 1241525.27
 *   "1.530"                         → 1530   (punto + exactamente 3 dígitos = miles)
 *   "1,530"                         → 1.53   (una sola coma siempre es decimal)
 *   "$ 1.000,50"                    → 1000.5
 * Devuelve NaN si el texto no es un número válido y 0 si está vacío.
 *
 * Para cargar en un input un número calculado por el sistema usar `toDecimalInput`,
 * que escribe el decimal con coma y así nunca se confunde con miles.
 */
export function parseDecimalInput(value: string | number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const raw = String(value ?? "").trim().replace(/[\s$]/g, "");
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return Number.NaN;

  const dots = (body.match(/\./g) || []).length;
  const commas = (body.match(/,/g) || []).length;
  let normalized: string;

  if (dots && commas) {
    // Ambos separadores: el último que aparece es el decimal.
    const decimalSep = body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    const parts = body.split(decimalSep);
    if (parts.length !== 2) return Number.NaN;
    const [intPart, decPart] = parts;
    if (!isGroupedInteger(intPart, thousandsSep) || !/^\d+$/.test(decPart)) return Number.NaN;
    normalized = `${intPart.split(thousandsSep).join("")}.${decPart}`;
  } else if (!dots && !commas) {
    normalized = body;
  } else {
    const sep = dots ? "." : ",";
    const parts = body.split(sep);
    if (parts.length > 2) {
      // "1.241.525": varios separadores iguales = agrupación de miles.
      if (!isGroupedInteger(body, sep)) return Number.NaN;
      normalized = parts.join("");
    } else {
      const [intPart, decPart] = parts;
      if (!/^\d+$/.test(intPart) || !/^\d+$/.test(decPart)) return Number.NaN;
      const looksLikeThousands = sep === "." && decPart.length === 3 && /^[1-9]\d{0,2}$/.test(intPart);
      normalized = looksLikeThousands ? `${intPart}${decPart}` : `${intPart}.${decPart}`;
    }
  }

  const result = Number(normalized);
  if (!Number.isFinite(result)) return Number.NaN;
  return negative ? -result : result;
}

/** Número → texto para un input, con coma decimal (ej. 1530.5 → "1530,5"). */
export function toDecimalInput(value: number): string {
  return Number.isFinite(value) ? String(value).replace(".", ",") : "";
}

function isGroupedInteger(text: string, sep: string): boolean {
  if (/^\d+$/.test(text)) return true;
  const escaped = sep === "." ? "\\." : sep;
  return new RegExp(`^\\d{1,3}(${escaped}\\d{3})+$`).test(text);
}
