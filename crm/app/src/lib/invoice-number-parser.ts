/** Numeric extraction must never silently turn unreadable text into money. */
export class InvoiceNumberError extends Error {}

export function parseInvoiceNumber(value: unknown, field = "importe"): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") throw new InvoiceNumberError(`No se pudo interpretar ${field}. Revisalo manualmente.`);
  let text = value.trim().replace(/\s/g, "").replace(/^(?:ARS|USD|US\$|\$)/i, "");
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^-?\d+(?:[.,]\d+)*$/.test(text)) throw new InvoiceNumberError(`No se pudo interpretar ${field}. Revisalo manualmente.`);
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  let normalized = text;
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const parts = text.split(decimal);
    if (parts.length !== 2 || !/^\d+$/.test(parts[1])) throw new InvoiceNumberError(`Formato inválido en ${field}. Revisalo manualmente.`);
    const groups = parts[0].replace(/^-/, "").split(grouping);
    if (groups[0].length > 3 || !groups.slice(1).every(g => g.length === 3)) throw new InvoiceNumberError(`Separadores inválidos en ${field}. Revisalo manualmente.`);
    normalized = parts[0].split(grouping).join("") + "." + parts[1];
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const parts = text.split(separator);
    if (parts.length > 2) {
      if (parts[0].replace(/^-/, "").length > 3 || !parts.slice(1).every(g => g.length === 3)) throw new InvoiceNumberError(`Separadores inválidos en ${field}. Revisalo manualmente.`);
      normalized = parts.join("");
    } else {
      // "1.234" can mean either 1234 or 1.234. Do not guess for a financial document.
      if (parts[1].length === 3 && Number(parts[0]) !== 0) throw new InvoiceNumberError(`El valor de ${field} es ambiguo (${value}). Revisá si contiene decimales o separador de miles.`);
      normalized = parts.join(".");
    }
  }
  const result = Number(normalized);
  if (!Number.isFinite(result)) throw new InvoiceNumberError(`El valor de ${field} no es válido.`);
  return negative ? -Math.abs(result) : result;
}

export function normalizeInvoiceNumbers(parsed: Record<string, any>) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new InvoiceNumberError("El comprobante no tiene un formato válido.");
  for (const field of ["subtotal", "iva", "percepciones", "total", "iva_porcentaje", "descuento_general_porcentaje"]) {
    if (parsed[field] != null) parsed[field] = parseInvoiceNumber(parsed[field], field);
  }
  if (Array.isArray(parsed.items)) {
    parsed.items = parsed.items.map((item: any, index: number) => {
      if (!item || typeof item !== "object") throw new InvoiceNumberError(`El artículo ${index + 1} no se pudo interpretar.`);
      return {
        ...item,
        cantidad: item.cantidad == null ? 1 : parseInvoiceNumber(item.cantidad, `cantidad del artículo ${index + 1}`),
        precio_unitario: parseInvoiceNumber(item.precio_unitario, `precio del artículo ${index + 1}`),
        descuento_porcentaje: item.descuento_porcentaje == null ? 0 : parseInvoiceNumber(item.descuento_porcentaje, "descuento"),
        iva_porcentaje: item.iva_porcentaje == null ? (parsed.iva_porcentaje ?? 21) : parseInvoiceNumber(item.iva_porcentaje, "porcentaje de IVA"),
      };
    });
  }
  return parsed;
}
