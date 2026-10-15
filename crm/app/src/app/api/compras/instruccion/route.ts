import { registrarUsoIA } from "@/lib/ia-uso";
import { createSupabaseServer } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Compras nueva: "Decile a la IA" (ej. "centralizá lo del PR-1234 en Funcional", "Mediglove no tiene guantes, pedíselos a Bioseif").
 * La IA solo propone movimientos de renglones entre proveedores; la pantalla muestra el antes/después y el usuario confirma.
 * No guarda nada.
 */
const MODELOS = [process.env.CONCILIACION_MODEL || "claude-sonnet-4-5", "claude-haiku-4-5-20251001"];
export const maxDuration = 60;

const SISTEMA = `Sos el asistente de compras de Lazzari (ropa de trabajo, EPP y seguridad industrial, Argentina).
Te paso los pedidos a proveedores que todavía NO se mandaron (con sus renglones), la lista de proveedores y una instrucción del usuario.
Traducí la instrucción a movimientos de renglones:
- "centralizá / juntá / pedí todo en X" o "pedíselo a X": mové a X los renglones que correspondan, TAMBIÉN los que están "SIN PROVEEDOR" (asignarles proveedor es lo más común).
- Si nombra un PR, un número de OC o un cliente ("lo de Limagrain"), solo los renglones de esos pedidos. Si no nombra nada, todos los que tenga sentido.
- No muevas renglones que ya están en X.
- "X no tiene stock de ...": sacá esos renglones de X; si dice a quién pedírselos, movelos ahí; si no, mandalos a "sin proveedor" (proveedor_id null).
- Usá SOLO ids que aparecen en los datos. Si un proveedor nombrado no está en la lista, no lo inventes: explicalo.
- Si la instrucción no se entiende o no aplica, devolvé movimientos vacíos y explicá por qué.
- "explicacion": 1 o 2 oraciones en castellano rioplatense, simple, en condicional ("Pasaría…"): todavía no se hizo nada, el usuario confirma después.
Respondé SOLO JSON: {"explicacion":"","movimientos":[{"item_ids":[""],"proveedor_id":"<id o null>","motivo":""}]}`;

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
    const pedidos = (Array.isArray(body?.pedidos) ? body.pedidos : []).slice(0, 200);
    const proveedores = (Array.isArray(body?.proveedores) ? body.proveedores : []).slice(0, 1000)
      .map((p: any) => ({ id: String(p.id || ""), nombre: String(p.nombre || "").slice(0, 80) })).filter((p: any) => p.id && p.nombre);
    const itemIds = new Set<string>();
    const lineas: string[] = [];
    for (const p of pedidos) {
      lineas.push(`PEDIDO ${String(p.numero || "")} | proveedor: ${p.proveedor_id ? `${String(p.proveedor || "")} (${String(p.proveedor_id)})` : "SIN PROVEEDOR"}${p.pr_numero ? ` | ${String(p.pr_numero)}` : ""}${p.cliente ? ` | cliente ${String(p.cliente).slice(0, 60)}` : ""} | total ${String(p.total ?? "")} ${String(p.moneda || "")}`);
      for (const it of (Array.isArray(p.items) ? p.items : []).slice(0, 100)) {
        const id = String(it.id || "");
        if (!id) continue;
        itemIds.add(id);
        lineas.push(`  - item ${id} | ${String(it.codigo || "").slice(0, 40)} | ${String(it.descripcion || "").slice(0, 200)} | cant ${String(it.cantidad ?? "")}`);
      }
    }
    if (!itemIds.size) return Response.json({ explicacion: "No hay pedidos sin mandar para mover.", movimientos: [] });
    const provIds = new Set(proveedores.map((p: any) => p.id));
    const texto = `INSTRUCCIÓN: ${instruccion}\n\nPEDIDOS SIN MANDAR:\n${lineas.join("\n")}\n\nPROVEEDORES (id | nombre):\n${proveedores.map((p: any) => `${p.id} | ${p.nombre}`).join("\n")}`;
    const client = new Anthropic({ apiKey, timeout: 55_000 });
    for (const model of MODELOS) {
      try {
        const res = await client.messages.create({ model, max_tokens: 4000, system: SISTEMA, messages: [{ role: "user", content: texto }] });
        await registrarUsoIA("compras_instruccion", model, res.usage);
        const out = parseJson(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
        const movimientos = (Array.isArray(out.movimientos) ? out.movimientos : []).map((m: any) => {
          const destino = m.proveedor_id == null || m.proveedor_id === "null" || m.proveedor_id === "" ? null : String(m.proveedor_id);
          return {
            item_ids: (Array.isArray(m.item_ids) ? m.item_ids : []).map(String).filter((id: string) => itemIds.has(id)),
            proveedor_id: destino,
            motivo: String(m.motivo || "").slice(0, 120),
          };
        }).filter((m: any) => m.item_ids.length && (m.proveedor_id === null || provIds.has(m.proveedor_id)));
        return Response.json({ explicacion: String(out.explicacion || "").slice(0, 400), movimientos });
      } catch { /* prueba el modelo siguiente */ }
    }
    return Response.json({ error: "La IA no respondió. Probá de nuevo en un rato." }, { status: 502 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
