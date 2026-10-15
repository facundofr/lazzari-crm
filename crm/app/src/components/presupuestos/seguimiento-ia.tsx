"use client";

/**
 * Presupuestos nuevo > Seguimiento. Los PR pendientes y vencidos en tres grupos: Hoy toca / Esperando / Vencidos.
 * Por cada uno: la IA (Opus 5.5) escribe el mensaje y se manda con 1 clic (mail desde tu programa de correo o WhatsApp),
 * y se anota el resultado (aprobó / pidió cambios / no contestó / se perdió / posponer). Todo queda en presupuesto_seguimiento.
 * Nunca frena nada y nunca manda solo: el mensaje sale desde tu mail o tu WhatsApp.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Check, ExternalLink, Loader2, Mail, MessageCircle, RefreshCw, Sparkles, Undo2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { linkWhatsApp } from "@/lib/saldo-proveedores";
import { leerDolaresGuardados } from "@/lib/dolar-presupuesto";
import {
  clasificarPR, compararSeguimiento, sumarDias, haceDias, fechaAR, MOTIVOS_PERDIDO, CANAL_TEXTO, DIAS_ENTRE_CONTACTOS,
  type EventoSeg, type GrupoSeg, type ClasificacionSeg,
} from "@/lib/presupuesto-seguimiento";

const db = supabase as any;

type PR = {
  id: string; numero: string; fecha: string; vencimiento: string | null; estado: string; enviado_at: string | null;
  total: number; moneda: string; cliente_id: string | null; vendedor_id: string | null; created_by: string | null; tipo_cambio: number | null;
  clientes: { razon_social: string; email: string | null; telefono: string | null } | null;
  contacto: { nombre: string | null; email: string | null; telefono: string | null; whatsapp: string | null } | null;
  vendedor_profile: { full_name: string | null } | null;
  creador: { full_name: string | null } | null;
  observaciones: string | null;
  presupuesto_items: Array<{ descripcion: string; cantidad: number; precio_venta: number | null }> | null;
};
type Mensaje = { asunto: string; cuerpo: string; whatsapp: string };

const GRUPOS: Array<{ k: GrupoSeg; titulo: string; ayuda: string; color: string }> = [
  { k: "hoy", titulo: "Hoy toca", ayuda: "Les toca un seguimiento hoy o ya pasaron los días", color: "text-orange-600" },
  { k: "esperando", titulo: "Esperando", ayuda: "Ya se los contactó o todavía no toca", color: "text-zinc-600 dark:text-zinc-300" },
  { k: "vencido", titulo: "Vencidos", ayuda: "Pasó la fecha de validez sin respuesta", color: "text-red-600" },
];

export default function SeguimientoIA() {
  const router = useRouter();
  const { profile, sociedadActiva, role } = useUser();
  const { toast } = useToast();
  const hoy = todayAR();

  const [prs, setPrs] = useState<PR[]>([]);
  const [eventos, setEventos] = useState<EventoSeg[]>([]);
  const [cargando, setCargando] = useState(true);
  const [tablaOk, setTablaOk] = useState(true);
  const [error, setError] = useState("");
  const [tc, setTc] = useState(0);
  const esAdmin = role === "super_admin" || role === "admin";
  const [verTodos, setVerTodos] = useState(esAdmin);
  const [verViejos, setVerViejos] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [vendedorF, setVendedorF] = useState("");
  const [operadorF, setOperadorF] = useState("");
  const [mensajes, setMensajes] = useState<Record<string, Mensaje>>({});
  const [generando, setGenerando] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ id: string; tipo: "perdido" | "posponer" } | null>(null);
  const [motivo, setMotivo] = useState<string>(MOTIVOS_PERDIDO[0]);
  const [motivoTxt, setMotivoTxt] = useState("");
  const [dias, setDias] = useState(3);
  const [ocupado, setOcupado] = useState<string | null>(null);
  useEffect(() => { setVerTodos(esAdmin); }, [esAdmin]);

  const cargar = useCallback(async () => {
    if (!sociedadActiva?.id) return;
    setCargando(true); setError("");
    try {
      const filas = await traerTodo<PR>(() => db.from("presupuestos")
        .select("id, numero, fecha, vencimiento, estado, enviado_at, total, moneda, cliente_id, vendedor_id, created_by, tipo_cambio, clientes(razon_social, email, telefono), contacto:contacto_id(nombre, email, telefono, whatsapp), vendedor_profile:vendedor_id(full_name), creador:created_by(full_name), observaciones, presupuesto_items(descripcion, cantidad, precio_venta)")
        .eq("sociedad_id", sociedadActiva.id).in("estado", ["pendiente", "vencido"]).or("eliminado.is.null,eliminado.eq.false").order("fecha", { ascending: true }));
      setPrs(filas);
      let evs: EventoSeg[] = [];
      if (filas.length) {
        const ids = filas.map(f => f.id);
        for (let i = 0; i < ids.length; i += 100) {
          const { data, error: e2 } = await db.from("presupuesto_seguimiento").select("*").in("presupuesto_id", ids.slice(i, i + 100)).order("created_at", { ascending: false });
          if (e2) {
            if (e2.code === "42P01" || /does not exist|schema cache/i.test(e2.message || "")) { setTablaOk(false); evs = []; break; }
            throw e2;
          }
          evs = evs.concat(data || []);
        }
      }
      setEventos(evs);
      try { const g = await leerDolaresGuardados(supabase); setTc(g.billete?.valor || g.divisa?.valor || 0); } catch { /* solo para ordenar */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el seguimiento");
    } finally { setCargando(false); }
  }, [sociedadActiva?.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const items = useMemo(() => {
    const porPR = new Map<string, EventoSeg[]>();
    for (const e of eventos) { const l = porPR.get(e.presupuesto_id) || []; l.push(e); porPR.set(e.presupuesto_id, l); }
    return prs
      .filter(p => verTodos || p.created_by === profile?.id || p.vendedor_id === profile?.id)
      .filter(p => (!vendedorF || p.vendedor_id === vendedorF) && (!operadorF || p.created_by === operadorF))
      .map(p => {
        const c = clasificarPR(p, porPR.get(p.id) || [], hoy);
        const montoPesos = p.moneda === "USD" ? Number(p.total) * (Number(p.tipo_cambio) > 0 ? Number(p.tipo_cambio) : tc || 1500) : Number(p.total);
        return { p, c, evs: porPR.get(p.id) || [], montoPesos };
      })
      .filter(x => verViejos || x.c.grupo !== "vencido" || x.c.diasVencido <= 60)
      .sort((a, b) => compararSeguimiento({ ...a.c, montoPesos: a.montoPesos }, { ...b.c, montoPesos: b.montoPesos }));
  }, [prs, eventos, verTodos, verViejos, vendedorF, operadorF, profile?.id, hoy, tc]);
  const vendedoresOpc = useMemo(() => [...new Map(prs.filter(p => p.vendedor_id).map(p => [p.vendedor_id as string, p.vendedor_profile?.full_name || "Sin nombre"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es")), [prs]);
  const operadoresOpc = useMemo(() => [...new Map(prs.filter(p => p.created_by).map(p => [p.created_by as string, p.creador?.full_name || "Sin nombre"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es")), [prs]);
  const viejosOcultos = useMemo(() => prs.filter(p => (p.estado === "vencido" || (p.vencimiento && p.vencimiento < hoy)) && fechaAR(p.vencimiento) && Math.round((Date.parse(hoy) - Date.parse(fechaAR(p.vencimiento))) / 86400000) > 60).length, [prs, hoy]);

  // ── anotar hechos ──
  async function anotar(p: PR, fila: Partial<EventoSeg>, aviso?: string): Promise<EventoSeg | null> {
    if (!tablaOk) { toast.error("Falta correr la migración del seguimiento (se la pasan a Augusto)"); return null; }
    const { data, error: e } = await db.from("presupuesto_seguimiento").insert({ sociedad_id: sociedadActiva?.id, presupuesto_id: p.id, ...fila }).select("*").single();
    if (e) { toast.error(`No se pudo anotar: ${e.message}`); return null; }
    setEventos(prev => [data as EventoSeg, ...prev]);
    if (aviso) toast.success(aviso);
    return data as EventoSeg;
  }
  async function deshacerEvento(ev: EventoSeg) {
    setOcupado(ev.id);
    const { error: e } = await db.from("presupuesto_seguimiento").delete().eq("id", ev.id);
    setOcupado(null);
    if (e) { toast.error(`No se pudo deshacer: ${e.message}`); return; }
    setEventos(prev => prev.filter(x => x.id !== ev.id));
    toast.info("Deshecho");
  }

  // ── mensaje con IA ──
  async function abrirMensaje(p: PR, c: ClasificacionSeg) {
    if (abierto === p.id) { setAbierto(null); return; }
    setAbierto(p.id); setPanel(null);
    if (mensajes[p.id]) return;
    setGenerando(p.id);
    try {
      const res = await fetch("/api/presupuestos/seguimiento-mensaje", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: p.numero, estado: p.estado === "vencido" || c.grupo === "vencido" ? "vencido" : "pendiente", cliente: p.clientes?.razon_social, contacto: p.contacto?.nombre,
          total: formatCurrency(Number(p.total), p.moneda === "USD" ? "USD" : "ARS"), diasEnviado: c.diasEnviado, vencimiento: p.vencimiento ? formatDate(p.vencimiento) : "",
          contactosPrevios: c.contactos, ultimoCanal: c.ultimoContacto?.canal ? CANAL_TEXTO[c.ultimoContacto.canal] : "",
          items: (p.presupuesto_items || []).map(i => `${i.cantidad} × ${i.descripcion}`), vendedor: profile?.full_name || p.vendedor_profile?.full_name || "", empresa: sociedadActiva?.razonSocial,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "La IA no pudo escribir el mensaje");
      setMensajes(m => ({ ...m, [p.id]: { asunto: d.asunto, cuerpo: d.cuerpo, whatsapp: d.whatsapp } }));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Error inesperado"); setAbierto(null); }
    finally { setGenerando(null); }
  }
  const setMsg = (id: string, cambios: Partial<Mensaje>) => setMensajes(m => ({ ...m, [id]: { ...m[id], ...cambios } }));

  async function mandarMail(p: PR) {
    const m = mensajes[p.id]; if (!m) return;
    const para = p.contacto?.email || p.clientes?.email || "";
    if (!para) toast.info("Este cliente no tiene mail cargado: poné la dirección en tu programa de correo");
    window.open(`mailto:${encodeURIComponent(para).replace(/%40/g, "@").replace(/%2C/g, ",")}?subject=${encodeURIComponent(m.asunto)}&body=${encodeURIComponent(m.cuerpo)}`, "_self");
    await anotar(p, { tipo: "contacto", canal: "mail", proxima_fecha: sumarDias(hoy, DIAS_ENTRE_CONTACTOS) }, `Anotado: mail a ${p.clientes?.razon_social || "el cliente"}. Próximo seguimiento en ${DIAS_ENTRE_CONTACTOS} días.`);
  }
  async function mandarWhatsApp(p: PR) {
    const m = mensajes[p.id]; if (!m) return;
    const base = linkWhatsApp(p.contacto?.whatsapp || p.contacto?.telefono || p.clientes?.telefono);
    if (!base) { toast.error("No hay un celular válido cargado para este contacto"); return; }
    window.open(`${base}?text=${encodeURIComponent(m.whatsapp)}`, "_blank");
    await anotar(p, { tipo: "contacto", canal: "whatsapp", proxima_fecha: sumarDias(hoy, DIAS_ENTRE_CONTACTOS) }, `Anotado: WhatsApp a ${p.clientes?.razon_social || "el cliente"}. Próximo seguimiento en ${DIAS_ENTRE_CONTACTOS} días.`);
  }

  // ── resultados ──
  const abrirPR = (id: string) => router.push(`/presupuestos?selected=${id}`);
  async function resultado(p: PR, r: "aprobo" | "pidio_cambios" | "no_contesto") {
    const prox = r === "no_contesto" ? sumarDias(hoy, DIAS_ENTRE_CONTACTOS) : r === "pidio_cambios" ? sumarDias(hoy, 2) : null;
    const ev = await anotar(p, { tipo: "resultado", resultado: r, proxima_fecha: prox }, r === "no_contesto" ? `Anotado: no contestó. Próximo seguimiento en ${DIAS_ENTRE_CONTACTOS} días.` : undefined);
    if (!ev) return;
    if (r === "aprobo") { toast.info("Abrí el presupuesto y aprobalo ahí: así se arman las OC como siempre."); abrirPR(p.id); }
    if (r === "pidio_cambios") { toast.info("Abrí el presupuesto para editarlo con lo que pidió."); abrirPR(p.id); }
  }
  async function confirmarPerdido(p: PR) {
    setOcupado(p.id);
    const texto = `${motivo}${motivoTxt.trim() ? `: ${motivoTxt.trim()}` : ""}`;
    const { data, error: e } = await db.from("presupuestos").update({ estado: "rechazado", motivo_rechazo: texto, respondido_at: new Date().toISOString() }).eq("id", p.id).select("id");
    if (e || !data?.length) { setOcupado(null); toast.error(e ? `No se pudo: ${e.message}` : "No se pudo cambiar: ese PR es de otro vendedor"); return; }
    await anotar(p, { tipo: "resultado", resultado: "perdido", detalle: texto });
    setOcupado(null); setPanel(null); setMotivoTxt("");
    setPrs(prev => prev.filter(x => x.id !== p.id));
    toast.success(`${p.numero} quedó como perdido (${texto})`);
  }
  async function posponer(p: PR) {
    const ev = await anotar(p, { tipo: "posponer", proxima_fecha: sumarDias(hoy, dias) }, `Te lo vuelvo a mostrar en ${dias} días`);
    if (ev) setPanel(null);
  }
  async function extender(p: PR) {
    setOcupado(p.id);
    const nuevo = sumarDias(hoy, 15);
    const { data, error: e } = await db.from("presupuestos").update({ vencimiento: nuevo, estado: "pendiente" }).eq("id", p.id).select("id");
    if (e || !data?.length) { setOcupado(null); toast.error(e ? `No se pudo: ${e.message}` : "No se pudo extender: ese PR es de otro vendedor"); return; }
    await anotar(p, { tipo: "extension", detalle: `Validez extendida hasta ${nuevo}`, proxima_fecha: sumarDias(hoy, 2) });
    setOcupado(null);
    setPrs(prev => prev.map(x => (x.id === p.id ? { ...x, vencimiento: nuevo, estado: "pendiente" } : x)));
    toast.success(`${p.numero}: válido hasta ${formatDate(nuevo)}`);
  }

  const total = (g: GrupoSeg) => items.filter(x => x.c.grupo === g);
  const sumaPesos = (g: GrupoSeg) => total(g).reduce((s, x) => s + x.montoPesos, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900">
        <CalendarClock className="h-4 w-4 text-orange-500" />
        <span className="dark:text-zinc-200"><b className="text-orange-600">{total("hoy").length}</b> toca hoy · <b>{total("esperando").length}</b> esperando · <b className="text-red-600">{total("vencido").length}</b> vencidos</span>
        <span className="ml-auto flex items-center gap-3">
          <select value={vendedorF} onChange={e => setVendedorF(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"><option value="">Todos los vendedores</option>{vendedoresOpc.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <select value={operadorF} onChange={e => setOperadorF(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"><option value="">Todos los operadores</option>{operadoresOpc.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <label className="flex items-center gap-1 text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={verTodos} onChange={e => setVerTodos(e.target.checked)} /> Ver los de todos</label>
          <button onClick={() => void cargar()} disabled={cargando} className="flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:text-zinc-200"><RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} /> Actualizar</button>
        </span>
      </div>
      {!tablaOk && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">⚠️ Falta correr la migración del seguimiento (<code>20261016110000_presupuesto_seguimiento</code>). Mientras tanto se ve la lista, pero no se puede anotar nada.</p>}
      {error && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {error}</p>}
      {cargando && !prs.length && <p className="flex items-center gap-2 text-sm text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>}

      {GRUPOS.map(g => {
        const lista = total(g.k);
        if (!lista.length && g.k !== "hoy") return null;
        return (
          <section key={g.k} className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-baseline gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <h3 className={`text-sm font-semibold ${g.color}`}>{g.titulo} ({lista.length})</h3>
              <span className="text-[11px] text-zinc-400">{g.ayuda}</span>
              {lista.length > 0 && <span className="ml-auto text-[11px] text-zinc-500">≈ {formatCurrency(sumaPesos(g.k), "ARS")} sin IVA</span>}
            </div>
            {!lista.length && <p className="p-4 text-center text-xs text-zinc-400">{cargando ? "…" : "Nada para hoy. 👌"}</p>}
            {lista.map(({ p, c, evs }) => {
              const nombre = p.clientes?.razon_social || "Cliente";
              const ultimo = evs[0];
              const puedeDeshacer = !!ultimo && ultimo.user_id === profile?.id && Date.now() - Date.parse(ultimo.created_at) < 86400000;
              return (
                <div key={p.id} className="border-b border-zinc-100 px-3 py-2 last:border-0 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs dark:text-zinc-200">
                    <button onClick={() => abrirPR(p.id)} className="flex items-center gap-1 font-semibold text-orange-600 hover:underline">{p.numero}<ExternalLink className="h-3 w-3" /></button>
                    <span className="min-w-[160px] flex-1 truncate font-medium">{nombre}{p.contacto?.nombre ? <span className="ml-1 font-normal text-zinc-400">· {p.contacto.nombre}</span> : null}</span>
                    <span className="whitespace-nowrap font-semibold">{formatCurrency(Number(p.total), p.moneda === "USD" ? "USD" : "ARS")}</span>
                    <span className={`whitespace-nowrap ${c.diasEnviado >= 7 ? "font-semibold text-red-600" : c.diasEnviado >= 5 ? "text-amber-600" : "text-zinc-500"}`}>enviado {haceDias(c.diasEnviado)}</span>
                    <span className="whitespace-nowrap text-zinc-500">{c.ultimoContacto ? `último: ${CANAL_TEXTO[c.ultimoContacto.canal || "otro"] || "contacto"} ${haceDias(c.diasDesdeContacto ?? 0)}` : "sin contactos"}</span>
                    {g.k === "vencido" ? <span className="whitespace-nowrap font-medium text-red-600">venció {haceDias(c.diasVencido)}</span> : g.k === "esperando" ? <span className="whitespace-nowrap text-zinc-500">toca {formatDate(c.proxima)}</span> : c.atraso > 0 ? <span className="whitespace-nowrap font-medium text-orange-600">{c.atraso} {c.atraso === 1 ? "día" : "días"} de atraso</span> : null}
                    <span className="whitespace-nowrap text-zinc-500" title="Vendedor y operador (quien cargó el PR)">Vendedor: <b className="font-medium text-zinc-700 dark:text-zinc-200">{p.vendedor_profile?.full_name || "—"}</b> · Operador: <b className="font-medium text-zinc-700 dark:text-zinc-200">{p.creador?.full_name || "—"}</b></span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <button onClick={() => setDetalle(detalle === p.id ? null : p.id)} className={`rounded border px-2 py-1 ${detalle === p.id ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30" : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200"}`}>{detalle === p.id ? "Cerrar detalle" : "Ver qué es"}</button>
                    <button onClick={() => void abrirMensaje(p, c)} className={`flex items-center gap-1 rounded px-2 py-1 font-medium ${abierto === p.id ? "bg-orange-600 text-white" : "bg-orange-500 text-white hover:bg-orange-600"}`}>
                      {generando === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Mensaje con IA
                    </button>
                    <button onClick={() => void resultado(p, "aprobo")} className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300">Aprobó</button>
                    <button onClick={() => void resultado(p, "pidio_cambios")} className="rounded border border-sky-300 px-2 py-1 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300">Pidió cambios</button>
                    <button onClick={() => void resultado(p, "no_contesto")} className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200">No contestó</button>
                    <button onClick={() => { setPanel(panel?.id === p.id && panel.tipo === "perdido" ? null : { id: p.id, tipo: "perdido" }); setAbierto(null); }} className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300">Se perdió</button>
                    <button onClick={() => { setPanel(panel?.id === p.id && panel.tipo === "posponer" ? null : { id: p.id, tipo: "posponer" }); setAbierto(null); }} className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200">Posponer</button>
                    {g.k === "vencido" && <>
                      <button onClick={() => void extender(p)} disabled={ocupado === p.id} className="rounded border border-violet-300 px-2 py-1 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300">Extender 15 días</button>
                      <button onClick={() => abrirPR(p.id)} className="rounded border border-violet-300 px-2 py-1 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300">Actualizar precios</button>
                    </>}
                    {puedeDeshacer && <button onClick={() => void deshacerEvento(ultimo)} disabled={ocupado === ultimo.id} className="ml-auto flex items-center gap-1 text-zinc-500 hover:text-orange-600"><Undo2 className="h-3 w-3" /> Deshacer lo último</button>}
                  </div>

                  {detalle === p.id && (
                    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
                      <table className="w-full">
                        <tbody>
                          {(p.presupuesto_items || []).map((it, k) => (
                            <tr key={k} className="border-b border-zinc-100 last:border-0 dark:border-zinc-700 dark:text-zinc-200">
                              <td className="w-14 py-1 pr-2 text-right font-medium">{Number(it.cantidad).toLocaleString("es-AR")}</td>
                              <td className="py-1">{it.descripcion}</td>
                              <td className="whitespace-nowrap py-1 pl-2 text-right text-zinc-500">{it.precio_venta ? formatCurrency(Number(it.precio_venta), p.moneda === "USD" ? "USD" : "ARS") : "sin precio"}</td>
                            </tr>
                          ))}
                          {!(p.presupuesto_items || []).length && <tr><td className="py-1 text-zinc-400">Sin renglones</td></tr>}
                        </tbody>
                      </table>
                      {p.observaciones && <p className="mt-1 text-zinc-500">Obs.: {p.observaciones}</p>}
                      <p className="mt-1 text-[10px] text-zinc-400">Enviado {p.enviado_at ? formatDate(p.enviado_at) : formatDate(p.fecha)} · vence {p.vencimiento ? formatDate(p.vencimiento) : "—"} · <button onClick={() => abrirPR(p.id)} className="text-orange-600 hover:underline">abrir el PR completo</button></p>
                    </div>
                  )}
                  {abierto === p.id && mensajes[p.id] && (
                    <div className="mt-2 space-y-2 rounded-lg border border-orange-200 bg-orange-50/50 p-2 dark:border-orange-900 dark:bg-orange-950/20">
                      <input value={mensajes[p.id].asunto} onChange={e => setMsg(p.id, { asunto: e.target.value })} className="w-full rounded border border-zinc-200 px-2 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                      <textarea value={mensajes[p.id].cuerpo} onChange={e => setMsg(p.id, { cuerpo: e.target.value })} rows={7} className="w-full rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => void mandarMail(p)} className="flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white"><Mail className="h-3.5 w-3.5" /> Mail (se abre tu correo)</button>
                        <span className="text-[10px] text-zinc-400">para {p.contacto?.email || p.clientes?.email || "— sin mail —"}</span>
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-zinc-500">Versión para WhatsApp</summary>
                        <textarea value={mensajes[p.id].whatsapp} onChange={e => setMsg(p.id, { whatsapp: e.target.value })} rows={4} className="mt-1 w-full rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        <button onClick={() => void mandarWhatsApp(p)} className="mt-1 flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</button>
                      </details>
                      <p className="text-[10px] text-zinc-400">Sale desde tu mail o tu WhatsApp, vos lo mandás. Al apretar se anota el contacto (podés deshacerlo).</p>
                    </div>
                  )}
                  {panel?.id === p.id && panel.tipo === "perdido" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 p-2 text-xs dark:border-red-900 dark:bg-red-950/20">
                      <span className="font-medium">¿Por qué se perdió?</span>
                      <select value={motivo} onChange={e => setMotivo(e.target.value)} className="rounded border border-zinc-300 px-1 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">{MOTIVOS_PERDIDO.map(m => <option key={m}>{m}</option>)}</select>
                      <input value={motivoTxt} onChange={e => setMotivoTxt(e.target.value)} placeholder="Detalle (opcional)" className="min-w-[160px] flex-1 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                      <button onClick={() => void confirmarPerdido(p)} disabled={ocupado === p.id} className="flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 font-medium text-white">{ocupado === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Dar de baja</button>
                      <span className="text-[10px] text-zinc-400">Pasa a Rechazado con ese motivo.</span>
                    </div>
                  )}
                  {panel?.id === p.id && panel.tipo === "posponer" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
                      <span className="font-medium">Volver a mostrármelo en</span>
                      <select value={dias} onChange={e => setDias(Number(e.target.value))} className="rounded border border-zinc-300 px-1 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">{[1, 2, 3, 5, 7, 14, 30].map(d => <option key={d} value={d}>{d} {d === 1 ? "día" : "días"}</option>)}</select>
                      <button onClick={() => void posponer(p)} className="rounded bg-zinc-700 px-2.5 py-1 font-medium text-white">Posponer</button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {viejosOcultos > 0 && !verViejos && <button onClick={() => setVerViejos(true)} className="text-xs text-zinc-500 underline">Ver también {viejosOcultos} vencidos de hace más de 60 días</button>}
    </div>
  );
}
