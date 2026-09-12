export type PurchaseCurrency = "ARS" | "USD";

export function normalizePurchaseCurrency(value: unknown): PurchaseCurrency {
  return String(value || "ARS").trim().toUpperCase().startsWith("USD") ? "USD" : "ARS";
}

export function groupOwnStockItemsByCurrency<T extends { costo_moneda?: string | null }>(items: T[]) {
  const groups = new Map<PurchaseCurrency, T[]>();
  for (const item of items) {
    const currency = normalizePurchaseCurrency(item.costo_moneda);
    groups.set(currency, [...(groups.get(currency) || []), item]);
  }
  return Array.from(groups, ([moneda, rows]) => ({ moneda, items: rows }));
}

export function calculateOwnStockPurchaseOrder(items: Array<{
  cantidad: number | string;
  precio_costo: number | string;
  iva_porcentaje?: number | string | null;
}>, withoutVat: boolean) {
  const subtotal = Math.round(items.reduce((sum, item) =>
    sum + Number(item.precio_costo || 0) * Number(item.cantidad || 0), 0) * 100) / 100;
  const iva = withoutVat ? 0 : Math.round(items.reduce((sum, item) => {
    const amount = Number(item.precio_costo || 0) * Number(item.cantidad || 0);
    const rate = item.iva_porcentaje == null ? 21 : Number(item.iva_porcentaje);
    return sum + amount * rate / 100;
  }, 0) * 100) / 100;
  return { subtotal, iva, total: Math.round((subtotal + iva) * 100) / 100 };
}
