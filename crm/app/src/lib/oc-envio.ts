/**
 * Envío de la OC al proveedor (WhatsApp, mail o copiar): textos y PDF comunes.
 * Toda OC que sale pide que la factura traiga el N° de OC: así la IA, al leer la factura, la cruza sola.
 */
import { formatCurrency, formatDate } from "@/lib/utils";
import { generateOrdenCompraPDF, getSociedadPDF } from "@/lib/pdf-templates";
import { linkWhatsApp } from "@/lib/saldo-proveedores";

export const avisoNumeroOC = (numero: string) => `IMPORTANTE: por favor indicar el N° de orden de compra ${numero} en la factura (y en el remito).`;

export interface OCEnvio {
  numero: string; fecha: string; fecha_entrega_estimada?: string | null; estado: string; moneda: string;
  subtotal: number; iva: number; total: number; observaciones?: string | null;
  presupuesto_origen?: { numero: string } | null;
  proveedor: {
    razon_social: string; cuit?: string | null; condicion_iva?: string | null; direccion?: string | null; localidad?: string | null;
    provincia?: string | null; email?: string | null; telefono?: string | null; forma_pago?: string | null;
  };
}
export interface OCEnvioItem { codigo?: string | null; descripcion: string; cantidad: number; unidad?: string | null; precio_unitario: number; subtotal: number }

const ESTADOS: Record<string, string> = { pendiente: "Pendiente", enviada: "Enviada", confirmada: "Confirmada", recibida_parcial: "Recibida parcial", recibida: "Recibida", cancelada: "Cancelada" };

/** Texto para WhatsApp o para copiar: datos de la OC, renglones, total y el aviso del N° de OC. */
export function textoOCParaProveedor(oc: OCEnvio, items: OCEnvioItem[]): string {
  const mon = (oc.moneda === "USD" ? "USD" : "ARS") as "ARS" | "USD";
  const lineas = [
    `*ORDEN DE COMPRA ${oc.numero}*`,
    "",
    `Fecha: ${formatDate(oc.fecha)}`,
    oc.fecha_entrega_estimada ? `Entrega estimada: ${formatDate(oc.fecha_entrega_estimada)}` : null,
    `Moneda: ${mon}`,
    "",
    "*Items:*",
    ...(items.length ? items.map((it, i) => `${i + 1}. ${it.codigo ? `${it.codigo} - ` : ""}${it.descripcion}\n   ${it.cantidad}${it.unidad ? ` ${it.unidad}` : ""} x ${formatCurrency(Number(it.precio_unitario), mon)}`) : ["(sin items)"]),
    "",
    `*Total: ${formatCurrency(Number(oc.total), mon)}*`,
    oc.observaciones ? `\nObs: ${oc.observaciones}` : null,
    "",
    `⚠️ *${avisoNumeroOC(oc.numero)}*`,
  ];
  return lineas.filter((l) => l !== null).join("\n");
}

/** Link de WhatsApp con la OC escrita (null si el número no sirve). */
export function linkWhatsAppOC(numero: string | null | undefined, texto: string): string | null {
  const base = linkWhatsApp(numero);
  return base ? `${base}?text=${encodeURIComponent(texto)}` : null;
}

/** PDF (HTML) de la OC, el mismo que se descarga desde Compras. */
export function htmlOCParaProveedor(
  oc: OCEnvio, items: OCEnvioItem[],
  sociedad: Parameters<typeof getSociedadPDF>[0],
): string {
  return generateOrdenCompraPDF({
    numero: oc.numero, fecha: oc.fecha, fecha_entrega_estimada: oc.fecha_entrega_estimada ?? null,
    estado: oc.estado, estadoLabel: ESTADOS[oc.estado] || oc.estado,
    moneda: (oc.moneda === "USD" ? "USD" : "ARS"),
    subtotal: Number(oc.subtotal), iva: Number(oc.iva), total: Number(oc.total),
    observaciones: oc.observaciones ?? null, presupuesto_origen: oc.presupuesto_origen ?? null,
    proveedor: oc.proveedor,
    items: items.map((it) => ({ codigo: it.codigo || "", descripcion: it.descripcion, cantidad: Number(it.cantidad), unidad: it.unidad || "u", precio_unitario: Number(it.precio_unitario), subtotal: Number(it.subtotal) })),
  } as Parameters<typeof generateOrdenCompraPDF>[0], getSociedadPDF(sociedad));
}

/** Agrega el aviso del N° de OC al cuerpo HTML del mail si la plantilla no lo trae. */
export function cuerpoMailConAviso(cuerpoHtml: string, numero: string): string {
  if (/indicar el N° de (orden de compra|OC)/i.test(cuerpoHtml)) return cuerpoHtml;
  return `${cuerpoHtml}<p style="margin-top:12px;padding:8px 12px;border:2px solid #FF4500;border-radius:6px"><strong>${avisoNumeroOC(numero)}</strong></p>`;
}

// Contactos que NO son de ventas: a ellos no se les manda la OC.
const NO_VENTAS = /cobr|admin|pago|factur|tesor|contab/i;
const ES_VENTAS = /vent|comercial|vendedor/i;
/** El contacto al que se le manda la OC: primero el que dice Ventas; si no, uno sin cargo de cobros/administración. */
export function contactoVentas<T extends { cargo?: string | null }>(cs: T[]): T | null {
  return cs.find((c) => ES_VENTAS.test(c.cargo || "")) || cs.find((c) => !NO_VENTAS.test(c.cargo || "")) || null;
}
