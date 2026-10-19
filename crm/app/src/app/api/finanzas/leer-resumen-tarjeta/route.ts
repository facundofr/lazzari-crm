import { limpiarPdfBase64 } from "@/lib/pdf-limpiar";
import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

// Finanzas Lazza > Bancos > Tarjetas (19/10/2026): lee el PDF del resumen de una tarjeta de crédito.
// Solo completa la ventana: Augusto revisa y guarda (nunca guarda solo).
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5"];

const PROMPT = `Sos un experto en resúmenes de tarjetas de crédito argentinas (Visa, Mastercard, Amex; bancos como BBVA, Galicia, Nación).
Te paso el resumen mensual de una tarjeta. Devolvé SOLO un JSON con esta estructura exacta:
{
  "tarjeta": "marca y últimos 4 dígitos si figuran, ej. 'Mastercard ·4775', o null",
  "cierre": "YYYY-MM-DD (fecha de cierre actual) o null",
  "vencimiento": "YYYY-MM-DD (vencimiento actual) o null",
  "total_ars": 12345.67,
  "total_usd": 0,
  "minimo_ars": 1234.56,
  "detalle": "una línea con lo más importante (ej. 'incluye 3 cuotas de ...', 'saldo anterior pagado'), o null"
}
Reglas: total_ars = saldo actual / total a pagar en pesos; total_usd = saldo actual en dólares (0 si no hay); minimo_ars = pago mínimo.
Números con punto decimal, sin separador de miles. Si un dato no figura, null (los totales sin dato: 0). No inventes.
Devolvé SOLO el JSON, sin texto ni markdown.`;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const fecha = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    const permitidos = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!permitidos.includes(file.type)) return Response.json({ error: "Formato no soportado. Enviá el PDF del resumen o una imagen." }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return Response.json({ error: "API key de Claude no configurada" }, { status: 500 });

    const client = new Anthropic({ apiKey, timeout: 120_000 });
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const contenido: Anthropic.Messages.ContentBlockParam[] = [
      file.type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: limpiarPdfBase64(base64) } }
        : { type: "image", source: { type: "base64", media_type: file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg", data: base64 } },
      { type: "text", text: "Extraé los datos de este resumen de tarjeta y devolvé el JSON." },
    ];

    let ultimoError: unknown = null;
    for (const model of MODELOS) {
      try {
        const r = await client.messages.create({ model, max_tokens: 1000, system: PROMPT, messages: [{ role: "user", content: contenido }] });
        await registrarUsoIA("resumen_tarjeta", model, r.usage);
        let txt = r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
        const ini = txt.indexOf("{"), fin = txt.lastIndexOf("}");
        if (ini !== -1 && fin > ini) txt = txt.slice(ini, fin + 1);
        const d = JSON.parse(txt);
        return Response.json({
          success: true, modelo: model,
          data: {
            tarjeta: typeof d.tarjeta === "string" ? d.tarjeta : null,
            cierre: fecha(d.cierre), vencimiento: fecha(d.vencimiento),
            total_ars: num(d.total_ars) ?? 0, total_usd: num(d.total_usd) ?? 0, minimo_ars: num(d.minimo_ars),
            detalle: typeof d.detalle === "string" ? d.detalle : null,
          },
        });
      } catch (e) {
        ultimoError = e;
      }
    }
    console.error("Error leyendo resumen de tarjeta:", ultimoError);
    if (ultimoError instanceof SyntaxError) return Response.json({ error: "No se pudo interpretar la respuesta de la IA. Probá con un archivo más claro." }, { status: 422 });
    return Response.json({ error: ultimoError instanceof Error ? ultimoError.message : "La IA no respondió" }, { status: 500 });
  } catch (error: unknown) {
    console.error("Error leyendo resumen de tarjeta:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error interno del servidor" }, { status: 500 });
  }
}
