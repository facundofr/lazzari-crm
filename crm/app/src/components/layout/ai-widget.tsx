"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Minimize2, Loader2 } from "lucide-react";
import { useUser } from "@/lib/auth-context";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUICK_ACTIONS = [
  { label: "Resumen del dia", prompt: "Dame un resumen de la actividad de hoy: presupuestos nuevos, facturas, movimientos." },
  { label: "Stock bajo", prompt: "Mostrá los productos con stock por debajo del mínimo." },
  { label: "Clientes sin actividad", prompt: "¿Qué clientes activos no tienen presupuestos ni facturas en los últimos 90 días?" },
  { label: "Top facturado", prompt: "¿Cuáles son los 5 clientes que más facturamos este año?" },
];

export function AIWidget() {
  const { profile, role } = useUser();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return;

    const userMessage: Message = { role: "user", content: content.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          userRole: role,
          userName: profile?.full_name || profile?.email || "Usuario",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al comunicarse con la IA");
        return;
      }

      setMessages([...newMessages, { role: "assistant", content: data.response }]);
    } catch {
      setError("Error de conexión. Verificá que la API esté configurada.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function clearChat() {
    setMessages([]);
    setError("");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-violet-500 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all"
        title="Asistente IA"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 flex flex-col max-h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-white" />
          <span className="font-semibold text-white">Asistente Lazzari</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white">DB</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button onClick={clearChat} className="rounded-md px-2 py-1 text-[10px] text-white/70 hover:bg-white/20 hover:text-white">
              Limpiar
            </button>
          )}
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-white/70 hover:bg-white/20 hover:text-white">
            <Minimize2 className="h-4 w-4" />
          </button>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-white/70 hover:bg-white/20 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="flex gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800 max-w-[320px]">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Hola{profile?.full_name ? ` ${profile.full_name.split(" ")[0]}` : ""}! Tengo acceso a la base de datos del CRM. Puedo:
              </p>
              <ul className="mt-2 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                <li>- Consultar clientes, presupuestos, facturas, stock</li>
                <li>- Crear y modificar registros</li>
                <li>- Analizar datos y generar reportes</li>
                <li>- Buscar información cruzada</li>
              </ul>
              <p className="mt-2 text-[10px] text-zinc-400">
                Rol: {role} — los permisos de escritura dependen de tu rol.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
            )}
            <div
              className={`rounded-lg p-3 max-w-[320px] text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-violet-600 text-white"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                <span className="text-xs text-zinc-500">Consultando datos...</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions */}
      {messages.length === 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2 shrink-0">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => sendMessage(action.prompt)}
              className="whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-400"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-700 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Preguntá o pedí algo..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
