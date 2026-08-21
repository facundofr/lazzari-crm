import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function POST(request: NextRequest) {
  try {
    const { mensaje, cliente_id, moneda, imagen } = await request.json();

    if (!mensaje?.trim() && !imagen) {
      return Response.json({ error: "Se requiere un mensaje o una imagen" }, { status: 400 });
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

    // Build user content: text + optional image
    const userContent: Anthropic.MessageParam["content"] = [];
    if (imagen) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: imagen.media_type || "image/jpeg",
          data: imagen.data,
        },
      });
    }
    userContent.push({
      type: "text",
      text: mensaje?.trim()
        ? `Mensaje/pedido del cliente:\n\n${mensaje}`
        : "Analizá la imagen adjunta e identificá los productos pedidos.",
    });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: `Sos un asistente que arma presupuestos para Lazzari Soluciones Industriales, empresa de válvulas, caños, fittings, instrumentación y materiales industriales en Argentina.

Tu tarea: dado un mensaje o imagen de un cliente pidiendo productos, buscá los items más relevantes en el catálogo de listas de precios de proveedores y devolvé un JSON con los items para el presupuesto. Si te envían una foto (de un mail, WhatsApp, lista, PDF, etc.), extraé los productos y cantidades de la imagen.
${clienteInfo}
Moneda del presupuesto: ${moneda || "USD"}

CATALOGO DE LISTAS DE PRECIOS (proveedores):
${JSON.stringify(catalogItems, null, 0)}

REGLAS:
1. Buscá PRIMERO en el CATALOGO. Usá código exacto, luego descripción similar.
2. Si dos proveedores tienen un item similar, elegí el de mejor precio en la moneda del presupuesto.
3. Si un producto pedido NO existe en el catálogo, IGUAL incluiló en items con "en_catalogo": false. En ese caso inventá un código descriptivo (ej: "VALV-ESF-2"), poné la mejor descripción que puedas, precio_costo: 0, lista_id: null, y en nota aclaralo (ej: "No encontrado en catálogo, verificar precio").
4. Para items del catálogo usá el codigo, descripcion, precio y lista_id EXACTOS. Copialos tal cual, sin modificar. Poné "en_catalogo": true.
5. Interpretá cantidades del mensaje/imagen. Si no se especifica, usá 1.
6. Usá la unidad del catálogo (UN, MT, KG, etc). Si no hay catálogo, estimá la unidad apropiada.
7. El campo "nota" es para aclaraciones (ej: "alternativa sugerida", "verificar medida con cliente", "no encontrado en catálogo").

Respondé SOLO con un JSON válido, sin markdown ni explicaciones:
{
  "items": [
    {
      "codigo": "string",
      "descripcion": "string",
      "categoria": "string",
      "cantidad": number,
      "unidad": "string",
      "precio_costo": number,
      "proveedor": "string",
      "lista_id": "string o null",
      "en_catalogo": boolean,
      "nota": "string opcional"
    }
  ],
  "notas_generales": "string con observaciones para el vendedor"
}`,
      messages: [
        {
          role: "user",
          content: userContent,
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
