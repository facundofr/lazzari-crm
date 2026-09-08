import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const EXTRACTION_PROMPT = `Sos un experto en lectura de comprobantes bancarios argentinos.

Te voy a pasar una imagen o PDF de un comprobante de pago (transferencia bancaria, depósito, recibo de cobro, orden de pago, etc.). Tu tarea es extraer los datos principales y devolver un JSON con esta estructura exacta:

{
  "tipo": "transferencia" | "deposito" | "cheque" | "efectivo" | "otro",
  "monto": 123456.78,
  "moneda": "ARS" | "USD",
  "fecha": "YYYY-MM-DD",
  "referencia": "número de operación, CBU, o referencia bancaria",
  "banco": "nombre del banco si aparece",
  "ordenante": "nombre del pagador/ordenante si aparece",
  "destinatario": "nombre del beneficiario si aparece",
  "cuit_ordenante": "CUIT del ordenante si aparece",
  "concepto": "descripción o concepto del pago si aparece",
  "notas": "cualquier otra información relevante"
}

Reglas:
- El monto debe ser un número (sin símbolos de moneda ni puntos de miles).
- Si el monto tiene formato argentino (puntos para miles, coma para decimales), convertilo correctamente.
- La fecha debe estar en formato YYYY-MM-DD.
- Si un campo no existe en el comprobante, usá null.
- La moneda por defecto es "ARS" salvo que se indique USD o dólares.
- Devolvé SOLO el JSON, sin texto adicional ni markdown.`;

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

    const client = new Anthropic({ apiKey, timeout: 60_000 });
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    let mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
    if (file.type === "application/pdf") mediaType = "application/pdf";
    else if (file.type === "image/png") mediaType = "image/png";
    else if (file.type === "image/webp") mediaType = "image/webp";
    else mediaType = "image/jpeg";

    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

    if (mediaType === "application/pdf") {
      contentBlocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      });
    } else {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 },
      });
    }

    contentBlocks.push({
      type: "text",
      text: "Extraé los datos de este comprobante de pago/transferencia y devolvé el JSON según las instrucciones.",
    });

    const stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: EXTRACTION_PROMPT,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const response = await stream.finalMessage();
    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

    let jsonText = rawText.trim();
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
    const jsonStart = jsonText.indexOf("{");
    const jsonEnd = jsonText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(jsonText);

    return Response.json({ success: true, data: parsed });
  } catch (error: unknown) {
    console.error("Error parsing cobro:", error);
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "No se pudo interpretar la respuesta. Probá con una imagen más clara." },
        { status: 422 }
      );
    }
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
