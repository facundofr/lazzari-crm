/**
 * Saldo de cuenta corriente de clientes, calculado desde los comprobantes
 * (B3: la columna clientes.saldo_cuenta_corriente no la actualiza nadie).
 *
 * Misma regla que Finanzas (vencimientos y CC de clientes):
 *   saldo de cada factura = total − NC aplicadas (total_acreditado) − cobrado
 *   cobrado = movimientos con factura_id (cobros y retenciones sufridas, no anulados)
 *           + aplicaciones de cobros consolidados (cobro_aplicaciones),
 *           sin contar dos veces un movimiento que ya entró por sus aplicaciones.
 * - Las facturas anuladas no cuentan.
 * - Las NC no suman deuda: se aplican vía total_acreditado de su factura.
 *   Lo que la NC no pudo aplicar (saldo_a_favor_cliente) queda como saldo a favor.
 * - ARS y USD siempre por separado.
 * - Ajustes manuales de CC del cliente (movimientos sin factura con ajuste_sentido): débito = deuda,
 *   crédito = a favor (p. ej. "Diferencia de cobro pasada a la cuenta corriente").
 *
 * Prueba: npx tsx scripts/test-saldo-clientes.ts
 */

export type MonedaCC = "ARS" | "USD";

export interface FacturaCC {
  id: string;
  cliente_id: string | null;
  tipo: string | null;
  total: number | string | null;
  total_acreditado?: number | string | null;
  saldo_a_favor_cliente?: number | string | null;
  /** Solo NC: factura a la que se aplicó. `null` = NC suelta; `undefined` = no se pidió el dato. */
  factura_origen_id?: string | null;
  moneda: string | null;
  estado: string | null;
}

export interface MovimientoCC {
  id: string;
  factura_id: string | null;
  monto: number | string | null;
  moneda?: string | null;
  anulado?: boolean | null;
}

export interface AplicacionCC {
  movimiento_id?: string | null;
  factura_id: string | null;
  monto: number | string | null;
  /** Movimiento de la aplicación (si viene con join). Si está anulado no cuenta. */
  movimientos?: { anulado?: boolean | null } | { anulado?: boolean | null }[] | null;
}

/** Ajuste manual de cuenta corriente del cliente (sin factura). Sin sentido no cuenta. */
export interface AjusteClienteCC {
  cliente_id: string | null;
  monto: number | string | null;
  moneda?: string | null;
  ajuste_sentido: "credito" | "debito" | string | null;
  anulado?: boolean | null;
}

export interface SaldoClienteMoneda {
  /** Suma de lo que deben las facturas (nunca negativa por factura). */
  deuda: number;
  /** Crédito a favor del cliente (NC que superaron el saldo de su factura). */
  aFavor: number;
  /** deuda − aFavor (negativo = saldo a favor del cliente). */
  saldo: number;
}

export type SaldoCliente = Record<MonedaCC, SaldoClienteMoneda>;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const moneda = (m: string | null | undefined): MonedaCC => (m === "USD" ? "USD" : "ARS");
const esNC = (tipo: string | null | undefined) => String(tipo || "").toUpperCase().startsWith("NC");

function vacio(): SaldoCliente {
  return { ARS: { deuda: 0, aFavor: 0, saldo: 0 }, USD: { deuda: 0, aFavor: 0, saldo: 0 } };
}

/** Cobrado por factura (en la moneda de la factura). */
export function cobradoPorFactura(
  facturas: Pick<FacturaCC, "id" | "moneda">[],
  movimientos: MovimientoCC[],
  aplicaciones: AplicacionCC[],
): Record<string, number> {
  const monedaDe = new Map(facturas.map(f => [f.id, moneda(f.moneda)]));
  const out: Record<string, number> = {};
  const movAplicados = new Set<string>();
  for (const a of aplicaciones) {
    if (!a.factura_id) continue;
    const mov = Array.isArray(a.movimientos) ? a.movimientos[0] : a.movimientos;
    if (mov?.anulado) continue;
    if (a.movimiento_id) movAplicados.add(a.movimiento_id);
    out[a.factura_id] = (out[a.factura_id] || 0) + (Number(a.monto) || 0);
  }
  for (const m of movimientos) {
    if (!m.factura_id || m.anulado || movAplicados.has(m.id)) continue;
    const monedaFactura = monedaDe.get(m.factura_id);
    // Un movimiento directo en otra moneda que la factura no se puede sumar tal cual
    // (los cobros en dólares van por aplicaciones). Se ignora para no mezclar monedas.
    if (monedaFactura && m.moneda && moneda(m.moneda) !== monedaFactura) continue;
    out[m.factura_id] = (out[m.factura_id] || 0) + (Number(m.monto) || 0);
  }
  for (const k of Object.keys(out)) out[k] = r2(out[k]);
  return out;
}

/** Saldo pendiente de una factura (nunca negativo). Anuladas y NC = 0. */
export function saldoFacturaVenta(f: FacturaCC, cobrado: number): number {
  if (f.estado === "anulada" || esNC(f.tipo)) return 0;
  return r2(Math.max(0, (Number(f.total) || 0) - (Number(f.total_acreditado) || 0) - (cobrado || 0)));
}

/**
 * Saldo de cada factura, trayendo sus cobros de la base (directos y aplicaciones, sin los anulados). NC y anuladas = 0.
 * Lo usan el asistente de Finanzas y el agente de correo (auditoría 28/10/2026, H28: tenían su propia cuenta y listaban las NC como deuda).
 */
export async function saldosDeFacturas(db: any, facturas: (Pick<FacturaCC, "id" | "tipo" | "total" | "total_acreditado" | "moneda" | "estado">)[]): Promise<Record<string, number>> {
  const ids = facturas.filter(f => f.estado !== "anulada" && !esNC(f.tipo)).map(f => f.id);
  const movs: MovimientoCC[] = [], apls: AplicacionCC[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const parte = ids.slice(i, i + 200);
    const [m, a] = await Promise.all([
      db.from("movimientos").select("id, factura_id, monto, moneda, anulado").in("factura_id", parte),
      db.from("cobro_aplicaciones").select("movimiento_id, factura_id, monto, movimientos(anulado)").in("factura_id", parte),
    ]);
    if (m.error) throw new Error(m.error.message);
    if (a.error) throw new Error(a.error.message);
    movs.push(...(m.data || [])); apls.push(...(a.data || []));
  }
  const cobrado = cobradoPorFactura(facturas, movs, apls);
  return Object.fromEntries(facturas.map(f => [f.id, saldoFacturaVenta(f as FacturaCC, cobrado[f.id] || 0)]));
}

/** Saldo de cuenta corriente por cliente, ARS y USD por separado. */
export function calcularSaldosClientes(
  facturas: FacturaCC[],
  movimientos: MovimientoCC[],
  aplicaciones: AplicacionCC[],
  ajustes: AjusteClienteCC[] = [],
): Record<string, SaldoCliente> {
  const cobrado = cobradoPorFactura(facturas, movimientos, aplicaciones);
  const out: Record<string, SaldoCliente> = {};
  for (const a of ajustes) {
    if (!a.cliente_id || a.anulado || (a.ajuste_sentido !== "credito" && a.ajuste_sentido !== "debito")) continue;
    const s = (out[a.cliente_id] ||= vacio());
    const m = moneda(a.moneda);
    if (a.ajuste_sentido === "debito") s[m].deuda += Number(a.monto) || 0;
    else s[m].aFavor += Number(a.monto) || 0;
  }
  for (const f of facturas) {
    if (!f.cliente_id || f.estado === "anulada") continue;
    const m = moneda(f.moneda);
    const s = (out[f.cliente_id] ||= vacio());
    if (esNC(f.tipo)) {
      // NC atada a una factura: lo que no se pudo aplicar (saldo_a_favor_cliente).
      // NC suelta (sin factura origen): no se aplicó a nada, todo su total es a favor.
      s[m].aFavor += f.factura_origen_id === null
        ? Number(f.total) || 0
        : Number(f.saldo_a_favor_cliente) || 0;
    } else {
      s[m].deuda += saldoFacturaVenta(f, cobrado[f.id] || 0);
    }
  }
  for (const s of Object.values(out)) {
    for (const m of ["ARS", "USD"] as MonedaCC[]) {
      s[m].deuda = r2(s[m].deuda);
      s[m].aFavor = r2(s[m].aFavor);
      s[m].saldo = r2(s[m].deuda - s[m].aFavor);
    }
  }
  return out;
}

/** Saldo de un cliente en una moneda (0 si no tiene movimientos). */
export function saldoClienteEn(saldos: Record<string, SaldoCliente> | null | undefined, clienteId: string | null | undefined, m: MonedaCC = "ARS"): number {
  if (!saldos || !clienteId) return 0;
  return saldos[clienteId]?.[m]?.saldo || 0;
}

/**
 * Aviso de límite de crédito (solo aviso, nunca bloquea).
 * El límite está en pesos: se compara con el saldo en pesos más el saldo en
 * dólares convertido con la cotización que se pase (si no hay, solo pesos).
 */
export function superaLimiteCredito(limite: number | null | undefined, saldo: SaldoCliente | null | undefined, cotizacionUsd?: number | null): boolean {
  const lim = Number(limite) || 0;
  if (lim <= 0 || !saldo) return false;
  const usd = cotizacionUsd && cotizacionUsd > 0 ? Math.max(0, saldo.USD.saldo) * cotizacionUsd : 0;
  return saldo.ARS.saldo + usd >= lim;
}

/** Consultas para traer los datos de una sociedad (usar con traerTodo, cada una con orden estable). */
export const SALDO_CLIENTES_SELECTS = {
  facturas: "id, cliente_id, tipo, total, total_acreditado, saldo_a_favor_cliente, factura_origen_id, moneda, estado",
  movimientos: "id, factura_id, monto, moneda, anulado",
  ajustes: "id, cliente_id, monto, moneda, anulado, tipo, descripcion, ajuste_sentido",
  aplicaciones: "movimiento_id, factura_id, monto, movimientos!inner(anulado, sociedad_id)",
} as const;

export interface DatosSaldoClientes {
  facturas: FacturaCC[];
  movimientos: MovimientoCC[];
  aplicaciones: AplicacionCC[];
  ajustes: AjusteClienteCC[];
}

/**
 * Trae de la base todo lo necesario para el saldo de los clientes de una sociedad
 * (paginado: Supabase corta en 1000 filas). `traerTodo` se recibe por parámetro
 * para que este archivo siga siendo puro y se pueda probar sin base.
 */
export async function traerDatosSaldoClientes(
  supabase: any,
  sociedadId: string,
  traerTodo: <T = any>(armar: () => any) => Promise<T[]>,
): Promise<DatosSaldoClientes> {
  const armarFacturas = (campos: string) => () => supabase.from("facturas")
    .select(campos).eq("sociedad_id", sociedadId).neq("estado", "anulada").order("id");
  let facturas: FacturaCC[];
  try {
    facturas = await traerTodo<FacturaCC>(armarFacturas(SALDO_CLIENTES_SELECTS.facturas));
  } catch {
    // Por si la columna saldo_a_favor_cliente todavía no existe en la base.
    facturas = await traerTodo<FacturaCC>(armarFacturas("id, cliente_id, tipo, total, total_acreditado, moneda, estado"));
  }
  const [movimientos, aplicaciones, ajustes] = await Promise.all([
    traerTodo<MovimientoCC>(() => supabase.from("movimientos")
      .select(SALDO_CLIENTES_SELECTS.movimientos).eq("sociedad_id", sociedadId)
      .not("factura_id", "is", null).order("id")),
    traerTodo<AplicacionCC>(() => supabase.from("cobro_aplicaciones")
      .select(SALDO_CLIENTES_SELECTS.aplicaciones).eq("movimientos.sociedad_id", sociedadId)
      .order("movimiento_id").order("factura_id")),
    // Ajustes de CC sin factura. Si la columna ajuste_sentido no existe todavía, no hay ajustes que sumar.
    traerTodo<AjusteClienteCC>(() => supabase.from("movimientos")
      .select(SALDO_CLIENTES_SELECTS.ajustes).eq("sociedad_id", sociedadId)
      .not("cliente_id", "is", null).is("factura_id", null).not("ajuste_sentido", "is", null).order("id")).catch(() => []),
  ]);
  return { facturas, movimientos, aplicaciones, ajustes };
}

/** Atajo: trae los datos y devuelve el saldo por cliente. */
export async function traerSaldosClientes(
  supabase: any,
  sociedadId: string,
  traerTodo: <T = any>(armar: () => any) => Promise<T[]>,
): Promise<Record<string, SaldoCliente>> {
  const d = await traerDatosSaldoClientes(supabase, sociedadId, traerTodo);
  return calcularSaldosClientes(d.facturas, d.movimientos, d.aplicaciones, d.ajustes);
}
