/**
 * Factura de proveedor leída por la IA (/api/parse-factura-compra) en el formato que usan la conciliación
 * y "Cargar factura": encabezado, renglones con precio neto y la clave de cada renglón para el cruce.
 */
import { todayAR } from "@/lib/utils";
import type { InvoiceLineInput } from "@/lib/purchase-matching";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ItemFactura {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_porcentaje: number;
  iva_porcentaje: number;
  unidad: string;
}

export interface FacturaCarga {
  localId: string;
  dbId: string | null;            // si se retoma una conciliación parcial
  file: File | null;
  archivoNombre: string;
  numero: string;
  tipo: string;
  fecha: string;
  vencimiento: string;
  cae: string;
  moneda: "ARS" | "USD";
  subtotal: number;
  iva: number;
  ivaPorcentaje: number;
  percepciones: number;
  total: number;
  items: ItemFactura[];
  cuit: string;
  /** Números de OC que la factura cita impresos ("Su OC N° 1199"). */
  ocRefs?: string[];
  /** Emisor leído por la IA (para aprender el nombre de fantasía del proveedor). */
  razonSocialLeida?: string;
  nombreFantasiaLeido?: string;
}


export function tipoComprobante(raw: string): string {
  const t = String(raw || "").toUpperCase().trim();
  if (t === "A" || t === "FACTURA A" || t === "FC A") return "FC A";
  if (t === "B" || t === "FACTURA B" || t === "FC B") return "FC B";
  if (t === "C" || t === "FACTURA C" || t === "FC C") return "FC C";
  return t || "FC A";
}

export const precioNeto = (it: ItemFactura) => round2(it.precio_unitario * (1 - (it.descuento_porcentaje || 0) / 100));
export const lineKey = (f: FacturaCarga, i: number) => `${f.localId}:${i}`;

/** Líneas de una factura ya leída, como las cruza la conciliación (para el cruce automático de la carga masiva). */
export function lineasParaCruce(file: File, d: any): { lineas: InvoiceLineInput[]; ocRefs: string[]; facturaRef: string } {
  const f = facturaDesdeDatos(file, d);
  const facturaRef = f.numero || f.localId;
  return {
    facturaRef, ocRefs: f.ocRefs || [],
    lineas: f.items.map((it, i) => ({ key: lineKey(f, i), facturaRef, codigo: it.codigo || null, descripcion: it.descripcion, cantidad: it.cantidad, precio: precioNeto(it) })),
  };
}

/** Arma una factura de la conciliación con los datos que devolvió /api/parse-factura-compra. */
export function facturaDesdeDatos(file: File, d: any): FacturaCarga {
  const ivaPct = d.iva_porcentaje != null ? Number(d.iva_porcentaje) || 0 : 21;
  return {
    localId: `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    dbId: null,
    file,
    archivoNombre: file.name,
    numero: String(d.numero_factura || ""),
    tipo: tipoComprobante(d.tipo_comprobante),
    fecha: d.fecha || todayAR(),
    vencimiento: d.fecha_vencimiento || "",
    cae: d.cae || "",
    moneda: d.moneda === "USD" ? "USD" : "ARS",
    subtotal: Number(d.subtotal) || 0,
    iva: Number(d.iva) || 0,
    ivaPorcentaje: ivaPct,
    percepciones: Number(d.percepciones) || 0,
    total: Number(d.total) || 0,
    cuit: String(d.proveedor?.cuit || "").replace(/\D/g, ""),
    ocRefs: (Array.isArray(d.referencias_oc) ? d.referencias_oc : []).map((x: unknown) => String(x || "").trim()).filter(Boolean),
    razonSocialLeida: String(d.proveedor?.razon_social || "").trim(),
    nombreFantasiaLeido: String(d.proveedor?.nombre_fantasia || "").trim(),
    items: (Array.isArray(d.items) ? d.items : []).map((it: any) => ({
      codigo: String(it.codigo || ""),
      descripcion: String(it.descripcion || ""),
      cantidad: it.cantidad == null ? 1 : Number(it.cantidad) || 0,
      precio_unitario: Number(it.precio_unitario) || 0,
      descuento_porcentaje: Math.max(0, Math.min(100, Number(it.descuento_porcentaje ?? d.descuento_general_porcentaje) || 0)),
      iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : ivaPct,
      unidad: it.unidad || "UN",
    })).filter((it: ItemFactura) => it.descripcion && it.cantidad > 0),
  };
}
