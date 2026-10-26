import { limpiarPdfBase64 } from "@/lib/pdf-limpiar";
import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { normalizarVep } from "@/lib/vep";

// Opus 5.5 piensa antes de responder: más tiempo para leer el archivo.
export const maxDuration = 60;

// Lee un VEP o comprobante de pago de impuestos (ARCA, rentas, municipio) para la pestaña Gastos.
// Solo completa la ventana: Augusto revisa y guarda (nunca guarda solo).
// Augusto 26/10/2026: Opus 5.5; si no responde, Sonnet 5.5.
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5"];

const PROMPT = `Sos un experto en impuestos argentinos. Te paso un VEP (Volante Electrónico de Pago) de ARCA/AFIP, un comprobante de pago de impuestos,
una boleta de Ingresos Brutos / Convenio Multilateral (SIFERE), una tasa municipal (Seguridad e Higiene) o un comprobante de aportes (autónomos, monotributo).

Devolvé SOLO un JSON con esta estructura exacta:
{
  "concepto": "nombre corto del impuesto: IVA | SICORE | Autónomos | Monotributo | Convenio Multilateral | Seguridad e Higiene | Ganancias | Bienes Personales | otro nombre corto",
  "detalle": "una línea: impuesto, concepto/subconcepto y período, ej. 'IVA - DDJJ - período 09/2026'",
  "periodo": "YYYY-MM o null",
  "monto": 12345.67,
  "vencimiento": "YYYY-MM-DD (fecha de vencimiento o de pago que figure) o null",
  "fecha_pago": "YYYY-MM-DD si el comprobante muestra que ya se pagó, o null",
  "numero": "número de VEP o de comprobante, o null",
  "cuit": "CUIT del contribuyente, solo números, o null",
  "organismo": "ARCA | ARBA | Comisión Arbitral | Municipalidad de ... | otro | null"
}
Reglas: el monto es el TOTAL a pagar (con intereses si los hay), número con punto decimal, sin separador de miles. Si un dato no figura, null. No inventes.
Devolvé SOLO el JSON, sin texto ni markdown.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No se recibió ningún archivo" }, { status: 400 });

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return Response.json({ error: "Formato no soportado. Enviá un PDF o imagen (PNG, JPG, WEBP)." }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return Response.json({ error: "API key de Claude no configurada" }, { status: 500 });

    const client = new Anthropic({ apiKey, timeout: 120_000 });
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
    if (file.type === "application/pdf") {
      contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: limpiarPdfBase64(base64) } });
    } else {
      const mediaType = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
      contentBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
    }
    contentBlocks.push({ type: "text", text: "Extraé los datos de este VEP o comprobante de impuestos y devolvé el JSON." });

    let ultimoError: unknown = null;
    for (const model of MODELOS) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 8000,
          system: PROMPT,
          messages: [{ role: "user", content: contentBlocks }],
        });
        await registrarUsoIA("vep", model, response.usage);
        let jsonText = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        const ini = jsonText.indexOf("{");
        const fin = jsonText.lastIndexOf("}");
        if (ini !== -1 && fin > ini) jsonText = jsonText.slice(ini, fin + 1);
        return Response.json({ success: true, data: normalizarVep(JSON.parse(jsonText)), modelo: model });
      } catch (e) {
        ultimoError = e;
      }
    }
    console.error("Error leyendo VEP:", ultimoError);
    if (ultimoError instanceof SyntaxError) {
      return Response.json({ error: "No se pudo interpretar la respuesta de la IA. Probá con un archivo más claro." }, { status: 422 });
    }
    return Response.json({ error: ultimoError instanceof Error ? ultimoError.message : "La IA no respondió" }, { status: 500 });
  } catch (error: unknown) {
    console.error("Error leyendo VEP:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error interno del servidor" }, { status: 500 });
  }
}
