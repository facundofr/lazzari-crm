/** Acepta coma o punto como separador decimal, sin interpretar decimales como miles. */
export function parseDecimalInput(value: string | number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const normalized = String(value ?? "").trim().replace(/\s/g, "");
  if (!normalized) return 0;
  if (/^-?\d+(?:[.,]\d+)?$/.test(normalized)) return Number(normalized.replace(",", "."));
  return Number.NaN;
}
