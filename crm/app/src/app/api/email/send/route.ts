/**
 * POST /api/email/send
 *
 * Sends an email with a PDF attachment.
 * The PDF is generated CLIENT-SIDE and sent as base64 in the request body.
 * This guarantees PDFs always work (no server-side chromium needed).
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// ── Main handler ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { to, subject, bodyHtml, pdfBase64, pdfFilename, sociedadId, documentType, userEmail } = body as {
      to: string[];
      subject: string;
      bodyHtml: string;
      pdfBase64: string;
      pdfFilename: string;
      sociedadId?: string;
      documentType?: string;
      userEmail?: string;
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

    // Email sender routing:
    // - Facturas & OP → administracion@lazzari.com.ar (fixed)
    // - PR & Remitos & OC → user's email (personal sender)
    const ADMIN_EMAIL = "Lazzari Soluciones Industriales <administracion@lazzari.com.ar>";
    const isAdminDoc = documentType === "factura" || documentType === "orden_pago";
    let fromEmail: string;
    if (isAdminDoc) {
      fromEmail = ADMIN_EMAIL;
    } else if (userEmail) {
      fromEmail = userEmail;
    } else {
      fromEmail = process.env.EMAIL_FROM || ADMIN_EMAIL;
    }

    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html: bodyHtml || `<p>Adjunto encontrará el documento solicitado.</p>`,
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBuffer,
        },
      ],
    });

    if (emailError) {
      console.error("Resend error:", emailError);
      return NextResponse.json({ error: `Error al enviar email: ${emailError.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailId: emailResult?.id, filename: pdfFilename });
  } catch (err: any) {
    console.error("Email send error:", err);
    return NextResponse.json({ error: err.message || "Error interno del servidor" }, { status: 500 });
  }
}
