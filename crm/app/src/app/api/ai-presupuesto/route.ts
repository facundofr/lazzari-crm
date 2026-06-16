import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function POST(request: NextRequest) {
  try {
    const { mensaje, cliente_id, moneda } = await request.json();

    if (!mensaje?.trim()) {
      return Response.json({ error: "Se requiere un mensaje del cliente" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "API key no configurada" }, { status: 500 });
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } }
    );

    // 1. Fetch all vigente price list items with provider context
    const { data: listasItems, error: liError } = await supabase
      .from("lista_precios_items")
      .select(`
        id, codigo, descripcion, categoria, unidad, precio, precio_neto,
        lista_id,
        listas_precios!inner(id, nombre, moneda, estado, proveedor_id,
          proveedores(razon_social)
        )
      `)
      .eq("listas_precios.estado", "vigente");

    if (liError) {
      console.error("Error fetching lista items:", liError);
      return Response.json({ error: "Error al buscar productos" }, { status: 500 });
    }

    // 2. Get client info if provided
    let clienteInfo = "";
    if (cliente_id) {
      const { data: cliente } = await supabase
        .from("clientes")
        .select("razon_social, lista_precio, forma_pago, condicion_iva")
        .eq("id", cliente_id)
        .single();
      if (cliente) {
        clienteInfo = `\nCliente: ${cliente.razon_social} (Lista: ${cliente.lista_precio || "sin asignar"}, Forma pago: ${cliente.forma_pago || "—"}, IVA: ${cliente.condicion_iva || "—"})`;
      }
    }

    // 4. Build catalog context for the AI
    const catalogItems = (listasItems || []).map((item: any) => ({
      codigo: item.codigo,
      descripcion: item.descripcion,
      categoria: item.categoria,
      unidad: item.unidad,
      precio: item.precio_neto ?? item.precio,
      moneda: item.listas_precios?.moneda,
      proveedor: item.listas_precios?.proveedores?.razon_social ?? "—",
      lista_id: item.lista_id,
    }));

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: `Sos un asistente que arma presupuestos para Lazzari Soluciones Industriales, empresa de válvulas, caños, fittings, instrumentación y materiales industriales en Argentina.

Tu tarea: dado un mensaje de un cliente pidiendo productos, buscá los items más relevantes en el catálogo de listas de precios de proveedores y devolvé un JSON con los items para el presupuesto.
${clienteInfo}
Moneda del presupuesto: ${moneda || "USD"}

CATALOGO DE LISTAS DE PRECIOS (proveedores) — UNICA fuente de datos válida:
${JSON.stringify(catalogItems, null, 0)}

REGLAS:
1. SOLO devolvé items que existan en el CATALOGO DE LISTAS DE PRECIOS. NUNCA inventes productos ni códigos. Si un producto pedido no existe en el catálogo, NO lo incluyas en items — mencionalo en notas_generales.
2. Buscá por CÓDIGO EXACTO primero. Si el cliente menciona un código (ej: "ABC-123"), buscá ese código exacto en el catálogo. Los códigos pueden tener letras, números, guiones, barras, puntos.
3. Si no hay match exacto por código, buscá por descripción similar (ej: "válvula esférica 1/2" → buscar en descripciones).
4. Si dos proveedores tienen un item similar, elegí el de mejor precio en la moneda del presupuesto.
5. Interpretá cantidades del mensaje. Si no se especifica, usá 1.
6. Usá la unidad del catálogo (UN, MT, KG, etc).
7. El campo "nota" es para aclaraciones (ej: "alternativa sugerida", "verificar medida con cliente").
8. Usá el codigo, descripcion, precio y lista_id EXACTOS del catálogo. Copialos tal cual aparecen, sin modificar.

Respondé SOLO con un JSON válido, sin markdown ni explicaciones:
{
  "items": [
    {
      "codigo": "string (exacto del catálogo)",
      "descripcion": "string (exacta del catálogo)",
      "categoria": "string",
      "cantidad": number,
      "unidad": "string",
      "precio_costo": number (exacto del catálogo),
      "proveedor": "string",
      "lista_id": "string (exacto del catálogo)",
      "nota": "string opcional"
    }
  ],
  "notas_generales": "string con observaciones para el vendedor"
}`,
      messages: [
        {
          role: "user",
          content: `Mensaje del cliente:\n\n${mensaje}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "{}";

    // Parse JSON from response (handle potential markdown wrapping)
    let parsed;
    try {
      const jsonStr = rawText.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response:", rawText);
      return Response.json({ error: "Error al interpretar la respuesta de la IA", raw: rawText }, { status: 500 });
    }

    return Response.json(parsed);
  } catch (error: unknown) {
    console.error("Error en AI presupuesto:", error);
    const message = error instanceof Error ? error.message : "Error interno";
    return Response.json({ error: message }, { status: 500 });
  }
}
