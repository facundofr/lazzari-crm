export type CanonicalCondicionIva = "RI" | "Monotributo" | "Exento" | "CF";

function conditionKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

const CANONICAL_BY_ALIAS: Record<string, CanonicalCondicionIva> = {
  RI: "RI",
  "RESPONSABLE INSCRIPTO": "RI",
  "RESPONSABLE INSCRIPTO IVA": "RI",
  "IVA RESPONSABLE INSCRIPTO": "RI",
  MONOTRIBUTO: "Monotributo",
  MONOTRIBUTISTA: "Monotributo",
  MT: "Monotributo",
  EXENTO: "Exento",
  "EXENTO EN IVA": "Exento",
  EX: "Exento",
  "CONSUMIDOR FINAL": "CF",
  CF: "CF",
};

const READ_ONLY_ALIASES = new Set(["NO RESPONSABLE"]);

/** Convierte valores de AFIP y aliases históricos al enum real de PostgreSQL. */
export function canonicalCondicionIva(value: unknown): CanonicalCondicionIva | null {
  return CANONICAL_BY_ALIAS[conditionKey(value)] ?? null;
}

/** Acepta el enum real y aliases históricos que todavía pueden aparecer al leer datos. */
export function isKnownCondicionIva(value: unknown): boolean {
  const key = conditionKey(value);
  return Boolean(CANONICAL_BY_ALIAS[key]) || READ_ONLY_ALIASES.has(key);
}

export function isResponsableInscripto(value: unknown): boolean {
  return canonicalCondicionIva(value) === "RI";
}
