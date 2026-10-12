// Órdenes de pago vistas desde Compras: lista de OP de una OC y su PDF (el mismo que genera Finanzas). Solo lectura.
import { generateOrdenPagoPDF, getSociedadPDF, openPDFWindow } from "@/lib/pdf-templates";

export interface OPResumen {
  id: string;
  numero: string;
  fecha: string;
  estado: string;
  moneda: "ARS" | "USD";
  neto: number;
  certificado_retencion_url: string | null;
}

/** OP (sin anuladas) que pagaron alguna de estas facturas de compra, de la más nueva a la más vieja. */
export async function cargarOPsDeFacturas(supabase: any, facturaIds: string[]): Promise<OPResumen[]> {
  if (facturaIds.length === 0) return [];
  const { data, error } = await supabase
    .from("op_facturas_compra")
    .select("orden_pago_id, ordenes_pago!inner(id, numero, fecha, estado, moneda, neto_a_pagar, certificado_retencion_url)")
    .in("factura_compra_id", facturaIds);
  if (error) throw error;
  const porId = new Map<string, OPResumen>();
  for (const link of data || []) {
    const op = Array.isArray(link.ordenes_pago) ? link.ordenes_pago[0] : link.ordenes_pago;
    if (!op?.id || op.estado === "anulada" || porId.has(op.id)) continue;
    porId.set(op.id, {
      id: op.id,
      numero: op.numero || "OP",
      fecha: op.fecha,
      estado: op.estado || "pendiente",
      moneda: op.moneda === "USD" ? "USD" : "ARS",
      neto: Number(op.neto_a_pagar ?? 0),
      certificado_retencion_url: op.certificado_retencion_url || null,
    });
  }
  return [...porId.values()].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
}

/** Abre el PDF de la OP, armado igual que en Finanzas → Pagos. */
export async function abrirOrdenPagoPDF(supabase: any, opId: string, sociedad: Parameters<typeof getSociedadPDF>[0]): Promise<void> {
  const { data: r, error } = await supabase
    .from("ordenes_pago")
    .select("*, proveedores(razon_social, cuit, direccion)")
    .eq("id", opId)
    .single();
  if (error) throw error;

  const { data: links, error: linksError } = await supabase
    .from("op_facturas_compra")
    .select("factura_compra_id, monto, facturas_compra!inner(id, numero_factura, fecha, total, notas)")
    .eq("orden_pago_id", opId);
  if (linksError) throw linksError;
  const facturas = (links || []).map((link: any) => {
    const invoice = Array.isArray(link.facturas_compra) ? link.facturas_compra[0] : link.facturas_compra;
    const notas = String(invoice?.notas || "");
    const detalle = /^Factura de transporte\s*(?:[—-]|$)/i.test(notas) ? notas.replace(/^Factura de transporte\s*[—-]?\s*/i, "").trim() : "";
    return {
      numero: invoice?.numero_factura || "—",
      fecha: invoice?.fecha,
      monto: Number(link.monto ?? invoice?.total),
      ...(detalle ? { detalle } : {}),
    };
  });

  const moneda: "ARS" | "USD" = r.moneda === "USD" ? "USD" : "ARS";
  const neto = Number(r.neto_a_pagar ?? r.neto ?? 0);
  const mediosPago = r.medios_pago ? (typeof r.medios_pago === "string" ? JSON.parse(r.medios_pago) : r.medios_pago) : null;
  const medios = Array.isArray(mediosPago) && mediosPago.length > 0
    ? mediosPago.map((m: any) => ({ tipo: m.tipo, monto: m.monto, fecha: m.fecha, banco: m.banco, numero_cheque: m.numero_cheque, moneda: m.moneda, cotizacion: m.cotizacion }))
    : [{ tipo: r.medio_pago ?? "transferencia", monto: neto, fecha: r.fecha, banco: "", numero_cheque: "", moneda, cotizacion: 1 }];

  const html = generateOrdenPagoPDF({
    numero: r.numero || "",
    fecha: r.fecha,
    estado: r.estado ?? "pendiente",
    moneda,
    monto_bruto: Number(r.monto_bruto),
    retencion_ganancias_pct: Number(r.retencion_ganancias_pct ?? 0),
    retencion_ganancias_monto: Number(r.retencion_ganancias_monto ?? 0),
    neto,
    notas: r.notas ?? "",
    proveedor: { razon_social: r.proveedores?.razon_social ?? "—", cuit: r.proveedores?.cuit || "", direccion: r.proveedores?.direccion || "" },
    medios,
    facturas_vinculadas: facturas,
  }, getSociedadPDF(sociedad));
  openPDFWindow(html, `${r.numero || "Orden-de-pago"}.pdf`);
}
