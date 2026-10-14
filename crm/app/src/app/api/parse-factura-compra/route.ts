import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { InvoiceNumberError, normalizeInvoiceNumbers } from "@/lib/invoice-number-parser";

const EXTRACTION_PROMPT = `Sos un experto en extracción de datos de facturas de compra y notas de pedido argentinas.

Te voy a pasar un PDF o imagen de una factura de compra o nota de pedido de proveedor. Tu tarea es extraer los datos principales y devolver un JSON con esta estructura exacta:

{
  "proveedor": {
    "razon_social": "nombre o razón social del emisor",
    "nombre_fantasia": "nombre comercial o marca del emisor que aparece en el logo/encabezado, si es distinto de la razón social; si no, \"\"",
    "cuit": "XX-XXXXXXXX-X o solo números"
  },
  "fecha": "YYYY-MM-DD",
  "fecha_vencimiento": "YYYY-MM-DD o null si no aparece",
  "numero_factura": "XXXX-XXXXXXXX (punto de venta - número)",
  "cae": "número CAE si aparece, o null",
  "tipo_comprobante": "A, B, C, etc. si se identifica",
  "moneda": "ARS" o "USD",
  "referencias_oc": ["1199"],
  "comprobantes_asociados": ["0001-00012345"],
  "items": [
    {
      "codigo": "código, SKU o referencia impresa del artículo, o null si no aparece",
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
  "percepcion_iibb": null,
  "percepcion_iva": null,
  "percepcion_ganancias": null,
  "total": 149.37,
  "notas": "condiciones de pago u observaciones relevantes"
}

Reglas:
- CRÍTICO — PROVEEDOR: El "proveedor" es SIEMPRE el EMISOR de la factura (quien la emite/vende), NO el receptor/comprador. En facturas argentinas, el emisor aparece en el encabezado superior (logo, razón social, CUIT, domicilio comercial, condición frente al IVA). El receptor/comprador aparece más abajo en una sección separada como "Señor(es)", "Cliente", "Razón Social" del destinatario. SIEMPRE extraé como proveedor los datos del encabezado superior (EMISOR).
- NUNCA usar como proveedor estos nombres (son nuestros, somos el comprador): "Lazzari", "Augusto Lazzari", "Lazzari Soluciones", "Grupo LA", "LAZZARI". Si el nombre en el encabezado contiene alguno de estos, está MAL — buscá el verdadero emisor en otra parte del documento.
- Si el CUIT del emisor contiene 20379309128 o 30719396042, estás leyendo el comprador, NO el emisor. Buscá el otro CUIT.
- Extraé todos los items/líneas de la factura.
- Extraé en "codigo" el código principal del producto exactamente como aparece impreso. Si no aparece, usá null.
- CRÍTICO — VARIANTES: no descartes columnas de color, talle, medida, presentación ni referencias secundarias. Incorporalas al final de "descripcion" para que cada variante sea inequívoca. Ejemplo: un renglón con código 222020, referencia 0340, descripción PANTALON OMBU CARGO, color NEGRO y talle 40 debe quedar con codigo "222020" y descripcion "PANTALON OMBU CARGO - NEGRO - REF 0340 - TALLE 40". Si la referencia ya codifica color/talle pero el talle no puede separarse con certeza, conservá igualmente la referencia completa en la descripción.
- El precio_unitario debe ser el importe UNITARIO IMPRESO en el renglón (no inventes un precio de lista). Si el renglón muestra un descuento separado, extraé el precio impreso antes del descuento y el porcentaje; si no muestra descuento, dejá descuento_porcentaje en 0.
- Si el documento aplica un único descuento general, devolvelo en descuento_general_porcentaje y repetilo en cada item que no tenga un descuento propio.
- Si el descuento aparece como importe y no como porcentaje, calculá el porcentaje equivalente.
- El subtotal debe ser el neto luego de aplicar descuentos y antes del IVA.
- Leé la tabla completa, incluyendo todas las páginas. No resumas varios renglones en uno: cada artículo, código o variante/talle distinto es un item separado. Prestá especial atención a tablas con muchas columnas o formatos densos — leé cada celda individualmente, no saltes columnas.
- Si la tabla tiene columnas como Código, Descripción, Cantidad, Precio, Bonificación, Subtotal — asegurate de mapear cada columna correctamente. No confundas la columna de bonificación con el precio ni el subtotal de línea con el precio unitario.
- Verificá aritméticamente cantidad × precio unitario × (1 - descuento/100), subtotal, IVA, percepciones y total contra los totales impresos. Conservá los importes impresos como subtotal/iva/total y corregí únicamente un item evidentemente mal leído.
- Si la lectura de un artículo te da un subtotal de línea que no cuadra con los totales del documento, releé ese renglón con más cuidado.
- FORMATO NUMÉRICO OBLIGATORIO: Todos los montos deben ser números planos sin separadores de miles. Ejemplo: 1234567.89 (correcto), 1.234.567,89 (incorrecto), 1,234,567.89 (incorrecto). El punto es SIEMPRE separador decimal. Nunca devuelvas números con formato local ni símbolos de moneda.
- Si un item tiene IVA 0% o es Exento/No Gravado, usá iva_porcentaje: 0. Agregá en notas si es "Exento", "No Gravado" o "IVA 0%" para distinguir.
- CUIDADO con el pie de la factura: muchas imprimen los títulos "IVA 21%", "IVA 10.5%", "Iva 0%", "Exento" aunque estén VACÍOS. Un título sin importe al lado NO es la tasa de ningún renglón. La tasa de cada item es la del renglón de IVA que tiene importe (si solo "IVA Insc. 21%" tiene importe, todos los items van al 21%). Comprobá que subtotal + iva + percepciones = total impreso.
- Si un campo no existe en el documento, usá null para texto o 0 para números.
- El número de factura debe incluir punto de venta si aparece (ej: 0001-00012345).
- Percepciones: devolvé el total en "percepciones" y además desglosá en "percepcion_iibb" (número o null), "percepcion_iva" (número o null), "percepcion_ganancias" (número o null). Si no podés identificar el tipo, poné todo en "percepciones" y dejá los campos individuales en null.
- La moneda por defecto es "ARS" salvo que se indique lo contrario.
- "referencias_oc": números de NUESTRA orden de compra que el emisor imprime en la factura (ej.: "Su OC N° 1199", "O.C. 2026-1199", "Orden de compra: 1199", "Su pedido 1199", "Ref. cliente OC-1199"). Devolvé solo el número tal como aparece, sin el texto. Si no aparece ninguna, devolvé []. NO pongas el número de remito, de pedido interno del proveedor ni el número de la factura.
- "comprobantes_asociados": solo en notas de crédito o débito: números de las facturas que anula o ajusta (ej.: "Comprobante asociado: FC A 0001-00012345", "Ref. Fact. 0001-12345"). Mismo formato que numero_factura. Si no es NC/ND o no aparece, devolvé [].
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
    await registrarUsoIA("factura_compra", response.model, response.usage);

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

    normalizeInvoiceNumbers(parsed);

    return Response.json({
      success: true,
      data: parsed,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens,
    });
  } catch (error: unknown) {
    console.error("Error parsing factura de compra:", error);

    if (error instanceof InvoiceNumberError) {
      return Response.json({ error: error.message }, { status: 422 });
    }

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
