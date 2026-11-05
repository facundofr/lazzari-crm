import { limpiarPdfBase64 } from "@/lib/pdf-limpiar";
import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

// Opus 5.5 piensa antes de responder: más tiempo para leer el archivo.
export const maxDuration = 120;

const EXTRACTION_PROMPT = `Sos un experto en lectura de comprobantes bancarios argentinos.

Te voy a pasar una o varias imágenes/PDFs de comprobantes de pago (transferencias bancarias, depósitos, recibos de cobro, cheques, echeqs, retenciones, etc.). Tu tarea es extraer TODOS los pagos individuales que aparecen y devolver un JSON con esta estructura:

{
  "orden_pago_cliente": "número o referencia general de la orden de pago del cliente, si aparece",
  "pagos": [
    {
      "tipo": "transferencia" | "deposito" | "cheque" | "echeq" | "efectivo" | "retencion_iibb" | "retencion_ganancias" | "retencion_iva" | "otro",
      "monto": 123456.78,
      "moneda": "ARS" | "USD",
      "fecha": "YYYY-MM-DD fecha operativa principal; usar cobro/acreditación/pago",
      "fecha_emision": "YYYY-MM-DD fecha en que se emitió o generó el comprobante",
      "fecha_cobro": "YYYY-MM-DD fecha efectiva de cobro/acreditación/pago",
      "referencia": "número de operación, CBU, o referencia bancaria",
      "banco": "nombre del banco si aparece",
      "ordenante": "nombre del pagador/ordenante si aparece",
      "destinatario": "nombre del beneficiario si aparece",
      "cbu_destino": "CBU o CVU de la cuenta de destino (22 dígitos), solo números, copiado dígito por dígito; null si no se lee completo y claro",
      "alias_destino": "alias de la cuenta de destino si aparece",
      "banco_destino": "banco o billetera de la cuenta de destino (la del beneficiario, no la de origen) si aparece; null si no",
      "cuit_destinatario": "CUIT del beneficiario, solo dígitos, si aparece",
      "cuit_ordenante": "CUIT del ordenante si aparece",
      "organismo": "organismo que practicó la retención, si corresponde",
      "certificado": "número de certificado de retención, si corresponde",
      "concepto": "descripción o concepto del pago si aparece",
      "cheque_numero": "número del cheque si es cheque/echeq",
      "cheque_fecha": "YYYY-MM-DD fecha de vencimiento del cheque si corresponde",
      "cheque_id_digital": "ID del echeq si corresponde",
      "tipo_cheque": "echeq" | "fisico" | null,
      "direccion": "emitido" | "recibido" | null,
      "notas": "cualquier otra información relevante"
    }
  ]
}

Reglas IMPORTANTES:
- Si hay VARIOS cheques en un mismo comprobante (recibo con listado de cheques, planilla de echeqs, etc.), creá una entrada SEPARADA por cada cheque con su número, banco, fecha y monto individual.
- Si hay retenciones o percepciones impositivas (IIBB, Ganancias, IVA), creá entradas separadas con tipo "retencion_iibb", "retencion_ganancias" o "retencion_iva". NUNCA las clasifiques como "transferencia" aunque el comprobante diga "se transfiere" o "se deposita" — si dice "Retención" en el título o encabezado, es una retención.
- El monto debe ser un número PLANO sin separadores de miles. Ejemplo: 1234567.89 (correcto). El punto es SIEMPRE separador decimal.
- La fecha debe estar en formato YYYY-MM-DD.
- Si un campo no existe en el comprobante, usá null.
- La moneda por defecto es "ARS" salvo que se indique USD o dólares. IMPORTANTE: si un cheque o echeq está en USD, poné moneda: "USD" — NO lo conviertas a ARS.
- Devolvé SOLO el JSON, sin texto adicional ni markdown.
- SIEMPRE devolvé el array "pagos" aunque sea un solo pago.
- Si el documento es una orden de pago del cliente, extraé su número o referencia general en "orden_pago_cliente". No lo confundas con el número individual de una transferencia o cheque.
- Para transferencias bancarias, buscá el monto en el campo "Importe" o "Monto". No confundas el CBU/CVU (22 dígitos) con el monto.
- Si el comprobante muestra "Fecha de emisión" y "Fecha de cobro/acreditación", extraé AMBAS en fecha_emision y fecha_cobro. fecha debe repetir fecha_cobro para compatibilidad.
- Si sólo hay una fecha inequívoca, completá fecha y el campo específico que corresponda. No inventes la otra.
- Para cheques y echeqs:
  - Si el documento dice E-Cheq, ECHEQ, cheque electrónico, cheque digital o muestra un ID digital, usá tipo "echeq" y tipo_cheque "echeq". No lo clasifiques como "cheque" físico.
  - direccion describe si el instrumento fue emitido por quien paga ("emitido") o recibido de un tercero ("recibido"). No confundas esta dirección con el destinatario del pago.
  - El número de cheque suele tener 8 dígitos. El ID digital del echeq es más largo (20+ caracteres). No los confundas.
  - cheque_fecha es la FECHA DE VENCIMIENTO o FECHA DE COBRO del cheque (no la fecha de emisión). Si es un cheque diferido, la fecha de cobro es futura. SIEMPRE incluí este campo si aparece.
  - Si dice "A la vista" o no tiene fecha de cobro, usá la fecha de emisión como cheque_fecha.
- Leé con mucho cuidado los montos: $1.234.567,89 = 1234567.89. Un punto seguido de 3 dígitos es separador de miles, una coma seguida de 2 dígitos es separador decimal.
- CÓMO DISTINGUIR RETENCIONES: Los certificados de retención de ARCA/AFIP o municipales dicen claramente "CONSTANCIA DE RETENCIÓN" o "Certificado de Retención" en el encabezado. Mirá el título del documento, no solo el cuerpo.`;

// Solo se agrega cuando el archivo es la orden de pago que nos manda un CLIENTE.
// Pide además qué facturas paga y cuánto, para repartir depósito y retenciones.
const ORDEN_PAGO_CLIENTE_PROMPT = `CONTEXTO: este archivo es una ORDEN DE PAGO / AVISO DE PAGO que un CLIENTE nos envía (nosotros cobramos).
Además de "orden_pago_cliente" y "pagos", agregá al JSON estos campos:

  "pagador": { "razon_social": "nombre del cliente que paga", "cuit": "CUIT del cliente que paga, solo dígitos" },
  "fecha_orden": "YYYY-MM-DD fecha de la orden de pago",
  "facturas_pagadas": [
    { "tipo": "FA" | "FB" | "FCEA" | "NC" | "ND" | null, "punto_venta": 15, "numero": 7, "comprobante": "texto tal cual figura, ej. 0001500000007", "importe_pagado": 1277198.10, "saldo": 1277198.10, "moneda": "ARS" | "USD" }
  ]

Reglas para facturas_pagadas:
- Una entrada por cada comprobante de la sección "Conceptos abonados", "Comprobantes cancelados", "Detalle" o similar.
- Los números suelen venir pegados: "0001500000007" = punto de venta 15, número 7 (5 dígitos de punto de venta + 8 de número). "0015-00000007" = punto de venta 15, número 7.
- Si la factura viene SIN punto de venta (ej. "FC 65" en la columna NRO.COMP), poné "punto_venta": null y "numero": 65. Nunca uses la fecha ni otra columna como número.
- importe_pagado es la columna "Pago" / "Importe pagado" (lo que se cancela de esa factura), no el total de la orden.
- Las notas de crédito restan: usá tipo "NC" e importe_pagado positivo.
- Si el aviso trae por factura "Importe bruto" y "Deducciones" (o "Retenciones" / "Descuentos"), importe_pagado es el importe BRUTO
  (incluye lo descontado) y agregá "deducciones": lo descontado de esa factura (número plano). Sin esa columna, no pongas "deducciones".
- Las deducciones por factura NO son pagos: no armes retenciones en "pagos" con esa columna. Las retenciones salen solo de los
  certificados o constancias de retención adjuntos (con su número de certificado).

Reglas para el pago:
- Un AVISO DE PAGO ("Aviso de pago", "les hemos compensado/abonado las partidas", "Documento de pago ... Importe de pago", ACH)
  con un importe total del pago y sin cheques es UNA transferencia por ese importe, con la fecha del documento de pago y su número como referencia.
- Si vienen el aviso de pago y el certificado de retención de la MISMA operación (mismo número de documento o de pago), es una sola orden:
  facturas_pagadas del aviso (sin repetir), la transferencia del aviso y las retenciones del certificado.

Reglas para retenciones en "pagos":
- Cada retención lleva "certificado" y, si el certificado detalla importes por comprobante ("Comprobantes origen" o similar), agregá
  "detalle": [ { "punto_venta": 15, "numero": 7, "importe": 18471.80 } ].
- Si la retención no detalla comprobantes, no inventes el detalle.
- No dupliques: una retención que aparece en el resumen de la orden y también en su constancia es UNA sola entrada.

`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const contexto = String(formData.get("contexto") || "");
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
          source: { type: "base64", media_type: "application/pdf", data: limpiarPdfBase64(base64) },
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

    const contextoOrdenPago = contexto === "orden_pago_proveedor";
    const contextoOrdenPagoCliente = contexto === "orden_pago_cliente";
    contentBlocks.push({
      type: "text",
      text: `${contextoOrdenPagoCliente ? ORDEN_PAGO_CLIENTE_PROMPT : ""}${contextoOrdenPago ? `CONTEXTO OBLIGATORIO: estos archivos fueron adjuntados al crear una orden de pago a un proveedor. Son comprobantes salientes generados por nuestra empresa. Todo cheque o eCheq hallado aquí es PROPIO/EMITIDO: devolvé direccion "emitido". ÚNICA EXCEPCIÓN: si el comprobante es de un cheque ENDOSADO (dice "eCheq Endosado", "endoso" o "endosado"), el cheque es de un cliente que endosamos al proveedor: devolvé direccion "recibido", concepto "Endoso", en "ordenante" la razón social del emisor y en "cuit_ordenante" su CUIT. Si es electrónico/digital, devolvé tipo "echeq" y tipo_cheque "echeq".\n\n` : ""}${files.length > 1
        ? `Hay ${files.length} comprobantes adjuntos. Extraé TODOS los pagos de TODOS los archivos y devolvé el JSON con el array "pagos".`
        : "Extraé todos los pagos de este comprobante y devolvé el JSON con el array \"pagos\". Si hay múltiples cheques, crealos como entradas separadas."}`,
    });

    const stream = client.messages.stream({
      // Augusto 26/10/2026: Opus 5.5 con esfuerzo alto (leía mal OP sin punto de venta, ej. "FC 65").
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "high" },
      system: EXTRACTION_PROMPT,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const response = await stream.finalMessage();
    await registrarUsoIA("cobro", response.model, response.usage);
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

    if (contextoOrdenPago && Array.isArray(parsed.pagos)) {
      parsed.pagos = parsed.pagos.map((pago: Record<string, unknown>) => {
        const tipo = typeof pago.tipo === "string" ? pago.tipo.toLocaleLowerCase() : pago.tipo;
        if (tipo !== "cheque" && tipo !== "echeq") return pago;
        const chequeHint = [pago.tipo_cheque, pago.cheque_id_digital, pago.concepto, pago.notas]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        const esEcheq = tipo === "echeq" || Boolean(pago.cheque_id_digital)
          || /(?:e[ -]?cheq|cheque (?:electr[oó]nico|digital))/.test(chequeHint);
        return {
          ...pago,
          tipo: esEcheq ? "echeq" : "cheque",
          tipo_cheque: esEcheq ? "echeq" : (pago.tipo_cheque || "fisico"),
          // 26/10/2026: el comprobante de un eCheq ENDOSADO es de un cheque de un cliente (va de cartera); el resto es propio.
          direccion: pago.direccion === "recibido" && /endos/.test(`${chequeHint} ${String(pago.concepto || "")}`.toLocaleLowerCase()) ? "recibido" : "emitido",
        };
      });
    }

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
