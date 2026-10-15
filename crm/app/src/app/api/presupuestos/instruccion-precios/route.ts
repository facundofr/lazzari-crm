import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Editor de PR > "Precios y costos (IA)" > "Decile a la IA": interpreta lo que escribe el vendedor sobre precios y costos
 * ("hice el PR 1203 para el mismo cliente en otra sucursal: si coincide el artículo, mantené ese precio").
 * Solo devuelve qué entendió (PR de referencia y qué hacer): nunca cambia nada. Opus 5.5 con respaldo.
 */
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"];
export const maxDuration = 60;

const SYSTEM = `Sos asistente de ventas de una empresa argentina de ropa de trabajo, EPP y seguridad industrial.
El vendedor está editando un presupuesto (PR) y te escribe una instrucción sobre precios o costos. Interpretala y devolvé SOLO JSON:
{"prs":["1203"],"mantener_precio":true,"mejores_costos":false,"resumen":"","pregunta":""}
Reglas:
- "prs": números de los PR de referencia que nombra (solo el número final: "PR-2026-1203", "pr 1203" o "1203" → "1203"). [] si no nombra ninguno.
- "mantener_precio": true si pide mantener/usar/copiar los precios de PR anteriores (los nombrados, o los últimos que pagó el cliente si no nombra ninguno) para los artículos que coinciden.
- "mejores_costos": true si pide sugerir/buscar mejores costos, más baratos o mejores proveedores.
- "resumen": una frase corta con lo que vas a hacer, en español rioplatense (ej "Voy a mantener el precio del PR 1203 en los artículos que coinciden; el resto queda como está").
- "pregunta": solo si la instrucción es ambigua o no entendés (si no, ""). Nunca inventes números de PR.`;

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
    const { instruccion } = await request.json();
    const texto = String(instruccion || "").trim().slice(0, 3000);
    if (!texto) return Response.json({ error: "Escribí qué querés" }, { status: 400 });
    const client = new Anthropic({ apiKey });
    let ultimo: unknown = null;
    for (const model of MODELOS) {
      try {
        const res = await client.messages.stream({ model, max_tokens: 1000, system: SYSTEM, messages: [{ role: "user", content: texto }] }).finalMessage();
        await registrarUsoIA("precios_pr_instruccion", model, res.usage);
        const t = res.content.find(x => x.type === "text");
        const out = parseJson(t && t.type === "text" ? t.text : "{}");
        const prs = (Array.isArray(out.prs) ? out.prs : []).map((x: unknown) => String(x).replace(/\D/g, "").slice(-5)).filter((x: string) => x.length >= 3);
        return Response.json({ prs, mantener_precio: !!out.mantener_precio, mejores_costos: !!out.mejores_costos, resumen: String(out.resumen || ""), pregunta: String(out.pregunta || "") });
      } catch (e) { ultimo = e; }
    }
    throw ultimo instanceof Error ? ultimo : new Error("La IA no respondió");
  } catch (error: unknown) {
    console.error("Error en instruccion-precios:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
