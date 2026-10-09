export type PurchaseLine = { id?: string; tempId?: string; orden_id?: string; codigo?: string | null; descripcion: string; cantidad: number; precio_unitario: number; descuento_porcentaje?: number; iva_porcentaje?: number; unidad?: string };
export function canonicalPurchaseInvoiceNumber(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  const parts = normalized.match(/^(\d{1,5})[-/](\d{1,8})$/);
  return parts ? `${parts[1].padStart(5, "0")}-${parts[2].padStart(8, "0")}` : normalized;
}
export function assertCompleteInvoiceOrderSelection(selectedIds: string[], previousLinks: { orden_compra_id?: string | null; numero?: string | null }[]) {
  const selected = new Set(selectedIds);
  const missing = previousLinks.filter(link => link.orden_compra_id && !selected.has(link.orden_compra_id));
  if (missing.length) throw new Error(`Una factura anterior reúne varias OC y no tiene cantidades asignadas por OC. Agregá también ${[...new Set(missing.map(link => link.numero || link.orden_compra_id))].join(", ")} a la selección para conciliar el conjunto antes de guardar.`);
}
export function canMarkPurchaseOrdersPaid(previousInvoices: { estado?: string }[], remaining: number, invoiceTotal: number) {
  return previousInvoices.every(invoice => invoice.estado === "pagada") && Math.abs(remaining - invoiceTotal) <= 0.01;
}

export function purchaseCostInBudgetCurrency(
  cost: number,
  costCurrency: string,
  budgetCurrency: string,
  exchangeRate: number,
  exchangeRateDivisas = 0,
): number | null {
  const normalizedCostCurrency = costCurrency === "USD Divisa" ? "USD" : costCurrency;
  const normalizedBudgetCurrency = budgetCurrency === "USD Divisa" ? "USD" : budgetCurrency;
  if (normalizedCostCurrency === normalizedBudgetCurrency) return cost;
  const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : Number(exchangeRateDivisas);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (normalizedCostCurrency === "USD" && normalizedBudgetCurrency === "ARS") return cost * rate;
  if (normalizedCostCurrency === "ARS" && normalizedBudgetCurrency === "USD") return cost / rate;
  return null;
}

/** Recalcula el markup real sin modificar el precio de venta ya cotizado. */
export function markupForFixedSalePrice(
  salePrice: number,
  newCost: number,
  costCurrency: string,
  budgetCurrency: string,
  exchangeRate: number,
  exchangeRateDivisas = 0,
): number | null {
  const convertedCost = purchaseCostInBudgetCurrency(newCost, costCurrency, budgetCurrency, exchangeRate, exchangeRateDivisas);
  if (convertedCost === null || !Number.isFinite(convertedCost) || convertedCost <= 0 || !Number.isFinite(salePrice)) return null;
  return Math.round(((salePrice / convertedCost) - 1) * 10000) / 100;
}
export const purchaseLineKey = (line: PurchaseLine) => String(line.codigo || line.descripcion.replace(/\s*\[PR-[^\]]+\]\s*$/, "")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
const descriptionKey = (line: PurchaseLine) => purchaseLineKey({ ...line, codigo: null });

type PurchaseLineMatchEntry = { o: PurchaseLine; index: number };
export type PurchaseLineMatchInspection = {
  status: "matched" | "ambiguous" | "unmatched";
  candidates: PurchaseLine[];
};

function automaticPurchaseLineMatches(orders: PurchaseLine[], line: PurchaseLine): { status: PurchaseLineMatchInspection["status"]; entries: PurchaseLineMatchEntry[] } {
  const exact = orders.map((o, index) => ({ o, index })).filter(({ o }) => purchaseLineKey(o) === purchaseLineKey(line));
  if (exact.length === 1) return { status: "matched", entries: exact };
  if (exact.length > 1) {
    const sameVariant = exact.filter(({ o }) => descriptionKey(o) === descriptionKey(line));
    if (sameVariant.length) return { status: "matched", entries: sameVariant };
    return { status: "ambiguous", entries: exact };
  }
  const descriptions = orders.map((o, index) => ({ o, index })).filter(({ o }) => (!line.codigo || !o.codigo) && descriptionKey(o) === descriptionKey(line));
  if (new Set(descriptions.map(({ o }) => o.codigo).filter(Boolean)).size > 1) return { status: "ambiguous", entries: descriptions };
  return descriptions.length
    ? { status: "matched", entries: descriptions }
    : { status: "unmatched", entries: [] };
}

export function inspectPurchaseLineMatch(orders: PurchaseLine[], line: PurchaseLine): PurchaseLineMatchInspection {
  const result = automaticPurchaseLineMatches(orders, line);
  return { status: result.status, candidates: result.entries.map(({ o }) => o) };
}

export function reconcilePurchaseLines(orders: PurchaseLine[], invoice: PurchaseLine[], previous: PurchaseLine[] = [], manualAssignments: Record<string, string> = {}) {
  const remaining = orders.map(line => Number(line.cantidad));
  const matches = (line: PurchaseLine) => {
    const manualTarget = line.tempId ? manualAssignments[line.tempId] : undefined;
    if (manualTarget === "__extra__") return [];
    if (manualTarget) {
      const index = orders.findIndex((order) => order.id === manualTarget);
      if (index < 0) throw new Error(`La asignación manual de «${line.descripcion}» ya no corresponde a una OC seleccionada.`);
      return [{ o: orders[index], index }];
    }
    const automatic = automaticPurchaseLineMatches(orders, line);
    // Una coincidencia ambigua nunca se asigna al azar. Queda como extra y la
    // interfaz permite vincularla manualmente, pero no bloquea la factura.
    if (automatic.status === "ambiguous") return [];
    return automatic.entries;
  };
  for (const line of previous) {
    let quantity = Number(line.cantidad);
    for (const { index } of matches(line)) { const used = Math.min(Math.max(0, remaining[index]), quantity); remaining[index] -= used; quantity -= used; }
  }
  const costs = new Map<string, { line: PurchaseLine; cost: number; vat: number }>();
  const extras: PurchaseLine[] = [];
  for (const line of invoice) {
    let quantity = Number(line.cantidad);
    const cost = Number(line.precio_unitario) * (1 - Number(line.descuento_porcentaje || 0) / 100);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost < 0) throw new Error(`Cantidad o precio inválido en «${line.descripcion}».`);
    for (const { o, index } of matches(line)) {
      const used = Math.min(Math.max(0, remaining[index]), quantity);
      if (used <= 0) continue;
      if (o.id) {
        const prior = costs.get(o.id);
        if (prior && Math.abs(prior.cost - cost) > 0.005) throw new Error(`Hay dos costos distintos para «${line.descripcion}». Separá sus líneas de OC antes de guardar.`);
        costs.set(o.id, { line: o, cost, vat: Number(line.iva_porcentaje ?? 21) });
      }
      remaining[index] -= used; quantity -= used;
    }
    if (quantity > 0.000001) extras.push({ ...line, cantidad: quantity, precio_unitario: cost, descuento_porcentaje: 0 });
  }
  return { costs: [...costs.values()], extras, allQuantitiesBilled: remaining.length > 0 && remaining.every(quantity => quantity <= 0.000001) };
}
