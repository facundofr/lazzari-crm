"use client";

// Resumen económico de Finanzas → Hoy: lo que tengo − lo que debo, a primera vista.
// Reemplaza a "Caja" (saldo cargado a mano, repetía las cuentas) y "Balance" (usaba get_balance_projection, que calcula mal).
// Los números salen de los mismos cálculos que el resto de Finanzas: cuentas, CC de clientes y proveedores, créditos.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency } from "@/lib/utils";
import { RENGLONES_RESUMEN, calcularResumen, leerTildados, sumarPorMoneda, type ClaveResumen, type Montos } from "@/lib/resumen-economico";
import { Settings2, Scale } from "lucide-react";

const CLAVE_TILDADOS = "lz-resumen-economico-tildados";

export interface ResumenEconomicoProps {
  sociedadId: string | null | undefined;
  /** Montos que ya calculó Finanzas (sin "vendido sin facturar", que se trae acá solo si se tilda). */
  montos: Partial<Record<ClaveResumen, Montos>>;
  /** Texto chico debajo de cada monto (ej. "neto de $X a favor de clientes"). */
  notas?: Partial<Record<ClaveResumen, string>>;
  /** Adónde lleva cada renglón al tocarlo. */
  onIr?: Partial<Record<ClaveResumen, () => void>>;
}

function leerGuardado(): string | null {
  try { return localStorage.getItem(CLAVE_TILDADOS); } catch { return null; }
}

export default function ResumenEconomico({ sociedadId, montos, notas, onIr }: ResumenEconomicoProps) {
  const [tildados, setTildados] = useState<Set<ClaveResumen>>(() => leerTildados(null));
  const [elegir, setElegir] = useState(false);
  const [dolar, setDolar] = useState<number | null>(null);
  const [vendido, setVendido] = useState<Montos | null>(null);

  // Lo tildado se recuerda en esta compu (preferencia de pantalla).
  useEffect(() => { setTildados(leerTildados(leerGuardado())); }, []);
  const cambiar = (clave: ClaveResumen) => {
    setTildados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(clave)) nuevo.delete(clave); else nuevo.add(clave);
      try { localStorage.setItem(CLAVE_TILDADOS, [...nuevo].join(",")); } catch { /* sin almacenamiento: queda solo por ahora */ }
      return nuevo;
    });
  };

  // Dólar BNA (divisa, venta) para mostrar todo en pesos.
  useEffect(() => {
    let vivo = true;
    fetch("/api/cotizacion-bna?modalidad=divisas")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d && Number(d.valor_venta) > 0) setDolar(Number(d.valor_venta)); })
      .catch(() => { /* sin dólar: solo se ve por moneda */ });
    return () => { vivo = false; };
  }, []);

  // Vendido sin facturar: presupuestos aprobados / listos para facturar sin factura vigente. Solo si está tildado.
  const quiereVendido = tildados.has("vendido_sin_facturar");
  useEffect(() => {
    if (!quiereVendido || !sociedadId) return;
    let vivo = true;
    (async () => {
      try {
        const prs = await traerTodo<{ id: string; total: number | null; moneda: string | null }>(() => (supabase as any)
          .from("presupuestos").select("id, total, moneda")
          .eq("sociedad_id", sociedadId).in("estado", ["facturar", "aprobado"]).order("id"));
        const facturados = new Set<string>();
        const ids = prs.map((p) => p.id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await (supabase as any).from("facturas").select("presupuesto_id")
            .eq("sociedad_id", sociedadId).in("presupuesto_id", ids.slice(i, i + 200)).neq("estado", "anulada");
          for (const f of data || []) if (f.presupuesto_id) facturados.add(f.presupuesto_id);
        }
        const pendientes = prs.filter((p) => !facturados.has(p.id));
        if (vivo) setVendido(sumarPorMoneda(pendientes, (p) => Number(p.total || 0), (p) => p.moneda));
      } catch (e) {
        console.error("Error trayendo lo vendido sin facturar:", e);
      }
    })();
    return () => { vivo = false; };
  }, [quiereVendido, sociedadId]);

  const todos = useMemo(() => ({ ...montos, ...(vendido ? { vendido_sin_facturar: vendido } : {}) }), [montos, vendido]);
  const r = useMemo(() => calcularResumen(todos, tildados, dolar), [todos, tildados, dolar]);

  const monto = (m: Montos | undefined) => {
    if (!m) return <span className="text-zinc-400">…</span>;
    return (
      <>
        {formatCurrency(m.ARS)}
        {Math.abs(m.USD) >= 0.01 && <span className="ml-1 text-xs font-medium text-zinc-500">+ {formatCurrency(m.USD, "USD")}</span>}
      </>
    );
  };

  const columna = (lado: "tengo" | "debo") => {
    const renglones = RENGLONES_RESUMEN.filter((x) => x.lado === lado && tildados.has(x.clave));
    const total = lado === "tengo" ? r.tengo : r.debo;
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${lado === "tengo" ? "text-emerald-600" : "text-orange-600"}`}>
          {lado === "tengo" ? "Lo que tengo" : "Lo que debo"}
        </p>
        {renglones.length === 0 && <p className="text-xs text-zinc-400">Nada tildado.</p>}
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {renglones.map((x) => {
            const ir = onIr?.[x.clave];
            const Tag = ir ? "button" : "div";
            return (
              <Tag key={x.clave} onClick={ir} className={`flex w-full items-start justify-between gap-3 py-1.5 text-left ${ir ? "rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/60" : ""}`}>
                <span className="text-sm text-zinc-600 dark:text-zinc-300">
                  {x.titulo}
                  {notas?.[x.clave] && <span className="block text-[11px] text-zinc-400">{notas[x.clave]}</span>}
                </span>
                <span className="whitespace-nowrap text-right font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">{monto(todos[x.clave])}</span>
              </Tag>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2 dark:border-zinc-700">
          <span className="text-xs font-semibold text-zinc-500">Total</span>
          <span className={`font-mono text-sm font-bold ${lado === "tengo" ? "text-emerald-600" : "text-orange-600"}`}>{monto(total)}</span>
        </div>
      </div>
    );
  };

  const positivo = (r.netoEnPesos ?? r.neto.ARS) >= 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          <Scale className="h-4 w-4 text-orange-500" /> Resumen: cómo estoy hoy
        </h3>
        <button type="button" onClick={() => setElegir((v) => !v)} aria-expanded={elegir}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <Settings2 className="h-3.5 w-3.5" /> Elegir qué ver
        </button>
      </div>

      {elegir && (
        <div className="mb-3 grid grid-cols-1 gap-1 rounded-lg border border-dashed border-zinc-300 bg-white p-3 text-sm sm:grid-cols-2 dark:border-zinc-700 dark:bg-zinc-900">
          {RENGLONES_RESUMEN.map((x) => (
            <label key={x.clave} className="flex cursor-pointer items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={tildados.has(x.clave)} onChange={() => cambiar(x.clave)} className="h-4 w-4 accent-orange-500" />
              <span className={x.lado === "tengo" ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400"}>{x.lado === "tengo" ? "Tengo" : "Debo"}:</span>
              {x.titulo}
            </label>
          ))}
          <p className="text-[11px] text-zinc-400 sm:col-span-2">Solo lo tildado entra en la cuenta. Se recuerda en esta compu.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {columna("tengo")}
        {columna("debo")}
        <div className={`flex flex-col justify-center rounded-xl border-2 p-4 ${positivo ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Posición neta (tengo − debo)</p>
          <p className={`mt-1 font-mono text-2xl font-bold ${r.neto.ARS >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>{formatCurrency(r.neto.ARS)}</p>
          {Math.abs(r.neto.USD) >= 0.01 && (
            <p className={`font-mono text-lg font-bold ${r.neto.USD >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>{formatCurrency(r.neto.USD, "USD")}</p>
          )}
          {r.netoEnPesos != null && Math.abs(r.neto.USD) >= 0.01 && (
            <p className="mt-1 text-xs text-zinc-500">Todo en pesos: <b className="font-mono">{formatCurrency(r.netoEnPesos)}</b> (dólar BNA {formatCurrency(dolar || 0)})</p>
          )}
          <p className="mt-2 text-[11px] text-zinc-400">Pantallazo con los saldos de hoy. El detalle fino va en Reportes.</p>
        </div>
      </div>
    </div>
  );
}
