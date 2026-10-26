"use client";

// Finanzas Lazza → Órdenes de pago, Recibos, Retenciones y Movimientos.
// Recibos numerados (19/10, "recibos B"): 1 recibo = 1 cobro con su N° (lib/recibos.ts, migración 20261019210000),
// con Ver, Descargar y Enviar por mail (recibo-doc.tsx; el mismo PDF de recibo de Finanzas, con N°, medios, retenciones y facturas).
// Recibos (19/10): "Nuevo cobro" → elegir cliente y facturas → la misma liquidación de Finanzas (cobrar.tsx).
// Órdenes de pago (19/10): "Nueva OP" → la misma ventana de OP de Finanzas (pagar.tsx). 20/10: Anular (y "Anular y pagar de nuevo").
// Mismos datos y reglas que las pestañas de Finanzas; acá solo se miran, con filtros y orden por columna.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Ban, Download, Eye, HandCoins, Loader2, Mail, MailCheck, Plus, Search, Wallet } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { clasificarMovimiento, esCobroDeCliente, type ClaseMovimiento } from "@/lib/tipos-movimiento";
import { armarRetenciones, comprobanteVenta, type FilaRetencion } from "@/lib/finanzas-lazza";
import { textoTotalRecibo, type Recibo } from "@/lib/recibos";
import { abrirRecibo, EnviarRecibo, SIN_MIGRACION_RECIBOS, traerRecibos } from "@/components/finanzas-lazza/recibo-doc";
import { useUser } from "@/lib/auth-context";
import { descargarOP, EnviarOrdenPago, verOP } from "@/components/finanzas-lazza/orden-pago-doc";
import { CobrarCliente } from "@/components/finanzas-lazza/cobrar";
import { PagarProveedor } from "@/components/finanzas-lazza/pagar";
import { NuevoMovimiento } from "@/components/finanzas-lazza/nuevo-movimiento";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const mon = (m: unknown): "ARS" | "USD" => (String(m || "").toUpperCase() === "USD" ? "USD" : "ARS");
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const primeroDelMes = () => `${todayAR().slice(0, 7)}-01`;

const TIPO_LABEL: Record<string, string> = {
  cobro: "Cobro", pago: "Pago", cheque_emitido: "Cheque emitido", cheque_recibido: "Cheque recibido", transferencia: "Transferencia",
  efectivo: "Efectivo", deposito: "Depósito", ajuste: "Ajuste", tarjeta: "Tarjeta", link_pago: "Link de pago", echeq: "E-Cheq",
  retencion_iva: "Ret. IVA", retencion_ganancias: "Ret. Ganancias", retencion_iibb: "Ret. IIBB", retencion_suss: "Ret. SUSS",
};
const MEDIO_LABEL: Record<string, string> = { transferencia: "Transf.", cheque: "Cheque", cheque_propio: "Ch. propio", echeq: "E-Cheq", deposito: "Depósito", tarjeta: "Tarjeta", efectivo: "Efectivo" };

/** Carga con aviso de error y "Cargando…". */
function useCarga<T>(cargar: () => Promise<T>, deps: unknown[]): { datos: T | null; error: string | null } {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    cargar().then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { console.error("Finanzas Lazza:", e); if (vivo) setError("No se pudieron cargar los datos. Recargá la página."); });
    return () => { vivo = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { datos, error };
}

function Marco({ error, cargando, filtros, children, pie }: { error: string | null; cargando: boolean; filtros: ReactNode; children: ReactNode; pie?: ReactNode }) {
  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">{filtros}</div>
      {cargando ? <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p> : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {children}
          {pie && <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">{pie}</div>}
        </div>
      )}
    </div>
  );
}

function Buscador({ valor, cambiar, placeholder }: { valor: string; cambiar: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-[200px] flex-1">
      <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
      <input value={valor} onChange={(e) => cambiar(e.target.value)} placeholder={placeholder} className={`${control} w-full pl-8`} />
    </div>
  );
}

function Fechas({ desde, hasta, setDesde, setHasta }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void }) {
  return (
    <>
      <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" className={control} />
      <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" className={control} />
    </>
  );
}

const enRango = (fecha: string, desde: string, hasta: string) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
const sumar = <T,>(filas: T[], monto: (f: T) => number, moneda: (f: T) => "ARS" | "USD") => {
  const t = { ARS: 0, USD: 0 };
  for (const f of filas) t[moneda(f)] += monto(f);
  return <>{formatCurrency(t.ARS)}{Math.abs(t.USD) >= 0.01 && <> + {formatCurrency(t.USD, "USD")}</>}</>;
};

// ── Órdenes de pago (Augusto 19/10: descargarlas y mandarlas desde acá) ──

/**
 * Anular una OP (20/10): la MISMA función de la base que Finanzas (anular_orden_pago_segura; si es una liquidación en US$,
 * anular_liquidacion_fx). No se borra nada: la OP queda tachada, sus movimientos (pago y retenciones) anulados, los cheques
 * no cambian (26/10: los mueve solo el banco), las NC usadas se liberan y las facturas vuelven a quedar a pagar. "Anular y pagar de nuevo"
 * abre la ventana de OP con el mismo proveedor y las mismas facturas tildadas, así no queda nada duplicado.
 */
function AnularOP({ op, sociedadId, onClose, onAnulada }: {
  op: OP; sociedadId: string; onClose: () => void; onAnulada: (otraVez: { proveedorId: string; facturaIds: string[] } | null) => void;
}) {
  const [facturas, setFacturas] = useState<{ id: string; numero: string }[] | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let vivo = true;
    db.from("op_facturas_compra").select("factura_compra_id, facturas_compra(numero_factura)").eq("orden_pago_id", op.id)
      .then(({ data }: any) => { if (vivo) setFacturas((data || []).map((x: any) => ({ id: x.factura_compra_id, numero: x.facturas_compra?.numero_factura || "" }))); });
    return () => { vivo = false; };
  }, [op.id]);

  const anular = async (otraVez: boolean) => {
    setTrabajando(true); setError("");
    try {
      const { data: fx } = await db.from("liquidaciones_fx").select("id").eq("orden_pago_id", op.id).eq("sociedad_id", sociedadId).maybeSingle();
      const { error: e } = fx?.id
        ? await db.rpc("anular_liquidacion_fx", { p_id: fx.id, p_sociedad_id: sociedadId })
        : await db.rpc("anular_orden_pago_segura", { p_orden_pago_id: op.id, p_sociedad_id: sociedadId });
      if (e) throw new Error(e.message);
      onAnulada(otraVez && op.proveedorId ? { proveedorId: op.proveedorId, facturaIds: (facturas || []).map((f) => f.id) } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTrabajando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-zinc-900 dark:text-white">Anular {op.numero}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{op.proveedor} · {formatDate(op.fecha)} · entregado <b className="font-mono">{formatCurrency(op.neto, op.moneda)}</b>{op.retGan > 0 ? <> · ret. {formatCurrency(op.retGan, op.moneda)}</> : null}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-zinc-600 dark:text-zinc-300">
          <li>No se borra: la OP queda anulada (tachada) y se sigue viendo.</li>
          <li>El pago y la retención quedan anulados. Los cheques no cambian: dónde está cada uno lo dice el banco.</li>
          <li>{facturas === null ? "Buscando facturas…" : facturas.length ? `Vuelve${facturas.length === 1 ? "" : "n"} a quedar a pagar: ${facturas.map((f) => f.numero).join(", ")}.` : "No paga facturas (era un pago a cuenta): el saldo a favor desaparece."}</li>
          {op.enviada && <li className="text-amber-700 dark:text-amber-300">⚠️ Esta OP se mandó por mail el {formatDate(op.enviada)}: avisale al proveedor.</li>}
        </ul>
        {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">No se pudo anular: {error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
          <button type="button" disabled={trabajando || facturas === null} onClick={() => anular(false)} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800">Anular</button>
          {op.proveedorId && (
            <button type="button" disabled={trabajando || facturas === null} onClick={() => anular(true)} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {trabajando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Anular y pagar de nuevo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface OP { id: string; proveedorId: string | null; numero: string; fecha: string; proveedor: string; cuit: string; bruto: number; retGan: number; retPct: number | null; neto: number; moneda: "ARS" | "USD"; medios: string[]; estado: string; enviada: string | null; sobreVerde: boolean }

export function FinanzasLazzaOrdenesPago({ sociedadId }: { sociedadId: string }) {
  const [recarga, setRecarga] = useState(0);
  const [pagando, setPagando] = useState(false);
  const { datos, error } = useCarga<OP[]>(async () => {
    const rows = await traerTodo<any>(() => db.from("ordenes_pago").select("*, proveedores(razon_social, cuit)").eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("id"));
    return rows.map((r) => {
      let medios: any[] = [];
      try { medios = Array.isArray(r.medios_pago) ? r.medios_pago : r.medios_pago ? JSON.parse(r.medios_pago) : []; } catch { medios = []; }
      return {
        id: r.id, proveedorId: r.proveedor_id || null, numero: String(r.numero ?? ""), fecha: String(r.fecha).slice(0, 10), proveedor: r.proveedores?.razon_social || "", cuit: r.proveedores?.cuit || "",
        bruto: Number(r.monto_bruto || 0), retGan: Number(r.retencion_ganancias_monto || 0), retPct: r.retencion_ganancias_pct ?? null,
        neto: Number(r.neto_a_pagar ?? r.neto ?? 0), moneda: mon(r.moneda),
        medios: medios.length > 1 ? medios.map((m) => MEDIO_LABEL[m.tipo] || m.tipo) : [MEDIO_LABEL[r.medio_pago || "transferencia"] || r.medio_pago || "Transf."],
        estado: r.estado || "pendiente", enviada: r.email_enviado_at || null, sobreVerde: !!r.sobre_verde,
      };
    });
  }, [sociedadId, recarga]);
  const { sociedadActiva } = useUser();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<OP | null>(null);
  const [rehacer, setRehacer] = useState<{ proveedorId: string; facturaIds: string[] } | null>(null);
  const [enviadas, setEnviadas] = useState<Record<string, string>>({});
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("");
  const [envio, setEnvio] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).map((o) => (enviadas[o.id] ? { ...o, enviada: enviadas[o.id] } : o)).filter((o) =>
    (!estado || o.estado === estado) && (!envio || (envio === "si") === !!o.enviada) && enRango(o.fecha, desde, hasta)
    && (!q || sinAcentos(`${o.numero} ${o.proveedor} ${o.cuit} ${o.medios.join(" ")}`).includes(q))), [datos, enviadas, estado, envio, desde, hasta, q]);
  const cols: Column<OP>[] = [
    { key: "numero", label: "N°", sortable: true, sortValue: (o) => o.numero, render: (o) => <span className={`whitespace-nowrap font-mono text-xs ${o.estado === "anulada" ? "text-zinc-400 line-through" : ""}`}>{o.numero}</span> },
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (o) => o.fecha, render: (o) => <span className="whitespace-nowrap">{formatDate(o.fecha)}</span> },
    { key: "proveedor", label: "Proveedor", sortable: true, sortValue: (o) => o.proveedor },
    { key: "bruto", label: "Bruto", sortable: true, sortValue: (o) => o.bruto, className: "text-right", render: (o) => <span className="whitespace-nowrap font-mono">{formatCurrency(o.bruto, o.moneda)}</span> },
    { key: "ret", label: "Ret. Gan.", sortable: true, sortValue: (o) => o.retGan, className: "text-right", render: (o) => o.retGan > 0 ? <span className="whitespace-nowrap font-mono">{formatCurrency(o.retGan, o.moneda)}{o.retPct !== null && <span className="block text-[10px] text-zinc-400">{o.retPct}%</span>}</span> : "—" },
    { key: "neto", label: "Entregado", sortable: true, sortValue: (o) => o.neto, className: "text-right", render: (o) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(o.neto, o.moneda)}</span> },
    { key: "medio", label: "Medio", sortable: true, sortValue: (o) => o.medios.join(" "), render: (o) => <span className="text-xs">{o.medios.join(" · ")}</span> },
    { key: "estado", label: "Estado", sortable: true, sortValue: (o) => o.estado, render: (o) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${o.estado === "pagada" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : o.estado === "anulada" ? "bg-red-50 text-red-700 line-through dark:bg-red-950/40 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>{o.estado === "pagada" ? "Pagada" : o.estado === "anulada" ? "Anulada" : "Pendiente"}</span> },
    { key: "enviada", label: "Enviada", sortable: true, sortValue: (o) => o.enviada || "", render: (o) => o.enviada ? <span className="text-xs text-emerald-600">✓ {formatDate(o.enviada)}</span> : o.sobreVerde ? <span className="text-xs text-zinc-500">Sobre verde</span> : <span className="text-xs text-zinc-400">—</span> },
    { key: "acciones", label: "", render: (o) => (
      <span className="flex justify-end gap-0.5">
        <button type="button" title="Ver la OP (se abre en otra pestaña, sin descargar)" onClick={(e) => { e.stopPropagation(); if (sociedadActiva) verOP(o.id, sociedadActiva); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Eye className="h-3.5 w-3.5" /></button>
        <button type="button" title="Descargar la OP" onClick={(e) => { e.stopPropagation(); if (sociedadActiva) descargarOP(o.id, sociedadActiva); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Download className="h-3.5 w-3.5" /></button>
        {o.estado !== "anulada" && (
          <button type="button" title={o.enviada ? `Enviada el ${formatDate(o.enviada)}: mandarla otra vez` : "Mandar la OP por mail (con los comprobantes)"} onClick={(e) => { e.stopPropagation(); setEnviando(o.id); }}
            className={`rounded p-1.5 hover:bg-orange-50 dark:hover:bg-zinc-800 ${o.enviada ? "text-emerald-600" : "text-orange-500"}`}>{o.enviada ? <MailCheck className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}</button>
        )}
        {o.estado !== "anulada" && (
          <button type="button" title="Anular la OP (no se borra: queda tachada y la factura vuelve a quedar a pagar)" onClick={(e) => { e.stopPropagation(); setAnulando(o); }}
            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Ban className="h-3.5 w-3.5" /></button>
        )}
      </span>
    ) },
  ];
  return (
    <Marco error={error} cargando={!datos} filtros={<>
      <button type="button" onClick={() => setPagando(true)}
        className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-500 px-3 text-sm font-medium text-white hover:bg-orange-600">
        <Wallet className="h-4 w-4" /> Nueva OP
      </button>
      <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar N°, proveedor, CUIT o medio" />
      <select value={estado} onChange={(e) => setEstado(e.target.value)} className={control}><option value="">Todos los estados</option><option value="pendiente">Pendientes</option><option value="pagada">Pagadas</option><option value="anulada">Anuladas</option></select>
      <select value={envio} onChange={(e) => setEnvio(e.target.value)} className={control}><option value="">Enviadas y no</option><option value="si">Enviadas por mail</option><option value="no">No enviadas</option></select>
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
    </>} pie={<><span>{visibles.length} órdenes</span><span>Entregado <b className="font-mono">{sumar(visibles.filter((o) => o.estado !== "anulada"), (o) => o.neto, (o) => o.moneda)}</b></span></>}>
      <DataTable columns={cols} data={visibles} emptyMessage="No hay órdenes de pago con ese filtro" />
      <EnviarOrdenPago opId={enviando} onClose={() => setEnviando(null)} onEnviada={(id, fecha) => setEnviadas((e) => ({ ...e, [id]: fecha }))} />
      {pagando && <PagarProveedor sociedadId={sociedadId} onClose={() => setPagando(false)} onPagado={() => setRecarga((n) => n + 1)} />}
      {anulando && (
        <AnularOP op={anulando} sociedadId={sociedadId} onClose={() => setAnulando(null)}
          onAnulada={(otraVez) => { setAnulando(null); setRecarga((n) => n + 1); if (otraVez) setRehacer(otraVez); }} />
      )}
      {rehacer && <PagarProveedor sociedadId={sociedadId} proveedorId={rehacer.proveedorId} facturaIds={rehacer.facturaIds} onClose={() => setRehacer(null)} onPagado={() => setRecarga((n) => n + 1)} />}
    </Marco>
  );
}

// ── Movimientos (base de Recibos y Movimientos) ─────────────────────

interface Mov { id: string; tipo: string; fecha: string; monto: number; montoOriginal: number | null; moneda: "ARS" | "USD"; descripcion: string; conciliado: boolean; anulado: boolean; nombre: string; clase: ClaseMovimiento; cobro: boolean; facturaVenta: boolean; facturaCompra: boolean }

async function traerMovimientos(sociedadId: string): Promise<Mov[]> {
  const rows = await traerTodo<any>(() => db.from("movimientos")
    .select("id, tipo, fecha, monto, monto_original, moneda, descripcion, conciliado, anulado, cliente_id, proveedor_id, factura_id, factura_compra_id, nota_credito_compra_id, ajuste_sentido, clientes(razon_social), proveedores(razon_social)")
    .eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("id", { ascending: false }));
  return rows.map((r) => ({
    id: r.id, tipo: r.tipo || "", fecha: String(r.fecha).slice(0, 10), monto: Number(r.monto || 0), montoOriginal: r.monto_original === null || r.monto_original === undefined ? null : Number(r.monto_original),
    moneda: mon(r.moneda), descripcion: r.descripcion || "", conciliado: !!r.conciliado, anulado: !!r.anulado,
    nombre: r.clientes?.razon_social || r.proveedores?.razon_social || "",
    // Como Finanzas: la clase se calcula como si no estuviera anulado (el anulado se muestra tachado).
    clase: clasificarMovimiento({ ...r, anulado: false }), cobro: !r.anulado && esCobroDeCliente(r),
    facturaVenta: !!r.factura_id, facturaCompra: !!r.factura_compra_id,
  }));
}

/** Lista vieja (1 recibo = 1 movimiento): solo si todavía no se corrió la migración de recibos numerados. */
function RecibosPorMovimiento({ sociedadId }: { sociedadId: string }) {
  const [recarga, setRecarga] = useState(0);
  const [cobrando, setCobrando] = useState(false);
  const { datos, error } = useCarga(() => traerMovimientos(sociedadId).then((m) => m.filter((x) => x.cobro)), [sociedadId, recarga]);
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).filter((m) => enRango(m.fecha, desde, hasta) && (!q || sinAcentos(`${m.nombre} ${m.descripcion}`).includes(q))), [datos, desde, hasta, q]);
  const cols: Column<Mov>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (m) => m.fecha, render: (m) => formatDate(m.fecha) },
    { key: "nombre", label: "Cliente", sortable: true, sortValue: (m) => m.nombre, render: (m) => m.nombre || "Cliente sin nombre" },
    { key: "descripcion", label: "Detalle", sortable: true, sortValue: (m) => m.descripcion, render: (m) => <span className="text-xs">{m.descripcion || "Cobro de cliente"}</span> },
    { key: "tipo", label: "Medio", sortable: true, sortValue: (m) => m.tipo, render: (m) => <span className="text-xs">{TIPO_LABEL[m.tipo] || m.tipo}</span> },
    { key: "monto", label: "Importe", sortable: true, sortValue: (m) => m.monto, className: "text-right", render: (m) => <span className="whitespace-nowrap font-mono font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(m.monto, m.moneda)}</span> },
    { key: "conciliado", label: "Banco", sortable: true, sortValue: (m) => (m.conciliado ? 1 : 0), render: (m) => <span className={`text-xs ${m.conciliado ? "text-emerald-600" : "text-amber-600"}`}>{m.conciliado ? "Conciliado" : "Pendiente"}</span> },
  ];
  return (
    <>
      <Marco error={error} cargando={!datos} filtros={<>
        <button type="button" onClick={() => setCobrando(true)}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">
          <HandCoins className="h-4 w-4" /> Nuevo cobro
        </button>
        <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar cliente o detalle" />
        <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      </>} pie={<><span>{visibles.length} cobros (hoy 1 recibo = 1 movimiento)</span><span>Cobrado <b className="font-mono text-emerald-700 dark:text-emerald-400">{sumar(visibles, (m) => m.monto, (m) => m.moneda)}</b></span></>}>
        <DataTable columns={cols} data={visibles} emptyMessage="No hay cobros con ese filtro" />
      </Marco>
      {cobrando && <CobrarCliente sociedadId={sociedadId} onClose={() => setCobrando(false)} onCobrado={() => setRecarga((n) => n + 1)} />}
    </>
  );
}

// ── Recibos numerados ───────────────────────────────────────────────

const resumenMedios = (r: Recibo) => {
  const c: Record<string, number> = {};
  for (const x of r.renglones) c[x.medio] = (c[x.medio] || 0) + 1;
  return Object.entries(c).map(([m, k]) => (k > 1 ? `${m} ×${k}` : m)).join(" · ");
};

export function FinanzasLazzaRecibos({ sociedadId }: { sociedadId: string }) {
  const { sociedadActiva } = useUser();
  const [recarga, setRecarga] = useState(0);
  const [cobrando, setCobrando] = useState(false);
  const [enviando, setEnviando] = useState<Recibo | null>(null);
  const [sinMigracion, setSinMigracion] = useState(false);
  const [datos, setDatos] = useState<Recibo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    traerRecibos(sociedadId).then((d) => { if (vivo) setDatos(d); })
      .catch((e) => {
        if (!vivo) return;
        if (e?.message === SIN_MIGRACION_RECIBOS) { setSinMigracion(true); return; }
        console.error("Finanzas Lazza · Recibos:", e); setError("No se pudieron cargar los recibos. Recargá la página.");
      });
    return () => { vivo = false; };
  }, [sociedadId, recarga]);
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).filter((r) => enRango(r.fecha, desde, hasta)
    && (!q || sinAcentos(`${r.numero} ${r.cliente} ${r.facturas.join(" ")} ${resumenMedios(r)}`).includes(q))), [datos, desde, hasta, q]);
  if (sinMigracion) return (
    <div className="space-y-2">
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Los recibos numerados todavía no están activos (falta correr la migración 20261019210000). Por ahora se ve 1 renglón por movimiento.</p>
      <RecibosPorMovimiento sociedadId={sociedadId} />
    </div>
  );
  const pdf = (r: Recibo, ver: boolean) => { if (sociedadActiva) abrirRecibo(r, sociedadActiva, ver); };
  const cols: Column<Recibo>[] = [
    { key: "numero", label: "N°", sortable: true, sortValue: (r) => r.numero, render: (r) => <span className={`font-mono text-xs ${r.anulado ? "text-zinc-400 line-through" : ""}`}>{r.numero}</span> },
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (r) => r.fecha, render: (r) => formatDate(r.fecha) },
    { key: "cliente", label: "Cliente", sortable: true, sortValue: (r) => r.cliente, render: (r) => <span className={r.anulado ? "text-zinc-400 line-through" : ""}>{r.cliente}</span> },
    { key: "medios", label: "Medios", sortable: true, sortValue: (r) => resumenMedios(r), render: (r) => <span className="text-xs">{resumenMedios(r) || "—"}</span> },
    { key: "facturas", label: "Facturas", sortable: true, sortValue: (r) => r.facturas.join(" "), render: (r) => <span className="font-mono text-[11px] text-zinc-500">{r.facturas.join(", ") || "—"}</span> },
    { key: "total", label: "Importe", sortable: true, sortValue: (r) => r.total.ARS + r.total.USD * 1000, className: "text-right", render: (r) => (
      <span className={`whitespace-nowrap font-mono font-semibold ${r.anulado ? "text-zinc-400 line-through" : "text-emerald-700 dark:text-emerald-400"}`}>{textoTotalRecibo(r.total, (v, m) => formatCurrency(v, m))}</span>
    ) },
    { key: "estado", label: "Banco", sortable: true, sortValue: (r) => (r.anulado ? 0 : r.conciliado ? 2 : 1), render: (r) => <span className={`text-xs ${r.anulado ? "text-red-600" : r.conciliado ? "text-emerald-600" : "text-amber-600"}`}>{r.anulado ? "Anulado" : r.conciliado ? "Conciliado" : "Pendiente"}</span> },
    { key: "acciones", label: "", render: (r) => (
      <span className="flex justify-end gap-0.5">
        <button type="button" title="Ver el recibo (se abre en otra pestaña, sin descargar)" onClick={(e) => { e.stopPropagation(); pdf(r, true); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Eye className="h-3.5 w-3.5" /></button>
        <button type="button" title="Descargar el recibo" onClick={(e) => { e.stopPropagation(); pdf(r, false); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Download className="h-3.5 w-3.5" /></button>
        <button type="button" title="Mandar el recibo por mail al cliente" onClick={(e) => { e.stopPropagation(); setEnviando(r); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Mail className="h-3.5 w-3.5" /></button>
      </span>
    ) },
  ];
  const cobrado = visibles.filter((r) => !r.anulado).reduce((t, r) => ({ ARS: t.ARS + r.total.ARS, USD: t.USD + r.total.USD }), { ARS: 0, USD: 0 });
  return (
    <>
      <Marco error={error} cargando={!datos} filtros={<>
        <button type="button" onClick={() => setCobrando(true)}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">
          <HandCoins className="h-4 w-4" /> Nuevo cobro
        </button>
        <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar N°, cliente, factura o medio" />
        <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      </>} pie={<><span>{visibles.length} recibos</span><span>Cobrado <b className="font-mono text-emerald-700 dark:text-emerald-400">{textoTotalRecibo(cobrado, (v, m) => formatCurrency(v, m))}</b></span></>}>
        <DataTable columns={cols} data={visibles} emptyMessage="No hay recibos con ese filtro" />
      </Marco>
      {cobrando && <CobrarCliente sociedadId={sociedadId} onClose={() => setCobrando(false)} onCobrado={() => setRecarga((n) => n + 1)} />}
      <EnviarRecibo recibo={enviando} onClose={() => setEnviando(null)} />
    </>
  );
}

const CLASE_LABEL: Record<ClaseMovimiento, string> = { ingreso: "Cobro / ingreso", egreso: "Pago / egreso", retencion_sufrida: "Retención sufrida", ajuste: "Ajuste", neutro: "Otro" };

export function FinanzasLazzaMovimientos({ sociedadId }: { sociedadId: string }) {
  const [recarga, setRecarga] = useState(0);
  const [nuevo, setNuevo] = useState(false);
  const { datos, error } = useCarga(() => traerMovimientos(sociedadId), [sociedadId, recarga]);
  const [texto, setTexto] = useState("");
  const [clase, setClase] = useState<"" | ClaseMovimiento | "anulados">("");
  const [conciliado, setConciliado] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).filter((m) =>
    enRango(m.fecha, desde, hasta)
    && (!clase || (clase === "anulados" ? m.anulado : m.clase === clase))
    && (!conciliado || (conciliado === "si") === m.conciliado)
    && (!q || sinAcentos(`${m.nombre} ${m.descripcion} ${TIPO_LABEL[m.tipo] || m.tipo}`).includes(q))), [datos, desde, hasta, clase, conciliado, q]);
  const cols: Column<Mov>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (m) => m.fecha, render: (m) => formatDate(m.fecha) },
    { key: "tipo", label: "Tipo", sortable: true, sortValue: (m) => m.tipo, render: (m) => <span className="text-xs">{TIPO_LABEL[m.tipo] || m.tipo}</span> },
    { key: "descripcion", label: "Descripción", sortable: true, sortValue: (m) => m.descripcion, render: (m) => {
      const [principal, ...resto] = m.descripcion.split(" — ");
      return (
        <span className={m.anulado ? "text-zinc-400 line-through" : ""}>
          {principal || "—"}
          {resto.length > 0 && <span className="block text-[11px] text-zinc-400">{resto.join(" — ")}</span>}
          <span className="block text-[11px] text-zinc-400">{[m.nombre, m.facturaVenta ? "Factura de venta vinculada" : "", m.facturaCompra ? "Factura de compra vinculada" : ""].filter(Boolean).join(" · ")}</span>
        </span>
      );
    } },
    { key: "monto", label: "Monto", sortable: true, sortValue: (m) => m.monto, className: "text-right", render: (m) => {
      if (m.anulado) return <span className="whitespace-nowrap font-mono text-zinc-400 line-through">{formatCurrency(m.montoOriginal ?? m.monto, m.moneda)}</span>;
      const entra = m.clase === "ingreso" || m.clase === "retencion_sufrida";
      const sale = m.clase === "egreso";
      return <span className={`whitespace-nowrap font-mono ${entra ? "text-emerald-700 dark:text-emerald-400" : sale ? "text-red-600" : ""}`}>{entra ? "+" : sale ? "−" : ""}{formatCurrency(m.monto, m.moneda)}</span>;
    } },
    { key: "estado", label: "Estado", sortable: true, sortValue: (m) => (m.anulado ? "a" : m.conciliado ? "c" : "p"), render: (m) => <span className={`text-xs ${m.anulado ? "text-red-600" : m.conciliado ? "text-emerald-600" : "text-amber-600"}`}>{m.anulado ? "Anulado" : m.conciliado ? "Conciliado" : "Pendiente"}</span> },
  ];
  return (
    <>
    <Marco error={error} cargando={!datos} filtros={<>
      <button type="button" onClick={() => setNuevo(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-500 px-3 text-sm font-medium text-white hover:bg-orange-600">
        <Plus className="h-4 w-4" /> Nuevo movimiento
      </button>
      <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar descripción, cliente o proveedor" />
      <select value={clase} onChange={(e) => setClase(e.target.value as typeof clase)} className={control}>
        <option value="">Todos los tipos</option>
        {(["ingreso", "egreso", "retencion_sufrida", "ajuste", "neutro"] as ClaseMovimiento[]).map((c) => <option key={c} value={c}>{CLASE_LABEL[c]}</option>)}
        <option value="anulados">Anulados</option>
      </select>
      <select value={conciliado} onChange={(e) => setConciliado(e.target.value)} className={control}><option value="">Conciliados y no</option><option value="si">Conciliados</option><option value="no">Sin conciliar</option></select>
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
    </>} pie={<span>{visibles.length} movimientos · lo anulado queda tachado</span>}>
      <DataTable columns={cols} data={visibles} emptyMessage="No hay movimientos con ese filtro" />
    </Marco>
    <NuevoMovimiento sociedadId={sociedadId} abierto={nuevo} onClose={() => setNuevo(false)} onGuardado={() => setRecarga((r) => r + 1)} />
    </>
  );
}

// ── Retenciones ─────────────────────────────────────────────────────

const REGIMEN_TEXTO: Record<string, string> = { "078": "Bienes", "094": "Servicios", "095": "Transporte", "116": "Honorarios", "031": "Alquiler inmuebles", "030": "Alquiler muebles", "019": "Intereses", "021": "Intereses", "025": "Comisiones" };

/**
 * Exportar las retenciones de Ganancias practicadas (lo que se presenta en SICORE) del rango de fechas:
 * TXT con el formato de importación de SICORE (/api/sicore, el mismo de Finanzas) y Excel con esos mismos renglones.
 */
function ExportarSicore({ sociedadId, desde, hasta }: { sociedadId: string; desde: string; hasta: string }) {
  const [bajando, setBajando] = useState<"" | "txt" | "excel">("");
  const bajar = async (formato: "txt" | "excel") => {
    if (!desde) { alert("Elegí la fecha desde."); return; }
    const h = hasta || todayAR();
    setBajando(formato);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/sicore?desde=${desde}&hasta=${h}&sociedad_id=${sociedadId}${formato === "excel" ? "&formato=json" : ""}`,
        { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "No se pudo armar el archivo."); return; }
      const nombre = `Retenciones SICORE ${desde} a ${h}`;
      if (formato === "txt") {
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement("a"); a.href = url; a.download = `${nombre}.txt`; a.click(); URL.revokeObjectURL(url);
        return;
      }
      const { filas } = await r.json() as { filas: { fecha: string; comprobante: string; proveedor: string; cuit: string; regimen: string; importe: number; base: number; pct: number; retencion: number }[] };
      const XLSX: any = await import("xlsx");
      const datos = filas.map((f) => ({
        Fecha: formatDate(f.fecha), Comprobante: f.comprobante, Proveedor: f.proveedor, CUIT: f.cuit,
        "Régimen": `${Number(f.regimen)} ${REGIMEN_TEXTO[f.regimen] || ""}`.trim(), "Importe OP": f.importe, "Base": f.base, "%": f.pct, "Retención": f.retencion,
      }));
      datos.push({ Fecha: "", Comprobante: "", Proveedor: "TOTAL", CUIT: "", "Régimen": "", "Importe OP": filas.reduce((s, f) => s + f.importe, 0), "Base": filas.reduce((s, f) => s + f.base, 0), "%": "" as any, "Retención": Math.round(filas.reduce((s, f) => s + f.retencion, 0) * 100) / 100 });
      const ws = XLSX.utils.json_to_sheet(datos);
      ws["!cols"] = [{ wch: 11 }, { wch: 12 }, { wch: 40 }, { wch: 13 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 5 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Retenciones");
      XLSX.writeFile(wb, `${nombre}.xlsx`);
    } catch (e) {
      console.error("SICORE:", e); alert("No se pudo armar el archivo. Probá de nuevo.");
    } finally { setBajando(""); }
  };
  const boton = "flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium disabled:opacity-50";
  return (
    <>
      <button type="button" disabled={!!bajando} onClick={() => void bajar("txt")} title="Retenciones de Ganancias practicadas del rango, en el formato para importar en SICORE"
        className={`${boton} border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300`}>
        {bajando === "txt" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} TXT SICORE
      </button>
      <button type="button" disabled={!!bajando} onClick={() => void bajar("excel")} title="Los mismos renglones del TXT, en Excel"
        className={`${boton} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300`}>
        {bajando === "excel" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Excel
      </button>
    </>
  );
}

export function FinanzasLazzaRetenciones({ sociedadId }: { sociedadId: string }) {
  const { datos, error } = useCarga<FilaRetencion[]>(async () => {
    const [ops, movs] = await Promise.all([
      traerTodo<any>(() => db.from("ordenes_pago").select("id, numero, fecha, estado, moneda, retencion_ganancias_monto, retencion_ganancias_pct, base_retencion_ganancias, proveedores(razon_social, cuit)")
        .eq("sociedad_id", sociedadId).gt("retencion_ganancias_monto", 0).order("id")),
      traerTodo<any>(() => db.from("movimientos").select("id, tipo, fecha, monto, moneda, anulado, descripcion, cliente_id, proveedor_id, retencion_ganancias_monto, retencion_ganancias_pct, base_retencion_ganancias, clientes(razon_social, cuit), proveedores(razon_social, cuit)")
        .eq("sociedad_id", sociedadId).or("tipo.in.(retencion_iva,retencion_ganancias,retencion_iibb,retencion_suss),retencion_ganancias_monto.gt.0").order("id")),
    ]);
    return armarRetenciones({ ops, movimientos: movs });
  }, [sociedadId]);
  const [lado, setLado] = useState<"practicada" | "sufrida">("practicada");
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).filter((r) => r.lado === lado && enRango(r.fecha, desde, hasta)
    && (!q || sinAcentos(`${r.nombre} ${r.cuit} ${r.origen} ${r.impuesto}`).includes(q))), [datos, lado, desde, hasta, q]);
  const cols: Column<FilaRetencion>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (r) => r.fecha, render: (r) => formatDate(r.fecha) },
    { key: "lado", label: "Tipo", sortable: true, sortValue: (r) => r.lado, render: (r) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.lado === "practicada" ? "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>{r.lado === "practicada" ? "Practicada" : "Sufrida"}</span> },
    { key: "impuesto", label: "Impuesto", sortable: true, sortValue: (r) => r.impuesto },
    { key: "origen", label: "Origen", sortable: true, sortValue: (r) => r.origen, render: (r) => <span className="text-xs">{r.origen || "—"}</span> },
    { key: "nombre", label: "Cliente / Proveedor", sortable: true, sortValue: (r) => r.nombre, render: (r) => <span>{r.nombre || "—"}{r.cuit && <span className="block text-[10px] text-zinc-400">CUIT {r.cuit}</span>}</span> },
    { key: "base", label: "Base", sortable: true, sortValue: (r) => r.base ?? 0, className: "text-right", render: (r) => (r.base === null ? "—" : <span className="whitespace-nowrap font-mono">{formatCurrency(r.base, r.moneda)}</span>) },
    { key: "pct", label: "%", sortable: true, sortValue: (r) => r.pct ?? 0, className: "text-right", render: (r) => (r.pct === null ? "—" : `${r.pct}%`) },
    { key: "monto", label: "Retenido", sortable: true, sortValue: (r) => r.monto, className: "text-right", render: (r) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(r.monto, r.moneda)}</span> },
  ];
  return (
    <Marco error={error} cargando={!datos} filtros={<>
      {([["practicada", "Practicadas"], ["sufrida", "Sufridas"]] as const).map(([k, l]) => (
        <button key={k} type="button" onClick={() => setLado(k)}
          className={`rounded-lg border px-3 py-1 text-xs font-medium ${lado === k ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
          {l}
        </button>
      ))}
      <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar nombre, CUIT u OP" />
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      <ExportarSicore sociedadId={sociedadId} desde={desde} hasta={hasta} />
    </>} pie={<>
      <span>{visibles.length} retenciones</span>
      <span>{lado === "practicada" ? "Practicadas" : "Sufridas"} <b className="font-mono">{sumar(visibles, (r) => r.monto, (r) => r.moneda)}</b></span>
    </>}>
      <DataTable columns={cols} data={visibles} emptyMessage="No hay retenciones con ese filtro" />
    </Marco>
  );
}
