"use client";

import { supabase } from "@/lib/supabase/client";
import { generateRemitoPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64 } from "@/lib/pdf-templates";
import { numeroRemito, nombrePDFRemito } from "@/lib/remitos-crear";
import { entregaPDF, transportesPDF } from "@/lib/remito-entrega";

type SociedadPDF = Parameters<typeof getSociedadPDF>[0] & { id: string };

/**
 * Lee un remito de la base y arma el HTML de su PDF (el mismo que sale desde Remitos).
 * La usan la lista de Remitos (íconos PDF y mail de cada renglón) y la ventana única después de hacer el remito.
 */
export async function htmlRemito(remitoId: string, sociedad: SociedadPDF, valorDeclarado?: number | null) {
  const db = supabase as any;
  const [{ data: r, error }, { data: items }] = await Promise.all([
    db.from("remitos").select("*, clientes(razon_social, cuit, direccion, email), presupuestos(sucursal_id)").eq("id", remitoId).eq("sociedad_id", sociedad.id).single(),
    db.from("remito_items").select("descripcion, cantidad, unidad, orden").eq("remito_id", remitoId).order("orden"),
  ]);
  if (error || !r) throw error || new Error("Remito no encontrado");
  let caiVencimiento: string | null = null;
  if (r.cai_numero) {
    const { data: cc } = await db.from("cai_config").select("fecha_vencimiento").eq("sociedad_id", sociedad.id).eq("cai_numero", r.cai_numero).maybeSingle();
    caiVencimiento = cc?.fecha_vencimiento || null;
  }
  let suc: { nombre: string | null; direccion: string | null; localidad: string | null; provincia: string | null } | null = null;
  const sucId = r.sucursal_id || r.presupuestos?.sucursal_id || null;
  if (sucId) {
    const { data: s } = await db.from("cliente_sucursales").select("nombre, direccion, localidad, provincia").eq("id", sucId).maybeSingle();
    suc = s || null;
  }
  // Domicilio y transporte cargados en el remito ("¿Quién lo lleva?"): el domicilio manda sobre el de la sucursal.
  // El transporte sale de lo que dice el remito, no de Transportes (Augusto 03/11/2026).
  let nombreTransportista: string | null = null;
  if (r.transportista_id) {
    const { data: tr } = await db.from("transportistas").select("nombre").eq("id", r.transportista_id).maybeSingle();
    nombreTransportista = tr?.nombre || null;
  }
  const entrega = entregaPDF(r, suc);
  const viajes = transportesPDF(r, () => nombreTransportista);
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
    sucursal_nombre: entrega.nombre,
    sucursal_direccion: entrega.direccion,
    items: (items || []).map((it: any) => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), unidad: it.unidad })),
    transportes: viajes,
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
