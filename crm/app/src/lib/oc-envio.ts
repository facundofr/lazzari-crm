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

/** Texto para WhatsApp o para copiar: datos de la OC y renglones, SIN precios (Augusto 16/10/2026) y el aviso del N° de OC. */
export function textoOCParaProveedor(oc: OCEnvio, items: OCEnvioItem[]): string {
  const lineas = [
    `*ORDEN DE COMPRA ${oc.numero}*`,
    "",
    `Fecha: ${formatDate(oc.fecha)}`,
    oc.fecha_entrega_estimada ? `Entrega estimada: ${formatDate(oc.fecha_entrega_estimada)}` : null,
    "",
    "*Items:*",
    ...(items.length ? items.map((it, i) => `${i + 1}. ${it.codigo ? `${it.codigo} - ` : ""}${it.descripcion}\n   ${it.cantidad}${it.unidad ? ` ${it.unidad}` : ""}`) : ["(sin items)"]),
    oc.observaciones ? `\nObs: ${oc.observaciones}` : null,
    "",
    `⚠️ *${avisoNumeroOC(oc.numero)}*`,
  ];
  return lineas.filter((l) => l !== null).join("\n");
}

/** Reclamo de lo que falta de una OC (recibida en parte o sin recibir): solo lo pendiente, SIN precios. */
export function textoReclamoOC(oc: { numero: string; fecha: string }, pendientes: Array<{ codigo?: string | null; descripcion: string; falta: number; unidad?: string | null }>, parcial: boolean): string {
  return [
    `*Seguimiento de la orden de compra ${oc.numero}* (${formatDate(oc.fecha)})`,
    "",
    "Hola, ¿cómo están?",
    parcial ? "Ya recibimos una parte del pedido. Nos falta recibir:" : "Todavía no recibimos el pedido. Nos falta recibir:",
    "",
    ...pendientes.map((it, i) => `${i + 1}. ${it.codigo ? `${it.codigo} - ` : ""}${it.descripcion}\n   Falta: ${it.falta}${it.unidad ? ` ${it.unidad}` : ""}`),
    "",
    "¿Me confirmás cuándo llegan? Gracias.",
    "",
    `⚠️ ${avisoNumeroOC(oc.numero)}`,
  ].join("\n");
}

/**
 * Reclamo armado desde los renglones de la OC (Compras Lazza, auditoría Tanda 6, 02/11/2026): solo lo que falta llegar.
 * null si ya llegó todo. "parcial" si llegó algo de cualquier renglón.
 */
export function reclamoDeOC(
  oc: { numero: string; fecha: string },
  items: Array<{ codigo?: string | null; descripcion?: string | null; cantidad: number | string; cantidad_recibida?: number | string | null; unidad?: string | null }>,
): string | null {
  const n = (v: unknown) => Number(v) || 0;
  const pendientes = items
    .map((i) => ({ codigo: i.codigo, descripcion: i.descripcion || i.codigo || "", unidad: i.unidad, falta: Math.round((n(i.cantidad) - n(i.cantidad_recibida)) * 100) / 100 }))
    .filter((i) => i.falta > 0);
  if (!pendientes.length) return null;
  return textoReclamoOC(oc, pendientes, items.some((i) => n(i.cantidad_recibida) > 0));
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
