/**
 * Totales de la pestaña «Cta. Cte.» del cliente (Clientes › ficha › Cta. Cte., y el texto de Copiar/Enviar CC).
 * Auditoría 28/10/2026 (H08): el total tiene que dar lo mismo que el saldo de Finanzas (lib/saldo-clientes):
 *   saldo de la cuenta = lo que deben las facturas − lo que está a favor del cliente (NC sin aplicar) ± ajustes.
 * Las facturas llegan con su saldo ya calculado; el saldo neto del cliente viene de calcularSaldosClientes.
 * Si el saldo neto no está (falló el cálculo), se muestra solo lo de las facturas.
 *
 * Prueba: npx tsx scripts/test-cuenta-corriente-cliente.ts
 */

import { calcularSaldosClientes, SALDO_CLIENTES_SELECTS, type SaldoCliente } from "./saldo-clientes";

export type MonedaTotal = "ARS" | "USD";

export interface TotalCC {
  moneda: MonedaTotal;
  /** Suma de los saldos de las facturas pendientes. */
  facturas: number;
  /** Lo que está a favor del cliente (NC sin aplicar, ajustes a favor). */
  aFavor: number;
  /** Cargos sin factura (ajustes en contra del cliente). */
  otrosCargos: number;
  /** Saldo de la cuenta (lo mismo que Finanzas). */
  saldoCuenta: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function totalesCuentaCorriente(
  facturas: { saldo: number; moneda: string | null }[],
  saldoNeto: Partial<Record<MonedaTotal, number>> | null,
): TotalCC[] {
  const porMoneda: Record<MonedaTotal, number> = { ARS: 0, USD: 0 };
  const hay = new Set<MonedaTotal>();
  for (const f of facturas) {
    const m: MonedaTotal = f.moneda === "USD" ? "USD" : "ARS";
    porMoneda[m] += Number(f.saldo) || 0;
    hay.add(m);
  }
  if (saldoNeto) for (const m of ["ARS", "USD"] as MonedaTotal[]) if (Math.abs(saldoNeto[m] || 0) > 0.009) hay.add(m);
  return (["ARS", "USD"] as MonedaTotal[]).filter((m) => hay.has(m)).map((m) => {
    const fact = r2(porMoneda[m]);
    const cuenta = saldoNeto ? r2(saldoNeto[m] || 0) : fact;
    const dif = r2(fact - cuenta);
    return { moneda: m, facturas: fact, aFavor: dif > 0 ? dif : 0, otrosCargos: dif < 0 ? -dif : 0, saldoCuenta: cuenta };
  });
}

/**
 * Saldo de UN cliente con la misma regla que Finanzas (lib/saldo-clientes), sin traer toda la sociedad.
 * Lo usa el aviso de límite de crédito del PR (auditoría 28/10/2026, H30: antes leía la columna vieja
 * clientes.saldo_cuenta_corriente, que no actualiza nadie).
 */
export async function traerSaldoUnCliente(supabase: any, sociedadId: string, clienteId: string): Promise<SaldoCliente | null> {
  const { data: facturas, error } = await supabase.from("facturas").select(SALDO_CLIENTES_SELECTS.facturas)
    .eq("sociedad_id", sociedadId).eq("cliente_id", clienteId).neq("estado", "anulada");
  if (error) throw error;
  const ids = (facturas || []).map((f: { id: string }) => f.id);
  const [movs, apls, ajustes] = await Promise.all([
    ids.length ? supabase.from("movimientos").select(SALDO_CLIENTES_SELECTS.movimientos).in("factura_id", ids) : { data: [], error: null },
    ids.length ? supabase.from("cobro_aplicaciones").select("movimiento_id, factura_id, monto, movimientos(anulado)").in("factura_id", ids) : { data: [], error: null },
    supabase.from("movimientos").select(SALDO_CLIENTES_SELECTS.ajustes).eq("sociedad_id", sociedadId).eq("cliente_id", clienteId)
      .is("factura_id", null).not("ajuste_sentido", "is", null),
  ]);
  for (const r of [movs, apls]) if (r.error) throw r.error;
  return calcularSaldosClientes(facturas || [], movs.data || [], apls.data || [], ajustes.error ? [] : ajustes.data || [])[clienteId] || null;
}
