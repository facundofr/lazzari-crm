import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

/**
 * Finanzas > Para confirmar: la IA dice qué es cada línea del banco que ninguna regla reconoce
 * (impuesto, gasto del banco, sueldo, servicio, pase entre cuentas, cobro, pago…). Solo SUGIERE:
 * no guarda nada; la pantalla guarda la sugerencia y una persona la confirma. Hasta 30 líneas por llamada (la pantalla manda de a 25, en paralelo).
 */
// Augusto 26/10/2026: Opus 5.5 con esfuerzo alto; si no responde, Sonnet 5.5 (Haiku 4.5 no acepta el esfuerzo).
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5"];
export const maxDuration = 120;

const CLASIFICACIONES = ["cobro", "pago", "impuesto", "gasto_bancario", "intereses", "fci", "entre_cuentas", "tarjeta", "personal", "otro"];
const SUBTIPOS = ["iva", "ley_25413", "sircreb", "percepcion_iva", "percepcion_iibb", "iibb", "afip", "otro_impuesto", "comision", "mantenimiento", "seguro", "intereses", "reintegro", "servicio", "sueldo", "retiro_socio", "extraccion_efectivo"];

const SYSTEM = `Sos el asistente contable de una pyme argentina (ropa de trabajo y EPP) y clasificás líneas del extracto del BBVA.
Para cada línea decí qué es:
- "cobro": un cliente nos pagó (entrada).
- "pago": le pagamos a un proveedor por mercadería o servicios de la empresa (salida).
- "impuesto": impuestos que cobra o retiene el banco o el fisco. Subtipo: "ley_25413" (impuesto al cheque, débitos y créditos), "iva" (IVA sobre comisiones), "sircreb" (IIBB SIRCREB), "percepcion_iva", "percepcion_iibb", "iibb", "afip" (VEP, planes de pago, débitos de AFIP/ARCA), "otro_impuesto".
- "gasto_bancario": comisiones, mantenimiento, seguros del banco. Subtipo: "comision", "mantenimiento", "seguro".
- "intereses": intereses ganados o reintegros (entrada). Subtipo "intereses" o "reintegro".
- "fci": suscripción o rescate de fondos comunes.
- "entre_cuentas": pase entre cuentas propias de la empresa.
- "tarjeta": pago del resumen de tarjeta de crédito de la empresa.
- "personal": sueldos y retiros del dueño. Subtipo "sueldo" o "retiro_socio".
- "otro": servicios (luz, gas, internet, teléfono: subtipo "servicio"), débitos automáticos que no sean impuestos, extracción de efectivo ("extraccion_efectivo"), o lo que no encaje.
Pistas: "DEBITO DIRECTO" suele ser servicio, seguro o AFIP; "PAGO DE SERVICIOS TARJETA" es un pago de servicio hecho con la tarjeta (la tarjeta la paga la empresa); "TRANSFERENCIA <CUIT>" con CUIT 20/23/27 suele ser una persona (sueldo, honorarios o proveedor chico) y con 30/33/34 una empresa; "PAGO A PROVEEDORES OP." y "COBRO DE PROVEEDORES" en una ENTRADA es un cliente que nos paga por el sistema de pago a proveedores de su banco (cobro). Te paso los gastos fijos y proveedores conocidos: si el CUIT o el importe coincide, usalo.
No inventes: si no hay pistas suficientes, poné la clasificación más probable con confianza "baja" y explicá en pocas palabras qué falta.
Respondé SOLO JSON: {"lineas":[{"id":"","clasificacion":"","subtipo":null,"nota":"texto corto para el registro o null","confianza":"alta|media|baja","explicacion":"por qué, en 12 palabras como máximo, español rioplatense"}]}
Sin texto antes ni después del JSON.`;

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
    const lineas = (Array.isArray(b?.lineas) ? b.lineas : []).slice(0, 30) as { id: string; fecha: string; concepto: string; importe: number; cuenta?: string }[];
    if (!lineas.length) return Response.json({ lineas: [] });
    const ctx = b?.contexto || {};
    const datos = [
      `Empresa: ${String(ctx.empresa || "Lazzari")}`,
      `Cuentas propias: ${(ctx.cuentas || []).slice(0, 30).map((c: any) => `${c.nombre} (${c.tipo}${c.numero ? `, ${c.numero}` : ""})`).join("; ") || "—"}`,
      `Gastos fijos: ${(ctx.gastosFijos || []).slice(0, 40).map((g: any) => `${g.descripcion} ${g.moneda} ${g.monto}${g.cuit ? ` CUIT ${g.cuit}` : ""}`).join("; ") || "—"}`,
      `Proveedores con CUIT que aparecen en estas líneas: ${(ctx.proveedores || []).slice(0, 40).map((p: any) => `${p.cuit} = ${p.nombre}`).join("; ") || "ninguno"}`,
      `Clientes con CUIT que aparecen en estas líneas: ${(ctx.clientes || []).slice(0, 40).map((p: any) => `${p.cuit} = ${p.nombre}`).join("; ") || "ninguno"}`,
      `Reglas que ya usa la empresa (concepto → clasificación): ${(ctx.reglas || []).slice(0, 40).map((r: any) => `"${r.texto}" → ${r.clasificacion}${r.subtipo ? `/${r.subtipo}` : ""}`).join("; ") || "—"}`,
      "",
      "Líneas (importe con signo: + entra, − sale):",
      ...lineas.map((l) => `${l.id} | ${l.fecha} | ${String(l.concepto).slice(0, 160)} | ${Number(l.importe).toFixed(2)}${l.cuenta ? ` | ${l.cuenta}` : ""}`),
    ].join("\n");

    const client = new Anthropic({ apiKey });
    let ultimo: unknown = null;
    for (const model of MODELOS) {
      try {
        const res = await client.messages.stream({ model, max_tokens: 32000, output_config: { effort: "high" }, system: SYSTEM, messages: [{ role: "user", content: datos }] }).finalMessage();
        await registrarUsoIA("finanzas_clasificar_lineas", model, res.usage);
        const t = res.content.find((x) => x.type === "text");
        const out = parseJson(t && t.type === "text" ? t.text : "{}");
        const ids = new Set(lineas.map((l) => l.id));
        const lista = (Array.isArray(out?.lineas) ? out.lineas : [])
          .filter((x: any) => ids.has(String(x?.id)) && CLASIFICACIONES.includes(String(x?.clasificacion)))
          .map((x: any) => ({
            id: String(x.id),
            clasificacion: String(x.clasificacion),
            subtipo: SUBTIPOS.includes(String(x.subtipo)) ? String(x.subtipo) : null,
            nota: x.nota ? String(x.nota).slice(0, 200) : null,
            confianza: ["alta", "media", "baja"].includes(String(x.confianza)) ? String(x.confianza) : "baja",
            explicacion: x.explicacion ? String(x.explicacion).slice(0, 300) : null,
          }));
        return Response.json({ lineas: lista, modelo: model });
      } catch (e) { ultimo = e; }
    }
    throw ultimo instanceof Error ? ultimo : new Error("La IA no respondió");
  } catch (error: unknown) {
    console.error("Error en clasificar-lineas:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
