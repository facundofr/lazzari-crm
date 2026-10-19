"use client";

// Orden de pago: descargar el PDF y mandarla por mail (con los comprobantes que se cargaron al hacerla).
// Se arma solo con el id de la OP, así lo usan Finanzas Lazza (Órdenes de pago y Facturas) y "Guardar y enviar"
// de Finanzas. Mismo PDF, misma plantilla y misma marca de enviada que Finanzas (19/10/2026).
import { useEffect, useState } from "react";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { applyTemplateVars, loadEmailTemplate } from "@/lib/email-templates";
import { htmlToPdfBase64, openPDFWindow } from "@/lib/pdf-templates";
import { armarOrdenPago } from "@/lib/orden-pago-pdf";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Sociedad } from "@/lib/types";

const db = supabase as any;
const armarOP = (opId: string, sociedad: Sociedad) => armarOrdenPago(db, opId, sociedad);

/** Abre el PDF de la OP para guardarlo o imprimirlo. */
export async function descargarOP(opId: string, sociedad: Sociedad) {
  try {
    const { op, html } = await armarOP(opId, sociedad);
    await openPDFWindow(html, `${op.numero || "Orden-de-pago"}.pdf`);
  } catch (e) {
    alert(`No se pudo armar la OP: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Abre la OP en una pestaña nueva para verla, sin descargarla (Augusto 19/10). */
export async function verOP(opId: string, sociedad: Sociedad) {
  try {
    const { html } = await armarOP(opId, sociedad);
    await openPDFWindow(html, undefined, true);
  } catch (e) {
    alert(`No se pudo armar la OP: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Ventana de mail de la OP. Se monta con un opId; al cerrar o enviar avisa con onClose / onEnviada. */
export function EnviarOrdenPago({ opId, onClose, onEnviada }: { opId: string | null; onClose: () => void; onEnviada?: (opId: string, fecha: string) => void }) {
  const { sociedadActiva } = useUser();
  const [mail, setMail] = useState<{ to: string; subject: string; body: string; filename: string; sugeridos: { email: string; label?: string }[]; adjuntos: { filename: string; url: string }[]; proveedorId: string | null } | null>(null);

  useEffect(() => {
    if (!opId || !sociedadActiva) { setMail(null); return; }
    let vivo = true;
    (async () => {
      try {
        const [{ op, archivos }, plantilla] = await Promise.all([armarOP(opId, sociedadActiva), loadEmailTemplate("orden_pago", sociedadActiva.id)]);
        const moneda = (op.moneda as "ARS" | "USD") || "ARS";
        const vars = { numero: op.numero || "", sociedad: sociedadActiva.razonSocial || "Lazzari", total: formatCurrency(Number(op.neto_a_pagar ?? op.neto ?? 0), moneda), fecha: formatDate(op.fecha), proveedor: op.proveedores?.razon_social || "" };
        // Mismo orden que Finanzas: contacto principal, después el mail del proveedor.
        let para = op.proveedores?.email || "";
        const sugeridos: { email: string; label?: string }[] = [];
        if (op.proveedor_id) {
          const { data: contactos } = await db.from("contactos").select("nombre, email, principal").eq("entity_type", "proveedor").eq("entity_id", op.proveedor_id).order("principal", { ascending: false });
          for (const c of contactos || []) {
            if (c.principal && c.email && para === (op.proveedores?.email || "")) para = c.email;
            if (c.email && !sugeridos.some((s) => s.email === c.email)) sugeridos.push({ email: c.email, label: c.principal ? `Principal: ${c.nombre || "Contacto"}` : (c.nombre || "Contacto") });
          }
        }
        const general = op.proveedores?.email;
        if (general && !sugeridos.some((s) => s.email === general)) sugeridos.push({ email: general, label: "Proveedor" });
        if (vivo) setMail({ to: para, subject: applyTemplateVars(plantilla.asunto, vars), body: applyTemplateVars(plantilla.cuerpo, vars), filename: `${String(op.numero || "").startsWith("OP") ? op.numero : `OP-${op.numero || op.id.slice(0, 8)}`}.pdf`, sugeridos, adjuntos: archivos, proveedorId: op.proveedor_id || null });
      } catch (e) {
        if (!vivo) return;
        alert(`No se pudo preparar el mail de la OP: ${e instanceof Error ? e.message : String(e)}`);
        onClose();
      }
    })();
    return () => { vivo = false; };
  }, [opId, sociedadActiva?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcar = async () => {
    if (!opId || !sociedadActiva) return;
    const fecha = new Date().toISOString();
    const { error } = await db.from("ordenes_pago").update({ email_enviado_at: fecha, sobre_verde: true }).eq("id", opId).eq("sociedad_id", sociedadActiva.id);
    if (error) { alert(`El mail salió, pero no se pudo guardar la marca de enviada: ${error.message}`); return; }
    onEnviada?.(opId, fecha);
  };

  if (!opId || !mail || !sociedadActiva) return null;
  return (
    <EmailComposeModal
      open
      onClose={onClose}
      documentType="orden_pago"
      sociedadId={sociedadActiva.id}
      defaultTo={mail.to}
      defaultSubject={mail.subject}
      defaultBody={mail.body}
      pdfFilename={mail.filename}
      suggestedEmails={mail.sugeridos}
      extraAttachments={mail.adjuntos}
      guardarContacto={mail.proveedorId ? { entityType: "proveedor", entityId: mail.proveedorId, cargo: "Pagos" } : undefined}
      onSuccess={marcar}
      onMarkSent={marcar}
      generatePdf={async () => htmlToPdfBase64((await armarOP(opId, sociedadActiva)).html)}
    />
  );
}
