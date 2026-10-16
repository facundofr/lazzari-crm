import { registrarUsoIA } from "@/lib/ia-uso";
import { createSupabaseServer } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Conciliación de facturas de compra: "Decile a la IA" (ej. "son todos el mismo botín de la 1252",
 * "el casco va a la OC 1300", "el precio está bien, actualizá el costo", "el flete no es de ninguna OC").
 * La IA traduce la instrucción a decisiones sobre los renglones de la factura; la pantalla las aplica con Deshacer.
 * No guarda nada en la base.
 */
const MODELOS = [process.env.CONCILIACION_MODEL || "claude-opus-5-5", "claude-sonnet-5-5"];
export const maxDuration = 60;

const SISTEMA = `Sos el asistente de compras de Lazzari (ropa de trabajo, EPP y seguridad industrial, Argentina).
Te paso los renglones de una o varias facturas de un proveedor, los renglones de sus órdenes de compra (OC) pendientes, cómo quedó el cruce automático y una instrucción del usuario.
Traducí la instrucción a decisiones sobre renglones de la FACTURA. Tipos de decisión:
- "asignar": el renglón de factura va a un renglón de OC (ocLineId) con una cantidad. Si son varios renglones de factura que van al mismo renglón de OC (ej. abierto por talle), una decisión por cada uno con su cantidad.
- "aceptar": la sugerencia del cruce está bien (es el mismo artículo).
- "aceptar_costo": es el mismo artículo y el precio nuevo de la factura pasa a ser el costo (OC y presupuesto).
- "reclamar": es el mismo artículo pero la diferencia de precio queda anotada para reclamar al proveedor.
- "fuera": no es de ninguna OC (flete, algo que se compró aparte): se paga con la factura, fuera de OC.
Reglas:
- Usá SOLO keys de factura y ocLineId que aparecen en los datos. Nunca inventes.
- En "asignar" la cantidad no puede superar la cantidad del renglón de factura.
- Si la instrucción no se entiende o no aplica, devolvé decisiones vacías y explicá por qué en una oración.
- "explicacion": 1 o 2 oraciones en castellano rioplatense, simple, diciendo qué hiciste ("Até los 3 renglones al botín de la OC-2026-1252").
Respondé SOLO JSON: {"explicacion":"","decisiones":[{"key":"","tipo":"asignar|aceptar|aceptar_costo|reclamar|fuera","ocLineId":"","cantidad":0}]}`;

const TIPOS = new Set(["asignar", "aceptar", "aceptar_costo", "reclamar", "fuera"]);

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
    const factura = (Array.isArray(body?.factura) ? body.factura : []).slice(0, 300);
    const ocs = (Array.isArray(body?.ocs) ? body.ocs : []).slice(0, 500);
    const cruce = (Array.isArray(body?.cruce) ? body.cruce : []).slice(0, 600);
    const cantPorKey = new Map<string, number>(factura.map((l: any) => [String(l.key || ""), Number(l.cantidad) || 0]));
    const ocIds = new Set<string>(ocs.map((o: any) => String(o.id || "")));
    if (!cantPorKey.size) return Response.json({ explicacion: "No hay renglones de factura.", decisiones: [] });
    const texto = [
      `INSTRUCCIÓN: ${instruccion}`,
      `\nRENGLONES DE FACTURA (key | factura | código | descripción | cantidad | precio neto):`,
      ...factura.map((l: any) => `${String(l.key)} | ${String(l.facturaRef || "").slice(0, 30)} | ${String(l.codigo || "").slice(0, 40)} | ${String(l.descripcion || "").slice(0, 200)} | ${Number(l.cantidad) || 0} | ${Number(l.precio) || 0}`),
      `\nRENGLONES DE OC PENDIENTES (ocLineId | OC | descripción | pendiente | precio):`,
      ...ocs.map((o: any) => `${String(o.id)} | ${String(o.ocNumero || "")} | ${String(o.descripcion || "").slice(0, 200)} | ${Number(o.cantidad) || 0} | ${Number(o.precio) || 0}`),
      `\nCRUCE AUTOMÁTICO ACTUAL (key → estado):`,
      ...cruce.map((c: any) => `${String(c.key)} → ${String(c.estado || "").slice(0, 200)}`),
    ].join("\n");
    const client = new Anthropic({ apiKey, timeout: 55_000 });
    for (const model of MODELOS) {
      try {
        const res = await client.messages.create({ model, max_tokens: 4000, system: SISTEMA, messages: [{ role: "user", content: texto }] });
        await registrarUsoIA("compras_conciliacion_instruccion", model, res.usage);
        const out = parseJson(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
        const decisiones = (Array.isArray(out.decisiones) ? out.decisiones : []).map((d: any) => ({
          key: String(d.key || ""), tipo: String(d.tipo || ""), ocLineId: d.ocLineId ? String(d.ocLineId) : undefined,
          cantidad: Math.max(0, Number(d.cantidad) || 0),
        })).filter((d: any) => cantPorKey.has(d.key) && TIPOS.has(d.tipo)
          && (d.tipo !== "asignar" || (d.ocLineId && ocIds.has(d.ocLineId) && d.cantidad > 0)))
          .map((d: any) => d.tipo === "asignar" ? { ...d, cantidad: Math.min(d.cantidad, cantPorKey.get(d.key)!) } : d);
        return Response.json({ explicacion: String(out.explicacion || "").slice(0, 400), decisiones, modelo: model });
      } catch { /* prueba el modelo siguiente */ }
    }
    return Response.json({ error: "La IA no respondió. Probá de nuevo en un rato." }, { status: 502 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
