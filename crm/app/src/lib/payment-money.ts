/** Normaliza importes financieros al centavo antes de enviarlos a Postgres. */
export function roundPaymentMoney(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Suma importes y elimina residuos binarios como 60000.00000000001. */
export function sumPaymentMoney(values: number[]): number {
  return roundPaymentMoney(values.reduce((sum, value) => sum + value, 0));
}
