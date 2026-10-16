import { registrarUsoIA } from "@/lib/ia-uso";
import { createSupabaseServer } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Remitos nueva: "Decile a la IA" (ej. "entregá lo de Corteva menos los guantes", "partilo en 2 sucursales",
 * "lo de Adecco ya se entregó", "el R-1234 lo lleva Expreso Sur").
 * La IA solo propone acciones; la pantalla muestra qué haría y el usuario aprieta "Hacerlo" (con Deshacer). No guarda nada.
 */
export const maxDuration = 90;

const SISTEMA = `Sos el asistente de entregas de Lazzari (ropa de trabajo, EPP y seguridad industrial, Argentina).
Te paso lo que falta entregar por PR (con renglones, lo pendiente y lo que ya llegó), los remitos en camino, los transportistas y una instrucción del usuario.
Traducí la instrucción a acciones. Tipos:
- {"tipo":"crear_remito","pr_id":"","sucursal_id":"<id o null>","items":[{"presupuesto_item_id":"","cantidad":0}],"motivo":""}
  "entregá / remitá / mandá lo de X": un remito con lo pendiente (o lo que pida). "menos los guantes": sacá esos renglones.
  "solo lo que llegó": usá "llego" como cantidad. "partilo en 2 sucursales" o "N a la sucursal Y": un crear_remito por sucursal con las cantidades que diga.
  La cantidad nunca puede superar el pendiente del renglón.
- {"tipo":"entregado","remito_id":"","motivo":""}: "el R-123 ya se entregó / llegó / lo recibieron".
- {"tipo":"ya_entregado_sin_remito","pr_id":"","motivo":""}: "lo de X se entregó sin remito / ya está entregado" (para PR sin remito).
- {"tipo":"transporte","remito_id":"","transportista_id":"","motivo":""}: "lo lleva X" (solo transportistas de la lista).
Usá SOLO ids que aparecen en los datos. Si nombra algo que no está, no lo inventes: explicalo.
Si la instrucción no se entiende o no aplica, devolvé acciones vacías y explicá por qué.
"explicacion": 1 o 2 oraciones en castellano rioplatense, simple, en condicional ("Haría…"): todavía no se hizo nada.
Respondé SOLO JSON: {"explicacion":"","acciones":[...]}`;

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
    const instruccion = String(body?.instruccion || "").trim().slice(0, 1000);
    if (!instruccion) return Response.json({ error: "Escribí qué querés hacer" }, { status: 400 });

    const prs = (Array.isArray(body?.prs) ? body.prs : []).slice(0, 150);
    const remitos = (Array.isArray(body?.remitos) ? body.remitos : []).slice(0, 150);
    const transportistas = (Array.isArray(body?.transportistas) ? body.transportistas : []).slice(0, 300)
      .map((t: any) => ({ id: String(t.id || ""), nombre: String(t.nombre || "").slice(0, 80) })).filter((t: any) => t.id && t.nombre);

    // Lo válido, para revisar lo que devuelve la IA.
    const pendientePorItem = new Map<string, { pr: string; pendiente: number }>();
    const sucursalesPorPR = new Map<string, Set<string>>();
    const prIds = new Set<string>();
    const lineas: string[] = ["PARA ENTREGAR:"];
    for (const p of prs) {
      const id = String(p.id || "");
      if (!id) continue;
      prIds.add(id);
      const sucs = (Array.isArray(p.sucursales) ? p.sucursales : []).slice(0, 30);
      sucursalesPorPR.set(id, new Set(sucs.map((s: any) => String(s.id || "")).filter(Boolean)));
      lineas.push(`PR ${id} | ${String(p.numero || "")} | cliente ${String(p.cliente || "").slice(0, 80)}${p.sin_remito ? " | (facturado, sin ningún remito)" : ""}`);
      if (sucs.length) lineas.push(`  sucursales: ${sucs.map((s: any) => `${String(s.id)} = ${String(s.nombre || "").slice(0, 60)}`).join(" ; ")}`);
      for (const it of (Array.isArray(p.items) ? p.items : []).slice(0, 120)) {
        const iid = String(it.presupuesto_item_id || "");
        const pend = Number(it.pendiente) || 0;
        if (!iid || pend <= 0) continue;
        pendientePorItem.set(iid, { pr: id, pendiente: pend });
        lineas.push(`  - item ${iid} | ${String(it.descripcion || "").slice(0, 150)} | pendiente ${pend} | llegó ${it.disponible == null ? "?" : Number(it.disponible)}`);
      }
    }
    const remitoIds = new Set<string>();
    lineas.push("", "EN CAMINO:");
    for (const r of remitos) {
      const id = String(r.id || "");
      if (!id) continue;
      remitoIds.add(id);
      lineas.push(`REMITO ${id} | N° ${String(r.numero || "")} | ${String(r.cliente || "").slice(0, 80)} | ${String(r.pr || "")} | ${(Array.isArray(r.items) ? r.items : []).slice(0, 8).map((i: any) => `${Number(i.cantidad) || 0} ${String(i.descripcion || "").slice(0, 40)}`).join(", ")}`);
    }
    const transIds = new Set(transportistas.map((t: any) => t.id));
    const texto = `INSTRUCCIÓN: ${instruccion}\n\n${lineas.join("\n")}\n\nTRANSPORTISTAS (id | nombre):\n${transportistas.map((t: any) => `${t.id} | ${t.nombre}`).join("\n") || "(ninguno)"}`;

    const client = new Anthropic({ apiKey, timeout: 80_000 });
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"]) {
      try {
        const res = await client.messages.create({ model, max_tokens: 4000, system: SISTEMA, messages: [{ role: "user", content: texto }] });
        await registrarUsoIA("remitos_instruccion", res.model, res.usage);
        const out = parseJson(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
        const usado = new Map<string, number>();
        const acciones = (Array.isArray(out.acciones) ? out.acciones : []).map((a: any) => {
          const motivo = String(a.motivo || "").slice(0, 160);
          if (a.tipo === "crear_remito") {
            const pr = String(a.pr_id || "");
            if (!prIds.has(pr)) return null;
            const suc = a.sucursal_id && sucursalesPorPR.get(pr)?.has(String(a.sucursal_id)) ? String(a.sucursal_id) : null;
            const items = (Array.isArray(a.items) ? a.items : []).map((i: any) => {
              const iid = String(i.presupuesto_item_id || "");
              const info = pendientePorItem.get(iid);
              if (!info || info.pr !== pr) return null;
              // Entre varios remitos (sucursales) no se puede pasar del pendiente.
              const queda = info.pendiente - (usado.get(iid) || 0);
              const cantidad = Math.min(Number(i.cantidad) || 0, queda);
              if (cantidad <= 0) return null;
              usado.set(iid, (usado.get(iid) || 0) + cantidad);
              return { presupuesto_item_id: iid, cantidad };
            }).filter(Boolean);
            return items.length ? { tipo: "crear_remito", pr_id: pr, sucursal_id: suc, items, motivo } : null;
          }
          if (a.tipo === "entregado") return remitoIds.has(String(a.remito_id || "")) ? { tipo: "entregado", remito_id: String(a.remito_id), motivo } : null;
          if (a.tipo === "ya_entregado_sin_remito") return prIds.has(String(a.pr_id || "")) ? { tipo: "ya_entregado_sin_remito", pr_id: String(a.pr_id), motivo } : null;
          if (a.tipo === "transporte") return remitoIds.has(String(a.remito_id || "")) && transIds.has(String(a.transportista_id || "")) ? { tipo: "transporte", remito_id: String(a.remito_id), transportista_id: String(a.transportista_id), motivo } : null;
          return null;
        }).filter(Boolean);
        return Response.json({ explicacion: String(out.explicacion || "").slice(0, 500), acciones });
      } catch { /* prueba el modelo siguiente */ }
    }
    return Response.json({ error: "La IA no respondió. Probá de nuevo en un rato." }, { status: 502 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
