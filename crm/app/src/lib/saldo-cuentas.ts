// Saldos de las cuentas de Finanzas (bancos, FCI, efectivo, tarjetas y cheques).
// - Banco / FCI / efectivo: saldo al corte + ingresos − egresos con fecha posterior al corte.
// - Cheques en cartera y emitidos a pagar: se calculan con la lista de cheques (no usan saldo al corte).
// - Tarjetas: van por resumen mensual (etapa 3); por ahora no suman.
import { clasificarMovimiento, type MovimientoClasificable } from "./tipos-movimiento";

export type TipoCuenta =
  | "cuenta_corriente" | "caja_ahorro" | "fci" | "tarjeta_credito" | "efectivo" | "cheques_cartera" | "cheques_emitidos";

export const TIPO_CUENTA_LABEL: Record<TipoCuenta, string> = {
  cuenta_corriente: "Cuenta corriente",
  caja_ahorro: "Caja de ahorro",
  fci: "Fondo común de inversión",
  tarjeta_credito: "Tarjeta de crédito",
  efectivo: "Efectivo",
  cheques_cartera: "Cheques en cartera",
  cheques_emitidos: "Cheques emitidos a pagar",
};

export interface CuentaFinanciera {
  id: string;
  nombre: string;
  tipo: TipoCuenta;
  moneda: "ARS" | "USD";
  fecha_corte: string;
  saldo_inicial: number | string | null;
  acuerdo?: number | string | null;
  activa?: boolean | null;
}

export interface MovimientoCuenta extends MovimientoClasificable {
  cuenta_id?: string | null;
  fecha: string;
  monto: number | string | null;
  moneda?: string | null;
}

export interface ChequeCuenta {
  direccion: string;
  estado: string;
  monto: number | string | null;
  moneda?: string | null;
  fecha_pago?: string | null;
}

export interface VencimientosCheques { vencidos: number; proximos7: number; restoMes: number; despues: number }

export interface SaldoCuenta {
  saldo: number;
  /** Banco / FCI / efectivo sin saldo al corte cargado. */
  faltaSaldoInicial: boolean;
  ingresos: number;
  egresos: number;
  cantidadMovimientos: number;
  /** Cuentas corrientes: saldo + acuerdo. */
  disponibleConAcuerdo: number | null;
  /** Solo cuentas de cheques. */
  cantidadCheques?: number;
  vencimientos?: VencimientosCheques;
  /** Cheques en cartera: depositados que todavía no se acreditaron. */
  depositados?: number;
}

export interface TotalesCuentas {
  /** Banco + FCI + efectivo. */
  disponible: number;
  chequesCartera: number;
  chequesDepositados: number;
  comprometidoEmitidos: number;
  deudaTarjetas: number;
}

export interface SinCuenta { cantidad: number; ingresos: number; egresos: number }

export interface ResultadoCuentas {
  porCuenta: Record<string, SaldoCuenta>;
  totales: Record<"ARS" | "USD", TotalesCuentas>;
  /** Movimientos posteriores al corte que todavía no tienen cuenta (se asignan al cruzar con el extracto). */
  sinCuenta: Record<"ARS" | "USD", SinCuenta>;
}

const n = (v: number | string | null | undefined) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const mon = (v: string | null | undefined): "ARS" | "USD" => (v === "USD" ? "USD" : "ARS");
const usaMovimientos = (t: TipoCuenta) => t === "cuenta_corriente" || t === "caja_ahorro" || t === "fci" || t === "efectivo";

/**
 * Grupo de cuenta que se sugiere para un movimiento nuevo.
 * Es la misma regla que el trigger lz_cuenta_sugerida_movimiento de la base.
 */
export function grupoCuentaSugerido(m: MovimientoClasificable): "banco" | "efectivo" | "tarjeta_credito" | "cheques_cartera" | "cheques_emitidos" | null {
  if (m.anulado || m.nota_credito_compra_id) return null;
  if (/^\s*\[Ajuste manual\]/i.test(String(m.descripcion || ""))) return null;
  const tipo = String(m.tipo || "");
  const cliente = Boolean(m.cliente_id);
  const proveedor = Boolean(m.proveedor_id);
  if (tipo.startsWith("retencion_") || tipo === "ajuste") return null;
  if (tipo === "cheque_recibido") return "cheques_cartera";
  if (tipo === "cheque_emitido") return "cheques_emitidos";
  if (tipo === "echeq") return proveedor && !cliente ? "cheques_emitidos" : "cheques_cartera";
  if (tipo === "efectivo") return "efectivo";
  if (tipo === "tarjeta") return proveedor && !cliente ? "tarjeta_credito" : "banco";
  if (["transferencia", "deposito", "cobro", "pago"].includes(tipo)) return "banco";
  return null;
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function vencimientos(cheques: ChequeCuenta[], hoy: string): VencimientosCheques {
  const en7 = sumarDias(hoy, 7);
  const finMes = `${hoy.slice(0, 7)}-31`;
  const v: VencimientosCheques = { vencidos: 0, proximos7: 0, restoMes: 0, despues: 0 };
  for (const c of cheques) {
    const f = String(c.fecha_pago || "").slice(0, 10);
    const monto = n(c.monto);
    if (!f) v.despues += monto;
    else if (f < hoy) v.vencidos += monto;
    else if (f <= en7) v.proximos7 += monto;
    else if (f <= finMes) v.restoMes += monto;
    else v.despues += monto;
  }
  return { vencidos: r2(v.vencidos), proximos7: r2(v.proximos7), restoMes: r2(v.restoMes), despues: r2(v.despues) };
}

const totalesVacios = (): TotalesCuentas => ({ disponible: 0, chequesCartera: 0, chequesDepositados: 0, comprometidoEmitidos: 0, deudaTarjetas: 0 });

export function calcularSaldosCuentas(
  cuentas: CuentaFinanciera[],
  movimientos: MovimientoCuenta[],
  cheques: ChequeCuenta[],
  hoy: string,
): ResultadoCuentas {
  const activas = cuentas.filter((c) => c.activa !== false);
  const porId = new Map(activas.map((c) => [c.id, c]));
  const porCuenta: Record<string, SaldoCuenta> = {};
  for (const c of activas) {
    const faltaSaldoInicial = usaMovimientos(c.tipo) && (c.saldo_inicial === null || c.saldo_inicial === undefined || c.saldo_inicial === "");
    porCuenta[c.id] = {
      saldo: usaMovimientos(c.tipo) ? n(c.saldo_inicial) : 0,
      faltaSaldoInicial,
      ingresos: 0,
      egresos: 0,
      cantidadMovimientos: 0,
      disponibleConAcuerdo: null,
    };
  }

  const corteGeneral = activas.map((c) => c.fecha_corte).sort()[0] || "2026-08-31";
  const sinCuenta: Record<"ARS" | "USD", SinCuenta> = { ARS: { cantidad: 0, ingresos: 0, egresos: 0 }, USD: { cantidad: 0, ingresos: 0, egresos: 0 } };

  for (const m of movimientos) {
    const fecha = String(m.fecha || "").slice(0, 10);
    const clase = clasificarMovimiento(m);
    if (clase !== "ingreso" && clase !== "egreso") continue;
    const monto = n(m.monto);
    const cuenta = m.cuenta_id ? porId.get(m.cuenta_id) : undefined;
    if (!cuenta) {
      if (m.cuenta_id || fecha <= corteGeneral) continue; // cuenta inactiva/ajena, o anterior al corte
      const s = sinCuenta[mon(m.moneda)];
      s.cantidad += 1;
      if (clase === "ingreso") s.ingresos += monto; else s.egresos += monto;
      continue;
    }
    if (!usaMovimientos(cuenta.tipo) || fecha <= cuenta.fecha_corte) continue;
    const s = porCuenta[cuenta.id];
    s.cantidadMovimientos += 1;
    if (clase === "ingreso") { s.ingresos += monto; s.saldo += monto; } else { s.egresos += monto; s.saldo -= monto; }
  }

  const recibidosCartera = cheques.filter((c) => c.direccion === "recibido" && c.estado === "en_cartera");
  const recibidosDepositados = cheques.filter((c) => c.direccion === "recibido" && c.estado === "depositado");
  const emitidosAPagar = cheques.filter((c) => c.direccion === "emitido" && (c.estado === "pendiente" || c.estado === "entregado"));

  const totales: Record<"ARS" | "USD", TotalesCuentas> = { ARS: totalesVacios(), USD: totalesVacios() };

  for (const c of activas) {
    const s = porCuenta[c.id];
    if (c.tipo === "cheques_cartera") {
      const propios = recibidosCartera.filter((ch) => mon(ch.moneda) === c.moneda);
      const dep = recibidosDepositados.filter((ch) => mon(ch.moneda) === c.moneda);
      s.saldo = propios.reduce((a, ch) => a + n(ch.monto), 0);
      s.cantidadCheques = propios.length;
      s.vencimientos = vencimientos(propios, hoy);
      s.depositados = r2(dep.reduce((a, ch) => a + n(ch.monto), 0));
    } else if (c.tipo === "cheques_emitidos") {
      const propios = emitidosAPagar.filter((ch) => mon(ch.moneda) === c.moneda);
      s.saldo = propios.reduce((a, ch) => a + n(ch.monto), 0);
      s.cantidadCheques = propios.length;
      s.vencimientos = vencimientos(propios, hoy);
    }
    s.saldo = r2(s.saldo);
    s.ingresos = r2(s.ingresos);
    s.egresos = r2(s.egresos);
    if (c.tipo === "cuenta_corriente") s.disponibleConAcuerdo = r2(s.saldo + n(c.acuerdo));

    const t = totales[c.moneda];
    if (usaMovimientos(c.tipo)) t.disponible += s.saldo;
    else if (c.tipo === "cheques_cartera") { t.chequesCartera += s.saldo; t.chequesDepositados += s.depositados || 0; }
    else if (c.tipo === "cheques_emitidos") t.comprometidoEmitidos += s.saldo;
  }

  for (const k of ["ARS", "USD"] as const) {
    const t = totales[k];
    totales[k] = { disponible: r2(t.disponible), chequesCartera: r2(t.chequesCartera), chequesDepositados: r2(t.chequesDepositados), comprometidoEmitidos: r2(t.comprometidoEmitidos), deudaTarjetas: r2(t.deudaTarjetas) };
    sinCuenta[k] = { cantidad: sinCuenta[k].cantidad, ingresos: r2(sinCuenta[k].ingresos), egresos: r2(sinCuenta[k].egresos) };
  }

  return { porCuenta, totales, sinCuenta };
}

export interface SugerenciaCuenta {
  /** rescatar_fci: alcanza el FCI. falta_plata: no alcanza (monto = lo que falta después de rescatar todo el FCI). */
  tipo: "rescatar_fci" | "falta_plata";
  cuentaId: string;
  /** FCI de donde sale la plata. */
  desdeId?: string;
  monto: number;
  saldo: number;
  /** Cheques emitidos que se debitan en los próximos 7 días o ya vencidos sin debitar. */
  chequesProximos: number;
}

/** Redondea para arriba a los $1.000 (cubre comisiones e impuestos chicos). */
const redondearArriba = (v: number) => Math.ceil(v / 1000) * 1000;

/**
 * Qué conviene hacer con la plata hoy (siempre sugerencias, nunca frena nada):
 * - Cuenta corriente en negativo → rescatar del FCI para dejarla en 0 y no pagar intereses.
 * - En la cuenta principal, además, cubrir los cheques emitidos que se debitan en los próximos 7 días (o ya vencidos).
 * Si el FCI no alcanza, avisa cuánto falta.
 */
export function sugerenciasCuentas(
  cuentas: Array<CuentaFinanciera & { predeterminada?: boolean | null }>,
  resultado: ResultadoCuentas,
): SugerenciaCuenta[] {
  const activas = cuentas.filter((c) => c.activa !== false);
  const saldoDe = (id: string) => resultado.porCuenta[id]?.saldo || 0;
  const fcis = activas.filter((c) => c.tipo === "fci" && c.moneda === "ARS" && saldoDe(c.id) > 0).sort((a, b) => saldoDe(b.id) - saldoDe(a.id));
  let disponibleFci = fcis.reduce((a, c) => a + saldoDe(c.id), 0);
  const emitidos = activas.find((c) => c.tipo === "cheques_emitidos" && c.moneda === "ARS");
  const venc = emitidos ? resultado.porCuenta[emitidos.id]?.vencimientos : undefined;
  const aDebitar7 = venc ? r2(venc.vencidos + venc.proximos7) : 0;
  const corrientes = activas.filter((c) => c.tipo === "cuenta_corriente" && c.moneda === "ARS");
  const principal = corrientes.find((c) => c.predeterminada) || corrientes[0];

  const out: SugerenciaCuenta[] = [];
  for (const c of corrientes) {
    const s = resultado.porCuenta[c.id];
    if (!s || s.faltaSaldoInicial) continue;
    const chequesProximos = c.id === principal?.id ? aDebitar7 : 0;
    const necesario = r2(chequesProximos - s.saldo);
    if (necesario <= 0.005) continue;
    const base = { cuentaId: c.id, desdeId: fcis[0]?.id, saldo: s.saldo, chequesProximos };
    if (fcis.length && disponibleFci >= necesario) {
      const monto = Math.min(redondearArriba(necesario), r2(disponibleFci));
      disponibleFci = r2(disponibleFci - monto);
      out.push({ ...base, tipo: "rescatar_fci", monto });
    } else {
      out.push({ ...base, tipo: "falta_plata", monto: r2(necesario - disponibleFci) });
      disponibleFci = 0;
    }
  }
  return out;
}
