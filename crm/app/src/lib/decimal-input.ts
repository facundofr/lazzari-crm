/** Parse the canonical value produced by an HTML input[type="number"]. */
export function parseDecimalInput(value: string): number {
  const normalized = String(value ?? "").trim().replace(/\s/g, "");
  if (!normalized) return 0;
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  // Supports restored drafts or pasted values that use a decimal comma.
  if (/^-?\d+(?:,\d+)?$/.test(normalized)) return Number(normalized.replace(",", "."));
  return Number.NaN;
}
