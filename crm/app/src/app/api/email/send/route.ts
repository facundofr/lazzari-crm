/**
 * POST /api/email/send
 *
 * Sends an email with a PDF attachment generated from CRM document data.
 * The PDF is ALWAYS generated server-side from fresh DB data — never from client state.
 *
 * For facturas: verifies CAE exists before sending. No CAE = no email.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// Lazy-import heavy deps only when needed
async function renderPDF(html: string): Promise<Buffer> {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: (chromium as any).defaultViewport ?? { width: 800, height: 600 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ── Supabase admin client (server-side, no RLS) ──
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// ── Sociedad config ──
const SOCIEDAD_DATA: Record<string, {
  nombre: string; razonSocial: string; cuit: string; condicionIva: string;
  colorPrimario: string; domicilio: string; telefono: string; email: string;
  web: string; inicioActividades: string; ingresosBrutos: string; jurisdiccion: string;
  ptoVta: number; cuitNumero: number;
}> = {
  "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021": {
    nombre: "LAZZARI", razonSocial: "Lazzari Soluciones Industriales",
    cuit: "20-37930912-8", condicionIva: "Responsable Inscripto", colorPrimario: "#FF4500",
    domicilio: "Pueyrredón 653, Pergamino, Buenos Aires", telefono: "2477 628958",
    email: "administracion@lazzari.com.ar", web: "http://www.lazzari.com.ar",
    inicioActividades: "01-09-2017", ingresosBrutos: "20379309128", jurisdiccion: "Buenos Aires",
    ptoVta: 15, cuitNumero: 20379309128,
  },
  "fee94607-747a-4e87-ba24-aff9032f7a56": {
    nombre: "GRUPO LA", razonSocial: "Grupo LA S.A.",
    cuit: "30-71939604-2", condicionIva: "Responsable Inscripto", colorPrimario: "#2563EB",
    domicilio: "Pueyrredón 653, Pergamino, Buenos Aires", telefono: "2477 628958",
    email: "administracion@grupola.com.ar", web: "",
    inicioActividades: "01-01-2020", ingresosBrutos: "30719396042", jurisdiccion: "Buenos Aires",
    ptoVta: 10, cuitNumero: 30719396042,
  },
};

// ── Document types that require CAE ──
const REQUIRES_CAE = new Set(["FA", "FB", "NCA", "NCB", "NDA", "NDB", "FCEA", "FCEB", "NCEA", "NCEB"]);

// ── PDF template imports (dynamic to keep bundle small) ──
async function generateDocumentHTML(
  docType: string,
  docId: string,
  sociedadId: string,
): Promise<{ html: string; filename: string; error?: string }> {
  const supabase = getSupabase();
  const socData = SOCIEDAD_DATA[sociedadId];
  if (!socData) return { html: "", filename: "", error: "Sociedad no encontrada" };

  const soc = { ...socData };

  // Dynamic import of pdf-templates
  const templates = await import("@/lib/pdf-templates");
  const socPDF = {
    nombre: soc.nombre, razonSocial: soc.razonSocial, cuit: soc.cuit,
    condicionIva: soc.condicionIva, colorPrimario: soc.colorPrimario,
    domicilio: soc.domicilio, telefono: soc.telefono, email: soc.email,
    web: soc.web, inicioActividades: soc.inicioActividades,
    ingresosBrutos: soc.ingresosBrutos, jurisdiccion: soc.jurisdiccion,
  };

  switch (docType) {
    case "factura": {
      const { data: f, error: fErr } = await supabase
        .from("facturas")
        .select("*, clientes(razon_social, cuit, condicion_iva, direccion, localidad, provincia, email, telefono)")
        .eq("id", docId)
        .single();
      if (fErr || !f) return { html: "", filename: "", error: "Factura no encontrada" };

      // CRITICAL: verify CAE for regulated types
      if (REQUIRES_CAE.has(f.tipo) && !f.cae) {
        return { html: "", filename: "", error: `BLOQUEADO: La factura ${f.tipo} no tiene CAE. No se puede enviar sin CAE autorizado por ARCA.` };
      }

      const { data: items } = await supabase
        .from("factura_items")
        .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal")
        .eq("factura_id", docId);

      const compNum = `${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
      const emisor = {
        razonSocial: soc.razonSocial, cuit: soc.cuit, cuitNumero: soc.cuitNumero,
        condicionIva: soc.condicionIva, domicilio: soc.domicilio, ptoVta: soc.ptoVta,
      };

      const html = templates.generateFacturaPDF({
        tipo: f.tipo, punto_venta: f.punto_venta, numero: f.numero,
        fecha: f.fecha, fecha_vencimiento: f.fecha_vencimiento,
        condicion_venta: f.condicion_venta, moneda: f.moneda || "ARS",
        tipo_cambio: f.tipo_cambio, subtotal: f.subtotal, iva: f.iva, total: f.total,
        cae: f.cae, cae_vencimiento: f.cae_vencimiento, oc_cliente: f.oc_cliente,
        cliente: f.clientes, items: items || [],
      }, emisor, socPDF);

      return { html, filename: `${f.tipo}-${compNum}.pdf` };
    }

    case "presupuesto": {
      const { data: pr, error: prErr } = await supabase
        .from("presupuestos")
        .select("*, clientes(razon_social, cuit, condicion_iva, email, telefono, direccion, localidad, provincia)")
        .eq("id", docId)
        .single();
      if (prErr || !pr) return { html: "", filename: "", error: "Presupuesto no encontrado" };

      const { data: items } = await supabase
        .from("presupuesto_items")
        .select("codigo, descripcion, cantidad, unidad, precio_venta, total")
        .eq("presupuesto_id", docId)
        .order("orden", { ascending: true });

      // Get vendedor name
      let vendedorNombre = "";
      if (pr.vendedor_id) {
        const { data: vendedor } = await supabase.from("profiles").select("full_name").eq("id", pr.vendedor_id).single();
        if (vendedor) vendedorNombre = vendedor.full_name || "";
      }

      const statusLabels: Record<string, string> = {
        borrador: "BORRADOR", enviado: "ENVIADO", aprobado: "APROBADO",
        rechazado: "RECHAZADO", vencido: "VENCIDO", facturado: "FACTURADO",
      };

      const html = templates.generatePresupuestoPDF({
        numero: pr.numero, fecha: pr.fecha, vencimiento: pr.vencimiento || "",
        estado: pr.estado, estadoLabel: statusLabels[pr.estado] || pr.estado.toUpperCase(),
        moneda: pr.moneda || "ARS", subtotal: pr.subtotal, iva: pr.iva, total: pr.total,
        observaciones: pr.observaciones, condicionPago: pr.condicion_pago,
        clienteNombre: pr.clientes?.razon_social || "",
        clienteCuit: pr.clientes?.cuit, clienteCondicionIva: pr.clientes?.condicion_iva,
        clienteEmail: pr.clientes?.email, clienteTelefono: pr.clientes?.telefono,
        clienteDireccion: pr.clientes?.direccion, clienteLocalidad: pr.clientes?.localidad,
        clienteProvincia: pr.clientes?.provincia, vendedorNombre,
        items: (items || []).map(it => ({
          codigo: it.codigo || "", descripcion: it.descripcion,
          cantidad: it.cantidad, unidad: it.unidad || "u",
          precioVenta: it.precio_venta, total: it.total,
        })),
      }, socPDF);

      return { html, filename: `${pr.numero}.pdf` };
    }

    case "remito": {
      const { data: r, error: rErr } = await supabase
        .from("remitos")
        .select("*, clientes(razon_social, cuit, condicion_iva, direccion, localidad, provincia)")
        .eq("id", docId)
        .single();
      if (rErr || !r) return { html: "", filename: "", error: "Remito no encontrado" };

      const { data: items } = await supabase
        .from("remito_items")
        .select("descripcion, cantidad, unidad")
        .eq("remito_id", docId);

      // Fetch transportes
      const { data: transportes } = await supabase
        .from("transportes")
        .select("transportista, destino, costo, moneda")
        .eq("remito_id", docId);

      // Fetch sucursal if present
      let sucursalNombre: string | null = null;
      let sucursalDireccion: string | null = null;
      if (r.sucursal_id) {
        const { data: suc } = await (supabase as any).from("cliente_sucursales")
          .select("nombre, direccion").eq("id", r.sucursal_id).single();
        if (suc) { sucursalNombre = suc.nombre; sucursalDireccion = suc.direccion; }
      }

      const html = templates.generateRemitoPDF({
        numero: r.numero, fecha: r.fecha, cae: r.cae,
        oc_cliente: r.oc_cliente, valor_declarado: r.valor_declarado,
        observaciones: r.observaciones, cliente: r.clientes,
        sucursal_nombre: sucursalNombre, sucursal_direccion: sucursalDireccion,
        items: (items || []).map(it => ({ descripcion: it.descripcion, cantidad: it.cantidad, unidad: it.unidad })),
        transportes: (transportes || []).map(t => ({
          transportista: t.transportista, destino: t.destino, costo: t.costo, moneda: t.moneda,
        })),
      }, socPDF);

      return { html, filename: `Remito-${r.numero}.pdf` };
    }

    case "orden_compra": {
      const { data: oc, error: ocErr } = await supabase
        .from("ordenes_compra")
        .select("*, proveedores(razon_social, cuit, condicion_iva, direccion, localidad, provincia, email, telefono, forma_pago)")
        .eq("id", docId)
        .single();
      if (ocErr || !oc) return { html: "", filename: "", error: "Orden de compra no encontrada" };

      const { data: items } = await supabase
        .from("orden_compra_items")
        .select("codigo, descripcion, cantidad, unidad, precio_unitario, subtotal")
        .eq("orden_compra_id", docId);

      const statusLabels: Record<string, string> = {
        borrador: "BORRADOR", pendiente: "PENDIENTE", enviada: "PENDIENTE",
        confirmada: "PENDIENTE", recibida_parcial: "PARCIAL",
        recibida: "RECIBIDA", cancelada: "CANCELADA",
      };

      const html = templates.generateOrdenCompraPDF({
        numero: oc.numero, fecha: oc.fecha,
        fecha_entrega_estimada: oc.fecha_entrega_estimada,
        estado: oc.estado, estadoLabel: statusLabels[oc.estado] || oc.estado.toUpperCase(),
        moneda: oc.moneda || "ARS", subtotal: oc.subtotal, iva: oc.iva, total: oc.total,
        observaciones: oc.observaciones, proveedor: oc.proveedores,
        items: (items || []).map(it => ({
          codigo: it.codigo || "", descripcion: it.descripcion,
          cantidad: it.cantidad, unidad: it.unidad,
          precio_unitario: it.precio_unitario, subtotal: it.subtotal,
        })),
      }, socPDF);

      return { html, filename: `${oc.numero}.pdf` };
    }

    case "orden_pago": {
      const { data: op, error: opErr } = await (supabase as any)
        .from("ordenes_pago")
        .select("*, proveedores(razon_social, cuit, direccion)")
        .eq("id", docId)
        .single();
      if (opErr || !op) return { html: "", filename: "", error: "Orden de pago no encontrada" };

      // Fetch linked FCs
      let fcsRows: { numero: string; fecha: string; monto: number }[] = [];
      try {
        const { data: links } = await (supabase as any)
          .from("op_facturas_compra")
          .select("factura_compra_id, monto")
          .eq("orden_pago_id", docId);
        if (links?.length > 0) {
          const { data: fcs } = await (supabase as any)
            .from("facturas_compra")
            .select("id, numero_factura, fecha, total")
            .in("id", links.map((l: any) => l.factura_compra_id));
          if (fcs?.length > 0) {
            fcsRows = fcs.map((fc: any) => {
              const link = links.find((l: any) => l.factura_compra_id === fc.id);
              return { numero: fc.numero_factura || "\u2014", fecha: fc.fecha, monto: Number(link?.monto ?? fc.total) };
            });
          }
        }
      } catch { /* ignore */ }

      const medios = op.medios_pago
        ? (typeof op.medios_pago === "string" ? JSON.parse(op.medios_pago) : op.medios_pago)
        : [{ tipo: op.medio_pago || "transferencia", monto: Number(op.neto_a_pagar ?? op.neto ?? 0), fecha: op.fecha, banco: "", numero_cheque: "", moneda: op.moneda || "ARS", cotizacion: 1 }];

      const html = templates.generateOrdenPagoPDF({
        numero: op.numero || "", fecha: op.fecha, estado: op.estado || "pendiente",
        moneda: op.moneda || "ARS", monto_bruto: Number(op.monto_bruto),
        retencion_ganancias_pct: Number(op.retencion_ganancias_pct ?? 0),
        retencion_ganancias_monto: Number(op.retencion_ganancias_monto ?? 0),
        neto: Number(op.neto_a_pagar ?? op.neto ?? 0), notas: op.notas,
        proveedor: {
          razon_social: op.proveedores?.razon_social || "\u2014",
          cuit: op.proveedores?.cuit, direccion: op.proveedores?.direccion,
        },
        medios, facturas_vinculadas: fcsRows,
      }, socPDF);

      return { html, filename: `OP-${op.numero || docId.slice(0, 8)}.pdf` };
    }

    default:
      return { html: "", filename: "", error: `Tipo de documento no soportado: ${docType}` };
  }
}

// ── Main handler ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { to, subject, bodyHtml, documentType, documentId, sociedadId } = body as {
      to: string[];
      subject: string;
      bodyHtml: string;
      documentType: string;
      documentId: string;
      sociedadId: string;
    };

    // Validate required fields
    if (!to?.length || !subject || !documentType || !documentId || !sociedadId) {
      return NextResponse.json({ error: "Faltan campos requeridos (to, subject, documentType, documentId, sociedadId)" }, { status: 400 });
    }

    // Validate email addresses
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of to) {
      if (!emailRegex.test(email)) {
        return NextResponse.json({ error: `Email inválido: ${email}` }, { status: 400 });
      }
    }

    // 1. Generate document HTML (fetches fresh from DB, validates CAE for facturas)
    const { html, filename, error: docError } = await generateDocumentHTML(documentType, documentId, sociedadId);
    if (docError) {
      return NextResponse.json({ error: docError }, { status: 400 });
    }
    if (!html) {
      return NextResponse.json({ error: "No se pudo generar el documento" }, { status: 500 });
    }

    // 2. Render HTML to PDF
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderPDF(html);
    } catch (pdfErr: any) {
      console.error("Error generating PDF:", pdfErr);
      return NextResponse.json({ error: `Error al generar PDF: ${pdfErr.message}` }, { status: 500 });
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return NextResponse.json({ error: "El PDF generado está vacío. No se envía el email." }, { status: 500 });
    }

    // 3. Send email with Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: "RESEND_API_KEY no configurada" }, { status: 500 });
    }

    const resend = new Resend(resendKey);
    const socData = SOCIEDAD_DATA[sociedadId];
    const fromEmail = process.env.EMAIL_FROM || `${socData?.nombre || "Lazzari"} <notificaciones@lazzari.com.ar>`;

    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html: bodyHtml || `<p>Adjunto encontrará el documento solicitado.</p>`,
      attachments: [
        {
          filename,
          content: pdfBuffer.toString("base64"),
          contentType: "application/pdf",
        },
      ],
    });

    if (emailError) {
      console.error("Resend error:", emailError);
      return NextResponse.json({ error: `Error al enviar email: ${emailError.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailId: emailResult?.id, filename });
  } catch (err: any) {
    console.error("Email send error:", err);
    return NextResponse.json({ error: err.message || "Error interno del servidor" }, { status: 500 });
  }
}
