import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";
import { registrarUsoIA } from "@/lib/ia-uso";
import { correrAgenteMail } from "@/lib/agente-mail-server";
import { SUBTIPO_LABEL, CLASIFICACION_LABEL, type ClasificacionLinea } from "@/lib/extracto-bbva";

/**
 * Asistente de Finanzas (16/10/2026): chat con IA experta en finanzas que contesta con los datos reales del CRM.
 * Lee con la sesión de la persona (RLS). Lo único que "hace" es mandar al agente de correo a leer los mails
 * (solo lee Gmail y guarda sugerencias). Para el resto propone botones (abrir Para confirmar, Extractos, Cheques…):
 * nunca registra cobros, nunca manda mails, nunca toca ARCA, nunca borra.
 */
const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5"];
export const maxDuration = 180;

const PESTANAS = ["para_confirmar", "correo", "cuentas", "extractos", "movimientos", "echeqs", "facturacion", "vencimientos", "ordenes_pago", "facturas_compra", "gastos_fijos", "retenciones", "revisar", "cc_clientes"];

const SYSTEM = `Sos el asistente de finanzas de una pyme argentina (Lazzari: ropa de trabajo, EPP y seguridad industrial). Hablás con el dueño (Augusto) o con la administrativa (Mariana).
Sos un experto: tesorero, contador y analista de cobranzas. Español rioplatense, corto y claro, sin tecnicismos.
Reglas:
- Usá SIEMPRE las herramientas para traer datos reales antes de dar números. Nunca inventes cifras. Si un dato no está, decilo.
- Importes en pesos con formato argentino ($ 1.234.567,89). Fechas dd/mm.
- Respuestas breves: primero la respuesta en 1 o 2 líneas, después el detalle en viñetas o una tabla chica si ayuda.
- Si ves algo para mejorar o un riesgo (falta plata para un cheque, cliente atrasado, impuesto raro, extracto viejo), avisalo en una línea con ⚠️. Todo es sugerencia: nunca digas que algo "está prohibido" ni trabes al usuario.
- Podés mandar al agente de correo a leer los mails nuevos (herramienta leer_correos_ahora) cuando te lo pidan o cuando haga falta para contestar sobre pagos o retenciones recientes.
- Para que la persona actúe, ofrecé botones con sugerir_boton (ej. "Para confirmar" para confirmar cruces del banco, "Correo" para ver avisos de pago, facturas de proveedores y reclamos de cobranza listos para copiar, "Extractos" para resolver líneas a mano). Vos no confirmás cobros ni pagos: los confirma la persona con un clic.
- Para cargar el extracto del banco: Finanzas > Bancos > Movimientos > "Subir archivos del banco" (el Excel "Movimientos" una vez por mes y los reportes de eCheq todos los días). Este chat no carga archivos. Los cobros y pagos los carga la persona; el sistema no cruza transferencias.
- No mandás mails ni WhatsApp, no tocás facturación de ARCA, no borrás nada.`;

const tools: Anthropic.Tool[] = [
  { name: "estado_caja", description: "Saldos de las cuentas (según el último extracto del banco y su fecha), cheques propios a pagar en los próximos días, cheques de terceros en cartera, facturas de compra por vencer. Para '¿cómo estoy?', '¿qué pago esta semana?', '¿me alcanza?'.", input_schema: { type: "object", properties: { dias: { type: "number", description: "Horizonte en días (por defecto 7)" } } } },
  { name: "cobranzas", description: "Facturas de venta con saldo (quién debe, cuánto, vencidas y días de atraso). Opcional: filtrar por cliente.", input_schema: { type: "object", properties: { cliente: { type: "string" }, solo_vencidas: { type: "boolean" } } } },
  { name: "lineas_banco", description: "Líneas de los extractos del banco cargados, con su clasificación (impuesto, gasto bancario, cobro, pago, cheque, FCI, entre cuentas, sueldo…) y totales por tipo y subtipo (impuesto al cheque, SIRCREB, IVA, comisiones…). Sirve para '¿cuánto me cobró el banco de impuestos?' o para buscar un movimiento del banco.", input_schema: { type: "object", properties: { desde: { type: "string", description: "YYYY-MM-DD" }, hasta: { type: "string", description: "YYYY-MM-DD" }, texto: { type: "string", description: "Buscar en el concepto o importe" }, solo_pendientes: { type: "boolean", description: "Solo las que falta cerrar" } } } },
  { name: "correos_agente", description: "Lo que leyó el agente de correo (avisos de pago, retenciones, reclamos, facturas de proveedores) con su resumen y acción sugerida.", input_schema: { type: "object", properties: { dias: { type: "number", description: "Últimos N días (por defecto 10)" }, categoria: { type: "string", enum: ["pago_retencion", "reclamo_consulta", "factura_proveedor", "oc_cliente", "vencimiento_aviso", "otro"] } } } },
  { name: "leer_correos_ahora", description: "Manda al agente a leer YA los mails nuevos de administracion@ (solo lee y guarda sugerencias; no responde). Tarda hasta un minuto.", input_schema: { type: "object", properties: {} } },
  { name: "gastos_fijos", description: "Gastos fijos del mes (alquiler, sueldos, consultores) y si ya están pagados.", input_schema: { type: "object", properties: {} } },
  { name: "movimientos", description: "Buscar cobros, pagos y gastos cargados en el CRM.", input_schema: { type: "object", properties: { texto: { type: "string" }, desde: { type: "string" }, hasta: { type: "string" }, tipo: { type: "string", description: "transferencia, pago, efectivo, cheque_recibido, retencion_..." } } } },
  { name: "registro", description: "Bitácora de Finanzas: qué propuso el sistema/IA y qué confirmó, corrigió o descartó cada persona.", input_schema: { type: "object", properties: { dias: { type: "number" } } } },
  { name: "sugerir_boton", description: "Muestra un botón para que la persona vaya a una pantalla de Finanzas.", input_schema: { type: "object", properties: { pestana: { type: "string", enum: PESTANAS }, texto: { type: "string", description: "Texto del botón, corto" } }, required: ["pestana", "texto"] } },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const sumarDias = (f: string, d: number) => { const x = new Date(`${f}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

async function traer(q: any, max = 5000): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < max; i += 1000) {
    const { data, error } = await q().range(i, i + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function saldosFacturas(db: any, soc: string, cliente?: string) {
  const fs = await traer(() => db.from("facturas").select("id, tipo, punto_venta, numero, fecha, fecha_vencimiento, total, total_acreditado, moneda, estado, clientes(razon_social)")
    .eq("sociedad_id", soc).in("estado", ["emitida", "parcial", "vencida"]).order("id"));
  const ids = fs.map((f) => f.id);
  const ap = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("cobro_aplicaciones").select("factura_id, monto").in("factura_id", ids.slice(i, i + 200));
    for (const a of data || []) ap.set(a.factura_id, (ap.get(a.factura_id) || 0) + Number(a.monto || 0));
  }
  const q = String(cliente || "").toLowerCase();
  return fs.map((f) => ({
    numero: `${f.tipo || ""} ${String(f.punto_venta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}`,
    cliente: f.clientes?.razon_social || "—", fecha: f.fecha, vence: f.fecha_vencimiento, moneda: f.moneda || "ARS",
    saldo: r2(Number(f.total) - (ap.get(f.id) || 0) - Number(f.total_acreditado || 0)),
  })).filter((f) => f.saldo >= 1 && (!q || f.cliente.toLowerCase().includes(q)));
}

async function ejecutar(nombre: string, input: any, ctx: { db: any; soc: string; botones: { pestana: string; texto: string }[]; puedeAgente: boolean }) {
  const { db, soc } = ctx;
  const hoy = hoyAR();
  switch (nombre) {
    case "estado_caja": {
      const dias = Math.min(90, Math.max(1, Number(input?.dias) || 7));
      const hasta = sumarDias(hoy, dias);
      const [{ data: cuentas }, chs, fcs] = await Promise.all([
        db.from("cuentas_financieras").select("nombre, tipo, moneda, saldo_banco, saldo_banco_fecha, acuerdo, activa").eq("sociedad_id", soc).eq("activa", true).order("orden"),
        traer(() => db.from("echeqs").select("numero, monto, direccion, estado, fecha_pago, destino_nombre, origen_nombre, cubre_tercero").eq("sociedad_id", soc).in("estado", ["pendiente", "entregado", "en_cartera", "depositado"]).order("id")),
        traer(() => db.from("facturas_compra").select("numero_factura, total, total_acreditado, moneda, fecha_vencimiento, estado, proveedores(razon_social)").eq("sociedad_id", soc).neq("estado", "pagada").order("id")),
      ]);
      const propios = chs.filter((c) => c.direccion === "emitido" && c.fecha_pago && c.fecha_pago <= hasta);
      const atrasados = propios.filter((c) => c.fecha_pago < hoy);
      const cartera = chs.filter((c) => c.direccion !== "emitido");
      const fcVencen = fcs.filter((f) => f.fecha_vencimiento && f.fecha_vencimiento <= hasta);
      return {
        hoy,
        cuentas: (cuentas || []).map((c: any) => ({ cuenta: c.nombre, tipo: c.tipo, moneda: c.moneda, saldo_segun_banco: c.saldo_banco, al: c.saldo_banco_fecha, acuerdo: c.acuerdo, extracto_atrasado_dias: c.saldo_banco_fecha ? diasEntre(c.saldo_banco_fecha, hoy) : null })),
        cheques_propios_a_pagar: { hasta, cantidad: propios.length, total: r2(propios.reduce((s, c) => s + Number(c.monto), 0)), en_fecha_sin_debitar: atrasados.length, detalle: propios.sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago)).slice(0, 40).map((c) => ({ numero: c.numero, paga: c.fecha_pago, monto: Number(c.monto), a: c.destino_nombre, lo_cubre: c.cubre_tercero })) },
        cheques_de_terceros_en_cartera: { cantidad: cartera.length, total: r2(cartera.reduce((s, c) => s + Number(c.monto), 0)), detalle: cartera.slice(0, 20).map((c) => ({ numero: c.numero, cobra: c.fecha_pago, monto: Number(c.monto), de: c.origen_nombre, estado: c.estado })) },
        facturas_compra_por_vencer: fcVencen.slice(0, 30).map((f) => ({ proveedor: f.proveedores?.razon_social, numero: f.numero_factura, vence: f.fecha_vencimiento, aprox_saldo: r2(Number(f.total) - Number(f.total_acreditado || 0)), moneda: f.moneda, estado: f.estado })),
      };
    }
    case "cobranzas": {
      const fs = await saldosFacturas(db, soc, input?.cliente);
      const lista = fs.map((f) => ({ ...f, dias_atraso: f.vence && f.vence < hoy ? diasEntre(f.vence, hoy) : 0 })).filter((f) => !input?.solo_vencidas || f.dias_atraso > 0);
      const porCliente = new Map<string, { cliente: string; ars: number; usd: number; vencido_ars: number; facturas: number; max_atraso: number }>();
      for (const f of lista) {
        const c = porCliente.get(f.cliente) || { cliente: f.cliente, ars: 0, usd: 0, vencido_ars: 0, facturas: 0, max_atraso: 0 };
        if (f.moneda === "USD") c.usd = r2(c.usd + f.saldo); else c.ars = r2(c.ars + f.saldo);
        if (f.dias_atraso > 0 && f.moneda !== "USD") c.vencido_ars = r2(c.vencido_ars + f.saldo);
        c.facturas++; c.max_atraso = Math.max(c.max_atraso, f.dias_atraso);
        porCliente.set(f.cliente, c);
      }
      const clientes = [...porCliente.values()].sort((a, b) => b.ars - a.ars);
      return {
        total_ars: r2(clientes.reduce((s, c) => s + c.ars, 0)), total_usd: r2(clientes.reduce((s, c) => s + c.usd, 0)),
        vencido_ars: r2(clientes.reduce((s, c) => s + c.vencido_ars, 0)),
        clientes: clientes.slice(0, 40),
        facturas: input?.cliente ? lista.slice(0, 60) : undefined,
      };
    }
    case "lineas_banco": {
      const desde = String(input?.desde || sumarDias(hoy, -30)).slice(0, 10);
      const hasta = String(input?.hasta || hoy).slice(0, 10);
      const { data: cs } = await db.from("cuentas_financieras").select("id, nombre").eq("sociedad_id", soc);
      const nombre = new Map((cs || []).map((c: any) => [c.id, c.nombre]));
      let ls = await traer(() => {
        let q = db.from("extracto_movimientos").select("fecha, descripcion, monto, tipo, estado, clasificacion, subtipo, nota, cuenta_id")
          .in("cuenta_id", [...nombre.keys()]).gte("fecha", desde).lte("fecha", hasta).order("fecha").order("id");
        if (input?.solo_pendientes) q = q.eq("estado", "pendiente");
        return q;
      });
      const t = String(input?.texto || "").trim().toLowerCase();
      if (t) ls = ls.filter((l) => String(l.descripcion).toLowerCase().includes(t) || String(l.monto).includes(t.replace(/\./g, "").replace(",", ".")));
      const tot: Record<string, number> = {};
      for (const l of ls) {
        const imp = (l.tipo === "credito" ? 1 : -1) * Number(l.monto);
        const k = l.estado === "pendiente" && !l.clasificacion ? "sin cerrar" : `${CLASIFICACION_LABEL[l.clasificacion as ClasificacionLinea] || l.clasificacion || "—"}${l.subtipo ? ` · ${SUBTIPO_LABEL[l.subtipo] || l.subtipo}` : ""}`;
        tot[k] = r2((tot[k] || 0) + imp);
      }
      return {
        desde, hasta, lineas: ls.length, totales_por_tipo: tot,
        detalle: ls.slice(-80).map((l) => ({ fecha: l.fecha, cuenta: nombre.get(l.cuenta_id), concepto: l.descripcion, importe: (l.tipo === "credito" ? 1 : -1) * Number(l.monto), estado: l.estado, tipo: l.clasificacion, subtipo: l.subtipo, nota: l.nota })),
        nota: ls.length > 80 ? "Detalle: últimas 80 líneas; los totales son de todas." : undefined,
      };
    }
    case "correos_agente": {
      const dias = Math.min(60, Math.max(1, Number(input?.dias) || 10));
      let q = db.from("agente_mail_procesados").select("fecha_mail, remitente, asunto, categoria, prioridad, resumen, accion_sugerida, datos").eq("sociedad_id", soc)
        .gte("fecha_mail", sumarDias(hoy, -dias)).order("fecha_mail", { ascending: false }).limit(60);
      if (input?.categoria) q = q.eq("categoria", input.categoria);
      const { data, error } = await q;
      if (error) throw error;
      const { data: corr } = await db.from("agente_mail_corridas").select("inicio, mails_nuevos, resumen, error").order("inicio", { ascending: false }).limit(1);
      return {
        ultima_lectura: corr?.[0] || null,
        mails: (data || []).map((m: any) => ({ fecha: m.fecha_mail, de: m.remitente, asunto: m.asunto, categoria: m.categoria, resumen: m.resumen, accion: m.accion_sugerida, pago: m.datos?.pago ? { cliente: m.datos.pago.cliente_nombre, neto: m.datos.pago.monto_neto, total: m.datos.pago.monto_total, retenciones: m.datos.pago.retenciones, facturas: m.datos.pago.facturas?.map((f: any) => f.numero) } : undefined })),
      };
    }
    case "leer_correos_ahora": {
      if (!ctx.puedeAgente) return { error: "Tu usuario no tiene permiso para mandar al agente de correo." };
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "Falta la clave del servidor para el agente." };
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY) as any;
      const r = await correrAgenteMail(admin, "manual");
      return r;
    }
    case "gastos_fijos": {
      const mes = hoy.slice(0, 7);
      const [{ data: gf }, { data: gm }] = await Promise.all([
        db.from("gastos_fijos").select("id, descripcion, categoria, monto, moneda, dia_vencimiento, activo, proveedores(razon_social)").eq("sociedad_id", soc).eq("activo", true),
        db.from("gastos_manuales").select("gasto_fijo_id, monto, moneda, fecha").eq("sociedad_id", soc).gte("fecha", `${mes}-01`).not("gasto_fijo_id", "is", null),
      ]);
      const pagados = new Set((gm || []).map((g: any) => g.gasto_fijo_id));
      return { mes, gastos: (gf || []).map((g: any) => ({ gasto: g.descripcion, categoria: g.categoria, monto: Number(g.monto), moneda: g.moneda, vence_dia: g.dia_vencimiento, proveedor: g.proveedores?.razon_social, pagado_este_mes: pagados.has(g.id) })) };
    }
    case "movimientos": {
      const desde = String(input?.desde || sumarDias(hoy, -45)).slice(0, 10);
      const hasta = String(input?.hasta || hoy).slice(0, 10);
      let q = db.from("movimientos").select("fecha, tipo, monto, moneda, descripcion, conciliado, clientes(razon_social), proveedores(razon_social)").eq("sociedad_id", soc).eq("anulado", false).gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).limit(300);
      if (input?.tipo) q = q.eq("tipo", input.tipo);
      const { data, error } = await q;
      if (error) throw error;
      const t = String(input?.texto || "").trim().toLowerCase();
      const ms = (data || []).filter((m: any) => !t || `${m.descripcion} ${m.clientes?.razon_social || ""} ${m.proveedores?.razon_social || ""} ${m.monto}`.toLowerCase().includes(t));
      return { desde, hasta, cantidad: ms.length, movimientos: ms.slice(0, 60).map((m: any) => ({ fecha: m.fecha, tipo: m.tipo, monto: Number(m.monto), moneda: m.moneda, descripcion: m.descripcion, cliente: m.clientes?.razon_social, proveedor: m.proveedores?.razon_social, conciliado_con_banco: m.conciliado })) };
    }
    case "registro": {
      const dias = Math.min(90, Math.max(1, Number(input?.dias) || 7));
      const { data, error } = await db.from("finanzas_registro").select("created_at, accion, tipo, origen, resumen, usuario_id").eq("sociedad_id", soc).gte("created_at", sumarDias(hoy, -dias)).order("created_at", { ascending: false }).limit(80);
      if (error) throw error;
      return { registro: data };
    }
    case "sugerir_boton": {
      if (PESTANAS.includes(String(input?.pestana))) ctx.botones.push({ pestana: String(input.pestana), texto: String(input.texto || "Abrir").slice(0, 40) });
      return { ok: true };
    }
  }
  return { error: `Herramienta desconocida: ${nombre}` };
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return Response.json({ error: "API key no configurada" }, { status: 500 });
    const db = (await createSupabaseServer()) as any;
    const { data: { user } } = await db.auth.getUser();
    if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const { data: perfil } = await db.from("profiles").select("role, active, full_name").eq("id", user.id).single();
    if (!perfil?.active || !["super_admin", "admin", "administrativo"].includes(String(perfil.role))) {
      return Response.json({ error: "El asistente de Finanzas es para administración." }, { status: 403 });
    }
    const b = await request.json();
    const soc = String(b?.sociedad_id || "");
    const { data: socRow } = await db.from("sociedades").select("id, nombre").eq("id", soc).maybeSingle();
    if (!socRow) return Response.json({ error: "Sociedad no disponible" }, { status: 403 });
    const historia = (Array.isArray(b?.mensajes) ? b.mensajes : []).slice(-16)
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && String(m?.content || "").trim())
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 6000) })) as Anthropic.MessageParam[];
    if (!historia.length || historia[historia.length - 1].role !== "user") return Response.json({ error: "Falta la pregunta" }, { status: 400 });

    const client = new Anthropic({ apiKey });
    const ctx = { db, soc, botones: [] as { pestana: string; texto: string }[], puedeAgente: true };
    const system = `${SYSTEM}\nHoy es ${hoyAR()}. Sociedad: ${socRow.nombre}. Te escribe: ${perfil.full_name || "usuario"}.`;
    const mensajes: Anthropic.MessageParam[] = [...historia];
    const acciones: string[] = [];
    const textos: string[] = [];
    let modelo = MODELOS[0];
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      let res: Anthropic.Message | null = null;
      let ultimo: unknown = null;
      for (const m of vuelta === 0 ? MODELOS : [modelo]) {
        try { res = await client.messages.create({ model: m, max_tokens: 3000, system, tools, messages: mensajes }); modelo = m; break; } catch (e) { ultimo = e; }
      }
      if (!res) throw ultimo instanceof Error ? ultimo : new Error("La IA no respondió");
      await registrarUsoIA("finanzas_asistente", modelo, res.usage);
      // El texto puede venir junto con una herramienta (ej. responde y después pide un botón): se junta todo.
      const parte = res.content.filter((c) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      if (parte) textos.push(parte);
      if (res.stop_reason !== "tool_use") {
        return Response.json({ texto: textos.join("\n\n") || "No tengo respuesta para eso.", botones: ctx.botones, acciones, modelo });
      }
      mensajes.push({ role: "assistant", content: res.content });
      const resultados: Anthropic.ToolResultBlockParam[] = [];
      for (const c of res.content) {
        if (c.type !== "tool_use") continue;
        let out: unknown;
        try { out = await ejecutar(c.name, c.input, ctx); } catch (e) { out = { error: e instanceof Error ? e.message : String((e as any)?.message || e) }; }
        if (c.name === "leer_correos_ahora") acciones.push("leyo_correos");
        resultados.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out).slice(0, 60000) });
      }
      mensajes.push({ role: "user", content: resultados });
    }
    return Response.json({ texto: textos.join("\n\n") || "Me llevó demasiadas consultas; preguntame algo más puntual.", botones: ctx.botones, acciones, modelo });
  } catch (error: unknown) {
    console.error("Error en asistente de finanzas:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
