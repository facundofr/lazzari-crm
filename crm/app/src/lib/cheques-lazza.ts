// Finanzas Lazza → Cheques (diseño de Augusto 19/10/2026): todos los cheques con todos los estados, resumen por estado,
// lo que está EN FECHA de pago y de cobro, y resumen por semana de las próximas 4 semanas. Solo informativo.
// "En fecha" usa la misma regla que Finanzas (lib/cheques-plazo). Prueba: npx tsx scripts/test-cheques-lazza.ts
import { chequePendiente, domingoDe, type ChequeParaPlazo } from "@/lib/cheques-plazo";

export interface ChequeFL extends ChequeParaPlazo {
  id: string;
  numero: string;
  direccion: "emitido" | "recibido";
  cubre_tercero?: string | null;
  /** Estado según el banco (reportes eCheq), tal cual; vacío si todavía no se cargó. */
  estadoBanco?: string | null;
}

/** Estado para mostrar (un emitido "cobrado" es uno que el banco ya debitó). */
export function estadoCheque(ch: Pick<ChequeFL, "direccion" | "estado">): { clave: string; label: string; tono: "naranja" | "azul" | "verde" | "rojo" | "gris" | "violeta" } {
  const e = ch.estado;
  if (e === "rechazado") return { clave: `${ch.direccion}:rechazado`, label: "Rechazado", tono: "rojo" };
  if (e === "anulado") return { clave: `${ch.direccion}:anulado`, label: "Anulado", tono: "gris" };
  if (ch.direccion === "emitido") {
    if (e === "pendiente" || e === "entregado") return { clave: "emitido:sin_debitar", label: "Emitido sin debitar", tono: "naranja" };
    if (e === "cobrado") return { clave: "emitido:debitado", label: "Debitado", tono: "verde" };
  } else {
    if (e === "en_cartera") return { clave: "recibido:en_cartera", label: "En cartera", tono: "azul" };
    if (e === "depositado") return { clave: "recibido:depositado", label: "Depositado", tono: "violeta" };
    if (e === "cobrado") return { clave: "recibido:cobrado", label: "Cobrado", tono: "verde" };
    if (e === "endosado") return { clave: "recibido:endosado", label: "Endosado", tono: "gris" };
  }
  return { clave: `${ch.direccion}:${e}`, label: e || "Sin estado", tono: "gris" };
}

export interface Total { cantidad: number; ARS: number; USD: number }
const vacio = (): Total => ({ cantidad: 0, ARS: 0, USD: 0 });
const sumar = (t: Total, ch: ChequeParaPlazo) => { t.cantidad += 1; t[ch.moneda === "USD" ? "USD" : "ARS"] += Number(ch.monto) || 0; };
const redondear = (t: Total) => { t.ARS = Math.round(t.ARS * 100) / 100; t.USD = Math.round(t.USD * 100) / 100; return t; };

/** Resumen por estado, en el orden en que se muestra (primero emitidos, después recibidos). */
export function resumenPorEstado(cheques: ChequeFL[]): Array<{ clave: string; label: string; tono: ReturnType<typeof estadoCheque>["tono"]; direccion: "emitido" | "recibido"; total: Total }> {
  const orden = ["emitido:sin_debitar", "emitido:debitado", "emitido:rechazado", "emitido:anulado", "recibido:en_cartera", "recibido:depositado", "recibido:cobrado", "recibido:endosado", "recibido:rechazado", "recibido:anulado"];
  const porClave = new Map<string, { clave: string; label: string; tono: ReturnType<typeof estadoCheque>["tono"]; direccion: "emitido" | "recibido"; total: Total }>();
  for (const ch of cheques) {
    const e = estadoCheque(ch);
    if (!porClave.has(e.clave)) porClave.set(e.clave, { ...e, direccion: ch.direccion, total: vacio() });
    sumar(porClave.get(e.clave)!.total, ch);
  }
  const pos = (k: string) => { const i = orden.indexOf(k); return i < 0 ? 99 : i; };
  return [...porClave.values()].map((x) => ({ ...x, total: redondear(x.total) })).sort((a, b) => pos(a.clave) - pos(b.clave));
}

/**
 * En fecha hoy: propios sin debitar con fecha de pago ≤ hoy (para pagar) y recibidos en cartera ≤ hoy (para cobrar).
 * Los recibidos que el banco ya tiene (depositados, presentados o en custodia) no van en "para cobrar", que es lo que
 * hay que depositar: van aparte, en `depositados` (auditoría UX 26/10/2026, arreglo 19).
 */
export function enFecha(cheques: ChequeFL[], hoy: string): { pagar: Total; cobrar: Total; depositados: Total } {
  const r = { pagar: vacio(), cobrar: vacio(), depositados: vacio() };
  for (const ch of cheques) {
    if (situacionPago(ch, hoy) !== "en_fecha") continue;
    sumar(ch.direccion === "emitido" ? r.pagar : depositadoSegunBanco(ch) ? r.depositados : r.cobrar, ch);
  }
  return { pagar: redondear(r.pagar), cobrar: redondear(r.cobrar), depositados: redondear(r.depositados) };
}

/** Estados del reporte de eCheq con los que el banco ya tiene el cheque recibido (arreglo 19; CUSTODIA, Augusto 27/10/2026). */
const YA_EN_EL_BANCO = ["DEPOSITADO", "PRESENTADO", "CUSTODIA"];

/** Recibido en cartera que, según el banco, ya está depositado, presentado o en custodia: sigue pendiente hasta que se acredita, pero ya no hay que depositarlo. */
export function depositadoSegunBanco(ch: Pick<ChequeFL, "direccion" | "estado" | "estadoBanco">): boolean {
  return ch.direccion === "recibido" && ch.estado === "en_cartera" && YA_EN_EL_BANCO.includes(String(ch.estadoBanco || "").trim().toUpperCase());
}

const masDias = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/**
 * En fecha (26/10/2026, Augusto): pendiente, con la fecha de pago ya llegada y hasta 30 días después (regla de los cheques:
 * que no se haya debitado en la fecha no es atraso; a los 30 días el cheque vence). Los recibidos que el banco ya tiene no
 * (arreglo 19): no hay que depositarlos.
 */
export function estaEnFecha(ch: ChequeFL, hoy: string): boolean {
  return situacionPago(ch, hoy) === "en_fecha" && !depositadoSegunBanco(ch);
}

/**
 * Fecha de pago de un cheque pendiente (columna "Pago" de Cheques, auditoría UX 26/10/2026, arreglo 6):
 * "en_fecha" desde la fecha de pago hasta 30 días después; "vencido" pasados los 30 días; null si no está pendiente o la fecha no llegó.
 */
export function situacionPago(ch: ChequeFL, hoy: string): "en_fecha" | "vencido" | null {
  if (!chequePendiente(ch) || !ch.fecha_pago) return null;
  const f = String(ch.fecha_pago).slice(0, 10);
  if (f > hoy) return null;
  return f >= masDias(hoy, -30) ? "en_fecha" : "vencido";
}

/** Próxima semana (26/10/2026, Augusto): los pendientes con fecha de pago de mañana a 7 días. */
export function proximaSemana(cheques: ChequeFL[], hoy: string): { desde: string; hasta: string; pagar: Total; cobrar: Total } {
  const r = { desde: masDias(hoy, 1), hasta: masDias(hoy, 7), pagar: vacio(), cobrar: vacio() };
  for (const ch of cheques) {
    if (!chequePendiente(ch) || !ch.fecha_pago) continue;
    const f = String(ch.fecha_pago).slice(0, 10);
    if (f >= r.desde && f <= r.hasta) sumar(ch.direccion === "emitido" ? r.pagar : r.cobrar, ch);
  }
  return { ...r, pagar: redondear(r.pagar), cobrar: redondear(r.cobrar) };
}

/**
 * Las próximas 4 semanas (sin lo que ya está en fecha): la 1ª va de mañana al domingo, las otras de lunes a domingo.
 * Pagar = propios sin debitar; cobrar = recibidos en cartera.
 */
export function proximasSemanas(cheques: ChequeFL[], hoy: string, cuantas = 4): Array<{ desde: string; hasta: string; pagar: Total; cobrar: Total }> {
  const semanas: Array<{ desde: string; hasta: string; pagar: Total; cobrar: Total }> = [];
  let desde = masDias(hoy, 1);
  let hasta = domingoDe(hoy);
  if (hasta < desde) hasta = masDias(hoy, 7); // hoy es domingo: la 1ª semana es la que arranca mañana
  for (let i = 0; i < cuantas; i++) {
    semanas.push({ desde, hasta, pagar: vacio(), cobrar: vacio() });
    desde = masDias(hasta, 1);
    hasta = masDias(hasta, 7);
  }
  for (const ch of cheques) {
    if (!chequePendiente(ch) || !ch.fecha_pago) continue;
    const f = String(ch.fecha_pago).slice(0, 10);
    const s = semanas.find((x) => f >= x.desde && f <= x.hasta);
    if (s) sumar(ch.direccion === "emitido" ? s.pagar : s.cobrar, ch);
  }
  return semanas.map((s) => ({ ...s, pagar: redondear(s.pagar), cobrar: redondear(s.cobrar) }));
}

/**
 * Orden de la lista (auditoría UX 26/10/2026, arreglo 19): primero lo pendiente, de la fecha de pago más cercana a la más
 * lejana (arriba lo que ya está en fecha); después el resto, del más nuevo al más viejo. Sin fecha de pago, al final.
 */
export function ordenCheques(a: ChequeFL, b: ChequeFL): number {
  const pa = chequePendiente(a), pb = chequePendiente(b);
  if (pa !== pb) return pa ? -1 : 1;
  const fa = String(a.fecha_pago || "").slice(0, 10), fb = String(b.fecha_pago || "").slice(0, 10);
  if (fa !== fb) {
    if (!fa || !fb) return fa ? -1 : 1;
    return (fa < fb ? -1 : 1) * (pa ? 1 : -1);
  }
  return a.numero.localeCompare(b.numero);
}

const sinCeros = (n: unknown) => String(n ?? "").trim().replace(/^0+/, "");
const centavos = (n: unknown) => Math.round((Number(n) || 0) * 100);

/** Una OP con sus medios de pago, como viene de la base (medios_pago puede venir como texto JSON). */
export interface OpMedios { id: string; numero: string; estado: string; fecha: string; medios: unknown }
export interface OpDelCheque { id: string; numero: string; fecha: string; anulada: boolean }

function mediosDeOp(medios: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(medios)) return medios;
  if (typeof medios !== "string" || !medios.trim()) return [];
  try { const x = JSON.parse(medios); return Array.isArray(x) ? x : []; } catch { return []; }
}

/**
 * En qué OP figura cada cheque (auditoría UX 26/10/2026, arreglo 20). El cheque no guarda su OP: el dato está en los medios
 * de la OP. Va por el id del cheque (cartera y propios ya cargados, desde la V1.1.585) o por N° (sin los ceros de adelante)
 * + importe exacto en un medio de cheque. No se mira el tipo del medio: las OP viejas (medios guardados como texto, ej.
 * OP-000009) anotaban "echeq" tanto los propios como los endosados. Primero las vigentes y después las anuladas (el cheque
 * de una OP anulada se puede usar en otra).
 */
export function opsDeCheques(cheques: Array<Pick<ChequeFL, "id" | "numero" | "monto">>, ops: OpMedios[]): Map<string, OpDelCheque[]> {
  const indice = new Map<string, OpDelCheque[]>();
  const agregar = (clave: string, op: OpDelCheque) => {
    const xs = indice.get(clave) || [];
    if (!xs.some((x) => x.id === op.id)) indice.set(clave, [...xs, op]);
  };
  for (const op of ops) {
    const o: OpDelCheque = { id: op.id, numero: String(op.numero ?? ""), fecha: String(op.fecha || "").slice(0, 10), anulada: op.estado === "anulada" };
    for (const m of mediosDeOp(op.medios)) {
      if (!["cheque_propio", "cheque", "echeq"].includes(String(m?.tipo || ""))) continue;
      if (m.echeq_id) agregar(`id:${m.echeq_id}`, o);
      if (sinCeros(m.numero_cheque)) agregar(`${sinCeros(m.numero_cheque)}|${centavos(m.monto)}`, o);
    }
  }
  const out = new Map<string, OpDelCheque[]>();
  for (const ch of cheques) {
    const xs = [...(indice.get(`id:${ch.id}`) || []), ...(indice.get(`${sinCeros(ch.numero)}|${centavos(ch.monto)}`) || [])];
    const unicas = xs.filter((x, i) => xs.findIndex((y) => y.id === x.id) === i)
      .sort((a, b) => Number(a.anulada) - Number(b.anulada) || b.fecha.localeCompare(a.fecha) || b.numero.localeCompare(a.numero));
    if (unicas.length) out.set(ch.id, unicas);
  }
  return out;
}

/**
 * ¿Lo que se escribió en un buscador es alguno de estos N° de cheque? (arreglo 20). Solo números. Parte del N° tal como
 * está guardado ("3587" encuentra "00003587") o el N° entero con otros ceros adelante ("00003587" encuentra "3587").
 * Con ceros adelante no busca partes: "00000074" no trae el "4074".
 */
export function coincideNumeroCheque(numeros: Array<string | null | undefined>, texto: string): boolean {
  const t = String(texto || "").trim();
  if (!/^\d+$/.test(t)) return false;
  const buscado = sinCeros(t);
  return numeros.some((n) => { const x = String(n || "").trim(); return !!x && (x.includes(t) || (!!buscado && sinCeros(x) === buscado)); });
}
