export type PurchaseLine = { id?: string; orden_id?: string; codigo?: string | null; descripcion: string; cantidad: number; precio_unitario: number; descuento_porcentaje?: number; iva_porcentaje?: number; unidad?: string };
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
export const purchaseLineKey = (line: PurchaseLine) => String(line.codigo || line.descripcion.replace(/\s*\[PR-[^\]]+\]\s*$/, "")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
const descriptionKey = (line: PurchaseLine) => purchaseLineKey({ ...line, codigo: null });
export function reconcilePurchaseLines(orders: PurchaseLine[], invoice: PurchaseLine[], previous: PurchaseLine[] = []) {
  const remaining = orders.map(line => Number(line.cantidad));
  const matches = (line: PurchaseLine) => {
    const exact = orders.map((o, index) => ({ o, index })).filter(({ o }) => purchaseLineKey(o) === purchaseLineKey(line));
    if (exact.length) return exact;
    const descriptions = orders.map((o, index) => ({ o, index })).filter(({ o }) => (!line.codigo || !o.codigo) && descriptionKey(o) === descriptionKey(line));
    if (new Set(descriptions.map(({ o }) => o.codigo).filter(Boolean)).size > 1) throw new Error(`El artículo «${line.descripcion}» coincide con varios códigos. Revisá el código antes de guardar.`);
    return descriptions;
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
