// Órdenes de pago: lista de OP de unas facturas de compra y su PDF (el mismo que genera Finanzas).
// La usan Compras, Facturas y Finanzas Lazza (descargar y mandar por mail, components/finanzas-lazza/orden-pago-doc).
import { generateOrdenPagoPDF, getSociedadPDF, openPDFWindow } from "@/lib/pdf-templates";
import { pesosDeUsd } from "@/lib/op-usd-pesos";
import { formatCurrency } from "@/lib/utils";
import { detalleRetencion, pagosAnteriores, type DetalleRetencion, type PagoDelMes } from "@/lib/certificado-retencion";
import { RETENCION_DEFAULT } from "@/lib/plan-pagos";

export interface OPResumen {
  id: string;
  numero: string;
  fecha: string;
  estado: string;
  moneda: "ARS" | "USD";
  neto: number;
  certificado_retencion_url: string | null;
  /** Comprobantes que se adjuntaron al hacer la OP (transferencia, etc.). */
  archivos: { nombre: string; url: string }[];
}

/** OP (sin anuladas) que pagaron alguna de estas facturas de compra, de la más nueva a la más vieja. */
export async function cargarOPsDeFacturas(supabase: any, facturaIds: string[]): Promise<OPResumen[]> {
  return [...(await opsPorFactura(supabase, facturaIds)).values()].flat()
    .filter((op, i, todas) => todas.findIndex((x) => x.id === op.id) === i)
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
}

/** OP (sin anuladas) de cada factura de compra: factura_compra_id → OP, de la más nueva a la más vieja. */
export async function opsPorFactura(supabase: any, facturaIds: string[]): Promise<Map<string, OPResumen[]>> {
  const out = new Map<string, OPResumen[]>();
  for (let i = 0; i < facturaIds.length; i += 200) {
    const { data, error } = await supabase
      .from("op_facturas_compra")
      .select("factura_compra_id, orden_pago_id, ordenes_pago!inner(id, numero, fecha, estado, moneda, neto_a_pagar, certificado_retencion_url, archivos)")
      .in("factura_compra_id", facturaIds.slice(i, i + 200));
    if (error) throw error;
    for (const link of data || []) {
      const op = Array.isArray(link.ordenes_pago) ? link.ordenes_pago[0] : link.ordenes_pago;
      if (!op?.id || op.estado === "anulada") continue;
      const lista = out.get(link.factura_compra_id) || [];
      if (lista.some((x) => x.id === op.id)) continue;
      lista.push({
        id: op.id,
        numero: op.numero || "OP",
        fecha: op.fecha,
        estado: op.estado || "pendiente",
        moneda: op.moneda === "USD" ? "USD" : "ARS",
        neto: Number(op.neto_a_pagar ?? 0),
        certificado_retencion_url: op.certificado_retencion_url || null,
        archivos: parsear(op.archivos).filter((a: any) => a?.url).map((a: any) => ({ nombre: a.nombre || "comprobante", url: a.url })),
      });
      out.set(link.factura_compra_id, lista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")));
    }
  }
  return out;
}

const parsear = (v: unknown): any[] => { try { return Array.isArray(v) ? v : v ? JSON.parse(String(v)) : []; } catch { return []; } };

/** Facturas que paga la OP, como en el PDF de Finanzas (OP en pesos de facturas en US$: en pesos con su cotización). */
export async function facturasDeOP(supabase: any, opId: string): Promise<{ numero: string; fecha: string; monto: number; detalle?: string }[]> {
  const { data, error } = await supabase.from("op_facturas_compra")
    .select("factura_compra_id, monto, facturas_compra!inner(id, numero_factura, fecha, total, tipo, notas)")
    .eq("orden_pago_id", opId);
  if (error) throw error;
  const { data: opTc } = await supabase.from("ordenes_pago").select("cotizacion, moneda_documentos").eq("id", opId).maybeSingle();
  const tcOp = opTc?.moneda_documentos === "USD" && Number(opTc?.cotizacion) > 0 ? Number(opTc.cotizacion) : null;
  const vistas = new Set<string>();
  return (data || []).map((link: any) => {
    const fc = Array.isArray(link.facturas_compra) ? link.facturas_compra[0] : link.facturas_compra;
    if (!fc?.id) throw new Error("La OP tiene un documento vinculado que ya no existe.");
    if (vistas.has(fc.id)) throw new Error(`La factura ${fc.numero_factura || "sin número"} está vinculada dos veces a la misma OP.`);
    vistas.add(fc.id);
    const notas = String(fc.notas || "");
    const transporte = /^Factura de transporte\s*(?:[—-]|$)/i.test(notas) ? notas.replace(/^Factura de transporte\s*[—-]?\s*/i, "").trim() : "";
    const montoDoc = Number(link.monto ?? fc.total);
    const usd = tcOp ? `${formatCurrency(montoDoc, "USD")} × ${formatCurrency(tcOp, "ARS")}` : "";
    const detalle = [transporte, usd].filter(Boolean).join(" · ");
    return { numero: fc.numero_factura || "—", fecha: fc.fecha, monto: tcOp ? pesosDeUsd(montoDoc, tcOp) : montoDoc, ...(detalle ? { detalle } : {}) };
  });
}

/**
 * La cuenta de la retención de Ganancias para el certificado: la misma que hizo la OP, con los pagos al proveedor
 * del mes cargados antes que ella y el concepto que tiene hoy (lib/certificado-retencion.ts).
 */
async function retencionDeOP(supabase: any, op: any): Promise<DetalleRetencion | undefined> {
  if (!(Number(op.retencion_ganancias_monto) > 0)) return undefined;
  const mes = String(op.fecha).slice(0, 7);
  const [year, month] = mes.split("-").map(Number);
  const mesSiguiente = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const [ops, directos, cfg] = await Promise.all([
    supabase.from("ordenes_pago").select("id, proveedor_id, fecha, created_at, base_retencion_ganancias, retencion_ganancias_monto")
      .eq("sociedad_id", op.sociedad_id).eq("proveedor_id", op.proveedor_id).neq("estado", "anulada")
      .gte("fecha", `${mes}-01`).lt("fecha", mesSiguiente),
    // Pagos directos de una factura (sin OP): la OP también los suma al acumulado del mes.
    supabase.from("movimientos").select("id, proveedor_id, fecha, created_at, base_retencion_ganancias, retencion_ganancias_monto, anulado")
      .eq("sociedad_id", op.sociedad_id).eq("proveedor_id", op.proveedor_id).eq("tipo", "pago")
      .not("factura_compra_id", "is", null).is("nota_credito_compra_id", null)
      .gte("fecha", `${mes}-01`).lt("fecha", mesSiguiente),
    supabase.from("retencion_config").select("minimo_ganancias, tasa_ganancias_ri").eq("sociedad_id", op.sociedad_id).maybeSingle(),
  ]);
  for (const r of [ops, directos, cfg]) if (r.error) throw r.error;
  const pago = (x: any): PagoDelMes => ({
    id: x.id, proveedor_id: x.proveedor_id, fecha: String(x.fecha).slice(0, 10), creado: x.created_at,
    base: Number(x.base_retencion_ganancias || 0), retenido: Number(x.retencion_ganancias_monto || 0),
  });
  const delMes = [...(ops.data || []), ...(directos.data || []).filter((m: any) => !m.anulado)].map(pago);
  return detalleRetencion({
    concepto: op.proveedores?.concepto_retencion_ganancias, alicuotaProveedor: op.proveedores?.alicuota_ganancias,
    minimoBienes: Number(cfg.data?.minimo_ganancias ?? RETENCION_DEFAULT.minimo_ganancias),
    tasaSociedad: Number(cfg.data?.tasa_ganancias_ri ?? RETENCION_DEFAULT.tasa_ganancias_ri),
    bruto: Number(op.monto_bruto || 0), base: Number(op.base_retencion_ganancias || 0),
    pct: Number(op.retencion_ganancias_pct || 0), retenido: Number(op.retencion_ganancias_monto || 0),
    anteriores: pagosAnteriores(pago(op), delMes),
  });
}

/** La OP con proveedor, el HTML de su PDF y los comprobantes que se cargaron al hacerla (van adjuntos en el mail). */
export async function armarOrdenPago(supabase: any, opId: string, sociedad: Parameters<typeof getSociedadPDF>[0] & { id: string }): Promise<{ op: any; html: string; archivos: { filename: string; url: string }[] }> {
  const { data: op, error } = await supabase.from("ordenes_pago").select("*, proveedores(razon_social, cuit, direccion, email, concepto_retencion_ganancias, alicuota_ganancias)")
    .eq("id", opId).eq("sociedad_id", sociedad.id).maybeSingle();
  if (error) throw error;
  if (!op) throw new Error("No se encontró la orden de pago.");
  const moneda: "ARS" | "USD" = op.moneda === "USD" ? "USD" : "ARS";
  const neto = Number(op.neto_a_pagar ?? op.neto ?? 0);
  const guardados = parsear(op.medios_pago);
  const medios = guardados.length > 0
    ? guardados.map((m: any) => ({ tipo: m.tipo, monto: m.monto, fecha: m.fecha, banco: m.banco, numero_cheque: m.numero_cheque, moneda: m.moneda, cotizacion: m.cotizacion }))
    : [{ tipo: op.medio_pago || "transferencia", monto: neto, fecha: op.fecha, banco: "", numero_cheque: "", moneda, cotizacion: 1 }];
  const html = generateOrdenPagoPDF({
    numero: op.numero || "", fecha: op.fecha, estado: op.estado || "pendiente", moneda,
    monto_bruto: Number(op.monto_bruto || 0),
    retencion_ganancias_pct: Number(op.retencion_ganancias_pct ?? 0), retencion_ganancias_monto: Number(op.retencion_ganancias_monto ?? 0),
    neto, notas: op.notas ?? "",
    proveedor: { razon_social: op.proveedores?.razon_social || "—", cuit: op.proveedores?.cuit || "", direccion: op.proveedores?.direccion || "" },
    medios, facturas_vinculadas: await facturasDeOP(supabase, op.id),
    retencion: await retencionDeOP(supabase, op),
  }, getSociedadPDF(sociedad));
  const archivos = parsear(op.archivos).filter((a: any) => a?.url).map((a: any) => ({ filename: a.nombre || "comprobante.pdf", url: a.url }));
  return { op, html, archivos };
}

/** Abre el PDF de la OP, armado igual que en Finanzas → Pagos. */
export async function abrirOrdenPagoPDF(supabase: any, opId: string, sociedad: Parameters<typeof getSociedadPDF>[0] & { id: string }): Promise<void> {
  const { op, html } = await armarOrdenPago(supabase, opId, sociedad);
  await openPDFWindow(html, `${op.numero || "Orden-de-pago"}.pdf`);
}
