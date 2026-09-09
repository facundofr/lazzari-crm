import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const EXTRACTION_PROMPT = `Sos un experto en lectura de comprobantes bancarios argentinos.

Te voy a pasar una o varias imágenes/PDFs de comprobantes de pago (transferencias bancarias, depósitos, recibos de cobro, cheques, echeqs, retenciones, etc.). Tu tarea es extraer TODOS los pagos individuales que aparecen y devolver un JSON con esta estructura:

{
  "pagos": [
    {
      "tipo": "transferencia" | "deposito" | "cheque" | "echeq" | "efectivo" | "retencion_iibb" | "retencion_ganancias" | "retencion_iva" | "otro",
      "monto": 123456.78,
      "moneda": "ARS" | "USD",
      "fecha": "YYYY-MM-DD",
      "referencia": "número de operación, CBU, o referencia bancaria",
      "banco": "nombre del banco si aparece",
      "ordenante": "nombre del pagador/ordenante si aparece",
      "destinatario": "nombre del beneficiario si aparece",
      "cuit_ordenante": "CUIT del ordenante si aparece",
      "concepto": "descripción o concepto del pago si aparece",
      "cheque_numero": "número del cheque si es cheque/echeq",
      "cheque_fecha": "YYYY-MM-DD fecha de vencimiento del cheque si corresponde",
      "cheque_id_digital": "ID del echeq si corresponde",
      "notas": "cualquier otra información relevante"
    }
  ]
}

Reglas IMPORTANTES:
- Si hay VARIOS cheques en un mismo comprobante (recibo con listado de cheques, planilla de echeqs, etc.), creá una entrada SEPARADA por cada cheque con su número, banco, fecha y monto individual.
- Si hay retenciones o percepciones impositivas (IIBB, Ganancias, IVA), creá entradas separadas con tipo "retencion_iibb", "retencion_ganancias" o "retencion_iva".
- El monto debe ser un número (sin símbolos de moneda ni puntos de miles).
- Si el monto tiene formato argentino (puntos para miles, coma para decimales), convertilo correctamente.
- La fecha debe estar en formato YYYY-MM-DD.
- Si un campo no existe en el comprobante, usá null.
- La moneda por defecto es "ARS" salvo que se indique USD o dólares.
- Devolvé SOLO el JSON, sin texto adicional ni markdown.
- SIEMPRE devolvé el array "pagos" aunque sea un solo pago.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    // Support multiple files
    const files: File[] = [];
    const allEntries = formData.getAll("file");
    for (const entry of allEntries) {
      if (entry instanceof File) files.push(entry);
    }
    // Also check indexed files (file0, file1, ...)
    for (let i = 0; i < 10; i++) {
      const f = formData.get(`file${i}`) as File | null;
      if (f) files.push(f);
    }

    if (files.length === 0) {
      return Response.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        return Response.json(
          { error: `Formato no soportado: ${file.name}. Enviá PDF o imagen (PNG, JPG, WEBP).` },
          { status: 400 }
        );
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "API key de Claude no configurada" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey, timeout: 60_000 });

    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      if (file.type === "application/pdf") {
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        });
      } else {
        let mediaType: "image/png" | "image/jpeg" | "image/webp";
        if (file.type === "image/png") mediaType = "image/png";
        else if (file.type === "image/webp") mediaType = "image/webp";
        else mediaType = "image/jpeg";
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        });
      }
    }

    contentBlocks.push({
      type: "text",
      text: files.length > 1
        ? `Hay ${files.length} comprobantes adjuntos. Extraé TODOS los pagos de TODOS los archivos y devolvé el JSON con el array "pagos".`
        : "Extraé todos los pagos de este comprobante y devolvé el JSON con el array \"pagos\". Si hay múltiples cheques, crealos como entradas separadas.",
    });

    const stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
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

    // Normalize: if old format (no pagos array), wrap it
    if (!parsed.pagos && parsed.tipo) {
      return Response.json({ success: true, data: { pagos: [parsed] } });
    }

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
