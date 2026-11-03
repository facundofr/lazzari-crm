import { limpiarPdfBase64 } from "@/lib/pdf-limpiar";
import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { normalizarCertificados, PROMPT_CERTIFICADOS } from "@/lib/certificado-sufrido";

// Opus 5.5 piensa antes de responder: más tiempo para leer el archivo (un PDF puede traer varios certificados).
export const maxDuration = 120;

// Lee los certificados de retención que nos hizo un cliente («Cargar certificado (IA)» en Finanzas › Retenciones › Sufridas).
// Solo lee: a qué retención va cada uno lo propone lib/certificado-sufrido y lo confirma una persona.
// Augusto 26/10/2026: Opus 5.5; si no responde, Sonnet 5.5.
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5"];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return Response.json(
        { error: "Formato no soportado. Enviá un PDF o imagen (PNG, JPG, WEBP)." },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "API key de Claude no configurada" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey, timeout: 120_000 });

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
    if (file.type === "application/pdf") {
      contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: limpiarPdfBase64(base64) } });
    } else {
      const mediaType = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
      contentBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
    }
    contentBlocks.push({ type: "text", text: "Extraé todos los certificados de retención de este archivo y devolvé el JSON según las instrucciones." });

    let ultimoError: unknown = null;
    for (const model of MODELOS) {
      try {
        const response = await client.messages.create({
          model,
          // Augusto 03/11/2026: esfuerzo alto (lee montos). Opus 5.5 sin esto trabaja en medio; piensa más, por eso 16000.
          max_tokens: 16000,
          output_config: { effort: "high" },
          system: PROMPT_CERTIFICADOS,
          messages: [{ role: "user", content: contentBlocks }],
        });
        await registrarUsoIA("certificado_retencion", model, response.usage);

        const rawText = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        let jsonText = rawText.trim();
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        const jsonStart = jsonText.indexOf("{");
        const jsonEnd = jsonText.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
          jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
        }

        const certificados = normalizarCertificados(JSON.parse(jsonText));

        return Response.json({
          success: true,
          certificados,
          modelo: model,
          tokens_used: response.usage.input_tokens + response.usage.output_tokens,
        });
      } catch (e) {
        ultimoError = e;
      }
    }

    console.error("Error leyendo certificado de retención:", ultimoError);
    if (ultimoError instanceof SyntaxError) {
      return Response.json(
        { error: "No se pudo interpretar la respuesta de la IA. Probá con un archivo más claro." },
        { status: 422 }
      );
    }
    const message = ultimoError instanceof Error ? ultimoError.message : "La IA no respondió";
    return Response.json({ error: message }, { status: 500 });
  } catch (error: unknown) {
    console.error("Error leyendo certificado de retención:", error);
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
