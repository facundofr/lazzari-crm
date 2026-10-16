"use client";

import { supabase } from "@/lib/supabase/client";
import { generateRemitoPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64 } from "@/lib/pdf-templates";
import { numeroRemito, nombrePDFRemito } from "@/lib/remitos-crear";

type SociedadPDF = Parameters<typeof getSociedadPDF>[0] & { id: string };

/**
 * Lee un remito de la base y arma el HTML de su PDF (el mismo que sale desde Remitos).
 * La usan la lista de Remitos (íconos PDF y mail de cada renglón) y la ventana única después de hacer el remito.
 */
export async function htmlRemito(remitoId: string, sociedad: SociedadPDF, valorDeclarado?: number | null) {
  const db = supabase as any;
  const [{ data: r, error }, { data: items }, { data: transportes }] = await Promise.all([
    db.from("remitos").select("*, clientes(razon_social, cuit, direccion, email), presupuestos(sucursal_id)").eq("id", remitoId).eq("sociedad_id", sociedad.id).single(),
    db.from("remito_items").select("descripcion, cantidad, unidad, orden").eq("remito_id", remitoId).order("orden"),
    db.from("transportes").select("transportista, destino, costo, moneda").eq("remito_id", remitoId),
  ]);
  if (error || !r) throw error || new Error("Remito no encontrado");
  let caiVencimiento: string | null = null;
  if (r.cai_numero) {
    const { data: cc } = await db.from("cai_config").select("fecha_vencimiento").eq("sociedad_id", sociedad.id).eq("cai_numero", r.cai_numero).maybeSingle();
    caiVencimiento = cc?.fecha_vencimiento || null;
  }
  let sucursalNombre: string | null = null;
  let sucursalDireccion: string | null = null;
  const sucId = r.sucursal_id || r.presupuestos?.sucursal_id || null;
  if (sucId) {
    const { data: s } = await db.from("cliente_sucursales").select("nombre, direccion, localidad, provincia").eq("id", sucId).maybeSingle();
    if (s) { sucursalNombre = s.nombre; sucursalDireccion = [s.nombre, s.direccion, s.localidad, s.provincia].filter(Boolean).join(", "); }
  }
  const html = generateRemitoPDF({
    numero: r.numero,
    fecha: r.fecha,
    cae: r.cae,
    cae_vencimiento: r.car_vencimiento,
    nro_remito_afip: r.nro_remito_afip,
    oc_cliente: r.oc_cliente,
    valor_declarado: valorDeclarado ?? r.valor_declarado,
    observaciones: r.observaciones,
    cai_numero: r.cai_numero,
    punto_venta_cai: r.punto_venta_cai,
    nro_comprobante_cai: r.nro_comprobante_cai,
    cai_vencimiento: caiVencimiento,
    cuit_emisor: sociedad.cuit,
    cliente: r.clientes ? { razon_social: r.clientes.razon_social, cuit: r.clientes.cuit, direccion: r.clientes.direccion } : null,
    sucursal_nombre: sucursalNombre,
    sucursal_direccion: sucursalDireccion,
    items: (items || []).map((it: any) => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), unidad: it.unidad })),
    transportes: (transportes || []).map((t: any) => ({ transportista: t.transportista, destino: t.destino, costo: t.costo, moneda: t.moneda })),
  }, getSociedadPDF(sociedad));
  return { html, filename: nombrePDFRemito(numeroRemito(r), r.clientes?.razon_social), remito: r as { id: string; numero: string; fecha: string; cliente_id: string; clientes?: { razon_social?: string; email?: string } | null } };
}

/** Abre el PDF del remito (descarga). */
export async function abrirRemitoPDF(remitoId: string, sociedad: SociedadPDF) {
  const { html, filename } = await htmlRemito(remitoId, sociedad);
  await openPDFWindow(html, filename);
}

/** PDF del remito en base64, para mandarlo por mail. */
export async function remitoPDFBase64(remitoId: string, sociedad: SociedadPDF) {
  const { html } = await htmlRemito(remitoId, sociedad);
  return htmlToPdfBase64(html);
}
