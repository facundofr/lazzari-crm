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
- CRÍTICO — PROVEEDOR: El "proveedor" es SIEMPRE el EMISOR de la factura (quien la emite/vende), NO el receptor/comprador. En facturas argentinas, el emisor aparece en el encabezado superior (logo, razón social, CUIT, domicilio comercial, condición frente al IVA). El receptor/comprador aparece más abajo en una sección separada como "Señor(es)", "Cliente", "Razón Social" del destinatario. SIEMPRE extraé como proveedor los datos del encabezado superior (EMISOR).
- NUNCA usar como proveedor estos nombres (son nuestros, somos el comprador): "Lazzari", "Augusto Lazzari", "Lazzari Soluciones", "Grupo LA", "LAZZARI". Si el nombre en el encabezado contiene alguno de estos, está MAL — buscá el verdadero emisor en otra parte del documento.
- Si el CUIT del emisor contiene 20379309128 o 30719396042, estás leyendo el comprador, NO el emisor. Buscá el otro CUIT.
- Extraé todos los items/líneas de la factura.
- El precio_unitario debe ser el importe UNITARIO IMPRESO en el renglón (no inventes un precio de lista). Si el renglón muestra un descuento separado, extraé el precio impreso antes del descuento y el porcentaje; si no muestra descuento, dejá descuento_porcentaje en 0.
- Si el documento aplica un único descuento general, devolvelo en descuento_general_porcentaje y repetilo en cada item que no tenga un descuento propio.
- Si el descuento aparece como importe y no como porcentaje, calculá el porcentaje equivalente.
- El subtotal debe ser el neto luego de aplicar descuentos y antes del IVA.
- Leé la tabla completa, incluyendo todas las páginas. No resumas varios renglones en uno: cada artículo/código distinto es un item separado.
- Verificá aritméticamente cantidad × precio unitario × (1 - descuento/100), subtotal, IVA, percepciones y total contra los totales impresos. Conservá los importes impresos como subtotal/iva/total y corregí únicamente un item evidentemente mal leído.
- En documentos con separador de miles y decimales argentinos (1.234,56), convertí a número 1234.56. Nunca devuelvas números con formato local ni símbolos.
- Los precios deben ser números (sin símbolos de moneda).
- Si un campo no existe en el documento, usá null para texto o 0 para números.
- El número de factura debe incluir punto de venta si aparece (ej: 0001-00012345).
- Si hay percepciones (IIBB, ganancias, IVA), sumalas en el campo "percepciones".
- La moneda por defecto es "ARS" salvo que se indique lo contrario.
- Si el documento es una NOTA DE PEDIDO, COTIZACIÓN, PRESUPUESTO o PROFORMA (no es factura fiscal), devolvé tipo_comprobante como "Nota de Pedido".
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

    // Claude a veces devuelve importes como "1.234,56" o cantidades como texto.
    // Normalizamos acá para que la pantalla no pierda artículos/precios por Number(...)=NaN.
    const parseNumeric = (value: unknown): number => {
      if (typeof value === "number") return Number.isFinite(value) ? value : 0;
      if (typeof value !== "string") return 0;
      const clean = value.trim().replace(/[^0-9,.-]/g, "");
      if (!clean) return 0;
      const normalized = clean.includes(",")
        ? clean.replace(/\./g, "").replace(",", ".")
        : clean.replace(/,(?=\d{3}(?:\D|$))/g, "");
      const result = Number(normalized);
      return Number.isFinite(result) ? result : 0;
    };
    for (const key of ["subtotal", "iva", "percepciones", "total", "iva_porcentaje", "descuento_general_porcentaje"]) {
      if (key in parsed) parsed[key] = parseNumeric(parsed[key]);
    }
    if (Array.isArray(parsed.items)) {
      parsed.items = parsed.items
        .filter((item: any) => item && (item.descripcion || item.codigo || item.cantidad || item.precio_unitario))
        .map((item: any) => ({
          ...item,
          cantidad: parseNumeric(item.cantidad) || 1,
          precio_unitario: parseNumeric(item.precio_unitario),
          descuento_porcentaje: parseNumeric(item.descuento_porcentaje),
          iva_porcentaje: parseNumeric(item.iva_porcentaje) || parsed.iva_porcentaje || 21,
        }));
    }

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
