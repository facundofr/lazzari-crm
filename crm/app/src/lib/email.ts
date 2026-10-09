const INVISIBLE_EMAIL_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;

export function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE_EMAIL_CHARS, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
