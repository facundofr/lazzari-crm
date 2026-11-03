/**
 * Contabilidad de gestión → Cashflow SEMANAL (Nati y Augusto, 28-29/10/2026). Etapa 1, tanda 2.
 * Por fecha de cobro o de pago (lo devengado es el Estado de resultados, lib/contabilidad). Cada sociedad por separado.
 *
 * - Semanas de lunes a domingo. Las pasadas son lo REAL: las líneas del extracto de los bancos en $ (la plata que entró y salió).
 *   El saldo inicial sale del saldo del extracto (Augusto 29/10), y cada semana suma lo que entró y resta lo que salió.
 * - Desde la semana de hoy, 12 semanas PROYECTADAS con doble columna (Nati 29/10): "Proy." (la foto del inicio del mes) y "Real".
 *   La foto se guarda sola la primera vez que se abre el Cashflow en el mes; si el mes todavía no tiene foto, "Proy." es lo de hoy.
 * - Proyectado: facturas de venta por vencimiento (lo vencido sin cobrar NO se cuenta, se avisa: no se sabe cuándo entra, como en
 *   Caja), cheques en cartera por fecha de pago, facturas de compra por vencimiento y cheques propios a cubrir (la regla de
 *   lib/cheques-lazza: fechaACubrir; lo atrasado se cuenta hoy), gastos fijos del mes sin pagar, (Lazzari) los premios del
 *   mes, que se pagan con el sueldo del mes siguiente, y el IIBB y tasas de cada mes (el % de las ventas, como en el Estado de resultados) el día 22 del mes siguiente (Augusto 29/10),
 *   menos el SIRCREB, las retenciones de IIBB y el saldo a favor de los meses anteriores (regla de Nati, iibbNeto).
 * - Cada línea del banco va a una fila: por el gasto al que está atada (mismo criterio que el Estado de resultados) o por su
 *   clasificación en Bancos. Los pases entre cuentas propias y al FCI van aparte (no es plata que se gasta).
 * Funciones puras. Prueba: npx tsx scripts/test-cashflow.ts
 */
import { clasificarGasto, mesDevengado, type GastoCont } from "./contabilidad";
import { clasificarMovimiento } from "./movimientos-banco";
import { gastosFijosEnVentana, lunesDe, sumarDias, type GastoFijoCaja } from "./caja-proyectada";
import { chequePendiente } from "./cheques-plazo";
import { fechaACubrir } from "./cheques-lazza";

export type FilaCF = "cobros" | "otros_ingresos" | "proveedores" | "sueldos" | "gastos" | "impuestos" | "bancos" | "otros_pagos" | "retiros" | "pases";

export const FILAS_CF: { id: FilaCF; nombre: string; que: string; lado: "entra" | "sale" | "aparte" }[] = [
  { id: "cobros", nombre: "Cobros de clientes", que: "Transferencias y cheques depositados (menos los rechazados)", lado: "entra" },
  { id: "otros_ingresos", nombre: "Otros ingresos", que: "Reintegros, intereses ganados, devoluciones", lado: "entra" },
  { id: "proveedores", nombre: "Pagos a proveedores", que: "Mercadería y transportes: transferencias y cheques propios debitados", lado: "sale" },
  { id: "sueldos", nombre: "Sueldos, premios y comisiones", que: "Colaboradores L-S-J y M, premios y comisión de José", lado: "sale" },
  { id: "gastos", nombre: "Gastos de estructura", que: "Local y servicios, profesionales, operativos, débitos automáticos", lado: "sale" },
  { id: "impuestos", nombre: "Impuestos y retenciones", que: "VEP de ARCA, IIBB, SIRCREB, Ley 25.413 e IVA del banco", lado: "sale" },
  { id: "bancos", nombre: "Bancos, préstamos y tarjetas", que: "Comisiones, intereses y pagos del resumen de la Visa de la empresa", lado: "sale" },
  { id: "otros_pagos", nombre: "Otros pagos", que: "Transferencias y extracciones que no están clasificadas en Bancos", lado: "sale" },
  { id: "retiros", nombre: "Retiros de accionistas", que: "Gastos personales de Augusto que paga la empresa (su plan de ARBA y su Mastercard)", lado: "aparte" },
  { id: "pases", nombre: "Pases a FCI y entre cuentas", que: "La plata cambia de lugar: no es un gasto", lado: "aparte" },
];
export const SEMANAS_PROYECTADAS = 12;
/** Los sueldos sin día de vencimiento se pagan el 10 (como en Caja); los premios van con el sueldo del mes siguiente (Augusto 29/10). */
export const DIA_SUELDOS = 10;
/** El IIBB de cada mes se paga el 22 del mes siguiente (Augusto 29/10: el de agosto se pagó el 22/09); sábado o domingo, el lunes. */
export const DIA_IIBB = 22;
/** Tarjetas personales de Augusto: el pago de su resumen es un retiro, no un gasto de la empresa (Augusto 29/10: Mastercard ·4775). */
export const TARJETAS_PERSONALES = new Set(["187c971f-c4ab-47d1-b79d-970725de42cd"]);

export type OrigenCF = "banco" | "factura_venta" | "factura_compra" | "cheque_recibido" | "cheque_emitido" | "gasto_fijo" | "premio" | "iibb";
export interface ItemCF {
  fecha: string;
  detalle: string;
  /** Con signo: + entra, − sale. */
  monto: number;
  fila: FilaCF;
  origen: OrigenCF;
  /** Salida con fecha anterior a hoy: se cuenta hoy. */
  atrasado?: boolean;
}
export type ValoresCF = Record<FilaCF, number>;

/** Línea del extracto de una cuenta en $ (extracto_movimientos), con el gasto al que está atada si lo hay. */
export interface LineaBancoCF {
  id: string; cuenta_id: string; fecha: string; descripcion: string | null; monto: number | string | null;
  tipo: string | null; clasificacion: string | null; subtipo: string | null;
  saldo: number | string | null;
  gasto?: Pick<GastoCont, "grupo" | "categoria" | "descripcion"> | null;
  /** Marcada "ignorar" en Bancos (ya estaba cargada en Gastos sin atar): igual es plata que salió; la nota dice qué era. */
  ignorada?: boolean;
  nota?: string | null;
  /** Cuenta del otro lado del pase (Bancos): en un pago de tarjeta, cuál tarjeta. */
  contra_cuenta_id?: string | null;
}

const num = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export const ceroCF = (): ValoresCF => Object.fromEntries(FILAS_CF.map((f) => [f.id, 0])) as ValoresCF;
const conSigno = (l: Pick<LineaBancoCF, "tipo" | "monto">) => (l.tipo === "credito" ? 1 : -1) * Math.abs(num(l.monto));

/** A qué fila va un gasto (cargado o fijo): el mismo criterio que el Estado de resultados. */
export function filaDeGasto(g: Pick<GastoCont, "grupo" | "categoria" | "descripcion">): FilaCF {
  switch (clasificarGasto(g)) {
    case "retiros": return "retiros";
    case "colaboradores_lsj": case "colaborador_m": case "comisiones": return "sueldos";
    case "impuestos_pago": case "credito_fiscal_iva": return "impuestos";
    case "bancarios": case "intereses": return "bancos";
    case "transportes": case "compras_sin_factura": return "proveedores";
    default: return "gastos";
  }
}

/** A qué fila va una línea del banco: por su gasto si está atada a uno; si no, por su clasificación en Bancos (o su código y texto). */
export function filaDeLineaBanco(l: LineaBancoCF): FilaCF {
  if (l.gasto) return filaDeGasto(l.gasto);
  if (l.ignorada) {
    const n = String(l.nota || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (/premio|sueldo|comision/.test(n)) return "sueldos";
    if (/mercaderia|proveedor/.test(n)) return "proveedores";
  }
  const entra = l.tipo === "credito";
  if (l.clasificacion === "tarjeta" && l.contra_cuenta_id && TARJETAS_PERSONALES.has(l.contra_cuenta_id)) return "retiros";
  switch (l.clasificacion) {
    case "cobro": case "cheque_acreditado": case "cheque_devuelto": return "cobros";
    case "pago": case "cheque_emitido": return "proveedores";
    case "impuesto": return "impuestos";
    case "intereses": return entra ? "otros_ingresos" : "bancos";
    case "gasto_bancario": case "tarjeta": return "bancos";
    case "fci": case "entre_cuentas": return "pases";
    case "personal": return "retiros";
    case "otro": return entra ? "otros_ingresos" : "otros_pagos";
  }
  // Sin clasificar todavía (las del último extracto): por el código del banco o el texto, como "Ver por tipo".
  const m = clasificarMovimiento({ id: l.id, fecha: l.fecha, descripcion: l.descripcion || "", monto: Math.abs(num(l.monto)), tipo: entra ? "credito" : "debito", clasificacion: null, subtipo: null });
  switch (m.tipo) {
    case "impuestos_comisiones": return m.categoria === "Comisiones" ? "bancos" : "impuestos";
    case "cheques": case "transferencias": return entra ? "cobros" : m.tipo === "cheques" ? "proveedores" : "otros_pagos";
    case "debitos_automaticos": return "gastos";
    case "tarjeta": return "bancos";
    case "propios": return "pases";
    default: return entra ? "otros_ingresos" : "otros_pagos";
  }
}

/**
 * Saldo de una cuenta al cierre de un día, con las líneas de ese día. El orden dentro del día no se guarda: el cierre es el saldo de
 * la línea que, restándole todo lo del día, da el saldo antes de alguna de las líneas (el arranque del día). null si no cuadra.
 */
export function cierreDelDia(lineas: Pick<LineaBancoCF, "tipo" | "monto" | "saldo">[]): number | null {
  const conSaldo = lineas.filter((l) => l.saldo !== null && l.saldo !== undefined && l.saldo !== "");
  if (!conSaldo.length) return null;
  if (lineas.length === 1) return num(lineas[0].saldo);
  const total = lineas.reduce((s, l) => s + conSigno(l), 0);
  const arranques = conSaldo.map((l) => num(l.saldo) - conSigno(l));
  for (const l of conSaldo) {
    const c = num(l.saldo);
    if (arranques.some((a) => Math.abs(c - total - a) < 0.02)) return r2(c);
  }
  return null;
}

/** Saldo de una cuenta al arrancar `fecha` (antes de sus movimientos): el cierre del último día anterior o, si no hay, el arranque del primero. */
export function saldoAlArrancar(lineas: Pick<LineaBancoCF, "fecha" | "tipo" | "monto" | "saldo">[], fecha: string): number | null {
  const porDia = new Map<string, typeof lineas>();
  for (const l of lineas) { const d = l.fecha.slice(0, 10); porDia.set(d, [...(porDia.get(d) || []), l]); }
  const dias = [...porDia.keys()].sort();
  const antes = dias.filter((d) => d < fecha);
  if (antes.length) return cierreDelDia(porDia.get(antes[antes.length - 1])!);
  if (!dias.length) return null;
  const primero = porDia.get(dias[0])!;
  const cierre = cierreDelDia(primero);
  return cierre === null ? null : r2(cierre - primero.reduce((s, l) => s + conSigno(l), 0));
}

// ── Proyección ──────────────────────────────────────────────────────

export interface VencimientoCF { lado: "venta" | "compra"; vence: string; saldo: number; moneda: "ARS" | "USD"; comprobante: string; nombre: string }
export interface ChequeCF {
  numero: string; direccion: string | null; estado: string; estadoBanco?: string | null; fecha_pago: string | null;
  monto: number | string | null; moneda?: string | null; cubreTercero?: string | null; quien?: string | null;
}
export interface FijoCF extends GastoFijoCaja { grupo?: string | null; categoria?: string | null }
export interface PremioCF { persona: string; monto: number; mes: string }
/**
 * IIBB y tasas: % de las ventas de cada mes (las de Reportes), lo pagado a cuenta en el mes (SIRCREB del banco neto de devoluciones
 * y retenciones de IIBB que nos hicieron los clientes) y los gastos cargados, para no contar el que ya se pagó.
 */
export interface IibbCF {
  pct: number;
  meses: { mes: string; ventas: number; sircreb?: number; retenciones?: number }[];
  cargados: { descripcion: string | null; fecha: string }[];
}
/** Desde este mes hay extracto del banco (SIRCREB) y retenciones cargadas: el saldo a favor de IIBB se arrastra desde acá. */
export const DESDE_IIBB_NETO = "2026-09";
export interface IibbMes {
  mes: string; bruto: number; sircreb: number; retenciones: number; saldoAnterior: number;
  aPagar: number; saldoAFavor: number;
  /** Ya hay un VEP del mes cargado en Gastos. */
  pagado: boolean;
}

const sinCeros = (n: string) => String(n || "").trim().replace(/^0+/, "");
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const sumarMes = (m: string) => { const [y, mm] = m.split("-").map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };
const sinAcentos = (s: string | null | undefined) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Día en que se paga el IIBB de `mes`: el 22 del mes siguiente; si cae sábado o domingo, el lunes. */
export function vencimientoIibb(mes: string): string {
  const f = `${sumarMes(mes)}-${String(DIA_IIBB).padStart(2, "0")}`;
  const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
  return dow === 6 ? sumarDias(f, 2) : dow === 0 ? sumarDias(f, 1) : f;
}

/** ¿Ya hay un gasto cargado del IIBB de `mes`? ("IIBB Convenio Multilateral agosto 2026"; no las retenciones ni percepciones). */
export function iibbCargado(cargados: IibbCF["cargados"], mes: string): boolean {
  return cargados.some((g) => {
    const d = sinAcentos(g.descripcion);
    return /\biibb\b|ingresos brutos|convenio multilateral/.test(d) && !/reten|percep|sircreb/.test(d) && mesDevengado(g.descripcion, g.fecha) === mes;
  });
}

/**
 * IIBB y tasas de cada mes con la regla de Nati (29/10: "el monto del mes menos saldos a favor previos y del mes"): el % de las
 * ventas menos el SIRCREB y las retenciones del mes y el saldo a favor que viene de antes, nunca menos de 0. Lo que sobra queda a
 * favor para el mes siguiente. Un mes ya pagado (VEP cargado en Gastos) deja el saldo a favor en 0: lo real manda.
 */
export function iibbNeto(iibb: IibbCF): IibbMes[] {
  let saldo = 0;
  return [...iibb.meses].sort((a, b) => a.mes.localeCompare(b.mes)).map((m) => {
    const bruto = r2(m.ventas * iibb.pct / 100);
    const sircreb = r2(m.sircreb || 0), retenciones = r2(m.retenciones || 0), saldoAnterior = saldo;
    const neto = r2(bruto - sircreb - retenciones - saldoAnterior);
    const pagado = iibbCargado(iibb.cargados, m.mes);
    saldo = pagado ? 0 : Math.max(0, -neto);
    return { mes: m.mes, bruto, sircreb, retenciones, saldoAnterior, aPagar: Math.max(0, neto), saldoAFavor: saldo, pagado };
  });
}

/** Lo que se espera cobrar y pagar desde hoy hasta `hasta` (inclusive). Nunca inventa fechas: usa vencimientos, fechas de pago y días de los gastos fijos. */
export function proyeccionCF(x: {
  hoy: string; hasta: string;
  vencimientos: VencimientoCF[];
  cheques: ChequeCF[];
  /** Números de cheques propios que el banco ya debitó (cobertura-cheques: numerosDebitados). */
  debitados?: Set<string>;
  fijos: FijoCF[];
  pagosFijos: { gasto_fijo_id?: string | null; fecha: string }[];
  facturasCompra?: { proveedor_id: string | null; fecha: string }[];
  premios?: PremioCF[];
  iibb?: IibbCF | null;
  dolar: number | null;
}): { items: ItemCF[]; vencidoSinCobrar: { total: number; cantidad: number }; sinDolar: string[] } {
  const items: ItemCF[] = [];
  const sinDolar: string[] = [];
  const vencido = { total: 0, cantidad: 0 };
  const enPesos = (monto: number, moneda: string | null | undefined, que: string): number | null => {
    if (moneda !== "USD") return monto;
    if (!x.dolar) { sinDolar.push(que); return null; }
    return r2(monto * x.dolar);
  };
  /**
   * Las salidas con fecha pasada se cuentan hoy (hay que pagarlas); las que caen después de `hasta` no entran.
   * Un cheque propio sin debitar no está "atrasado": el banco lo puede debitar hasta 30 días después (Augusto).
   */
  const salida = (fecha: string, monto: number, fila: FilaCF, origen: OrigenCF, detalle: string) => {
    if (!(monto > 0) || fecha > x.hasta) return;
    const pasada = fecha < x.hoy;
    items.push({ fecha: pasada ? x.hoy : fecha, monto: -r2(monto), fila, origen, detalle, atrasado: (pasada && origen !== "cheque_emitido") || undefined });
  };

  for (const v of x.vencimientos) {
    if (!(v.saldo > 0.005)) continue;
    const detalle = `${v.comprobante} — ${v.nombre}${v.moneda === "USD" ? ` (US$ ${v.saldo.toLocaleString("es-AR")})` : ""}`;
    const monto = enPesos(v.saldo, v.moneda, detalle);
    if (monto === null) continue;
    const f = v.vence.slice(0, 10);
    if (v.lado === "venta") {
      if (f < x.hoy) { vencido.total += monto; vencido.cantidad++; continue; }
      if (f <= x.hasta) items.push({ fecha: f, monto: r2(monto), fila: "cobros", origen: "factura_venta", detalle });
    } else salida(f, monto, "proveedores", "factura_compra", detalle);
  }

  for (const ch of x.cheques) {
    if (!chequePendiente(ch) || !ch.fecha_pago) continue;
    const f = ch.fecha_pago.slice(0, 10);
    const detalle = `Cheque ${sinCeros(ch.numero)}${ch.quien ? ` — ${ch.quien}` : ""}`;
    const monto = enPesos(num(ch.monto), ch.moneda, detalle);
    if (monto === null) continue;
    if (ch.direccion === "emitido") {
      // La misma regla de "a cubrir" que Inicio, Finanzas y Cheques (P07, lib/cheques-lazza): sin los que el banco ya debitó ni
      // los de más de 30 días; el que ya está en fecha se cubre hoy. Los que cubre Martín F. suman (Augusto: "Suman en a cubrir").
      const cubrir = fechaACubrir(ch, x.hoy, x.debitados);
      if (!cubrir) continue;
      salida(cubrir, monto, "proveedores", "cheque_emitido", ch.cubreTercero ? `${detalle} (lo cubre ${ch.cubreTercero})` : detalle);
    } else if (f <= x.hasta) {
      // Un cheque en cartera ya en fecha se puede depositar hoy.
      items.push({ fecha: f < x.hoy ? x.hoy : f, monto: r2(monto), fila: "cobros", origen: "cheque_recibido", detalle });
    }
  }

  const dias = Math.round((Date.parse(`${x.hasta}T12:00:00Z`) - Date.parse(`${x.hoy}T12:00:00Z`)) / 86_400_000) + 1;
  for (const g of x.fijos) {
    const r = gastosFijosEnVentana({ hoy: x.hoy, dias, fijos: [g], pagos: x.pagosFijos, facturasCompra: x.facturasCompra, dolar: x.dolar });
    sinDolar.push(...r.sinDolar);
    const fila = filaDeGasto({ grupo: g.grupo ?? null, categoria: g.categoria ?? null, descripcion: g.descripcion });
    // El sueldo que se paga a principio de mes es el del mes anterior (Augusto 29/10): el detalle dice el mes del sueldo.
    const esSueldo = /^sueldo\b/.test(sinAcentos(g.descripcion));
    for (const s of r.salidas) {
      const mes = MESES[(Number(s.fecha.slice(5, 7)) + (esSueldo ? 10 : 11)) % 12];
      salida(s.fecha, s.monto, fila, "gasto_fijo", `${s.detalle} — ${mes}${s.usd ? ` (US$ ${s.usd.toLocaleString("es-AR")})` : ""}`);
    }
  }

  for (const p of x.premios || []) {
    const fecha = `${sumarMes(p.mes)}-${String(DIA_SUELDOS).padStart(2, "0")}`;
    salida(fecha, p.monto, "sueldos", "premio", `Premio ${MESES[Number(p.mes.slice(5, 7)) - 1]} — ${p.persona} (estimado, con el sueldo)`);
  }

  // IIBB y tasas: el vencido no se cuenta (no se sabe si se pagó por otro lado), ni el que ya está cargado en Gastos.
  // El mes en curso va con lo facturado hasta hoy; los meses sin ventas todavía no suman. Si el SIRCREB, las retenciones y el
  // saldo a favor cubren el mes, no sale nada (el saldo a favor se ve aparte).
  if (x.iibb && x.iibb.pct > 0) {
    const $ = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
    for (const m of iibbNeto(x.iibb)) {
      const fecha = vencimientoIibb(m.mes);
      if (fecha < x.hoy || m.pagado) continue;
      const enCurso = m.mes >= x.hoy.slice(0, 7);
      const ventas = x.iibb.meses.find((v) => v.mes === m.mes)!.ventas;
      const menos = [m.sircreb ? `SIRCREB $ ${$(m.sircreb)}` : "", m.retenciones ? `retenciones $ ${$(m.retenciones)}` : "", m.saldoAnterior ? `saldo a favor $ ${$(m.saldoAnterior)}` : ""].filter(Boolean);
      salida(fecha, m.aPagar, "impuestos", "iibb",
        `IIBB y tasas ${MESES[Number(m.mes.slice(5, 7)) - 1]} — ${x.iibb.pct} % de las ventas ($ ${$(ventas)}${enCurso ? ", lo facturado hasta hoy" : ""})${menos.length ? ` menos ${menos.join(", ")}` : ""} (estimado)`);
    }
  }

  items.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.monto - b.monto);
  return { items, vencidoSinCobrar: { total: r2(vencido.total), cantidad: vencido.cantidad }, sinDolar: [...new Set(sinDolar)] };
}

// ── Cashflow semanal ────────────────────────────────────────────────

/** Foto del proyectado al inicio de un mes (fila `cashflow_foto_AAAA-MM` de configuracion): lo de cada semana que arranca en ese mes. */
export interface FotoCF { tomada: string; semanas: Record<string, Partial<ValoresCF>> }
export const claveFoto = (mes: string) => `cashflow_foto_${mes}`;

export interface SemanaCF {
  desde: string; hasta: string;
  tipo: "real" | "proyectada";
  /** Lo que pasó en el banco (null si la semana todavía no empezó). */
  real: ValoresCF | null;
  /** Lo proyectado (null en las semanas pasadas). */
  proy: ValoresCF | null;
  /** De dónde sale "Proy.": la foto del inicio del mes o lo que se proyecta hoy. */
  proyDe: "foto" | "hoy" | null;
  saldoReal: { inicial: number; final: number } | null;
  saldoProy: { inicial: number; final: number } | null;
  detalleReal: ItemCF[];
  detalleProy: ItemCF[];
}
export interface Cashflow {
  hoy: string;
  semanas: SemanaCF[];
  /** Saldo de los bancos en $ al arrancar la primera semana (del extracto). */
  saldoInicial: number;
  /** Cuentas cuyo saldo no se pudo leer del extracto (no suman al saldo inicial). */
  cuentasSinSaldo: string[];
  avisos: string[];
}

export const totalEntra = (v: ValoresCF) => r2(FILAS_CF.filter((f) => f.lado === "entra").reduce((s, f) => s + v[f.id], 0));
export const totalSale = (v: ValoresCF) => r2(FILAS_CF.filter((f) => f.lado === "sale").reduce((s, f) => s + v[f.id], 0));
export const flujo = (v: ValoresCF) => r2(FILAS_CF.reduce((s, f) => s + v[f.id], 0));

const sumar = (items: ItemCF[]): ValoresCF => {
  const v = ceroCF();
  for (const it of items) v[it.fila] = r2(v[it.fila] + it.monto);
  return v;
};

/**
 * Arma las semanas: las pasadas (desde la primera línea del banco) con lo real, y desde la de hoy 12 con Proy. y Real.
 * La semana de hoy, proyectada "hoy", es lo real hasta ayer más lo que se espera de hoy al domingo.
 */
export function armarCashflow(x: {
  hoy: string;
  lineas: LineaBancoCF[];
  /** Nombre de cada cuenta (para avisar si no se puede leer su saldo). */
  cuentas: Record<string, string>;
  proyeccion: ItemCF[];
  fotos?: Record<string, FotoCF>;
  semanasProyectadas?: number;
}): Cashflow {
  const lunesHoy = lunesDe(x.hoy);
  const n = x.semanasProyectadas ?? SEMANAS_PROYECTADAS;
  const fechas = x.lineas.map((l) => l.fecha.slice(0, 10)).sort();
  const primero = lunesDe(fechas[0] || x.hoy) < lunesHoy ? lunesDe(fechas[0] || x.hoy) : lunesHoy;
  const avisos: string[] = [];

  const porCuenta = new Map<string, LineaBancoCF[]>();
  for (const l of x.lineas) porCuenta.set(l.cuenta_id, [...(porCuenta.get(l.cuenta_id) || []), l]);
  let saldoInicial = 0;
  const cuentasSinSaldo: string[] = [];
  for (const [id, ls] of porCuenta) {
    const s = saldoAlArrancar(ls, primero);
    if (s === null) cuentasSinSaldo.push(x.cuentas[id] || id); else saldoInicial = r2(saldoInicial + s);
  }
  if (cuentasSinSaldo.length) avisos.push(`No se pudo leer el saldo del extracto de ${cuentasSinSaldo.join(", ")}: el saldo inicial no lo incluye.`);
  // Sin control contra el saldo guardado de la cuenta (Finanzas 30/10): el saldo de cada línea sale del Excel de ese día y no
  // encadena entre archivos bajados a media jornada, así que avisaba faltantes que no eran. El control es el día por día de Bancos.

  const itemsBanco: ItemCF[] = x.lineas.map((l) => ({ fecha: l.fecha.slice(0, 10), detalle: String(l.descripcion || "").trim() || "(sin texto)", monto: r2(conSigno(l)), fila: filaDeLineaBanco(l), origen: "banco" }));
  const enSemana = (items: ItemCF[], desde: string, hasta: string) => items.filter((i) => i.fecha >= desde && i.fecha <= hasta);

  const semanas: SemanaCF[] = [];
  let saldoReal = saldoInicial;
  let saldoProy: number | null = null;
  for (let desde = primero; desde < sumarDias(lunesHoy, n * 7); desde = sumarDias(desde, 7)) {
    const hasta = sumarDias(desde, 6);
    const proyectada = desde >= lunesHoy;
    const detalleReal = desde <= x.hoy ? enSemana(itemsBanco, desde, hasta) : [];
    const real = desde <= x.hoy ? sumar(detalleReal) : null;
    const sem: SemanaCF = { desde, hasta, tipo: proyectada ? "proyectada" : "real", real, proy: null, proyDe: null, saldoReal: null, saldoProy: null, detalleReal, detalleProy: [] };
    if (real) { sem.saldoReal = { inicial: saldoReal, final: r2(saldoReal + flujo(real)) }; saldoReal = sem.saldoReal.final; }
    if (proyectada) {
      if (saldoProy === null) saldoProy = sem.saldoReal?.inicial ?? saldoReal;
      const foto = x.fotos?.[desde.slice(0, 7)]?.semanas[desde];
      if (foto) {
        sem.proy = { ...ceroCF(), ...foto };
        sem.proyDe = "foto";
      } else {
        sem.detalleProy = [...enSemana(itemsBanco, desde, sumarDias(x.hoy, -1)), ...enSemana(x.proyeccion, desde < x.hoy ? x.hoy : desde, hasta)];
        sem.proy = sumar(sem.detalleProy);
        sem.proyDe = "hoy";
      }
      sem.saldoProy = { inicial: saldoProy, final: r2(saldoProy + flujo(sem.proy)) };
      saldoProy = sem.saldoProy.final;
    }
    semanas.push(sem);
  }
  return { hoy: x.hoy, semanas, saldoInicial, cuentasSinSaldo, avisos };
}

/** Cuenta sin extracto (FCI, efectivo, US$) con su último saldo cargado (cuentas_financieras.saldo_banco). */
export interface DisponibilidadCF { nombre: string; moneda: "ARS" | "USD"; saldo: number; fecha: string | null }

/**
 * Otras disponibilidades: se muestran aparte y NO suman al saldo de las semanas (que es solo lo de los bancos con extracto),
 * así un pase al FCI no cuenta dos veces. US$ al dólar del día; sin dólar, no suma al total.
 */
export function otrasDisponibilidades(cuentas: DisponibilidadCF[], dolar: number | null): { cuentas: (DisponibilidadCF & { enPesos: number | null })[]; total: number } {
  const lista = cuentas.map((c) => ({ ...c, enPesos: c.moneda === "USD" ? (dolar ? r2(c.saldo * dolar) : null) : c.saldo }));
  return { cuentas: lista, total: r2(lista.reduce((s, c) => s + (c.enPesos ?? 0), 0)) };
}

/** Foto para guardar al abrir el Cashflow por primera vez en el mes: lo proyectado hoy de las semanas que arrancan en este mes. */
export function fotoDelMes(cf: Cashflow): FotoCF {
  const mes = cf.hoy.slice(0, 7);
  const semanas: FotoCF["semanas"] = {};
  for (const s of cf.semanas) if (s.tipo === "proyectada" && s.proyDe === "hoy" && s.proy && s.desde.slice(0, 7) === mes) semanas[s.desde] = s.proy;
  return { tomada: cf.hoy, semanas };
}

/** Planilla para Excel: una columna por semana real y dos (Proy. y Real) por semana proyectada. */
export function planillaCF(cf: Cashflow, semanaCorta: (desde: string) => string): (string | number | null)[][] {
  const cols: { s: SemanaCF; cual: "real" | "proy" }[] = cf.semanas.flatMap((s) => (s.tipo === "real" ? [{ s, cual: "real" as const }] : [{ s, cual: "proy" as const }, { s, cual: "real" as const }]));
  const v = (c: (typeof cols)[number]) => (c.cual === "real" ? c.s.real : c.s.proy);
  const sal = (c: (typeof cols)[number]) => (c.cual === "real" ? c.s.saldoReal : c.s.saldoProy);
  const out: (string | number | null)[][] = [
    ["Semana (lunes)", ...cols.map((c) => semanaCorta(c.s.desde))],
    ["", ...cols.map((c) => (c.s.tipo === "real" ? "Real" : c.cual === "proy" ? (c.s.proyDe === "foto" ? "Proy. (inicio de mes)" : "Proy. (hoy)") : "Real"))],
    ["Saldo inicial", ...cols.map((c) => sal(c)?.inicial ?? null)],
  ];
  const fila = (nombre: string, f: (x: ValoresCF) => number) => out.push([nombre, ...cols.map((c) => { const x = v(c); return x ? f(x) : null; })]);
  for (const f of FILAS_CF.filter((f) => f.lado === "entra")) fila(f.nombre, (x) => x[f.id]);
  fila("Total entró", totalEntra);
  for (const f of FILAS_CF.filter((f) => f.lado === "sale")) fila(f.nombre, (x) => x[f.id]);
  fila("Total salió", totalSale);
  for (const f of FILAS_CF.filter((f) => f.lado === "aparte")) fila(f.nombre, (x) => x[f.id]);
  fila("Flujo de la semana", flujo);
  out.push(["Saldo final", ...cols.map((c) => sal(c)?.final ?? null)]);
  return out;
}
