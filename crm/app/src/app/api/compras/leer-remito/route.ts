import { registrarUsoIA } from "@/lib/ia-uso";
import { createSupabaseServer } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Compras nueva > Esperando: lee la foto (o PDF) del REMITO DEL PROVEEDOR que vino con la mercadería.
 * Le pasan las OC que están esperando (con sus renglones) y dice a cuál corresponde y cuánto llegó de cada renglón.
 * No guarda nada: la pantalla carga lo recibido en la OC (con Deshacer).
 */
export const maxDuration = 120;

const SISTEMA = `Sos el asistente de compras de Lazzari (ropa de trabajo, EPP y seguridad industrial, Argentina).
Te paso la foto (o PDF) del REMITO que mandó un PROVEEDOR junto con la mercadería, y las órdenes de compra (OC) que estamos esperando, con sus renglones.
Leé con cuidado y devolvé SOLO JSON:
{"proveedor":"<razón social impresa o null>","proveedor_cuit":"<CUIT impreso o null>","numero_remito":"<número del remito o null>",
 "fecha":"<YYYY-MM-DD del remito o null>","oc_numero":"<número de nuestra OC si figura en el remito (\\"Su OC\\", \\"Pedido\\", \\"Ref\\") o null>",
 "oc_id":"<id de la lista que corresponde, o null si no estás seguro>",
 "renglones":[{"item_id":"<id del renglón de esa OC, o null si no está en la OC>","descripcion":"<como figura en el remito>","codigo":"<código o null>","cantidad":0}],
 "anotaciones":"<lo escrito a mano o aclaraciones (\\"queda pendiente\\", \\"falta talle 42\\"), textual, o null>",
 "segura":true|false,"resumen":"<1 oración en castellano rioplatense>"}
Reglas:
- "cantidad" es lo que vino en ESTE remito (no lo pedido). Si dice "pendiente" o "a entregar" no cuenta como llegado.
- Atá cada renglón al de la OC por código, descripción, talle y color. Si el talle o el color no coinciden, NO lo ates (item_id null).
- Si un artículo vino en varios talles y la OC tiene un renglón por talle, separalos.
- "segura": true solo si no tenés dudas de la OC ni de ningún renglón.
- No inventes: si algo no se lee, null.`;

function parseJson(raw: string) {
  let s = raw.replace(/^```json?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

export async function POST(request: NextRequest) {
  try {
    const sb = await createSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return Response.json({ error: "API key no configurada" }, { status: 500 });
    const body = await request.json();
    const data = String(body?.base64 || "");
    const mediaType = String(body?.mediaType || "image/jpeg");
    if (!data) return Response.json({ error: "No llegó la foto" }, { status: 400 });
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mediaType)) return Response.json({ error: "Mandá una foto (JPG, PNG) o un PDF" }, { status: 400 });

    const ocs = (Array.isArray(body?.ocs) ? body.ocs : []).slice(0, 80);
    const ocIds = new Set<string>();
    const itemDeOc = new Map<string, string>();
    const lineas: string[] = [];
    for (const o of ocs) {
      const id = String(o.id || "");
      if (!id) continue;
      ocIds.add(id);
      lineas.push(`OC ${id} | N° ${String(o.numero || "")} | ${String(o.proveedor || "").slice(0, 80)}${o.cuit ? ` (CUIT ${String(o.cuit)})` : ""} | pedida ${String(o.fecha || "")}`);
      for (const it of (Array.isArray(o.items) ? o.items : []).slice(0, 80)) {
        const iid = String(it.id || "");
        if (!iid) continue;
        itemDeOc.set(iid, id);
        lineas.push(`  - ${iid} | ${it.codigo ? `${String(it.codigo).slice(0, 40)} · ` : ""}${String(it.descripcion || "").slice(0, 150)} | pedido ${String(it.cantidad ?? "")} | ya llegó ${String(it.recibida ?? 0)}`);
      }
    }

    const archivo = mediaType === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data } };
    const client = new Anthropic({ apiKey, timeout: 100_000 });
    let ultimoError: unknown = null;
    // Modelo más efectivo (Opus 5.5) para leer remitos (letra chica, a mano); si falla, los de respaldo.
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"]) {
      try {
        const res = await client.messages.create({
          model, max_tokens: 4000, system: SISTEMA,
          messages: [{ role: "user", content: [archivo, { type: "text", text: `OC QUE ESTAMOS ESPERANDO:\n${lineas.join("\n") || "(ninguna)"}` }] }],
        });
        await registrarUsoIA("remito_proveedor_foto", res.model, res.usage);
        const out = parseJson(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
        const ocId = out.oc_id && ocIds.has(String(out.oc_id)) ? String(out.oc_id) : null;
        // Un renglón atado a otra OC distinta de la elegida no se acepta (queda sin atar).
        const renglones = (Array.isArray(out.renglones) ? out.renglones : []).slice(0, 120).map((r: any) => {
          const iid = r.item_id ? String(r.item_id) : null;
          const valido = !!iid && itemDeOc.has(iid) && (!ocId || itemDeOc.get(iid) === ocId);
          return {
            item_id: valido ? iid : null,
            oc_id: valido ? itemDeOc.get(iid!) : null,
            descripcion: String(r.descripcion || "").slice(0, 200),
            codigo: r.codigo ? String(r.codigo).slice(0, 60) : null,
            cantidad: Number(r.cantidad) || 0,
          };
        }).filter((r: any) => r.cantidad > 0 || r.descripcion);
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(out.fecha || "")) ? String(out.fecha) : null;
        return Response.json({
          proveedor: out.proveedor ? String(out.proveedor).slice(0, 120) : null,
          proveedor_cuit: out.proveedor_cuit ? String(out.proveedor_cuit).slice(0, 20) : null,
          numero_remito: out.numero_remito ? String(out.numero_remito).slice(0, 40) : null,
          fecha,
          oc_numero: out.oc_numero ? String(out.oc_numero).slice(0, 40) : null,
          oc_id: ocId,
          renglones,
          anotaciones: out.anotaciones ? String(out.anotaciones).slice(0, 500) : null,
          segura: !!out.segura && !!ocId,
          resumen: String(out.resumen || "").slice(0, 300),
          modelo: res.model,
        });
      } catch (e) { ultimoError = e; }
    }
    return Response.json({ error: ultimoError instanceof Error ? `La IA no pudo leer el remito: ${ultimoError.message}` : "La IA no respondió" }, { status: 502 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
