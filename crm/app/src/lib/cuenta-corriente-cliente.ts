/**
 * Totales de la pestaña «Cta. Cte.» del cliente (Clientes › ficha › Cta. Cte., y el texto de Copiar/Enviar CC).
 * Auditoría 28/10/2026 (H08): el total tiene que dar lo mismo que el saldo de Finanzas (lib/saldo-clientes):
 *   saldo de la cuenta = lo que deben las facturas − lo que está a favor del cliente (NC sin aplicar) ± ajustes.
 * Las facturas llegan con su saldo ya calculado; el saldo neto del cliente viene de calcularSaldosClientes.
 * Si el saldo neto no está (falló el cálculo), se muestra solo lo de las facturas.
 *
 * Prueba: npx tsx scripts/test-cuenta-corriente-cliente.ts
 */

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
