"use client";

import { useState } from "react";
import { Sparkles, X, Send, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function AIWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

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
    <div className="fixed bottom-6 right-6 z-50 w-96 rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-white" />
          <span className="font-semibold text-white">Asistente IA</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white">Beta</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-white/70 hover:bg-white/20 hover:text-white">
            <Minimize2 className="h-4 w-4" />
          </button>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-white/70 hover:bg-white/20 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="h-72 overflow-y-auto p-4 space-y-3">
        <div className="flex gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800 max-w-[280px]">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Hola, soy el asistente de Lazzari. Puedo ayudarte con:
            </p>
            <ul className="mt-2 space-y-1 text-xs text-zinc-500">
              <li>- Generar remitos desde PR aprobados</li>
              <li>- Extraer datos de facturas de compra</li>
              <li>- Analizar rechazos y sugerir precios</li>
              <li>- Consultar historial de cotizaciones</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-2">
        {["Generar remito", "Importar FC", "Análisis rechazos"].map((action) => (
          <button
            key={action}
            className="whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-400"
          >
            {action}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Escribí tu consulta..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <button className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
