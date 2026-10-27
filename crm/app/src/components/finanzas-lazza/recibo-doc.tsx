"use client";

// Recibo numerado: traer, ver, descargar y mandar por mail (Augusto 19/10: "descargar y enviar comprobantes, dame siempre la opción").
// Lo usan Finanzas Lazza › Recibos y Facturas ("Cobrada con"). Mismo PDF que Finanzas (generateReciboPDF con N°, medios y facturas).
import { useEffect, useState } from "react";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate } from "@/lib/utils";
import { comprobanteVenta } from "@/lib/finanzas-lazza";
import { armarRecibos, textoTotalRecibo, type Recibo } from "@/lib/recibos";
import { generateReciboPDF, getSociedadPDF, htmlToPdfBase64, openPDFWindow } from "@/lib/pdf-templates";
import type { Sociedad } from "@/lib/types";

const db = supabase as any;

export const SIN_MIGRACION_RECIBOS = "sin-migracion-recibos";

export async function traerRecibos(sociedadId: string): Promise<Recibo[]> {
  let recibos: any[];
  const pedir = (campos: string) => traerTodo<any>(() => db.from("recibos").select(campos).eq("sociedad_id", sociedadId).order("id"));
  try {
    // Arreglo 25 (27/10/2026): con cuándo y a quién se mandó (migración 20261027140000); sin esas columnas, sin la marca.
    recibos = await pedir("id, numero, fecha, cliente_id, email_enviado_at, email_enviado_a")
      .catch((e: any) => { if (/email_enviado/i.test(String(e?.message || ""))) return pedir("id, numero, fecha, cliente_id"); throw e; });
  } catch (e: any) {
    if (/recibos/i.test(String(e?.message || ""))) throw new Error(SIN_MIGRACION_RECIBOS);
    throw e;
  }
  const [vinculos, movimientos, aplicaciones, facturas, clientes, cheques] = await Promise.all([
    traerTodo<any>(() => db.from("recibo_movimientos").select("recibo_id, movimiento_id, recibos!inner(sociedad_id)").eq("recibos.sociedad_id", sociedadId).order("movimiento_id")),
    traerTodo<any>(() => db.from("movimientos").select("id, tipo, monto, monto_original, moneda, descripcion, anulado, conciliado, factura_id").eq("sociedad_id", sociedadId).not("cliente_id", "is", null).order("id")),
    traerTodo<any>(() => db.from("cobro_aplicaciones").select("id, movimiento_id, factura_id, monto, movimientos!inner(sociedad_id)").eq("movimientos.sociedad_id", sociedadId).order("id")),
    traerTodo<any>(() => db.from("facturas").select("id, tipo, punto_venta, numero").eq("sociedad_id", sociedadId).order("id")),
    traerTodo<any>(() => db.from("clientes").select("id, razon_social").eq("sociedad_id", sociedadId).order("id")),
    // Arreglo 20 (27/10/2026): N° de los cheques de cada recibo, para buscarlo por N° de cheque. Si falla, los recibos se ven igual.
    traerTodo<any>(() => db.from("echeqs").select("id, numero, movimiento_id").eq("sociedad_id", sociedadId).not("movimiento_id", "is", null).order("id")).catch(() => []),
  ]);
  return armarRecibos({
    recibos, vinculos, movimientos, aplicaciones, cheques,
    comprobantes: Object.fromEntries(facturas.map((f: any) => [f.id, comprobanteVenta(f)])),
    clientes: Object.fromEntries(clientes.map((c: any) => [c.id, c.razon_social])),
  });
}

/** Un solo recibo, para abrirlo desde el resumen de cuenta sin traer todos (arreglo 22). */
export async function traerRecibo(sociedadId: string, reciboId: string): Promise<Recibo | null> {
  const { data: recibo } = await db.from("recibos").select("id, numero, fecha, cliente_id").eq("sociedad_id", sociedadId).eq("id", reciboId).maybeSingle();
  if (!recibo) return null;
  const { data: vinculos } = await db.from("recibo_movimientos").select("recibo_id, movimiento_id").eq("recibo_id", reciboId);
  const movIds = (vinculos || []).map((v: any) => v.movimiento_id);
  if (!movIds.length) return null;
  const [{ data: movimientos }, { data: aplicaciones }, { data: cliente }] = await Promise.all([
    db.from("movimientos").select("id, tipo, monto, monto_original, moneda, descripcion, anulado, conciliado, factura_id").eq("sociedad_id", sociedadId).in("id", movIds),
    db.from("cobro_aplicaciones").select("id, movimiento_id, factura_id, monto").in("movimiento_id", movIds),
    recibo.cliente_id ? db.from("clientes").select("id, razon_social").eq("id", recibo.cliente_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const facIds = [...new Set([...(movimientos || []).map((m: any) => m.factura_id), ...(aplicaciones || []).map((a: any) => a.factura_id)].filter(Boolean))];
  const { data: facturas } = facIds.length ? await db.from("facturas").select("id, tipo, punto_venta, numero").in("id", facIds) : { data: [] };
  return armarRecibos({
    recibos: [recibo], vinculos: vinculos || [], movimientos: movimientos || [], aplicaciones: aplicaciones || [],
    comprobantes: Object.fromEntries((facturas || []).map((f: any) => [f.id, comprobanteVenta(f)])),
    clientes: cliente ? { [cliente.id]: cliente.razon_social } : {},
  })[0] || null;
}

/** PDF del recibo: el mismo de Finanzas, con N°, cada medio y retención y las facturas cobradas. */
export function htmlRecibo(r: Recibo, sociedad: Sociedad): string {
  const moneda: "ARS" | "USD" = r.total.USD > 0.005 && r.total.ARS <= 0.005 ? "USD" : "ARS";
  return generateReciboPDF({
    numero: String(r.numero), numeroRecibo: r.numero, fecha: r.fecha, cliente: r.cliente,
    descripcion: "Cobro de cliente", medio: "", monto: r.total[moneda], moneda, conciliado: r.conciliado, anulado: r.anulado,
    renglones: r.renglones.map((x) => ({ medio: x.medio, detalle: x.detalle, moneda: x.moneda, monto: x.monto })), facturas: r.facturas,
  }, getSociedadPDF(sociedad));
}

/** ver = abre en otra pestaña sin descargar; si no, lo descarga. */
export function abrirRecibo(r: Recibo, sociedad: Sociedad, ver: boolean) {
  void openPDFWindow(htmlRecibo(r, sociedad), ver ? undefined : `Recibo-${r.numero}.pdf`, ver);
}

/**
 * Ventana de mail del recibo al cliente (mails de facturación, el general y los contactos).
 * Al mandarlo queda marcado cuándo y a quién (arreglo 25, 27/10/2026: `marcar_recibo_enviado`, migración 20261027140000).
 */
export function EnviarRecibo({ recibo, onClose, onEnviado }: { recibo: Recibo | null; onClose: () => void; onEnviado?: (reciboId: string, fecha: string) => void }) {
  const { sociedadActiva } = useUser();
  const [mail, setMail] = useState<{ to: string; sugeridos: { email: string; label?: string }[] } | null>(null);

  useEffect(() => {
    if (!recibo) { setMail(null); return; }
    let vivo = true;
    (async () => {
      const sugeridos: { email: string; label?: string }[] = [];
      let para = "";
      if (recibo.clienteId) {
        const [{ data: cli }, { data: contactos }] = await Promise.all([
          db.from("clientes").select("email, email_facturacion").eq("id", recibo.clienteId).maybeSingle(),
          db.from("contactos").select("nombre, email").eq("entity_type", "cliente").eq("entity_id", recibo.clienteId),
        ]);
        for (const e of String(cli?.email_facturacion || "").split(",").map((s) => s.trim()).filter(Boolean)) sugeridos.push({ email: e, label: "Facturación" });
        if (cli?.email && !sugeridos.some((s) => s.email === cli.email)) sugeridos.push({ email: cli.email, label: "Cliente" });
        for (const c of contactos || []) if (c.email && !sugeridos.some((s) => s.email === c.email)) sugeridos.push({ email: c.email, label: c.nombre || "Contacto" });
        para = sugeridos[0]?.email || "";
      }
      if (vivo) setMail({ to: para, sugeridos });
    })().catch(() => { if (vivo) setMail({ to: "", sugeridos: [] }); });
    return () => { vivo = false; };
  }, [recibo]);

  const marcar = async (para?: string[]) => {
    if (!recibo || !sociedadActiva) return;
    const { data, error } = await db.rpc("marcar_recibo_enviado", { p_recibo_id: recibo.id, p_sociedad_id: sociedadActiva.id, p_enviado_a: (para || []).join(", ") || null });
    if (error) { alert(`El mail salió, pero no se pudo guardar la marca de enviado: ${error.message}`); return; }
    onEnviado?.(recibo.id, String(data || new Date().toISOString()));
  };

  if (!recibo || !mail || !sociedadActiva) return null;
  const empresa = sociedadActiva.razonSocial || sociedadActiva.nombre || "Lazzari";
  const total = textoTotalRecibo(recibo.total, (v, m) => formatCurrency(v, m));
  return (
    <EmailComposeModal
      open
      onClose={onClose}
      documentType="recibo"
      sociedadId={sociedadActiva.id}
      defaultTo={mail.to}
      defaultSubject={`Recibo N° ${recibo.numero} - ${empresa}`}
      defaultBody={`<p>Hola,</p><p>Adjuntamos el recibo N° ${recibo.numero} del ${formatDate(recibo.fecha)} por ${total}${recibo.facturas.length ? `, correspondiente a ${recibo.facturas.join(", ")}` : ""}.</p><p>Muchas gracias.</p><p>${empresa}</p>`}
      pdfFilename={`Recibo-${recibo.numero}.pdf`}
      suggestedEmails={mail.sugeridos}
      guardarContacto={recibo.clienteId ? { entityType: "cliente", entityId: recibo.clienteId, cargo: "Administración" } : undefined}
      onSuccess={async (_id, para) => { await marcar(para); onClose(); }}
      generatePdf={async () => htmlToPdfBase64(htmlRecibo(recibo, sociedadActiva))}
    />
  );
}
