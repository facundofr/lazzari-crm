import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { heuristicEquivalences, productGroups, type InvoiceLineInput, type OcLineInput } from "@/lib/purchase-matching";
import { SISTEMA_CONCILIACION, leerRespuestaConciliacion, promptConciliacion } from "@/lib/purchase-matching-ai";

// Modelo para decidir equivalencias de artículos. Se puede cambiar con CONCILIACION_MODEL.
// Si el principal no responde, se usa el de respaldo; si ninguno responde, la similitud de palabras.
const MODELOS = [process.env.CONCILIACION_MODEL || "claude-sonnet-4-5", "claude-haiku-4-5-20251001"];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const factura = (Array.isArray(body?.factura) ? body.factura : []) as InvoiceLineInput[];
    const ocs = (Array.isArray(body?.ocs) ? body.ocs : []) as OcLineInput[];
    const proveedor = String(body?.proveedor || "");
    if (!factura.length || !ocs.length) return Response.json({ error: "Faltan líneas de factura o de OC" }, { status: 400 });
    if (factura.length > 400 || ocs.length > 1500) return Response.json({ error: "Demasiadas líneas para conciliar de una vez" }, { status: 400 });

    const grupos = productGroups(factura, ocs);
    const tallesEspeciales = (Array.isArray(body?.tallesEspeciales) ? body.tallesEspeciales : []).map((t: unknown) => String(t));
    const respaldo = heuristicEquivalences(factura, ocs, tallesEspeciales);
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return Response.json({ success: true, ia: false, aviso: "IA no configurada: se usó similitud de palabras.", equivalencias: respaldo, confianza: {}, motivo: {}, grupos });
    }

    const client = new Anthropic({ apiKey, timeout: 90_000 });
    let ultimoError: unknown = null;
    for (const model of MODELOS) {
      try {
        const res = await client.messages.create({
          model, max_tokens: 4000, system: SISTEMA_CONCILIACION,
          messages: [{ role: "user", content: promptConciliacion(proveedor, grupos.factura, grupos.oc) }],
        });
        await registrarUsoIA("conciliar_compra", model, res.usage);
        const texto = res.content.map(b => (b.type === "text" ? b.text : "")).join("");
        const ia = leerRespuestaConciliacion(texto, grupos.factura, grupos.oc);
        // Lo que la IA no resolvió se completa con la similitud de palabras, marcado como confianza baja.
        for (const [prod, os] of Object.entries(respaldo)) {
          if (!ia.equivalencias[prod]) { ia.equivalencias[prod] = os; ia.confianza[prod] = "baja"; ia.motivo[prod] = "Sugerido por similitud de nombre."; }
        }
        return Response.json({ success: true, ia: true, modelo: model, ...ia, grupos });
      } catch (e) { ultimoError = e; }
    }
    console.error("Conciliación IA falló:", ultimoError);
    return Response.json({ success: true, ia: false, aviso: "La IA no respondió: se usó similitud de palabras. Revisá las sugerencias.", equivalencias: respaldo, confianza: {}, motivo: {}, grupos });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return Response.json({ error: message }, { status: 500 });
  }
}
