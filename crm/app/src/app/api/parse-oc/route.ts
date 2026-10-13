import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const EXTRACTION_PROMPT = `Sos un experto en lectura de cotizaciones y ordenes de compra industriales argentinas.

Te voy a pasar un archivo HTML, PDF o imagen de una cotización o lista de un proveedor. Tu tarea es extraer los items y devolver un JSON con esta estructura:

{
  "proveedor": "nombre o razón social del proveedor si aparece",
  "fecha": "YYYY-MM-DD si aparece, o null",
  "moneda": "ARS" o "USD",
  "items": [
    {
      "codigo": "código del producto si existe, o null",
      "descripcion": "descripción del producto/servicio",
      "cantidad": 1,
      "precio_unitario": 123.45,
      "unidad": "UN",
      "iva_porcentaje": 21
    }
  ],
  "observaciones": "condiciones de pago, validez, o notas relevantes"
}

Reglas:
- Extraé TODOS los items/líneas del documento sin excepción.
- FORMATO NUMÉRICO OBLIGATORIO: Todos los montos deben ser números planos sin separadores de miles. Ejemplo: 1234567.89 (correcto). El punto es SIEMPRE separador decimal. Formato argentino: $1.234.567,89 = 1234567.89.
- El precio_unitario debe ser neto (sin IVA) si es posible determinarlo. Pistas: si el documento dice "Precios + IVA" o "IVA incluido", dividí por 1.21 (o la alícuota que corresponda). Si dice "Neto", "s/IVA", o "más IVA", ya es neto.
- Si no podés determinar si incluye IVA, dejá el precio tal cual y poné iva_porcentaje: null (el usuario lo verificará).
- Si hay items con distintos IVA (21%, 10.5%, 0%), poné el iva_porcentaje correcto para cada uno.
- La moneda por defecto es "ARS" salvo que se indique USD, dólares, U$S, o aparezca símbolo $.
- Si un campo no existe en el documento, usá null.
- Devolvé SOLO el JSON, sin texto adicional ni markdown.
- Para tablas con muchas columnas: leé con cuidado cada celda. No confundas bonificación con precio, ni subtotal de línea con precio unitario.
- Si hay variantes (tallas, medidas, presentaciones), incluí cada variante como un item separado con la variante en la descripción.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/html"];
    const isHTML = file.type === "text/html" || file.name.endsWith(".html") || file.name.endsWith(".htm");

    if (!isHTML && !allowedTypes.includes(file.type)) {
      return Response.json(
        { error: "Formato no soportado. Enviá un HTML, PDF o imagen." },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "API key de Claude no configurada" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey, timeout: 120_000 });
    const arrayBuffer = await file.arrayBuffer();

    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

    if (isHTML) {
      // HTML files: send as text content
      const htmlText = new TextDecoder().decode(arrayBuffer);
      // Strip scripts and limit size
      const cleanHtml = htmlText.replace(/<script[\s\S]*?<\/script>/gi, "").slice(0, 100_000);
      contentBlocks.push({
        type: "text",
        text: `Este es el contenido HTML de una cotización de proveedor:\n\n${cleanHtml}`,
      });
    } else {
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      if (file.type === "application/pdf") {
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        });
      } else {
        let mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/jpeg";
        if (file.type === "image/png") mediaType = "image/png";
        else if (file.type === "image/webp") mediaType = "image/webp";
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        });
      }
    }

    contentBlocks.push({
      type: "text",
      text: "Extraé los items de esta cotización/orden y devolvé el JSON según las instrucciones.",
    });

    const stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16000,
      system: EXTRACTION_PROMPT,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const response = await stream.finalMessage();
    await registrarUsoIA("oc_cliente", response.model, response.usage);
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
    console.error("Error parsing OC:", error);
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "No se pudo interpretar la respuesta. Probá con otro archivo." },
        { status: 422 }
      );
    }
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
