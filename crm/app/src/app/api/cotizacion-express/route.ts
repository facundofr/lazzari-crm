import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Cotización express.
 *  - modo "extraer": de un mensaje, imagen, PDF o texto de Excel saca la lista de artículos pedidos.
 *  - modo "elegir": para cada pedido recibe candidatos de la lista de costos (buscados desde el navegador,
 *    que tiene la sesión del usuario) y la IA elige el que corresponde, con un nivel de confianza.
 * Nunca guarda nada: solo devuelve sugerencias para que el vendedor revise.
 */
const MODEL = "claude-haiku-4-5-20251001";
export const maxDuration = 60;

function parseJson(raw: string) {
  let s = raw.replace(/^```json?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

async function ask(client: Anthropic, system: string, content: Anthropic.MessageParam["content"]) {
  const res = await client.messages.stream({ model: MODEL, max_tokens: 16000, system, messages: [{ role: "user", content }] }).finalMessage();
  await registrarUsoIA("cotizacion_express", MODEL, res.usage);
  const t = res.content.find(b => b.type === "text");
  return parseJson(t && t.type === "text" ? t.text : "{}");
}

const SYS_EXTRAER = `Sos asistente de ventas de Lazzari (EPP, ropa de trabajo, seguridad industrial e insumos, Argentina).
Te pasan el pedido de un cliente (mensaje, captura, PDF o planilla). Extraé TODOS los artículos pedidos, en el mismo orden, sin inventar ni omitir.
- Una línea por artículo. Si un artículo viene con varios talles, una línea por talle.
- "cantidad": número (si no figura, 1).
- "talle": solo si el pedido lo indica (ej "8", "XL", "42"), si no "".
- "codigo": solo si el pedido trae un código del artículo.
- "descripcion": tal cual la pide el cliente, corrigiendo solo abreviaturas obvias (ANT. = anteojo, G. = guante).
Respondé SOLO JSON: {"lineas":[{"descripcion":"","cantidad":1,"talle":"","codigo":""}],"notas":""}`;

const SYS_ELEGIR = `Sos asistente de ventas de Lazzari (EPP, ropa de trabajo, seguridad industrial, Argentina).
Para cada pedido del cliente tenés candidatos de nuestra lista de costos (índice, proveedor, código, descripción, marca, moneda, costo).
Elegí el candidato que sea EL MISMO artículo. Reglas:
- Respetá marca y modelo cuando el pedido los nombra (3M H700 ≠ Libus; H520 ≠ H540; Tychem 2000 ≠ Tyvek).
- Atributos que cambian el artículo: reflectivo, con/sin válvula, carbón activado, claro/oscuro, para químicos/polvo, material (vaqueta, nitrilo, PU), dieléctrico, ignífugo.
- El talle NO cambia el artículo si el candidato no indica talle; si los candidatos vienen por talle, elegí el talle pedido.
- Si vienen PREFERENCIAS DEL VENDEDOR (proveedores, marcas, indicaciones), respetalas primero.
- Si no hay preferencia que decida, y el MISMO artículo lo tienen varios proveedores, elegí el de menor "comparable" (costo ya pasado a la moneda del presupuesto). Nunca compares costos en monedas distintas. En "nota" poné el proveedor alternativo y su comparable (ej "también Segufer US$ 9,08").
- "confianza": "alta" (mismo artículo seguro), "media" (muy probable, falta confirmar un detalle), "baja" (parecido, alternativa), "ninguna" (ningún candidato sirve → indice null).
- "nota": corta, solo si hay algo que el vendedor deba revisar (ej "no se encontró con reflectivo", "alternativa de otra marca").
Respondé SOLO JSON: {"elecciones":[{"id":"","indice":0,"confianza":"alta","nota":""}]}`;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return Response.json({ error: "API key no configurada" }, { status: 500 });
    const client = new Anthropic({ apiKey });
    const body = await request.json();

    if (body.modo === "extraer") {
      const { mensaje, imagen, pdf } = body;
      if (!String(mensaje || "").trim() && !imagen && !pdf) return Response.json({ error: "Pegá un mensaje, una imagen o un archivo" }, { status: 400 });
      const content: any[] = [];
      if (imagen) content.push({ type: "image", source: { type: "base64", media_type: imagen.media_type || "image/jpeg", data: imagen.data } });
      if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.data } });
      content.push({ type: "text", text: String(mensaje || "").trim() ? `Pedido del cliente:\n\n${String(mensaje).slice(0, 60000)}` : "Extraé los artículos del archivo adjunto." });
      const out = await ask(client, SYS_EXTRAER, content);
      return Response.json({ lineas: Array.isArray(out.lineas) ? out.lineas : [], notas: out.notas || "" });
    }

    if (body.modo === "elegir") {
      const pedidos: any[] = Array.isArray(body.pedidos) ? body.pedidos : [];
      const conCandidatos = pedidos.filter(p => Array.isArray(p.candidatos) && p.candidatos.length);
      const tandas: any[][] = [];
      for (let i = 0; i < conCandidatos.length; i += 25) tandas.push(conCandidatos.slice(i, i + 25));
      const resultados = await Promise.all(tandas.map(async t => {
        const texto = t.map(p => [
          `### id=${p.id} | PEDIDO: ${p.descripcion}${p.talle ? ` | talle ${p.talle}` : ""}${p.codigo ? ` | código ${p.codigo}` : ""}`,
          ...p.candidatos.map((c: any, i: number) => `${i}. [${c.proveedor}] ${c.codigo || ""} | ${c.descripcion}${c.marca ? ` | marca ${c.marca}` : ""} | costo ${c.moneda} ${c.costo}${c.costo_comparable != null ? ` | comparable ${body.moneda_comparable || ""} ${c.costo_comparable}` : ""}`),
        ].join("\n")).join("\n\n");
        const pr = body.preferencias || {};
        const pref = [
          pr.proveedores?.length ? `Proveedores ${pr.solo_proveedores ? "OBLIGATORIOS (centralizar la cotización: solo estos)" : "PREFERIDOS (si tienen el mismo artículo o uno equivalente aceptable, elegilos aunque sean algo más caros)"}: ${pr.proveedores.join(", ")}` : "",
          pr.marcas?.length ? `Marcas ${pr.solo_marcas ? "OBLIGATORIAS" : "PREFERIDAS"}: ${pr.marcas.join(", ")}` : "",
          pr.indicaciones ? `Indicaciones del vendedor (tienen prioridad sobre el menor costo): ${String(pr.indicaciones).slice(0, 1000)}` : "",
        ].filter(Boolean).join("\n");
        try { const out = await ask(client, SYS_ELEGIR, [{ type: "text", text: (pref ? `PREFERENCIAS DEL VENDEDOR:\n${pref}\n\n` : "") + texto }]); return Array.isArray(out.elecciones) ? out.elecciones : []; }
        catch { return []; }
      }));
      return Response.json({ elecciones: resultados.flat() });
    }

    return Response.json({ error: "Modo inválido" }, { status: 400 });
  } catch (error: unknown) {
    console.error("Error en cotización express:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
