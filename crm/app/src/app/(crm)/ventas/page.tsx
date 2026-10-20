"use client";

/**
 * Ventas: seguimiento de cada operación (presupuesto aprobado) hasta que está entregada, facturada y cobrada.
 * Esta pantalla NO repite acciones: facturar usa la ventana única de Facturación (EmitirFacturaModal),
 * cobrar y NC abren Finanzas en esa factura, la OC se carga en el presupuesto y el remito se arma desde el presupuesto.
 * Qué le falta a cada venta: lib/ventas-etapas.ts.
 */

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { traerTodo } from "@/lib/paginar";
import { traerDatosSaldoClientes, calcularSaldosClientes, cobradoPorFactura as calcularCobradoPorFactura, saldoClienteEn, type SaldoCliente } from "@/lib/saldo-clientes";
import { etapaVenta, enBandeja, resumenBandeja, type BandejaVenta, type PasoVenta, type VentaEtapa } from "@/lib/ventas-etapas";
import { esNotaCredito } from "@/lib/ventas-documentos";
import { abrirFacturaPDF } from "@/lib/factura-pdf";
import { useArcaStatus } from "@/lib/use-arca-status";
import { EmitirFacturaModal, type PresupuestoAFacturar } from "@/components/facturacion/emitir-factura-modal";
import Link from "next/link";
import {
  FileText, Receipt, Truck, CheckCircle2, Loader2, X, DollarSign, Eye, AlertCircle, AlertTriangle,
  ArrowRight, Clock, Package, ClipboardList, Search, Download, Mail, MailCheck, Ban, Inbox,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRefrescarAlVolver } from "@/lib/use-refrescar";

// ── Types ────────────────────────────────────────────────────────

interface VentaPresupuesto {
  id: string;
  numero: string;
  cliente_id: string;
  fecha: string;
  estado: string;
  total: number;
  moneda: string;
  cotizacion_modalidad?: "divisas" | "billetes" | null;
  modalidad_emision?: string | null;
  vendedor_id: string | null;
  oc_cliente: string | null;
  oc_cliente_fecha?: string | null;
  archivo_url: string | null;
  observaciones: string | null;
  vendedor_profile: { full_name: string } | null;
  clientes: {
    razon_social: string; cuit: string; condicion_iva: string; forma_pago: string | null;
    dias_cuenta_corriente?: number | null; limite_credito?: number | null; moneda_predeterminada?: string | null;
    email?: string | null; email_facturacion?: string | null; pide_oc_para_facturar?: boolean | null;
  } | null;
  presupuesto_items: { descripcion: string; cantidad: number; precio_venta: number | null; iva_porcentaje: number; total: number | null }[];
}

interface VentaFactura {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  fecha: string;
  cae: string | null;
  total: number;
  total_acreditado?: number | null;
  moneda: string;
  estado: string;
  presupuesto_id: string | null;
  fecha_vencimiento?: string | null;
  email_enviado_at?: string | null;
  email_enviado_a?: string | null;
}

interface VentaRemito { id: string; numero: string; fecha: string; estado: string; presupuesto_id: string | null; foto_url?: string | null; recibio?: string | null }
interface VentaOC { id: string; numero: string; fecha: string; estado: string; total: number; moneda: string; medio_pago: string | null; estado_pago: string | null; presupuesto_origen_id: string }

/** Igual que Órdenes de compra: pagada con tarjeta. */
const ocPagadaConTarjeta = (oc: VentaOC) => oc.estado_pago === "pagada" && oc.medio_pago === "tarjeta";

interface Venta {
  presupuesto: VentaPresupuesto;
  facturas: VentaFactura[];
  remitos: VentaRemito[];
  ordenesCompra: VentaOC[];
}

const BANDEJAS: { key: BandejaVenta; label: string; icon: React.ElementType }[] = [
  { key: "esperando_oc", label: "Esperando OC", icon: Inbox },
  { key: "facturar", label: "Para facturar", icon: Receipt },
  { key: "entregar", label: "Para entregar", icon: Truck },
  { key: "cobrar", label: "Para cobrar", icon: DollarSign },
  { key: "terminadas", label: "Terminadas", icon: CheckCircle2 },
  { key: "todas", label: "Todas", icon: Package },
];

const PASO_LABEL: Record<PasoVenta, string> = { oc: "Cargar OC", facturar: "Facturar", entregar: "Entregar", cobrar: "Cobrar" };
const DIAS_AVISO_SIN_FACTURAR = 15;

type Periodo = "todo" | "mes" | "mes_anterior" | "90";

function comprobante(f: { tipo: string; punto_venta: number; numero: number }) {
  return `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
}

function enPeriodo(fecha: string, periodo: Periodo, hoy: string): boolean {
  if (periodo === "todo") return true;
  const f = (fecha || "").slice(0, 10);
  const [y, m] = hoy.split("-").map(Number);
  if (periodo === "mes") return f.startsWith(hoy.slice(0, 7));
  if (periodo === "mes_anterior") {
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    return f.startsWith(prev);
  }
  const d = new Date(hoy + "T12:00:00");
  d.setDate(d.getDate() - 90);
  return f >= d.toISOString().slice(0, 10);
}

function leerLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function guardarLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: no se recuerda */ }
}

// ── Component ────────────────────────────────────────────────────

export default function VentasPage() {
  const { role, sociedadActiva } = useUser();
  const permisos = role ? ROLE_PERMISSIONS[role] || [] : [];
  const puede = (modulo: string) => permisos.some(p => p.module === "*" || (p.module === modulo && p.actions.includes("create")));
  const puedeFacturar = puede("facturacion");
  const puedeCobrar = puede("finanzas");
  const arcaStatus = useArcaStatus(sociedadActiva?.id);
  const hoy = todayAR();

  const [ventas, setVentas] = useState<Venta[]>([]);
  const ventasRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [cobradoPorFactura, setCobradoPorFactura] = useState<Record<string, number> | null>(null);
  const [saldosClientes, setSaldosClientes] = useState<Record<string, SaldoCliente> | null>(null);

  const [bandeja, setBandeja] = useState<BandejaVenta>("facturar");
  const [filterCliente, setFilterCliente] = useState("");
  const [filterVendedor, setFilterVendedor] = useState("todos");
  const [filterMoneda, setFilterMoneda] = useState("todas");
  const [periodo, setPeriodo] = useState<Periodo>("todo");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [selectedVentaId, setSelectedVentaId] = useState<string | null>(null);
  const [emitVenta, setEmitVenta] = useState<Venta | null>(null);
  const [downloadingFacturaId, setDownloadingFacturaId] = useState<string | null>(null);

  // Bandeja recordada en la compu; un link ?venta=ID abre esa venta (desde Presupuestos).
  useEffect(() => {
    const ventaUrl = new URLSearchParams(window.location.search).get("venta");
    if (ventaUrl) { setSelectedVentaId(ventaUrl); setBandeja("todas"); return; }
    const guardada = leerLocal("ventas.bandeja");
    if (guardada && BANDEJAS.some(b => b.key === guardada)) { setBandeja(guardada as BandejaVenta); if (guardada === "facturar") setSortOrder("asc"); }
  }, []);
  function elegirBandeja(b: BandejaVenta) { setBandeja(b); guardarLocal("ventas.bandeja", b); if (b === "facturar") setSortOrder("asc"); }

  const fetchData = useCallback(async () => {
    const request = ++ventasRequest.current;
    if (!sociedadActiva?.id) return;
    try {
      const { data: presupuestos, error: pError } = await supabase
        .from("presupuestos")
        .select(`
          id, numero, cliente_id, fecha, estado, total, moneda, cotizacion_modalidad, vendedor_id, modalidad_emision, oc_cliente, oc_cliente_fecha, archivo_url, archivo_nombre, observaciones,
          vendedor_profile:vendedor_id(full_name),
          clientes(razon_social, cuit, condicion_iva, forma_pago, dias_cuenta_corriente, limite_credito, email, email_facturacion, pide_oc_para_facturar, moneda_predeterminada),
          presupuesto_items(id, descripcion, cantidad, precio_venta, iva_porcentaje, total, orden)
        `)
        .in("estado" as any, ["aprobado", "facturar", "facturado"])
        .neq("eliminado" as any, true)
        .eq("sociedad_id" as any, sociedadActiva.id)
        .order("fecha", { ascending: false });
      if (request !== ventasRequest.current) return;
      if (pError || !presupuestos) {
        console.error("Error fetching presupuestos:", pError);
        setVentas([]);
        return;
      }

      const pIds = presupuestos.map((p: any) => p.id);
      const [facturasRes, remitosRes, ocRes] = pIds.length > 0 ? await Promise.all([
        (supabase as any).from("facturas").select("id, tipo, punto_venta, numero, fecha, cae, total, total_acreditado, moneda, estado, presupuesto_id, fecha_vencimiento, email_enviado_at, email_enviado_a").in("presupuesto_id", pIds).eq("sociedad_id", sociedadActiva.id),
        (supabase as any).from("remitos").select("id, numero, fecha, estado, presupuesto_id, foto_url, recibio").eq("anulado", false).in("presupuesto_id", pIds).eq("sociedad_id", sociedadActiva.id),
        (supabase as any).from("ordenes_compra").select("id, numero, fecha, estado, total, moneda, medio_pago, estado_pago, presupuesto_origen_id").in("presupuesto_origen_id", pIds).eq("sociedad_id", sociedadActiva.id),
      ]) : [{ data: [] }, { data: [] }, { data: [] }];
      if (request !== ventasRequest.current) return;
      const facturas = (facturasRes.data || []) as VentaFactura[];
      const remitos = (remitosRes.data || []) as VentaRemito[];
      const ocs = (ocRes.data || []) as VentaOC[];

      setVentas(presupuestos.map((p: any) => ({
        presupuesto: { ...p, presupuesto_items: [...(p.presupuesto_items || [])].sort((a: any, b: any) => Number(a.orden || 0) - Number(b.orden || 0)) } as VentaPresupuesto,
        facturas: facturas.filter(f => f.presupuesto_id === p.id),
        remitos: remitos.filter(r => r.presupuesto_id === p.id),
        ordenesCompra: ocs.filter(oc => oc.presupuesto_origen_id === p.id),
      })));
    } catch (err) {
      console.error("Error fetching ventas:", err);
      if (request === ventasRequest.current) setVentas([]);
    } finally {
      if (request === ventasRequest.current) setLoading(false);
    }
    // Lo cobrado de cada factura y el saldo de cada cliente (misma regla que Finanzas). Llega después de la lista.
    try {
      const datos = await traerDatosSaldoClientes(supabase, sociedadActiva.id, traerTodo);
      if (request !== ventasRequest.current) return;
      setCobradoPorFactura(calcularCobradoPorFactura(datos.facturas, datos.movimientos, datos.aplicaciones));
      setSaldosClientes(calcularSaldosClientes(datos.facturas, datos.movimientos, datos.aplicaciones, datos.ajustes));
    } catch (err) {
      console.error("Error calculando cobros:", err);
      if (request === ventasRequest.current) { setCobradoPorFactura(null); setSaldosClientes(null); }
    }
  }, [sociedadActiva?.id]);

  useEffect(() => { setLoading(true); void fetchData(); }, [fetchData]);
  useRefrescarAlVolver(fetchData);

  // Los cambios de Presupuestos y Facturación actualizan Ventas.
  useEffect(() => {
    if (!sociedadActiva?.id) return;
    const refresh = () => { if (document.visibilityState === "visible") void fetchData(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const channel = supabase.channel(`ventas-presupuestos-${sociedadActiva.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "presupuestos", filter: `sociedad_id=eq.${sociedadActiva.id}` }, () => { void fetchData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "facturas", filter: `sociedad_id=eq.${sociedadActiva.id}` }, () => { void fetchData(); })
      .subscribe();
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      void supabase.removeChannel(channel);
    };
  }, [fetchData, sociedadActiva?.id]);

  // ── Etapas, filtros y bandejas ─────────────────────────────────

  const etapas = useMemo(() => {
    const map = new Map<string, VentaEtapa>();
    for (const v of ventas) {
      map.set(v.presupuesto.id, etapaVenta({
        fechaPr: v.presupuesto.fecha,
        totalPr: Number(v.presupuesto.total) || 0,
        monedaPr: v.presupuesto.moneda,
        ocCliente: v.presupuesto.oc_cliente,
        clientePideOc: !!v.presupuesto.clientes?.pide_oc_para_facturar,
        facturas: v.facturas,
        remitos: v.remitos,
      }, cobradoPorFactura, hoy));
    }
    return map;
  }, [ventas, cobradoPorFactura, hoy]);

  const vendedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of ventas) if (v.presupuesto.vendedor_id) m.set(v.presupuesto.vendedor_id, v.presupuesto.vendedor_profile?.full_name || "Sin nombre");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [ventas]);

  // Filtros de arriba (sin la bandeja): los usan los contadores de cada bandeja.
  const ventasFiltradas = useMemo(() => {
    const q = filterCliente.toLowerCase().trim();
    return ventas.filter(v => {
      const p = v.presupuesto;
      if (filterVendedor !== "todos" && p.vendedor_id !== filterVendedor) return false;
      if (filterMoneda !== "todas" && p.moneda !== filterMoneda) return false;
      if (!enPeriodo(p.fecha, periodo, hoy)) return false;
      if (q) {
        const textos = [p.clientes?.razon_social, p.numero, p.oc_cliente, ...v.facturas.map(comprobante)];
        if (!textos.some(t => (t || "").toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [ventas, filterCliente, filterVendedor, filterMoneda, periodo, hoy]);

  const resumenes = useMemo(() => {
    const lista = ventasFiltradas.map(v => etapas.get(v.presupuesto.id)!).filter(Boolean);
    return Object.fromEntries(BANDEJAS.map(b => [b.key, resumenBandeja(lista, b.key)])) as Record<BandejaVenta, ReturnType<typeof resumenBandeja>>;
  }, [ventasFiltradas, etapas]);

  const ventasBandeja = useMemo(() => {
    return ventasFiltradas
      .filter(v => { const e = etapas.get(v.presupuesto.id); return e && enBandeja(e, bandeja); })
      .sort((a, b) => {
        // Para facturar: manda la fecha de la OC del cliente (la más vieja se puede facturar con fecha anterior).
        const clave = (v: Venta) => (bandeja === "facturar" ? v.presupuesto.oc_cliente_fecha : null) || v.presupuesto.fecha || "";
        const da = clave(a), db = clave(b);
        return sortOrder === "desc" ? db.localeCompare(da) : da.localeCompare(db);
      });
  }, [ventasFiltradas, etapas, bandeja, sortOrder]);

  const selectedVenta = useMemo(() => ventas.find(v => v.presupuesto.id === selectedVentaId) || null, [ventas, selectedVentaId]);
  // Con el panel abierto, Saldo y Días se ocultan en pantallas medianas (están en el panel).
  const colChica = selectedVenta ? "hidden 2xl:table-cell" : "hidden sm:table-cell";
  const selectedEtapa = selectedVenta ? etapas.get(selectedVenta.presupuesto.id) || null : null;

  function superaLimite(v: Venta): boolean {
    const limite = Number(v.presupuesto.clientes?.limite_credito) || 0;
    if (!limite || !saldosClientes) return false;
    return saldoClienteEn(saldosClientes, v.presupuesto.cliente_id, "ARS") >= limite;
  }

  // ── Acciones (todas llevan a la pantalla única de cada cosa) ───

  function presupuestoAFacturar(v: Venta): PresupuestoAFacturar {
    const p = v.presupuesto;
    return {
      id: p.id, numero: p.numero, cliente_id: p.cliente_id, moneda: p.moneda,
      cotizacion_modalidad: p.cotizacion_modalidad, modalidad_emision: p.modalidad_emision,
      oc_cliente: p.oc_cliente, oc_cliente_fecha: p.oc_cliente_fecha, archivo_url: p.archivo_url, observaciones: p.observaciones,
      cliente: p.clientes ? { ...p.clientes } : null,
      items: p.presupuesto_items || [],
    };
  }

  function abrirFacturar(v: Venta) {
    const e = etapas.get(v.presupuesto.id);
    if (e?.esperandoOc && !confirm(`${v.presupuesto.clientes?.razon_social || "El cliente"} pide OC para facturar y este presupuesto todavía no la tiene.\n\n¿Facturar igual?`)) return;
    setEmitVenta(v);
  }

  async function descargarFactura(facturaId: string, preview?: boolean) {
    if (!sociedadActiva || downloadingFacturaId) return;
    setDownloadingFacturaId(facturaId);
    try { await abrirFacturaPDF(facturaId, sociedadActiva, preview); }
    catch (error) { console.error("Error descargando factura:", error); alert("No se pudo descargar la factura. Intentá nuevamente."); }
    finally { setDownloadingFacturaId(null); }
  }

  async function handleCancelarVenta(prId: string) {
    if (!sociedadActiva?.id) return;
    if (!confirm("¿No facturar este presupuesto? Pasará a estado «rechazado» y saldrá de Ventas.")) return;
    const { error } = await (supabase as any).from("presupuestos").update({ estado: "rechazado" }).eq("id", prId).eq("sociedad_id", sociedadActiva.id);
    if (error) { alert("Error al cancelar: " + error.message); return; }
    setSelectedVentaId(null);
    await fetchData();
  }

  /** Botón "Próximo paso": hace (o abre) lo que falta. */
  function proximoPaso(v: Venta, e: VentaEtapa) {
    const factura = e.facturaVigenteId;
    switch (e.proximoPaso) {
      case "oc": return { label: PASO_LABEL.oc, href: `/presupuestos?selected=${v.presupuesto.id}` };
      case "facturar": return puedeFacturar ? { label: e.refacturar ? "Re-facturar" : PASO_LABEL.facturar, onClick: () => abrirFacturar(v) } : null;
      case "entregar": return { label: v.remitos.length > 0 ? "Ver entrega" : "Remitar", onClick: () => setSelectedVentaId(v.presupuesto.id) };
      case "cobrar": return puedeCobrar && factura ? { label: PASO_LABEL.cobrar, href: `/finanzas?tab=facturacion&grupo=cobrar&factura=${factura}&accion=cobro` } : null;
      default: return null;
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Header title="Ventas" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  const pendientesTotal = ventas.filter(v => !etapas.get(v.presupuesto.id)?.terminada).length;
  const selectClass = "rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white";

  return (
    <>
      <Header title="Ventas" subtitle={`${pendientesTotal} ventas en proceso`} />
      <div className="p-3 sm:p-5 space-y-4">

        {/* "Fichas de relevamiento" oculto (13/10/2026): el componente y la tabla siguen, no se borró nada. */}
        <>
        {/* Bandejas: qué falta, con cantidad y plata */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {BANDEJAS.map(({ key, label, icon: Icon }) => {
            const r = resumenes[key];
            const activa = bandeja === key;
            if (key === "esperando_oc" && r.cantidad === 0 && !activa) return null;
            return (
              <button key={key} onClick={() => elegirBandeja(key)}
                className={`rounded-xl border p-3 text-left transition-colors ${activa ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20" : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950"}`}>
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 uppercase tracking-wide"><Icon className="h-3.5 w-3.5" /> {label}</p>
                <p className="text-xl font-bold mt-0.5 text-zinc-900 dark:text-white">{r.cantidad}</p>
                {key !== "todas" && key !== "terminadas" && (
                  <div className="text-[11px] leading-tight text-zinc-500">
                    {r.ARS > 0 && <p>{formatCurrency(r.ARS, "ARS")}</p>}
                    {r.USD > 0 && <p>{formatCurrency(r.USD, "USD")}</p>}
                    {key === "cobrar" && !cobradoPorFactura && <p className="text-zinc-400">calculando saldo…</p>}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input type="text" value={filterCliente} onChange={e => setFilterCliente(e.target.value)} placeholder="Cliente, PR, OC o factura..."
              className="w-full rounded-lg border border-zinc-300 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          </div>
          <select value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)} className={selectClass}>
            <option value="todos">Todos los vendedores</option>
            {vendedores.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
          <select value={filterMoneda} onChange={e => setFilterMoneda(e.target.value)} className={selectClass}>
            <option value="todas">ARS y USD</option>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
          <select value={periodo} onChange={e => setPeriodo(e.target.value as Periodo)} className={selectClass}>
            <option value="todo">Todas las fechas</option>
            <option value="mes">Este mes</option>
            <option value="mes_anterior">Mes pasado</option>
            <option value="90">Últimos 90 días</option>
          </select>
          <button onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
            className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <Clock className="h-3.5 w-3.5" /> {sortOrder === "desc" ? "Nuevos primero" : "Viejos primero"}
          </button>
          <span className="ml-auto text-sm text-zinc-400">{ventasBandeja.length} venta{ventasBandeja.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Main content */}
        <div className="flex gap-4 items-start">
          {/* Tabla */}
          <div className={`min-w-0 ${selectedVenta ? "hidden lg:block lg:flex-1" : "w-full"}`}>
            {ventasBandeja.length === 0 ? (
              <Card className="p-12 text-center">
                <Package className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
                <p className="text-zinc-500">No hay ventas en esta bandeja con estos filtros</p>
              </Card>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">PR / Cliente</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Estado</th>
                      <th className={`px-3 py-2 text-right font-medium ${colChica}`}>Saldo</th>
                      <th className={`px-3 py-2 text-right font-medium ${colChica}`}>Días</th>
                      <th className="px-3 py-2 text-right font-medium">Próximo paso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {ventasBandeja.map(v => {
                      const p = v.presupuesto;
                      const e = etapas.get(p.id)!;
                      const paso = proximoPaso(v, e);
                      const isSelected = selectedVentaId === p.id;
                      const avisoDias = !e.facturada && e.dias > DIAS_AVISO_SIN_FACTURAR;
                      return (
                        <tr key={p.id} onClick={() => setSelectedVentaId(isSelected ? null : p.id)}
                          className={`cursor-pointer align-top ${isSelected ? "bg-orange-50/60 dark:bg-orange-950/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"}`}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <span className="font-mono text-xs font-bold text-zinc-900 dark:text-white">{p.numero}</span>
                              <span className="text-xs text-zinc-400">{formatDate(p.fecha)}</span>
                            </div>
                            <p className="max-w-[16rem] truncate text-zinc-700 dark:text-zinc-300 leading-tight" title={p.clientes?.razon_social}>{p.clientes?.razon_social}</p>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              {p.vendedor_profile?.full_name && <span className="text-[11px] text-zinc-400">{p.vendedor_profile.full_name}</span>}
                              {p.oc_cliente && <span className="rounded bg-orange-100 px-1.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" title={p.oc_cliente_fecha ? `OC del ${formatDate(p.oc_cliente_fecha)}` : undefined}>OC {p.oc_cliente}{p.oc_cliente_fecha ? ` · ${formatDate(p.oc_cliente_fecha)}` : ""}</span>}
                              {superaLimite(v) && <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="h-3 w-3" /> Límite de crédito</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{formatCurrency(Number(p.total) || 0, p.moneda as "ARS" | "USD")}</td>
                          <td className="px-3 py-2 hidden md:table-cell"><EstadoChips v={v} e={e} /></td>
                          <td className={`px-3 py-2 text-right whitespace-nowrap ${colChica}`}>
                            {e.facturada
                              ? e.saldo === null ? <span className="text-zinc-400">…</span>
                                : e.cobrado ? <span className="text-green-600">Cobrado</span>
                                : <span className={e.vencida ? "font-semibold text-red-600" : e.cobradoParcial ? "text-amber-600" : ""}>{formatCurrency(e.saldo, e.monedaVenta)}</span>
                              : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className={`px-3 py-2 text-right ${colChica} ${avisoDias || e.vencida ? "font-semibold text-amber-600" : "text-zinc-500"}`}
                            title={e.facturada ? "Días desde la factura" : "Días desde el presupuesto"}>
                            {e.terminada ? "" : e.dias}
                          </td>
                          <td className="px-3 py-2 text-right" onClick={ev => ev.stopPropagation()}>
                            {paso ? (
                              paso.href
                                ? <Link href={paso.href} className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-700 whitespace-nowrap">{paso.label} <ArrowRight className="h-3 w-3" /></Link>
                                : <button onClick={paso.onClick} className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-700 whitespace-nowrap">{paso.label} <ArrowRight className="h-3 w-3" /></button>
                            ) : e.terminada ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> Terminada</span>
                            ) : (
                              <span className="text-xs text-zinc-400">{e.pendientes.map(x => PASO_LABEL[x]).join(", ")}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Detalle: todo a la vista */}
          {selectedVenta && selectedEtapa && (
            <div className="w-full lg:w-[340px] lg:shrink-0">
              <DetalleVenta
                v={selectedVenta}
                e={selectedEtapa}
                superaLimite={superaLimite(selectedVenta)}
                puedeFacturar={puedeFacturar}
                puedeCobrar={puedeCobrar}
                downloadingFacturaId={downloadingFacturaId}
                onClose={() => setSelectedVentaId(null)}
                onFacturar={() => abrirFacturar(selectedVenta)}
                onDescargar={descargarFactura}
                onCancelar={() => handleCancelarVenta(selectedVenta.presupuesto.id)}
              />
            </div>
          )}
        </div>
        </>
      </div>

      {emitVenta && (
        <EmitirFacturaModal
          presupuesto={presupuestoAFacturar(emitVenta)}
          arcaCertOk={arcaStatus?.certOk}
          saldoClienteArs={(id) => (saldosClientes ? saldoClienteEn(saldosClientes, id, "ARS") : null)}
          onClose={() => setEmitVenta(null)}
          onEmitted={() => { void fetchData(); }}
        />
      )}
    </>
  );
}

// ── Chips de estado ──────────────────────────────────────────────

function Chip({ ok, warn, icon: Icon, children, title }: { ok?: boolean; warn?: boolean; icon: React.ElementType; children: React.ReactNode; title?: string }) {
  const color = ok ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
    : warn ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${color}`}><Icon className="h-3 w-3" />{children}</span>;
}

function EstadoChips({ v, e }: { v: Venta; e: VentaEtapa }) {
  const factura = v.facturas.find(f => f.id === e.facturaVigenteId);
  return (
    <div className="flex flex-wrap gap-1">
      {e.esperandoOc && <Chip warn icon={Inbox}>Esperando OC</Chip>}
      <Chip ok={e.entregado} warn={e.enEntrega} icon={Truck}>{e.entregado ? "Entregado" : e.enEntrega ? "En entrega" : "Sin entregar"}</Chip>
      <Chip ok={e.facturada} warn={e.refacturar} icon={Receipt}>{e.facturada ? (factura?.cae ? factura.tipo : "Manual") : e.refacturar ? "Re-facturar" : "Sin facturar"}</Chip>
      {e.facturada && <Chip ok={e.cobrado} warn={!e.cobrado} icon={DollarSign}>{e.cobrado ? "Cobrado" : e.vencida ? "Vencida" : e.cobradoParcial ? "Cobro parcial" : "Pend. cobro"}</Chip>}
      {factura && (factura.email_enviado_at
        ? <Chip ok icon={MailCheck} title={`Enviada ${formatDate(factura.email_enviado_at)}${factura.email_enviado_a ? ` a ${factura.email_enviado_a}` : ""}`}>Enviada</Chip>
        : <Chip icon={Mail} title="No enviada por email">No enviada</Chip>)}
    </div>
  );
}

// ── Detalle de la venta ──────────────────────────────────────────

function Seccion({ titulo, icon: Icon, estado, extra, children }: { titulo: string; icon: React.ElementType; estado: "done" | "in-progress" | "pending"; extra?: React.ReactNode; children: React.ReactNode }) {
  const color = estado === "done" ? "text-green-600 dark:text-green-400" : estado === "in-progress" ? "text-orange-500" : "text-zinc-400";
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="flex-1 text-xs font-semibold text-zinc-700 dark:text-zinc-200">{titulo}</span>
        {extra}
        {estado === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
        {estado === "in-progress" && <Clock className="h-3.5 w-3.5 text-orange-500" />}
      </div>
      <div className="mt-1 pl-5 text-xs space-y-1">{children}</div>
    </div>
  );
}

const linkClass = "inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700";
const btnPrimario = "inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-60";
const btnSecundario = "inline-flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60";

function DetalleVenta({
  v, e, superaLimite, puedeFacturar, puedeCobrar, downloadingFacturaId, onClose, onFacturar, onDescargar, onCancelar,
}: {
  v: Venta; e: VentaEtapa; superaLimite: boolean; puedeFacturar: boolean; puedeCobrar: boolean; downloadingFacturaId: string | null;
  onClose: () => void; onFacturar: () => void; onDescargar: (id: string, preview?: boolean) => void;
  onCancelar: () => void;
}) {
  const p = v.presupuesto;
  const factura = v.facturas.find(f => f.id === e.facturaVigenteId) || null;
  const historial = [...v.facturas].sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  const totalFactura = factura ? (Number(factura.total) || 0) - (Number(factura.total_acreditado) || 0) : 0;

  return (
    <Card className="lg:sticky lg:top-4 p-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{p.numero} · {formatCurrency(Number(p.total) || 0, p.moneda as "ARS" | "USD")}</h3>
          <Link href={`/clientes?id=${p.cliente_id}`} className="block truncate text-xs text-zinc-600 hover:text-orange-600 dark:text-zinc-300" title={p.clientes?.razon_social}>{p.clientes?.razon_social}</Link>
          <p className="text-[11px] text-zinc-400">{formatDate(p.fecha)}{p.vendedor_profile?.full_name ? ` · ${p.vendedor_profile.full_name}` : ""} · {p.presupuesto_items?.length || 0} productos · <Link href={`/presupuestos?selected=${p.id}`} className="text-orange-600 hover:underline">Ver PR</Link></p>
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600" title="Cerrar"><X className="h-4 w-4" /></button>
      </div>
      {superaLimite && (
        <div className="mx-3 mt-2 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="mr-1 inline h-3 w-3" /> Superó su límite de crédito (aviso: se puede seguir).
        </div>
      )}

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {/* OC del cliente */}
        <Seccion titulo="OC del cliente" icon={FileText} estado={e.esperandoOc ? "in-progress" : "done"}>
          {p.oc_cliente
            ? <p><span className="font-mono font-semibold">{p.oc_cliente}</span>{p.oc_cliente_fecha ? ` · ${formatDate(p.oc_cliente_fecha)}` : ""}{p.archivo_url && <> · <a href={p.archivo_url} target="_blank" rel="noreferrer" className={linkClass}>Abrir</a></>}</p>
            : <p className={e.esperandoOc ? "text-amber-600 dark:text-amber-400 font-medium" : "text-zinc-400"}>
                {e.esperandoOc ? "Falta (el cliente pide OC para facturar)" : "No cargada"} · <Link href={`/presupuestos?selected=${p.id}`} className={linkClass}>Cargar</Link>
              </p>}
        </Seccion>

        {/* Entrega */}
        <Seccion titulo="Entrega" icon={Truck} estado={e.entregado ? "done" : e.enEntrega ? "in-progress" : "pending"}
          extra={v.remitos.length > 0 ? <Link href="/remitos" className="text-[11px] text-orange-600 hover:underline">Remitos</Link> : null}>
          {v.remitos.length > 0 ? v.remitos.map(r => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="font-mono font-semibold">{r.numero || "Sin número"}</span>
              <span className="text-zinc-400">{formatDate(r.fecha)}</span>
              {r.foto_url && <a href={r.foto_url} target="_blank" rel="noreferrer" className={linkClass} title={r.recibio ? `Recibió ${r.recibio}` : "Remito firmado"}>📷 firmado</a>}
            </div>
          )) : (
            <p className="text-zinc-500">Sin remito · <Link href={`/presupuestos?selected=${p.id}`} className={linkClass}>Remitar desde el PR</Link></p>
          )}
        </Seccion>

        {/* Compras a proveedores para esta venta */}
        {v.ordenesCompra.length > 0 && (
          <Seccion titulo={`Compras a proveedor (${v.ordenesCompra.length})`} icon={ClipboardList} estado={v.ordenesCompra.every(oc => oc.estado === "completada" || oc.estado === "cancelada") ? "done" : "in-progress"}>
            {v.ordenesCompra.map(oc => (
              <div key={oc.id} className="flex items-center gap-2">
                <span className="font-mono font-semibold">{oc.numero}</span>
                <span className="text-zinc-400">{formatDate(oc.fecha)}</span>
                <span className="ml-auto text-zinc-600 dark:text-zinc-300">{formatCurrency(Number(oc.total) || 0, (oc.moneda || "ARS") as "ARS" | "USD")}</span>
                <span className={`rounded px-1.5 text-[10px] font-medium ${oc.estado === "completada" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : oc.estado === "cancelada" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : ocPagadaConTarjeta(oc) ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"}`}>
                  {ocPagadaConTarjeta(oc) ? "tarjeta" : oc.estado}
                </span>
              </div>
            ))}
          </Seccion>
        )}

        {/* Factura y cobro */}
        <Seccion titulo="Factura y cobro" icon={Receipt} estado={e.cobrado ? "done" : e.facturada ? "in-progress" : "pending"}>
          {historial.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Historial:</span>
              {historial.map((f, idx) => (
                <span key={f.id} className="flex items-center gap-1">
                  {idx > 0 && <ArrowRight className="h-3 w-3 text-amber-400 shrink-0" />}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    f.id === e.facturaVigenteId ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                    : esNotaCredito(f.tipo) ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                    : "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-500"}`}>{comprobante(f)}</span>
                </span>
              ))}
            </div>
          )}

          {factura ? (<>
            <div className="flex flex-wrap items-center gap-x-1.5">
              <span className="font-mono font-bold whitespace-nowrap">{comprobante(factura)}</span>
              <span className={`rounded px-1 text-[10px] font-semibold ${factura.cae ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"}`}>{factura.cae ? "ARCA" : "Manual"}</span>
              <span className="ml-auto whitespace-nowrap text-[11px] text-zinc-400">{formatDate(factura.fecha)}{factura.fecha_vencimiento ? ` → vence ${formatDate(factura.fecha_vencimiento)}` : ""}</span>
            </div>
            <div className="flex justify-between"><span className="text-zinc-500">Total{Number(factura.total_acreditado) > 0 ? " (menos NC)" : ""}</span><span className="font-bold">{formatCurrency(totalFactura, (factura.moneda || "ARS") as "ARS" | "USD")}</span></div>
            {e.saldo !== null && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Cobrado <span className="text-green-600">{formatCurrency(Math.max(0, totalFactura - e.saldo), e.monedaVenta)}</span></span>
                <span className={`font-bold ${e.saldo <= 0.01 ? "text-green-600" : e.vencida ? "text-red-600" : ""}`}>{e.saldo <= 0.01 ? "Cobrada" : `Falta ${formatCurrency(e.saldo, e.monedaVenta)}`}{e.vencida ? " (vencida)" : ""}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button onClick={() => onDescargar(factura.id)} disabled={downloadingFacturaId === factura.id} className={btnSecundario}>
                {downloadingFacturaId === factura.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} PDF
              </button>
              <button onClick={() => onDescargar(factura.id, true)} disabled={downloadingFacturaId === factura.id} className={btnSecundario}><Eye className="h-3 w-3" /> Ver</button>
              {puedeCobrar && !e.cobrado && (
                <Link href={`/finanzas?tab=facturacion&grupo=cobrar&factura=${factura.id}&accion=cobro`} className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"><DollarSign className="h-3 w-3" /> Cobrar</Link>
              )}
              {puedeFacturar && factura.estado !== "pagada" && (
                <Link href={`/finanzas?tab=facturacion&grupo=cobrar&factura=${factura.id}&accion=nc`} className="inline-flex items-center gap-1 rounded-md border border-red-300 dark:border-red-700 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30">
                  <Ban className="h-3 w-3" /> NC
                </Link>
              )}
              <Link href={`/finanzas?tab=facturacion&grupo=cobrar&factura=${factura.id}`} className={`${linkClass} ml-auto`}>Facturación <ArrowRight className="h-3 w-3" /></Link>
            </div>
          </>) : (<>
            <p className="text-zinc-500">{e.refacturar ? "Anulada por NC: podés volver a facturar o no facturar." : "Sin factura emitida"}</p>
            {e.esperandoOc && <p className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> Falta la OC del cliente: se puede facturar igual.</p>}
            {e.dias > DIAS_AVISO_SIN_FACTURAR && <p className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><Clock className="h-3 w-3" /> {e.dias} días aprobado sin facturar.</p>}
            {puedeFacturar ? (
              <div className="flex items-center gap-1.5 pt-0.5">
                <button onClick={onFacturar} className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700">
                  <Receipt className="h-3.5 w-3.5" /> {e.refacturar ? "Re-facturar" : "Facturar"}
                </button>
                <button onClick={onCancelar} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-red-600 dark:hover:bg-zinc-800">
                  <X className="h-3.5 w-3.5" /> No facturar
                </button>
              </div>
            ) : <p className="text-zinc-400">La factura la emite administración.</p>}
          </>)}
        </Seccion>
      </div>
    </Card>
  );
}
