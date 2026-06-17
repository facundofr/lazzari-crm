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
  Loader2, X, ChevronRight, ArrowRight, ShieldCheck, XCircle,
  Plus, Minus, User, ExternalLink, ClipboardCopy, Download,
  Eye, Check, DollarSign,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

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
  vendedor_id: string | null;
  vendedor_profile: { full_name: string; avatar_url: string | null } | null;
  clientes: { razon_social: string; cuit: string; condicion_iva?: string } | null;
  presupuesto_items?: {
    descripcion: string;
    cantidad: number;
    precio_venta: number;
    iva_porcentaje?: number;
    total: number;
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

// ── Emit Modal Types ──────────────────────────────────────────────

interface EmitItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
}

const PV_CRM = 15;

function formatComprobante(tipo: string, pv: number, num: number) {
  return `${tipo} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
}

// ── Pipeline step config ──────────────────────────────────────────

const STEPS = [
  { key: "presupuesto", label: "Presupuesto", icon: FileText },
  { key: "entrega", label: "Entrega", icon: Truck },
  { key: "factura", label: "Factura", icon: Receipt },
  { key: "cobro", label: "Cobro", icon: CheckCircle2 },
] as const;

function getVentaStep(v: Venta): number {
  const hasFacturaPagada = v.facturas.some(f => f.estado === "pagada");
  if (hasFacturaPagada) return 3; // cobro

  const hasFactura = v.facturas.some(f => f.estado === "emitida");
  if (hasFactura) return 2; // factura emitida

  const hasRemito = v.remitos.length > 0;
  if (hasRemito) return 1; // entregado

  return 0; // presupuesto aprobado
}

// ── Page ──────────────────────────────────────────────────────────

export default function VentasPage() {
  const { profile, role } = useUser();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVenta, setSelectedVenta] = useState<Venta | null>(null);
  const [filterStep, setFilterStep] = useState<string>("todos");
  const [filterVendedor, setFilterVendedor] = useState<string>("todos");
  const [vendedores, setVendedores] = useState<VendedorOption[]>([]);

  // Emit modal
  const [emitOpen, setEmitOpen] = useState(false);
  const [emitStep, setEmitStep] = useState<"form" | "emitting" | "success" | "error">("form");
  const [emitResult, setEmitResult] = useState<any>(null);
  const [emitError, setEmitError] = useState("");
  const [emitVenta, setEmitVenta] = useState<Venta | null>(null);
  const [emitData, setEmitData] = useState({
    tipo: "FB",
    items: [] as EmitItem[],
  });

  // Auto-filter vendedor for vendedor role
  useEffect(() => {
    if (role === "vendedor" && profile?.id) {
      setFilterVendedor(profile.id);
    }
  }, [role, profile]);

  // Fetch vendedores list
  useEffect(() => {
    supabase.from("profiles").select("id, full_name").in("role", ["vendedor", "admin", "super_admin"]).eq("active", true).order("full_name")
      .then(({ data }) => { if (data) setVendedores(data as VendedorOption[]); });
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const { data: presupuestos } = await supabase
        .from("presupuestos")
        .select(`*, clientes(razon_social, cuit, condicion_iva), vendedor_profile:vendedor_id(full_name, avatar_url), presupuesto_items(descripcion, cantidad, precio_venta, iva_porcentaje, total)`)
        .in("estado", ["aprobado"])
        .order("fecha", { ascending: false });

      if (!presupuestos || presupuestos.length === 0) {
        setVentas([]);
        setLoading(false);
        return;
      }

      const presupuestoIds = presupuestos.map(p => p.id);

      // Fetch related facturas
      const { data: facturas } = await supabase
        .from("facturas")
        .select("id, tipo, punto_venta, numero, fecha, cae, subtotal, iva, total, estado, presupuesto_id")
        .in("presupuesto_id", presupuestoIds);

      // Fetch related remitos
      const { data: remitos } = await supabase
        .from("remitos")
        .select("id, numero, fecha, estado, presupuesto_id")
        .in("presupuesto_id", presupuestoIds);

      const ventasList: Venta[] = presupuestos.map(p => ({
        presupuesto: p as unknown as VentaPresupuesto,
        facturas: (facturas || []).filter(f => f.presupuesto_id === p.id) as VentaFactura[],
        remitos: (remitos || []).filter(r => r.presupuesto_id === p.id) as VentaRemito[],
      }));

      setVentas(ventasList);
    } catch {
      setVentas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Facturar from presupuesto ──────────────────────────────────

  const openFacturar = (v: Venta) => {
    const p = v.presupuesto;
    const items: EmitItem[] = (p.presupuesto_items || []).map(it => ({
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_venta || it.total / (it.cantidad || 1),
      iva_porcentaje: it.iva_porcentaje || 21,
    }));

    const clienteCuit = p.clientes?.cuit;
    const defaultTipo = clienteCuit ? "FA" : "FB";

    setEmitVenta(v);
    setEmitData({ tipo: defaultTipo, items: items.length > 0 ? items : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }] });
    setEmitStep("form");
    setEmitError("");
    setEmitResult(null);
    setEmitOpen(true);
  };

  const isFacturaA = emitData.tipo === "FA" || emitData.tipo === "NCA";

  const emitTotals = emitData.items.reduce((acc, it) => {
    if (isFacturaA) {
      const neto = it.cantidad * it.precio_unitario;
      const iva = neto * (it.iva_porcentaje / 100);
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + neto + iva };
    } else {
      const total = it.cantidad * it.precio_unitario;
      const neto = Math.round(total / 1.21 * 100) / 100;
      const iva = Math.round((total - neto) * 100) / 100;
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + total };
    }
  }, { neto: 0, iva: 0, total: 0 });

  const addItem = () => setEmitData(p => ({ ...p, items: [...p.items, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }] }));
  const removeItem = (idx: number) => setEmitData(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx: number, field: keyof EmitItem, value: string | number) => {
    setEmitData(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [field]: value } : it) }));
  };

  const handleEmit = async () => {
    if (!emitVenta) return;
    if (emitData.items.some(it => !it.descripcion || it.precio_unitario <= 0)) {
      setEmitError("Completa todos los items con descripcion y precio");
      return;
    }

    setEmitStep("emitting");
    setEmitError("");

    try {
      const res = await fetch("/api/facturacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: emitData.tipo,
          cliente_id: emitVenta.presupuesto.cliente_id,
          punto_venta: PV_CRM,
          items: emitData.items,
          presupuesto_id: emitVenta.presupuesto.id,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setEmitResult(data.factura);
        setEmitStep("success");
        if (data.factura?.id) {
          const itemsToInsert = emitData.items.map((it, idx) => ({
            factura_id: data.factura.id,
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            iva_porcentaje: it.iva_porcentaje,
            orden: idx + 1,
          }));
          await supabase.from("factura_items").insert(itemsToInsert as any);
        }
        await fetchData();
      } else {
        setEmitError(data.error || "Error al emitir factura");
        setEmitStep("error");
      }
    } catch (err: unknown) {
      setEmitError(err instanceof Error ? err.message : "Error de conexion");
      setEmitStep("error");
    }
  };

  // ── Marcar pagada ──────────────────────────────────────────────

  const handleMarcarPagada = async (facturaId: string) => {
    await supabase.from("facturas").update({ estado: "pagada" } as any).eq("id", facturaId);
    await fetchData();
  };

  // ── Filter ──────────────────────────────────────────────────────

  const filteredVentas = ventas.filter(v => {
    // Filter by vendedor
    if (filterVendedor !== "todos" && v.presupuesto.vendedor_id !== filterVendedor) return false;
    // Filter by step
    if (filterStep === "todos") return true;
    const step = getVentaStep(v);
    if (filterStep === "pendiente_factura") return step < 2;
    if (filterStep === "facturado") return step === 2;
    if (filterStep === "cobrado") return step === 3;
    return true;
  });

  // ── KPIs ──────────────────────────────────────────────────────

  const pendientesFactura = ventas.filter(v => getVentaStep(v) < 2).length;
  const facturadas = ventas.filter(v => getVentaStep(v) === 2).length;
  const cobradas = ventas.filter(v => getVentaStep(v) === 3).length;
  const totalPendiente = ventas
    .filter(v => getVentaStep(v) < 2)
    .reduce((a, v) => a + Number(v.presupuesto.total), 0);

  if (loading) {
    return (
      <>
        <Header title="Ventas" subtitle="Seguimiento de ventas" />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Ventas" subtitle="Seguimiento del proceso de venta" />
      <div className="p-6 lg:p-8 space-y-6">
        {/* Vendedor filter */}
        {role !== "vendedor" && vendedores.length > 0 && (
          <div className="flex items-center gap-3">
            <User className="h-4 w-4 text-zinc-400" />
            <select
              value={filterVendedor}
              onChange={(e) => setFilterVendedor(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
            >
              <option value="todos">Todos los vendedores</option>
              {vendedores.map(v => (
                <option key={v.id} value={v.id}>{v.full_name}</option>
              ))}
            </select>
            {filterVendedor !== "todos" && (
              <button onClick={() => setFilterVendedor("todos")} className="text-xs text-zinc-400 hover:text-zinc-600">Limpiar</button>
            )}
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <button onClick={() => setFilterStep("todos")} className={`rounded-xl border p-4 text-left transition-colors ${filterStep === "todos" ? "border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total ventas activas</p>
            <p className="text-2xl font-bold mt-1 dark:text-white">{ventas.length}</p>
          </button>
          <button onClick={() => setFilterStep("pendiente_factura")} className={`rounded-xl border p-4 text-left transition-colors ${filterStep === "pendiente_factura" ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Pendientes de facturar</p>
            <p className="text-2xl font-bold mt-1 text-amber-600">{pendientesFactura}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{formatCurrency(totalPendiente)}</p>
          </button>
          <button onClick={() => setFilterStep("facturado")} className={`rounded-xl border p-4 text-left transition-colors ${filterStep === "facturado" ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Facturadas (pendiente cobro)</p>
            <p className="text-2xl font-bold mt-1 text-blue-600">{facturadas}</p>
          </button>
          <button onClick={() => setFilterStep("cobrado")} className={`rounded-xl border p-4 text-left transition-colors ${filterStep === "cobrado" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Cobradas</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{cobradas}</p>
          </button>
        </div>

        {/* Ventas list */}
        {filteredVentas.length === 0 ? (
          <Card className="p-12 text-center">
            <FileText className="h-10 w-10 text-zinc-300 mx-auto mb-3" />
            <p className="text-zinc-500 dark:text-zinc-400">
              {ventas.length === 0
                ? "No hay presupuestos aprobados. Aprobá un presupuesto para iniciar el seguimiento de venta."
                : "No hay ventas en este estado."}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredVentas.map(v => {
              const p = v.presupuesto;
              const step = getVentaStep(v);
              const facturaEmitida = v.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");

              return (
                <Card
                  key={p.id}
                  className="p-0 overflow-hidden cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
                  onClick={() => setSelectedVenta(v)}
                >
                  <div className="p-5">
                    {/* Header: number + client + total */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-orange-600 dark:text-orange-400">{p.numero}</span>
                          <ChevronRight className="h-3 w-3 text-zinc-300" />
                          <span className="font-medium text-sm text-zinc-800 dark:text-zinc-200">{p.clientes?.razon_social || "—"}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-zinc-400">{formatDate(p.fecha)}</span>
                          {p.vendedor_profile?.full_name && (
                            <span className="flex items-center gap-1 text-xs text-zinc-400">
                              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-100 text-[8px] font-bold text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">
                                {getInitials(p.vendedor_profile.full_name)}
                              </span>
                              {p.vendedor_profile.full_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold text-lg dark:text-white">{formatCurrency(Number(p.total))}</p>
                        {p.moneda === "USD" && <p className="text-xs text-zinc-400">USD</p>}
                      </div>
                    </div>

                    {/* Pipeline steps */}
                    <div className="flex items-center gap-1">
                      {STEPS.map((s, idx) => {
                        const isCompleted = idx <= step;
                        const isCurrent = idx === step;
                        const StepIcon = s.icon;
                        return (
                          <div key={s.key} className="flex items-center gap-1 flex-1">
                            <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium flex-1 justify-center transition-colors ${
                              isCompleted
                                ? isCurrent
                                  ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                                  : "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : "bg-zinc-50 text-zinc-400 dark:bg-zinc-800/50 dark:text-zinc-500"
                            }`}>
                              <StepIcon className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{s.label}</span>
                            </div>
                            {idx < STEPS.length - 1 && (
                              <ArrowRight className={`h-3 w-3 flex-shrink-0 ${idx < step ? "text-emerald-400" : "text-zinc-200 dark:text-zinc-700"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Actions row */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <Link href={`/presupuestos?id=${p.id}`} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                          <FileText className="h-3 w-3" /> Presupuesto
                        </Link>
                        <Link href={`/remitos?presupuesto_id=${p.id}`} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                          <Truck className="h-3 w-3" /> Remitos{v.remitos.length > 0 ? ` (${v.remitos.length})` : ""}
                        </Link>
                        {facturaEmitida && (
                          <Link href={`/facturacion?id=${facturaEmitida.id}`} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors">
                            <ShieldCheck className="h-3 w-3" /> {formatComprobante(facturaEmitida.tipo, facturaEmitida.punto_venta, facturaEmitida.numero)}
                          </Link>
                        )}
                      </div>
                      <div onClick={e => e.stopPropagation()}>
                        {step < 2 && (
                          <button onClick={() => openFacturar(v)} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors">
                            <Receipt className="h-3.5 w-3.5" /> Facturar
                          </button>
                        )}
                        {step === 2 && (
                          <button onClick={() => { if (facturaEmitida) handleMarcarPagada(facturaEmitida.id); }} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 transition-colors">
                            <DollarSign className="h-3.5 w-3.5" /> Cobrar
                          </button>
                        )}
                        {step === 3 && (
                          <Badge variant="success">Completada</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Detail Side Panel ──────────────────────────────────────── */}
      {selectedVenta && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedVenta(null)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-6 py-4 border-b border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700">
              <div>
                <h2 className="font-mono text-lg font-bold dark:text-white">{selectedVenta.presupuesto.numero}</h2>
                <p className="text-sm text-zinc-500">{selectedVenta.presupuesto.clientes?.razon_social}</p>
                {selectedVenta.presupuesto.vendedor_profile?.full_name && (
                  <p className="text-xs text-zinc-400 mt-0.5">Vendedor: {selectedVenta.presupuesto.vendedor_profile.full_name}</p>
                )}
              </div>
              <button onClick={() => setSelectedVenta(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {(() => {
                const sv = selectedVenta;
                const step = getVentaStep(sv);
                const facturaEmitida = sv.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");

                return (
                  <>
                    {/* ── 1. Presupuesto ──────────────────────── */}
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 dark:bg-emerald-950/20">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-emerald-600" />
                          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">1. Presupuesto</span>
                          <Badge variant="success">Aprobado</Badge>
                        </div>
                        <Link href={`/presupuestos?id=${sv.presupuesto.id}`} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-orange-500 transition-colors">
                          <ExternalLink className="h-3 w-3" /> Abrir
                        </Link>
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-zinc-500">Numero</span>
                          <span className="font-mono font-medium dark:text-white">{sv.presupuesto.numero}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-zinc-500">Fecha</span>
                          <span className="dark:text-zinc-300">{formatDate(sv.presupuesto.fecha)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-zinc-500">Total</span>
                          <span className="font-mono font-semibold dark:text-white">{formatCurrency(Number(sv.presupuesto.total))}{sv.presupuesto.moneda === "USD" ? " USD" : ""}</span>
                        </div>
                        {(sv.presupuesto.presupuesto_items || []).length > 0 && (
                          <details className="mt-1">
                            <summary className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300">
                              Ver {sv.presupuesto.presupuesto_items!.length} items
                            </summary>
                            <div className="mt-2 space-y-1">
                              {sv.presupuesto.presupuesto_items!.map((it, idx) => (
                                <div key={idx} className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                                  <span>{it.cantidad}x {it.descripcion}</span>
                                  <span className="font-mono">{formatCurrency(it.total)}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>

                    {/* ── 2. Entrega / Remitos ────────────────── */}
                    <div className={`rounded-lg border overflow-hidden ${step >= 1 ? "border-zinc-200 dark:border-zinc-700" : "border-dashed border-zinc-200 dark:border-zinc-700"}`}>
                      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50">
                        <div className="flex items-center gap-2">
                          <Truck className={`h-4 w-4 ${step >= 1 ? "text-emerald-600" : "text-zinc-400"}`} />
                          <span className={`text-sm font-semibold ${step >= 1 ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}>2. Entrega</span>
                          {sv.remitos.length > 0 && <Badge variant="success">{sv.remitos.length} remito{sv.remitos.length > 1 ? "s" : ""}</Badge>}
                        </div>
                        <Link href={`/remitos?presupuesto_id=${sv.presupuesto.id}`} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-orange-500 transition-colors">
                          <ExternalLink className="h-3 w-3" /> {sv.remitos.length > 0 ? "Ver" : "Crear"} remito
                        </Link>
                      </div>
                      {sv.remitos.length > 0 ? (
                        <div className="px-4 py-3 space-y-2">
                          {sv.remitos.map(r => (
                            <div key={r.id} className="flex justify-between text-sm">
                              <span className="font-mono text-zinc-700 dark:text-zinc-300">{r.numero}</span>
                              <span className="text-zinc-500">{formatDate(r.fecha)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-4 py-4 text-center">
                          <p className="text-xs text-zinc-400">Sin remitos. Podes crear uno desde Remitos.</p>
                        </div>
                      )}
                    </div>

                    {/* ── 3. Factura ───────────────────────────── */}
                    <div className={`rounded-lg border overflow-hidden ${step >= 2 ? "border-zinc-200 dark:border-zinc-700" : "border-dashed border-zinc-200 dark:border-zinc-700"}`}>
                      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50">
                        <div className="flex items-center gap-2">
                          <Receipt className={`h-4 w-4 ${step >= 2 ? "text-emerald-600" : "text-zinc-400"}`} />
                          <span className={`text-sm font-semibold ${step >= 2 ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}>3. Factura</span>
                          {facturaEmitida && <Badge variant="success">Emitida</Badge>}
                        </div>
                        {facturaEmitida && (
                          <Link href={`/facturacion?id=${facturaEmitida.id}`} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-orange-500 transition-colors">
                            <ExternalLink className="h-3 w-3" /> Ver factura
                          </Link>
                        )}
                      </div>
                      {facturaEmitida ? (
                        <div className="px-4 py-3 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Comprobante</span>
                            <span className="font-mono font-medium dark:text-white">{formatComprobante(facturaEmitida.tipo, facturaEmitida.punto_venta, facturaEmitida.numero)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Total</span>
                            <span className="font-mono font-semibold dark:text-white">{formatCurrency(Number(facturaEmitida.total))}</span>
                          </div>
                          {facturaEmitida.cae && (
                            <div className="flex justify-between text-sm">
                              <span className="text-zinc-500">CAE</span>
                              <span className="font-mono text-emerald-600 dark:text-emerald-400">{facturaEmitida.cae}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="px-4 py-4">
                          <button
                            onClick={() => { setSelectedVenta(null); openFacturar(sv); }}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
                          >
                            <Receipt className="h-4 w-4" /> Facturar con ARCA
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ── 4. Cobro ─────────────────────────────── */}
                    <div className={`rounded-lg border overflow-hidden ${step >= 3 ? "border-emerald-200 dark:border-emerald-800" : "border-dashed border-zinc-200 dark:border-zinc-700"}`}>
                      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50">
                        <div className="flex items-center gap-2">
                          <DollarSign className={`h-4 w-4 ${step >= 3 ? "text-emerald-600" : "text-zinc-400"}`} />
                          <span className={`text-sm font-semibold ${step >= 3 ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>4. Cobro</span>
                          {step >= 3 && <Badge variant="success">Cobrada</Badge>}
                        </div>
                      </div>
                      {step === 2 && facturaEmitida ? (
                        <div className="px-4 py-4">
                          <button
                            onClick={() => handleMarcarPagada(facturaEmitida.id)}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 transition-colors"
                          >
                            <DollarSign className="h-4 w-4" /> Registrar cobro
                          </button>
                        </div>
                      ) : step >= 3 ? (
                        <div className="px-4 py-3 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" /> Venta completada
                        </div>
                      ) : (
                        <div className="px-4 py-4 text-center">
                          <p className="text-xs text-zinc-400">Pendiente — primero emiti la factura</p>
                        </div>
                      )}
                    </div>

                    {/* ── Links rapidos ────────────────────────── */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Ir a</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <Link href={`/clientes?id=${sv.presupuesto.cliente_id}`} className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                          <User className="h-3.5 w-3.5" /> Cliente
                        </Link>
                        <Link href={`/presupuestos?id=${sv.presupuesto.id}`} className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                          <FileText className="h-3.5 w-3.5" /> Presupuesto
                        </Link>
                        <Link href={`/remitos?presupuesto_id=${sv.presupuesto.id}`} className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                          <Truck className="h-3.5 w-3.5" /> Remitos
                        </Link>
                        <Link href="/facturacion" className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                          <Receipt className="h-3.5 w-3.5" /> Facturacion
                        </Link>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Emit Modal ────────────────────────────────────────────── */}
      {emitOpen && emitVenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-bold dark:text-white">Facturar {emitVenta.presupuesto.numero}</h2>
                <p className="text-sm text-zinc-400">{emitVenta.presupuesto.clientes?.razon_social} — PV {String(PV_CRM).padStart(4, "0")}</p>
              </div>
              <button onClick={() => setEmitOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            {emitStep === "form" && (
              <div className="p-6 space-y-5">
                {emitError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{emitError}</div>}

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Tipo de comprobante</label>
                  <select value={emitData.tipo} onChange={(e) => setEmitData(p => ({ ...p, tipo: e.target.value }))} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                    <option value="FA">Factura A</option>
                    <option value="FB">Factura B</option>
                  </select>
                  {isFacturaA && !emitVenta.presupuesto.clientes?.cuit && (
                    <p className="text-xs text-red-500 mt-1">El cliente no tiene CUIT. Factura A requiere CUIT.</p>
                  )}
                </div>

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium dark:text-zinc-300">Items</label>
                    <button onClick={addItem} className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium">
                      <Plus className="h-3 w-3" /> Agregar
                    </button>
                  </div>
                  <div className="space-y-3">
                    {emitData.items.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <div className={isFacturaA ? "col-span-5" : "col-span-7"}>
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Descripcion</label>}
                          <input value={item.descripcion} onChange={e => updateItem(idx, "descripcion", e.target.value)} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Cant.</label>}
                          <input type="number" min={1} value={item.cantidad} onChange={e => updateItem(idx, "cantidad", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">{isFacturaA ? "Neto" : "Precio"}</label>}
                          <input type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={e => updateItem(idx, "precio_unitario", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        {isFacturaA && (
                          <div className="col-span-2">
                            {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">IVA</label>}
                            <select value={item.iva_porcentaje} onChange={e => updateItem(idx, "iva_porcentaje", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className="col-span-1 flex items-end">
                          {emitData.items.length > 1 && (
                            <button onClick={() => removeItem(idx)} className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-500">
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
                  {isFacturaA ? (
                    <>
                      <div className="flex justify-between"><span className="text-zinc-500">Neto gravado</span><span className="font-mono">{formatCurrency(emitTotals.neto)}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(emitTotals.iva)}</span></div>
                      <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold text-base">
                        <span>Total</span><span className="font-mono">{formatCurrency(emitTotals.total)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between font-semibold text-base">
                      <span>Total</span><span className="font-mono">{formatCurrency(emitTotals.total)}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
                  <button onClick={handleEmit} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                    <ShieldCheck className="h-4 w-4" /> Emitir con ARCA
                  </button>
                </div>
              </div>
            )}

            {emitStep === "emitting" && (
              <div className="p-12 flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                <p className="text-sm text-zinc-500">Autorizando con ARCA...</p>
              </div>
            )}

            {emitStep === "success" && emitResult && (
              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h3 className="text-lg font-bold dark:text-white">Factura emitida</h3>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Comprobante</span><span className="font-mono font-bold">{emitResult.comprobante}</span></div>
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">CAE</span><span className="font-mono">{emitResult.cae}</span></div>
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Vto CAE</span><span>{emitResult.cae_vencimiento ? formatDate(emitResult.cae_vencimiento) : "—"}</span></div>
                  <div className="flex justify-between border-t border-emerald-200 dark:border-emerald-700 pt-2"><span className="text-emerald-700 dark:text-emerald-400 font-semibold">Total</span><span className="font-mono font-bold">{formatCurrency(emitResult.total)}</span></div>
                </div>
                <div className="flex justify-center">
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cerrar</button>
                </div>
              </div>
            )}

            {emitStep === "error" && (
              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                    <XCircle className="h-8 w-8 text-red-600" />
                  </div>
                  <h3 className="text-lg font-bold dark:text-white">Error al emitir</h3>
                  <p className="text-sm text-red-600 text-center max-w-md">{emitError}</p>
                </div>
                <div className="flex justify-center gap-3">
                  <button onClick={() => setEmitStep("form")} className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">Intentar de nuevo</button>
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cerrar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
