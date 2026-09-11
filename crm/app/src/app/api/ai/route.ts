import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseServer } from "@/lib/supabase/server";

// Tables that have sociedad_id column — AI queries will be auto-filtered
const TABLES_WITH_SOCIEDAD = new Set([
  "clientes", "proveedores", "productos", "presupuestos", "presupuesto_items",
  "facturas", "remitos", "remito_items", "ordenes_compra", "orden_compra_items",
  "listas_precios", "lista_precios_items", "movimientos", "transportes", "transportistas",
  "gastos_manuales", "ordenes_pago", "echeqs", "facturas_compra", "facturas_compra_items", "eventos",
]);

// Tables the AI can query, grouped by access level
const TABLE_ACCESS: Record<string, string[]> = {
  // Everyone can read these
  read_all: [
    "clientes", "proveedores", "productos", "presupuestos", "presupuesto_items",
    "facturas", "remitos", "remito_items", "ordenes_compra", "orden_compra_items",
    "listas_precios", "lista_precios_items", "contactos", "sucursales",
    "movimientos", "alertas", "profiles", "gastos_fijos", "objetivos",
  ],
  // Only admin+ can write
  write_admin: [
    "clientes", "proveedores", "productos", "presupuestos", "presupuesto_items",
    "facturas", "remitos", "ordenes_compra", "movimientos", "contactos",
    "sucursales", "listas_precios", "lista_precios_items", "gastos_fijos", "objetivos",
  ],
  // Only super_admin can write
  write_super: ["profiles", "alertas"],
};

// Role hierarchy for permission checks
const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  vendedor: 1,
  administrativo: 2,
  admin: 3,
  super_admin: 4,
};

function canWrite(role: string, table: string): boolean {
  const level = ROLE_HIERARCHY[role] ?? 0;
  if (level >= 4 && TABLE_ACCESS.write_super.includes(table)) return true;
  if (level >= 3 && TABLE_ACCESS.write_admin.includes(table)) return true;
  // vendedor can write to some tables
  if (level >= 1 && ["presupuestos", "presupuesto_items", "clientes", "contactos", "remitos", "remito_items"].includes(table)) return true;
  return false;
}

function canRead(role: string, table: string): boolean {
  const level = ROLE_HIERARCHY[role] ?? 0;
  if (level >= 1) return TABLE_ACCESS.read_all.includes(table);
  // viewer can read everything
  return TABLE_ACCESS.read_all.includes(table);
}

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "query_database",
    description: `Ejecuta una consulta SELECT en la base de datos del CRM.
Tablas disponibles: clientes, proveedores, productos, presupuestos, presupuesto_items, facturas, remitos, remito_items, ordenes_compra, orden_compra_items, listas_precios, lista_precios_items, contactos, sucursales, movimientos, alertas, profiles.
Columnas comunes: id, created_at, updated_at.
Clientes: razon_social, cuit, condicion_iva, email, telefono, direccion, localidad, provincia, vendedor_id, activo.
Proveedores: razon_social, cuit, rubro, forma_pago, dias_cuenta_corriente, saldo_cuenta_corriente.
Productos: codigo (UNICO global), nombre, categoria, precio_costo, moneda_costo, unidad, iva, stock, stock_minimo, activo, proveedor_id.
Listas_precios: nombre, proveedor_id, moneda, vigencia_desde, vigencia_hasta, estado (vigente/vencida/borrador).
Lista_precios_items: lista_id, codigo (del proveedor, NO unico — puede repetirse entre proveedores), descripcion, categoria, unidad, precio, descuento, precio_neto, producto_id (opcional link a productos).
IMPORTANTE: Dos proveedores pueden tener el mismo codigo de articulo. Siempre mostra el nombre del proveedor junto al codigo cuando busques productos o items de lista. Para buscar un articulo por codigo, uni lista_precios_items con listas_precios y proveedores para mostrar contexto completo.
Presupuestos: numero, cliente_id, vendedor_id, estado (solicitud/pendiente/aprobado/rechazado/postergado/vencido), total, moneda, fecha, validez_dias, observaciones. "solicitud" es un pedido de cliente que aun no se formalizo como presupuesto.
Facturas: numero, tipo, punto_venta, cliente_id, total, estado (pendiente/pagada/anulada), cae, cae_vencimiento.
Movimientos: tipo (cobro/pago/cheque_emitido/cheque_recibido/transferencia/efectivo), monto, moneda, fecha, descripcion, conciliado.
Profiles: full_name, email, role, active.
Contactos: entity_type (cliente/proveedor), entity_id, nombre, cargo, email, telefono, principal.
Gastos_fijos: descripcion, categoria, monto, moneda, activo, notas. Gastos mensuales recurrentes de la empresa.
Objetivos: nombre, tipo (ventas/facturacion/cobranza/margen), monto_target, moneda, periodo_inicio, periodo_fin, usuario_id (null=global), activo.
Usa filtros con la sintaxis de Supabase PostgREST: eq, neq, gt, lt, gte, lte, like, ilike, in, is.`,
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Nombre de la tabla a consultar" },
        select: { type: "string", description: "Columnas a seleccionar (sintaxis Supabase, ej: 'id, razon_social, clientes(razon_social)'). Default: *" },
        filters: {
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
        },
        order: { type: "string", description: "Columna para ordenar (prefijo - para descendente, ej: '-created_at')" },
        limit: { type: "number", description: "Limite de filas (max 50)" },
      },
      required: ["table"],
    },
  },
  {
    name: "insert_record",
    description: "Inserta un registro nuevo en una tabla del CRM. Requiere permisos de escritura según el rol del usuario.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Tabla donde insertar" },
        data: { type: "object", description: "Objeto con los campos y valores a insertar (snake_case)" },
      },
      required: ["table", "data"],
    },
  },
  {
    name: "update_record",
    description: "Actualiza un registro existente en el CRM. Requiere el ID del registro y permisos de escritura.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Tabla a actualizar" },
        id: { type: "string", description: "ID del registro a actualizar" },
        data: { type: "object", description: "Campos a actualizar (snake_case)" },
      },
      required: ["table", "id", "data"],
    },
  },
  {
    name: "count_records",
    description: "Cuenta registros en una tabla, opcionalmente con filtros.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Tabla a contar" },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              operator: { type: "string", enum: ["eq", "neq", "gt", "lt", "gte", "lte", "like", "ilike"] },
              value: { type: "string" },
            },
            required: ["column", "operator", "value"],
          },
        },
      },
      required: ["table"],
    },
  },
];

function buildSystemPrompt(userName: string, userRole: string, allowedSociedadIds: string[]): string {
  const sociedadRule = allowedSociedadIds.length > 0
    ? `\n- IMPORTANTE: El usuario solo tiene acceso a las sociedades con IDs: ${allowedSociedadIds.join(", ")}. SIEMPRE filtrá por sociedad_id usando esos valores en TODAS las consultas a tablas que tengan columna sociedad_id (clientes, proveedores, productos, presupuestos, facturas, remitos, ordenes_compra, movimientos, transportes, transportistas, listas_precios, lista_precios_items, gastos_manuales, ordenes_pago, echeqs, facturas_compra, eventos). Al insertar o modificar registros, usá uno de estos sociedad_id.`
    : "";
  return `Sos el asistente de IA de Lazzari CRM, una empresa de soluciones industriales (válvulas, caños, bombas, instrumentación) con sede en Argentina. Tu nombre es "Asistente Lazzari".

El usuario actual es **${userName}** con rol **${userRole}**.

Tenés acceso a la base de datos del CRM mediante herramientas (tools). Podés:
- **Consultar datos**: clientes, proveedores, productos, presupuestos, facturas, movimientos, stock, etc.
- **Crear y modificar registros**: según los permisos del rol del usuario.
- **Analizar datos**: calcular totales, encontrar patrones, comparar períodos, etc.

Reglas:
- Respondé siempre en español argentino (usá "vos" en lugar de "tú").
- Sé conciso y directo. Usá Markdown para formatear.
- Cuando el usuario pida datos, usá las herramientas para consultar la DB real. No inventes datos.
- Si el usuario pide modificar algo y no tiene permisos, explicale por qué no puede.
- Antes de modificar datos críticos (eliminar, cambiar precios, cambiar estados), confirmá con el usuario.
- Mostrá los datos en formato legible (tablas, listas) y siempre en moneda con formato.
- Si una consulta falla, explicá el error de forma simple.
- No muestres IDs internos al usuario salvo que los pida.
- Podés hacer varias consultas seguidas para armar una respuesta completa.${sociedadRule}`;
}

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: "Se requiere un array de mensajes" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "API key no configurada" }, { status: 500 });
    }

    const authSupabase = await createSupabaseServer();
    const { data: { user: authUser } } = await authSupabase.auth.getUser();
    if (!authUser) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    const { data: profile, error: profileError } = await authSupabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", authUser.id)
      .single();

    if (profileError) console.error("Error fetching profile for AI:", profileError.message);

    const role = profile?.role || "viewer";
    const name = profile?.full_name || "Usuario";

    // Fetch allowed sociedades for this user
    const { data: userSociedades } = await (authSupabase as any)
      .from("user_sociedades")
      .select("sociedad_id")
      .eq("user_id", authUser.id);
    const allowedSociedadIds: string[] = userSociedades?.map((s: any) => s.sociedad_id) || [];

    // Create Supabase client with service-level access for AI queries
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } }
    );

    const client = new Anthropic({ apiKey });

    // Build messages for Claude (filter to role/content only)
    const claudeMessages: Anthropic.Messages.MessageParam[] = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })
    );

    // Agentic loop — keep calling until we get a final text response
    let currentMessages = claudeMessages;
    let finalText = "";
    let iterations = 0;
    const MAX_ITERATIONS = 8;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: buildSystemPrompt(name, role, allowedSociedadIds),
        tools: TOOLS,
        messages: currentMessages,
      });

      // Check if there are tool uses
      const toolUses = response.content.filter((b) => b.type === "tool_use");

      if (toolUses.length === 0) {
        // No tool use — extract final text
        const textBlock = response.content.find((b) => b.type === "text");
        finalText = textBlock && textBlock.type === "text" ? textBlock.text : "";
        break;
      }

      // Process tool calls
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        if (toolUse.type !== "tool_use") continue;
        const input = toolUse.input as Record<string, unknown>;
        let result: string;

        try {
          if (toolUse.name === "query_database") {
            const table = input.table as string;
            if (!canRead(role, table)) {
              result = JSON.stringify({ error: `No tenés permisos para leer la tabla ${table}` });
            } else {
              const select = (input.select as string) || "*";
              let query = supabase.from(table).select(select);

              const filters = input.filters as Array<{ column: string; operator: string; value: string }> | undefined;
              if (filters) {
                for (const f of filters) {
                  if (f.operator === "in") {
                    const vals = f.value.replace(/[()]/g, "").split(",").map((v) => v.trim());
                    query = query.in(f.column, vals);
                  } else if (f.operator === "is") {
                    query = query.is(f.column, null);
                  } else {
                    query = query.filter(f.column, f.operator, f.value);
                  }
                }
              }

              // Auto-filter by allowed sociedades
              if (allowedSociedadIds.length > 0 && TABLES_WITH_SOCIEDAD.has(table)) {
                query = query.in("sociedad_id", allowedSociedadIds);
              }

              const order = input.order as string | undefined;
              if (order) {
                const desc = order.startsWith("-");
                const col = desc ? order.slice(1) : order;
                query = query.order(col, { ascending: !desc });
              }

              const limit = Math.min((input.limit as number) || 25, 50);
              query = query.limit(limit);

              const { data, error } = await query;
              if (error) {
                result = JSON.stringify({ error: error.message });
              } else {
                result = JSON.stringify({ data, count: data?.length ?? 0 });
              }
            }
          } else if (toolUse.name === "insert_record") {
            const table = input.table as string;
            if (!canWrite(role, table)) {
              result = JSON.stringify({ error: `No tenés permisos para escribir en ${table} con rol ${role}` });
            } else {
              const data = input.data as Record<string, unknown>;
              // Never infer a sociedad for writes: an absent context must fail closed.
              if (TABLES_WITH_SOCIEDAD.has(table) && allowedSociedadIds.length === 0) {
                result = JSON.stringify({ error: "No hay una sociedad autorizada para esta operación" });
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
                continue;
              }
              if (TABLES_WITH_SOCIEDAD.has(table) && !data.sociedad_id) {
                result = JSON.stringify({ error: "sociedad_id es obligatorio para insertar este registro" });
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
                continue;
              }
              if (TABLES_WITH_SOCIEDAD.has(table) && data.sociedad_id && !allowedSociedadIds.includes(data.sociedad_id as string)) {
                result = JSON.stringify({ error: "No tenés acceso a esa sociedad" });
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
                continue;
              }
              const { data: inserted, error } = await supabase.from(table).insert(data).select().single();
              if (error) {
                result = JSON.stringify({ error: error.message });
              } else {
                result = JSON.stringify({ success: true, data: inserted });
              }
            }
          } else if (toolUse.name === "update_record") {
            const table = input.table as string;
            if (!canWrite(role, table)) {
              result = JSON.stringify({ error: `No tenés permisos para modificar ${table} con rol ${role}` });
            } else {
              const id = input.id as string;
              const data = input.data as Record<string, unknown>;
              if (TABLES_WITH_SOCIEDAD.has(table) && allowedSociedadIds.length === 0) {
                result = JSON.stringify({ error: "No hay una sociedad autorizada para esta operación" });
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
                continue;
              }
              if (TABLES_WITH_SOCIEDAD.has(table) && data.sociedad_id && !allowedSociedadIds.includes(data.sociedad_id as string)) {
                result = JSON.stringify({ error: "No tenés acceso a esa sociedad" });
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
                continue;
              }
              let updateQuery = supabase.from(table).update(data).eq("id", id);
              if (TABLES_WITH_SOCIEDAD.has(table)) updateQuery = updateQuery.in("sociedad_id", allowedSociedadIds);
              const { data: updated, error } = await updateQuery.select().single();
              if (error) {
                result = JSON.stringify({ error: error.message });
              } else {
                result = JSON.stringify({ success: true, data: updated });
              }
            }
          } else if (toolUse.name === "count_records") {
            const table = input.table as string;
            if (!canRead(role, table)) {
              result = JSON.stringify({ error: `No tenés permisos para leer ${table}` });
            } else {
              let query = supabase.from(table).select("id", { count: "exact", head: true });
              const filters = input.filters as Array<{ column: string; operator: string; value: string }> | undefined;
              if (filters) {
                for (const f of filters) {
                  query = query.filter(f.column, f.operator, f.value);
                }
              }
              if (allowedSociedadIds.length > 0 && TABLES_WITH_SOCIEDAD.has(table)) {
                query = query.in("sociedad_id", allowedSociedadIds);
              }
              const { count, error } = await query;
              if (error) {
                result = JSON.stringify({ error: error.message });
              } else {
                result = JSON.stringify({ count });
              }
            }
          } else {
            result = JSON.stringify({ error: `Tool ${toolUse.name} no reconocida` });
          }
        } catch (err: unknown) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : "Error ejecutando tool" });
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Also include any text blocks from the response
      const assistantContent: Anthropic.Messages.ContentBlockParam[] = response.content.map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        } else if (block.type === "tool_use") {
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        return { type: "text" as const, text: "" };
      });

      // Append assistant message and tool results
      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: assistantContent },
        { role: "user" as const, content: toolResults },
      ];

      // If stop_reason is end_turn, we're done
      if (response.stop_reason === "end_turn") {
        const textBlock = response.content.find((b) => b.type === "text");
        finalText = textBlock && textBlock.type === "text" ? textBlock.text : "";
        break;
      }
    }

    return Response.json({ response: finalText });
  } catch (error: unknown) {
    console.error("Error en API de IA:", error);
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
