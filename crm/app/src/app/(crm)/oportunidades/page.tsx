"use client";

/**
 * Oportunidades: a quién llamar y qué ofrecerle, sacado del historial de todos los clientes.
 * El riesgo BCRA de la cartera está en Finanzas > Informes (Augusto pidió sacarlo de acá).
 * Todo es sugerencia: no cambia nada solo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { traerTodo } from "@/lib/paginar";
import { TIPO_LABEL, calcularOportunidades, type ItemHist, type Oportunidad, type PRHist, type TipoOportunidad } from "@/lib/oportunidades";
import { Lightbulb, Loader2, Search } from "lucide-react";

const db = supabase as any;
const mon = (m: string | null | undefined) => (m === "USD" ? "USD" : "ARS") as "ARS" | "USD";

interface Cliente { id: string; razon_social: string; cuit: string | null; vendedor_id: string | null }

const TIPOS: TipoOportunidad[] = ["recompra", "dormido", "temporada", "reactivar", "complementario"];
const TIPO_COLOR: Record<TipoOportunidad, string> = {
  recompra: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  temporada: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  reactivar: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  complementario: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  dormido: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export default function OportunidadesPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;

  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Array<{ id: string; full_name: string }>>([]);
  const [ops, setOps] = useState<Oportunidad[]>([]);
  const [tipo, setTipo] = useState<TipoOportunidad | "todas">("todas");
  const [vendedor, setVendedor] = useState<string>("");
  const [buscar, setBuscar] = useState("");

  const cargar = useCallback(async () => {
    if (!sociedadId) { setLoading(false); return; }
    setLoading(true);
    try {
      const desde = new Date(Date.now() - 3 * 366 * 86400_000).toISOString().slice(0, 10);
      const [cli, prs, items, facts, vend] = await Promise.all([
        traerTodo<Omit<Cliente, "vendedor_id"> & { assigned_to: string | null }>(() => db.from("clientes").select("id, razon_social, cuit, assigned_to").eq("sociedad_id", sociedadId).eq("activo", true).order("id"))
          .then(rows => rows.map(({ assigned_to, ...c }) => ({ ...c, vendedor_id: assigned_to }) as Cliente)),
        traerTodo<PRHist>(() => db.from("presupuestos").select("id, cliente_id, numero, fecha, estado, total, moneda, motivo_rechazo").eq("sociedad_id", sociedadId).gte("fecha", desde).order("id")),
        traerTodo<ItemHist & { id: string }>(() => db.from("presupuesto_items").select("id, presupuesto_id, codigo, descripcion, cantidad, precio_venta, presupuestos!inner(sociedad_id, fecha)")
          .eq("presupuestos.sociedad_id", sociedadId).gte("presupuestos.fecha", desde).order("id")),
        traerTodo<any>(() => db.from("facturas").select("id, cliente_id, fecha, total, moneda, tipo, estado").eq("sociedad_id", sociedadId).gte("fecha", desde).order("id")),
        db.from("profiles").select("id, full_name").in("role", ["vendedor", "admin", "super_admin"]).order("full_name"),
      ]);
      const activos = new Set(cli.map(c => c.id));
      const lista = calcularOportunidades(
        prs.filter(p => activos.has(p.cliente_id)).map(p => ({ ...p, fecha: String(p.fecha).slice(0, 10), total: Number(p.total) || 0, moneda: mon(p.moneda) })),
        items.map(i => ({ presupuesto_id: i.presupuesto_id, codigo: i.codigo, descripcion: i.descripcion, cantidad: Number(i.cantidad) || 0, precio_venta: i.precio_venta != null ? Number(i.precio_venta) : null })),
        facts.filter((f: any) => activos.has(f.cliente_id)).map((f: any) => ({ cliente_id: f.cliente_id, fecha: String(f.fecha).slice(0, 10), total: Number(f.total) || 0, moneda: mon(f.moneda), tipo: String(f.tipo), estado: f.estado })),
      );
      setClientes(cli);
      setOps(lista);
      setVendedores(vend.data || []);
    } catch (e: any) {
      toast.error(`No se pudieron calcular las oportunidades: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [sociedadId, toast]);
  useEffect(() => { void cargar(); }, [cargar]);

  // Si es vendedor, arranca filtrado por sus clientes.
  useEffect(() => { if (profile?.role === "vendedor" && profile.id) setVendedor(profile.id); }, [profile?.role, profile?.id]);

  const clienteMap = useMemo(() => new Map(clientes.map(c => [c.id, c])), [clientes]);
  const q = buscar.trim().toLowerCase();
  const visibles = ops.filter(o => {
    const c = clienteMap.get(o.cliente_id);
    if (!c) return false;
    if (tipo !== "todas" && o.tipo !== tipo) return false;
    if (vendedor && c.vendedor_id !== vendedor) return false;
    return !q || `${c.razon_social} ${o.titulo} ${o.detalle}`.toLowerCase().includes(q);
  });
  const conteo = (t: TipoOportunidad) => ops.filter(o => o.tipo === t && clienteMap.has(o.cliente_id) && (!vendedor || clienteMap.get(o.cliente_id)?.vendedor_id === vendedor)).length;

  // Agrupadas por cliente, en el orden de la oportunidad más importante.
  const grupos = useMemo(() => {
    const m = new Map<string, Oportunidad[]>();
    for (const o of visibles) { const l = m.get(o.cliente_id) || []; l.push(o); m.set(o.cliente_id, l); }
    return [...m.entries()];
  }, [visibles]);

  const inputClass = "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header title="Oportunidades" subtitle="A quién llamar y qué ofrecerle, según el historial" />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white"><Lightbulb className="h-4 w-4" /> Oportunidades ({ops.length})</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <select value={vendedor} onChange={e => setVendedor(e.target.value)} className={inputClass}>
              <option value="">Todos los vendedores</option>
              {vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
            </select>
            <div className="relative"><Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" /><input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar cliente o artículo…" className={`${inputClass} w-60 pl-8`} /></div>
          </div>
        </div>

        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div> : (
          <>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setTipo("todas")} className={`rounded-lg border px-3 py-1 text-xs ${tipo === "todas" ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30" : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>Todas</button>
              {TIPOS.map(t => (
                <button key={t} onClick={() => setTipo(t)} className={`rounded-lg border px-3 py-1 text-xs ${tipo === t ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30" : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>{TIPO_LABEL[t]} ({conteo(t)})</button>
              ))}
            </div>
            <div className="space-y-3">
              {grupos.slice(0, 200).map(([clienteId, lista]) => {
                const c = clienteMap.get(clienteId)!;
                return (
                  <div key={clienteId} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Link href={`/clientes?id=${clienteId}`} className="font-semibold hover:text-orange-600 dark:text-white">{c.razon_social}</Link>
                    </div>
                    <ul className="space-y-1.5">
                      {lista.map((o, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${TIPO_COLOR[o.tipo]}`}>{TIPO_LABEL[o.tipo]}</span>
                          <span className="dark:text-zinc-200"><b>{o.titulo}</b> — {o.detalle}{o.monto ? <span className="text-zinc-500"> (~{formatCurrency(o.monto, mon(o.moneda))})</span> : null}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {!grupos.length && <p className="py-10 text-center text-sm text-zinc-400">No hay oportunidades con estos filtros.</p>}
              {grupos.length > 200 && <p className="text-center text-xs text-zinc-400">Se muestran los primeros 200 clientes. Usá los filtros para ver el resto.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
