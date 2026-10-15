import { limpiarPdfBase64 } from "@/lib/pdf-limpiar";
import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Cotización express.
 *  - modo "extraer": de un mensaje, imagen, PDF o texto de Excel saca la lista de artículos pedidos.
 *    Si falta un dato que cambia el artículo (talle, modelo, marca, cantidad) devuelve "preguntas" (nunca inventa).
 *  - modo "elegir": para cada pedido recibe candidatos de la lista de costos (buscados desde el navegador,
 *    que tiene la sesión del usuario) y la IA elige el que corresponde, con un nivel de confianza.
 *  - modo "ajustar": recibe las líneas ya armadas + lo que pide el vendedor ("agregame 20 guantes nitrilo T9",
 *    "cambiá los anteojos a Segufer", "sacá X") y devuelve agregar / cambiar / quitar / preguntas.
 * Nunca guarda nada: solo devuelve sugerencias para que el vendedor revise.
 */
// Modelo más efectivo (Augusto 16/10/2026: Opus 5.5). Si no está disponible o falla, se prueba con los de respaldo.
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"];
export const maxDuration = 120;

function parseJson(raw: string) {
  let s = raw.replace(/^```json?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

async function ask(client: Anthropic, system: string, content: Anthropic.MessageParam["content"]) {
  let ultimoError: unknown = null;
  for (const model of MODELOS) {
    try {
      const res = await client.messages.stream({ model, max_tokens: 16000, system, messages: [{ role: "user", content }] }).finalMessage();
      await registrarUsoIA("cotizacion_express", model, res.usage);
      const t = res.content.find(b => b.type === "text");
      return parseJson(t && t.type === "text" ? t.text : "{}");
    } catch (e) {
      ultimoError = e; // modelo no disponible, saturado o respuesta ilegible: se prueba con el siguiente
    }
  }
  throw ultimoError instanceof Error ? ultimoError : new Error("La IA no respondió");
}

const SYS_EXTRAER = `Sos asistente de ventas de Lazzari (EPP, ropa de trabajo, seguridad industrial e insumos, Argentina).
Te pasan el pedido de un cliente (mensaje, captura, PDF o planilla). Extraé TODOS los artículos pedidos, en el mismo orden, sin inventar ni omitir.
- Una línea por artículo. Si un artículo viene con varios talles, una línea por talle.
- "cantidad": número (si no figura, 1).
- "talle": solo si el pedido lo indica (ej "8", "XL", "42"), si no "".
- "codigo": solo si el pedido trae un código del artículo.
- "descripcion": tal cual la pide el cliente, corrigiendo solo abreviaturas obvias (ANT. = anteojo, G. = guante).
- NUNCA inventes datos. Si falta un dato que CAMBIA el artículo y no se puede cotizar bien sin él (talle de calzado o ropa
  cuando el cliente no lo dice, modelo o marca cuando el pedido es ambiguo, cantidad cuando no se entiende), agregá una
  pregunta corta en "preguntas" con la línea a la que se refiere. No preguntes lo que ya está claro ni lo que ya respondió el vendedor.
  Igual devolvé la línea con lo que sí sabés (cantidad 1 si no figura).
- "cliente": quién pide, SOLO si se lee en el pedido (firma, membrete, CUIT, mail, "somos de X"). Si no figura, dejá vacío cada dato. No inventes.
- "moneda_pedida": "USD" o "ARS" solo si el cliente la indica; si no, "".
- "resumen": una frase corta de lo que pide el cliente (ej "10 botines y 20 anteojos para planta Pergamino, urgente").
Respondé SOLO JSON: {"lineas":[{"descripcion":"","cantidad":1,"talle":"","codigo":""}],"preguntas":[{"linea":"","pregunta":""}],"cliente":{"empresa":"","cuit":"","email":"","contacto":""},"moneda_pedida":"","resumen":"","notas":""}`;

const SYS_AJUSTAR = `Sos asistente de ventas de Lazzari (EPP, ropa de trabajo, seguridad industrial, Argentina).
Te paso las líneas de una cotización ya armada (id, pedido, cantidad, talle, artículo elegido) y lo que pide el vendedor.
Devolvé SOLO los cambios que pide, sin tocar el resto:
- "agregar": líneas nuevas {"descripcion","cantidad","talle","codigo","proveedor_preferido"} (descripción como la diría el cliente).
- "cambiar": {"id", y solo los campos que cambian: "cantidad", "talle", "descripcion" (si pide otro artículo/modelo/marca), "proveedor_preferido"}.
  "cambiá los anteojos a Segufer" = cambiar las líneas de anteojos con proveedor_preferido "Segufer".
- "quitar": ids de las líneas a sacar.
- NUNCA inventes. Si no queda claro a qué línea se refiere o falta un dato que cambia el artículo (talle, modelo, marca, cantidad),
  no adivines: poné la pregunta en "preguntas" y no hagas ese cambio.
- "resumen": una frase corta de lo que hiciste.
Respondé SOLO JSON: {"agregar":[],"cambiar":[],"quitar":[],"preguntas":[{"linea":"","pregunta":""}],"resumen":""}`;

const SYS_ELEGIR = `Sos asistente de ventas de Lazzari (EPP, ropa de trabajo, seguridad industrial, Argentina).
Para cada pedido del cliente tenés candidatos de nuestra lista de costos (índice, proveedor, código, descripción, marca, moneda, costo).
Elegí el candidato que sea EL MISMO artículo. Reglas:
- Respetá marca y modelo cuando el pedido los nombra (3M H700 ≠ Libus; H520 ≠ H540; Tychem 2000 ≠ Tyvek).
- Atributos que cambian el artículo: reflectivo, con/sin válvula, carbón activado, claro/oscuro, para químicos/polvo, material (vaqueta, nitrilo, PU), dieléctrico, ignífugo.
- El talle NO cambia el artículo si el candidato no indica talle; si los candidatos vienen por talle, elegí el talle pedido.
- Si el pedido trae "ya le vendimos" (artículos que ESTE cliente ya compró antes), y alguno es el mismo artículo que pide, elegí ese: el cliente ya lo conoce.
- Si vienen PREFERENCIAS DEL VENDEDOR (proveedores, marcas, indicaciones), respetalas primero.
- Si un pedido trae "proveedor preferido", elegí el candidato de ese proveedor cuando sea el mismo artículo o uno equivalente aceptable; si no lo tiene, decilo en "nota".
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
      const { mensaje, imagen, pdf, respuestas } = body;
      if (!String(mensaje || "").trim() && !imagen && !pdf) return Response.json({ error: "Pegá un mensaje, una imagen o un archivo" }, { status: 400 });
      const content: any[] = [];
      if (imagen) content.push({ type: "image", source: { type: "base64", media_type: imagen.media_type || "image/jpeg", data: imagen.data } });
      if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: limpiarPdfBase64(pdf.data) } });
      content.push({ type: "text", text: String(mensaje || "").trim() ? `Pedido del cliente:\n\n${String(mensaje).slice(0, 60000)}` : "Extraé los artículos del archivo adjunto." });
      if (String(respuestas || "").trim()) content.push({ type: "text", text: `Respuestas del vendedor a tus preguntas (usalas y no vuelvas a preguntar lo ya respondido; si dejó algo sin responder, no lo inventes):\n${String(respuestas).slice(0, 4000)}` });
      const out = await ask(client, SYS_EXTRAER, content);
      const cli = out.cliente && typeof out.cliente === "object" ? out.cliente : {};
      return Response.json({
        lineas: Array.isArray(out.lineas) ? out.lineas : [],
        preguntas: Array.isArray(out.preguntas) ? out.preguntas.filter((p: any) => p && p.pregunta) : [],
        cliente: { empresa: String(cli.empresa || ""), cuit: String(cli.cuit || ""), email: String(cli.email || ""), contacto: String(cli.contacto || "") },
        moneda_pedida: out.moneda_pedida === "USD" || out.moneda_pedida === "ARS" ? out.moneda_pedida : "",
        resumen: String(out.resumen || ""), notas: out.notas || "",
      });
    }

    if (body.modo === "ajustar") {
      const instruccion = String(body.instruccion || "").trim();
      const lineas: any[] = Array.isArray(body.lineas) ? body.lineas : [];
      if (!instruccion) return Response.json({ error: "Escribí qué querés cambiar" }, { status: 400 });
      const texto = lineas.map((l) => `id=${l.id} | pedido: ${l.descripcion} | cant ${l.cantidad}${l.talle ? ` | talle ${l.talle}` : ""}${l.articulo ? ` | elegido: ${l.articulo}` : " | sin artículo"}${l.incluida === false ? " | (destildada)" : ""}`).join("\n");
      const out = await ask(client, SYS_AJUSTAR, [{ type: "text", text: `LÍNEAS ACTUALES:\n${texto || "(ninguna)"}\n\nLO QUE PIDE EL VENDEDOR:\n${instruccion.slice(0, 4000)}` }]);
      const arr = (x: unknown) => (Array.isArray(x) ? x : []);
      return Response.json({ agregar: arr(out.agregar), cambiar: arr(out.cambiar), quitar: arr(out.quitar).map(String), preguntas: arr(out.preguntas).filter((p: any) => p && p.pregunta), resumen: out.resumen || "" });
    }

    if (body.modo === "elegir") {
      const pedidos: any[] = Array.isArray(body.pedidos) ? body.pedidos : [];
      const conCandidatos = pedidos.filter(p => Array.isArray(p.candidatos) && p.candidatos.length);
      const tandas: any[][] = [];
      for (let i = 0; i < conCandidatos.length; i += 25) tandas.push(conCandidatos.slice(i, i + 25));
      const resultados = await Promise.all(tandas.map(async t => {
        const texto = t.map(p => [
          `### id=${p.id} | PEDIDO: ${p.descripcion}${p.talle ? ` | talle ${p.talle}` : ""}${p.codigo ? ` | código ${p.codigo}` : ""}${p.proveedor_preferido ? ` | proveedor preferido ${p.proveedor_preferido}` : ""}${Array.isArray(p.ya_vendido) && p.ya_vendido.length ? ` | ya le vendimos: ${p.ya_vendido.slice(0, 5).map((x: any) => String(x).slice(0, 90)).join(" // ")}` : ""}`,
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
