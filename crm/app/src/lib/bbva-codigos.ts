// Códigos de operación del BBVA (columna "Codigo" del Excel "Movimientos") y cómo los identifica Augusto (tabla "Libro1.xlsx", 23/10/2026: 755 filas, 32 códigos).
// Es la fuente OFICIAL para leer el extracto: el código es del banco y no cambia, el texto de cada línea sí cambia según el Excel que se baje.
// El 135 no estaba en su tabla; Augusto dijo "es una transferencia, como las otras".
// Se guarda en la línea como un sufijo " #NNN" en la descripción (sin cambiar la base) y se quita al mostrarla. Prueba: scripts/test-extracto-bbva.mjs

export type FamiliaCodigo =
  | "cheque_debito" | "cheque_rechazo" | "cheque_deposito" | "comision" | "iva" | "sircreb" | "ley_25413" | "arca"
  | "tarjeta" | "entre_propias" | "fci" | "efectivo" | "transferencia" | "debito_automatico";

export interface CodigoBanco { identificacion: string; familia: FamiliaCodigo }

/** Identificación textual de Augusto + la familia con la que el sistema la entiende. */
export const CODIGOS_BANCO: Record<string, CodigoBanco> = {
  "005": { identificacion: "DEBITO CHEQUE", familia: "cheque_debito" },
  "016": { identificacion: "DEBITO CHEQUE", familia: "cheque_debito" },
  "019": { identificacion: "RECHAZO DE CHEQUE DEBITO", familia: "cheque_rechazo" },
  "037": { identificacion: "COMISION", familia: "comision" },
  "062": { identificacion: "EXTRACCION EFECTIVO", familia: "efectivo" },
  "082": { identificacion: "DEPOSITO CHEQUE COBRANZAS", familia: "cheque_deposito" },
  "129": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "135": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" }, // no estaba en la tabla: Augusto 23/10, "es una transferencia, como las otras"
  "136": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "137": { identificacion: "PAGOS SERVICIOS ARCA", familia: "arca" },
  "219": { identificacion: "PAGO TARJETA CREDITO MASTERCARD", familia: "tarjeta" },
  "236": { identificacion: "IVA 21%", familia: "iva" },
  "241": { identificacion: "COMISION", familia: "comision" },
  "262": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "263": { identificacion: "TRANSFERENCIA ENTRE CUENTAS PROPIAS", familia: "entre_propias" },
  "265": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "266": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "287": { identificacion: "COMISION", familia: "comision" },
  "319": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "343": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "392": { identificacion: "COMISION", familia: "comision" },
  "402": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "515": { identificacion: "PAGO TARJETA CREDITO VISA", familia: "tarjeta" },
  "526": { identificacion: "COMISION", familia: "comision" },
  "550": { identificacion: "SICREB IBB", familia: "sircreb" },
  "575": { identificacion: "COMISION", familia: "comision" },
  "589": { identificacion: "IMPUESTO CREDITO IGA", familia: "ley_25413" },
  "609": { identificacion: "IMPUESTO CREDITO IGA", familia: "ley_25413" },
  "654": { identificacion: "INVERSION FCI", familia: "fci" },
  "743": { identificacion: "PAGO DE TARJETA", familia: "tarjeta" },
  "761": { identificacion: "TRANSFERIA DEBITO CREDITO - DEBITO AUTOMATICO", familia: "debito_automatico" },
  "880": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
  "983": { identificacion: "TRANSFERENCIA DEBITO CREDITO", familia: "transferencia" },
};

const SUFIJO = /\s*#(\d{3})\s*$/;

/** Código del banco guardado al final de la descripción (" #137"), o null. */
export function codigoDeConcepto(concepto: string | null | undefined): string | null {
  const m = String(concepto || "").match(SUFIJO);
  return m ? m[1] : null;
}

/** La descripción sin el sufijo del código (lo que se muestra y lo que se usa para reglas y nombres). */
export function sinCodigoBanco(concepto: string | null | undefined): string {
  return String(concepto || "").replace(SUFIJO, "").trim();
}

/** Agrega el código a la descripción (una sola vez). Códigos vacíos o que no son 3 dígitos se ignoran. */
export function conCodigoBanco(concepto: string, codigo: unknown): string {
  const c = String(codigo ?? "").replace(/\D/g, "").padStart(3, "0");
  if (!/^\d{3}$/.test(c) || c === "000" || codigoDeConcepto(concepto)) return concepto;
  return `${concepto} #${c}`;
}

export const familiaDeCodigo = (codigo: string | null | undefined): FamiliaCodigo | null => (codigo ? CODIGOS_BANCO[codigo]?.familia ?? null : null);
