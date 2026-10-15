"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { ROLE_PERMISSIONS } from "@/lib/types";
import {
  CATEGORIAS_MAIL, armarReclamoCobranza, etiquetaFactura, ordenCategoria, type FacturaVencida,
} from "@/lib/agente-mail";
import { AlertTriangle, Check, ClipboardCopy, Loader2, Mail, RefreshCw, Paperclip } from "lucide-react";

type MailFila = {
  id: string; fecha_mail: string | null; remitente: string | null; asunto: string | null; categoria: string; prioridad: string;
  resumen: string | null; accion_sugerida: string | null; datos: any; adjuntos: { nombre: string; metodo: string }[] | null;
  visto_at: string | null; error: string | null;
};
type Corrida = { id: string; inicio: string; mails_nuevos: number; pendientes_restantes: number; costo_usd: number; topeado: boolean; resumen: string | null; error: string | null; origen: string };
type Reclamo = { clienteId: string; cliente: string; email: string | null; facturas: FacturaVencida[]; total: number; asunto: string; texto: string };

const fmt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

export default function MailCobrosPage() {
  const { role, sociedadActiva } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;
  const permitido = (ROLE_PERMISSIONS[role] || []).some((p) => p.module === "*" || p.module === "finanzas");

  const [mails, setMails] = useState<MailFila[]>([]);
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [reclamos, setReclamos] = useState<Reclamo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [verVistos, setVerVistos] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);

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
    const { data: c } = await db.from("agente_mail_corridas").select("*").order("inicio", { ascending: false }).limit(5);
    setCorridas((c as Corrida[]) || []);
    await cargarReclamos(db);
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sociedadId]);

  // Reclamos de cobranza sugeridos: facturas de venta abiertas y vencidas, agrupadas por cliente. Es solo un borrador para copiar.
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
      return { clienteId: r.clienteId, cliente: r.cliente, email: r.email, facturas: r.facturas, total: r.total, asunto, texto } as Reclamo;
    }).sort((a, b) => b.total - a.total);
    setReclamos(lista);
  }

  useEffect(() => { cargar(); }, [cargar]);

  async function revisarAhora(releer = false) {
    setEjecutando(true);
    try {
      const r = await fetch("/api/agente-mail/ejecutar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ releer }) });
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
  const ultima = corridas[0];

  if (!permitido) return <div className="p-6 text-sm text-gray-500">Tu usuario no tiene acceso a esta pantalla.</div>;

  return (
    <div>
      <Header title="Mail y cobros" subtitle="Lo que llegó a administración y lo que conviene reclamar. Todo es sugerencia: no se registra ni se envía nada solo." />
      <div className="space-y-4 p-4 md:p-6">
        {faltaMigracion && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Falta correr la migración del agente (20261015100000_agente_mail). Sin eso la pantalla queda vacía; no rompe nada.</div>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <Mail className="h-4 w-4 text-gray-400" />
          <div className="min-w-0 flex-1">
            {ultima ? (
              <>
                <span className="font-medium">Última revisión {fmtFechaHora(ultima.inicio)}:</span> {ultima.error ? <span className="text-red-600">{ultima.resumen}</span> : ultima.resumen}
                {ultima.pendientes_restantes > 0 && <span className="text-gray-500"> · faltan leer {ultima.pendientes_restantes} (octubre, de a tandas)</span>}
              </>
            ) : <span className="text-gray-500">Todavía no se hizo ninguna revisión. Revisa sola lunes a viernes 8:30, 12:30 y 16:00.</span>}
          </div>
          <button onClick={() => revisarAhora()} disabled={ejecutando || faltaMigracion} className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {ejecutando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Revisar ahora
          </button>
        </div>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">Mails de administración <span className="font-normal text-gray-500">({sinVer} sin ver)</span></h2>
            <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={verVistos} onChange={(e) => setVerVistos(e.target.checked)} /> ver también los ya vistos</label>
            {sinVer > 0 && <button disabled={ejecutando} onClick={() => { if (window.confirm("Se vuelven a leer los mails que todavía no marcaste como vistos (los vistos no se tocan). ¿Seguimos?")) revisarAhora(true); }} className="text-xs text-gray-600 hover:underline">Volver a leer los no vistos</button>}
            {sinVer > 0 && <button onClick={() => marcarVistos(mails.filter((m) => !m.visto_at).map((m) => m.id))} className="text-xs text-blue-600 hover:underline">Marcar todos como vistos</button>}
          </div>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : grupos.length === 0 ? (
            <p className="text-sm text-gray-500">No hay mails para mirar.</p>
          ) : grupos.map(([cat, filas]) => (
            <div key={cat} className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">
                <span>{CATEGORIAS_MAIL.find((c) => c.id === cat)?.label || "Otros"} · {filas.length}</span>
                {filas.some((f) => !f.visto_at) && <button onClick={() => marcarVistos(filas.filter((f) => !f.visto_at).map((f) => f.id))} className="font-normal text-blue-600 hover:underline">Marcar vistos</button>}
              </div>
              <ul className="divide-y divide-gray-100">
                {filas.map((m) => {
                  const cruce = m.datos?.cruce;
                  const pago = m.datos?.pago;
                  return (
                    <li key={m.id} className={`flex gap-3 px-3 py-2 text-sm ${m.visto_at ? "opacity-60" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {m.prioridad === "alta" && <Badge variant="danger">Urgente</Badge>}
                          <span className="font-medium">{m.asunto || "(sin asunto)"}</span>
                          <span className="text-xs text-gray-500">{m.remitente?.replace(/<.*>/, "").trim()} · {fmtFechaHora(m.fecha_mail)}</span>
                        </div>
                        {m.resumen && <p className="text-gray-700">{m.resumen}</p>}
                        {pago && (pago.monto_neto || pago.monto_total) && (
                          <p className="text-xs text-gray-600">
                            Pago: neto {pago.monto_neto ? `$ ${fmt(Number(pago.monto_neto))}` : "—"}
                            {pago.retenciones_total ? ` · retenciones $ ${fmt(Number(pago.retenciones_total))}` : ""}
                            {cruce?.confianza && <> · cruce <Badge variant={cruce.confianza === "alta" ? "success" : cruce.confianza === "media" ? "warning" : "outline"}>{cruce.confianza}</Badge></>}
                          </p>
                        )}
                        {m.accion_sugerida && <p className="text-xs text-blue-700">👉 {m.accion_sugerida}</p>}
                        {cruce?.notas?.length > 0 && <p className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> {cruce.notas.join(" ")}</p>}
                        {m.adjuntos?.length ? <p className="flex items-center gap-1 text-xs text-gray-500"><Paperclip className="h-3 w-3" /> {m.adjuntos.map((a) => `${a.nombre}${a.metodo === "revisar_a_mano" ? " (revisar a mano)" : ""}`).join(", ")}</p> : null}
                        {m.error && <p className="text-xs text-red-600">{m.error}</p>}
                      </div>
                      {!m.visto_at && <button onClick={() => marcarVistos([m.id])} title="Marcar como visto" className="h-7 shrink-0 rounded border border-gray-200 px-2 text-xs text-gray-600 hover:bg-gray-50"><Check className="h-3.5 w-3.5" /></button>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold">Reclamos de cobranza sugeridos <span className="font-normal text-gray-500">({reclamos.length} clientes con facturas vencidas)</span></h2>
          <p className="mb-2 text-xs text-gray-500">Son borradores: copialos y mandalos vos. Antes de reclamar, fijate que no haya un pago avisado en los mails de arriba.</p>
          {reclamos.length === 0 ? <p className="text-sm text-gray-500">No hay facturas vencidas sin cobrar.</p> : (
            <div className="space-y-2">
              {reclamos.map((r) => (
                <details key={r.clienteId} className="rounded-lg border border-gray-200 bg-white">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{r.cliente}</span>
                    <span className="text-xs text-gray-500">{r.facturas.length} factura{r.facturas.length === 1 ? "" : "s"} · $ {fmt(r.total)}{r.facturas.some((f) => f.moneda === "USD") ? " + USD" : ""}</span>
                  </summary>
                  <div className="border-t border-gray-100 px-3 py-2">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{r.texto}</pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => copiar(r.texto)} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs"><ClipboardCopy className="h-3.5 w-3.5" /> Copiar texto</button>
                      {r.email && <a href={`mailto:${r.email}?subject=${encodeURIComponent(r.asunto)}&body=${encodeURIComponent(r.texto)}`} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs"><Mail className="h-3.5 w-3.5" /> Abrir en mi correo</a>}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
