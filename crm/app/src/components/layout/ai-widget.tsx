"use client";

// Ayuda del CRM (botón flotante). Primero la guía, gratis y sin IA: lo de la pantalla donde estás + buscador.
// Si no alcanza, "Preguntarle a la IA" (solo consulta, con los permisos del usuario y tope mensual: /api/ai).
// Augusto (super_admin) además puede PEDIRLE cosas: la IA propone ANTES → DESPUÉS, él aprieta "Hacer"
// y queda en "Lo que hizo la IA" con Deshacer (/api/ai/acciones). Etapa 1 del asistente, 17/10/2026.

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LifeBuoy, X, Send, Loader2, Search, ArrowRight, Sparkles, ChevronDown, ChevronUp, ArrowLeft, Check, Undo2, History, AlertTriangle } from "lucide-react";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { buscarEnGuia, seccionesDePantalla, seccionesParaRol, rolPuedeVer, type SeccionGuia } from "@/lib/ayuda-busqueda";
import { FINANZAS_GRUPOS } from "@/lib/finanzas-grupos";
import { NOMBRE_TABLA, type Propuesta } from "@/lib/ia-acciones";

interface Message {
  role: "user" | "assistant";
  content: string;
  propuestas?: Propuesta[];
}

type EstadoPropuesta = { estado: "haciendo" | "hecha" | "descartada" | "error"; mensaje?: string; accionId?: string };
type AccionIA = { id: string; created_at: string; resumen: string; pedido: string | null; estado: "hecha" | "deshecha"; nota_deshacer: string | null };

const verValor = (v: unknown) => (v === null || v === undefined || v === "" ? "(vacío)" : String(v));

/** Vista previa ANTES → DESPUÉS con "Hacer" (y "Deshacer" una vez hecha). */
function TarjetaPropuesta({ p, est, onHacer, onDescartar, onDeshacer }: {
  p: Propuesta; est?: EstadoPropuesta; onHacer: () => void; onDescartar: () => void; onDeshacer: (id: string) => void;
}) {
  const hecha = est?.estado === "hecha";
  return (
    <div className={`rounded-lg border p-2.5 text-xs ${hecha ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20" : est?.estado === "descartada" ? "border-zinc-200 opacity-60 dark:border-zinc-700" : "border-violet-300 bg-white dark:border-violet-800 dark:bg-zinc-900"}`}>
      <p className="font-semibold text-zinc-800 dark:text-zinc-100">{p.tipo === "crear" ? "Agregar contacto" : NOMBRE_TABLA[p.tabla]} {p.titulo}</p>
      <div className="mt-1 space-y-0.5">
        {p.cambios.map((c) => (
          <div key={c.campo} className="grid grid-cols-[auto_1fr] gap-x-2">
            <span className="text-zinc-500">{c.etiqueta}</span>
            <span className="min-w-0 break-words">
              {p.tipo === "editar" && <><span className="text-zinc-400 line-through">{verValor(c.antes)}</span> → </>}
              <b className="text-zinc-800 dark:text-zinc-100">{verValor(c.despues)}</b>
            </span>
          </div>
        ))}
      </div>
      {p.avisos.map((a, i) => <p key={i} className="mt-1 flex items-start gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{a}</p>)}
      <div className="mt-2 flex items-center gap-2">
        {!est || est.estado === "error" ? (
          <>
            <button onClick={onHacer} className="flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 font-medium text-white hover:bg-violet-700"><Check className="h-3.5 w-3.5" /> Hacer</button>
            <button onClick={onDescartar} className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Descartar</button>
          </>
        ) : est.estado === "haciendo" ? (
          <span className="flex items-center gap-1 text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando…</span>
        ) : hecha ? (
          <>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">✓ {est.mensaje || "Hecho"}</span>
            {est.accionId && <button onClick={() => onDeshacer(est.accionId!)} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"><Undo2 className="h-3 w-3" /> Deshacer</button>}
          </>
        ) : <span className="text-zinc-500">{est.mensaje || "Descartada"}</span>}
      </div>
      {est?.estado === "error" && <p className="mt-1 text-red-600">{est.mensaje}</p>}
    </div>
  );
}

/** Negrita (**texto**) y renglones, sin librerías. */
function TextoGuia({ texto }: { texto: string }) {
  return (
    <div className="space-y-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
      {texto.replace(/ (\d\)) /g, "\n$1 ").replace(/ (\*\*Ojo:\*\*|Ojo:)/g, "\n$1").split("\n").filter((l) => l.trim()).map((l, i) => (
        <p key={i}>{l.split(/(\*\*[^*]+\*\*)/g).map((p, j): ReactNode => (/^\*\*[^*]+\*\*$/.test(p) ? <strong key={j}>{p.slice(2, -2)}</strong> : p))}</p>
      ))}
    </div>
  );
}

function TarjetaSeccion({ s, extracto, abierta: abiertaInicial = false, onIr }: { s: SeccionGuia; extracto?: string; abierta?: boolean; onIr: () => void }) {
  const [abierta, setAbierta] = useState(abiertaInicial);
  return (
    <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700">
      <div className="flex items-start gap-2">
        <button onClick={() => setAbierta((a) => !a)} className="min-w-0 flex-1 text-left">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">{s.grupo}</p>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{s.titulo}</p>
          {!abierta && extracto && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{extracto}</p>}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {s.ruta && (
            <Link href={s.ruta} onClick={onIr} title="Ir a la pantalla"
              className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/30">
              Ir <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          <button onClick={() => setAbierta((a) => !a)} className="rounded p-0.5 text-zinc-400 hover:text-zinc-600" title={abierta ? "Cerrar" : "Ver todo"}>
            {abierta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {abierta && <div className="mt-2"><TextoGuia texto={s.texto} /></div>}
    </div>
  );
}

/** Nombre visible de la pestaña de Finanzas abierta (de ?tab= o de la última usada). */
function pestanaFinanzas(): string | null {
  if (typeof window === "undefined") return null;
  let tab = new URLSearchParams(window.location.search).get("tab");
  if (!tab) {
    try { tab = (JSON.parse(window.localStorage.getItem("finanzas.ultimaPestana") || "null") || {}).tab || null; } catch { tab = null; }
  }
  for (const g of FINANZAS_GRUPOS) for (const t of g.tabs) if (t.id === tab) return t.label;
  return null;
}

export function AIWidget() {
  const { profile, role, sociedadActiva } = useUser();
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [modoIA, setModoIA] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [gasto, setGasto] = useState<{ gastoMes: number; topeMes: number } | null>(null);
  const [dato, setDato] = useState<{ titulo: string; lineas: string[] } | null>(null);
  const [cargandoDato, setCargandoDato] = useState(false);
  const [pestana, setPestana] = useState<string | null>(null);
  const [estados, setEstados] = useState<Record<string, EstadoPropuesta>>({});
  const [verHistorial, setVerHistorial] = useState(false);
  const [historial, setHistorial] = useState<AccionIA[] | null>(null);
  const [avisoHistorial, setAvisoHistorial] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Etapa 1: solo Augusto le puede pedir cosas a la IA.
  const puedeHacer = role === "super_admin";

  const misSecciones = useMemo(() => seccionesParaRol(role), [role]);
  const deEstaPantalla = useMemo(() => seccionesDePantalla(pathname, misSecciones, pestana), [pathname, misSecciones, pestana]);
  const resultados = useMemo(() => (busqueda.trim() ? buscarEnGuia(busqueda, misSecciones, 5) : []), [busqueda, misSecciones]);

  useEffect(() => {
    if (open) setPestana(pathname.startsWith("/finanzas") ? pestanaFinanzas() : null);
  }, [open, pathname]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function preguntarIA(content: string) {
    if (!content.trim() || loading) return;
    const userMessage: Message = { role: "user", content: content.trim() };
    const newMessages = [...messages, userMessage];
    setModoIA(true);
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const pantalla = [deEstaPantalla[0]?.titulo, pathname].filter(Boolean).join(" — ");
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(({ role: r, content: c }) => ({ role: r, content: c })),
          pantalla, sociedadId: sociedadActiva?.id, modo: puedeHacer ? "hacer" : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo consultar a la IA");
        return;
      }
      if (typeof data.gastoMes === "number") setGasto({ gastoMes: data.gastoMes, topeMes: data.topeMes });
      setMessages([...newMessages, { role: "assistant", content: data.response, propuestas: Array.isArray(data.propuestas) && data.propuestas.length ? data.propuestas : undefined }]);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  async function acciones(body: Record<string, unknown>) {
    const res = await fetch("/api/ai/acciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sociedadId: sociedadActiva?.id }) });
    return res.json().catch(() => ({ ok: false, mensaje: "Error de conexión." }));
  }

  async function hacer(p: Propuesta) {
    setEstados((e) => ({ ...e, [p.key]: { estado: "haciendo" } }));
    const r = await acciones({ op: "hacer", propuesta: p });
    setEstados((e) => ({ ...e, [p.key]: r.ok ? { estado: "hecha", mensaje: r.mensaje, accionId: r.accionId } : { estado: "error", mensaje: r.mensaje || r.error || "No se pudo." } }));
    if (r.ok) setHistorial(null);
  }

  async function deshacer(accionId: string) {
    const r = await acciones({ op: "deshacer", id: accionId });
    setEstados((e) => {
      const k = Object.keys(e).find((x) => e[x].accionId === accionId);
      return k ? { ...e, [k]: { estado: "descartada", mensaje: r.ok ? `↩ ${r.mensaje}` : r.mensaje } } : e;
    });
    if (!r.ok) setError(r.mensaje || "No se pudo deshacer.");
    await cargarHistorial();
  }

  async function cargarHistorial() {
    const r = await acciones({ op: "lista" });
    setHistorial(r.acciones || []);
    setAvisoHistorial(r.aviso || r.error || "");
  }

  // Atajos de datos SIN IA: consultas fijas con la sesión del usuario (ve solo lo que puede ver).
  async function resumenDelDia() {
    if (!sociedadActiva?.id) return;
    setCargandoDato(true);
    const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const db = supabase as any;
    const contar = async (tabla: string, campo: string) => {
      const { count } = await db.from(tabla).select("id", { count: "exact", head: true }).eq("sociedad_id", sociedadActiva.id).gte(campo, hoy);
      return count || 0;
    };
    const lineas: string[] = [];
    if (rolPuedeVer(role, "presupuestos")) lineas.push(`Presupuestos nuevos hoy: ${await contar("presupuestos", "created_at")}`);
    if (rolPuedeVer(role, "consulta_facturas")) lineas.push(`Facturas de venta de hoy: ${await contar("facturas", "fecha")}`);
    if (rolPuedeVer(role, "ordenes_compra")) lineas.push(`OC nuevas hoy: ${await contar("ordenes_compra", "created_at")}`);
    if (rolPuedeVer(role, "finanzas")) lineas.push(`Movimientos de plata de hoy: ${await contar("movimientos", "fecha")}`);
    setDato({ titulo: `Resumen de hoy (${sociedadActiva.nombre})`, lineas });
    setCargandoDato(false);
  }

  async function stockBajo() {
    if (!sociedadActiva?.id) return;
    setCargandoDato(true);
    const { data } = await (supabase as any).from("productos").select("codigo, nombre, stock, stock_minimo")
      .eq("sociedad_id", sociedadActiva.id).eq("activo", true).gt("stock_minimo", 0).limit(1000);
    const bajos = ((data as { codigo: string; nombre: string; stock: number; stock_minimo: number }[]) || [])
      .filter((p) => Number(p.stock) < Number(p.stock_minimo))
      .sort((a, b) => (Number(a.stock) - Number(a.stock_minimo)) - (Number(b.stock) - Number(b.stock_minimo)));
    setDato({
      titulo: `Stock bajo el mínimo (${bajos.length})`,
      lineas: bajos.length ? bajos.slice(0, 12).map((p) => `${p.codigo} · ${p.nombre}: ${p.stock} (mín. ${p.stock_minimo})`) : ["Nada por debajo del mínimo."],
    });
    setCargandoDato(false);
  }

  const cerrarYReset = () => setOpen(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-violet-500 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all"
        title="Ayuda"
      >
        <LifeBuoy className="h-6 w-6" />
      </button>
    );
  }

  const atajo = "whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300";

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 flex flex-col max-h-[640px]">
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          {modoIA ? (
            <button onClick={() => setModoIA(false)} className="rounded p-0.5 text-white/80 hover:bg-white/20" title="Volver a la Ayuda"><ArrowLeft className="h-4 w-4" /></button>
          ) : <LifeBuoy className="h-5 w-5 text-white" />}
          <span className="font-semibold text-white">{modoIA ? (verHistorial ? "Lo que hizo la IA" : puedeHacer ? "Preguntale o pedile algo" : "Preguntarle a la IA") : "Ayuda"}</span>
        </div>
        {modoIA && puedeHacer && (
          <button onClick={() => { const v = !verHistorial; setVerHistorial(v); if (v) void cargarHistorial(); }}
            className="ml-auto mr-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-white/80 hover:bg-white/20 hover:text-white" title="Lo que hizo la IA (con Deshacer)">
            <History className="h-3.5 w-3.5" /> {verHistorial ? "Volver" : "Historial"}
          </button>
        )}
        <button onClick={cerrarYReset} className="rounded-md p-1 text-white/70 hover:bg-white/20 hover:text-white"><X className="h-4 w-4" /></button>
      </div>

      {!modoIA ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
          {/* Buscador de la guía (gratis) */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
            <input autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="¿Qué necesitás hacer? (ej. cargar una NC)"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-8 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
          </div>

          {busqueda.trim() ? (
            <div className="space-y-2">
              {resultados.length === 0 && <p className="text-xs text-zinc-500">No encontré eso en la guía. Probá con otras palabras o preguntale a la IA.</p>}
              {resultados.map((r) => <TarjetaSeccion key={r.seccion.id} s={r.seccion} extracto={r.extracto} onIr={cerrarYReset} />)}
            </div>
          ) : (
            <>
              {deEstaPantalla.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">En esta pantalla</p>
                  {deEstaPantalla.slice(0, 3).map((s, i) => <TarjetaSeccion key={s.id} s={s} abierta={i === 0 && deEstaPantalla.length <= 2} onIr={cerrarYReset} />)}
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Atajos</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={resumenDelDia} className={atajo}>Resumen de hoy</button>
                  {rolPuedeVer(role, "stock") && <button onClick={stockBajo} className={atajo}>Stock bajo</button>}
                </div>
                {cargandoDato && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
                {dato && !cargandoDato && (
                  <div className="rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{dato.titulo}</p>
                    <ul className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">{dato.lineas.map((l, i) => <li key={i}>• {l}</li>)}</ul>
                  </div>
                )}
              </div>
            </>
          )}

          {/* IA: solo si la guía no alcanza */}
          <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <button onClick={() => (busqueda.trim() ? preguntarIA(busqueda) : setModoIA(true))}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-950/30">
              <Sparkles className="h-3.5 w-3.5" /> {puedeHacer ? "Preguntale o pedile algo a la IA" : "¿No alcanza? Preguntarle a la IA"}{busqueda.trim() ? " esto" : ""}
            </button>
            <p className="mt-1 text-center text-[10px] text-zinc-400">{puedeHacer ? "Te muestra antes → después: nada se guarda hasta que apretás Hacer, y todo tiene Deshacer." : "La IA solo consulta (no carga nada) y ve lo mismo que vos. Tiene un tope de gasto por mes."}</p>
          </div>
        </div>
      ) : verHistorial ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
          {historial === null && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
          {avisoHistorial && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{avisoHistorial}</p>}
          {historial?.length === 0 && !avisoHistorial && <p className="text-xs text-zinc-500">Todavía no hizo nada.</p>}
          {historial?.map((a) => (
            <div key={a.id} className={`rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-700 ${a.estado === "deshecha" ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-zinc-400">{new Date(a.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{a.estado === "deshecha" ? " · deshecha" : ""}</p>
                  <p className={`text-zinc-700 dark:text-zinc-200 ${a.estado === "deshecha" ? "line-through" : ""}`}>{a.resumen}</p>
                  {a.pedido && <p className="mt-0.5 line-clamp-1 text-zinc-400" title={a.pedido}>Pedido: {a.pedido}</p>}
                  {a.nota_deshacer && <p className="mt-0.5 text-amber-700 dark:text-amber-400">{a.nota_deshacer}</p>}
                </div>
                {a.estado === "hecha" && (
                  <button onClick={() => void deshacer(a.id)} className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"><Undo2 className="h-3 w-3" /> Deshacer</button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.length === 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Hola{profile?.full_name ? ` ${profile.full_name.split(" ")[0]}` : ""}. {puedeHacer
                  ? <>Preguntame algo o pedime que cambie algo (ej. &quot;cargale a Nexo el mail compras@nexo.com&quot; o &quot;en la OC-1229 llegó la mesa&quot;). Te muestro antes → después y lo guardás con <b>Hacer</b>.</>
                  : <>Preguntame cómo se hace algo o pedime un dato (ej. &quot;¿cuánto nos debe Del Sol?&quot;). Solo consulto: no cargo ni cambio nada.</>}
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : ""}`}>
                <div className={`rounded-lg p-3 max-w-[340px] text-sm whitespace-pre-wrap ${msg.role === "user" ? "bg-violet-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                  {msg.role === "assistant" ? <TextoGuia texto={msg.content} /> : msg.content}
                  {msg.propuestas && (
                    <div className="mt-2 space-y-2">
                      {msg.propuestas.map((p) => (
                        <TarjetaPropuesta key={p.key} p={p} est={estados[p.key]} onHacer={() => void hacer(p)}
                          onDescartar={() => setEstados((e) => ({ ...e, [p.key]: { estado: "descartada" } }))} onDeshacer={(id) => void deshacer(id)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin text-violet-500" /> Pensando…</div>
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">{error}</div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-700 shrink-0">
            <form onSubmit={(e) => { e.preventDefault(); preguntarIA(input); }} className="flex items-center gap-2">
              <input type="text" placeholder={puedeHacer ? "Preguntá o pedí algo..." : "Preguntá algo..."} value={input} onChange={(e) => setInput(e.target.value)} disabled={loading}
                className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800 disabled:opacity-50" />
              <button type="submit" disabled={loading || !input.trim()} className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed">
                <Send className="h-4 w-4" />
              </button>
            </form>
            <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
              {messages.length > 0 ? <button onClick={() => { setMessages([]); setError(""); }} className="hover:underline">Limpiar</button> : <span />}
              {gasto && !puedeHacer && <span>IA este mes: US$ {gasto.gastoMes.toFixed(2)} de {gasto.topeMes}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
