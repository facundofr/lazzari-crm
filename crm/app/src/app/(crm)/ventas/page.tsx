"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, getInitials } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import Link from "next/link";
import {
  FileText, Receipt, Truck, CheckCircle2,
  Loader2, X, ChevronRight, ChevronDown,
  Plus, Minus, DollarSign, Eye, AlertCircle,
  ArrowRight, Clock, Package, ClipboardList,
} from "lucide-react";
import { FichasRelevamiento } from "@/components/ventas/fichas-relevamiento";
import { useState, useEffect, useCallback, useMemo } from "react";

// ── Types ────────────────────────────────────────────────────────

interface VendedorOption {
  id: string;
  full_name: string;
}

interface VentaPresupuesto {
  id: string;
  numero: string;
  cliente_id: string;
  fecha: string;
  estado: string;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  tipo_cambio: number | null;
  vendedor_id: string | null;
  vendedor_profile: { full_name: string; avatar_url: string | null } | null;
  clientes: { razon_social: string; cuit: string; condicion_iva: string } | null;
  presupuesto_items: {
    descripcion: string;
    cantidad: number;
    precio_venta: number | null;
    iva_porcentaje: number;
    total: number | null;
  }[];
}

interface VentaFactura {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  fecha: string;
  cae: string | null;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  estado: string;
  presupuesto_id: string | null;
}

interface VentaRemito {
  id: string;
  numero: string;
  fecha: string;
  estado: string;
  presupuesto_id: string | null;
}

interface Venta {
  presupuesto: VentaPresupuesto;
  facturas: VentaFactura[];
  remitos: VentaRemito[];
}

// ── Pipeline logic ───────────────────────────────────────────────
// Entrega y Factura son independientes: se puede facturar sin entregar y viceversa

type VentaStep = 0 | 1 | 2 | 3;

interface VentaStatus {
  entregado: boolean;
  facturado: boolean;
  cobrado: boolean;
}

function getVentaStatus(v: Venta): VentaStatus {
  const facturaActiva = v.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
  return {
    entregado: v.remitos.some(r => r.estado === "entregado"),
    facturado: !!facturaActiva,
    cobrado: facturaActiva?.estado === "pagada" || false,
  };
}

// Asigna cada venta a UN SOLO bucket del pipeline (mutuamente exclusivos)
type VentaStage = "pend_entrega" | "pend_factura" | "facturadas" | "cobradas";
function getVentaStage(v: Venta): VentaStage {
  const s = getVentaStatus(v);
  if (s.cobrado) return "cobradas";
  if (s.facturado) return "facturadas";
  if (s.entregado) return "pend_factura";
  return "pend_entrega";
}

// Keep getVentaStep for KPI filtering compatibility
function getVentaStep(v: Venta): VentaStep {
  const s = getVentaStatus(v);
  if (s.cobrado) return 3;
  if (s.facturado && s.entregado) return 3; // Completada (falta cobro)
  if (s.facturado || s.entregado) return 2; // En progreso
  if (v.remitos.length > 0) return 1; // Algo iniciado
  return 0; // Pendiente
}

const STEP_LABELS = ["Presupuesto", "Entrega", "Factura", "Cobro"];
const STEP_ICONS = [FileText, Truck, Receipt, DollarSign];

// ── Component ────────────────────────────────────────────────────

export default function VentasPage() {
  const { profile, role, sociedadActiva } = useUser();

  const pvCrm = useMemo(() => {
    if (sociedadActiva?.nombre === "Grupo LA") return 10;
    return 15;
  }, [sociedadActiva]);

  const [ventas, setVentas] = useState<Venta[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendedores, setVendedores] = useState<VendedorOption[]>([]);
  const [filterVendedor, setFilterVendedor] = useState<string>("todos");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [selectedVentaId, setSelectedVentaId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Emit modal state
  const [emitModalOpen, setEmitModalOpen] = useState(false);
  const [emitVenta, setEmitVenta] = useState<Venta | null>(null);
  const [emitTipo, setEmitTipo] = useState<"FA" | "FB" | "FCEA" | "FCEB">("FB");
  const [emitItems, setEmitItems] = useState<{ descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number }[]>([]);
  const [emitting, setEmitting] = useState(false);
  const [emitTipoCambio, setEmitTipoCambio] = useState<number>(0);
  const [emitMoneda, setEmitMoneda] = useState<"ARS" | "USD">("ARS");
  const [emitError, setEmitError] = useState("");
  const [emitSuccess, setEmitSuccess] = useState("");
  const [emitManual, setEmitManual] = useState(false);
  const [emitNextNum, setEmitNextNum] = useState<number | null>(null);
  const [emitCondVenta, setEmitCondVenta] = useState("Contado");
  const [emitObservaciones, setEmitObservaciones] = useState("");
  const [cotizBna, setCotizBna] = useState<{ valor_venta: number; fecha: string; fuente: string; modalidad: string } | null>(null);
  const [cotizBnaLoading, setCotizBnaLoading] = useState(false);
  const [cotizFecha, setCotizFecha] = useState("");

  async function fetchCotizBna(modalidad: "divisas" | "billetes" = "divisas", fecha?: string) {
    setCotizBnaLoading(true);
    try {
      const params = new URLSearchParams({ modalidad });
      if (fecha) params.set("fecha", fecha);
      const res = await fetch(`/api/cotizacion-bna?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCotizBna({ valor_venta: data.valor_venta, fecha: data.fecha, fuente: data.fuente, modalidad });
        setEmitTipoCambio(data.valor_venta);
      }
    } catch { /* silencioso */ } finally {
      setCotizBnaLoading(false);
    }
  }

  // Tab: pipeline vs fichas
  const [ventasTab, setVentasTab] = useState<"pipeline" | "fichas">("pipeline");

  // Remito creation state
  const [creatingRemito, setCreatingRemito] = useState(false);

  // Auto-filter vendedor for vendedor role
  useEffect(() => {
    if (role === "vendedor" && profile?.id) {
      setFilterVendedor(profile.id);
    }
  }, [role, profile?.id]);

  const fetchData = useCallback(async () => {
    try {
      // Fetch presupuestos aprobados with items
      let presupuestosQuery = supabase
        .from("presupuestos")
        .select(`
          id, numero, cliente_id, fecha, estado, subtotal, iva, total, moneda, tipo_cambio, vendedor_id, modalidad_emision,
          vendedor_profile:vendedor_id(full_name, avatar_url),
          clientes(razon_social, cuit, condicion_iva),
          presupuesto_items(descripcion, cantidad, precio_venta, iva_porcentaje, total)
        `)
        .eq("estado", "aprobado")
        .order("fecha", { ascending: false });
      if (sociedadActiva?.id) presupuestosQuery = presupuestosQuery.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: presupuestos, error: pError } = await presupuestosQuery;

      if (pError || !presupuestos) {
        console.error("Error fetching presupuestos:", pError);
        setVentas([]);
        setLoading(false);
        return;
      }

      // Get all presupuesto IDs
      const pIds = presupuestos.map((p: any) => p.id);

      // Fetch related facturas and remitos in parallel
      const [facturasRes, remitosRes] = await Promise.all([
        pIds.length > 0
          ? (() => {
              let q = (supabase as any).from("facturas").select("id, tipo, punto_venta, numero, fecha, cae, subtotal, iva, total, moneda, estado, presupuesto_id").in("presupuesto_id", pIds);
              if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
              return q;
            })()
          : { data: [], error: null },
        pIds.length > 0
          ? (() => {
              let q = supabase.from("remitos").select("id, numero, fecha, estado, presupuesto_id").in("presupuesto_id", pIds);
              if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
              return q;
            })()
          : { data: [], error: null },
      ]);

      const facturas = (facturasRes.data || []) as VentaFactura[];
      const remitos = (remitosRes.data || []) as VentaRemito[];

      // Build ventas array
      const ventasArr: Venta[] = presupuestos.map((p: any) => ({
        presupuesto: p as VentaPresupuesto,
        facturas: facturas.filter(f => f.presupuesto_id === p.id),
        remitos: remitos.filter(r => r.presupuesto_id === p.id),
      }));

      setVentas(ventasArr);

      // Fetch vendedores for filter
      const { data: vendedorData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["vendedor", "admin", "super_admin"])
        .eq("active", true);
      if (vendedorData) setVendedores(vendedorData as VendedorOption[]);
    } catch (err) {
      console.error("Error fetching ventas:", err);
      setVentas([]);
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filtered data ──────────────────────────────────────────────

  const filteredVentas = useMemo(() => {
    return ventas.filter(v => {
      if (filterVendedor !== "todos" && v.presupuesto.vendedor_id !== filterVendedor) return false;
      if (filterStatus) {
        if (getVentaStage(v) !== filterStatus) return false;
      }
      return true;
    });
  }, [ventas, filterVendedor, filterStatus]);

  // KPIs from filtered ventas (respecting vendedor filter, ignoring step filter)
  const kpis = useMemo(() => {
    const base = ventas.filter(v =>
      filterVendedor === "todos" || v.presupuesto.vendedor_id === filterVendedor
    );
    const total = base.length;
    // Pipeline secuencial mutuamente exclusivo via getVentaStage
    const pendEntrega = base.filter(v => getVentaStage(v) === "pend_entrega").length;
    const pendFactura = base.filter(v => getVentaStage(v) === "pend_factura").length;
    const facturadas = base.filter(v => getVentaStage(v) === "facturadas").length;
    const cobradas = base.filter(v => getVentaStage(v) === "cobradas").length;
    const montoTotal = base.reduce((sum, v) => sum + (v.presupuesto.total || 0), 0);
    return { total, pendEntrega, pendFactura, facturadas, cobradas, montoTotal };
  }, [ventas, filterVendedor]);

  const selectedVenta = useMemo(() => {
    if (!selectedVentaId) return null;
    return filteredVentas.find(v => v.presupuesto.id === selectedVentaId) || null;
  }, [filteredVentas, selectedVentaId]);

  async function fetchNextNum(tipo: string) {
    try {
      let q = supabase.from("facturas").select("numero").eq("tipo" as any, tipo).eq("punto_venta" as any, pvCrm);
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data } = await q.order("numero", { ascending: false }).limit(1);
      setEmitNextNum(((data && data.length > 0 ? (data[0] as any).numero : 0) || 0) + 1);
    } catch { setEmitNextNum(null); }
  }

  // ── Actions ────────────────────────────────────────────────────

  function openEmitModal(venta: Venta) {
    const p = venta.presupuesto;
    const condIva = p.clientes?.condicion_iva;
    const defaultTipo = condIva === "RI" ? "FA" : "FB";

    const items = (p.presupuesto_items || []).map(it => ({
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_venta || (it.total ? it.total / (it.cantidad || 1) : 0),
      iva_porcentaje: it.iva_porcentaje || 21,
    }));

    setEmitVenta(venta);
    setEmitTipo(defaultTipo as "FA" | "FB" | "FCEA" | "FCEB");
    setEmitItems(items.length > 0 ? items : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }]);
    setEmitTipoCambio(p.tipo_cambio || 0);
    setEmitMoneda(p.moneda as "ARS" | "USD" || "ARS");
    setEmitError("");
    setEmitSuccess("");
    setEmitManual((p as any).modalidad_emision === "manual");
    setEmitCondVenta("Contado");
    setEmitObservaciones("");
    setCotizBna(null);
    setEmitModalOpen(true);
    fetchNextNum(defaultTipo);
  }

  async function handleEmitFactura() {
    if (!emitVenta || emitting) return;
    const p = emitVenta.presupuesto;

    if (emitItems.some(it => !it.descripcion || it.precio_unitario <= 0 || it.cantidad <= 0)) {
      setEmitError("Completa todos los items con descripcion, cantidad > 0 y precio > 0.");
      return;
    }
    const prMoneda = p.moneda || "ARS";
    const needsConversion = emitMoneda !== prMoneda && emitTipoCambio > 0;
    if (emitMoneda !== prMoneda && (!emitTipoCambio || emitTipoCambio <= 0)) {
      setEmitError("Ingresa el tipo de cambio para convertir de " + prMoneda + " a " + emitMoneda);
      return;
    }
    if (emitMoneda === "USD" && (!emitTipoCambio || emitTipoCambio <= 0)) {
      setEmitError("Ingresa el tipo de cambio USD → ARS para facturar en USD.");
      return;
    }

    setEmitting(true);
    setEmitError("");

    try {
      const convertPrice = (price: number) => {
        if (!needsConversion) return price;
        return prMoneda === "USD" ? Math.round(price * emitTipoCambio * 100) / 100 : Math.round(price / emitTipoCambio * 100) / 100;
      };
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/facturacion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          tipo: emitTipo,
          cliente_id: p.cliente_id,
          punto_venta: pvCrm,
          moneda: emitMoneda,
          tipo_cambio: emitMoneda === "USD" && emitTipoCambio > 0 ? emitTipoCambio : null,
          items: emitItems.map(it => ({ ...it, precio_unitario: convertPrice(it.precio_unitario) })),
          presupuesto_id: p.id,
          sociedad_id: sociedadActiva?.id || null,
          condicion_venta: emitCondVenta || null,
          observaciones: emitObservaciones || null,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setEmitSuccess(`${data.factura.comprobante} emitida - CAE: ${data.factura.cae}`);
        await fetchData();
      } else {
        setEmitError(data.error || "Error al emitir factura");
      }
    } catch (err) {
      setEmitError("Error de conexion al emitir factura");
    } finally {
      setEmitting(false);
    }
  }

  async function handleEmitFacturaManual() {
    if (!emitVenta || emitting) return;
    const p = emitVenta.presupuesto;

    if (emitItems.some(it => !it.descripcion || it.precio_unitario <= 0 || it.cantidad <= 0)) {
      setEmitError("Completa todos los items con descripcion, cantidad > 0 y precio > 0.");
      return;
    }
    if (emitMoneda !== (p.moneda || "ARS") && (!emitTipoCambio || emitTipoCambio <= 0)) {
      setEmitError("Ingresa el tipo de cambio para convertir de " + (p.moneda || "ARS") + " a " + emitMoneda);
      return;
    }

    setEmitting(true);
    setEmitError("");

    try {
      // Get next numero for this tipo+punto_venta+sociedad
      let maxQuery = supabase
        .from("facturas")
        .select("numero")
        .eq("tipo" as any, emitTipo)
        .eq("punto_venta" as any, pvCrm);
      if (sociedadActiva?.id) {
        maxQuery = maxQuery.eq("sociedad_id" as any, sociedadActiva.id);
      }
      const { data: maxRows } = await maxQuery
        .order("numero", { ascending: false })
        .limit(1);

      const nextNumero = ((maxRows && maxRows.length > 0 ? maxRows[0].numero : 0) || 0) + 1;

      // Calculate totals — convert prices if moneda changed
      let subtotal: number;
      let iva: number;
      let total: number;
      const prMoneda = p.moneda || "ARS";
      const needsConv = emitMoneda !== prMoneda && emitTipoCambio > 0;
      const conv = (price: number) => {
        if (!needsConv) return price;
        return prMoneda === "USD" ? Math.round(price * emitTipoCambio * 100) / 100 : Math.round(price / emitTipoCambio * 100) / 100;
      };

      if (emitTipo === "FA" || emitTipo === "FCEA") {
        subtotal = emitItems.reduce((sum, it) => sum + it.cantidad * conv(it.precio_unitario), 0);
        iva = emitItems.reduce((sum, it) => sum + it.cantidad * conv(it.precio_unitario) * it.iva_porcentaje / 100, 0);
        total = subtotal + iva;
      } else {
        total = emitItems.reduce((sum, it) => sum + it.cantidad * conv(it.precio_unitario), 0);
        subtotal = emitItems.reduce((sum, it) => {
          const rate = (it.iva_porcentaje || 21) / 100;
          return sum + (it.cantidad * conv(it.precio_unitario)) / (1 + rate);
        }, 0);
        iva = total - subtotal;
      }

      // Insert factura
      const { data: facturaData, error: fError } = await (supabase.from("facturas") as any)
        .insert({
          tipo: emitTipo,
          punto_venta: pvCrm,
          numero: nextNumero,
          cliente_id: p.cliente_id,
          presupuesto_id: p.id,
          fecha: new Date().toISOString().split("T")[0],
          cae: null,
          cae_vencimiento: null,
          subtotal,
          iva,
          total,
          moneda: emitMoneda,
          tipo_cambio: emitMoneda === "USD" && emitTipoCambio > 0 ? emitTipoCambio : null,
          estado: "emitida",
          condicion_venta: emitCondVenta || null,
          observaciones: emitObservaciones || null,
          sociedad_id: (p as any).sociedad_id || null,
        })
        .select("id")
        .single();

      if (fError || !facturaData) {
        setEmitError("Error al crear factura manual: " + (fError?.message || "Error desconocido"));
        return;
      }

      // Insert factura items
      const facturaItems = emitItems.map((it, idx) => ({
        factura_id: facturaData.id,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: conv(it.precio_unitario),
        iva_porcentaje: (emitTipo === "FA" || emitTipo === "FCEA") ? it.iva_porcentaje : 21,
        orden: idx,
      }));
      const { error: itemsError } = await (supabase.from("factura_items") as any).insert(facturaItems);
      if (itemsError) throw itemsError;

      const comp = `${emitTipo} ${String(pvCrm).padStart(4, "0")}-${String(nextNumero).padStart(8, "0")}`;
      setEmitSuccess(`${comp} emitida (manual, sin CAE)`);
      await fetchData();
    } catch (err) {
      setEmitError("Error al crear factura manual");
    } finally {
      setEmitting(false);
    }
  }

  async function handleCrearRemito(venta: Venta) {
    const p = venta.presupuesto;
    setCreatingRemito(true);
    try {
      // Create remito
      const { data: remitoData, error: rError } = await (supabase.from("remitos") as any)
        .insert({
          cliente_id: p.cliente_id,
          presupuesto_id: p.id,
          fecha: new Date().toISOString().split("T")[0],
          observaciones: `Desde presupuesto ${p.numero}`,
          estado: "pendiente",
          oc_cliente: (p as any).oc_cliente || null,
          sociedad_id: sociedadActiva?.id || null,
        })
        .select("id")
        .single();

      if (rError || !remitoData) {
        console.error("Error creando remito:", rError);
        alert("Error al crear remito: " + (rError?.message || "Error desconocido"));
        return;
      }

      // Create remito items from presupuesto items
      if (p.presupuesto_items?.length > 0) {
        const items = p.presupuesto_items.map((item, idx) => ({
          remito_id: remitoData.id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          unidad: "u",
          orden: idx,
        }));
        const { error: riError } = await (supabase.from("remito_items") as any).insert(items);
        if (riError) {
          console.error("Error creando remito items:", riError);
        }
      }

      await fetchData();
    } catch (err) {
      console.error("Error creando remito:", err);
      alert("Error al crear remito");
    } finally {
      setCreatingRemito(false);
    }
  }

  async function handleMarcarEntregado(remitoId: string) {
    const { error } = await supabase.from("remitos").update({ estado: "entregado" } as any).eq("id", remitoId);
    if (error) {
      alert("Error al marcar como entregado: " + error.message);
      return;
    }
    await fetchData();
  }

  // Cobro se registra desde la pagina de facturacion (con movimientos transaccionales via registrar_cobro RPC)

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

  return (
    <>
      <Header title="Ventas" subtitle={`${ventas.length} ventas en proceso`} />
      <div className="p-4 sm:p-8 space-y-6">

        {/* Tab toggle */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          <button
            onClick={() => setVentasTab("pipeline")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              ventasTab === "pipeline"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            <span className="flex items-center gap-2"><Package className="h-4 w-4" /> Pipeline</span>
          </button>
          <button
            onClick={() => setVentasTab("fichas")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              ventasTab === "fichas"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Fichas de relevamiento</span>
          </button>
        </div>

        {ventasTab === "fichas" ? (
          <FichasRelevamiento />
        ) : (
        <>
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: "Total", value: kpis.total, color: "text-zinc-900 dark:text-white", key: null },
            { label: "Pend. entrega", value: kpis.pendEntrega, color: "text-amber-600", key: "pend_entrega" },
            { label: "Pend. factura", value: kpis.pendFactura, color: "text-red-600", key: "pend_factura" },
            { label: "Facturadas", value: kpis.facturadas, color: "text-blue-600", key: "facturadas" },
            { label: "Cobradas", value: kpis.cobradas, color: "text-green-600", key: "cobradas" },
          ].map(kpi => (
            <button
              key={kpi.label}
              onClick={() => setFilterStatus(filterStatus === kpi.key ? null : kpi.key)}
              className={`rounded-xl border p-4 text-left transition-all ${
                filterStatus === kpi.key
                  ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
              }`}
            >
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{kpi.label}</p>
              <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          {role !== "vendedor" && (
            <select
              value={filterVendedor}
              onChange={e => setFilterVendedor(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              <option value="todos">Todos los vendedores</option>
              {vendedores.map(v => (
                <option key={v.id} value={v.id}>{v.full_name}</option>
              ))}
            </select>
          )}
          {filterStatus !== null && (
            <button
              onClick={() => setFilterStatus(null)}
              className="flex items-center gap-1 rounded-lg bg-orange-100 px-3 py-2 text-sm font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
            >
              {{ pend_entrega: "Pend. entrega", pend_factura: "Pend. factura", facturadas: "Facturadas", cobradas: "Cobradas" }[filterStatus]}
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="ml-auto text-sm text-zinc-400">
            {filteredVentas.length} venta{filteredVentas.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Main content */}
        <div className="flex gap-6">
          {/* List */}
          <div className={`space-y-3 ${selectedVenta ? "w-1/2 hidden lg:block" : "w-full"}`}>
            {filteredVentas.length === 0 ? (
              <Card className="p-12 text-center">
                <Package className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
                <p className="text-zinc-500">No hay ventas que coincidan con los filtros</p>
              </Card>
            ) : (
              filteredVentas.map(v => {
                const p = v.presupuesto;
                const step = getVentaStep(v);
                const vendedorName = (p.vendedor_profile as any)?.full_name;
                const isSelected = selectedVentaId === p.id;

                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedVentaId(isSelected ? null : p.id);
                      setExpandedSection(null);
                    }}
                    className={`w-full text-left rounded-xl border p-4 transition-all ${
                      isSelected
                        ? "border-orange-500 bg-orange-50/50 dark:bg-orange-950/20"
                        : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-zinc-900 dark:text-white">{p.numero}</span>
                          <span className="text-sm text-zinc-500">{p.clientes?.razon_social}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {vendedorName && (
                            <span className="text-xs text-zinc-400">{vendedorName}</span>
                          )}
                          <span className="text-xs text-zinc-400">{formatDate(p.fecha)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-zinc-900 dark:text-white">
                          {formatCurrency(p.total, p.moneda as "ARS" | "USD")}
                        </p>
                      </div>
                    </div>

                    {/* Status badges — entrega y factura independientes */}
                    {(() => {
                      const st = getVentaStatus(v);
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Presupuesto siempre done */}
                          <div className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                            <FileText className="h-3 w-3" />
                            <span className="hidden sm:inline">Aprobado</span>
                          </div>
                          {/* Entrega */}
                          <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                            st.entregado
                              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                              : v.remitos.length > 0
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                                : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                          }`}>
                            <Truck className="h-3 w-3" />
                            <span className="hidden sm:inline">{st.entregado ? "Entregado" : v.remitos.length > 0 ? "En entrega" : "Sin entregar"}</span>
                          </div>
                          {/* Factura */}
                          {(() => {
                            const factActiva = v.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
                            const esManual = factActiva && !factActiva.cae;
                            return (
                              <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                                st.facturado
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                  : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                              }`}>
                                <Receipt className="h-3 w-3" />
                                <span className="hidden sm:inline">
                                  {st.facturado
                                    ? esManual ? "Manual" : "ARCA"
                                    : "Sin facturar"}
                                </span>
                              </div>
                            );
                          })()}
                          {/* Cobro */}
                          {st.facturado && (
                            <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                              st.cobrado
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                            }`}>
                              <DollarSign className="h-3 w-3" />
                              <span className="hidden sm:inline">{st.cobrado ? "Cobrado" : "Pend. cobro"}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Quick action */}
                    {(() => {
                      const st = getVentaStatus(v);
                      if (st.cobrado) return (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Completada
                          </span>
                        </div>
                      );
                      const pending: string[] = [];
                      if (!st.entregado) pending.push("entregar");
                      if (!st.facturado) pending.push("facturar");
                      else pending.push("cobrar");
                      return (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs text-amber-600 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Falta: {pending.join(", ")}
                          </span>
                        </div>
                      );
                    })()}
                  </button>
                );
              })
            )}
          </div>

          {/* Detail Panel */}
          {selectedVenta && (
            <div className="w-full lg:w-1/2">
              <Card className="sticky top-4 p-0 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 p-4">
                  <div>
                    <h3 className="font-bold text-zinc-900 dark:text-white">{selectedVenta.presupuesto.numero}</h3>
                    <p className="text-sm text-zinc-500">{selectedVenta.presupuesto.clientes?.razon_social}</p>
                  </div>
                  <button onClick={() => setSelectedVentaId(null)} className="text-zinc-400 hover:text-zinc-600 lg:hidden">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {/* Step 1: Presupuesto */}
                  <DetailSection
                    title="Presupuesto"
                    icon={FileText}
                    status="done"
                    expanded={expandedSection === "presupuesto"}
                    onToggle={() => setExpandedSection(expandedSection === "presupuesto" ? null : "presupuesto")}
                  >
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Numero</span>
                        <span className="font-mono font-bold">{selectedVenta.presupuesto.numero}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Fecha</span>
                        <span>{formatDate(selectedVenta.presupuesto.fecha)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Total</span>
                        <span className="font-bold">
                          {formatCurrency(selectedVenta.presupuesto.total, selectedVenta.presupuesto.moneda as "ARS" | "USD")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Items</span>
                        <span>{selectedVenta.presupuesto.presupuesto_items?.length || 0} productos</span>
                      </div>
                      <Link
                        href={`/presupuestos`}
                        className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 mt-1"
                      >
                        Ver presupuesto <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </DetailSection>

                  {/* Step 2: Entrega */}
                  <DetailSection
                    title="Entrega"
                    icon={Truck}
                    status={
                      selectedVenta.remitos.some(r => r.estado === "entregado") ? "done"
                        : selectedVenta.remitos.length > 0 ? "in-progress"
                        : "pending"
                    }
                    expanded={expandedSection === "entrega"}
                    onToggle={() => setExpandedSection(expandedSection === "entrega" ? null : "entrega")}
                  >
                    {selectedVenta.remitos.length > 0 ? (
                      <div className="space-y-2">
                        {selectedVenta.remitos.map(r => (
                          <div key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                            <div>
                              <span className="font-mono text-xs font-bold">{r.numero || "Sin numero"}</span>
                              <span className="text-xs text-zinc-400 ml-2">{formatDate(r.fecha)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={r.estado === "entregado" ? "success" : r.estado === "parcial" ? "info" : "warning"}>
                                {r.estado}
                              </Badge>
                              {r.estado === "pendiente" && (
                                <button
                                  onClick={() => handleMarcarEntregado(r.id)}
                                  className="text-xs text-green-600 hover:text-green-700 font-medium"
                                >
                                  Marcar entregado
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        <Link
                          href="/remitos"
                          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700"
                        >
                          Ver en remitos <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-zinc-500">Sin remitos generados</p>
                        <button
                          onClick={() => handleCrearRemito(selectedVenta)}
                          disabled={creatingRemito}
                          className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                        >
                          {creatingRemito ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Truck className="h-4 w-4" />
                          )}
                          Generar remito desde presupuesto
                        </button>
                      </div>
                    )}
                  </DetailSection>

                  {/* Step 3: Factura */}
                  <DetailSection
                    title="Factura"
                    icon={Receipt}
                    status={
                      selectedVenta.facturas.some(f => f.estado === "emitida" || f.estado === "pagada") ? "done"
                        : "pending"
                    }
                    expanded={expandedSection === "factura"}
                    onToggle={() => setExpandedSection(expandedSection === "factura" ? null : "factura")}
                  >
                    {(() => {
                      const facturaActiva = selectedVenta.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
                      if (facturaActiva) {
                        const comp = `${facturaActiva.tipo} ${String(facturaActiva.punto_venta).padStart(4, "0")}-${String(facturaActiva.numero).padStart(8, "0")}`;
                        return (
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Comprobante</span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold">{comp}</span>
                                {facturaActiva.cae ? (
                                  <span className="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-400">ARCA</span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">Manual</span>
                                )}
                              </div>
                            </div>
                            {facturaActiva.cae && (
                            <div className="flex justify-between">
                              <span className="text-zinc-500">CAE</span>
                              <span className="font-mono text-xs">{facturaActiva.cae}</span>
                            </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Total</span>
                              <span className="font-bold">{formatCurrency(facturaActiva.total, (facturaActiva.moneda || "ARS") as "ARS" | "USD")}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Estado</span>
                              <Badge variant={facturaActiva.estado === "pagada" ? "success" : "info"}>
                                {facturaActiva.estado}
                              </Badge>
                            </div>
                            <Link
                              href="/facturacion"
                              className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700"
                            >
                              Ver en facturacion <ArrowRight className="h-3 w-3" />
                            </Link>
                          </div>
                        );
                      }
                      return (
                        <div className="space-y-3">
                          <p className="text-sm text-zinc-500">Sin factura emitida</p>
                          <button
                            onClick={() => openEmitModal(selectedVenta)}
                            className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                          >
                            <Receipt className="h-4 w-4" />
                            Facturar con ARCA
                          </button>
                        </div>
                      );
                    })()}
                  </DetailSection>

                  {/* Step 4: Cobro */}
                  <DetailSection
                    title="Cobro"
                    icon={DollarSign}
                    status={
                      selectedVenta.facturas.some(f => f.estado === "pagada") ? "done" : "pending"
                    }
                    expanded={expandedSection === "cobro"}
                    onToggle={() => setExpandedSection(expandedSection === "cobro" ? null : "cobro")}
                  >
                    {(() => {
                      const facturaActiva = selectedVenta.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
                      if (facturaActiva?.estado === "pagada") {
                        return (
                          <div className="flex items-center gap-2 text-sm text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="font-medium">Cobro registrado</span>
                          </div>
                        );
                      }
                      if (facturaActiva?.estado === "emitida") {
                        return (
                          <div className="space-y-3">
                            <p className="text-sm text-zinc-500">Factura emitida, pendiente de cobro</p>
                            <Link
                              href="/facturacion"
                              className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 w-fit"
                            >
                              <DollarSign className="h-4 w-4" />
                              Registrar cobro en Facturación
                            </Link>
                          </div>
                        );
                      }
                      return <p className="text-sm text-zinc-400">Primero emiti la factura</p>;
                    })()}
                  </DetailSection>
                </div>

                {/* Quick links */}
                <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
                  <p className="text-xs font-medium text-zinc-400 uppercase mb-2">Ir a</p>
                  <div className="flex flex-wrap gap-2">
                    <Link href="/clientes" className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Cliente
                    </Link>
                    <Link href="/presupuestos" className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Presupuesto
                    </Link>
                    <Link href="/remitos" className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Remitos
                    </Link>
                    <Link href="/facturacion" className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Facturacion
                    </Link>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>

      {/* Emit Modal */}
      {emitModalOpen && emitVenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !emitting && setEmitModalOpen(false)}>
          <Card className="w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold dark:text-white">
                Emitir factura — {emitVenta.presupuesto.numero}
              </h2>
              <button onClick={() => !emitting && setEmitModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {emitSuccess ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <p className="font-medium">{emitSuccess}</p>
                </div>
                <button
                  onClick={() => setEmitModalOpen(false)}
                  className="mt-3 rounded-lg border border-green-300 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
                >
                  Cerrar
                </button>
              </div>
            ) : (
              <>
                {/* Info */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-zinc-500">Cliente</span>
                    <p className="font-medium dark:text-white">{emitVenta.presupuesto.clientes?.razon_social}</p>
                    <p className="text-xs text-zinc-400">
                      {emitVenta.presupuesto.clientes?.condicion_iva || "—"} · {emitVenta.presupuesto.clientes?.cuit || "Sin CUIT"}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Punto de venta</span>
                    <p className="font-mono font-bold dark:text-white">{String(pvCrm).padStart(4, "0")}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Nro. comprobante</span>
                    <p className="font-mono font-bold text-orange-600 dark:text-orange-400">
                      {emitNextNum != null ? `${String(pvCrm).padStart(4, "0")}-${String(emitNextNum).padStart(8, "0")}` : "…"}
                    </p>
                  </div>
                </div>

                {/* Tipo */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo de comprobante</label>
                  <select
                    value={emitTipo}
                    onChange={e => { const t = e.target.value as "FA" | "FB" | "FCEA" | "FCEB"; setEmitTipo(t); fetchNextNum(t); }}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  >
                    {emitVenta.presupuesto.clientes?.condicion_iva === "RI" && (
                      <option value="FA">Factura A (discrimina IVA)</option>
                    )}
                    <option value="FB">Factura B (precio final)</option>
                    {emitVenta.presupuesto.clientes?.condicion_iva === "RI" && (
                      <option value="FCEA">FCE A — Crédito Electrónica (MiPyMEs)</option>
                    )}
                    <option value="FCEB">FCE B — Crédito Electrónica (MiPyMEs)</option>
                  </select>
                </div>

                {/* Manual toggle */}
                <div className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={emitManual}
                      onChange={e => setEmitManual(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-zinc-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:after:border-zinc-500 peer-checked:bg-orange-500" />
                  </label>
                  <div>
                    <span className="text-sm font-medium dark:text-white">Factura manual (sin ARCA)</span>
                    <p className="text-xs text-zinc-400">
                      {emitManual
                        ? "Se creara un registro interno sin autorizacion electronica (sin CAE)"
                        : "Se emitira electronicamente via ARCA con CAE"}
                    </p>
                  </div>
                </div>

                {/* Moneda de facturación */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Moneda factura</label>
                    <div className="flex gap-1.5">
                      {(["ARS", "USD"] as const).map(m => (
                        <button key={m} onClick={() => setEmitMoneda(m)}
                          className={`rounded-md border-2 px-4 py-1.5 text-xs font-semibold transition-colors ${emitMoneda === m ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                    {emitMoneda !== (emitVenta.presupuesto.moneda || "ARS") && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">PR en {emitVenta.presupuesto.moneda} → factura en {emitMoneda}</span>
                    )}
                  </div>
                  {(emitMoneda === "USD" || emitMoneda !== (emitVenta.presupuesto.moneda || "ARS")) && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs text-amber-600 dark:text-amber-500">Cotizacion USD/ARS {emitManual ? "" : "*"}</label>
                        <input
                          type="number" step="0.01" min={0}
                          value={emitTipoCambio || ""}
                          onChange={e => setEmitTipoCambio(Number(e.target.value))}
                          placeholder="Ej: 1450.00"
                          className="w-32 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-mono dark:text-white"
                        />
                        <button type="button" onClick={() => fetchCotizBna("divisas", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap">
                          {cotizBnaLoading ? "…" : "Divisas"}
                        </button>
                        <span className="text-xs text-zinc-400">·</span>
                        <button type="button" onClick={() => fetchCotizBna("billetes", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap">
                          {cotizBnaLoading ? "…" : "Billetes"}
                        </button>
                        <input type="date" value={cotizFecha} onChange={e => setCotizFecha(e.target.value)} className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 bg-white dark:bg-zinc-800 dark:text-white" title="Fecha cotización (vacío = día hábil anterior)" />
                      </div>
                      {cotizBna && (
                        <p className="text-xs text-zinc-500 mt-1">BNA {cotizBna.modalidad} venta: ${cotizBna.valor_venta.toLocaleString("es-AR")} ({cotizBna.fecha})</p>
                      )}
                      {emitMoneda !== (emitVenta.presupuesto.moneda || "ARS") && emitTipoCambio > 0 && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">
                          Los items se convertirán de {emitVenta.presupuesto.moneda} a {emitMoneda} al tipo de cambio {emitTipoCambio.toLocaleString("es-AR")}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Items</label>
                    <button
                      onClick={() => setEmitItems([...emitItems, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }])}
                      className="text-xs text-orange-600 hover:text-orange-700 flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" /> Agregar
                    </button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {emitItems.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-5">
                          {idx === 0 && <span className="text-xs text-zinc-400">Descripcion</span>}
                          <input
                            type="text"
                            value={item.descripcion}
                            onChange={e => {
                              const copy = [...emitItems];
                              copy[idx] = { ...copy[idx], descripcion: e.target.value };
                              setEmitItems(copy);
                            }}
                            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                          />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <span className="text-xs text-zinc-400">Cant.</span>}
                          <input
                            type="number"
                            min="1"
                            value={item.cantidad}
                            onChange={e => {
                              const copy = [...emitItems];
                              copy[idx] = { ...copy[idx], cantidad: Number(e.target.value) };
                              setEmitItems(copy);
                            }}
                            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                          />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <span className="text-xs text-zinc-400">{(emitTipo === "FA" || emitTipo === "FCEA") ? "Neto" : "Precio"}</span>}
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.precio_unitario}
                            onChange={e => {
                              const copy = [...emitItems];
                              copy[idx] = { ...copy[idx], precio_unitario: Number(e.target.value) };
                              setEmitItems(copy);
                            }}
                            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                          />
                        </div>
                        {(emitTipo === "FA" || emitTipo === "FCEA") && (
                          <div className="col-span-2">
                            {idx === 0 && <span className="text-xs text-zinc-400">IVA %</span>}
                            <select
                              value={item.iva_porcentaje}
                              onChange={e => {
                                const copy = [...emitItems];
                                copy[idx] = { ...copy[idx], iva_porcentaje: Number(e.target.value) };
                                setEmitItems(copy);
                              }}
                              className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                            >
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className={(emitTipo === "FA" || emitTipo === "FCEA") ? "col-span-1" : "col-span-3 flex items-end justify-end"}>
                          {emitItems.length > 1 && (
                            <button
                              onClick={() => setEmitItems(emitItems.filter((_, i) => i !== idx))}
                              className="rounded p-1 text-zinc-400 hover:text-red-500"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Condición de venta + Observaciones */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Condición de venta</label>
                    <select
                      value={emitCondVenta}
                      onChange={e => setEmitCondVenta(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    >
                      <option value="Contado">Contado</option>
                      <option value="Cuenta corriente">Cuenta corriente</option>
                      <option value="30 días">30 días</option>
                      <option value="60 días">60 días</option>
                      <option value="90 días">90 días</option>
                      <option value="Cheque 30 días">Cheque 30 días</option>
                      <option value="Cheque 60 días">Cheque 60 días</option>
                      <option value="Cheque 90 días">Cheque 90 días</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Observaciones</label>
                    <input
                      type="text"
                      value={emitObservaciones}
                      onChange={e => setEmitObservaciones(e.target.value)}
                      placeholder="Notas para la factura..."
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    />
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3 space-y-1">
                  {(() => {
                    const prMon = (emitVenta.presupuesto.moneda || "ARS") as "ARS" | "USD";
                    const needsConv = emitMoneda !== prMon && emitTipoCambio > 0;
                    const cv = (p: number) => {
                      if (!needsConv) return p;
                      return prMon === "USD" ? Math.round(p * emitTipoCambio * 100) / 100 : Math.round(p / emitTipoCambio * 100) / 100;
                    };
                    if (emitTipo === "FA" || emitTipo === "FCEA") {
                      const neto = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);
                      const iva = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario * it.iva_porcentaje / 100, 0);
                      return (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Neto</span>
                            <span>{formatCurrency(neto, prMon)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">IVA</span>
                            <span>{formatCurrency(iva, prMon)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1">
                            <span>Total</span>
                            <span>{formatCurrency(neto + iva, prMon)}</span>
                          </div>
                          {needsConv && (
                            <div className="flex justify-between text-sm font-bold text-blue-600 dark:text-blue-400 border-t border-zinc-200 dark:border-zinc-700 pt-1">
                              <span>Total factura ({emitMoneda})</span>
                              <span>{formatCurrency(cv(neto) + cv(iva), emitMoneda)}</span>
                            </div>
                          )}
                        </>
                      );
                    } else {
                      const total = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);
                      return (
                        <>
                          <div className="flex justify-between text-sm font-bold">
                            <span>Total (IVA incluido)</span>
                            <span>{formatCurrency(total, prMon)}</span>
                          </div>
                          {needsConv && (
                            <div className="flex justify-between text-sm font-bold text-blue-600 dark:text-blue-400 border-t border-zinc-200 dark:border-zinc-700 pt-1">
                              <span>Total factura ({emitMoneda})</span>
                              <span>{formatCurrency(cv(total), emitMoneda)}</span>
                            </div>
                          )}
                        </>
                      );
                    }
                  })()}
                </div>

                {emitError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    {emitError}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEmitModalOpen(false)}
                    disabled={emitting}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={emitManual ? handleEmitFacturaManual : handleEmitFactura}
                    disabled={emitting}
                    className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 flex items-center gap-2 ${
                      emitManual ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"
                    }`}
                  >
                    {emitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Emitiendo...
                      </>
                    ) : emitManual ? (
                      <>
                        <Receipt className="h-4 w-4" />
                        Crear factura manual
                      </>
                    ) : (
                      <>
                        <Receipt className="h-4 w-4" />
                        Emitir con ARCA
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
        </>
        )}
      </div>
    </>
  );
}

// ── Detail Section Component ─────────────────────────────────────

function DetailSection({
  title, icon: Icon, status, expanded, onToggle, children,
}: {
  title: string;
  icon: React.ElementType;
  status: "done" | "in-progress" | "pending";
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="flex items-center w-full p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
        <div className={`rounded-lg p-1.5 mr-3 ${
          status === "done" ? "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400"
            : status === "in-progress" ? "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400"
            : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
        }`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="flex-1 text-left text-sm font-medium dark:text-white">{title}</span>
        {status === "done" && <CheckCircle2 className="h-4 w-4 text-green-500 mr-2" />}
        {status === "in-progress" && <Clock className="h-4 w-4 text-orange-500 mr-2" />}
        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pl-[52px]">
          {children}
        </div>
      )}
    </div>
  );
}
