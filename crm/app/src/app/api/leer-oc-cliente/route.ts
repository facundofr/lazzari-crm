import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

// Lee SOLO el número y la fecha de una orden de compra de un cliente (PDF o imagen) para sugerirlos en el detalle del PR.
// Es una sugerencia: Augusto o el vendedor la revisan y guardan (nunca guarda solo).
const PROMPT = `Te paso una orden de compra que un cliente le mandó a un proveedor (Lazzari). Devolvé SOLO un JSON:
{"numero": "número de la orden de compra del cliente tal como figura (con ceros y guiones), o null", "fecha": "YYYY-MM-DD fecha de emisión de la orden, o null"}
No confundas con el CUIT, el número de presupuesto/cotización ni el de remito. Si no hay un número claro, null. Sin texto ni markdown.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    const esPdf = file.type === "application/pdf";
    const esImagen = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    if (!esPdf && !esImagen) return Response.json({ error: "Formato no soportado" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return Response.json({ error: "El archivo es muy grande para leerlo" }, { status: 413 });

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return Response.json({ error: "API key de Claude no configurada" }, { status: 500 });

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const bloque: Anthropic.Messages.ContentBlockParam = esPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: file.type as "image/png" | "image/jpeg" | "image/webp", data: base64 } };

    const client = new Anthropic({ apiKey, timeout: 60_000 });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: PROMPT,
      messages: [{ role: "user", content: [bloque, { type: "text", text: "Devolvé el JSON." }] }],
    });
    await registrarUsoIA("oc_cliente", response.model, response.usage);
    const texto = response.content.find((b) => b.type === "text");
    let raw = texto && texto.type === "text" ? texto.text : "";
    const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
    if (i === -1 || j <= i) return Response.json({ numero: null, fecha: null });
    const p = JSON.parse(raw.slice(i, j + 1));
    const numero = typeof p.numero === "string" && p.numero.trim() ? p.numero.trim().slice(0, 60) : null;
    const fecha = typeof p.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) ? p.fecha : null;
    return Response.json({ numero, fecha });
  } catch (error: unknown) {
    // Es solo una sugerencia: si falla, el formulario se completa a mano.
    return Response.json({ numero: null, fecha: null, error: error instanceof Error ? error.message : "No se pudo leer" });
  }
}
