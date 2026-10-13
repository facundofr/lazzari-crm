import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Limpieza de OC: para cada renglón de una OC escrita a mano, la IA elige qué artículo
 * de la lista de costos DEL PROVEEDOR es (los candidatos los busca el navegador).
 * No guarda nada: devuelve sugerencias para que el usuario apruebe.
 */
const MODELOS = [process.env.CONCILIACION_MODEL || "claude-sonnet-4-5", "claude-haiku-4-5-20251001"];
export const maxDuration = 60;

const SISTEMA = `Sos el asistente de compras de Lazzari (ropa de trabajo, EPP y seguridad industrial, Argentina).
Te paso renglones de órdenes de compra escritos a mano por nosotros y, para cada uno, artículos candidatos de la lista de precios del proveedor.
Elegí el candidato que sea EL MISMO artículo. Reglas:
- Compará tipo de prenda, modelo/línea, tela, color, dama/hombre y atributos que cambian el artículo (reflectivo, ignífugo, con/sin puntera, dieléctrico, etc.).
- El TALLE NO cambia el artículo: si el candidato no tiene talle, igual sirve. Devolvé aparte el talle que pide el renglón (ej. "42", "XL", "3XL"), o "" si no dice.
- Si dudás entre dos, elegí el más parecido y poné confianza "media". Si ninguno sirve, indice null.
- "confianza": "alta" (seguro), "media" (muy probable), "baja" (parecido, revisar), "ninguna".
- "nota": corta y solo si hay algo que revisar.
Respondé SOLO JSON: {"elecciones":[{"id":"","indice":0,"talle":"","confianza":"alta","nota":""}]}`;

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
    const body = await request.json();
    const proveedor = String(body?.proveedor || "");
    const renglones: any[] = (Array.isArray(body?.renglones) ? body.renglones : []).filter((r: any) => Array.isArray(r.candidatos) && r.candidatos.length);
    if (!renglones.length) return Response.json({ elecciones: [] });
    if (renglones.length > 400) return Response.json({ error: "Demasiados renglones de una vez" }, { status: 400 });

    const client = new Anthropic({ apiKey, timeout: 90_000 });
    const tandas: any[][] = [];
    for (let i = 0; i < renglones.length; i += 25) tandas.push(renglones.slice(i, i + 25));

    const resultados = await Promise.all(tandas.map(async (t) => {
      const texto = `Proveedor: ${proveedor}\n\n` + t.map((r) => [
        `### id=${r.id} | RENGLÓN OC: ${r.descripcion}${r.codigo ? ` | código nuestro ${r.codigo}` : ""}`,
        ...r.candidatos.map((c: any, i: number) => `${i}. ${c.codigo || ""} | ${c.descripcion}${c.marca ? ` | ${c.marca}` : ""}`),
      ].join("\n")).join("\n\n");
      for (const model of MODELOS) {
        try {
          const res = await client.messages.create({ model, max_tokens: 8000, system: SISTEMA, messages: [{ role: "user", content: texto }] });
          await registrarUsoIA("normalizar_oc", model, res.usage);
          const raw = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
          const out = parseJson(raw);
          if (Array.isArray(out.elecciones)) return out.elecciones;
        } catch { /* prueba el modelo siguiente */ }
      }
      return [];
    }));
    return Response.json({ elecciones: resultados.flat() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
