import { registrarUsoIA } from "@/lib/ia-uso";
import { createSupabaseServer } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Remitos nueva: lee la foto del remito firmado (número, cliente, fecha, firma, aclaración y lo anotado a mano).
 * Si le pasan los remitos en camino, dice a cuál corresponde y qué renglones anotaron como faltantes.
 * No guarda nada: la pantalla muestra lo leído y marca la entrega (con Deshacer).
 */
export const maxDuration = 120;

const SISTEMA = `Sos el asistente de entregas de Lazzari (ropa de trabajo, EPP y seguridad industrial, Argentina).
Te paso la foto (o PDF) de un REMITO que el cliente firmó al recibir la mercadería, y la lista de remitos que están en camino.
Leé con cuidado y devolvé SOLO JSON:
{"numero":"<número del remito impreso o null>","cliente":"<razón social impresa o null>","fecha_recibido":"<YYYY-MM-DD de la firma/recepción o null>",
 "firmado":true|false,"recibio":"<aclaración / nombre de quien firmó o null>",
 "anotaciones":"<todo lo escrito a mano además de firma y aclaración, textual, o null>",
 "remito_id":"<id de la lista que corresponde, o null si no estás seguro>",
 "faltantes":[{"descripcion":"","cantidad":0,"presupuesto_item_id":"<si podés atarlo a un renglón del remito, o null>"}],
 "conforme":true|false,"resumen":"<1 oración en castellano rioplatense>"}
Reglas:
- "firmado": hay firma o sello de recepción. Si no hay, false.
- "faltantes": solo si a mano dice que falta algo, que vino menos o tachan/corrigen una cantidad ("faltan 2", "recibí 8"). La cantidad es lo que FALTA.
- "conforme": firmado y sin faltantes ni quejas ("roto", "mal talle", "no corresponde").
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

    const remitos = (Array.isArray(body?.remitos) ? body.remitos : []).slice(0, 80);
    const ids = new Set<string>();
    const itemIds = new Set<string>();
    const lineas: string[] = [];
    for (const r of remitos) {
      const id = String(r.id || "");
      if (!id) continue;
      ids.add(id);
      lineas.push(`REMITO ${id} | N° ${String(r.numero || "")}${r.cai ? ` (CAI ${String(r.cai)})` : ""} | ${String(r.cliente || "").slice(0, 80)} | fecha ${String(r.fecha || "")}`);
      for (const it of (Array.isArray(r.items) ? r.items : []).slice(0, 60)) {
        const iid = String(it.presupuesto_item_id || "");
        if (iid) itemIds.add(iid);
        lineas.push(`  - ${iid || "-"} | ${String(it.descripcion || "").slice(0, 150)} | cant ${String(it.cantidad ?? "")}`);
      }
    }

    const archivo = mediaType === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data } };
    const client = new Anthropic({ apiKey, timeout: 100_000 });
    let ultimoError: unknown = null;
    // Modelo más efectivo (Opus 5.5) para leer letra a mano; si falla, los de respaldo.
    // Augusto 26/10/2026: Opus 5.5 con esfuerzo alto; si no responde, Sonnet 5.5 (Haiku 4.5 no acepta el esfuerzo).
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
      try {
        const res = await client.messages.create({
          model, max_tokens: 12000, output_config: { effort: "high" }, system: SISTEMA,
          messages: [{ role: "user", content: [archivo, { type: "text", text: `REMITOS EN CAMINO:\n${lineas.join("\n") || "(ninguno)"}` }] }],
        });
        await registrarUsoIA("remito_foto", res.model, res.usage);
        const out = parseJson(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
        const remitoId = out.remito_id && ids.has(String(out.remito_id)) ? String(out.remito_id) : null;
        const faltantes = (Array.isArray(out.faltantes) ? out.faltantes : []).map((f: any) => ({
          descripcion: String(f.descripcion || "").slice(0, 200),
          cantidad: Number(f.cantidad) || 0,
          presupuesto_item_id: f.presupuesto_item_id && itemIds.has(String(f.presupuesto_item_id)) ? String(f.presupuesto_item_id) : null,
        })).filter((f: any) => f.descripcion || f.cantidad);
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(out.fecha_recibido || "")) ? String(out.fecha_recibido) : null;
        return Response.json({
          numero: out.numero ? String(out.numero).slice(0, 40) : null,
          cliente: out.cliente ? String(out.cliente).slice(0, 120) : null,
          fecha_recibido: fecha,
          firmado: !!out.firmado,
          recibio: out.recibio ? String(out.recibio).slice(0, 120) : null,
          anotaciones: out.anotaciones ? String(out.anotaciones).slice(0, 500) : null,
          remito_id: remitoId,
          faltantes,
          conforme: !!out.conforme && !faltantes.length,
          resumen: String(out.resumen || "").slice(0, 300),
          modelo: res.model,
        });
      } catch (e) { ultimoError = e; }
    }
    return Response.json({ error: ultimoError instanceof Error ? `La IA no pudo leer la foto: ${ultimoError.message}` : "La IA no respondió" }, { status: 502 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
