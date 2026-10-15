import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { guiaComoTexto, rolPuedeVer, seccionesParaRol } from "@/lib/ayuda-busqueda";
import { FUNCION_CHAT_IA, TOPE_MENSUAL_IA_USD, costoUSD, inicioDeMesAR, tokensEntradaEquivalentes } from "@/lib/ia-tope";

// Botón "Preguntarle a la IA" de la Ayuda. SOLO CONSULTA: no crea ni modifica nada.
// Lee la base con la sesión del usuario (mismos permisos que en el CRM) y conoce la guía de uso de su rol.
// Tiene tope mensual de gasto (lib/ia-tope.ts): al llegar, responde que se usa la Ayuda sin IA.

const MODELO = "claude-haiku-4-5-20251001";

// Tablas con sociedad_id: las consultas se filtran por la sociedad activa (o las del usuario).
const TABLES_WITH_SOCIEDAD = new Set([
  "clientes", "proveedores", "productos", "presupuestos", "facturas", "remitos", "ordenes_compra",
  "listas_precios", "movimientos", "transportes", "gastos_manuales", "gastos_fijos", "objetivos",
  "ordenes_pago", "echeqs", "facturas_compra", "eventos", "muestra_envios",
]);

// Tabla → módulo de permisos (ROLE_PERMISSIONS). Solo se consultan las tablas de los módulos que el rol ve.
const MODULO_TABLA: Record<string, string> = {
  clientes: "clientes", contactos: "clientes", cliente_sucursales: "clientes", profiles: "clientes",
  presupuestos: "presupuestos", presupuesto_items: "presupuestos",
  muestra_envios: "muestras", muestra_envio_items: "muestras",
  facturas: "consulta_facturas",
  remitos: "remitos", remito_items: "remitos", transportes: "remitos",
  proveedores: "proveedores", listas_precios: "proveedores", lista_precios_items: "proveedores",
  ordenes_compra: "ordenes_compra", orden_compra_items: "ordenes_compra",
  productos: "stock",
  eventos: "calendario",
  movimientos: "finanzas", gastos_fijos: "finanzas", objetivos: "finanzas", gastos_manuales: "finanzas",
  ordenes_pago: "finanzas", echeqs: "finanzas", facturas_compra: "finanzas",
};

function canRead(role: string, table: string): boolean {
  const modulo = MODULO_TABLA[table];
  return !!modulo && rolPuedeVer(role, modulo);
}

const FILTROS_SCHEMA = {
  type: "array",
  description: "Filtros a aplicar",
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      operator: { type: "string", enum: ["eq", "neq", "gt", "lt", "gte", "lte", "like", "ilike", "in", "is"] },
      value: { type: "string", description: "Valor del filtro. Para 'in' usar formato (val1,val2). Para 'is' usar null." },
    },
    required: ["column", "operator", "value"],
  },
};

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "query_database",
    description: `Consulta (SELECT) la base del CRM con los permisos del usuario. Solo lectura.
Tablas: clientes, contactos, cliente_sucursales, presupuestos, presupuesto_items, muestra_envios, muestra_envio_items, facturas, remitos, remito_items, transportes, proveedores, listas_precios, lista_precios_items, ordenes_compra, orden_compra_items, productos, eventos, movimientos, gastos_fijos, gastos_manuales, objetivos, ordenes_pago, echeqs, facturas_compra, profiles. Si una tabla no está permitida para el rol, la herramienta lo dice.
Columnas comunes: id, created_at, sociedad_id.
Clientes: razon_social, cuit, condicion_iva, email, telefono, localidad, provincia, vendedor_id, activo.
Proveedores: razon_social, cuit, rubro.
Productos: codigo, nombre, categoria, precio_costo, moneda_costo, stock, stock_minimo, activo.
Presupuestos: numero, cliente_id, vendedor_id, estado (solicitud/pendiente/aprobado/rechazado/postergado/vencido/facturado), total, moneda, fecha. "solicitud" = pedido del cliente todavía no cotizado. "Vencido" = PR pendiente cuya fecha de validez (columna vencimiento) ya pasó; para contar vencidos usá estado = vencido O (estado = pendiente Y vencimiento < hoy), no solo el estado.
Facturas (de venta): numero, tipo, punto_venta, cliente_id, total, moneda, estado, fecha, fecha_vencimiento, cae.
Facturas_compra: numero_factura, tipo_comprobante, proveedor_id, fecha, fecha_vencimiento, total, moneda, estado.
Ordenes_compra: numero, proveedor_id, presupuesto_id, estado, estado_facturacion, total, moneda.
Movimientos: tipo, monto, moneda, fecha, descripcion, anulado.
Echeqs: numero, monto, fecha_pago, estado, direccion (recibido/emitido).
Contactos: entity_type (cliente/proveedor), entity_id, nombre, cargo, email, telefono.
Profiles: full_name, role.
Para traer nombres usá relaciones de Supabase, ej. select "numero, total, clientes(razon_social)".
Filtros con sintaxis PostgREST: eq, neq, gt, lt, gte, lte, like, ilike, in, is. Máximo 50 filas.`,
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Tabla a consultar" },
        select: { type: "string", description: "Columnas (sintaxis Supabase). Default: *" },
        filters: FILTROS_SCHEMA,
        order: { type: "string", description: "Columna para ordenar (prefijo - para descendente, ej: '-created_at')" },
        limit: { type: "number", description: "Límite de filas (máx. 50)" },
      },
      required: ["table"],
    },
  },
  {
    name: "count_records",
    description: "Cuenta registros de una tabla (con los permisos del usuario), opcionalmente con filtros.",
    input_schema: {
      type: "object" as const,
      properties: { table: { type: "string" }, filters: FILTROS_SCHEMA },
      required: ["table"],
    },
  },
];

// Parte fija por rol (va con caché): negocio, reglas y la guía de las pantallas que ese rol ve.
function promptFijo(role: string): string {
  return `Sos la Ayuda del CRM de Lazzari Soluciones Industriales (Argentina): ropa de trabajo, EPP (elementos de protección personal) y seguridad industrial (calzado, indumentaria, guantes, protección respiratoria, visual, auditiva y craneana, trabajo en altura), más personalización (bordado y estampado) con talleres externos. Opera con dos sociedades: Lazzari y Grupo LA (se elige arriba en el CRM).

Tu trabajo: explicar cómo se usa el CRM y responder dudas con datos reales.
Reglas:
- Español rioplatense ("vos"), corto y claro. Si es un "cómo hago…", dá pasos numerados con el nombre exacto de los botones y la pantalla (y la ruta, ej. /presupuestos).
- SOLO CONSULTA: no podés crear, modificar ni borrar nada. Si te piden cargar o cambiar algo, explicá dónde y cómo se hace en el CRM.
- Basate en la guía de abajo y en las consultas a la base. Si algo no está en la guía ni en los datos, decí que no lo sabés y sugerí preguntarle a Augusto. Nunca inventes botones, pantallas ni datos.
- El sistema nunca bloquea: avisa y deja seguir (ej. margen mínimo 15 % es un aviso). Lo que propone el sistema o la IA es una sugerencia.
- Los precios de las listas solo se actualizan desde el catálogo, nunca a mano. La facturación ARCA solo se prueba en el sistema publicado.
- Para datos de plata o de otros sectores, respetá lo que la herramienta permita: si dice que no hay permiso, explicá que su rol no lo ve.
- Formato: texto simple con listas cortas (guiones o números) y **negrita**; NO uses tablas ni títulos (#), el panel no los muestra. Montos como $ 1.234,56 o US$ 1.234,56. No muestres IDs internos.
- Rol del usuario: ${role}. La guía de abajo tiene solo lo que ese rol puede usar.

# Guía de uso del CRM
${guiaComoTexto(seccionesParaRol(role))}`;
}

export async function POST(request: NextRequest) {
  try {
    const { messages, pantalla, sociedadId } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: "Se requiere un array de mensajes" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "API key no configurada" }, { status: 500 });
    }

    // Todo con la sesión del usuario: lee solo lo que su usuario puede ver (RLS).
    const supabase = await createSupabaseServer();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", authUser.id).single();
    const role = profile?.role || "viewer";
    const name = profile?.full_name || "Usuario";

    // Tope mensual de gasto.
    const { data: usos } = await (supabase as any).from("ia_uso").select("tokens_entrada, tokens_salida")
      .eq("funcion", FUNCION_CHAT_IA).gte("created_at", `${inicioDeMesAR()}T03:00:00Z`);
    const gastoMes = ((usos as { tokens_entrada: number; tokens_salida: number }[]) || [])
      .reduce((s, u) => s + costoUSD(Number(u.tokens_entrada) || 0, Number(u.tokens_salida) || 0), 0);
    if (gastoMes >= TOPE_MENSUAL_IA_USD) {
      return Response.json({
        response: `Este mes ya se usó el tope de la IA (US$ ${TOPE_MENSUAL_IA_USD}). Mientras tanto usá la búsqueda de la Ayuda, que es gratis. Si hace falta más, avisale a Augusto.`,
        tope: true, gastoMes, topeMes: TOPE_MENSUAL_IA_USD,
      });
    }

    const { data: userSociedades } = await (supabase as any).from("user_sociedades").select("sociedad_id").eq("user_id", authUser.id);
    const misSociedades: string[] = userSociedades?.map((s: { sociedad_id: string }) => s.sociedad_id) || [];
    // Se consulta la sociedad que está elegida arriba (si el usuario la tiene); si no, todas las suyas.
    const sociedadesConsulta = typeof sociedadId === "string" && misSociedades.includes(sociedadId) ? [sociedadId] : misSociedades;

    const client = new Anthropic({ apiKey });
    const system: Anthropic.Messages.TextBlockParam[] = [
      { type: "text", text: promptFijo(role), cache_control: { type: "ephemeral" } },
      { type: "text", text: `Usuario: ${name}. Hoy: ${new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.${pantalla ? ` Está en la pantalla: ${String(pantalla).slice(0, 120)}.` : ""}` },
    ];

    let currentMessages: Anthropic.Messages.MessageParam[] = messages
      .filter((m: { role: string; content: string }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-12)
      .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }));

    let finalText = "";
    const MAX_ITERATIONS = 6;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODELO,
        max_tokens: 2048,
        system,
        tools: TOOLS,
        messages: currentMessages,
      });

      await registrarUsoIA(FUNCION_CHAT_IA, MODELO, {
        input_tokens: tokensEntradaEquivalentes(response.usage),
        output_tokens: response.usage.output_tokens,
      });

      const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
        finalText = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        break;
      }

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const input = toolUse.input as Record<string, unknown>;
        let result: string;
        try {
          const table = String(input.table || "");
          if (!canRead(role, table)) {
            result = JSON.stringify({ error: `Tu rol (${role}) no tiene acceso a ${table || "esa tabla"}.` });
          } else if (toolUse.name === "query_database") {
            let query = (supabase as any).from(table).select((input.select as string) || "*");
            for (const f of (input.filters as Array<{ column: string; operator: string; value: string }> | undefined) || []) {
              if (f.operator === "in") query = query.in(f.column, f.value.replace(/[()]/g, "").split(",").map((v) => v.trim()));
              else if (f.operator === "is") query = query.is(f.column, null);
              else query = query.filter(f.column, f.operator, f.value);
            }
            if (sociedadesConsulta.length > 0 && TABLES_WITH_SOCIEDAD.has(table)) query = query.in("sociedad_id", sociedadesConsulta);
            const order = input.order as string | undefined;
            if (order) query = query.order(order.replace(/^-/, ""), { ascending: !order.startsWith("-") });
            query = query.limit(Math.min(Number(input.limit) || 25, 50));
            const { data, error } = await query;
            result = JSON.stringify(error ? { error: error.message } : { data, count: data?.length ?? 0 });
          } else if (toolUse.name === "count_records") {
            let query = (supabase as any).from(table).select("id", { count: "exact", head: true });
            for (const f of (input.filters as Array<{ column: string; operator: string; value: string }> | undefined) || []) {
              query = query.filter(f.column, f.operator, f.value);
            }
            if (sociedadesConsulta.length > 0 && TABLES_WITH_SOCIEDAD.has(table)) query = query.in("sociedad_id", sociedadesConsulta);
            const { count, error } = await query;
            result = JSON.stringify(error ? { error: error.message } : { count });
          } else {
            result = JSON.stringify({ error: `Herramienta ${toolUse.name} no disponible (la Ayuda es solo de consulta).` });
          }
        } catch (err: unknown) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : "Error consultando" });
        }
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
      }

      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];
    }

    if (!finalText) finalText = "No llegué a una respuesta. Probá preguntarlo de otra forma o usá la búsqueda de la Ayuda.";
    return Response.json({ response: finalText, gastoMes, topeMes: TOPE_MENSUAL_IA_USD });
  } catch (error: unknown) {
    console.error("Error en API de IA:", error);
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
