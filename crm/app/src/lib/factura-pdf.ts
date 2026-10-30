"use client";

import { supabase } from "@/lib/supabase/client";
import { generateFacturaPDF, getSociedadPDF, htmlToPdfBase64, openPDFWindow, documentFilename } from "@/lib/pdf-templates";

type SociedadPDF = Parameters<typeof getSociedadPDF>[0];

/**
 * Lee una factura de venta de la base y abre su PDF (descarga, o vista previa si preview = true).
 * La usan Ventas y la ventana de emitir factura después de emitir.
 */
export async function abrirFacturaPDF(facturaId: string, sociedad: SociedadPDF, preview?: boolean) {
  const { html, filename } = await htmlFacturaVenta(facturaId, sociedad);
  await openPDFWindow(html, filename, preview);
}

/** El PDF de una factura de venta en base64, para adjuntarlo a un mail (avisos de cobranza). */
export async function facturaPDFBase64(facturaId: string, sociedad: SociedadPDF): Promise<{ base64: string; filename: string }> {
  const { html, filename } = await htmlFacturaVenta(facturaId, sociedad);
  return { base64: await htmlToPdfBase64(html), filename };
}

async function htmlFacturaVenta(facturaId: string, sociedad: SociedadPDF): Promise<{ html: string; filename: string }> {
  const [{ data: factura, error: facturaError }, { data: items, error: itemsError }] = await Promise.all([
    (supabase as any).from("facturas")
      .select("*, clientes(razon_social, cuit, condicion_iva, direccion, localidad, provincia, email, telefono)")
      .eq("id", facturaId).eq("sociedad_id", sociedad.id).single(),
    supabase.from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal")
      .eq("factura_id", facturaId).order("orden"),
  ]);
  if (facturaError || !factura) throw facturaError || new Error("Factura no encontrada");
  if (itemsError) throw itemsError;

  const soc = getSociedadPDF(sociedad);
  const cli = factura.clientes;
  const html = generateFacturaPDF({
    tipo: factura.tipo,
    punto_venta: factura.punto_venta,
    numero: factura.numero,
    fecha: factura.fecha,
    fecha_vencimiento: factura.fecha_vencimiento,
    nota_interna: factura.nota_interna,
    observaciones: factura.observaciones,
    condicion_venta: factura.condicion_venta,
    moneda: factura.moneda || "ARS",
    tipo_cambio: factura.tipo_cambio,
    subtotal: Number(factura.subtotal),
    iva: Number(factura.iva),
    total: Number(factura.total),
    cae: factura.cae,
    cae_vencimiento: factura.cae_vencimiento,
    oc_cliente: factura.oc_cliente,
    cliente: cli ? {
      razon_social: cli.razon_social,
      cuit: cli.cuit,
      condicion_iva: cli.condicion_iva,
      direccion: cli.direccion,
      localidad: cli.localidad,
      provincia: cli.provincia,
      email: cli.email,
      telefono: cli.telefono,
    } : null,
    items: (items || []).map((it: any) => ({
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      iva_porcentaje: Number(it.iva_porcentaje),
      subtotal: Number(it.subtotal ?? (Number(it.cantidad) * Number(it.precio_unitario))),
    })),
  }, {
    razonSocial: soc.razonSocial,
    cuit: soc.cuit,
    cuitNumero: Number(soc.cuit.replace(/\D/g, "")),
    condicionIva: soc.condicionIva,
    domicilio: soc.domicilio,
    ptoVta: factura.punto_venta,
  }, soc);
  return { html, filename: documentFilename(factura.tipo, factura.punto_venta, factura.numero, cli?.razon_social) };
}
