"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { CATEGORIAS_MAIL, armarReclamoCobranza, etiquetaFactura, ordenCategoria, type FacturaVencida } from "@/lib/agente-mail";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, Loader2, Mail, Paperclip, RefreshCw, RotateCcw } from "lucide-react";

type MailFila = {
  id: string; fecha_mail: string | null; remitente: string | null; asunto: string | null; categoria: string; prioridad: string;
  resumen: string | null; accion_sugerida: string | null; datos: any; adjuntos: { nombre: string; metodo: string }[] | null;
  visto_at: string | null; error: string | null;
};
type Corrida = { id: string; inicio: string; mails_nuevos: number; pendientes_restantes: number; costo_usd: number; resumen: string | null; error: string | null };
type Reclamo = { clienteId: string; cliente: string; email: string | null; facturas: FacturaVencida[]; total: number; asunto: string; texto: string };

const fmt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const nombreRemitente = (r: string | null) => (r || "").replace(/<.*>/, "").replace(/"/g, "").trim() || "—";

export default function MailCobrosPage() {
  const { role, sociedadActiva } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;
  const permitido = (ROLE_PERMISSIONS[role] || []).some((p) => p.module === "*" || p.module === "finanzas");

  const [mails, setMails] = useState<MailFila[]>([]);
  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [reclamos, setReclamos] = useState<Reclamo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [verVistos, setVerVistos] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [verReclamos, setVerReclamos] = useState(false);
  const [reclamoAbierto, setReclamoAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setCargando(true);
    const db = supabase as any;
    const { data: m, error: e1 } = await db.from("agente_mail_procesados")
      .select("id, fecha_mail, remitente, asunto, categoria, prioridad, resumen, accion_sugerida, datos, adjuntos, visto_at, error")
      .eq("sociedad_id", sociedadId).order("fecha_mail", { ascending: false }).limit(400);
    if (e1 && /agente_mail|relation|does not exist/i.test(e1.message || "")) { setFaltaMigracion(true); setCargando(false); return; }
    setFaltaMigracion(false);
    setMails((m as MailFila[]) || []);
    const { data: c } = await db.from("agente_mail_corridas").select("*").not("fin", "is", null).order("inicio", { ascending: false }).limit(1);
    setCorrida(((c as Corrida[]) || [])[0] || null);
    await cargarReclamos(db);
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sociedadId]);

  // Reclamos de cobranza sugeridos: facturas de venta abiertas y vencidas, por cliente. Solo un borrador para copiar.
  async function cargarReclamos(db: any) {
    const hoy = new Date();
    const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
    const { data: fs } = await db.from("facturas")
      .select("id, tipo, punto_venta, numero, cliente_id, fecha, fecha_vencimiento, total, total_acreditado, moneda, clientes(razon_social, email, dias_cuenta_corriente)")
      .eq("sociedad_id", sociedadId).in("estado", ["emitida", "parcial", "vencida"]).limit(2000);
    const ids = ((fs as any[]) || []).map((f) => f.id);
    const aplicado = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: ap } = await db.from("cobro_aplicaciones").select("factura_id, monto").in("factura_id", ids.slice(i, i + 200));
      for (const a of ap || []) aplicado.set(a.factura_id, (aplicado.get(a.factura_id) || 0) + Number(a.monto || 0));
    }
    const porCliente = new Map<string, Reclamo>();
    for (const f of (fs as any[]) || []) {
      const venc = f.fecha_vencimiento || (() => {
        const d = new Date(`${String(f.fecha).slice(0, 10)}T12:00:00`);
        d.setDate(d.getDate() + Number(f.clientes?.dias_cuenta_corriente || 0));
        return d.toISOString().slice(0, 10);
      })();
      const saldo = Math.max(0, Number(f.total) - (aplicado.get(f.id) || 0) - Number(f.total_acreditado || 0));
      if (saldo < 0.01 || venc >= hoyISO) continue;
      const k = f.cliente_id;
      const reg: Reclamo = porCliente.get(k) || { clienteId: k, cliente: f.clientes?.razon_social || "Cliente", email: f.clientes?.email || null, facturas: [], total: 0, asunto: "", texto: "" };
      reg.facturas.push({ etiqueta: etiquetaFactura(f), fecha: String(f.fecha), vencimiento: venc, saldo, moneda: f.moneda });
      reg.total += f.moneda === "USD" ? 0 : saldo;
      porCliente.set(k, reg);
    }
    const lista = [...porCliente.values()].map((r) => {
      r.facturas.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
      const { asunto, texto } = armarReclamoCobranza(r.cliente, r.facturas, sociedadActiva?.nombre || "Lazzari", hoy);
      return { ...r, asunto, texto } as Reclamo;
    }).sort((a, b) => b.total - a.total);
    setReclamos(lista);
  }

  useEffect(() => { cargar(); }, [cargar]);

  async function ejecutar(cuerpo: { releer?: boolean; ids?: string[] }) {
    setEjecutando(true);
    try {
      const r = await fetch("/api/agente-mail/ejecutar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(j.error || j.resumen || "No se pudo revisar el correo");
      else toast.success(j.resumen || "Listo");
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo revisar el correo");
    }
    setEjecutando(false);
  }

  async function marcarVistos(ids: string[]) {
    if (!ids.length) return;
    const { error } = await (supabase as any).from("agente_mail_procesados").update({ visto_at: new Date().toISOString() }).in("id", ids);
    if (error) { toast.error(`No se pudo marcar: ${error.message}`); return; }
    setMails((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, visto_at: new Date().toISOString() } : m)));
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); toast.success("Copiado"); } catch { toast.error("No se pudo copiar"); }
  }

  const visibles = useMemo(() => mails.filter((m) => verVistos || !m.visto_at), [mails, verVistos]);
  const grupos = useMemo(() => {
    const g = new Map<string, MailFila[]>();
    for (const m of visibles) g.set(m.categoria, [...(g.get(m.categoria) || []), m]);
    return [...g.entries()].sort((a, b) => ordenCategoria(a[0]) - ordenCategoria(b[0]));
  }, [visibles]);
  const sinVer = mails.filter((m) => !m.visto_at).length;

  if (!permitido) return <div className="p-6 text-sm text-gray-500">Tu usuario no tiene acceso a esta pantalla.</div>;

  return (
    <div>
      <Header title="Mail y cobros" subtitle="Sugerencias del correo de administración. No se registra ni se envía nada solo." />
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        {faltaMigracion && <p className="text-sm text-amber-700">Falta correr la migración del agente (20261015100000_agente_mail).</p>}

        {/* Una sola línea de estado + acciones */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
          <span className="min-w-0 flex-1 truncate" title={corrida?.resumen || ""}>
            {corrida ? <>Última revisión {fmtFechaHora(corrida.inicio)} · {corrida.error ? "con error" : `${corrida.mails_nuevos} mails`}{corrida.pendientes_restantes > 0 ? ` · faltan leer ${corrida.pendientes_restantes}` : ""}</> : "Sin revisiones todavía (lun-vie 8:30, 12:30 y 16:00)"}
          </span>
          <label className="flex items-center gap-1"><input type="checkbox" checked={verVistos} onChange={(e) => setVerVistos(e.target.checked)} /> ver vistos</label>
          {sinVer > 0 && <button onClick={() => marcarVistos(mails.filter((m) => !m.visto_at).map((m) => m.id))} className="hover:text-gray-900 hover:underline">Marcar todos vistos</button>}
          <button onClick={() => ejecutar({})} disabled={ejecutando || faltaMigracion} className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {ejecutando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Revisar ahora
          </button>
        </div>

        {/* Mails */}
        <section>
          <h2 className="mb-1 text-sm font-semibold">Para mirar <span className="font-normal text-gray-500">{sinVer ? `· ${sinVer} sin ver` : ""}</span></h2>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : grupos.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">Nada para mirar.</p>
          ) : grupos.map(([cat, filas]) => (
            <div key={cat} className="mb-4">
              <div className="mb-0.5 flex items-center justify-between border-b border-gray-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <span>{CATEGORIAS_MAIL.find((c) => c.id === cat)?.label || "Otros"} · {filas.length}</span>
                {filas.some((f) => !f.visto_at) && <button onClick={() => marcarVistos(filas.filter((f) => !f.visto_at).map((f) => f.id))} className="font-normal normal-case hover:text-gray-900 hover:underline">marcar vistos</button>}
              </div>
              <ul className="divide-y divide-gray-100">
                {filas.map((m) => {
                  const cruce = m.datos?.cruce, pago = m.datos?.pago, abierta = abierto === m.id;
                  return (
                    <li key={m.id} className={m.visto_at ? "opacity-50" : ""}>
                      <div className="flex items-start gap-2 py-1.5">
                        <button onClick={() => setAbierto(abierta ? null : m.id)} className="mt-0.5 text-gray-400 hover:text-gray-700" aria-label="Ver detalle">
                          {abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setAbierto(abierta ? null : m.id)}>
                          <p className="truncate text-sm">
                            {m.prioridad === "alta" && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" title="Urgente" />}
                            <span className="font-medium">{m.asunto || "(sin asunto)"}</span>
                            <span className="text-gray-500"> · {nombreRemitente(m.remitente)} · {fmtFechaHora(m.fecha_mail)}</span>
                          </p>
                          {(m.accion_sugerida || m.resumen) && <p className={abierta ? "text-sm text-gray-700" : "truncate text-xs text-gray-600"}>{m.accion_sugerida || m.resumen}</p>}
                          {abierta && (
                            <div className="mt-1 space-y-1 text-xs text-gray-600">
                              {m.accion_sugerida && m.resumen && <p>{m.resumen}</p>}
                              {pago && (pago.monto_neto || pago.monto_total) && (
                                <p>Pago: neto {pago.monto_neto ? `$ ${fmt(Number(pago.monto_neto))}` : "—"}{pago.retenciones_total ? ` · retenciones $ ${fmt(Number(pago.retenciones_total))}` : ""}{cruce?.confianza ? ` · cruce ${cruce.confianza}` : ""}</p>
                              )}
                              {cruce?.notas?.length > 0 && <p className="text-amber-700">{cruce.notas.join(" ")}</p>}
                              {m.adjuntos?.length ? <p className="flex items-center gap-1"><Paperclip className="h-3 w-3" /> {m.adjuntos.map((a) => `${a.nombre}${a.metodo === "revisar_a_mano" ? " (revisar a mano)" : ""}`).join(", ")}</p> : null}
                              {m.error && <p className="text-red-600">{m.error}</p>}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button onClick={() => ejecutar({ ids: [m.id] })} disabled={ejecutando} title="Volver a leer este mail" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /></button>
                          {!m.visto_at && <button onClick={() => marcarVistos([m.id])} title="Marcar como visto" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-green-600"><Check className="h-4 w-4" /></button>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        {/* Reclamos de cobranza: cerrado por defecto */}
        <section>
          <button onClick={() => setVerReclamos(!verReclamos)} className="flex w-full items-center gap-1 border-b border-gray-200 pb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {verReclamos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Reclamos de cobranza sugeridos · {reclamos.length} clientes con facturas vencidas
          </button>
          {verReclamos && (reclamos.length === 0 ? <p className="py-3 text-sm text-gray-500">No hay facturas vencidas sin cobrar.</p> : (
            <ul className="divide-y divide-gray-100">
              {reclamos.map((r) => {
                const abierta = reclamoAbierto === r.clienteId;
                return (
                  <li key={r.clienteId} className="py-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <button onClick={() => setReclamoAbierto(abierta ? null : r.clienteId)} className="min-w-0 flex-1 truncate text-left">
                        <span className="font-medium">{r.cliente}</span>
                        <span className="text-gray-500"> · {r.facturas.length} fact. · $ {fmt(r.total)}{r.facturas.some((f) => f.moneda === "USD") ? " + USD" : ""}</span>
                      </button>
                      <button onClick={() => copiar(r.texto)} title="Copiar el mensaje" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><ClipboardCopy className="h-4 w-4" /></button>
                      {r.email && <a href={`mailto:${r.email}?subject=${encodeURIComponent(r.asunto)}&body=${encodeURIComponent(r.texto)}`} title="Abrir en mi correo" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Mail className="h-4 w-4" /></a>}
                    </div>
                    {abierta && <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2 font-sans text-xs text-gray-700">{r.texto}</pre>}
                  </li>
                );
              })}
            </ul>
          ))}
          {verReclamos && reclamos.length > 0 && <p className="mt-2 text-xs text-gray-500">Borradores para copiar: antes de reclamar, fijate que no haya un pago avisado arriba.</p>}
        </section>
      </div>
    </div>
  );
}
