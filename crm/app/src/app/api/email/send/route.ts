/**
 * POST /api/email/send
 *
 * Sends an email with a PDF attachment.
 * The PDF is generated CLIENT-SIDE and sent as base64 in the request body.
 * This guarantees PDFs always work (no server-side chromium needed).
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServer } from "@/lib/supabase/server";
import { rutaDeLinkArchivo } from "@/lib/archivo-link";
import { remitenteDelUsuario, esLinkDeNuestroStorage } from "@/lib/email-remitente";

// ── Main handler ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // userEmail se ignora: el remitente lo arma el servidor con el usuario que entró (auditoría H38).
    const { to, subject, bodyHtml, pdfBase64, pdfFilename, sociedadId, documentType, documentId, extraAttachments, pdfsExtra } = body as {
      to: string[];
      subject: string;
      bodyHtml: string;
      pdfBase64: string;
      pdfFilename: string;
      sociedadId?: string;
      documentType?: string;
      /** Documento que se manda (PR): queda en el registro del mail. */
      documentId?: string;
      userEmail?: string;
      extraAttachments?: { filename: string; url: string }[];
      /** Más PDF armados en el navegador (avisos de cobranza: una factura por PDF). */
      pdfsExtra?: { filename: string; base64: string }[];
    };

    // Validate required fields
    if (!to?.length || !subject) {
      return NextResponse.json({ error: "Faltan campos requeridos (to, subject)" }, { status: 400 });
    }

    if (!pdfBase64 || !pdfFilename) {
      return NextResponse.json({ error: "Falta el PDF adjunto. No se envía el email sin documento." }, { status: 400 });
    }

    // Validate email addresses
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of to) {
      if (!emailRegex.test(email)) {
        return NextResponse.json({ error: `Email inválido: ${email}` }, { status: 400 });
      }
    }

    // Decode PDF from base64
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    if (pdfBuffer.length === 0) {
      return NextResponse.json({ error: "El PDF adjunto está vacío. No se envía el email." }, { status: 400 });
    }

    // Send email with Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: "RESEND_API_KEY no configurada" }, { status: 500 });
    }

    const resend = new Resend(resendKey);

    // Remitente:
    // - Facturas, OP, Recibos, Resumen de cuenta y Avisos de cobranza → administracion@lazzari.com.ar (fijo)
    // - PR, Remitos y OC → el mail del usuario que entró, leído acá en el servidor (antes venía del navegador
    //   y se podía mandar como cualquier dirección: auditoría H38). Si no es @lazzari.com.ar, sale de administracion@.
    const ADMIN_EMAIL = "Lazzari Soluciones Industriales <administracion@lazzari.com.ar>";
    const isAdminDoc = documentType === "factura" || documentType === "orden_pago" || documentType === "recibo" || documentType === "resumen_cuenta" || documentType === "aviso_cobranza";
    const supabase = await createSupabaseServer();
    let fromEmail = process.env.EMAIL_FROM || ADMIN_EMAIL;
    const { data: { user } } = await supabase.auth.getUser();
    if (isAdminDoc) {
      fromEmail = ADMIN_EMAIL;
    } else {
      if (user) {
        const { data: perfil } = await (supabase as any).from("profiles").select("email, full_name").eq("id", user.id).maybeSingle();
        fromEmail = remitenteDelUsuario(perfil?.email || user.email, perfil?.full_name) || fromEmail;
      }
    }

    // Build attachments array: PDF + extra files (comprobantes, etc.)
    const attachments: { filename: string; content: Buffer }[] = [
      { filename: pdfFilename, content: pdfBuffer },
    ];
    for (const p of pdfsExtra || []) {
      const buf = p?.base64 ? Buffer.from(p.base64, "base64") : null;
      if (buf && buf.length > 0 && p.filename) attachments.push({ filename: p.filename, content: buf });
    }

    // Download extra attachments from URLs (e.g. comprobantes uploaded to Supabase Storage)
    if (extraAttachments?.length) {
      await Promise.all(extraAttachments.map(async (att) => {
        try {
          // Archivos nuestros (buckets privados desde la auditoría 28/10/2026): se bajan con la sesión del usuario.
          const archivo = rutaDeLinkArchivo(att.url);
          if (archivo) {
            const { data } = await supabase.storage.from(archivo.bucket).download(archivo.ruta);
            const buf = data ? Buffer.from(await data.arrayBuffer()) : null;
            if (buf && buf.length > 0) attachments.push({ filename: att.filename, content: buf });
            return;
          }
          // Solo links viejos de nuestro propio Storage: el servidor no baja direcciones de afuera (H38).
          if (!esLinkDeNuestroStorage(att.url, process.env.NEXT_PUBLIC_SUPABASE_URL)) return;
          const res = await fetch(att.url, { signal: AbortSignal.timeout(15000) });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 0) attachments.push({ filename: att.filename, content: buf });
          }
        } catch { /* skip failed downloads silently */ }
      }));
    }

    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html: bodyHtml || `<p>Adjunto encontrará el documento solicitado.</p>`,
      attachments,
    });

    if (emailError) {
      console.error("Resend error:", emailError);
      return NextResponse.json({ error: `Error al enviar email: ${emailError.message}` }, { status: 500 });
    }

    // Correos enviados (Augusto 28/10): cada mail queda anotado (quién, cuándo, a quién, documento) para verificar su
    // estado en Resend. Los PR leen sus envíos de acá. El mail ya salió: si esto falla, solo se avisa.
    let envio: { enviado_at: string } | null = null;
    let avisoRegistro: string | undefined;
    if (user) {
      const { data: fila, error: errEnvio } = await (supabase as any).from("mails_enviados").insert({
        enviado_por: user.id,
        sociedad_id: sociedadId || null,
        remitente: fromEmail,
        enviado_a: to.join(", "),
        asunto: subject,
        documento_tipo: documentType || null,
        documento_id: documentId || null,
        documento_nombre: pdfFilename,
        resend_id: emailResult?.id || null,
      }).select("enviado_at").single();
      if (errEnvio) {
        console.error("No se pudo anotar el mail enviado:", errEnvio);
        avisoRegistro = "El mail salió, pero no quedó anotado en Correos enviados.";
      } else envio = fila;
    }

    return NextResponse.json({ success: true, emailId: emailResult?.id, filename: pdfFilename, envio, avisoRegistro });
  } catch (err: any) {
    console.error("Email send error:", err);
    return NextResponse.json({ error: err.message || "Error interno del servidor" }, { status: 500 });
  }
}
