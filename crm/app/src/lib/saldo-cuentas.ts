// Saldos de las cuentas de Finanzas (bancos, FCI, efectivo, tarjetas y cheques).
// - Banco / FCI / efectivo: saldo al corte + ingresos − egresos con fecha posterior al corte.
// - Con extracto importado: el saldo es el del banco (saldo_banco) + lo del CRM posterior al extracto.
// - Pases del extracto (FCI, entre cuentas): suman o restan en la otra cuenta.
//   Las extracciones de efectivo NO suman a la caja: el efectivo es solo lo que carga Augusto (regla de Augusto, 11/10/2026).
// - FCI: el saldo es el del banco (saldo_banco, se actualiza con cada extracto). No se estima el interés:
//   lo que generó por mes sale del extracto de la custodia (lib/fci-custodia.ts).
// - Cheques en cartera y emitidos a pagar: se calculan con la lista de cheques (no usan saldo al corte).
// - Tarjetas: van por resumen mensual (etapa 3); por ahora no suman.
import { clasificarMovimiento, type MovimientoClasificable } from "./tipos-movimiento";
import { diaHabilAnterior, diaHabilDesde, lunesDeLaSemana, sumarDias } from "./dias-habiles";

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
  /** Último saldo del extracto importado y su fecha (etapa 2). */
  saldo_banco?: number | string | null;
  saldo_banco_fecha?: string | null;
}

/** Línea del extracto que es un pase hacia otra cuenta (FCI, entre cuentas, efectivo). */
export interface PaseCuenta {
  /** La otra cuenta (contra_cuenta_id de la línea). */
  cuenta_id: string;
  fecha: string;
  /** Visto desde la otra cuenta: + entra, − sale (es el importe de la línea con el signo cambiado). */
  importe: number;
}

export interface MovimientoCuenta extends MovimientoClasificable {
  cuenta_id?: string | null;
  fecha: string;
  monto: number | string | null;
  moneda?: string | null;
  /**
   * Pagos de una OP: la parte que sale de la cuenta ese día (transferencias). Lo pagado con cheques propios
   * sale cuando se debita el cheque, y lo pagado con tarjeta va por el resumen. Sin dato = el monto entero.
   */
  montoCuenta?: number | null;
}

/** Medios de una OP que mueven la cuenta el mismo día (el resto: cheques, tarjeta, efectivo, va por otro lado). */
const MEDIOS_DE_CUENTA = new Set(["transferencia", "deposito", "debito"]);

/** Parte de una OP que sale de la cuenta bancaria ese día, según sus medios de pago. Sin medios → null (se usa el monto). */
export function montoCuentaDeOp(medios: unknown): number | null {
  let lista: Array<{ tipo?: string; monto?: number | string }> = [];
  try { lista = typeof medios === "string" ? JSON.parse(medios || "[]") : Array.isArray(medios) ? medios : []; } catch { lista = []; }
  const conMonto = lista.filter((x) => n(x?.monto) > 0.005);
  if (!conMonto.length) return null;
  return r2(conMonto.filter((x) => MEDIOS_DE_CUENTA.has(String(x.tipo || "").toLowerCase())).reduce((a, x) => a + n(x.monto), 0));
}

export interface ChequeCuenta {
  direccion: string;
  estado: string;
  monto: number | string | null;
  moneda?: string | null;
  fecha_pago?: string | null;
}

export interface VencimientosCheques { vencidos: number; proximos7: number; restoMes: number; despues: number }

/** Cheques propios que se debitan un mismo día hábil. */
export interface DebitoDia {
  /** Día hábil en que se debita (si vence un feriado o fin de semana, el hábil siguiente). */
  fecha: string;
  monto: number;
  cantidad: number;
  /** Ya pasó su día de débito y el cheque sigue a pagar (¿ya se debitó y falta marcarlo?). */
  atrasado: boolean;
}

export interface SaldoCuenta {
  saldo: number;
  /** Banco / FCI / efectivo sin saldo al corte cargado. */
  faltaSaldoInicial: boolean;
  ingresos: number;
  egresos: number;
  cantidadMovimientos: number;
  /** Cuentas corrientes: saldo + acuerdo. */
  disponibleConAcuerdo: number | null;
  /** El saldo sale del extracto del banco (al cierre de esta fecha). */
  segunBanco?: string | null;
  /** Pases del extracto que movieron esta cuenta (FCI, entre cuentas). */
  pases?: number;
  /** Solo cuentas de cheques. */
  cantidadCheques?: number;
  vencimientos?: VencimientosCheques;
  /** Cheques emitidos a pagar, agrupados por día de débito. */
  debitos?: DebitoDia[];
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

function agruparDebitos(cheques: ChequeCuenta[], hoy: string): DebitoDia[] {
  const porDia = new Map<string, DebitoDia>();
  for (const c of cheques) {
    const f = String(c.fecha_pago || "").slice(0, 10);
    if (!f) continue;
    // Atrasado = ya pasó el día hábil en que se tenía que debitar (un cheque del sábado se debita el lunes hábil).
    const debito = diaHabilDesde(f);
    const atrasado = debito < hoy;
    const fecha = atrasado ? f : debito;
    const k = `${fecha}|${atrasado}`;
    const d = porDia.get(k) || { fecha, monto: 0, cantidad: 0, atrasado };
    d.monto += n(c.monto);
    d.cantidad += 1;
    porDia.set(k, d);
  }
  return [...porDia.values()].map((d) => ({ ...d, monto: r2(d.monto) })).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

const totalesVacios = (): TotalesCuentas => ({ disponible: 0, chequesCartera: 0, chequesDepositados: 0, comprometidoEmitidos: 0, deudaTarjetas: 0 });

export function calcularSaldosCuentas(
  cuentas: CuentaFinanciera[],
  movimientos: MovimientoCuenta[],
  cheques: ChequeCuenta[],
  hoy: string,
  pases: PaseCuenta[] = [],
): ResultadoCuentas {
  const activas = cuentas.filter((c) => c.activa !== false);
  const porId = new Map(activas.map((c) => [c.id, c]));
  const porCuenta: Record<string, SaldoCuenta> = {};
  for (const c of activas) {
    const conBanco = usaMovimientos(c.tipo) && Boolean(c.saldo_banco_fecha) && c.saldo_banco !== null && c.saldo_banco !== undefined && c.saldo_banco !== "";
    const faltaSaldoInicial = !conBanco && usaMovimientos(c.tipo) && (c.saldo_inicial === null || c.saldo_inicial === undefined || c.saldo_inicial === "");
    porCuenta[c.id] = {
      saldo: conBanco ? n(c.saldo_banco) : usaMovimientos(c.tipo) ? n(c.saldo_inicial) : 0,
      faltaSaldoInicial,
      ingresos: 0,
      egresos: 0,
      cantidadMovimientos: 0,
      disponibleConAcuerdo: null,
      segunBanco: conBanco ? String(c.saldo_banco_fecha).slice(0, 10) : null,
    };
  }
  /** Desde qué fecha (exclusive) suman los movimientos: el extracto si hay, si no el corte. */
  const desdeDe = (c: CuentaFinanciera) => {
    const b = porCuenta[c.id]?.segunBanco;
    return b && b > c.fecha_corte ? b : c.fecha_corte;
  };

  const corteGeneral = activas.map((c) => c.fecha_corte).sort()[0] || "2026-08-31";
  const sinCuenta: Record<"ARS" | "USD", SinCuenta> = { ARS: { cantidad: 0, ingresos: 0, egresos: 0 }, USD: { cantidad: 0, ingresos: 0, egresos: 0 } };

  for (const m of movimientos) {
    const fecha = String(m.fecha || "").slice(0, 10);
    const clase = clasificarMovimiento(m);
    if (clase !== "ingreso" && clase !== "egreso") continue;
    const cuenta = m.cuenta_id ? porId.get(m.cuenta_id) : undefined;
    // Bancos y efectivo: solo lo que sale ese día (una OP pagada con eCheq sale cuando se debita el cheque).
    const monto = m.montoCuenta === null || m.montoCuenta === undefined ? n(m.monto) : n(m.montoCuenta);
    if (!cuenta) {
      if (m.cuenta_id || fecha <= corteGeneral) continue; // cuenta inactiva/ajena, o anterior al corte
      // Solo importa lo que mueve un banco o la caja. Retenciones, ajustes, cheques (van por la lista de cheques),
      // tarjetas (van por resumen) y OPs pagadas todo con cheques o tarjeta no necesitan cuenta.
      const grupo = grupoCuentaSugerido(m);
      if ((grupo !== "banco" && grupo !== "efectivo") || monto <= 0.005) continue;
      const s = sinCuenta[mon(m.moneda)];
      s.cantidad += 1;
      if (clase === "ingreso") s.ingresos += monto; else s.egresos += monto;
      continue;
    }
    if (!usaMovimientos(cuenta.tipo) || fecha <= desdeDe(cuenta) || monto <= 0.005) continue;
    const s = porCuenta[cuenta.id];
    s.cantidadMovimientos += 1;
    if (clase === "ingreso") { s.ingresos += monto; s.saldo += monto; } else { s.egresos += monto; s.saldo -= monto; }
  }

  for (const p of pases) {
    const cuenta = porId.get(p.cuenta_id);
    // Efectivo: lo que se extrae del banco no se supone en la caja (puede haberse gastado o ser personal).
    if (!cuenta || !usaMovimientos(cuenta.tipo) || cuenta.tipo === "efectivo" || String(p.fecha).slice(0, 10) <= desdeDe(cuenta)) continue;
    const s = porCuenta[cuenta.id];
    const importe = n(p.importe);
    s.saldo += importe;
    s.pases = r2((s.pases || 0) + importe);
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
      s.debitos = agruparDebitos(propios, hoy);
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
  /** Cheques emitidos que hay que tener cubiertos hoy: se debitan el próximo día hábil (o antes) o están atrasados. */
  chequesProximos: number;
  /** Último día de débito que cubre el rescate. */
  debitoHasta?: string | null;
}

/** Redondea para arriba a los $1.000 (cubre comisiones e impuestos chicos). */
const redondearArriba = (v: number) => Math.ceil(v / 1000) * 1000;

/** Día en que conviene rescatar del FCI para un débito: el día hábil anterior (la plata queda en el fondo hasta último momento). */
export const diaDeRescate = (fechaDebito: string) => diaHabilAnterior(fechaDebito);

/** Débitos que ya hay que tener cubiertos hoy: atrasados o con día de rescate hoy o antes. */
export const debitosACubrir = (debitos: DebitoDia[], hoy: string) => debitos.filter((d) => d.atrasado || diaDeRescate(d.fecha) <= hoy);

/**
 * Qué conviene hacer con la plata hoy (siempre sugerencias, nunca frena nada):
 * - Cuenta corriente en negativo → rescatar del FCI para dejarla en 0 y no pagar intereses.
 * - En la cuenta principal, además, cubrir los cheques emitidos que se debitan el próximo día hábil (o atrasados):
 *   la plata vive en el FCI y se rescata un día hábil antes de cada débito.
 * Si el FCI no alcanza, avisa cuánto falta.
 */
export function sugerenciasCuentas(
  cuentas: Array<CuentaFinanciera & { predeterminada?: boolean | null }>,
  resultado: ResultadoCuentas,
  hoy: string,
): SugerenciaCuenta[] {
  const activas = cuentas.filter((c) => c.activa !== false);
  const saldoDe = (id: string) => resultado.porCuenta[id]?.saldo || 0;
  const fcis = activas.filter((c) => c.tipo === "fci" && c.moneda === "ARS" && saldoDe(c.id) > 0).sort((a, b) => saldoDe(b.id) - saldoDe(a.id));
  let disponibleFci = fcis.reduce((a, c) => a + saldoDe(c.id), 0);
  const emitidos = activas.find((c) => c.tipo === "cheques_emitidos" && c.moneda === "ARS");
  const aCubrir = debitosACubrir((emitidos && resultado.porCuenta[emitidos.id]?.debitos) || [], hoy);
  const aDebitar = r2(aCubrir.reduce((a, d) => a + d.monto, 0));
  const debitoHasta = aCubrir.filter((d) => !d.atrasado).map((d) => d.fecha).sort().pop() || null;
  const corrientes = activas.filter((c) => c.tipo === "cuenta_corriente" && c.moneda === "ARS");
  const principal = corrientes.find((c) => c.predeterminada) || corrientes[0];

  const out: SugerenciaCuenta[] = [];
  for (const c of corrientes) {
    const s = resultado.porCuenta[c.id];
    if (!s || s.faltaSaldoInicial) continue;
    const esPrincipal = c.id === principal?.id;
    const chequesProximos = esPrincipal ? aDebitar : 0;
    const necesario = r2(chequesProximos - s.saldo);
    if (necesario <= 0.005) continue;
    const base = { cuentaId: c.id, desdeId: fcis[0]?.id, saldo: s.saldo, chequesProximos, debitoHasta: esPrincipal ? debitoHasta : null };
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

export interface SemanaDebitos {
  /** Lunes y domingo de la semana. */
  desde: string;
  hasta: string;
  monto: number;
  cantidad: number;
  /** Días de débito de la semana, con el día en que conviene rescatar. */
  dias: Array<DebitoDia & { rescatarEl: string }>;
}

/** Lo que se debita cada semana (desde la actual), más lo atrasado y lo posterior. */
export function debitosPorSemana(debitos: DebitoDia[], hoy: string, semanas = 6): { atrasado: number; semanas: SemanaDebitos[]; despues: number } {
  const lunes = lunesDeLaSemana(hoy);
  const lista: SemanaDebitos[] = Array.from({ length: semanas }, (_, i) => ({
    desde: sumarDias(lunes, i * 7), hasta: sumarDias(lunes, i * 7 + 6), monto: 0, cantidad: 0, dias: [],
  }));
  let atrasado = 0;
  let despues = 0;
  for (const d of debitos) {
    if (d.atrasado) { atrasado += d.monto; continue; }
    const sem = lista.find((w) => d.fecha >= w.desde && d.fecha <= w.hasta);
    if (!sem) { despues += d.monto; continue; }
    sem.monto += d.monto;
    sem.cantidad += d.cantidad;
    sem.dias.push({ ...d, rescatarEl: diaDeRescate(d.fecha) });
  }
  return { atrasado: r2(atrasado), semanas: lista.map((w) => ({ ...w, monto: r2(w.monto) })), despues: r2(despues) };
}
