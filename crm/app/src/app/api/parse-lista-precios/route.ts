import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const EXTRACTION_PROMPT = `Sos un experto en extracción de datos de listas de precios industriales.

Te voy a pasar un PDF de una lista de precios de un proveedor industrial (válvulas, caños, bombas, instrumentación, etc.).

Tu tarea es extraer TODOS los artículos/productos que aparezcan en la lista y devolver un JSON con esta estructura exacta:

{
  "nombre_lista": "nombre o título de la lista que aparezca en el documento",
  "proveedor": "nombre del proveedor si aparece",
  "moneda": "USD" o "ARS" (la moneda predominante de los precios),
  "vigencia_desde": "YYYY-MM-DD" o null si no aparece,
  "vigencia_hasta": "YYYY-MM-DD" o null si no aparece,
  "notas": "cualquier nota relevante sobre la lista (condiciones, descuentos generales, etc.)",
  "items": [
    {
      "codigo": "código del artículo",
      "descripcion": "descripción completa del producto",
      "categoria": "categoría o familia de productos",
      "unidad": "UN, MT, KG, LT, etc.",
      "precio": 123.45,
      "descuento": 0,
      "precio_neto": 123.45
    }
  ]
}

Reglas:
- Extraé TODOS los productos, sin excepción. Si hay muchos, incluí todos.
- Si hay descuentos por columna o por categoría, aplicalos al precio_neto.
- Si no hay descuento, precio_neto = precio.
- Los precios deben ser números (sin símbolos de moneda).
- Si un campo no existe en el documento, usá string vacío "" para texto o 0 para números.
- Unidades comunes: UN (unidad), MT (metro), KG (kilo), LT (litro), CJ (caja), JGO (juego).
- La categoría la inferís del contexto (ej: "Válvulas esféricas", "Caños", "Fitting", etc.).
- Devolvé SOLO el JSON, sin texto adicional ni markdown.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }

    // Validate file type
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

    const client = new Anthropic({ apiKey, timeout: 300_000 });

    // Read file as base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    // Determine media type for Claude API
    let mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
    if (file.type === "application/pdf") {
      mediaType = "application/pdf";
    } else if (file.type === "image/png") {
      mediaType = "image/png";
    } else if (file.type === "image/webp") {
      mediaType = "image/webp";
    } else {
      mediaType = "image/jpeg";
    }

    // Build content blocks
    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

    if (mediaType === "application/pdf") {
      contentBlocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      });
    } else {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64,
        },
      });
    }

    contentBlocks.push({
      type: "text",
      text: "Extraé todos los productos de esta lista de precios y devolvé el JSON según las instrucciones.",
    });

    // Use streaming to avoid SDK timeout check for large max_tokens
    const stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 32000,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: contentBlocks,
        },
      ],
    });

    const response = await stream.finalMessage();

    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

    // Extract JSON from the response — handle markdown wrapping, partial text, etc.
    let jsonText = rawText.trim();

    // Remove markdown code fences
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");

    // If response has text before the JSON, extract just the JSON object
    const jsonStart = jsonText.indexOf("{");
    const jsonEnd = jsonText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    // If response was truncated (stop_reason = max_tokens), try to fix incomplete JSON
    if (response.stop_reason === "max_tokens") {
      // Close any open arrays and objects
      const openBrackets = (jsonText.match(/\[/g) || []).length - (jsonText.match(/\]/g) || []).length;
      const openBraces = (jsonText.match(/\{/g) || []).length - (jsonText.match(/\}/g) || []).length;

      // Remove last potentially incomplete item (trailing comma + partial object)
      jsonText = jsonText.replace(/,\s*\{[^}]*$/, "");

      for (let i = 0; i < openBrackets; i++) jsonText += "]";
      for (let i = 0; i < openBraces; i++) jsonText += "}";
    }

    const parsed = JSON.parse(jsonText);

    return Response.json({
      success: true,
      data: parsed,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens,
      truncated: response.stop_reason === "max_tokens",
    });
  } catch (error: unknown) {
    console.error("Error parsing lista de precios:", error);

    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "No se pudo interpretar la respuesta de la IA. El PDF puede ser demasiado grande o complejo. Probá con menos páginas." },
        { status: 422 }
      );
    }

    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
