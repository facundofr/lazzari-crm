"use client";

// Finanzas > Hoy > Correo (16/10/2026): el correo de administración conectado con Finanzas (antes "Mail y cobros", suelta).
// Cada mail que leyó el agente dice en qué quedó HOY en el sistema (lib/correo-finanzas.ts):
//  pago avisado → ya cobrado / llegó al banco (confirmar en Para confirmar) / falta el extracto / no llegó;
//  factura de proveedor → ya cargada / falta cargar. Lo resuelto se pliega solo. Abajo, los reclamos de cobranza
//  (sin los clientes que ya avisaron un pago). Nada se registra ni se envía solo.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency } from "@/lib/utils";
import { armarReclamoCobranza, etiquetaFactura, type FacturaAbierta, type FacturaVencida } from "@/lib/agente-mail";
import { estadoMail, avisoDePagoReciente, SECCIONES_CORREO, type EstadoCorreo, type ResultadoCorreo, type LineaBancoCorreo, type FacturaCompraCorreo } from "@/lib/correo-finanzas";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, Loader2, Mail, Paperclip, RefreshCw, RotateCcw } from "lucide-react";

type MailFila = {
  id: string; fecha_mail: string | null; remitente: string | null; asunto: string | null; categoria: string; prioridad: string;
  resumen: string | null; accion_sugerida: string | null; datos: any; adjuntos: { nombre: string; metodo: string }[] | null;
  visto_at: string | null; error: string | null;
};
type Corrida = { inicio: string; mails_nuevos: number; pendientes_restantes: number; resumen: string | null; error: string | null };
type Reclamo = { clienteId: string; cliente: string; cuit: string | null; email: string | null; facturas: FacturaVencida[]; total: number; asunto: string; texto: string; avisoPago: string | null };
/** Aviso para "Para hacer hoy" del Resumen (mismo formato que cuentas-financieras). */
export type AvisoCorreo = { color: "rojo" | "ambar" | "gris"; texto: ReactNode; tab: string };

const fmtFechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const nombreRemitente = (r: string | null) => (r || "").replace(/<.*>/, "").replace(/"/g, "").trim() || "—";
const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const RESUELTOS: EstadoCorreo[] = ["cobrado", "conciliado", "factura_cargada", "pago_nuestro"];
const ESTILO: Partial<Record<EstadoCorreo, { label: string; clase: string }>> = {
  cobrado: { label: "Cobrado", clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  conciliado: { label: "En el banco ✓", clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  para_confirmar: { label: "Para confirmar", clase: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200" },
  falta_extracto: { label: "Falta extracto", clase: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  no_llego: { label: "No llegó", clase: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  factura_cargada: { label: "Cargada ✓", clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  factura_falta: { label: "Sin cargar", clase: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  pago_nuestro: { label: "Pago nuestro", clase: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

/** Avisos del correo para "Para hacer hoy" (liviano: solo cuenta los mails sin ver por tipo). */
export function useAvisosCorreo(sociedadId: string | undefined): AvisoCorreo[] {
  const [avisos, setAvisos] = useState<AvisoCorreo[]>([]);
  useEffect(() => {
    if (!sociedadId) return;
    let vivo = true;
    (async () => {
      const { data, error } = await (supabase as any).from("agente_mail_procesados").select("categoria, prioridad").eq("sociedad_id", sociedadId).is("visto_at", null).limit(500);
      if (error || !vivo) return;
      const n = (c: string) => (data || []).filter((m: any) => m.categoria === c).length;
      const out: AvisoCorreo[] = [];
      if (n("pago_retencion")) out.push({ color: "ambar", texto: <><b>{n("pago_retencion")} avisos de pago</b> de clientes en el correo: fijate si ya llegaron al banco.</>, tab: "correo" });
      if (n("reclamo_consulta")) out.push({ color: (data || []).some((m: any) => m.categoria === "reclamo_consulta" && m.prioridad === "alta") ? "ambar" : "gris", texto: <>{n("reclamo_consulta")} reclamos o consultas sin leer en el correo.</>, tab: "correo" });
      if (n("factura_proveedor")) out.push({ color: "gris", texto: <>{n("factura_proveedor")} facturas o reclamos de proveedores en el correo.</>, tab: "correo" });
      setAvisos(out);
    })();
    return () => { vivo = false; };
  }, [sociedadId]);
  return avisos;
}

export default function FinanzasCorreo({ onIrATab }: { onIrATab?: (tab: string) => void }) {
  const { sociedadActiva } = useUser();
  const sociedadId = sociedadActiva?.id;
  const [mails, setMails] = useState<MailFila[]>([]);
  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [ctx, setCtx] = useState<{ facturas: FacturaAbierta[]; lineas: LineaBancoCorreo[]; extractoHasta: string | null; facturasCompra: FacturaCompraCorreo[] } | null>(null);
  const [vencidas, setVencidas] = useState<{ cliente_id: string; cliente: string; cuit: string | null; email: string | null; f: FacturaVencida }[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ejecutando, setEjecutando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [verResueltos, setVerResueltos] = useState(false);
  const [verArchivados, setVerArchivados] = useState(false);
  const [verReclamos, setVerReclamos] = useState(true);
  const [reclamoAbierto, setReclamoAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setCargando(true);
    setError(null);
    const db = supabase as any;
    try {
      const desde = new Date(Date.now() - 75 * 86400e3).toISOString().slice(0, 10);
      const [m, c, cs, fs, fc] = await Promise.all([
        db.from("agente_mail_procesados").select("id, fecha_mail, remitente, asunto, categoria, prioridad, resumen, accion_sugerida, datos, adjuntos, visto_at, error")
          .eq("sociedad_id", sociedadId).order("fecha_mail", { ascending: false }).limit(400),
        db.from("agente_mail_corridas").select("inicio, mails_nuevos, pendientes_restantes, resumen, error").not("fin", "is", null).order("inicio", { ascending: false }).limit(1),
        db.from("cuentas_financieras").select("id, tipo, saldo_banco_fecha").eq("sociedad_id", sociedadId),
        traerTodo<any>(() => db.from("facturas").select("id, tipo, punto_venta, numero, fecha, fecha_vencimiento, cliente_id, total, total_acreditado, moneda, tipo_cambio, estado, clientes(razon_social, cuit, email, dias_cuenta_corriente)")
          .eq("sociedad_id", sociedadId).in("estado", ["emitida", "parcial", "vencida", "pagada"]).gte("fecha", "2026-01-01").order("id")),
        db.from("facturas_compra").select("numero_factura, proveedores(cuit)").eq("sociedad_id", sociedadId).order("created_at", { ascending: false }).limit(600),
      ]);
      if (m.error) throw m.error;
      const ids = fs.map((f: any) => f.id);
      const aplicado = new Map<string, number>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data: ap } = await db.from("cobro_aplicaciones").select("factura_id, monto").in("factura_id", ids.slice(i, i + 200));
        for (const a of ap || []) aplicado.set(a.factura_id, (aplicado.get(a.factura_id) || 0) + Number(a.monto || 0));
      }
      const cuentaIds = (cs.data || []).map((x: any) => x.id);
      const { data: ls } = cuentaIds.length ? await db.from("extracto_movimientos").select("id, fecha, monto, tipo, estado").in("cuenta_id", cuentaIds).eq("tipo", "credito").gte("fecha", desde).limit(3000) : { data: [] };
      const bancos = (cs.data || []).filter((x: any) => ["cuenta_corriente", "caja_ahorro"].includes(x.tipo) && x.saldo_banco_fecha);
      const extractoHasta = bancos.map((x: any) => String(x.saldo_banco_fecha).slice(0, 10)).sort().pop() || null;
      const facturas: FacturaAbierta[] = fs.map((f: any) => ({
        id: f.id, tipo: f.tipo, punto_venta: f.punto_venta, numero: f.numero, cliente_id: f.cliente_id,
        cliente_nombre: f.clientes?.razon_social ?? null, cliente_cuit: f.clientes?.cuit ?? null,
        total: Number(f.total), moneda: f.moneda, tipo_cambio: f.tipo_cambio ? Number(f.tipo_cambio) : null, estado: f.estado,
        saldo: Math.max(0, Number(f.total) - (aplicado.get(f.id) || 0) - Number(f.total_acreditado || 0)),
      }));
      // Facturas vencidas con saldo (para los reclamos de cobranza).
      const hoy = hoyAR();
      const venc: typeof vencidas = [];
      for (const f of fs) {
        if (f.estado === "pagada") continue;
        const saldo = Math.max(0, Number(f.total) - (aplicado.get(f.id) || 0) - Number(f.total_acreditado || 0));
        const vence = f.fecha_vencimiento || (() => { const d = new Date(`${String(f.fecha).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(f.clientes?.dias_cuenta_corriente || 0)); return d.toISOString().slice(0, 10); })();
        if (saldo < 1 || vence >= hoy) continue;
        venc.push({ cliente_id: f.cliente_id, cliente: f.clientes?.razon_social || "Cliente", cuit: f.clientes?.cuit || null, email: f.clientes?.email || null, f: { etiqueta: etiquetaFactura(f), fecha: String(f.fecha), vencimiento: vence, saldo, moneda: f.moneda } });
      }
      setMails((m.data || []) as MailFila[]);
      setCorrida(((c.data || []) as Corrida[])[0] || null);
      setCtx({
        facturas,
        lineas: (ls || []).map((l: any) => ({ id: l.id, fecha: String(l.fecha).slice(0, 10), importe: Number(l.monto), estado: String(l.estado) })),
        extractoHasta,
        facturasCompra: ((fc.data || []) as any[]).map((x) => ({ numero_factura: x.numero_factura, proveedor_cuit: x.proveedores?.cuit ?? null })),
      });
      setVencidas(venc);
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el correo.");
    } finally {
      setCargando(false);
    }
  }, [sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const estados = useMemo(() => {
    const out = new Map<string, ResultadoCorreo>();
    if (!ctx) return out;
    for (const m of mails) out.set(m.id, estadoMail(m, ctx));
    return out;
  }, [mails, ctx]);

  const visibles = useMemo(() => mails.filter((m) => verArchivados || !m.visto_at), [mails, verArchivados]);
  const resueltos = useMemo(() => visibles.filter((m) => RESUELTOS.includes(estados.get(m.id)?.estado || "mirar")), [visibles, estados]);
  const pendientes = useMemo(() => visibles.filter((m) => !RESUELTOS.includes(estados.get(m.id)?.estado || "mirar")), [visibles, estados]);

  const reclamos = useMemo<Reclamo[]>(() => {
    const hoy = hoyAR();
    const pagos = mails.filter((m) => m.datos?.pago && m.datos.pago.direccion !== "emitido").map((m) => {
      const e = estados.get(m.id);
      return { fecha: String(m.datos.pago.fecha_pago || m.fecha_mail || hoy).slice(0, 10), estado: e?.estado || "mirar", cliente: e?.cliente };
    });
    const por = new Map<string, Reclamo>();
    for (const v of vencidas) {
      const r = por.get(v.cliente_id) || { clienteId: v.cliente_id, cliente: v.cliente, cuit: v.cuit, email: v.email, facturas: [], total: 0, asunto: "", texto: "", avisoPago: null };
      r.facturas.push(v.f);
      if (v.f.moneda !== "USD") r.total += v.f.saldo;
      por.set(v.cliente_id, r);
    }
    return [...por.values()].map((r) => {
      r.facturas.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
      const { asunto, texto } = armarReclamoCobranza(r.cliente, r.facturas, sociedadActiva?.nombre || "Lazzari", new Date());
      return { ...r, asunto, texto, avisoPago: avisoDePagoReciente({ nombre: r.cliente, cuit: r.cuit }, pagos, hoy) };
    }).sort((a, b) => Number(Boolean(a.avisoPago)) - Number(Boolean(b.avisoPago)) || b.total - a.total);
  }, [vencidas, mails, estados, sociedadActiva?.nombre]);

  async function ejecutar(cuerpo: { ids?: string[] }) {
    setEjecutando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/agente-mail/ejecutar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      setAviso(r.ok ? j.resumen || "Listo." : `⚠️ ${j.error || j.resumen || "No se pudo leer el correo"}`);
      await cargar();
    } catch (e: any) {
      setAviso(`⚠️ ${e?.message || "No se pudo leer el correo"}`);
    } finally {
      setEjecutando(false);
    }
  }

  async function archivar(ids: string[]) {
    if (!ids.length) return;
    const ahora = new Date().toISOString();
    const { error: e } = await (supabase as any).from("agente_mail_procesados").update({ visto_at: ahora }).in("id", ids);
    if (e) { alert(`No se pudo archivar: ${e.message}`); return; }
    setMails((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, visto_at: ahora } : m)));
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setAviso("Mensaje copiado."); } catch { setAviso("⚠️ No se pudo copiar."); }
  }

  if (!sociedadId) return null;

  const fila = (m: MailFila) => {
    const e = estados.get(m.id);
    const est = e ? ESTILO[e.estado] : undefined;
    const abierta = abierto === m.id;
    const pago = m.datos?.pago;
    return (
      <li key={m.id} className={m.visto_at ? "opacity-60" : ""}>
        <div className="flex items-start gap-2 py-2">
          <button onClick={() => setAbierto(abierta ? null : m.id)} className="mt-0.5 text-zinc-400 hover:text-zinc-700" aria-label="Ver detalle">
            {abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setAbierto(abierta ? null : m.id)}>
            <p className="truncate text-sm">
              {m.prioridad === "alta" && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" title="Urgente" />}
              {est && <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${est.clase}`}>{est.label}</span>}
              <span className="font-medium text-zinc-900 dark:text-white">{pago?.cliente_nombre || m.datos?.factura?.emisor || m.asunto || "(sin asunto)"}</span>
              {pago?.monto_neto ? <span className="font-mono text-zinc-700 dark:text-zinc-300"> · {formatCurrency(Number(pago.monto_neto))}</span> : m.datos?.factura?.importe ? <span className="font-mono text-zinc-700 dark:text-zinc-300"> · {formatCurrency(Number(m.datos.factura.importe))}</span> : null}
              <span className="text-zinc-500"> · {nombreRemitente(m.remitente)} · {fmtFechaHora(m.fecha_mail)}</span>
            </p>
            <p className={abierta ? "text-sm text-zinc-700 dark:text-zinc-300" : "truncate text-xs text-zinc-600 dark:text-zinc-400"}>{e?.texto || m.accion_sugerida || m.resumen}</p>
            {abierta && (
              <div className="mt-1 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                <p className="font-medium">{m.asunto}</p>
                {m.resumen && <p>{m.resumen}</p>}
                {m.accion_sugerida && e?.texto && <p>Sugerencia del agente: {m.accion_sugerida}</p>}
                {pago && (pago.monto_total || pago.retenciones_total) && (
                  <p>Facturas {pago.monto_total ? formatCurrency(Number(pago.monto_total)) : "—"}{pago.retenciones_total ? ` · retenciones ${formatCurrency(Number(pago.retenciones_total))}` : ""}{pago.facturas?.length ? ` · ${pago.facturas.map((f: any) => f.numero).filter(Boolean).join(", ")}` : ""}</p>
                )}
                {m.adjuntos?.length ? <p className="flex items-center gap-1"><Paperclip className="h-3 w-3" /> {m.adjuntos.map((a) => `${a.nombre}${a.metodo === "revisar_a_mano" ? " (revisar a mano)" : ""}`).join(", ")}</p> : null}
                {m.error && <p className="text-red-600">{m.error}</p>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {e?.ir && <button onClick={() => onIrATab?.(e.ir!.tab)} className="rounded-md border border-violet-300 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40">{e.ir.texto} →</button>}
            <button onClick={() => void ejecutar({ ids: [m.id] })} disabled={ejecutando} title="Volver a leer este mail" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800"><RotateCcw className="h-3.5 w-3.5" /></button>
            {!m.visto_at && <button onClick={() => void archivar([m.id])} title="Archivar (ya lo vi)" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-emerald-600 dark:hover:bg-zinc-800"><Check className="h-4 w-4" /></button>}
          </div>
        </div>
      </li>
    );
  };

  const cuenta = (est: EstadoCorreo) => pendientes.filter((m) => estados.get(m.id)?.estado === est).length;

  return (
    <div className="space-y-4">
      {/* Estado del agente + acciones */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="min-w-0 flex-1 truncate" title={corrida?.resumen || ""}>
          {corrida ? <>Última lectura de administracion@ {fmtFechaHora(corrida.inicio)} · {corrida.error ? "con error" : `${corrida.mails_nuevos} mails nuevos`}{corrida.pendientes_restantes > 0 ? ` · faltan leer ${corrida.pendientes_restantes}` : ""}</> : "Sin lecturas todavía (lun a vie 8:30, 12:30 y 16:00)"}
        </span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={verArchivados} onChange={(e) => setVerArchivados(e.target.checked)} /> ver archivados</label>
        <button onClick={() => void ejecutar({})} disabled={ejecutando} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {ejecutando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Leer correos ahora
        </button>
      </div>
      {aviso && <p className="whitespace-pre-line text-xs font-medium text-zinc-700 dark:text-zinc-300">{aviso}</p>}

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo el correo y cruzándolo con Finanzas…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : (
        <>
          {/* Resumen en una línea */}
          <div className="flex flex-wrap gap-2 text-xs">
            {cuenta("para_confirmar") > 0 && <span className={`rounded-md px-2 py-1 ${ESTILO.para_confirmar!.clase}`}>{cuenta("para_confirmar")} cobros llegaron al banco: confirmalos</span>}
            {cuenta("falta_extracto") > 0 && <span className={`rounded-md px-2 py-1 ${ESTILO.falta_extracto!.clase}`}>{cuenta("falta_extracto")} pagos avisados: falta subir el extracto</span>}
            {cuenta("no_llego") > 0 && <span className={`rounded-md px-2 py-1 ${ESTILO.no_llego!.clase}`}>{cuenta("no_llego")} pagos avisados que no llegaron</span>}
            {cuenta("factura_falta") > 0 && <span className={`rounded-md px-2 py-1 ${ESTILO.factura_falta!.clase}`}>{cuenta("factura_falta")} facturas de proveedores sin cargar</span>}
            {!pendientes.length && <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Correo al día ✓</span>}
          </div>

          {SECCIONES_CORREO.map((s) => {
            const filas = pendientes.filter((m) => s.categorias.includes(m.categoria));
            if (!filas.length) return null;
            return (
              <section key={s.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-1 dark:border-zinc-800">
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{s.titulo} · {filas.length}</h3>
                  {filas.some((f) => !f.visto_at) && <button onClick={() => void archivar(filas.filter((f) => !f.visto_at).map((f) => f.id))} className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-white">archivar todos</button>}
                </div>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{filas.map(fila)}</ul>
              </section>
            );
          })}

          {resueltos.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between">
                <button onClick={() => setVerResueltos((v) => !v)} className="flex items-center gap-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  {verResueltos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Ya resueltos en el sistema · {resueltos.length}
                </button>
                {resueltos.some((f) => !f.visto_at) && <button onClick={() => void archivar(resueltos.filter((f) => !f.visto_at).map((f) => f.id))} className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-white">archivar los {resueltos.filter((f) => !f.visto_at).length}</button>}
              </div>
              {verResueltos && <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{resueltos.map(fila)}</ul>}
            </section>
          )}

          {/* Reclamos de cobranza */}
          <section className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <button onClick={() => setVerReclamos(!verReclamos)} className="flex w-full items-center gap-1 text-left text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {verReclamos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Reclamos de cobranza · {reclamos.filter((r) => !r.avisoPago).length} clientes con facturas vencidas
              <span className="font-normal text-zinc-500">· {formatCurrency(reclamos.filter((r) => !r.avisoPago).reduce((s, r) => s + r.total, 0))}</span>
            </button>
            {verReclamos && (reclamos.length === 0 ? <p className="py-2 text-sm text-zinc-500">No hay facturas vencidas sin cobrar.</p> : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {reclamos.map((r) => {
                  const abierta = reclamoAbierto === r.clienteId;
                  return (
                    <li key={r.clienteId} className={`py-1.5 ${r.avisoPago ? "opacity-60" : ""}`}>
                      <div className="flex items-center gap-2 text-sm">
                        <button onClick={() => setReclamoAbierto(abierta ? null : r.clienteId)} className="min-w-0 flex-1 truncate text-left">
                          <span className="font-medium">{r.cliente}</span>
                          <span className="text-zinc-500"> · {r.facturas.length} fact. · {formatCurrency(r.total)}{r.facturas.some((f) => f.moneda === "USD") ? " + USD" : ""} · vence desde {r.facturas[0].vencimiento.split("-").reverse().slice(0, 2).join("/")}</span>
                          {r.avisoPago && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">avisó un pago el {r.avisoPago.split("-").reverse().slice(0, 2).join("/")}: esperá</span>}
                        </button>
                        <button onClick={() => void copiar(r.texto)} title="Copiar el mensaje" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><ClipboardCopy className="h-4 w-4" /></button>
                        {r.email && <a href={`mailto:${r.email}?subject=${encodeURIComponent(r.asunto)}&body=${encodeURIComponent(r.texto)}`} title="Abrir en mi correo (no se envía solo)" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><Mail className="h-4 w-4" /></a>}
                      </div>
                      {abierta && <pre className="mt-1 whitespace-pre-wrap rounded bg-zinc-50 p-2 font-sans text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{r.texto}</pre>}
                    </li>
                  );
                })}
              </ul>
            ))}
            {verReclamos && reclamos.length > 0 && <p className="mt-1 text-xs text-zinc-500">Son borradores para copiar: nada se envía solo. Los clientes que avisaron un pago quedan abajo y en gris.</p>}
          </section>
        </>
      )}
    </div>
  );
}
