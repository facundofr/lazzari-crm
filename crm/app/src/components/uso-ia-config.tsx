"use client";

/**
 * Configuración > Uso de IA: cuánto usó la IA del CRM en el mes (llamadas, tokens y costo estimado).
 * Los datos salen de la tabla ia_uso. El costo es una estimación con precios por millón de tokens.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { Loader2 } from "lucide-react";

const db = supabase as any;

// USD por millón de tokens (entrada / salida). Aproximado: sirve para tener una idea, no para facturar.
const PRECIOS: Array<{ clave: string; entrada: number; salida: number }> = [
  { clave: "haiku", entrada: 1, salida: 5 },
  { clave: "sonnet", entrada: 3, salida: 15 },
  { clave: "opus", entrada: 15, salida: 75 },
];
const costoUSD = (modelo: string | null, ent: number, sal: number) => {
  const p = PRECIOS.find(x => (modelo || "").toLowerCase().includes(x.clave)) || PRECIOS[0];
  return (ent * p.entrada + sal * p.salida) / 1_000_000;
};

const FUNCION_LABEL: Record<string, string> = {
  oc_cliente: "Leer OC de clientes", lista_precios: "Leer listas de precios", factura_compra: "Leer facturas de compra",
  cobro: "Leer cobros / OP", documento_impositivo: "Leer documentos impositivos", normalizar_oc: "Normalizar OC",
  conciliar_compra: "Conciliar compras", cotizacion_express: "Cotización express", presupuesto_ia: "Presupuesto con IA", chat_ia: "Chat IA",
};

interface Fila { created_at: string; funcion: string; modelo: string | null; tokens_entrada: number; tokens_salida: number }

const mesTexto = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function UsoIAConfig() {
  const [mes, setMes] = useState(() => mesTexto(new Date()));
  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [a, m] = mes.split("-").map(Number);
      const desde = new Date(a, m - 1, 1).toISOString();
      const hasta = new Date(a, m, 1).toISOString();
      const rows = await traerTodo<Fila & { id: string }>(() => db.from("ia_uso").select("id, created_at, funcion, modelo, tokens_entrada, tokens_salida").gte("created_at", desde).lt("created_at", hasta).order("id"));
      setFilas(rows);
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el uso de IA");
      setFilas([]);
    } finally {
      setLoading(false);
    }
  }, [mes]);
  useEffect(() => { void cargar(); }, [cargar]);

  const { total, porFuncion } = useMemo(() => {
    const m = new Map<string, { llamadas: number; ent: number; sal: number; usd: number }>();
    let llamadas = 0, ent = 0, sal = 0, usd = 0;
    for (const f of filas) {
      const c = costoUSD(f.modelo, f.tokens_entrada, f.tokens_salida);
      llamadas++; ent += f.tokens_entrada; sal += f.tokens_salida; usd += c;
      const x = m.get(f.funcion) || { llamadas: 0, ent: 0, sal: 0, usd: 0 };
      x.llamadas++; x.ent += f.tokens_entrada; x.sal += f.tokens_salida; x.usd += c;
      m.set(f.funcion, x);
    }
    return { total: { llamadas, ent, sal, usd }, porFuncion: [...m.entries()].sort((a, b) => b[1].usd - a[1].usd) };
  }, [filas]);

  const n = (v: number) => v.toLocaleString("es-AR");
  const usd = (v: number) => `US$ ${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold dark:text-white">Uso de IA del CRM</h2>
        <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} className="h-8 rounded-lg border border-zinc-300 bg-white px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
        <span className="text-xs text-zinc-500">Cuenta solo la IA que usa el CRM (se cobra por uso con la clave de Anthropic). El chat de Claude va por tu plan. Empieza a contar desde que se publicó.</span>
      </div>
      {loading ? <Loader2 className="h-5 w-5 animate-spin text-orange-500" /> : error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">{error}. Si es la primera vez, falta correr la migración del contador.</p>
      ) : (
        <>
          {/* Números rápidos en una línea */}
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[["Llamadas", n(total.llamadas)], ["Tokens de entrada", n(total.ent)], ["Tokens de salida", n(total.sal)], ["Costo estimado", usd(total.usd)]].map(([t, v]) => (
              <span key={t} className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-zinc-500">{t}</span> <b className="font-mono dark:text-white">{v}</b></span>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/50"><tr><th className="px-3 py-1.5">Para qué</th><th className="px-3 text-right">Llamadas</th><th className="px-3 text-right">Tokens</th><th className="px-3 text-right">Costo estimado</th></tr></thead>
              <tbody>
                {porFuncion.map(([f, x]) => (
                  <tr key={f} className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                    <td className="px-3 py-1.5">{FUNCION_LABEL[f] || f}</td>
                    <td className="px-3 text-right">{n(x.llamadas)}</td>
                    <td className="px-3 text-right">{n(x.ent + x.sal)}</td>
                    <td className="px-3 text-right">{usd(x.usd)}</td>
                  </tr>
                ))}
                {!porFuncion.length && <tr><td colSpan={4} className="py-6 text-center text-sm text-zinc-400">Sin uso de IA registrado en este mes.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
