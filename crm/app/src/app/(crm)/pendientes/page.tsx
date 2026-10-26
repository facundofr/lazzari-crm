"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { ROLE_PERMISSIONS, type Role } from "@/lib/types";
import {
  AREAS_PENDIENTES, agruparPendientes, linkInterno, textoRespuestas,
  type PendienteItem, type PendienteTipo,
} from "@/lib/pendientes";
import { ArrowRight, Check, ClipboardCopy, Loader2, Plus, AlertTriangle, MessageSquare, Wrench } from "lucide-react";

type Atraso = { id: string; label: string; count: number; href: string };
type RevisarAbierto = { id: string; titulo: string; recordar_el: string | null };

const COLS_NUEVAS = "id, texto, area, tipo, link, respuesta, completado, fecha_vencimiento, created_at";
const COLS_VIEJAS = "id, texto, completado, fecha_vencimiento, created_at";

function puede(role: Role, module: string): boolean {
  return (ROLE_PERMISSIONS[role] || []).some((p) => p.module === "*" || p.module === module);
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PendientesPage() {
  const { profile, role, sociedadActiva } = useUser();
  const { toast } = useToast();
  const [items, setItems] = useState<PendienteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [verHechos, setVerHechos] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<"" | PendienteTipo>("");
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null);
  const [atrasos, setAtrasos] = useState<Atraso[] | null>(null);
  const [revisar, setRevisar] = useState<RevisarAbierto[]>([]);
  // Alta rápida
  const [nuevoTexto, setNuevoTexto] = useState("");
  const [nuevoArea, setNuevoArea] = useState<string>(AREAS_PENDIENTES[0]);
  const [nuevoTipo, setNuevoTipo] = useState<PendienteTipo>("hacer");
  const [agregando, setAgregando] = useState(false);

  const userId = profile?.id;
  const sociedadId = sociedadActiva?.id;

  const cargarPendientes = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const db = supabase as any;
    const consulta = (cols: string) => {
      let q = db.from("pendientes").select(cols).eq("user_id", userId).order("created_at", { ascending: true });
      if (sociedadId) q = q.eq("sociedad_id", sociedadId);
      return q;
    };
    let { data, error } = await consulta(COLS_NUEVAS);
    if (error && /column|respuesta|area|tipo|link/i.test(error.message || "")) {
      setFaltaMigracion(true);
      ({ data, error } = await consulta(COLS_VIEJAS));
    } else {
      setFaltaMigracion(false);
    }
    if (error) toast.error(`No se pudieron cargar los pendientes: ${error.message}`);
    setItems(((data as any[]) || []).map((r) => ({
      area: null, tipo: "hacer", link: null, respuesta: null, ...r,
    })) as PendienteItem[]);
    setLoading(false);
  }, [userId, sociedadId, toast]);

  // Atrasos que cuenta el sistema (solo lo que el rol puede ver) + lo abierto en Finanzas > Revisar.
  const cargarAtrasos = useCallback(async () => {
    if (!sociedadId) return;
    const db = supabase as any;
    const hoy = hoyISO();
    const contar = async (q: any): Promise<number> => {
      const { count, error } = await q;
      return error ? 0 : count || 0;
    };
    const tareas: Promise<Atraso | null>[] = [];
    if (puede(role, "finanzas")) {
      // 26/10/2026 (Finanzas simple): las transferencias del banco quedan sin cruzar a propósito (cobros y pagos los carga Augusto),
      // así que "Líneas del extracto sin cruzar" ya no es un atraso y se sacó. El banco se mira en Finanzas > Bancos.
      tareas.push(contar(db.from("facturas_compra").select("id", { count: "exact", head: true }).eq("sociedad_id", sociedadId)
        .not("estado", "in", "(anulada,pagada)").lt("fecha_vencimiento", hoy))
        .then((n) => ({ id: "fc", label: "Facturas de compra vencidas sin pagar", count: n, href: "/finanzas?seccion=pagar" })));
      tareas.push(contar(db.from("facturas").select("id", { count: "exact", head: true }).eq("sociedad_id", sociedadId)
        .in("estado", ["emitida", "parcial", "vencida"]).lt("fecha_vencimiento", hoy))
        .then((n) => ({ id: "fv", label: "Facturas de venta vencidas sin cobrar", count: n, href: "/finanzas?seccion=cobrar" })));
    }
    // "OC sin factura del proveedor" se sacó (Augusto 19/10): las facturas de compra ya no se atan a la OC.
    if (puede(role, "presupuestos")) {
      tareas.push(contar(db.from("presupuestos").select("id", { count: "exact", head: true }).eq("sociedad_id", sociedadId).eq("estado", "solicitud"))
        .then((n) => ({ id: "pr", label: "Presupuestos en \"Solicitud\" sin armar", count: n, href: "/presupuestos" })));
    }
    const res = await Promise.all(tareas.map((t) => t.catch(() => null)));
    setAtrasos(res.filter((a): a is Atraso => !!a));

    if (puede(role, "finanzas")) {
      const { data } = await db.from("finanzas_revisar").select("id, titulo, recordar_el")
        .eq("sociedad_id", sociedadId).eq("estado", "pendiente").order("created_at", { ascending: true });
      setRevisar((data as RevisarAbierto[]) || []);
    } else {
      setRevisar([]);
    }
  }, [sociedadId, role]);

  useEffect(() => { cargarPendientes(); }, [cargarPendientes]);
  useEffect(() => { cargarAtrasos(); }, [cargarAtrasos]);

  const visibles = useMemo(
    () => items.filter((p) => p.completado === verHechos && (!filtroTipo || (p.tipo || "hacer") === filtroTipo)),
    [items, verHechos, filtroTipo],
  );
  const grupos = useMemo(() => agruparPendientes(visibles), [visibles]);
  const abiertos = items.filter((p) => !p.completado);
  const nResponder = abiertos.filter((p) => p.tipo === "responder").length;
  const nRespondidos = abiertos.filter((p) => (p.respuesta || "").trim()).length;

  async function toggleHecho(p: PendienteItem) {
    const { error } = await (supabase as any).from("pendientes").update({ completado: !p.completado }).eq("id", p.id);
    if (error) { toast.error(`No se pudo guardar: ${error.message}`); return; }
    setItems((prev) => prev.map((i) => (i.id === p.id ? { ...i, completado: !p.completado } : i)));
  }

  async function guardarRespuesta(p: PendienteItem) {
    const nueva = borradores[p.id];
    if (nueva === undefined || nueva === (p.respuesta || "")) return;
    setGuardando(p.id);
    const { error } = await (supabase as any).from("pendientes").update({ respuesta: nueva.trim() || null }).eq("id", p.id);
    setGuardando(null);
    if (error) { toast.error(`No se guardó la respuesta: ${error.message}`); return; }
    setItems((prev) => prev.map((i) => (i.id === p.id ? { ...i, respuesta: nueva.trim() || null } : i)));
    setGuardadoOk(p.id);
    setTimeout(() => setGuardadoOk((g) => (g === p.id ? null : g)), 1500);
  }

  async function copiarRespuestas() {
    // Incluye lo que está escrito aunque todavía no se haya guardado.
    const conBorradores = items.map((p) => (borradores[p.id] !== undefined ? { ...p, respuesta: borradores[p.id] } : p));
    const texto = textoRespuestas(conBorradores, { sociedad: sociedadActiva?.nombre });
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Copiado. Pegalo en el chat con Claude.");
    } catch {
      toast.error("No se pudo copiar. Probá de nuevo.");
    }
  }

  async function agregar() {
    if (!nuevoTexto.trim() || !userId) return;
    setAgregando(true);
    const fila: Record<string, unknown> = { user_id: userId, texto: nuevoTexto.trim(), completado: false };
    if (sociedadId) fila.sociedad_id = sociedadId;
    if (!faltaMigracion) { fila.area = nuevoArea; fila.tipo = nuevoTipo; }
    const { error } = await (supabase as any).from("pendientes").insert(fila);
    setAgregando(false);
    if (error) { toast.error(`No se pudo agregar: ${error.message}`); return; }
    setNuevoTexto("");
    cargarPendientes();
  }

  const atrasosConAlgo = (atrasos || []).filter((a) => a.count > 0);

  return (
    <div>
      <Header title="Pendientes" subtitle={`${abiertos.length} abiertos · ${nResponder} para responder · ${nRespondidos} con respuesta`} />

      <div className="px-3 sm:px-4 py-2 space-y-3 max-w-5xl">
        {faltaMigracion && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Falta correr la migración de Pendientes: por ahora no se pueden guardar respuestas ni ver las áreas.
          </div>
        )}

        {/* Atrasos que cuenta el sistema */}
        {(atrasosConAlgo.length > 0 || revisar.length > 0) && (
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1.5">Atrasos que cuenta el sistema</h2>
            <div className="flex flex-wrap gap-1.5">
              {atrasosConAlgo.map((a) => (
                <Link key={a.id} href={a.href}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <span className="font-semibold tabular-nums text-orange-600">{a.count}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{a.label}</span>
                  <ArrowRight className="h-3 w-3 text-zinc-400" />
                </Link>
              ))}
            </div>
            {revisar.length > 0 && (
              <div className="mt-2">
                {/* 26/10/2026: Finanzas vieja (donde estaba Revisar) se cerró; las notas se siguen mostrando acá. */}
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Anotado para revisar ({revisar.length})</p>
                <ul className="mt-1 space-y-0.5">
                  {revisar.map((r) => (
                    <li key={r.id} className="text-xs text-zinc-600 dark:text-zinc-400 truncate">• {r.titulo}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Barra */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5 text-xs">
            {([["", "Todo"], ["hacer", "Para hacer"], ["responder", "Para responder"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setFiltroTipo(v)}
                className={`px-2.5 py-1 rounded-md ${filtroTipo === v ? "bg-white dark:bg-zinc-700 shadow-sm font-medium" : "text-zinc-500"}`}>{l}</button>
            ))}
          </div>
          <button onClick={() => setVerHechos((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 underline-offset-2 hover:underline">
            {verHechos ? "Ver abiertos" : `Ver hechos (${items.length - abiertos.length})`}
          </button>
          <button onClick={copiarRespuestas} disabled={faltaMigracion}
            title="Copia todos los pendientes abiertos con lo que respondiste, para pegarlo en el chat con Claude"
            className="ml-auto flex h-8 items-center gap-1.5 px-3 text-sm font-semibold rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50">
            <ClipboardCopy className="h-4 w-4" /> Copiar respuestas
          </button>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
        ) : grupos.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">{verHechos ? "Todavía no hay nada hecho." : "No hay pendientes. ¡Al día!"}</p>
        ) : grupos.map((g) => (
          <section key={g.area}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">{g.area} <span className="text-zinc-400">({g.items.length})</span></h2>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
              {g.items.map((p) => {
                const href = linkInterno(p.link);
                const responder = p.tipo === "responder";
                const valor = borradores[p.id] ?? p.respuesta ?? "";
                return (
                  <li key={p.id} className="flex items-start gap-2 px-2.5 py-1.5">
                    <button onClick={() => toggleHecho(p)} title={p.completado ? "Volver a abrir" : "Marcar como hecho"}
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${p.completado ? "bg-green-600 border-green-600 text-white" : "border-zinc-300 dark:border-zinc-600 hover:border-green-500"}`}>
                      {p.completado && <Check className="h-3 w-3" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-1.5">
                        <span title={responder ? "Para responder" : "Para hacer"} className={`mt-0.5 shrink-0 ${responder ? "text-blue-500" : "text-zinc-400"}`}>
                          {responder ? <MessageSquare className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
                        </span>
                        <span className={`text-sm ${p.completado ? "line-through text-zinc-400" : "text-zinc-800 dark:text-zinc-200"}`}>{p.texto}</span>
                      </div>
                      {!faltaMigracion && !p.completado && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <textarea rows={1} value={valor}
                            placeholder={responder ? "Respuesta…" : "Nota / respuesta (opcional)"}
                            onChange={(e) => setBorradores((b) => ({ ...b, [p.id]: e.target.value }))}
                            onBlur={() => guardarRespuesta(p)}
                            onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; }}
                            className="w-full resize-none rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500" />
                          <span className="w-4 shrink-0">
                            {guardando === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                              : guardadoOk === p.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : null}
                          </span>
                        </div>
                      )}
                      {p.completado && p.respuesta && <p className="mt-0.5 text-xs text-zinc-500">→ {p.respuesta}</p>}
                    </div>
                    {href && (
                      <Link href={href} title="Ir a la pantalla donde se hace"
                        className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/20">
                        Ir <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {/* Alta rápida */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <input value={nuevoTexto} onChange={(e) => setNuevoTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") agregar(); }}
            placeholder="Agregar un pendiente…"
            className="h-8 min-w-[220px] flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500" />
          {!faltaMigracion && (
            <>
              <select value={nuevoArea} onChange={(e) => setNuevoArea(e.target.value)}
                className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-xs">
                {AREAS_PENDIENTES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value as PendienteTipo)}
                className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-xs">
                <option value="hacer">Para hacer</option>
                <option value="responder">Para responder</option>
              </select>
            </>
          )}
          <button onClick={agregar} disabled={!nuevoTexto.trim() || agregando}
            className="flex h-8 items-center gap-1 rounded-lg border border-orange-500 px-3 text-sm font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-50 dark:hover:bg-orange-950/20">
            {agregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
