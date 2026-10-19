/**
 * Lista de OC (Compras nueva › OC), con el formato de Presupuestos (Augusto 16/10).
 * Cuatro estados de mercadería: Por enviar · Enviada · Parcial · Completo (cerrada = Completo).
 * Factura y pago van aparte. Una OC sale de la lista ("Terminadas") cuando llegó todo, está facturada y está pagada.
 * Botón Copiar: texto para el proveedor, sin precios.
 */

export type EstadoOC = "por_enviar" | "enviada" | "parcial" | "completo";
export type Eje = "falta" | "parcial" | "ok";

export const ESTADO_OC_LABEL: Record<EstadoOC, string> = {
  por_enviar: "Por enviar", enviada: "Enviada", parcial: "Parcial", completo: "Completo",
};

export interface ItemOC { codigo?: string | null; descripcion: string | null; cantidad: number; cantidad_recibida?: number | null }
export interface FacturaOC { estado: string; tipo_comprobante?: string | null; total?: number | null }
export interface OCParaLista {
  numero: string;
  estado: string;                    // estado de la base (borrador, enviada, recibida_parcial, recibida, cancelada…)
  pedido?: boolean | null;
  saldo_cerrado?: boolean | null;
  estado_facturacion?: string | null;
  estado_pago?: string | null;
  medio_pago?: string | null;
  total?: number | null;
  items: ItemOC[];
  facturas: FacturaOC[];
}

const n = (x: unknown) => Number(x) || 0;

export function llego(oc: Pick<OCParaLista, "items">) {
  return {
    recibido: oc.items.reduce((t, i) => t + n(i.cantidad_recibida), 0),
    pedido: oc.items.reduce((t, i) => t + n(i.cantidad), 0),
  };
}

export function estadoOC(oc: OCParaLista): EstadoOC {
  const { recibido, pedido } = llego(oc);
  if (oc.saldo_cerrado || oc.estado === "recibida" || (pedido > 0 && recibido >= pedido)) return "completo";
  if (recibido > 0 || oc.estado === "recibida_parcial") return "parcial";
  return oc.pedido ? "enviada" : "por_enviar";
}

const facturasValidas = (oc: OCParaLista) => oc.facturas.filter(f => f.estado !== "anulada" && !/^N[CD]/i.test(f.tipo_comprobante || ""));

export function ejeFactura(oc: OCParaLista): Eje {
  if (oc.estado_facturacion === "facturada") return "ok";
  const fcs = facturasValidas(oc);
  if (oc.estado_facturacion === "parcial") return oc.saldo_cerrado ? "ok" : "parcial";
  if (!fcs.length) return "falta";
  const facturado = fcs.reduce((t, f) => t + n(f.total), 0);
  return oc.saldo_cerrado || facturado >= n(oc.total) * 0.99 ? "ok" : "parcial";
}

export function ejePago(oc: OCParaLista): Eje {
  if (oc.estado_pago === "pagada") return "ok";
  const fcs = facturasValidas(oc);
  if (fcs.length && fcs.every(f => f.estado === "pagada")) return "ok";
  return fcs.some(f => f.estado === "pagada") ? "parcial" : "falta";
}

/** Terminada (Compras nueva) = llegó todo + facturada + pagada. Sale de la lista y pasa a "Terminadas". */
export function ocTerminada(oc: OCParaLista): boolean {
  return estadoOC(oc) === "completo" && ejeFactura(oc) === "ok" && ejePago(oc) === "ok";
}

/** Terminada en Compras Lazza (Augusto 19/10): la OC solo controla que llegue todo; facturas y pagos van aparte. */
export function ocTerminadaLazza(oc: OCParaLista): boolean {
  return estadoOC(oc) === "completo";
}

/** Atrasada: pasó la fecha de entrega estimada (o 7 días desde que se pidió) y no llegó todo. */
export function ocAtrasada(oc: OCParaLista & { fecha_entrega_estimada?: string | null; pedido_at?: string | null; fecha?: string | null }, hoy: string, diasAviso = 7): boolean {
  if (estadoOC(oc) === "completo" || estadoOC(oc) === "por_enviar") return false;
  if (oc.fecha_entrega_estimada) return oc.fecha_entrega_estimada.slice(0, 10) < hoy;
  // OC viejas sin fecha de pedido: se cuenta desde la fecha de la OC.
  const desde = oc.pedido_at || (oc.fecha ? `${oc.fecha.slice(0, 10)}T12:00:00` : null);
  if (!desde) return false;
  const dias = Math.floor((Date.parse(`${hoy}T12:00:00`) - Date.parse(desde)) / 86_400_000);
  return dias >= diasAviso;
}

const cant = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100).replace(".", ","));

/** "Botín Prusiano (20), Guante nitrilo (5)" — como el Detalle de Presupuestos. */
export function descripcionCorta(items: ItemOC[]): string {
  return items.filter(i => (i.descripcion || i.codigo || "").trim())
    .map(i => `${(i.descripcion || i.codigo || "").trim()} (${cant(n(i.cantidad))})`).join(", ");
}

/**
 * Texto para el proveedor (Augusto 19/10): solo "Pedido:" y los artículos con cantidades.
 * Sin proveedor, sin N° de OC, sin precios y sin pedirles que indiquen la OC. Se pega en el mail o WhatsApp.
 */
export function textoCopiarOC(oc: { items: ItemOC[] }): string {
  const renglones = oc.items.filter(i => (i.descripcion || i.codigo || "").trim())
    .map(i => `${cant(n(i.cantidad))} × ${(i.descripcion || i.codigo || "").trim()}`);
  return ["Pedido:", ...renglones].join("\n");
}
