import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const SYSTEM_PROMPT = `Sos el asistente de IA de Lazzari CRM, una empresa de soluciones industriales con sede en Argentina. Tu nombre es "Asistente Lazzari".

Tu rol es ayudar a los usuarios del CRM con las siguientes tareas:

1. **Generar remitos**: Ayudar a crear remitos a partir de presupuestos aprobados (PR). Guiar al usuario sobre qué campos completar, validaciones necesarias y flujo de trabajo.

2. **Importar facturas de compra (FC)**: Asistir en la extracción e importación de datos de facturas de compra al sistema. Explicar el formato esperado y ayudar a resolver errores de importación.

3. **Analizar rechazos de presupuestos**: Analizar las razones por las cuales se rechazan presupuestos, identificar patrones, sugerir ajustes de precios y estrategias para mejorar la tasa de aprobación.

4. **Consultas generales del CRM**: Responder preguntas sobre cómo usar el sistema, dónde encontrar información, cómo generar reportes, y cualquier otra consulta relacionada con el CRM.

Reglas de comportamiento:
- Respondé siempre en español argentino (usá "vos" en lugar de "tú").
- Sé conciso y directo en tus respuestas.
- Si no tenés información suficiente para responder, pedí los datos que necesitás.
- Usá formato Markdown cuando sea útil (listas, negritas, etc.).
- Si el usuario pide algo que no está relacionado con el CRM o Lazzari, podés responder brevemente pero redirigí la conversación hacia temas del sistema.`;

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return Response.json(
        { error: "Se requiere un array de mensajes" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY no está configurada" },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

    return Response.json({ response: text });
  } catch (error: unknown) {
    console.error("Error en API de IA:", error);
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return Response.json({ error: message }, { status: 500 });
  }
}
