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
  ArrowRight, Clock, Package,
} from "lucide-react";
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

type VentaStep = 0 | 1 | 2 | 3;

function getVentaStep(v: Venta): VentaStep {
  const facturaActiva = v.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
  if (facturaActiva?.estado === "pagada") return 3; // Cobrada
  if (facturaActiva) return 2; // Facturada
  const remitoEntregado = v.remitos.some(r => r.estado === "entregado");
  if (remitoEntregado) return 1; // Entregada
  if (v.remitos.length > 0) return 1; // En proceso de entrega
  return 0; // Pendiente
}

const STEP_LABELS = ["Presupuesto", "Entrega", "Factura", "Cobro"];
const STEP_ICONS = [FileText, Truck, Receipt, DollarSign];

const PV_CRM = 15;

// ── Component ────────────────────────────────────────────────────

export default function VentasPage() {
  const { profile, role } = useUser();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendedores, setVendedores] = useState<VendedorOption[]>([]);
  const [filterVendedor, setFilterVendedor] = useState<string>("todos");
  const [filterStep, setFilterStep] = useState<number | null>(null);
  const [selectedVentaId, setSelectedVentaId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Emit modal state
  const [emitModalOpen, setEmitModalOpen] = useState(false);
  const [emitVenta, setEmitVenta] = useState<Venta | null>(null);
  const [emitTipo, setEmitTipo] = useState<"FA" | "FB">("FB");
  const [emitItems, setEmitItems] = useState<{ descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number }[]>([]);
  const [emitting, setEmitting] = useState(false);
  const [emitTipoCambio, setEmitTipoCambio] = useState<number>(0);
  const [emitError, setEmitError] = useState("");
  const [emitSuccess, setEmitSuccess] = useState("");

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
      const { data: presupuestos, error: pError } = await supabase
        .from("presupuestos")
        .select(`
          id, numero, cliente_id, fecha, estado, subtotal, iva, total, moneda, tipo_cambio, vendedor_id,
          vendedor_profile:vendedor_id(full_name, avatar_url),
          clientes(razon_social, cuit, condicion_iva),
          presupuesto_items(descripcion, cantidad, precio_venta, iva_porcentaje, total)
        `)
        .eq("estado", "aprobado")
        .order("fecha", { ascending: false });

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
          ? supabase.from("facturas").select("id, tipo, punto_venta, numero, fecha, cae, subtotal, iva, total, estado, presupuesto_id").in("presupuesto_id", pIds)
          : { data: [], error: null },
        pIds.length > 0
          ? supabase.from("remitos").select("id, numero, fecha, estado, presupuesto_id").in("presupuesto_id", pIds)
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
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filtered data ──────────────────────────────────────────────

  const filteredVentas = useMemo(() => {
    return ventas.filter(v => {
      if (filterVendedor !== "todos" && v.presupuesto.vendedor_id !== filterVendedor) return false;
      if (filterStep !== null && getVentaStep(v) !== filterStep) return false;
      return true;
    });
  }, [ventas, filterVendedor, filterStep]);

  // KPIs from filtered ventas (respecting vendedor filter, ignoring step filter)
  const kpis = useMemo(() => {
    const base = ventas.filter(v =>
      filterVendedor === "todos" || v.presupuesto.vendedor_id === filterVendedor
    );
    const total = base.length;
    const pendientes = base.filter(v => getVentaStep(v) < 2).length;
    const facturadas = base.filter(v => getVentaStep(v) === 2).length;
    const cobradas = base.filter(v => getVentaStep(v) === 3).length;
    const montoTotal = base.reduce((sum, v) => sum + (v.presupuesto.total || 0), 0);
    return { total, pendientes, facturadas, cobradas, montoTotal };
  }, [ventas, filterVendedor]);

  const selectedVenta = useMemo(() => {
    if (!selectedVentaId) return null;
    return filteredVentas.find(v => v.presupuesto.id === selectedVentaId) || null;
  }, [filteredVentas, selectedVentaId]);

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
    setEmitTipo(defaultTipo as "FA" | "FB");
    setEmitItems(items.length > 0 ? items : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }]);
    setEmitTipoCambio(p.tipo_cambio || 0);
    setEmitError("");
    setEmitSuccess("");
    setEmitModalOpen(true);
  }

  async function handleEmitFactura() {
    if (!emitVenta || emitting) return;
    const p = emitVenta.presupuesto;

    if (emitItems.some(it => !it.descripcion || it.precio_unitario <= 0 || it.cantidad <= 0)) {
      setEmitError("Completa todos los items con descripcion, cantidad > 0 y precio > 0.");
      return;
    }
    if (p.moneda === "USD" && (!emitTipoCambio || emitTipoCambio <= 0)) {
      setEmitError("Ingresa el tipo de cambio USD → ARS para facturar.");
      return;
    }

    setEmitting(true);
    setEmitError("");

    try {
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
          punto_venta: PV_CRM,
          moneda: p.moneda || "ARS",
          tipo_cambio: p.moneda === "USD" ? (emitTipoCambio || p.tipo_cambio || null) : null,
          items: emitItems,
          presupuesto_id: p.id,
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
        await (supabase.from("remito_items") as any).insert(items);
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
    await supabase.from("remitos").update({ estado: "entregado" } as any).eq("id", remitoId);
    await fetchData();
  }

  async function handleMarcarPagada(facturaId: string) {
    if (!confirm("¿Marcar esta factura como pagada?")) return;
    await supabase.from("facturas").update({ estado: "pagada" } as any).eq("id", facturaId);
    await fetchData();
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

  return (
    <>
      <Header title="Ventas" subtitle={`${ventas.length} ventas en proceso`} />
      <div className="p-4 sm:p-8 space-y-6">

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total", value: kpis.total, color: "text-zinc-900 dark:text-white", step: null },
            { label: "Pend. facturar", value: kpis.pendientes, color: "text-amber-600", step: 0 },
            { label: "Facturadas", value: kpis.facturadas, color: "text-blue-600", step: 2 },
            { label: "Cobradas", value: kpis.cobradas, color: "text-green-600", step: 3 },
          ].map(kpi => (
            <button
              key={kpi.label}
              onClick={() => setFilterStep(filterStep === kpi.step ? null : kpi.step)}
              className={`rounded-xl border p-4 text-left transition-all ${
                filterStep === kpi.step
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
          {filterStep !== null && (
            <button
              onClick={() => setFilterStep(null)}
              className="flex items-center gap-1 rounded-lg bg-orange-100 px-3 py-2 text-sm font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
            >
              {STEP_LABELS[filterStep]}
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

                    {/* Pipeline steps */}
                    <div className="flex items-center gap-1">
                      {STEP_LABELS.map((label, i) => {
                        const Icon = STEP_ICONS[i];
                        const done = step > i;
                        const current = step === i;
                        return (
                          <div key={label} className="flex items-center gap-1 flex-1">
                            <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                              done ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : current ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                                : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                            }`}>
                              <Icon className="h-3 w-3" />
                              <span className="hidden sm:inline">{label}</span>
                            </div>
                            {i < 3 && <ChevronRight className="h-3 w-3 text-zinc-300 shrink-0" />}
                          </div>
                        );
                      })}
                    </div>

                    {/* Quick action */}
                    <div className="mt-3 flex items-center gap-2">
                      {step === 0 && (
                        <span className="text-xs text-amber-600 flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Pendiente de remito
                        </span>
                      )}
                      {step === 1 && (
                        <span className="text-xs text-blue-600 flex items-center gap-1">
                          <Receipt className="h-3 w-3" /> Lista para facturar
                        </span>
                      )}
                      {step === 2 && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <DollarSign className="h-3 w-3" /> Pendiente de cobro
                        </span>
                      )}
                      {step === 3 && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Completada
                        </span>
                      )}
                    </div>
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
                              <span className="font-mono font-bold">{comp}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-zinc-500">CAE</span>
                              <span className="font-mono text-xs">{facturaActiva.cae || "—"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Total</span>
                              <span className="font-bold">{formatCurrency(facturaActiva.total)}</span>
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
                            <button
                              onClick={() => handleMarcarPagada(facturaActiva.id)}
                              className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                            >
                              <DollarSign className="h-4 w-4" />
                              Registrar cobro
                            </button>
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
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-zinc-500">Cliente</span>
                    <p className="font-medium dark:text-white">{emitVenta.presupuesto.clientes?.razon_social}</p>
                    <p className="text-xs text-zinc-400">
                      {emitVenta.presupuesto.clientes?.condicion_iva || "—"} · {emitVenta.presupuesto.clientes?.cuit || "Sin CUIT"}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Punto de venta</span>
                    <p className="font-mono font-bold dark:text-white">{String(PV_CRM).padStart(4, "0")}</p>
                  </div>
                </div>

                {/* Tipo */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo de comprobante</label>
                  <select
                    value={emitTipo}
                    onChange={e => setEmitTipo(e.target.value as "FA" | "FB")}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  >
                    {emitVenta.presupuesto.clientes?.condicion_iva === "RI" && (
                      <option value="FA">Factura A (discrimina IVA)</option>
                    )}
                    <option value="FB">Factura B (precio final)</option>
                  </select>
                </div>

                {/* Moneda / Tipo de cambio */}
                {emitVenta.presupuesto.moneda === "USD" && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-amber-700 dark:text-amber-400 font-medium">Factura en USD</div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-amber-600 dark:text-amber-500">Cotizacion USD/ARS *</label>
                        <input
                          type="number" step="0.01" min={0}
                          value={emitTipoCambio || ""}
                          onChange={e => setEmitTipoCambio(Number(e.target.value))}
                          placeholder="Ej: 1450.00"
                          className="w-32 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-mono dark:text-white"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-amber-500 mt-1">ARCA requiere la cotizacion oficial para facturas en USD. Los montos van en dolares.</p>
                  </div>
                )}

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
                          {idx === 0 && <span className="text-xs text-zinc-400">{emitTipo === "FA" ? "Neto" : "Precio"}</span>}
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
                        {emitTipo === "FA" && (
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
                        <div className={emitTipo === "FA" ? "col-span-1" : "col-span-3 flex items-end justify-end"}>
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

                {/* Totals */}
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3 space-y-1">
                  {(() => {
                    const mon = emitVenta.presupuesto.moneda as "ARS" | "USD";
                    if (emitTipo === "FA") {
                      const neto = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);
                      const iva = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario * it.iva_porcentaje / 100, 0);
                      return (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Neto</span>
                            <span>{formatCurrency(neto, mon)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">IVA</span>
                            <span>{formatCurrency(iva, mon)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1">
                            <span>Total</span>
                            <span>{formatCurrency(neto + iva, mon)}</span>
                          </div>
                        </>
                      );
                    } else {
                      const total = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);
                      return (
                        <div className="flex justify-between text-sm font-bold">
                          <span>Total (IVA incluido)</span>
                          <span>{formatCurrency(total, mon)}</span>
                        </div>
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
                    onClick={handleEmitFactura}
                    disabled={emitting}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {emitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Emitiendo...
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
