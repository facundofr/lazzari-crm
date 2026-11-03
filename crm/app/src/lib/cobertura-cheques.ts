// Cobertura de los cheques propios (25/10/2026, Augusto): cuánta plata hace falta en la cuenta corriente para pagar los cheques que el banco puede debitar,
// contra el saldo del último extracto cargado. Es un aviso: nunca bloquea nada ni mueve plata.
// Sale de la CC "EPP" (091-312483/1). Los 2 cheques que salen de la CC "INDU" (091-318933/7) se calculan aparte: ya no se emiten cheques de esa cuenta,
// por eso se identifican por su número (si algún día se vuelve a emitir de ahí, hay que guardar la cuenta de cada cheque). Prueba: scripts/test-cobertura-cheques.ts
import { chequePendiente, type ChequeParaPlazo } from "./cheques-plazo";
import { codigoDeConcepto, familiaDeCodigo } from "./bbva-codigos";

/** Cheques propios que salen de la CC INDU (091-318933/7), sin ceros adelante. */
export const CHEQUES_CC_INDU = new Set(["90000172", "90000173"]);
/** Estados del banco que significan "ya está en camino de cobrarse". */
const EN_TRAMITE = new Set(["PRESENTADO", "DEPOSITADO"]);

export interface ChequeCobertura extends ChequeParaPlazo { numero: string; estadoBanco?: string | null }
export interface Tramo { cantidad: number; total: number }
export interface Bloque {
  total: number; cantidad: number;
  /** Presentados o depositados según el banco. */
  enTramite: Tramo;
  /** Todavía sin presentar (o sin estado del banco). */
  sinPresentar: Tramo;
}
export interface Cobertura {
  hoy: Bloque;
  proximos7: Bloque;
  /** Abiertos en el CRM que el banco YA debitó (línea de débito en el extracto o PAGADO según el banco): ya están restados del saldo, no se cuentan. */
  yaDebitados: Tramo;
  indu: { cheques: Array<{ numero: string; monto: number; fecha_pago: string }>; total: number };
}

const sinCeros = (n: string) => String(n || "").trim().replace(/^0+/, "");
const r2 = (v: number) => Math.round(v * 100) / 100;
const masDias = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const vacio = (): Bloque => ({ total: 0, cantidad: 0, enTramite: { cantidad: 0, total: 0 }, sinPresentar: { cantidad: 0, total: 0 } });

/**
 * Números de cheques propios que el banco ya debitó según el extracto (25/10/2026): líneas de débito de cheque (códigos 005/016, o el texto
 * "CH/CLEAR", "CJE. INTERNO", "PAGO CHEQUE"). El número va como " N 90017348" o al final del texto ("PAGO CHEQUE 24HS 90017218").
 */
export function numerosDebitados(lineas: Array<{ descripcion: string | null; tipo?: string | null }>): Set<string> {
  const out = new Set<string>();
  for (const l of lineas) {
    if (l.tipo && l.tipo !== "debito") continue;
    const d = String(l.descripcion || "");
    const esDebitoCheque = familiaDeCodigo(codigoDeConcepto(d)) === "cheque_debito" || /^(CH\/CLEAR|CJE\. INTERNO|PAGO CHEQUE|CHEQUE)/i.test(d.trim());
    if (!esDebitoCheque) continue;
    const m = d.match(/ N (\d{1,8})(?:\s|$)/) || d.replace(/\s*#\d{3}\s*$/, "").match(/(\d{7,8})\s*$/);
    if (m) out.add(sinCeros(m[1]));
  }
  return out;
}

/**
 * N° de cheques propios que el banco ya debitó según el extracto de las cuentas corrientes (últimos 90 días). La usan todas las
 * pantallas de "a cubrir" (P07). Si no se puede leer, ninguno (nunca frena: el cheque se sigue mostrando a cubrir).
 */
export async function leerChequesDebitados(db: any, sociedadId: string, hoy: string): Promise<Set<string>> {
  try {
    const { data: cs } = await db.from("cuentas_financieras").select("id").eq("sociedad_id", sociedadId).eq("tipo", "cuenta_corriente");
    const ids = ((cs || []) as { id: string }[]).map((c) => c.id);
    if (!ids.length) return new Set();
    const desde = masDias(hoy, -90);
    const { data } = await db.from("extracto_movimientos").select("descripcion, tipo").in("cuenta_id", ids).eq("tipo", "debito").gte("fecha", desde).limit(5000);
    return numerosDebitados((data || []) as Array<{ descripcion: string | null; tipo: string }>);
  } catch {
    return new Set();
  }
}

export function coberturaCheques(cheques: ChequeCobertura[], hoy: string, debitados: Set<string> = new Set()): Cobertura {
  const out: Cobertura = { hoy: vacio(), proximos7: vacio(), yaDebitados: { cantidad: 0, total: 0 }, indu: { cheques: [], total: 0 } };
  const limite7 = masDias(hoy, 7);
  for (const ch of cheques) {
    if (ch.direccion !== "emitido" || !chequePendiente(ch) || ch.moneda === "USD" || !ch.fecha_pago) continue;
    const fp = String(ch.fecha_pago).slice(0, 10), monto = Number(ch.monto) || 0;
    // Ya debitado por el banco aunque el CRM todavía no lo haya confirmado: la plata ya salió del saldo, no se resta de nuevo.
    if (debitados.has(sinCeros(ch.numero)) || String(ch.estadoBanco || "").toUpperCase() === "PAGADO") { out.yaDebitados.cantidad++; out.yaDebitados.total += monto; continue; }
    if (CHEQUES_CC_INDU.has(sinCeros(ch.numero))) { out.indu.cheques.push({ numero: sinCeros(ch.numero), monto, fecha_pago: fp }); out.indu.total += monto; continue; }
    const tramo = EN_TRAMITE.has(String(ch.estadoBanco || "").toUpperCase()) ? "enTramite" : "sinPresentar";
    for (const [b, hasta] of [[out.hoy, hoy], [out.proximos7, limite7]] as const) {
      if (fp > hasta) continue;
      b.total += monto; b.cantidad++; b[tramo].total += monto; b[tramo].cantidad++;
    }
  }
  for (const b of [out.hoy, out.proximos7]) { b.total = r2(b.total); b.enTramite.total = r2(b.enTramite.total); b.sinPresentar.total = r2(b.sinPresentar.total); }
  out.indu.total = r2(out.indu.total);
  out.yaDebitados.total = r2(out.yaDebitados.total);
  out.indu.cheques.sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago));
  return out;
}

/** Saldo − lo que hace falta: positivo = cubierto (sobra), negativo = falta. Sin saldo cargado devuelve null. */
export const sobraOFalta = (saldo: number | null | undefined, necesario: number): number | null =>
  saldo === null || saldo === undefined || !Number.isFinite(Number(saldo)) ? null : r2(Number(saldo) - necesario);

/** Días entre una fecha y hoy (para avisar que el saldo viene de un extracto viejo). */
export const diasDesde = (fecha: string | null | undefined, hoy: string): number | null =>
  fecha ? Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${String(fecha).slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null;
