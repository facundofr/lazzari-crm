import { registrarUsoIA } from "@/lib/ia-uso";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Opus 5.5 piensa antes de responder: más tiempo.
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const { mensaje, cliente_id, moneda, imagen, sociedad_id } = await request.json();

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
      .eq("listas_precios.estado", "vigente")
      .eq("listas_precios.sociedad_id", sociedad_id);

    if (liError) {
      // La lectura del catálogo no debe impedir armar un presupuesto desde un
      // mensaje o una captura. En instalaciones con RLS/configuración parcial
      // dejamos que la IA extraiga los productos y los marque para verificar.
      console.error("Error fetching lista items; continuing without catalog:", liError);
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
      costo_moneda: item.listas_precios?.moneda,
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

    const stream = client.messages.stream({
      // Augusto 26/10/2026: Opus 5.5 con esfuerzo alto.
      model: "claude-opus-5-5",
      max_tokens: 32000,
      output_config: { effort: "high" },
      system: `Sos un asistente que arma presupuestos para Lazzari Soluciones Industriales, empresa de válvulas, caños, fittings, instrumentación y materiales industriales en Argentina.

Tu tarea: dado un mensaje o imagen de un cliente pidiendo productos, buscá los items más relevantes en el catálogo de listas de precios de proveedores y devolvé un JSON con los items para el presupuesto. Si te envían una foto (de un mail, WhatsApp, lista, PDF, etc.), extraé los productos y cantidades de la imagen.
${clienteInfo}
Moneda del presupuesto: ${moneda || "USD"}
IMPORTANTE: Si los precios del mensaje/imagen están en pesos argentinos ($, ARS), usá "moneda": "ARS". Si están en dólares (US$, USD), usá "moneda": "USD". Si no se especifica, usá "${moneda || "USD"}".

CATEGORÍA DEL CATÁLOGO: ${catalogItems.length > 0 ? "hay productos para buscar" : "no disponible; extraé igualmente el pedido y marcá los items para verificar"}
CATALOGO DE LISTAS DE PRECIOS (proveedores):
${JSON.stringify(catalogItems, null, 0)}

REGLAS:
1. Buscá PRIMERO en el CATALOGO. Usá código exacto, luego descripción similar.
2. Si dos proveedores tienen un item similar, elegí el de mejor precio en la moneda del presupuesto.
3. Si un producto pedido NO existe en el catálogo, IGUAL incluiló en items con "en_catalogo": false. En ese caso inventá un código descriptivo (ej: "VALV-ESF-2"), poné la mejor descripción que puedas, precio_costo: 0, lista_id: null, y en nota aclaralo (ej: "No encontrado en catálogo, verificar precio").
4. Para items del catálogo usá el codigo, descripcion, precio, costo_moneda y lista_id EXACTOS. Copialos tal cual, sin modificar. Poné "en_catalogo": true.
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
      "costo_moneda": "USD o ARS",
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

    const response = await stream.finalMessage();
    await registrarUsoIA("presupuesto_ia", response.model, response.usage);
    const textBlock = response.content.find((b) => b.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "{}";

    // Parse JSON from response (handle potential markdown wrapping)
    let parsed;
    try {
      let jsonStr = rawText.replace(/^```json?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      // Extract JSON object if there's surrounding text
      const jsonStart = jsonStr.indexOf("{");
      const jsonEnd = jsonStr.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonStart < jsonEnd) {
        jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response:", rawText.slice(0, 500));
      return Response.json({ error: "Error al interpretar la respuesta de la IA", raw: rawText.slice(0, 300) }, { status: 500 });
    }

    return Response.json(parsed);
  } catch (error: unknown) {
    console.error("Error en AI presupuesto:", error);
    const message = error instanceof Error ? error.message : "Error interno";
    return Response.json({ error: message }, { status: 500 });
  }
}
