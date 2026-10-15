import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Presupuestos nuevo > Seguimiento: la IA (Opus 5.5) escribe el mensaje de seguimiento de un PR pendiente o vencido.
 * Solo escribe el texto: no manda nada. Lo manda la persona (mail desde su programa de correo o WhatsApp).
 */
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"];
export const maxDuration = 60;

const SYSTEM = `Sos asistente de ventas de una empresa argentina de ropa de trabajo, EPP y seguridad industrial.
Escribí un mensaje corto de seguimiento de un presupuesto, en español rioplatense (vos), cordial, profesional y sin presionar.
Reglas:
- Saludá por el nombre del contacto si lo tenés; si no, "Hola".
- Nombrá el presupuesto por su número y mencioná 1 o 2 artículos principales (no listes todo).
- Presupuesto "pendiente": preguntá si pudieron revisarlo y ofrecé ajustar cantidades, talles o plazos.
- Presupuesto "vencido": avisá que la validez venció y ofrecé actualizarlo con precios y stock de hoy, si siguen interesados.
- Si ya hubo contactos previos, no repitas lo mismo: sé más breve y variá el enfoque.
- No inventes descuentos, plazos ni precios que no te di. No prometas nada.
- Firmá con el nombre del vendedor y la empresa.
- "whatsapp": versión más corta e informal (3 o 4 líneas), sin asunto.
Respondé SOLO JSON: {"asunto":"","cuerpo":"","whatsapp":""}  ("cuerpo" es texto plano con saltos de línea, sin HTML).`;

function parseJson(raw: string) {
  let s = raw.replace(/^```json?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return Response.json({ error: "API key no configurada" }, { status: 500 });
    const b = await request.json();
    if (!b?.numero) return Response.json({ error: "Falta el presupuesto" }, { status: 400 });
    const client = new Anthropic({ apiKey });
    const datos = [
      `Presupuesto: ${b.numero} (${b.estado === "vencido" ? "VENCIDO" : "pendiente"})`,
      `Cliente: ${b.cliente || ""}`,
      `Contacto: ${b.contacto || "(sin nombre)"}`,
      `Total: ${b.total || ""}`,
      `Enviado hace: ${b.diasEnviado ?? "?"} días`,
      b.vencimiento ? `Vence/venció: ${b.vencimiento}` : "",
      `Contactos previos: ${b.contactosPrevios ?? 0}${b.ultimoCanal ? ` (último por ${b.ultimoCanal})` : ""}`,
      `Artículos principales: ${(Array.isArray(b.items) ? b.items : []).slice(0, 4).map((x: any) => String(x).slice(0, 80)).join("; ") || "(no disponible)"}`,
      `Vendedor: ${b.vendedor || ""}`,
      `Empresa: ${b.empresa || "Lazzari Soluciones Industriales"}`,
    ].filter(Boolean).join("\n");

    let ultimo: unknown = null;
    for (const model of MODELOS) {
      try {
        const res = await client.messages.stream({ model, max_tokens: 2000, system: SYSTEM, messages: [{ role: "user", content: datos }] }).finalMessage();
        await registrarUsoIA("seguimiento_pr", model, res.usage);
        const t = res.content.find(x => x.type === "text");
        const out = parseJson(t && t.type === "text" ? t.text : "{}");
        return Response.json({ asunto: String(out.asunto || `Presupuesto ${b.numero}`), cuerpo: String(out.cuerpo || ""), whatsapp: String(out.whatsapp || out.cuerpo || "") });
      } catch (e) { ultimo = e; }
    }
    throw ultimo instanceof Error ? ultimo : new Error("La IA no respondió");
  } catch (error: unknown) {
    console.error("Error en seguimiento-mensaje:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
