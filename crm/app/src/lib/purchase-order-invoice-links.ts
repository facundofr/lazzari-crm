export type InvoiceLinkStatus = "conocido" | "desconocido";

type LinkedInvoice = {
  id: string;
  numero_factura: string;
  tipo_comprobante: string;
  estado: string;
  total: number;
  moneda: string;
  archivo_url: string | null;
  archivo_nombre?: string | null;
};

export function attachPurchaseOrderInvoices<T extends { id: string }>(
  orders: T[],
  junctionRows: Array<{ orden_compra_id: string; facturas_compra?: LinkedInvoice | LinkedInvoice[] | null }>,
  legacyInvoices: Array<LinkedInvoice & { orden_compra_id: string }>,
  errors: { junction?: string | null; legacy?: string | null } = {},
) {
  const linksByOrder = new Map<string, LinkedInvoice[]>();
  for (const row of junctionRows) {
    const linked = Array.isArray(row.facturas_compra) ? row.facturas_compra : row.facturas_compra ? [row.facturas_compra] : [];
    const existing = linksByOrder.get(row.orden_compra_id) || [];
    for (const invoice of linked) {
      if (!existing.some((item) => item.id === invoice.id)) existing.push(invoice);
    }
    linksByOrder.set(row.orden_compra_id, existing);
  }
  for (const invoice of legacyInvoices) {
    const existing = linksByOrder.get(invoice.orden_compra_id) || [];
    if (!existing.some((item) => item.id === invoice.id)) existing.push(invoice);
    linksByOrder.set(invoice.orden_compra_id, existing);
  }

  const errorParts = [
    errors.junction ? `vínculos actuales: ${errors.junction}` : "",
    errors.legacy ? `vínculos históricos: ${errors.legacy}` : "",
  ].filter(Boolean);
  return {
    orders: orders.map((order) => ({
      ...order,
      facturas_vinculadas: linksByOrder.get(order.id) || [],
      facturas_vinculadas_estado: errorParts.length ? "desconocido" as const : "conocido" as const,
    })),
    error: errorParts.length
      ? `Las órdenes reales se cargaron, pero no se pudo verificar si todas tienen facturas vinculadas (${errorParts.join("; ")}). La edición queda bloqueada hasta reintentar.`
      : "",
  };
}
