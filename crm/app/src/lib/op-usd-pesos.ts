// OP en pesos de facturas de compra en dólares (Augusto paga siempre en $).
// Cada factura aporta round(US$ × cotización, 2) al bruto en pesos: la misma cuenta que hace la base
// en registrar_op_usd_en_pesos (numeric exacto). Acá se calcula con enteros para no perder centavos
// por el punto flotante (173,57 × 1450 en float da 251676,4999…).

/** Cotización con hasta 4 decimales (BNA usa 2). */
const ESCALA_TC = BigInt(10000);

function centavos(valor: number): bigint {
  return BigInt(Math.round(valor * 100));
}

/** US$ × cotización, redondeado al centavo (mitad hacia arriba, como round() de Postgres). */
export function pesosDeUsd(usd: number, cotizacion: number): number {
  if (!Number.isFinite(usd) || !Number.isFinite(cotizacion) || cotizacion <= 0) return 0;
  const tc = BigInt(Math.round(cotizacion * Number(ESCALA_TC)));
  const prod = centavos(Math.abs(usd)) * tc; // centavos × TC escalado
  const cents = (prod + ESCALA_TC / BigInt(2)) / ESCALA_TC;
  return (usd < 0 ? -1 : 1) * Number(cents) / 100;
}

/** Suma de cada factura convertida por separado (igual que la base). */
export function brutoPesosDeUsd(montosUsd: number[], cotizacion: number): number {
  const cents = montosUsd.reduce((s, m) => s + Math.round(pesosDeUsd(m, cotizacion) * 100), 0);
  return cents / 100;
}

/** Cotización válida para pagar: número positivo. */
export function cotizacionValida(cotizacion: number | null | undefined): cotizacion is number {
  return typeof cotizacion === "number" && Number.isFinite(cotizacion) && cotizacion > 0;
}
