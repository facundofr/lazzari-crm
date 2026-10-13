import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { normalizarDatosImpositivos } from "@/lib/documento-impositivo";

// Lee un papel impositivo (constancia ARCA, exención de IVA, exclusión de Ganancias / IIBB).
// Si el modelo principal no responde, se usa el de respaldo.
const MODELOS = [process.env.DOCUMENTO_IMPOSITIVO_MODEL || "claude-sonnet-4-5", "claude-haiku-4-5-20251001"];

const EXTRACTION_PROMPT = `Sos un experto en documentación impositiva argentina (ARCA, ex AFIP, y rentas provinciales).

Te voy a pasar un PDF o imagen de un papel impositivo de una empresa o persona: puede ser una constancia de inscripción de ARCA/AFIP, un certificado de exención de IVA, un certificado de exclusión de retención del impuesto a las Ganancias, un certificado de exclusión / no retención de Ingresos Brutos (IIBB), u otro documento impositivo.

Devolvé SOLO un JSON con esta estructura exacta:

{
  "tipo_documento": "constancia_inscripcion" | "exencion_iva" | "exclusion_ganancias" | "exclusion_iibb" | "otro",
  "cuit": "solo números, 11 dígitos, o null",
  "razon_social": "apellido y nombre o razón social del contribuyente, o null",
  "condicion_iva": "RI" | "Monotributo" | "Exento" | "CF" | null,
  "direccion": "calle y número del domicilio fiscal, o null",
  "localidad": "localidad del domicilio fiscal, o null",
  "provincia": "provincia del domicilio fiscal, o null",
  "exclusion_desde": "YYYY-MM-DD o null",
  "exclusion_hasta": "YYYY-MM-DD o null",
  "numero_certificado": "número de certificado o de constancia, o null",
  "porcentaje_exclusion": 100,
  "resumen": "una línea en español que resuma lo que dice el papel"
}

Reglas:
- condicion_iva: "RI" si es Responsable Inscripto en IVA; "Monotributo" si está adherido al Régimen Simplificado (Monotributo); "Exento" si es IVA Exento o tiene certificado de exención de IVA; "CF" solo si es consumidor final. Si no se puede saber, null.
- Las fechas siempre en formato YYYY-MM-DD. "exclusion_desde" y "exclusion_hasta" son la vigencia del certificado de exclusión o exención (si es una constancia de inscripción sin exclusión, dejalas en null).
- porcentaje_exclusion: número sin el signo % (ej. 100), o null si no figura.
- El CUIT es el del contribuyente titular del papel, no el del organismo.
- Si un dato no figura, usá null. No inventes datos.
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

    const client = new Anthropic({ apiKey, timeout: 120_000 });

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
    if (file.type === "application/pdf") {
      contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
    } else {
      const mediaType = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
      contentBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
    }
    contentBlocks.push({ type: "text", text: "Extraé los datos de este papel impositivo y devolvé el JSON según las instrucciones." });

    let ultimoError: unknown = null;
    for (const model of MODELOS) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 2000,
          system: EXTRACTION_PROMPT,
          messages: [{ role: "user", content: contentBlocks }],
        });
        await registrarUsoIA("documento_impositivo", model, response.usage);

        const rawText = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        let jsonText = rawText.trim();
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        const jsonStart = jsonText.indexOf("{");
        const jsonEnd = jsonText.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
          jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
        }

        const parsed = JSON.parse(jsonText);
        const data = normalizarDatosImpositivos(parsed);

        return Response.json({
          success: true,
          data,
          modelo: model,
          tokens_used: response.usage.input_tokens + response.usage.output_tokens,
        });
      } catch (e) {
        ultimoError = e;
      }
    }

    console.error("Error leyendo documento impositivo:", ultimoError);
    if (ultimoError instanceof SyntaxError) {
      return Response.json(
        { error: "No se pudo interpretar la respuesta de la IA. Probá con una imagen más clara." },
        { status: 422 }
      );
    }
    const message = ultimoError instanceof Error ? ultimoError.message : "La IA no respondió";
    return Response.json({ error: message }, { status: 500 });
  } catch (error: unknown) {
    console.error("Error leyendo documento impositivo:", error);
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
