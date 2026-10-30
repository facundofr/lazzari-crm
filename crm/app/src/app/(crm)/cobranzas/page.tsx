"use client";

// Cobranzas (Augusto 29/10/2026): avisos de facturas de venta que vencen esta semana (recordatorio) y vencidas (reclamo),
// uno por cliente, con el mensaje predeterminado de lib/avisos-cobranza y los PDF de las facturas adjuntos.
// La ven super_admin y administrativo (como Finanzas). Sale de administracion@ y queda en Correos enviados
// (documento_tipo "aviso_cobranza", documento_id = cliente). Nada se envía solo: siempre se confirma antes.
// El saldo de cada factura es el de Finanzas > Facturas (traerFacturasFL). Solo lee la base; no guarda nada propio.
// Programar (Augusto 29/10): en la confirmación se puede elegir día y hora; Resend lo manda a esa hora y se puede cancelar antes.
// Filtro Sin mandar / Mandados / Todos (Augusto 30/10): abre en Sin mandar; mandado = aviso en los últimos 7 días o programado (avisoMandado).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, ChevronDown, ChevronRight, Clock, Loader2, RefreshCw, Send } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { todayAR } from "@/lib/utils";
import { traerFacturasFL } from "@/components/finanzas-lazza/datos";
import { avisoDePagoReciente } from "@/lib/correo-finanzas";
import { facturaPDFBase64 } from "@/lib/factura-pdf";
import { fechaHoraAR } from "@/lib/presupuesto-envios";
import { ETIQUETA_ESTADO, mananaALas9, programarPara, type EstadoMail } from "@/lib/correos-enviados";
import {
  armarAvisos, avisoMandado, destinatariosAviso, fmtFechaAviso, fmtMontoAviso, haceCuanto, mensajeAviso, separarMails, sumarDias, textoAHtml, totalTexto,
  type FacturaAviso, type GrupoAviso, type TipoAviso,
} from "@/lib/avisos-cobranza";

const db = supabase as any;
/** Tope de adjuntos por mail (el servidor no acepta pedidos muy grandes): lo que no entra se avisa. */
const TOPE_ADJUNTOS = 3_500_000;

type Borrador = { para: string; asunto: string; texto: string };
type InfoCliente = { email: string | null; para: string[]; diasCC: number };
type UltimoAviso = { id: string; fecha: string; estado: EstadoMail };
type Resultado = { ok: boolean; texto: string };

const PESTANAS: { id: TipoAviso; titulo: string }[] = [
  { id: "semana", titulo: "Vencen esta semana" },
  { id: "vencidas", titulo: "Vencidas" },
];

type FiltroEnvio = "sin_mandar" | "mandados" | "todos";
const FILTROS: { id: FiltroEnvio; titulo: string }[] = [
  { id: "sin_mandar", titulo: "Sin mandar" },
  { id: "mandados", titulo: "Mandados" },
  { id: "todos", titulo: "Todos" },
];

export default function CobranzasPage() {
  const { role, sociedadActiva, loading: cargandoUsuario } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;
  const hoy = todayAR();
  const [pestana, setPestana] = useState<TipoAviso>("vencidas");
  const [filtro, setFiltro] = useState<FiltroEnvio>("sin_mandar");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facturas, setFacturas] = useState<FacturaAviso[]>([]);
  const [clientes, setClientes] = useState<Map<string, InfoCliente>>(new Map());
  const [ultimos, setUltimos] = useState<Map<string, UltimoAviso>>(new Map());
  const [pagos, setPagos] = useState<{ fecha: string; estado: "mirar"; cliente: { nombre: string | null; cuit: string | null } }[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({});
  const [tildados, setTildados] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState<string[] | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [programar, setProgramar] = useState(() => mananaALas9(hoy));
  const [cancelando, setCancelando] = useState<string | null>(null);

  const cargarEnvios = useCallback(async () => {
    if (!sociedadId) return;
    const { data } = await db.from("mails_enviados").select("id, documento_id, enviado_at, estado")
      .eq("sociedad_id", sociedadId).eq("documento_tipo", "aviso_cobranza").neq("estado", "cancelado").order("enviado_at", { ascending: false }).limit(1000);
    const m = new Map<string, UltimoAviso>();
    for (const r of data || []) if (r.documento_id && !m.has(r.documento_id)) m.set(r.documento_id, { id: r.id, fecha: r.enviado_at, estado: r.estado });
    setUltimos(m);
  }, [sociedadId]);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setCargando(true);
    setError(null);
    try {
      const { filas } = await traerFacturasFL(sociedadId, "venta", hoy, false);
      // Con saldo y sin cobrar con cheque (el cheque sin acreditar ya es un cobro).
      const conSaldo = filas.filter((f) => f.entidadId && f.saldo >= 1 && !f.estado.startsWith("cheque_"));
      const ids = [...new Set(conSaldo.map((f) => f.entidadId as string))];
      const cli: any[] = [];
      const con: any[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const trozo = ids.slice(i, i + 150);
        const [c, k] = await Promise.all([
          db.from("clientes").select("id, cuit, email, dias_cuenta_corriente").in("id", trozo),
          db.from("contactos").select("entity_id, nombre, cargo, email").eq("entity_type", "cliente").in("entity_id", trozo),
        ]);
        if (c.error) throw c.error;
        cli.push(...(c.data || []));
        con.push(...(k.data || []));
      }
      const info = new Map<string, InfoCliente>();
      const cuits = new Map<string, string | null>();
      for (const c of cli) {
        info.set(c.id, { email: c.email || null, para: destinatariosAviso(con.filter((k) => k.entity_id === c.id), c.email), diasCC: Number(c.dias_cuenta_corriente || 0) });
        cuits.set(c.id, c.cuit || null);
      }
      setFacturas(conSaldo.map((f) => ({
        id: f.id, clienteId: f.entidadId as string, cliente: f.nombre, cuit: cuits.get(f.entidadId as string) ?? null, comprobante: f.comprobante,
        fecha: f.fecha, fechaVencimiento: f.sinVencimiento ? null : f.vence, saldo: f.saldo, moneda: f.moneda,
      })));
      setClientes(info);
      // Clientes que avisaron un pago por mail en los últimos 15 días (los leyó el agente de administracion@).
      const { data: mails } = await db.from("agente_mail_procesados").select("fecha_mail, datos")
        .eq("sociedad_id", sociedadId).eq("categoria", "pago_retencion").gte("fecha_mail", sumarDias(hoy, -15)).limit(500);
      setPagos((mails || []).filter((m: any) => m.datos?.pago && m.datos.pago.direccion !== "emitido").map((m: any) => ({
        fecha: String(m.datos.pago.fecha_pago || m.fecha_mail || hoy).slice(0, 10), estado: "mirar" as const,
        cliente: { nombre: m.datos.pago.cliente_nombre || null, cuit: m.datos.pago.cliente_cuit || null },
      })));
      await cargarEnvios();
    } catch (e: any) {
      setError(e?.message || "No se pudieron leer las facturas.");
    } finally {
      setCargando(false);
    }
  }, [sociedadId, hoy, cargarEnvios]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { setTildados(new Set()); setAbierto(null); setConfirmar(null); }, [pestana, filtro, sociedadId]);

  const avisos = useMemo(() => {
    const dias = new Map([...clientes].map(([id, c]) => [id, c.diasCC]));
    return armarAvisos(facturas, dias, hoy);
  }, [facturas, clientes, hoy]);
  const todosGrupos = avisos[pestana];
  const mandado = useCallback((g: GrupoAviso) => avisoMandado(ultimos.get(g.clienteId), hoy), [ultimos, hoy]);
  const cuentaFiltro = (f: FiltroEnvio) => f === "todos" ? todosGrupos.length : todosGrupos.filter((g) => mandado(g) === (f === "mandados")).length;
  const grupos = filtro === "todos" ? todosGrupos : todosGrupos.filter((g) => mandado(g) === (filtro === "mandados"));

  const nombreSociedad = sociedadActiva?.nombre || "Lazzari";
  const clave = (g: GrupoAviso) => `${g.tipo}:${g.clienteId}`;
  const borradorDe = useCallback((g: GrupoAviso): Borrador => {
    const b = borradores[clave(g)];
    if (b) return b;
    const { asunto, texto } = mensajeAviso(g, nombreSociedad);
    return { para: (clientes.get(g.clienteId)?.para || []).join(", "), asunto, texto };
  }, [borradores, clientes, nombreSociedad]);
  const editar = (g: GrupoAviso, cambio: Partial<Borrador>) => setBorradores((b) => ({ ...b, [clave(g)]: { ...borradorDe(g), ...cambio } }));
  const avisoPago = (g: GrupoAviso) => avisoDePagoReciente({ nombre: g.cliente, cuit: g.cuit }, pagos, hoy);

  async function enviarUno(g: GrupoAviso, programadoPara?: string): Promise<Resultado> {
    const b = borradorDe(g);
    const para = separarMails(b.para);
    if (!para.length) return { ok: false, texto: "No tiene mail: escribilo en Para." };
    if (!sociedadActiva) return { ok: false, texto: "Elegí una sociedad." };
    const pdfs: { filename: string; base64: string }[] = [];
    let afuera = 0;
    let largo = 0;
    for (const f of g.facturas) {
      const pdf = await facturaPDFBase64(f.id, sociedadActiva);
      if (pdfs.length && largo + pdf.base64.length > TOPE_ADJUNTOS) { afuera++; continue; }
      largo += pdf.base64.length;
      pdfs.push(pdf);
    }
    const res = await fetch("/api/email/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: para, subject: b.asunto, bodyHtml: textoAHtml(b.texto),
        pdfBase64: pdfs[0].base64, pdfFilename: pdfs[0].filename, pdfsExtra: pdfs.slice(1),
        sociedadId: sociedadActiva.id, documentType: "aviso_cobranza", documentId: g.clienteId, programadoPara,
      }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok || !r.success) return { ok: false, texto: r.error || "No se pudo enviar." };
    const que = r.programado ? `Programado para el ${fechaHoraAR(r.programado)} a` : "Enviado a";
    return { ok: true, texto: `${que} ${para.join(", ")}${afuera ? ` (${afuera} PDF no entraron en el mail: mandalos aparte)` : ""}${r.avisoRegistro ? `. ${r.avisoRegistro}` : ""}` };
  }

  async function enviar(claves: string[], programadoPara?: string) {
    setConfirmar(null);
    let bien = 0;
    for (const [i, k] of claves.entries()) {
      const g = grupos.find((x) => clave(x) === k);
      if (!g) continue;
      setEnviando(`${g.cliente} (${i + 1} de ${claves.length})`);
      let r: Resultado;
      try { r = await enviarUno(g, programadoPara); } catch (e: any) { r = { ok: false, texto: e?.message || "No se pudo enviar." }; }
      if (r.ok) bien++;
      setResultados((x) => ({ ...x, [k]: r }));
    }
    setEnviando(null);
    setTildados(new Set());
    await cargarEnvios();
    if (bien === claves.length) toast.success(programadoPara ? `${bien === 1 ? "Aviso programado" : `${bien} avisos programados`} para el ${fechaHoraAR(programadoPara)}` : bien === 1 ? "Aviso enviado" : `${bien} avisos enviados`);
    else toast.error(`${programadoPara ? "Se programaron" : "Se enviaron"} ${bien} de ${claves.length}: mirá los que dicen por qué no salieron`);
  }

  const horaProgramada = programarPara(programar.fecha, programar.hora);

  async function cancelarProgramado(id: string) {
    setCancelando(id);
    try {
      const res = await fetch("/api/email/cancelar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.ok) toast.error(r.error || "No se pudo cancelar");
      else toast.success("Envío programado cancelado");
    } finally {
      setCancelando(null);
      await cargarEnvios();
    }
  }

  const totales = (t: TipoAviso) => {
    const gs = avisos[t];
    const total = { ARS: 0, USD: 0 };
    for (const g of gs) { total.ARS += g.total.ARS; total.USD += g.total.USD; }
    return `${gs.length} ${gs.length === 1 ? "cliente" : "clientes"} · ${totalTexto(total)}`;
  };
  const tildables = grupos.filter((g) => separarMails(borradorDe(g).para).length > 0);

  if (cargandoUsuario) return <Header title="Cobranzas" />;
  if (role !== "super_admin" && role !== "administrativo") {
    return (
      <div>
        <Header title="Cobranzas" />
        <p className="px-4 py-10 text-center text-sm text-zinc-500">No tenés acceso a esta pantalla.</p>
      </div>
    );
  }

  return (
    <>
      <Header title="Cobranzas" subtitle="Avisos de facturas que vencen esta semana y vencidas" />
      <div className="p-3 sm:p-4">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <BellRing className="h-5 w-5 text-zinc-500" />
            {PESTANAS.map((p) => (
              <button key={p.id} onClick={() => setPestana(p.id)}
                className={`rounded-lg px-3 h-8 text-sm ${pestana === p.id ? "bg-orange-50 font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300" : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                {p.titulo} <span className="font-normal text-zinc-500">· {cargando ? "…" : totales(p.id)}</span>
              </button>
            ))}
            <button onClick={() => void cargar()} disabled={cargando} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 h-8 px-3 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
            </button>
          </div>

          {!cargando && todosGrupos.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
              <span className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
                {FILTROS.map((f) => (
                  <button key={f.id} onClick={() => setFiltro(f.id)}
                    title={f.id === "mandados" ? "Con aviso en los últimos 7 días o programado" : f.id === "sin_mandar" ? "Sin aviso en los últimos 7 días (o el último rebotó)" : ""}
                    className={`rounded-md px-2.5 h-7 text-sm ${filtro === f.id ? "bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-white" : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                    {f.titulo} <span className="font-normal text-zinc-500">{cuentaFiltro(f.id)}</span>
                  </button>
                ))}
              </span>
              <label className="inline-flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" checked={tildables.length > 0 && tildables.every((g) => tildados.has(clave(g)))}
                  onChange={(e) => setTildados(e.target.checked ? new Set(tildables.map(clave)) : new Set())} />
                Tildar todos los que tienen mail
              </label>
              <button onClick={() => setConfirmar([...tildados])} disabled={!tildados.size || !!enviando}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-orange-600 h-8 px-3 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-40">
                <Send className="h-4 w-4" /> Enviar {tildados.size ? `los ${tildados.size}` : ""}
              </button>
            </div>
          )}

          {confirmar && (
            <div className="border-b border-orange-200 bg-orange-50 px-3 py-2 text-sm dark:border-orange-900 dark:bg-orange-950/40">
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Se van a mandar {confirmar.length} {confirmar.length === 1 ? "mail" : "mails"} desde administracion@lazzari.com.ar:</p>
              <ul className="my-1 space-y-0.5 text-zinc-700 dark:text-zinc-300">
                {confirmar.map((k) => {
                  const g = grupos.find((x) => clave(x) === k);
                  if (!g) return null;
                  return <li key={k}>• <b>{g.cliente}</b> → {separarMails(borradorDe(g).para).join(", ") || <span className="text-red-600">sin mail</span>} · {g.facturas.length} PDF</li>;
                })}
              </ul>
              <div className="flex gap-2">
                <button onClick={() => void enviar(confirmar)} className="rounded-lg bg-orange-600 h-8 px-3 font-medium text-white hover:bg-orange-700">Confirmar y enviar</button>
                <button onClick={() => setConfirmar(null)} className="rounded-lg border border-zinc-300 h-8 px-3 text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 border-l border-orange-200 pl-3 dark:border-orange-900">
                  <span className="text-zinc-600 dark:text-zinc-300">o programalo para</span>
                  <input type="date" value={programar.fecha} min={hoy} onChange={(e) => setProgramar((p) => ({ ...p, fecha: e.target.value }))}
                    className="rounded-lg border border-zinc-300 bg-white h-8 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                  <input type="time" value={programar.hora} onChange={(e) => setProgramar((p) => ({ ...p, hora: e.target.value }))}
                    className="rounded-lg border border-zinc-300 bg-white h-8 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                  <button onClick={() => { if ("iso" in horaProgramada) void enviar(confirmar, horaProgramada.iso); }} disabled={!("iso" in horaProgramada)}
                    title={"error" in horaProgramada ? horaProgramada.error : ""}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-orange-600 h-8 px-3 font-medium text-orange-700 hover:bg-white disabled:opacity-40 dark:text-orange-300">
                    <Clock className="h-4 w-4" /> Programar
                  </button>
                  {"error" in horaProgramada && <span className="text-xs text-red-600">{horaProgramada.error}</span>}
                </span>
              </div>
            </div>
          )}
          {enviando && <p className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"><Loader2 className="h-4 w-4 animate-spin" /> Enviando a {enviando}…</p>}

          {error ? <p className="p-4 text-sm text-red-600">{error}</p> : cargando ? <p className="p-4 text-sm text-zinc-500">Cargando...</p> : !sociedadId ? (
            <p className="p-4 text-sm text-zinc-500">Elegí una sociedad.</p>
          ) : todosGrupos.length > 0 && grupos.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">{filtro === "sin_mandar" ? "A todos se les mandó un aviso en los últimos 7 días." : "Todavía no se le mandó a ninguno en los últimos 7 días."}</p>
          ) : grupos.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">{pestana === "semana" ? "No hay facturas que venzan esta semana." : "No hay facturas vencidas sin cobrar."}</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {grupos.map((g) => {
                const k = clave(g);
                const b = borradorDe(g);
                const para = separarMails(b.para);
                const ult = ultimos.get(g.clienteId);
                const pago = avisoPago(g);
                const res = resultados[k];
                const ab = abierto === k;
                return (
                  <li key={k} className={`px-3 py-1.5 ${pago ? "bg-zinc-50/60 dark:bg-zinc-900/40" : ""}`}>
                    <div className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={tildados.has(k)} disabled={!para.length}
                        title={para.length ? "" : "No tiene mail: abrilo y escribilo en Para"}
                        onChange={(e) => setTildados((t) => { const n = new Set(t); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                      <button onClick={() => setAbierto(ab ? null : k)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                        {ab ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />}
                        <span className={`truncate font-medium ${pago ? "text-zinc-500" : "dark:text-white"}`}>{g.cliente}</span>
                        <span className="shrink-0 text-zinc-500">· {g.facturas.length} fact. · {totalTexto(g.total)} · {pestana === "vencidas" ? `vencida desde ${fmtFechaAviso(g.facturas[0].vence).slice(0, 5)}` : `vence ${fmtFechaAviso(g.facturas[0].vence).slice(0, 5)}`}</span>
                      </button>
                      {pago && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">avisó un pago el {fmtFechaAviso(pago).slice(0, 5)}: esperá</span>}
                      {ult?.estado === "programado" && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                          <Clock className="h-3 w-3" /> programado para el {fechaHoraAR(ult.fecha).slice(0, 5)} {fechaHoraAR(ult.fecha).slice(11)}
                          <button onClick={() => void cancelarProgramado(ult.id)} disabled={cancelando === ult.id} className="ml-1 font-medium underline disabled:opacity-50">{cancelando === ult.id ? "cancelando…" : "Cancelar"}</button>
                        </span>
                      )}
                      {ult && ult.estado !== "programado" && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${ult.estado === "rebotado" || ult.estado === "spam" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>último aviso {haceCuanto(ult.fecha, hoy)} · {ETIQUETA_ESTADO[ult.estado]?.toLowerCase() || ult.estado}</span>}
                      {!para.length && <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">sin mail</span>}
                    </div>
                    {res && <p className={`ml-6 text-xs ${res.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>{res.texto}</p>}
                    {ab && (
                      <div className="ml-6 mt-1.5 space-y-1.5 pb-1.5">
                        <ul className="text-xs text-zinc-600 dark:text-zinc-300">
                          {g.facturas.map((f) => (
                            <li key={f.id}>
                              <Link href={`/facturas?factura=${f.id}`} className="text-orange-600 hover:underline">{f.comprobante}</Link>
                              {" "}del {fmtFechaAviso(f.fecha)} · {f.dias < 0 ? `venció el ${fmtFechaAviso(f.vence)} (${-f.dias} d)` : f.dias === 0 ? "vence hoy" : `vence el ${fmtFechaAviso(f.vence)}`}
                              {!f.fechaVencimiento && <span className="text-zinc-400"> (sin vto: fecha + días de cuenta corriente)</span>} · {fmtMontoAviso(f.saldo, f.moneda)}
                            </li>
                          ))}
                        </ul>
                        <label className="block text-xs text-zinc-500">Para
                          <input value={b.para} onChange={(e) => editar(g, { para: e.target.value })} placeholder="mail@cliente.com, otro@cliente.com"
                            className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white h-8 px-2 text-sm text-zinc-800 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                        </label>
                        <label className="block text-xs text-zinc-500">Asunto
                          <input value={b.asunto} onChange={(e) => editar(g, { asunto: e.target.value })}
                            className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white h-8 px-2 text-sm text-zinc-800 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                        </label>
                        <label className="block text-xs text-zinc-500">Mensaje
                          <textarea value={b.texto} onChange={(e) => editar(g, { texto: e.target.value })} rows={Math.min(16, b.texto.split("\n").length + 1)}
                            className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                        </label>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-xs text-zinc-500">Se adjuntan {g.facturas.length} PDF · sale de administracion@lazzari.com.ar</span>
                          {borradores[k] && <button onClick={() => setBorradores((x) => { const n = { ...x }; delete n[k]; return n; })} className="text-xs text-zinc-500 hover:underline">Volver al mensaje original</button>}
                          <button onClick={() => setConfirmar([k])} disabled={!para.length || !!enviando}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-orange-600 h-8 px-3 font-medium text-white hover:bg-orange-700 disabled:opacity-40">
                            <Send className="h-4 w-4" /> Enviar a este cliente
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!cargando && todosGrupos.length > 0 && <p className="border-t border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800">Nada se envía solo: siempre se confirma antes (al confirmar se puede programar para otro día y hora). Cada envío queda en <Link href="/correos" className="text-orange-600 hover:underline">Correos enviados</Link>. Los que avisaron un pago en los últimos 15 días se marcan para esperar.</p>}
        </Card>
      </div>
    </>
  );
}
