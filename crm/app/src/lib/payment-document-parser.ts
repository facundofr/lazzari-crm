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
  const fecha = tipo === "cheque" || tipo === "echeq" ? (data.cheque_fecha || data.fecha) : data.fecha;
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("Revisá la fecha de pago o vencimiento del comprobante.");
  const parsed = new Date(`${fecha}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fecha) throw new Error("La fecha del comprobante no es válida.");
  return {
    tipo: tipo as typeof allowed[number], moneda: data.moneda as "ARS" | "USD", monto, fecha,
    banco: typeof data.banco === "string" ? data.banco : "",
    numero_cheque: typeof data.cheque_numero === "string" ? data.cheque_numero : "",
  };
}
