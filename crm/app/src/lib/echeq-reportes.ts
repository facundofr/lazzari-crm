// Reportes de eCheq del home banking del BBVA ("23-10-2026-eCheqs-<estado>.xls"), un archivo por estado (Augusto 24/10/2026).
// Lee los reportes de recibidos y emitidos: cada cheque se identifica por su CheqID (único del banco); el N° de cheque solo no alcanza porque se repite entre bancos.
// Nunca bloquea: lo raro se devuelve como advertencia. Prueba: scripts/test-echeq-reportes.ts
import { leerFecha, leerImporte, numeroCheque } from "./extracto-bbva";

export type TipoReporteEcheq =
  | "aceptados" | "deposito" | "custodia" | "rechazados" | "denegados" | "endosados"
  | "emitidos" | "anulados" | "cedidos" | "denegados-salida" | "caducados-salida";

/** recibido = cheques que nos entregaron (columna "Emitido por"); emitido = cheques nuestros (columna "Emitido a"). */
export type DireccionEcheq = "recibido" | "emitido";

export interface EcheqReporteFila {
  cheqId: string;
  numero: string;
  bancoEmisor: string;
  monto: number;
  /** Estado del banco, tal cual (ACTIVO, PAGADO, REPUDIADO, CUSTODIA…). */
  estadoBanco: string;
  fechaPago: string | null;
  fechaEmision: string | null;
  fechaDeposito: string | null;
  /** Emitido por (recibidos) o emitido a (emitidos). */
  contraparte: string;
  endosadoPor: string;
  destinatario: string;
  cuentaDeposito: string;
}

export interface EcheqReporte {
  archivo: string;
  /** Según el nombre del archivo (null si no se reconoce). */
  tipo: TipoReporteEcheq | null;
  /** Según las columnas del archivo (null si no parece un reporte de eCheq). */
  direccion: DireccionEcheq | null;
  filas: EcheqReporteFila[];
  advertencias: string[];
}

const TIPOS: TipoReporteEcheq[] = ["aceptados", "deposito", "custodia", "rechazados", "denegados", "endosados", "emitidos", "anulados", "cedidos", "denegados-salida", "caducados-salida"];
const DIRECCION_POR_TIPO: Record<TipoReporteEcheq, DireccionEcheq> = {
  aceptados: "recibido", deposito: "recibido", custodia: "recibido", rechazados: "recibido", denegados: "recibido", endosados: "recibido",
  emitidos: "emitido", anulados: "emitido", cedidos: "emitido", "denegados-salida": "emitido", "caducados-salida": "emitido",
};
/** El home banking baja "emitidos" de a 100: con exactamente 100 filas puede estar cortado. */
export const TOPE_EMITIDOS = 100;

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const limpio = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** "23-10-2026-eCheqs-denegados-salida (1).xls" → "denegados-salida". */
export function tipoDeNombreEcheq(nombre: string): TipoReporteEcheq | null {
  const m = String(nombre || "").toLowerCase().match(/echeqs?[-_ ]+([a-z-]+?)\s*(?:\(\d+\))?\s*(?:\.[a-z]+)?\s*$/);
  const t = m?.[1] as TipoReporteEcheq | undefined;
  return t && TIPOS.includes(t) ? t : null;
}

/** Lee una hoja de un reporte de eCheq. `archivo` es el nombre del archivo (el estado va en el nombre). */
export function leerReporteEcheq(filas: unknown[][], archivo: string): EcheqReporte {
  const out: EcheqReporte = { archivo, tipo: tipoDeNombreEcheq(archivo), direccion: null, filas: [], advertencias: [] };
  const iEnc = filas.findIndex((f) => (f || []).some((c) => norm(c) === "n° de cheque") && (f || []).some((c) => norm(c) === "cheqid"));
  if (iEnc < 0) { out.advertencias.push("No parece un reporte de eCheq del banco (faltan las columnas \"N° de cheque\" y \"CheqID\")."); return out; }
  const enc = (filas[iEnc] || []).map(norm);
  const col = (...n: string[]) => enc.findIndex((c) => n.includes(c));
  const cPor = col("emitido por"), cA = col("emitido a");
  out.direccion = cA >= 0 ? "emitido" : cPor >= 0 ? "recibido" : null;
  if (!out.direccion) out.advertencias.push("No sé si es un reporte de cheques recibidos o emitidos (faltan \"Emitido por\" / \"Emitido a\").");
  if (!out.tipo) out.advertencias.push("No reconozco el tipo de reporte por el nombre del archivo (por ejemplo \"…-eCheqs-aceptados.xls\"). Se lee igual por su contenido.");
  else if (out.direccion && DIRECCION_POR_TIPO[out.tipo] !== out.direccion) out.advertencias.push(`El nombre dice "${out.tipo}" pero las columnas son de cheques ${out.direccion}s: revisá que sea el archivo correcto.`);

  const cId = col("cheqid"), cNum = col("n° de cheque"), cBanco = col("banco emisor"), cMonto = col("monto"), cEstado = col("estado");
  const cPago = col("fecha de pago"), cEmision = col("fecha de emision"), cDeposito = col("fecha de deposito");
  const cEndosadoPor = col("endosado por"), cDest = col("destinatario"), cCuenta = col("n° de cuenta desposito", "n° de cuenta deposito");
  const cont = out.direccion === "emitido" ? cA : cPor;
  const txt = (f: unknown[], i: number) => (i >= 0 ? limpio(f[i]) : "");

  for (const f of filas.slice(iEnc + 1)) {
    const cheqId = txt(f, cId), numero = txt(f, cNum);
    if (!cheqId && !numero) continue;
    const monto = cMonto >= 0 ? leerImporte(f[cMonto]) : null;
    if (!cheqId || !numero || monto === null) { out.advertencias.push(`Fila sin ${!cheqId ? "CheqID" : !numero ? "N° de cheque" : "monto"} (cheque ${numero || cheqId || "?"}): no se lee.`); continue; }
    out.filas.push({
      cheqId, numero, bancoEmisor: txt(f, cBanco), monto, estadoBanco: txt(f, cEstado).toUpperCase(),
      fechaPago: cPago >= 0 ? leerFecha(f[cPago]) : null, fechaEmision: cEmision >= 0 ? leerFecha(f[cEmision]) : null, fechaDeposito: cDeposito >= 0 ? leerFecha(f[cDeposito]) : null,
      contraparte: txt(f, cont), endosadoPor: txt(f, cEndosadoPor).replace(/^--$/, ""), destinatario: txt(f, cDest), cuentaDeposito: txt(f, cCuenta),
    });
  }

  // Repetidos dentro del mismo archivo: error a avisar (nunca bloquea).
  const porId = new Map<string, EcheqReporteFila[]>(), porNumero = new Map<string, EcheqReporteFila[]>();
  for (const x of out.filas) {
    porId.set(x.cheqId, [...(porId.get(x.cheqId) || []), x]);
    const k = numeroCheque(x.numero);
    porNumero.set(k, [...(porNumero.get(k) || []), x]);
  }
  for (const [id, xs] of porId) if (xs.length > 1) out.advertencias.push(`El CheqID ${id} está ${xs.length} veces en el archivo (cheque ${xs[0].numero}).`);
  for (const [n, xs] of porNumero) {
    const ids = new Set(xs.map((x) => x.cheqId));
    if (xs.length > 1 && ids.size > 1) out.advertencias.push(`El N° de cheque ${n} aparece ${xs.length} veces con distinto CheqID (${xs.map((x) => `${x.bancoEmisor || "banco ?"} $${x.monto}`).join(" · ")}): son cheques distintos con el mismo número.`);
  }
  if (out.tipo === "emitidos" && out.filas.length === TOPE_EMITIDOS) out.advertencias.push(`El archivo trae exactamente ${TOPE_EMITIDOS} cheques emitidos: puede estar cortado (el banco baja de a ${TOPE_EMITIDOS}).`);
  return out;
}

/** Un cheque listo para aplicar con la función de base aplicar_reporte_echeqs. */
export interface ItemAplicar {
  cheq_id: string; numero: string; monto: number; direccion: string; estado_banco: string; banco_emisor: string; archivo: string;
}

/**
 * Une los reportes de una misma carga: si un mismo CheqID viene con estados distintos, no se aplica (se avisa).
 * La usan Bancos > Cheques, Bancos > Movimientos (todos los archivos juntos) y los scripts de carga.
 */
export function armarItemsEcheq(reportes: EcheqReporte[]): { items: ItemAplicar[]; avisos: string[] } {
  const avisos: string[] = [];
  const por = new Map<string, Array<{ fila: EcheqReporteFila; r: EcheqReporte }>>();
  for (const r of reportes) {
    if (!r.direccion) continue;
    for (const fila of r.filas) por.set(fila.cheqId, [...(por.get(fila.cheqId) || []), { fila, r }]);
  }
  const items: ItemAplicar[] = [];
  for (const [id, xs] of por) {
    const estados = new Set(xs.map((x) => x.fila.estadoBanco));
    if (estados.size > 1) {
      avisos.push(`El cheque ${xs[0].fila.numero} (CheqID ${id}) viene con estados distintos en esta carga (${xs.map((x) => `${x.fila.estadoBanco} en ${x.r.archivo}`).join(" · ")}): no se aplica.`);
      continue;
    }
    const { fila, r } = xs[0];
    items.push({ cheq_id: id, numero: fila.numero, monto: fila.monto, direccion: r.direccion!, estado_banco: fila.estadoBanco, banco_emisor: fila.bancoEmisor, archivo: r.archivo });
  }
  return { items, avisos };
}
