import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const EXTRACTION_PROMPT = `Sos un experto en extracción de datos de facturas de compra y notas de pedido argentinas.

Te voy a pasar un PDF o imagen de una factura de compra o nota de pedido de proveedor. Tu tarea es extraer los datos principales y devolver un JSON con esta estructura exacta:

{
  "proveedor": {
    "razon_social": "nombre o razón social del emisor",
    "cuit": "XX-XXXXXXXX-X o solo números"
  },
  "fecha": "YYYY-MM-DD",
  "fecha_vencimiento": "YYYY-MM-DD o null si no aparece",
  "numero_factura": "XXXX-XXXXXXXX (punto de venta - número)",
  "cae": "número CAE si aparece, o null",
  "tipo_comprobante": "A, B, C, etc. si se identifica",
  "moneda": "ARS" o "USD",
  "items": [
    {
      "descripcion": "descripción del producto/servicio",
      "cantidad": 1,
      "precio_unitario": 123.45,
      "descuento_porcentaje": 10,
      "iva_porcentaje": 21,
      "unidad": "UN"
    }
  ],
  "descuento_general_porcentaje": 0,
  "subtotal": 123.45,
  "iva_porcentaje": 21,
  "iva": 25.92,
  "percepciones": 0,
  "total": 149.37,
  "notas": "condiciones de pago u observaciones relevantes"
}

Reglas:
- IMPORTANTE: El "proveedor" es SIEMPRE el EMISOR de la factura (quien la emite/vende). NUNCA el receptor/comprador. En facturas argentinas el emisor aparece arriba con su razón social, CUIT, domicilio fiscal. El receptor/comprador (nuestro cliente) aparece más abajo como "Señor(es)", "Cliente", "Razón Social" del destinatario. Ignorá los datos del receptor — solo extraé los del emisor como proveedor.
- Nombres como "Lazzari", "Grupo LA", "Augusto Lazzari" son NUESTROS (el comprador) — NUNCA deben aparecer como proveedor.
- Extraé todos los items/líneas de la factura.
- El precio_unitario debe ser el precio de lista antes del descuento. Extraé el descuento de cada renglón en descuento_porcentaje.
- Si el documento aplica un único descuento general, devolvelo en descuento_general_porcentaje y repetilo en cada item que no tenga un descuento propio.
- Si el descuento aparece como importe y no como porcentaje, calculá el porcentaje equivalente.
- El subtotal debe ser el neto luego de aplicar descuentos y antes del IVA.
- Los precios deben ser números (sin símbolos de moneda).
- Si un campo no existe en el documento, usá null para texto o 0 para números.
- El número de factura debe incluir punto de venta si aparece (ej: 0001-00012345).
- Si hay percepciones (IIBB, ganancias, IVA), sumalas en el campo "percepciones".
- La moneda por defecto es "ARS" salvo que se indique lo contrario.
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

    const client = new Anthropic({ apiKey, timeout: 120_000 });

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
      text: "Extraé los datos de esta factura de compra y devolvé el JSON según las instrucciones.",
    });

    // Use streaming as required by the SDK for large max_tokens
    const stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
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

    // Extract JSON from the response
    let jsonText = rawText.trim();

    // Remove markdown code fences
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");

    // If response has text before the JSON, extract just the JSON object
    const jsonStart = jsonText.indexOf("{");
    const jsonEnd = jsonText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(jsonText);

    return Response.json({
      success: true,
      data: parsed,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens,
    });
  } catch (error: unknown) {
    console.error("Error parsing factura de compra:", error);

    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "No se pudo interpretar la respuesta de la IA. Probá con una imagen mas clara." },
        { status: 422 }
      );
    }

    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
