"use client";

// Finanzas Lazza → Órdenes de pago, Recibos, Retenciones y Movimientos (solo lectura).
// Mismos datos y reglas que las pestañas de Finanzas; acá solo se miran, con filtros y orden por columna.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { clasificarMovimiento, esCobroDeCliente, type ClaseMovimiento } from "@/lib/tipos-movimiento";
import { armarRetenciones, type FilaRetencion } from "@/lib/finanzas-lazza";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const mon = (m: unknown): "ARS" | "USD" => (String(m || "").toUpperCase() === "USD" ? "USD" : "ARS");
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const primeroDelMes = () => `${todayAR().slice(0, 7)}-01`;

const TIPO_LABEL: Record<string, string> = {
  cobro: "Cobro", pago: "Pago", cheque_emitido: "Cheque emitido", cheque_recibido: "Cheque recibido", transferencia: "Transferencia",
  efectivo: "Efectivo", deposito: "Depósito", ajuste: "Ajuste", tarjeta: "Tarjeta", echeq: "E-Cheq",
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

// ── Órdenes de pago ─────────────────────────────────────────────────

interface OP { id: string; numero: string; fecha: string; proveedor: string; cuit: string; bruto: number; retGan: number; retPct: number | null; neto: number; moneda: "ARS" | "USD"; medios: string[]; estado: string; enviada: string | null; sobreVerde: boolean }

export function FinanzasLazzaOrdenesPago({ sociedadId }: { sociedadId: string }) {
  const { datos, error } = useCarga<OP[]>(async () => {
    const rows = await traerTodo<any>(() => db.from("ordenes_pago").select("*, proveedores(razon_social, cuit)").eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("id"));
    return rows.map((r) => {
      let medios: any[] = [];
      try { medios = Array.isArray(r.medios_pago) ? r.medios_pago : r.medios_pago ? JSON.parse(r.medios_pago) : []; } catch { medios = []; }
      return {
        id: r.id, numero: String(r.numero ?? ""), fecha: String(r.fecha).slice(0, 10), proveedor: r.proveedores?.razon_social || "", cuit: r.proveedores?.cuit || "",
        bruto: Number(r.monto_bruto || 0), retGan: Number(r.retencion_ganancias_monto || 0), retPct: r.retencion_ganancias_pct ?? null,
        neto: Number(r.neto_a_pagar ?? r.neto ?? 0), moneda: mon(r.moneda),
        medios: medios.length > 1 ? medios.map((m) => MEDIO_LABEL[m.tipo] || m.tipo) : [MEDIO_LABEL[r.medio_pago || "transferencia"] || r.medio_pago || "Transf."],
        estado: r.estado || "pendiente", enviada: r.email_enviado_at || null, sobreVerde: !!r.sobre_verde,
      };
    });
  }, [sociedadId]);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("");
  const [envio, setEnvio] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).filter((o) =>
    (!estado || o.estado === estado) && (!envio || (envio === "si") === !!o.enviada) && enRango(o.fecha, desde, hasta)
    && (!q || sinAcentos(`${o.numero} ${o.proveedor} ${o.cuit} ${o.medios.join(" ")}`).includes(q))), [datos, estado, envio, desde, hasta, q]);
  const cols: Column<OP>[] = [
    { key: "numero", label: "N°", sortable: true, sortValue: (o) => o.numero, render: (o) => <span className="font-mono text-xs">{o.numero}</span> },
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (o) => o.fecha, render: (o) => formatDate(o.fecha) },
    { key: "proveedor", label: "Proveedor", sortable: true, sortValue: (o) => o.proveedor },
    { key: "bruto", label: "Bruto", sortable: true, sortValue: (o) => o.bruto, className: "text-right", render: (o) => <span className="whitespace-nowrap font-mono">{formatCurrency(o.bruto, o.moneda)}</span> },
    { key: "ret", label: "Ret. Gan.", sortable: true, sortValue: (o) => o.retGan, className: "text-right", render: (o) => o.retGan > 0 ? <span className="whitespace-nowrap font-mono">{formatCurrency(o.retGan, o.moneda)}{o.retPct !== null && <span className="block text-[10px] text-zinc-400">{o.retPct}%</span>}</span> : "—" },
    { key: "neto", label: "Entregado", sortable: true, sortValue: (o) => o.neto, className: "text-right", render: (o) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(o.neto, o.moneda)}</span> },
    { key: "medio", label: "Medio", sortable: true, sortValue: (o) => o.medios.join(" "), render: (o) => <span className="text-xs">{o.medios.join(" · ")}</span> },
    { key: "estado", label: "Estado", sortable: true, sortValue: (o) => o.estado, render: (o) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${o.estado === "pagada" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : o.estado === "anulada" ? "bg-red-50 text-red-700 line-through dark:bg-red-950/40 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>{o.estado === "pagada" ? "Pagada" : o.estado === "anulada" ? "Anulada" : "Pendiente"}</span> },
    { key: "enviada", label: "Enviada", sortable: true, sortValue: (o) => o.enviada || "", render: (o) => o.enviada ? <span className="text-xs text-emerald-600">✓ {formatDate(o.enviada)}</span> : o.sobreVerde ? <span className="text-xs text-zinc-500">Sobre verde</span> : <span className="text-xs text-zinc-400">—</span> },
  ];
  return (
    <Marco error={error} cargando={!datos} filtros={<>
      <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar N°, proveedor, CUIT o medio" />
      <select value={estado} onChange={(e) => setEstado(e.target.value)} className={control}><option value="">Todos los estados</option><option value="pendiente">Pendientes</option><option value="pagada">Pagadas</option><option value="anulada">Anuladas</option></select>
      <select value={envio} onChange={(e) => setEnvio(e.target.value)} className={control}><option value="">Enviadas y no</option><option value="si">Enviadas por mail</option><option value="no">No enviadas</option></select>
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
    </>} pie={<><span>{visibles.length} órdenes</span><span>Entregado <b className="font-mono">{sumar(visibles.filter((o) => o.estado !== "anulada"), (o) => o.neto, (o) => o.moneda)}</b></span></>}>
      <DataTable columns={cols} data={visibles} emptyMessage="No hay órdenes de pago con ese filtro" />
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

export function FinanzasLazzaRecibos({ sociedadId }: { sociedadId: string }) {
  const { datos, error } = useCarga(() => traerMovimientos(sociedadId).then((m) => m.filter((x) => x.cobro)), [sociedadId]);
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
    <Marco error={error} cargando={!datos} filtros={<>
      <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar cliente o detalle" />
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
    </>} pie={<><span>{visibles.length} cobros (hoy 1 recibo = 1 movimiento)</span><span>Cobrado <b className="font-mono text-emerald-700 dark:text-emerald-400">{sumar(visibles, (m) => m.monto, (m) => m.moneda)}</b></span></>}>
      <DataTable columns={cols} data={visibles} emptyMessage="No hay cobros con ese filtro" />
    </Marco>
  );
}

const CLASE_LABEL: Record<ClaseMovimiento, string> = { ingreso: "Cobro / ingreso", egreso: "Pago / egreso", retencion_sufrida: "Retención sufrida", ajuste: "Ajuste", neutro: "Otro" };

export function FinanzasLazzaMovimientos({ sociedadId }: { sociedadId: string }) {
  const { datos, error } = useCarga(() => traerMovimientos(sociedadId), [sociedadId]);
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
    <Marco error={error} cargando={!datos} filtros={<>
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
  );
}

// ── Retenciones ─────────────────────────────────────────────────────

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
  const [lado, setLado] = useState<"" | "practicada" | "sufrida">("");
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).filter((r) => (!lado || r.lado === lado) && enRango(r.fecha, desde, hasta)
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
      {([["", "Todas"], ["practicada", "Practicadas"], ["sufrida", "Sufridas"]] as const).map(([k, l]) => (
        <button key={k} type="button" onClick={() => setLado(k)}
          className={`rounded-lg border px-3 py-1 text-xs font-medium ${lado === k ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
          {l}
        </button>
      ))}
      <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar nombre, CUIT u OP" />
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
    </>} pie={<>
      <span>{visibles.length} retenciones</span>
      {lado !== "sufrida" && <span>Practicadas <b className="font-mono">{sumar(visibles.filter((r) => r.lado === "practicada"), (r) => r.monto, (r) => r.moneda)}</b></span>}
      {lado !== "practicada" && <span>Sufridas <b className="font-mono">{sumar(visibles.filter((r) => r.lado === "sufrida"), (r) => r.monto, (r) => r.moneda)}</b></span>}
    </>}>
      <DataTable columns={cols} data={visibles} emptyMessage="No hay retenciones con ese filtro" />
    </Marco>
  );
}
