"use client";

// Finanzas > Hoy > Revisar: lo que se dejó con dudas (tabla finanzas_revisar) + lo que encuentra el sistema solo.
// Lógica pura y prueba: src/lib/revisar-finanzas.ts, scripts/test-revisar-finanzas.mjs. Nunca frena nada (regla 1).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  ENTIDAD_LABEL, MOTIVOS_REVISAR, destinoEntidad, estaPospuesto, hallazgosAutomaticos, motivoLabel, ordenarRevisar,
  type Hallazgo, type RevisarEntidad,
} from "@/lib/revisar-finanzas";
import { guardarRevisar, BotonDejarRevisar } from "@/components/dejar-revisar";
import { AlertTriangle, Check, ExternalLink, Flag, Loader2, Plus, RotateCcw, Search, Clock } from "lucide-react";

interface FilaRevisar {
  id: string;
  entidad_tipo: RevisarEntidad;
  entidad_id: string | null;
  titulo: string;
  motivo: string;
  nota: string | null;
  importe: number | null;
  moneda: "ARS" | "USD";
  recordar_el: string | null;
  estado: "pendiente" | "resuelto";
  resolucion: string | null;
  resuelto_at: string | null;
  created_at: string;
  clientes?: { razon_social: string } | null;
  proveedores?: { razon_social: string } | null;
}

const inp = "rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

export default function FinanzasRevisar({ onIrATab }: { onIrATab: (tab: string) => void }) {
  const { sociedadActiva } = useUser();
  const sociedadId = sociedadActiva?.id;
  const hoy = todayAR();
  const [filas, setFilas] = useState<FilaRevisar[]>([]);
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [verResueltos, setVerResueltos] = useState(false);
  const [filtroMotivo, setFiltroMotivo] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [textoResolucion, setTextoResolucion] = useState("");
  const [posponiendo, setPosponiendo] = useState<string | null>(null);
  const [fechaPosponer, setFechaPosponer] = useState("");
  const [guardando, setGuardando] = useState<string | null>(null);
  const [nueva, setNueva] = useState<{ titulo: string; motivo: string; nota: string; recordar: string } | null>(null);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setLoading(true);
    setError(null);
    const db = supabase as any;
    try {
      // B) Lo que encuentra el sistema (si algo falla, no impide ver lo anotado).
      const automaticos = (async () => {
        const [movs, chs, cuentas] = await Promise.all([
          traerTodo<any>(() => db.from("movimientos").select("id, fecha, monto, moneda, tipo, descripcion, anulado")
            .eq("sociedad_id", sociedadId).gt("fecha", hoy).order("fecha").order("id")),
          traerTodo<any>(() => db.from("echeqs").select("id, numero, monto, fecha_pago, estado, direccion, origen_nombre")
            .eq("sociedad_id", sociedadId).eq("direccion", "recibido").eq("estado", "en_cartera").lt("fecha_pago", hoy).order("fecha_pago").order("id")),
          db.from("cuentas_financieras").select("id").eq("sociedad_id", sociedadId),
        ]);
        let extractoPendientes = 0;
        const ids = ((cuentas.data || []) as { id: string }[]).map((c) => c.id);
        if (ids.length) {
          const { count } = await db.from("extracto_movimientos").select("id", { count: "exact", head: true }).in("cuenta_id", ids).eq("estado", "pendiente");
          extractoPendientes = count || 0;
        }
        return hallazgosAutomaticos({ hoy, movimientos: movs, cheques: chs, extractoPendientes });
      })().catch(() => [] as Hallazgo[]);

      // A) Lo anotado.
      let anotadas: FilaRevisar[] = [];
      try {
        anotadas = await traerTodo<FilaRevisar>(() => db.from("finanzas_revisar")
          .select("id, entidad_tipo, entidad_id, titulo, motivo, nota, importe, moneda, recordar_el, estado, resolucion, resuelto_at, created_at, clientes(razon_social), proveedores(razon_social)")
          .eq("sociedad_id", sociedadId).order("created_at", { ascending: false }).order("id"));
        setFaltaMigracion(false);
      } catch (e: any) {
        if (/finanzas_revisar/.test(String(e?.message || ""))) setFaltaMigracion(true);
        else throw e;
      }
      setFilas(anotadas);
      setHallazgos(await automaticos);
    } catch (e: any) {
      setError(e?.message || "No se pudo leer Revisar.");
    } finally {
      setLoading(false);
    }
  }, [sociedadId, hoy]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Hallazgos que ya están anotados (mismo registro) no se repiten abajo.
  const anotadosIds = useMemo(() => new Set(filas.filter((f) => f.estado === "pendiente" && f.entidad_id).map((f) => f.entidad_id as string)), [filas]);
  const hallazgosVisibles = useMemo(() => hallazgos.filter((h) => !h.entidad_id || !anotadosIds.has(h.entidad_id)), [hallazgos, anotadosIds]);

  const pendientes = filas.filter((f) => f.estado === "pendiente");
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return ordenarRevisar(filas, hoy).filter((f) => (verResueltos || f.estado === "pendiente")
      && (!filtroMotivo || f.motivo === filtroMotivo)
      && (!q || [f.titulo, f.nota, f.clientes?.razon_social, f.proveedores?.razon_social].some((t) => String(t || "").toLowerCase().includes(q))));
  }, [filas, hoy, verResueltos, filtroMotivo, busqueda]);

  function abrir(tipo: RevisarEntidad, id: string | null) {
    const d = destinoEntidad(tipo, id);
    if (!d) return;
    if (d.tab) onIrATab(d.tab);
    else if (d.href) window.location.assign(d.href); // carga completa: la pantalla de destino lee el link al abrir
  }

  async function actualizar(id: string, cambios: Record<string, unknown>) {
    setGuardando(id);
    const { error: e } = await (supabase as any).from("finanzas_revisar").update(cambios).eq("id", id).eq("sociedad_id", sociedadId);
    setGuardando(null);
    if (e) { alert(`No se pudo guardar: ${e.message}`); return false; }
    await cargar();
    return true;
  }

  async function resolver(id: string) {
    const { data: u } = await supabase.auth.getUser();
    const ok = await actualizar(id, { estado: "resuelto", resolucion: textoResolucion.trim() || null, resuelto_at: new Date().toISOString(), resuelto_por: u.user?.id || null });
    if (ok) { setResolviendo(null); setTextoResolucion(""); }
  }

  async function posponer(id: string) {
    if (!fechaPosponer) return;
    const ok = await actualizar(id, { recordar_el: fechaPosponer });
    if (ok) { setPosponiendo(null); setFechaPosponer(""); }
  }

  async function agregarNota() {
    if (!nueva || !sociedadId || !nueva.titulo.trim()) return;
    setGuardando("nueva");
    const e = await guardarRevisar(sociedadId, { entidad_tipo: "otro", titulo: nueva.titulo, motivo: nueva.motivo, nota: nueva.nota, recordar_el: nueva.recordar || null });
    setGuardando(null);
    if (e) { alert(e); return; }
    setNueva(null);
    await cargar();
  }

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

      {/* A) Lo que dejaste para revisar */}
      <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Flag className="h-4 w-4 text-amber-500" /> Lo que dejaste para revisar
            <Badge variant={pendientes.length ? "warning" : "success"}>{pendientes.length} pendiente{pendientes.length === 1 ? "" : "s"}</Badge>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-zinc-400" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar" className={`${inp} w-40 pl-7`} /></div>
            <select value={filtroMotivo} onChange={(e) => setFiltroMotivo(e.target.value)} className={inp}>
              <option value="">Todos los motivos</option>
              {MOTIVOS_REVISAR.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={verResueltos} onChange={(e) => setVerResueltos(e.target.checked)} /> Ver resueltos
            </label>
            {!faltaMigracion && <button type="button" onClick={() => setNueva({ titulo: "", motivo: "otro", nota: "", recordar: "" })}
              className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600"><Plus className="h-3.5 w-3.5" /> Agregar</button>}
          </div>
        </div>

        {faltaMigracion ? (
          <p className="p-4 text-sm text-amber-700 dark:text-amber-300">Falta correr la migración de "Revisar" (20261012100000). Abajo igual se ve lo que encuentra el sistema.</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {nueva && (
              <div className="grid gap-2 bg-amber-50/50 p-3 sm:grid-cols-[2fr_1fr_2fr_auto_auto] dark:bg-amber-950/20">
                <input autoFocus value={nueva.titulo} onChange={(e) => setNueva({ ...nueva, titulo: e.target.value })} placeholder="Qué es (ej. FA 16-18 ¿duplicada?)" className={inp} />
                <select value={nueva.motivo} onChange={(e) => setNueva({ ...nueva, motivo: e.target.value })} className={inp}>
                  {MOTIVOS_REVISAR.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <input value={nueva.nota} onChange={(e) => setNueva({ ...nueva, nota: e.target.value })} placeholder="Nota" className={inp} />
                <input type="date" value={nueva.recordar} onChange={(e) => setNueva({ ...nueva, recordar: e.target.value })} title="Recordarme el" className={inp} />
                <div className="flex gap-1">
                  <button type="button" onClick={agregarNota} disabled={!nueva.titulo.trim() || guardando === "nueva"} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Guardar</button>
                  <button type="button" onClick={() => setNueva(null)} className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancelar</button>
                </div>
              </div>
            )}
            {visibles.length === 0 && !nueva && (
              <p className="p-6 text-center text-sm text-zinc-400">{pendientes.length ? "Nada con ese filtro." : "No hay nada para revisar. Usá \"Dejar para revisar\" en cheques, cobros, facturas o el extracto."}</p>
            )}
            {visibles.map((f) => {
              const vence = f.estado === "pendiente" && f.recordar_el && f.recordar_el <= hoy;
              const dormido = estaPospuesto(f, hoy);
              const quien = f.clientes?.razon_social || f.proveedores?.razon_social;
              return (
                <div key={f.id} className={`px-4 py-3 ${f.estado === "resuelto" ? "opacity-60" : ""} ${vence ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-zinc-900 dark:text-white">{f.titulo}</span>
                        <Badge variant="outline">{ENTIDAD_LABEL[f.entidad_tipo] || f.entidad_tipo}</Badge>
                        <Badge variant={f.estado === "resuelto" ? "success" : "warning"}>{motivoLabel(f.motivo)}</Badge>
                        {f.importe != null && <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">{formatCurrency(Number(f.importe), f.moneda)}</span>}
                        {quien && <span className="text-xs text-zinc-500">{quien}</span>}
                      </div>
                      {f.nota && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">{f.nota}</p>}
                      <p className="mt-1 text-[11px] text-zinc-400">
                        Anotado el {formatDate(f.created_at)}
                        {f.recordar_el && f.estado === "pendiente" && <> · <span className={vence ? "font-semibold text-amber-700 dark:text-amber-300" : ""}><Clock className="inline h-3 w-3" /> {dormido ? "Recordar el" : "Para revisar desde el"} {formatDate(f.recordar_el)}</span></>}
                        {f.estado === "resuelto" && <> · Resuelto el {formatDate(f.resuelto_at || f.created_at)}{f.resolucion ? `: ${f.resolucion}` : ""}</>}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {destinoEntidad(f.entidad_tipo, f.entidad_id) && (
                        <button type="button" onClick={() => abrir(f.entidad_tipo, f.entidad_id)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"><ExternalLink className="h-3.5 w-3.5" /> Abrir</button>
                      )}
                      {f.estado === "pendiente" ? (<>
                        <button type="button" onClick={() => { setPosponiendo(posponiendo === f.id ? null : f.id); setResolviendo(null); setFechaPosponer(f.recordar_el && f.recordar_el > hoy ? f.recordar_el : ""); }}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"><Clock className="h-3.5 w-3.5" /> Posponer</button>
                        <button type="button" onClick={() => { setResolviendo(resolviendo === f.id ? null : f.id); setPosponiendo(null); setTextoResolucion(""); }}
                          className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"><Check className="h-3.5 w-3.5" /> Resuelto</button>
                      </>) : (
                        <button type="button" disabled={guardando === f.id} onClick={() => actualizar(f.id, { estado: "pendiente", resuelto_at: null, resuelto_por: null })}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"><RotateCcw className="h-3.5 w-3.5" /> Volver a pendiente</button>
                      )}
                    </div>
                  </div>
                  {resolviendo === f.id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input autoFocus value={textoResolucion} onChange={(e) => setTextoResolucion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void resolver(f.id); }}
                        placeholder="Qué se hizo (opcional)" className={`${inp} min-w-[16rem] flex-1`} />
                      <button type="button" disabled={guardando === f.id} onClick={() => resolver(f.id)} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                        {guardando === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Marcar resuelto"}</button>
                    </div>
                  )}
                  {posponiendo === f.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-zinc-500">Recordarme el</span>
                      <input type="date" min={hoy} value={fechaPosponer} onChange={(e) => setFechaPosponer(e.target.value)} className={inp} />
                      <button type="button" disabled={!fechaPosponer || guardando === f.id} onClick={() => posponer(f.id)} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Guardar</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* B) Lo que encontró el sistema */}
      <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Lo que encontró el sistema
            <Badge variant={hallazgosVisibles.length ? "warning" : "success"}>{hallazgosVisibles.length}</Badge>
          </h3>
          <span className="text-[11px] text-zinc-400">Solo avisa. Se actualiza solo.</span>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {hallazgosVisibles.length === 0 && <p className="p-6 text-center text-sm text-zinc-400">Nada raro por ahora.</p>}
          {hallazgosVisibles.map((h) => (
            <div key={h.clave} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-zinc-900 dark:text-white">{h.titulo}</span>
                  {h.importe != null && <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">{formatCurrency(h.importe, h.moneda)}</span>}
                </div>
                <p className="text-xs text-zinc-500">{h.detalle}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => abrir(h.entidad, h.entidad_id)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"><ExternalLink className="h-3.5 w-3.5" /> Abrir</button>
                {h.entidad_id && !faltaMigracion && (
                  <BotonDejarRevisar etiqueta="Anotar" onGuardado={cargar}
                    datos={{ entidad_tipo: h.entidad, entidad_id: h.entidad_id, titulo: h.titulo, motivo: h.tipo === "fecha_futura" ? "fecha_futura" : "otro", nota: h.detalle, importe: h.importe, moneda: h.moneda }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
