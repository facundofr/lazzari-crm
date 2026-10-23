"use client";

/**
 * Ficha 360 del cliente: todo lo que se le cotizó (con renglones, fechas, montos y si se ganó o no),
 * artículos con precios, facturas, cobros, muestras, informe BCRA y oportunidades de venta.
 * Solo lectura: no modifica nada.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { BCRACard } from "@/components/clientes/bcra-card";
import { traerTodo } from "@/lib/paginar";
import {
  ESTADOS_GANADOS, ESTADOS_PERDIDOS, TIPO_LABEL, calcularOportunidades, claveArticulo,
  type FacturaHist, type ItemHist, type PRHist, type TipoOportunidad,
} from "@/lib/oportunidades";
import { totalVentasNeto } from "@/lib/ventas-documentos";
import { calcularSaldosClientes, superaLimiteCredito, type SaldoCliente, type MovimientoCC, type AplicacionCC, type AjusteClienteCC } from "@/lib/saldo-clientes";
import { ChevronDown, ChevronRight, Lightbulb, Loader2, Search } from "lucide-react";

const db = supabase as any;
type Moneda = "ARS" | "USD";
const mon = (m: string | null | undefined): Moneda => (m === "USD" ? "USD" : "ARS");
const DIA = 86400_000;
const diasDesde = (f: string) => Math.floor((Date.now() - new Date(`${f.slice(0, 10)}T12:00:00`).getTime()) / DIA);

interface Factura { id: string; tipo: string; punto_venta: number | string; numero: number | string; fecha: string; total: number; moneda: string; estado: string; factura_origen_id?: string | null; total_acreditado?: number | null; saldo_a_favor_cliente?: number | null; cliente_id?: string }
interface Cobro { id: string; fecha: string; monto: number; moneda: string; descripcion: string | null }
interface MuestraAbierta { numero: string; fecha: string; pendientes: number }

type Vista = "resumen" | "presupuestos" | "articulos" | "facturas" | "muestras";

const TIPO_COLOR: Record<TipoOportunidad, string> = {
  recompra: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  temporada: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  reactivar: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  complementario: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  dormido: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function estadoClase(e: string) {
  if (ESTADOS_GANADOS.includes(e)) return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400";
  if (ESTADOS_PERDIDOS.includes(e)) return "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400";
  return "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400";
}

/** Suma por moneda y lo muestra como "$ x · US$ y". */
function porMoneda(lista: Array<{ monto: number; moneda: string }>) {
  const t = { ARS: 0, USD: 0 };
  for (const x of lista) t[mon(x.moneda)] += Number(x.monto) || 0;
  return t;
}
function textoMonedas(t: { ARS: number; USD: number }) {
  const partes = [];
  if (t.ARS || !t.USD) partes.push(formatCurrency(t.ARS));
  if (t.USD) partes.push(formatCurrency(t.USD, "USD"));
  return partes.join(" · ");
}

// Los cobros se guardan con el medio de pago como tipo (ver facturacion-content.tsx), no solo "cobro".
const TIPOS_COBRO = ["cobro", "transferencia", "efectivo", "tarjeta", "link_pago", "cheque_recibido", "echeq", "retencion_iibb", "retencion_ganancias", "retencion_iva"];

export function Ficha360({ sociedadId, cliente }: { sociedadId: string | undefined; cliente: { id: string; razon_social: string; cuit?: string | null; limite_credito?: number | null } }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("resumen");
  const [prs, setPrs] = useState<PRHist[]>([]);
  const [items, setItems] = useState<ItemHist[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [muestras, setMuestras] = useState<MuestraAbierta[]>([]);
  const [saldoCC, setSaldoCC] = useState<SaldoCliente | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [filtroPr, setFiltroPr] = useState<"todos" | "ganados" | "perdidos" | "abiertos">("todos");
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    let cancel = false;
    async function cargar() {
      if (!sociedadId) return;
      setLoading(true); setError(null);
      try {
        const camposFactura = "id, cliente_id, tipo, punto_venta, numero, fecha, total, moneda, estado, factura_origen_id, total_acreditado";
        const armarFacturas = (campos: string) => () => db.from("facturas").select(campos).eq("cliente_id", cliente.id).eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("id");
        const traerFacturas = async () => {
          try { return { data: await traerTodo(armarFacturas(`${camposFactura}, saldo_a_favor_cliente`)), error: null }; }
          catch {
            try { return { data: await traerTodo(armarFacturas(camposFactura)), error: null }; }
            catch (e) { return { data: null, error: e }; }
          }
        };
        const [prRes, fRes, cRes, mRes] = await Promise.all([
          db.from("presupuestos").select("id, cliente_id, numero, fecha, estado, total, moneda, motivo_rechazo").eq("cliente_id", cliente.id).eq("sociedad_id", sociedadId).order("fecha", { ascending: false }),
          traerFacturas(),
          db.from("movimientos").select("id, fecha, monto, moneda, descripcion, anulado").eq("cliente_id", cliente.id).in("tipo", TIPOS_COBRO).eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).limit(300),
          db.from("muestra_envios").select("id, numero, fecha, estado").eq("cliente_id", cliente.id).eq("sociedad_id", sociedadId).neq("estado", "devuelto").neq("estado", "cerrado"),
        ]);
        if (prRes.error) throw prRes.error;
        const lista: PRHist[] = (prRes.data || []).map((p: any) => ({ ...p, fecha: String(p.fecha || "").slice(0, 10), total: Number(p.total) || 0, moneda: mon(p.moneda) }));
        const ids = lista.map(p => p.id);
        const its: ItemHist[] = [];
        for (let i = 0; i < ids.length; i += 150) {
          const lote = ids.slice(i, i + 150);
          const data = await traerTodo(() => db.from("presupuesto_items").select("id, presupuesto_id, codigo, descripcion, cantidad, precio_venta, orden").in("presupuesto_id", lote).order("orden").order("id"));
          its.push(...data.map((x: any) => ({ ...x, cantidad: Number(x.cantidad) || 0, precio_venta: x.precio_venta != null ? Number(x.precio_venta) : null })));
        }
        // Muestras abiertas (si la tabla de muestras no está, se ignora)
        let abiertas: MuestraAbierta[] = [];
        if (!mRes.error && mRes.data?.length) {
          const { data: mi } = await db.from("muestra_envio_items").select("envio_id, cantidad, cantidad_devuelta, cantidad_vendida, cantidad_baja").in("envio_id", mRes.data.map((m: any) => m.id));
          abiertas = mRes.data.map((m: any) => ({
            numero: m.numero, fecha: m.fecha,
            pendientes: (mi || []).filter((x: any) => x.envio_id === m.id).reduce((s: number, x: any) => s + Math.max(0, x.cantidad - (x.cantidad_devuelta || 0) - (x.cantidad_vendida || 0) - (x.cantidad_baja || 0)), 0),
          })).filter((m: MuestraAbierta) => m.pendientes > 0);
        }
        // Saldo de cuenta corriente real (B3): facturas − NC − cobros (incluye retenciones), ARS y USD aparte.
        let saldo: SaldoCliente | null = null;
        if (!fRes.error) {
          const facturasCli = (fRes.data || []) as Factura[];
          const idsF = facturasCli.filter(f => f.estado !== "anulada").map(f => f.id);
          const movs: MovimientoCC[] = [];
          const apls: AplicacionCC[] = [];
          try {
            for (let i = 0; i < idsF.length; i += 150) {
              const lote = idsF.slice(i, i + 150);
              const [mv, ap] = await Promise.all([
                traerTodo<MovimientoCC>(() => db.from("movimientos").select("id, factura_id, monto, moneda, anulado").in("factura_id", lote).eq("sociedad_id", sociedadId).order("id")),
                traerTodo<AplicacionCC>(() => db.from("cobro_aplicaciones").select("movimiento_id, factura_id, monto, movimientos!inner(anulado, sociedad_id)").in("factura_id", lote).eq("movimientos.sociedad_id", sociedadId).order("movimiento_id").order("factura_id")),
              ]);
              movs.push(...mv); apls.push(...ap);
            }
            // Ajustes de CC del cliente sin factura (p. ej. diferencia de un cobro pasada a la cuenta corriente).
            const ajs = await traerTodo<AjusteClienteCC>(() => db.from("movimientos").select("id, cliente_id, monto, moneda, anulado, ajuste_sentido")
              .eq("cliente_id", cliente.id).eq("sociedad_id", sociedadId).is("factura_id", null).not("ajuste_sentido", "is", null).order("id")).catch(() => [] as AjusteClienteCC[]);
            saldo = calcularSaldosClientes(facturasCli.map(f => ({ ...f, cliente_id: cliente.id })), movs, apls, ajs)[cliente.id]
              || { ARS: { deuda: 0, aFavor: 0, saldo: 0 }, USD: { deuda: 0, aFavor: 0, saldo: 0 } };
          } catch { saldo = null; }
        }
        if (cancel) return;
        setSaldoCC(saldo);
        setPrs(lista);
        setItems(its);
        if (fRes.error) throw fRes.error;
        setFacturas((fRes.data || []).map((f: any) => ({ ...f, total: Number(f.total) || 0, moneda: mon(f.moneda) })));
        setCobros((cRes.data || []).filter((c: any) => !c.anulado).map((c: any) => ({ ...c, monto: Number(c.monto) || 0, moneda: mon(c.moneda) })));
        setMuestras(abiertas);
      } catch (e: any) {
        if (!cancel) setError(e?.message || "No se pudo cargar la ficha");
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    void cargar();
    return () => { cancel = true; };
  }, [cliente.id, sociedadId]);

  const itemsPorPr = useMemo(() => {
    const m = new Map<string, ItemHist[]>();
    for (const i of items) { const l = m.get(i.presupuesto_id) || []; l.push(i); m.set(i.presupuesto_id, l); }
    return m;
  }, [items]);

  const facturasValidas = useMemo(() => facturas.filter(f => f.estado !== "anulada"), [facturas]);
  const oportunidades = useMemo(() => calcularOportunidades(prs, items, facturasValidas.map(f => ({ cliente_id: cliente.id, fecha: String(f.fecha).slice(0, 10), total: f.total, moneda: f.moneda, tipo: String(f.tipo), estado: f.estado })) as FacturaHist[]), [prs, items, facturasValidas, cliente.id]);

  // ── KPIs ──
  const kpi = useMemo(() => {
    const ganados = prs.filter(p => ESTADOS_GANADOS.includes(p.estado));
    const perdidos = prs.filter(p => ESTADOS_PERDIDOS.includes(p.estado));
    const decididos = ganados.length + perdidos.length;
    const montoGan = porMoneda(ganados.map(p => ({ monto: p.total, moneda: p.moneda })));
    const montoDec = porMoneda([...ganados, ...perdidos].map(p => ({ monto: p.total, moneda: p.moneda })));
    const hace12 = new Date(Date.now() - 365 * DIA).toISOString().slice(0, 10);
    const esNC = (t: string) => /^NC/i.test(String(t));
    // B7: la NC de una factura anulada no se resta otra vez (la factura ya quedó afuera).
    const estadoPorId = new Map(facturas.map(f => [f.id, f.estado] as [string, string]));
    const fact12Todas = facturas.filter(f => String(f.fecha).slice(0, 10) >= hace12);
    const facturadoEn = (m: Moneda) => totalVentasNeto(fact12Todas.filter(f => mon(f.moneda) === m), id => estadoPorId.get(id));
    const fechasCompra = [...new Set([...ganados.map(p => p.fecha), ...facturasValidas.filter(f => !esNC(f.tipo)).map(f => String(f.fecha).slice(0, 10))])].sort();
    const frecuencia = fechasCompra.length >= 2
      ? Math.round((new Date(fechasCompra[fechasCompra.length - 1]).getTime() - new Date(fechasCompra[0]).getTime()) / DIA / (fechasCompra.length - 1)) : null;
    return {
      cotizados: prs.length,
      cotizado: porMoneda(prs.map(p => ({ monto: p.total, moneda: p.moneda }))),
      ganados: ganados.length,
      ganado: montoGan,
      conversion: decididos ? Math.round((ganados.length / decididos) * 100) : null,
      conversionMonto: montoDec.ARS ? Math.round((montoGan.ARS / montoDec.ARS) * 100) : null,
      ticket: ganados.length ? { ARS: montoGan.ARS / Math.max(1, ganados.filter(p => p.moneda === "ARS").length), USD: montoGan.USD / Math.max(1, ganados.filter(p => p.moneda === "USD").length) } : null,
      ultimaCompra: fechasCompra[fechasCompra.length - 1] || null,
      frecuencia,
      facturado12: { ARS: facturadoEn("ARS"), USD: facturadoEn("USD") },
      cobrado12: porMoneda(cobros.filter(c => String(c.fecha).slice(0, 10) >= hace12)),
      abiertos: prs.filter(p => !ESTADOS_GANADOS.includes(p.estado) && !ESTADOS_PERDIDOS.includes(p.estado)).length,
    };
  }, [prs, facturas, facturasValidas, cobros]);

  // ── Artículos ──
  const articulos = useMemo(() => {
    const prPorId = new Map(prs.map(p => [p.id, p]));
    const m = new Map<string, { desc: string; codigo: string; cotizado: number; ganado: number; cantGanada: number; ultPrecio: number | null; ultFecha: string; ultMoneda: Moneda; min: number | null; max: number | null }>();
    for (const it of items) {
      const p = prPorId.get(it.presupuesto_id);
      if (!p) continue;
      const k = claveArticulo(it);
      const a = m.get(k) || { desc: it.descripcion, codigo: it.codigo || "", cotizado: 0, ganado: 0, cantGanada: 0, ultPrecio: null, ultFecha: "", ultMoneda: "ARS" as Moneda, min: null, max: null };
      a.cotizado++;
      const gano = ESTADOS_GANADOS.includes(p.estado);
      if (gano) { a.ganado++; a.cantGanada += it.cantidad; }
      const precio = it.precio_venta;
      if (precio != null && p.fecha >= a.ultFecha) { a.ultPrecio = precio; a.ultFecha = p.fecha; a.ultMoneda = mon(p.moneda); a.desc = it.descripcion || a.desc; }
      if (precio != null && mon(p.moneda) === a.ultMoneda) { a.min = a.min == null ? precio : Math.min(a.min, precio); a.max = a.max == null ? precio : Math.max(a.max, precio); }
      m.set(k, a);
    }
    return [...m.values()].sort((a, b) => b.cantGanada - a.cantGanada || b.cotizado - a.cotizado);
  }, [prs, items]);

  const q = buscar.trim().toLowerCase();
  const prsFiltrados = prs.filter(p => {
    if (filtroPr === "ganados" && !ESTADOS_GANADOS.includes(p.estado)) return false;
    if (filtroPr === "perdidos" && !ESTADOS_PERDIDOS.includes(p.estado)) return false;
    if (filtroPr === "abiertos" && (ESTADOS_GANADOS.includes(p.estado) || ESTADOS_PERDIDOS.includes(p.estado))) return false;
    if (!q) return true;
    return `${p.numero || ""} ${(itemsPorPr.get(p.id) || []).map(i => `${i.codigo || ""} ${i.descripcion}`).join(" ")}`.toLowerCase().includes(q);
  });
  const articulosFiltrados = articulos.filter(a => !q || `${a.codigo} ${a.desc}`.toLowerCase().includes(q));

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>;
  if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;

  const Kpi = ({ label, valor, sub }: { label: string; valor: string; sub?: string }) => (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-sm font-bold dark:text-white">{valor}</p>
      {sub && <p className="text-[10px] text-zinc-400">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {([["resumen", "Resumen"], ["presupuestos", `Presupuestos (${prs.length})`], ["articulos", `Artículos (${articulos.length})`], ["facturas", `Facturas y cobros (${facturas.length})`], ["muestras", `Muestras (${muestras.length})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${vista === k ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>{l}</button>
        ))}
      </div>

      {vista === "resumen" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Cotizado (todo el historial)" valor={textoMonedas(kpi.cotizado)} sub={`${kpi.cotizados} presupuestos · ${kpi.abiertos} abiertos`} />
            <Kpi label="Ganado" valor={textoMonedas(kpi.ganado)} sub={`${kpi.ganados} presupuestos`} />
            <Kpi label="Conversión" valor={kpi.conversion != null ? `${kpi.conversion}% de los presupuestos` : "—"} sub={kpi.conversionMonto != null ? `${kpi.conversionMonto}% del monto en pesos` : undefined} />
            <Kpi label="Ticket promedio ganado" valor={kpi.ticket ? textoMonedas({ ARS: kpi.ganado.ARS ? kpi.ticket.ARS : 0, USD: kpi.ganado.USD ? kpi.ticket.USD : 0 }) : "—"} />
            <Kpi label="Última compra" valor={kpi.ultimaCompra ? formatDate(kpi.ultimaCompra) : "—"} sub={kpi.ultimaCompra ? `hace ${diasDesde(kpi.ultimaCompra)} días` : undefined} />
            <Kpi label="Frecuencia de compra" valor={kpi.frecuencia != null ? `cada ~${kpi.frecuencia} días` : "—"} />
            <Kpi label="Facturado últimos 12 meses" valor={textoMonedas(kpi.facturado12)} sub="neto de notas de crédito" />
            <Kpi label="Cobrado últimos 12 meses" valor={textoMonedas(kpi.cobrado12)} />
            <Kpi
              label="Saldo cuenta corriente"
              valor={saldoCC ? textoMonedas({ ARS: saldoCC.ARS.saldo, USD: saldoCC.USD.saldo }) : "—"}
              sub={saldoCC ? (saldoCC.ARS.aFavor || saldoCC.USD.aFavor ? `incluye saldo a favor ${textoMonedas({ ARS: saldoCC.ARS.aFavor, USD: saldoCC.USD.aFavor })}` : "facturas − NC − cobros") : "no se pudo calcular"}
            />
          </div>
          {superaLimiteCredito(cliente.limite_credito, saldoCC) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              Aviso: el saldo en pesos alcanzó o superó el límite de crédito ({formatCurrency(Number(cliente.limite_credito) || 0, "ARS")}). Es solo un aviso, no frena nada.
            </p>
          )}

          <BCRACard sociedadId={sociedadId} clienteId={cliente.id} cuit={cliente.cuit} />

          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold dark:text-white"><Lightbulb className="h-4 w-4 text-orange-500" /> Oportunidades de venta</p>
            {oportunidades.length === 0 ? <p className="text-xs text-zinc-400">No hay oportunidades claras con el historial que tenemos.</p> : (
              <ul className="space-y-2">
                {oportunidades.map((o, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${TIPO_COLOR[o.tipo]}`}>{TIPO_LABEL[o.tipo]}</span>
                    <span className="dark:text-zinc-200"><b>{o.titulo}</b> — {o.detalle}{o.monto ? <span className="text-zinc-500"> (~{formatCurrency(o.monto, mon(o.moneda))})</span> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {(vista === "presupuestos" || vista === "articulos") && (
        <div className="flex flex-wrap items-center gap-2">
          {vista === "presupuestos" && ([["todos", "Todos"], ["ganados", "Ganados"], ["perdidos", "Perdidos"], ["abiertos", "Abiertos"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFiltroPr(k)} className={`rounded-lg border px-2 py-1 text-xs ${filtroPr === k ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>{l}</button>
          ))}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-400" />
            <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar artículo o número…" className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
          </div>
        </div>
      )}

      {vista === "presupuestos" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-800/50"><tr><th className="w-6"></th><th className="px-2 py-2">Fecha</th><th className="px-2">Número</th><th className="px-2">Renglones</th><th className="px-2 text-right">Total</th><th className="px-2">Estado</th></tr></thead>
            <tbody>
              {prsFiltrados.map(p => {
                const its = itemsPorPr.get(p.id) || [];
                const open = abierto === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr onClick={() => setAbierto(open ? null : p.id)} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800/40">
                      <td className="pl-2">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatDate(p.fecha)}</td>
                      <td className="px-2 font-mono">{p.numero || "—"}</td>
                      <td className="max-w-[260px] truncate px-2 text-zinc-500">{its.length} · {its.slice(0, 2).map(i => i.descripcion).join(", ")}</td>
                      <td className="whitespace-nowrap px-2 text-right">{formatCurrency(p.total, mon(p.moneda))}</td>
                      <td className="px-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${estadoClase(p.estado)}`}>{p.estado}</span></td>
                    </tr>
                    {open && (
                      <tr className="bg-zinc-50/60 dark:bg-zinc-900/60">
                        <td></td>
                        <td colSpan={5} className="px-2 pb-2">
                          {p.motivo_rechazo && <p className="py-1 text-[11px] text-red-600">Motivo: {p.motivo_rechazo}</p>}
                          <table className="w-full">
                            <tbody>
                              {its.map((i, k) => (
                                <tr key={k} className="border-t border-zinc-200/60 dark:border-zinc-700/60 dark:text-zinc-300">
                                  <td className="py-1 pr-2 font-mono text-[10px] text-zinc-500">{i.codigo}</td>
                                  <td className="pr-2">{i.descripcion}</td>
                                  <td className="pr-2 text-right">{i.cantidad}</td>
                                  <td className="text-right">{i.precio_venta != null ? formatCurrency(i.precio_venta, mon(p.moneda)) : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!prsFiltrados.length && <tr><td colSpan={6} className="py-6 text-center text-zinc-400">Sin presupuestos.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {vista === "articulos" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-800/50">
              <tr><th className="px-2 py-2">Artículo</th><th className="px-2 text-right">Cotizado</th><th className="px-2 text-right">Ganado</th><th className="px-2 text-right">Unid. vendidas</th><th className="px-2 text-right">Último precio</th><th className="px-2 text-right">Rango</th></tr>
            </thead>
            <tbody>
              {articulosFiltrados.slice(0, 300).map((a, i) => (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                  <td className="px-2 py-1.5"><span className="mr-1 font-mono text-[10px] text-zinc-500">{a.codigo}</span>{a.desc}</td>
                  <td className="px-2 text-right">{a.cotizado}×</td>
                  <td className="px-2 text-right">{a.ganado ? `${a.ganado}×` : "—"}</td>
                  <td className="px-2 text-right">{a.cantGanada || "—"}</td>
                  <td className="whitespace-nowrap px-2 text-right">{a.ultPrecio != null ? <>{formatCurrency(a.ultPrecio, a.ultMoneda)}<span className="block text-[10px] text-zinc-400">{formatDate(a.ultFecha)}</span></> : "—"}</td>
                  <td className="whitespace-nowrap px-2 text-right text-zinc-500">{a.min != null && a.max != null && a.min !== a.max ? `${formatCurrency(a.min, a.ultMoneda)} – ${formatCurrency(a.max, a.ultMoneda)}` : ""}</td>
                </tr>
              ))}
              {!articulosFiltrados.length && <tr><td colSpan={6} className="py-6 text-center text-zinc-400">Sin artículos.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {vista === "facturas" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <p className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold dark:border-zinc-800 dark:text-white">Facturas y notas</p>
            <table className="w-full text-xs">
              <tbody>
                {facturas.slice(0, 200).map(f => (
                  <tr key={f.id} className={`border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200 ${f.estado === "anulada" ? "opacity-50 line-through" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5">{formatDate(String(f.fecha).slice(0, 10))}</td>
                    <td className="px-2 font-mono">{f.tipo} {String(f.punto_venta).padStart(4, "0")}-{String(f.numero).padStart(8, "0")}</td>
                    <td className="whitespace-nowrap px-2 text-right">{formatCurrency(f.total, mon(f.moneda))}</td>
                    <td className="px-2 text-zinc-500">{f.estado}</td>
                  </tr>
                ))}
                {!facturas.length && <tr><td className="py-6 text-center text-zinc-400">Sin facturas.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <p className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold dark:border-zinc-800 dark:text-white">Cobros</p>
            <table className="w-full text-xs">
              <tbody>
                {cobros.slice(0, 200).map(c => (
                  <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                    <td className="whitespace-nowrap px-2 py-1.5">{formatDate(String(c.fecha).slice(0, 10))}</td>
                    <td className="max-w-[220px] truncate px-2 text-zinc-500">{c.descripcion}</td>
                    <td className="whitespace-nowrap px-2 text-right">{formatCurrency(c.monto, mon(c.moneda))}</td>
                  </tr>
                ))}
                {!cobros.length && <tr><td className="py-6 text-center text-zinc-400">Sin cobros.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vista === "muestras" && (
        <div className="rounded-xl border border-zinc-200 p-3 text-xs dark:border-zinc-800">
          {muestras.length === 0 ? <p className="text-zinc-400">No tiene muestras en su poder.</p> : (
            <ul className="space-y-1">
              {muestras.map(m => (
                <li key={m.numero} className="dark:text-zinc-200"><span className="font-mono">{m.numero}</span> · entregadas el {formatDate(m.fecha)} (hace {diasDesde(m.fecha)} días) · <b>{m.pendientes}</b> prenda(s) en el cliente{diasDesde(m.fecha) > 30 && <span className="ml-1 font-semibold text-amber-600">· más de 30 días</span>}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
