import { registrarUsoIA } from "@/lib/ia-uso";
import { createSupabaseServer } from "@/lib/supabase/server";
import { jsonDeTexto, PROMPT_QUE_ES, textoContextoQueEs, validarQueEs, type ContextoQueEs } from "@/lib/banco-que-es";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Bancos › Movimientos › «¿Qué es?» (Augusto 03/11/2026): la IA dice qué parece una línea del banco sin asociar y con qué
 * movimientos o facturas va (lib/banco-que-es). Solo sugiere: no guarda nada; la pantalla muestra «Asociar» o «Cobrar» y
 * una persona confirma. El contexto lo arma la pantalla con lo que ya tiene cargado.
 * Opus 5.5 (si no responde, Sonnet 5.5), como el resto de la IA de Finanzas.
 */
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5"];
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const supabase = (await createSupabaseServer()) as any;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Tenés que iniciar sesión" }, { status: 401 });
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return Response.json({ error: "API key no configurada" }, { status: 500 });
    const b = await request.json().catch(() => null);
    const c = b?.contexto as ContextoQueEs | undefined;
    if (!c?.linea?.id) return Response.json({ error: "Falta la línea del banco" }, { status: 400 });
    const contexto: ContextoQueEs = {
      empresa: String(c.empresa || "Lazzari"),
      linea: { id: String(c.linea.id), fecha: String(c.linea.fecha || ""), concepto: String(c.linea.concepto || ""), importe: Number(c.linea.importe) || 0, cuenta: String(c.linea.cuenta || "") },
      movimientos: (Array.isArray(c.movimientos) ? c.movimientos : []).slice(0, 40),
      facturas: (Array.isArray(c.facturas) ? c.facturas : []).slice(0, 40),
      avisos: (Array.isArray(c.avisos) ? c.avisos : []).slice(0, 20),
      terceros: (Array.isArray(c.terceros) ? c.terceros : []).slice(0, 10).map(String),
    };
    const client = new Anthropic({ apiKey, timeout: 110_000 });
    let ultimo: unknown = null;
    for (const model of MODELOS) {
      try {
        const res = await client.messages.create({ model, max_tokens: 8000, system: PROMPT_QUE_ES, messages: [{ role: "user", content: textoContextoQueEs(contexto) }] });
        await registrarUsoIA("banco_que_es", model, res.usage);
        const t = res.content.map((x) => (x.type === "text" ? x.text : "")).join("");
        return Response.json({ ...validarQueEs(jsonDeTexto(t), contexto), modelo: model });
      } catch (e) {
        ultimo = e;
      }
    }
    console.error("Bancos · ¿Qué es?:", ultimo);
    return Response.json({ error: "La IA no respondió. Probá de nuevo en un rato." }, { status: 502 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo preguntar a la IA" }, { status: 500 });
  }
}
