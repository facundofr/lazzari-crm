import { registrarUsoIA } from "@/lib/ia-uso";
import { createSupabaseServer } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Compras nueva: para renglones sin proveedor que no se encontraron en la lista de costos ni en compras anteriores,
 * la IA (Haiku, barato) elige entre los proveedores del CRM según rubro y marcas. No guarda nada: es una sugerencia.
 */
const MODELOS = ["claude-haiku-4-5-20251001", process.env.CONCILIACION_MODEL || "claude-sonnet-4-5"];
export const maxDuration = 60;

const SISTEMA = `Sos el asistente de compras de Lazzari (ropa de trabajo, EPP y seguridad industrial, Argentina).
Te paso renglones que hay que comprar y la lista de nuestros proveedores (con rubro y marcas).
Para cada renglón elegí hasta 2 proveedores que probablemente lo vendan. Reglas:
- Usá la marca si el renglón la nombra (ej. "Funcional", "3M", "Pampero", "Ombu") y el rubro del proveedor.
- Si no hay ninguno razonable, devolvé la lista vacía. No inventes ids: usá solo los de la lista.
- "motivo": muy corto (ej. "vende marca 3M", "rubro calzado").
Respondé SOLO JSON: {"sugerencias":[{"id":"<id del renglón>","proveedores":[{"proveedor_id":"","motivo":""}]}]}`;

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
    const renglones = (Array.isArray(body?.renglones) ? body.renglones : []).slice(0, 60)
      .map((r: any) => ({ id: String(r.id || ""), codigo: String(r.codigo || "").slice(0, 60), descripcion: String(r.descripcion || "").slice(0, 300) }))
      .filter((r: any) => r.id && (r.codigo || r.descripcion));
    const proveedores = (Array.isArray(body?.proveedores) ? body.proveedores : []).slice(0, 400)
      .map((p: any) => ({ id: String(p.id || ""), nombre: String(p.nombre || "").slice(0, 80), rubro: String(p.rubro || "").slice(0, 120), marcas: String(p.marcas || "").slice(0, 200) }))
      .filter((p: any) => p.id && p.nombre);
    if (!renglones.length || !proveedores.length) return Response.json({ sugerencias: [] });
    const ids = new Set(proveedores.map((p: any) => p.id));

    const texto = "PROVEEDORES:\n" + proveedores.map((p: any) => `${p.id} | ${p.nombre}${p.rubro ? ` | rubro: ${p.rubro}` : ""}${p.marcas ? ` | marcas: ${p.marcas}` : ""}`).join("\n")
      + "\n\nRENGLONES:\n" + renglones.map((r: any) => `id=${r.id} | ${r.codigo ? `${r.codigo} | ` : ""}${r.descripcion}`).join("\n");
    const client = new Anthropic({ apiKey, timeout: 50_000 });
    for (const model of MODELOS) {
      try {
        const res = await client.messages.create({ model, max_tokens: 4000, system: SISTEMA, messages: [{ role: "user", content: texto }] });
        await registrarUsoIA("compras_sugerir_proveedor", model, res.usage);
        const out = parseJson(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
        if (!Array.isArray(out.sugerencias)) continue;
        const sugerencias = out.sugerencias.map((s: any) => ({
          id: String(s.id || ""),
          proveedores: (Array.isArray(s.proveedores) ? s.proveedores : [])
            .filter((p: any) => ids.has(String(p.proveedor_id)))
            .slice(0, 2)
            .map((p: any) => ({ proveedor_id: String(p.proveedor_id), motivo: String(p.motivo || "Sugerido por la IA").slice(0, 80) })),
        }));
        return Response.json({ sugerencias });
      } catch { /* prueba el modelo siguiente */ }
    }
    return Response.json({ sugerencias: [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
