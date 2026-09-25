import { parseInvoiceNumber } from "./invoice-number-parser";

export function paymentDocumentFields(data: Record<string, unknown>) {
  const allowed = ["transferencia", "deposito", "cheque", "echeq", "efectivo", "tarjeta"] as const;
  const tipo = data.tipo;
  if (typeof tipo !== "string" || !allowed.includes(tipo as typeof allowed[number])) {
    throw new Error(typeof tipo === "string" && tipo.startsWith("retencion_")
      ? "El archivo contiene una retención, no una transferencia. Revisala en la sección de retenciones; no se agregó como medio de pago."
      : "No se pudo identificar el medio de pago. Completalo manualmente; no se agregó una transferencia por defecto.");
  }
  if (data.moneda !== "ARS" && data.moneda !== "USD") throw new Error("No se pudo identificar la moneda del comprobante. Revisala manualmente.");
  const monto = parseInvoiceNumber(data.monto, "importe del comprobante");
  if (monto <= 0) throw new Error("El importe del comprobante debe ser mayor que cero.");
  const validDate = (value: unknown, label: string, required = false) => {
    if (value == null || value === "") {
      if (required) throw new Error(`Revisá la ${label} del comprobante.`);
      return "";
    }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Revisá la ${label} del comprobante.`);
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`La ${label} del comprobante no es válida.`);
    return value;
  };
  const fechaEmision = validDate(data.fecha_emision, "fecha de emisión");
  const fechaCobro = validDate(data.fecha_cobro, "fecha de cobro o acreditación");
  const fecha = validDate(tipo === "cheque" || tipo === "echeq"
    ? (data.cheque_fecha || fechaCobro || data.fecha || fechaEmision)
    : (fechaCobro || data.fecha || fechaEmision), "fecha de pago o vencimiento", true);
  return {
    tipo: tipo as typeof allowed[number], moneda: data.moneda as "ARS" | "USD", monto, fecha,
    fecha_emision: fechaEmision,
    fecha_cobro: fechaCobro || fecha,
    banco: typeof data.banco === "string" ? data.banco : "",
    numero_cheque: typeof data.cheque_numero === "string" ? data.cheque_numero : "",
  };
}

export function parsedPaymentForSingleInvoice(
  payments: Array<{ monto: number; moneda: "ARS" | "USD" }>,
  invoices: Array<{ id: string; moneda: string; saldo_pendiente: number; selected: boolean }>,
) {
  if (payments.length === 0) return null;
  const currencies = new Set(payments.map((payment) => payment.moneda));
  if (currencies.size !== 1) return null;
  const moneda = payments[0].moneda;
  const selected = invoices.filter((invoice) => invoice.selected && invoice.moneda === moneda);
  const candidates = selected.length === 1
    ? selected
    : selected.length === 0
      ? invoices.filter((invoice) => invoice.moneda === moneda && invoice.saldo_pendiente > 0)
      : [];
  if (candidates.length !== 1) return null;
  const total = Math.round(payments.reduce((sum, payment) => sum + Number(payment.monto || 0), 0) * 100) / 100;
  if (!Number.isFinite(total) || total <= 0) return null;
  return { invoiceId: candidates[0].id, amount: Math.min(total, Number(candidates[0].saldo_pendiente)) };
}
