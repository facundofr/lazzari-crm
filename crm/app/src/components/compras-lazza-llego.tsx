"use client";

/**
 * Compras Lazza › Llegó (Augusto 16/10): muy simple.
 * [Completo] marca todo llegado. [Parcial] muestra cada artículo con "llegaron ___" (arranca en lo que falta) y suma
 * a lo que ya había llegado. Se puede volver a abrir hasta completar. No hace remito de recepción ni toca stock.
 * [Corregir cantidades]: si se marcó de más (ej. Completo por error), se pone el total que llegó de verdad.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { armarRecepcion, estadoPorRecibido } from "@/lib/compras-recepcion";
import { cant } from "@/lib/cargar-factura";
import { Check, Loader2, X } from "lucide-react";

const db = supabase as any;
const round2 = (n: number) => Math.round(n * 100) / 100;
type Item = { id: string; codigo: string | null; descripcion: string; cantidad: number; cantidad_recibida: number | null; orden: number | null };

export default function ComprasLazzaLlego({ sociedadId, oc, onClose }: { sociedadId: string; oc: { id: string; numero: string }; onClose: () => void }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [cargando, setCargando] = useState(true);
  const [parcial, setParcial] = useState(false);
  const [corregir, setCorregir] = useState(false);
  const [cant_, setCant] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error: e } = await db.from("orden_compra_items").select("id, codigo, descripcion, cantidad, cantidad_recibida, orden").eq("orden_id", oc.id).order("orden");
      if (!vivo) return;
      if (e) setError(e.message);
      const its = (data || []) as Item[];
      setItems(its);
      setCant(Object.fromEntries(its.map(i => [i.id, ""])));
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, [oc.id]);

  const falta = (i: Item) => Math.max(0, round2(Number(i.cantidad) - Number(i.cantidad_recibida || 0)));
  const pendientes = items.filter(i => falta(i) > 0);

  /** Corregir: el número es el TOTAL que llegó (puede bajar). */
  async function guardarCorreccion() {
    setGuardando(true); setError("");
    try {
      const cambios = items.map(i => ({ i, nuevo: Math.min(Number(i.cantidad), Math.max(0, Number(String(cant_[i.id] ?? "").replace(",", ".")) || 0)) }))
        .filter(x => Math.abs(x.nuevo - Number(x.i.cantidad_recibida || 0)) > 0.0001);
      if (!cambios.length) { setError("No cambiaste ninguna cantidad."); return; }
      for (const { i, nuevo } of cambios) {
        const { error: e } = await db.from("orden_compra_items").update({ cantidad_recibida: nuevo }).eq("id", i.id).eq("orden_id", oc.id);
        if (e) throw new Error(`No se pudo corregir «${i.descripcion}» (${e.message})`);
      }
      const despues = items.map(i => { const c = cambios.find(x => x.i.id === i.id); return c ? { ...i, cantidad_recibida: c.nuevo } : i; });
      const { data: actual } = await db.from("ordenes_compra").select("estado").eq("id", oc.id).eq("sociedad_id", sociedadId).single();
      const estado = estadoPorRecibido(despues, actual?.estado || "enviada");
      if (estado !== actual?.estado) await db.from("ordenes_compra").update({ estado }).eq("id", oc.id).eq("sociedad_id", sociedadId);
      toast.success(`${oc.numero}: cantidades corregidas`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo corregir");
    } finally { setGuardando(false); }
  }

  async function guardar(todo: boolean) {
    setGuardando(true); setError("");
    try {
      const leidos = todo
        ? pendientes.map(i => ({ item_id: i.id, cantidad: falta(i) }))
        : pendientes.map(i => ({ item_id: i.id, cantidad: Number(String(cant_[i.id] || "").replace(",", ".")) || 0 })).filter(l => l.cantidad > 0);
      const rec = armarRecepcion(items, leidos);
      if (!rec.cargas.length) { setError("No pusiste ninguna cantidad."); return; }
      const hechas: typeof rec.cargas = [];
      for (const c of rec.cargas) {
        const { error: e } = await db.from("orden_compra_items").update({ cantidad_recibida: c.despues }).eq("id", c.item_id).eq("orden_id", oc.id);
        if (e) {
          for (const h of hechas) await db.from("orden_compra_items").update({ cantidad_recibida: h.antes }).eq("id", h.item_id).eq("orden_id", oc.id);
          throw new Error(`No se pudo guardar lo que llegó (${e.message}); no quedó nada cargado`);
        }
        hechas.push(c);
      }
      const { data: actual } = await db.from("ordenes_compra").select("estado").eq("id", oc.id).eq("sociedad_id", sociedadId).single();
      const despues = items.map(i => { const c = rec.cargas.find(x => x.item_id === i.id); return c ? { ...i, cantidad_recibida: c.despues } : i; });
      const estado = estadoPorRecibido(despues, actual?.estado || "enviada");
      if (estado !== actual?.estado) {
        const { error: e } = await db.from("ordenes_compra").update({ estado }).eq("id", oc.id).eq("sociedad_id", sociedadId);
        if (e) toast.warning(`${oc.numero}: se guardó lo que llegó pero no cambió el estado (${e.message})`);
      }
      const faltan = despues.filter(i => Number(i.cantidad_recibida || 0) < Number(i.cantidad) - 0.0001).length;
      toast.success(`${oc.numero}: ${faltan ? `llegó una parte, faltan ${faltan} artículo(s)` : "llegó todo"}`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally { setGuardando(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => { if (!guardando) onClose(); }}>
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Llegó · <span className="font-mono">{oc.numero}</span></h2>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>
        {cargando ? <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo la OC…</p> : (
          <>
            <ul className="mb-3 divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-700">
              {items.map(i => {
                const f = falta(i);
                return (
                  <li key={i.id} className="flex items-center gap-2 px-2 py-1">
                    <span className="min-w-0 flex-1 truncate" title={i.descripcion}>{i.descripcion}</span>
                    <span className="whitespace-nowrap font-mono text-xs text-zinc-500">{cant(Number(i.cantidad_recibida || 0))} / {cant(Number(i.cantidad))}</span>
                    {corregir && (
                      <label className="flex items-center gap-1 text-xs">llegaron en total
                        <input value={cant_[i.id] ?? ""} inputMode="decimal" onChange={e => setCant(p => ({ ...p, [i.id]: e.target.value }))}
                          className="w-14 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right dark:border-zinc-600 dark:bg-zinc-900" />
                      </label>
                    )}
                    {parcial && f > 0 && (
                      <label className="flex items-center gap-1 text-xs">llegaron
                        <input value={cant_[i.id] ?? ""} placeholder={cant(f)} inputMode="decimal" autoFocus={i.id === pendientes[0]?.id}
                          onChange={e => setCant(p => ({ ...p, [i.id]: e.target.value }))}
                          className="w-14 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right dark:border-zinc-600 dark:bg-zinc-900" />
                      </label>
                    )}
                    {f === 0 && !corregir && <Check className="h-4 w-4 text-emerald-600" />}
                  </li>
                );
              })}
            </ul>
            {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
            {corregir ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Poné cuánto llegó de verdad de cada artículo.</span>
                <button onClick={() => setCorregir(false)} disabled={guardando} className="ml-auto rounded-lg border px-3 py-2 text-sm dark:border-zinc-600">Volver</button>
                <button onClick={() => void guardarCorreccion()} disabled={guardando} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar
                </button>
              </div>
            ) : !pendientes.length ? <p className="text-sm text-emerald-700">Ya llegó todo.</p> : !parcial ? (
              <div className="flex gap-2">
                <button onClick={() => void guardar(true)} disabled={guardando} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Completo
                </button>
                <button onClick={() => { setCant(Object.fromEntries(pendientes.map(i => [i.id, cant(falta(i))]))); setParcial(true); }} disabled={guardando} className="flex-1 rounded-lg border border-amber-400 px-4 py-2 text-sm font-bold text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30">Parcial</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Corregí lo que no llegó entero (0 = no llegó).</span>
                <button onClick={() => setParcial(false)} disabled={guardando} className="ml-auto rounded-lg border px-3 py-2 text-sm dark:border-zinc-600">Volver</button>
                <button onClick={() => void guardar(false)} disabled={guardando} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar
                </button>
              </div>
            )}
            {!corregir && !parcial && items.some(i => Number(i.cantidad_recibida || 0) > 0) && (
              <button onClick={() => { setCant(Object.fromEntries(items.map(i => [i.id, cant(Number(i.cantidad_recibida || 0))]))); setCorregir(true); }}
                className="mt-2 text-xs text-zinc-500 underline">Corregir cantidades (si se marcó de más)</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
