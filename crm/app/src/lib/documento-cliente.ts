// Clientes con CUIT o DNI (Augusto 28/10/2026). El DNI va en la misma columna `cuit`.
// A un cliente con DNI no se le factura con ARCA: se le hace factura manual (X).
// Lógica pura (sin pantalla ni base). Prueba: scripts/test-documento-cliente.ts

export function digitosDocumento(doc: string | null | undefined): string {
  return String(doc || "").replace(/\D/g, "");
}

/** DNI = 7 u 8 números. */
export function esDni(doc: string | null | undefined): boolean {
  const n = digitosDocumento(doc).length;
  return n === 7 || n === 8;
}

/** CUIT = 11 números. */
export function esCuit(doc: string | null | undefined): boolean {
  return digitosDocumento(doc).length === 11;
}

/** El DNI que trae adentro un CUIT de persona (20-12345678-9 → 12345678), sin ceros adelante. */
export function dniDentroDeCuit(cuit: string | null | undefined): string | null {
  const d = digitosDocumento(cuit);
  if (d.length !== 11) return null;
  return d.slice(2, 10).replace(/^0+/, "") || null;
}

/** Cómo mostrar el documento: "DNI 12345678", el CUIT tal cual o "Sin CUIT/DNI". */
export function textoDocumento(doc: string | null | undefined): string {
  if (!String(doc || "").trim()) return "Sin CUIT/DNI";
  return esDni(doc) ? `DNI ${digitosDocumento(doc)}` : String(doc);
}

export const AVISO_DNI_SIN_ARCA = "Cliente con DNI: se factura manual, sin ARCA";
