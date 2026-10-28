// Un solo diccionario de nombres (auditoría UX 27/10/2026, arreglo 5): lo que el sistema guarda con códigos
// (en_cartera, PAGADO, extracto_cargado, #137) se muestra siempre con palabras: bandeja del banco, Cheques y Ver por tipo.
// Solo para mostrar: los valores guardados no cambian. Prueba: scripts/test-nombres-estados.ts
import { CODIGOS_BANCO } from "./bbva-codigos";

const minuscula = (v: unknown) => String(v ?? "").trim().toLowerCase();
const mayuscula1 = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const sinGuiones = (t: string) => t.replace(/_/g, " ").replace(/\s+/g, " ").trim();

/** Estado del cheque en el CRM («en_cartera» → «en cartera»). */
const ESTADO_CHEQUE: Record<string, string> = {
  en_cartera: "en cartera", pendiente: "pendiente", entregado: "entregado", endosado: "endosado", cobrado: "cobrado",
  depositado: "depositado", rechazado: "rechazado", anulado: "anulado", debitado: "debitado",
};
export function nombreEstadoCheque(estado: unknown): string {
  const e = minuscula(estado);
  return ESTADO_CHEQUE[e] ?? sinGuiones(e);
}

/** Estado del cheque según el banco (reportes eCheq, en mayúsculas: «CUSTODIA» → «en custodia»). */
const ESTADO_BANCO: Record<string, string> = {
  PAGADO: "pagado", RECHAZADO: "rechazado", ANULADO: "anulado", ACTIVO: "activo", PRESENTADO: "presentado",
  DEPOSITADO: "depositado", CUSTODIA: "en custodia", REPUDIADO: "repudiado", EMITIDO: "emitido",
};
export function nombreEstadoBanco(estado: unknown): string {
  const e = String(estado ?? "").trim().toUpperCase();
  return ESTADO_BANCO[e] ?? sinGuiones(e.toLowerCase());
}
/** Igual, con la primera letra en mayúscula (para una columna o un dato suelto). */
export const nombreEstadoBancoTitulo = (estado: unknown) => mayuscula1(nombreEstadoBanco(estado));

/** Lo que se anota en el Registro de la bandeja (finanzas_registro.accion). */
const ACCION_REGISTRO: Record<string, string> = {
  arca_cargado: "Facturas de ARCA cargadas", asistente_leyo_correos: "El asistente leyó los correos", cheque_rechazado: "Cheque rechazado",
  cheques_cargados: "Cheques cargados", cheques_confirmados_solos: "Cheques confirmados solos", confirmada: "Confirmada", corregida: "Corregida", descartada: "Descartada",
  extracto_cargado: "Extracto cargado", ia_sugirio: "La IA sugirió", regla_creada: "Regla creada", resumen_cargado: "Resumen cargado",
};
export function nombreAccionRegistro(accion: unknown): string {
  const a = minuscula(accion);
  return ACCION_REGISTRO[a] ?? mayuscula1(sinGuiones(a));
}

/** «#137» del final de una línea del banco (y en cualquier parte de un texto guardado) se saca al mostrar. */
export const quitarCodigosBanco = (texto: unknown): string => String(texto ?? "").replace(/\s+#\d{3}\b/g, "").trim();

const SIGLAS = new Set(["ARCA", "IVA", "FCI", "SIRCREB", "CUIT"]);
/** Qué es el código del banco, en palabras («137» → «Pagos servicios ARCA»); null si no está en la tabla. */
export function nombreCodigoBanco(codigo: unknown): string | null {
  const c = String(codigo ?? "").replace(/\D/g, "").padStart(3, "0");
  const ident = CODIGOS_BANCO[c]?.identificacion;
  if (!ident) return null;
  const palabras = ident.split(/\s+/).map((p) => (SIGLAS.has(p.toUpperCase()) ? p.toUpperCase() : p.toLowerCase()));
  return mayuscula1(palabras.join(" "));
}
