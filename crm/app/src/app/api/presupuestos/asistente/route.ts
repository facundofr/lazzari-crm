import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Asistente IA del editor de presupuestos (chat). Recibe la conversación, el BORRADOR actual (renglones) y el contexto
 * (cliente, moneda, PR anteriores del cliente, lo que leyó de un Excel/PDF/foto) y devuelve qué responder, qué preguntar
 * y qué ACCIONES hacer sobre el borrador. Nunca cambia nada por sí mismo: el navegador ejecuta las acciones y el vendedor
 * decide cuándo aplicarlo al PR. Opus 5.5 con respaldo.
 */
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"];
export const maxDuration = 90;

const SYSTEM = `Sos el asistente de ventas de Lazzari Soluciones Industriales (ropa de trabajo, EPP y seguridad industrial, Argentina) dentro del editor de presupuestos (PR).
El vendedor conversa con vos, en español rioplatense, para armar y corregir un BORRADOR del presupuesto. Vos proponés y ejecutás cambios sobre el borrador con ACCIONES; el vendedor ve la tabla y recién después lo aplica al PR. Todo es sugerencia: nunca bloqueás nada.

Respondé SOLO un JSON:
{"respuesta":"...","avisos":["..."],"preguntas":[{"pregunta":"...","opciones":["..."]}],"acciones":[ ... ]}

"respuesta": MUY breve: máximo 2 frases cortas (unas 30 palabras). Qué hiciste o qué vas a hacer, sin explicar lo que ya se ve en la tabla ni repetir listas.
"avisos": hasta 3 frases cortísimas (máx. 12 palabras cada una) con lo que el vendedor tiene que mirar (cantidades con decimales, artículos sin costo, dudas de marca). Vacío si no hay nada importante.
"preguntas": solo si realmente te falta un dato que cambia el resultado (talle, modelo, marca, cantidad, a qué PR se refiere, qué hacer con lo que no coincide). Máximo 3, cortas, con "opciones" cuando se pueda (botones de respuesta). Si podés avanzar sin preguntar, avanzá y aclará lo que asumiste. No repitas preguntas ya respondidas en la conversación.

ACCIONES posibles (en el orden en que se ejecutan):
- {"tipo":"armar","modo":"reemplazar"|"sumar","desde_archivo":true}  → arma el borrador con los artículos que se leyeron del archivo adjunto (campo "archivo").
- {"tipo":"armar","modo":"reemplazar"|"sumar","pedidos":[{"descripcion":"","cantidad":1,"talle":"","codigo":"","marca":""}]}  → arma desde artículos que el vendedor dictó en el chat.
- {"tipo":"precio_pr","prs":["1203"],"lineas":"todas"}  → para los renglones cuyo artículo coincide (código o descripción) con un PR anterior, usa el PRECIO de ese PR. Solo el número final del PR.
- {"tipo":"mejores_costos","lineas":"todas"|"sin_precio_pr"|["id1","id2"],"marcas":["Libus"],"proveedores":["Segufer"]}  → busca en la lista de costos el MISMO artículo al menor costo; "marcas"/"proveedores" son restricciones OBLIGATORIAS que pidió el vendedor (respetalas siempre). Usá "sin_precio_pr" para los renglones que no tomaron precio de un PR anterior.
- {"tipo":"ajustar","instruccion":"agregá 20 guantes nitrilo T9"}  → agregar, quitar o cambiar renglones (artículo, cantidad, talle, proveedor preferido) en lenguaje natural.
- {"tipo":"precio","lineas":["id"]|"todas","precio":12.5}  → fija el precio de venta unitario (neto, sin IVA, en la moneda del PR).
- {"tipo":"markup","lineas":["id"]|"todas","porcentaje":30}  → fija el markup sobre el costo.
- {"tipo":"precio_automatico","lineas":["id"]|"todas"}  → vuelve al precio que propone el sistema (último precio al cliente o lista).

Reglas importantes:
- Si el vendedor adjuntó un archivo ("archivo" con renglones leídos) y no dijo otra cosa, armá desde el archivo. Si dijo cómo, seguí lo que dijo.
- "Mantené el precio" / "si el artículo se repite, usá el precio del PR X" = acción precio_pr con ese PR; lo que NO coincide sigue la otra regla que haya pedido (por ejemplo mejores costos) o queda con el precio automático. Aclaralo en la respuesta.
- "Lo más barato / mejores costos": acción mejores_costos, siempre respetando las marcas o proveedores que pidió.
- Si pregunta algo, respondé en "respuesta" sin acciones.
- Si el vendedor corrige algo que hiciste, deshacé o cambiá solo eso con una acción puntual; no rehagas todo.
- Nunca inventes números de PR, artículos, precios ni marcas. Si no sabés, preguntá.
- Los ids de renglón son los del borrador que te paso.
- No tenés que repetir la tabla en la respuesta: el vendedor ya la ve.`;

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
    const mensajes: Array<{ rol: string; texto: string }> = Array.isArray(b.mensajes) ? b.mensajes.slice(-14) : [];
    if (!mensajes.length) return Response.json({ error: "Escribí algo" }, { status: 400 });
    const ctx = b.contexto || {};
    const borrador: any[] = Array.isArray(b.borrador) ? b.borrador.slice(0, 80) : [];
    const archivo = b.archivo && Array.isArray(b.archivo.lineas) ? b.archivo : null;
    const partes = [
      `CONTEXTO: cliente "${String(ctx.cliente || "sin elegir").slice(0, 120)}", moneda del PR ${ctx.moneda || "?"}${ctx.modalidad ? ` (${ctx.modalidad})` : ""}. Renglones que ya tiene el PR en el editor: ${Number(ctx.renglonesPR) || 0}.`,
      ctx.prsCliente?.length ? `PR anteriores de este cliente (podés usarlos como referencia): ${ctx.prsCliente.slice(0, 25).map((p: any) => `${p.numero} (${String(p.fecha || "").slice(0, 10)}, ${p.estado})`).join("; ")}` : "No hay PR anteriores de este cliente.",
      `BORRADOR ACTUAL (${borrador.length} renglones):`,
      borrador.length ? borrador.map(l => `id=${l.id} | ${l.descripcion}${l.talle ? ` T${l.talle}` : ""} | cant ${l.cantidad} | artículo: ${l.articulo || "sin artículo"} | costo ${l.costo ?? "?"} | precio ${l.precio ?? "?"} (${l.fuente || "automático"})${l.nota ? ` | nota: ${l.nota}` : ""}`).join("\n") : "(vacío)",
      archivo ? `ARCHIVO ADJUNTO "${String(archivo.nombre || "").slice(0, 80)}": ${archivo.lineas.length} renglones leídos:\n${archivo.lineas.slice(0, 80).map((l: any) => `- ${l.descripcion}${l.talle ? ` T${l.talle}` : ""} × ${l.cantidad}${l.codigo ? ` (cód ${l.codigo})` : ""}`).join("\n")}${archivo.preguntas?.length ? `\nDudas que la lectura dejó: ${archivo.preguntas.map((p: any) => p.pregunta).join(" | ")}` : ""}` : "Sin archivo adjunto.",
      "CONVERSACIÓN:",
      mensajes.map(m => `${m.rol === "ia" ? "ASISTENTE" : "VENDEDOR"}: ${String(m.texto).slice(0, 2500)}`).join("\n"),
    ];
    const client = new Anthropic({ apiKey });
    let ultimo: unknown = null;
    for (const model of MODELOS) {
      try {
        const res = await client.messages.stream({ model, max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: partes.join("\n\n") }] }).finalMessage();
        await registrarUsoIA("asistente_pr", model, res.usage);
        const t = res.content.find(x => x.type === "text");
        const out = parseJson(t && t.type === "text" ? t.text : "{}");
        const acciones = (Array.isArray(out.acciones) ? out.acciones : []).filter((a: any) => a && typeof a.tipo === "string").slice(0, 8);
        const preguntas = (Array.isArray(out.preguntas) ? out.preguntas : []).filter((p: any) => p && p.pregunta).slice(0, 3)
          .map((p: any) => ({ pregunta: String(p.pregunta), opciones: Array.isArray(p.opciones) ? p.opciones.map(String).slice(0, 6) : [] }));
        const avisos = (Array.isArray(out.avisos) ? out.avisos : []).map((x: unknown) => String(x).slice(0, 140)).filter(Boolean).slice(0, 3);
        return Response.json({ respuesta: String(out.respuesta || ""), avisos, preguntas, acciones });
      } catch (e) { ultimo = e; }
    }
    throw ultimo instanceof Error ? ultimo : new Error("La IA no respondió");
  } catch (error: unknown) {
    console.error("Error en asistente PR:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
