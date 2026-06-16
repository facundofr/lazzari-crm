"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { mockOrdenesCompra } from "@/lib/mock-data";
import type { OCStatus } from "@/lib/types";
import {
  ShoppingCart, Clock, CheckCircle2, Truck, Loader2,
  X, Send, XCircle,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";

const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "outline" | "purple" }> = {
  borrador: { label: "Borrador", variant: "outline" },
  enviada: { label: "Enviada", variant: "info" },
  confirmada: { label: "Confirmada", variant: "warning" },
  recibida_parcial: { label: "Parcial", variant: "purple" },
  recibida: { label: "Recibida", variant: "success" },
  cancelada: { label: "Cancelada", variant: "danger" },
};

interface OCRow {
  id: string;
  numero: string;
  proveedor_id: string;
  fecha: string;
  fecha_entrega_estimada: string | null;
  estado: string;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  presupuesto_origen_id: string | null;
  observaciones: string;
  proveedores: { razon_social: string } | null;
  orden_compra_items: { cantidad: number; cantidad_recibida: number }[];
}

interface DetailItem {
  id: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  cantidad_recibida: number;
  precio_unitario: number;
  subtotal: number;
}

interface ProveedorOption {
  id: string;
  razon_social: string;
}

function mapMockToOCRow(oc: (typeof mockOrdenesCompra)[number]): OCRow {
  return {
    id: oc.id,
    numero: oc.numero,
    proveedor_id: oc.proveedorId,
    fecha: oc.fecha,
    fecha_entrega_estimada: oc.fechaEntregaEstimada,
    estado: oc.estado,
    subtotal: oc.subtotal,
    iva: oc.iva,
    total: oc.total,
    moneda: oc.moneda,
    presupuesto_origen_id: oc.presupuestoOrigenId || null,
    observaciones: oc.observaciones,
    proveedores: { razon_social: oc.proveedorNombre },
    orden_compra_items: oc.items.map((i) => ({
      cantidad: i.cantidad,
      cantidad_recibida: i.cantidadRecibida,
    })),
  };
}

export default function OrdenesCompraPage() {
  const [filter, setFilter] = useState<OCStatus | "todas">("todas");
  const [ordenes, setOrdenes] = useState<OCRow[]>([]);
  const [loading, setLoading] = useState(true);

  // SmartFilters state
  const [smartFilterValues, setSmartFilterValues] = useState<FilterValues>({
    fecha: { from: "", to: "" },
    moneda: "",
    monto: {},
  });

  const smartFilterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    {
      key: "moneda",
      label: "Moneda",
      type: "select",
      options: [
        { value: "USD", label: "USD" },
        { value: "ARS", label: "ARS" },
      ],
    },
    { key: "monto", label: "Monto total", type: "number-range" },
  ];

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [formData, setFormData] = useState({
    proveedor_id: "",
    fecha: new Date().toISOString().slice(0, 10),
    fecha_entrega_estimada: "",
    moneda: "ARS" as "ARS" | "USD",
    observaciones: "",
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // Detail panel
  const [detailOC, setDetailOC] = useState<OCRow | null>(null);
  const [detailItems, setDetailItems] = useState<DetailItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Fetch main data ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("ordenes_compra")
        .select(`*, proveedores(razon_social), orden_compra_items(cantidad, cantidad_recibida)`)
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        setOrdenes(data as unknown as OCRow[]);
      } else {
        setOrdenes(mockOrdenesCompra.map(mapMockToOCRow));
      }
    } catch {
      setOrdenes(mockOrdenesCompra.map(mapMockToOCRow));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fetch proveedores for the create modal ───────────────────────
  const fetchProveedores = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("proveedores")
        .select("id, razon_social")
        .eq("activo", true)
        .order("razon_social");
      if (data && data.length > 0) {
        setProveedores(data as unknown as ProveedorOption[]);
      }
    } catch {
      // ignore
    }
  }, []);

  // ── Fetch detail items ───────────────────────────────────────────
  const fetchDetailItems = useCallback(async (ocId: string) => {
    setDetailLoading(true);
    try {
      const { data, error } = await supabase
        .from("orden_compra_items")
        .select("id, codigo, descripcion, cantidad, cantidad_recibida, precio_unitario, subtotal")
        .eq("orden_id", ocId);
      if (!error && data) {
        setDetailItems(data as unknown as DetailItem[]);
      } else {
        setDetailItems([]);
      }
    } catch {
      setDetailItems([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────
  const openCreateModal = () => {
    setFormData({
      proveedor_id: "",
      fecha: new Date().toISOString().slice(0, 10),
      fecha_entrega_estimada: "",
      moneda: "ARS",
      observaciones: "",
    });
    setFormError("");
    setCreateOpen(true);
    fetchProveedores();
  };

  const handleCreate = async () => {
    if (!formData.proveedor_id) {
      setFormError("Seleccioná un proveedor");
      return;
    }
    setFormLoading(true);
    setFormError("");
    try {
      const { error } = await supabase.from("ordenes_compra").insert({
        proveedor_id: formData.proveedor_id,
        fecha: formData.fecha,
        fecha_entrega_estimada: formData.fecha_entrega_estimada || null,
        moneda: formData.moneda,
        observaciones: formData.observaciones,
        estado: "borrador",
        subtotal: 0,
        iva: 0,
        total: 0,
      } as any);
      if (error) throw error;
      setCreateOpen(false);
      await fetchData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al crear OC");
    } finally {
      setFormLoading(false);
    }
  };

  const handleRowClick = (row: OCRow) => {
    setDetailOC(row);
    fetchDetailItems(row.id);
  };

  const handleCancel = async (oc: OCRow) => {
    if (!confirm(`¿Cancelar la OC ${oc.numero}?`)) return;
    try {
      const { error } = await supabase
        .from("ordenes_compra")
        .update({ estado: "cancelada" } as any)
        .eq("id", oc.id);
      if (error) throw error;
      await fetchData();
      if (detailOC?.id === oc.id) setDetailOC(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al cancelar");
    }
  };

  const handleAdvanceEstado = async (oc: OCRow, nuevoEstado: "enviada" | "confirmada") => {
    try {
      const { error } = await supabase
        .from("ordenes_compra")
        .update({ estado: nuevoEstado } as any)
        .eq("id", oc.id);
      if (error) throw error;
      await fetchData();
      if (detailOC?.id === oc.id) {
        setDetailOC({ ...oc, estado: nuevoEstado });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al actualizar estado");
    }
  };

  // ── Computed ─────────────────────────────────────────────────────
  const filtered = ordenes.filter((oc) => {
    // existing estado tab filter
    if (filter !== "todas" && oc.estado !== filter) return false;
    // fecha filter
    const fechaFilter = smartFilterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && oc.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && oc.fecha > fechaFilter.to) return false;
    // moneda filter
    const monedaFilter = smartFilterValues.moneda as string;
    if (monedaFilter && oc.moneda !== monedaFilter) return false;
    // monto filter
    const montoFilter = smartFilterValues.monto as { min?: number; max?: number } | undefined;
    if (montoFilter?.min !== undefined && Number(oc.total) < montoFilter.min) return false;
    if (montoFilter?.max !== undefined && Number(oc.total) > montoFilter.max) return false;
    return true;
  });

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const ocEsteMes = ordenes.filter((oc) => {
    const d = new Date(oc.fecha);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const totalPendiente = ordenes
    .filter((oc) => ["enviada", "confirmada"].includes(oc.estado))
    .reduce((a, oc) => a + Number(oc.total), 0);
  const pendientesRecepcion = ordenes.filter((oc) =>
    ["enviada", "confirmada", "recibida_parcial"].includes(oc.estado)
  ).length;

  // ── Loading state ────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Header title="Ordenes de compra" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Ordenes de compra"
        subtitle={`${ordenes.length} ordenes de compra`}
        action={{ label: "Nueva OC", onClick: openCreateModal }}
      />

      <div className="p-4 sm:p-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total OC este mes" value={String(ocEsteMes.length)} icon={ShoppingCart} iconColor="text-blue-600" />
          <StatCard title="Monto pendiente" value={formatCurrency(totalPendiente)} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Pend. recepcion" value={String(pendientesRecepcion)} icon={Truck} iconColor="text-violet-600" />
          <StatCard title="Recibidas completas" value={String(ordenes.filter((oc) => oc.estado === "recibida").length)} icon={CheckCircle2} iconColor="text-emerald-600" />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["todas", "borrador", "enviada", "confirmada", "recibida_parcial", "recibida", "cancelada"] as const).map((status) => {
            const count = status === "todas" ? ordenes.length : ordenes.filter((oc) => oc.estado === status).length;
            if (status !== "todas" && count === 0) return null;
            return (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  filter === status
                    ? "bg-orange-500 text-white shadow-sm"
                    : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700"
                }`}
              >
                {status === "todas" ? "Todas" : statusConfig[status].label}
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${filter === status ? "bg-white/20" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <SmartFilters
          filters={smartFilterConfigs}
          values={smartFilterValues}
          onChange={setSmartFilterValues}
        />

        {/* Data table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<OCRow>
            columns={[
              {
                key: "numero",
                label: "N OC",
                sortable: true,
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              {
                key: "proveedores",
                label: "Proveedor",
                sortable: true,
                render: (row) => <span className="font-medium">{row.proveedores?.razon_social}</span>,
              },
              {
                key: "orden_compra_items",
                label: "Items",
                render: (row) => <span className="text-zinc-500">{row.orden_compra_items.length} lineas</span>,
              },
              {
                key: "fecha",
                label: "Fecha",
                sortable: true,
                render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span>,
              },
              {
                key: "fecha_entrega_estimada",
                label: "Entrega est.",
                sortable: true,
                render: (row) => (
                  <span className="text-zinc-500">
                    {row.fecha_entrega_estimada ? formatDate(row.fecha_entrega_estimada) : "\u2014"}
                  </span>
                ),
              },
              {
                key: "total",
                label: "Total",
                sortable: true,
                className: "text-right",
                render: (row) => (
                  <span className="font-mono font-semibold block text-right">
                    {formatCurrency(Number(row.total), row.moneda as "ARS" | "USD")}
                  </span>
                ),
              },
              {
                key: "estado",
                label: "Estado",
                sortable: true,
                render: (row) => {
                  const cfg = statusConfig[row.estado] || { label: row.estado, variant: "outline" as const };
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
              {
                key: "id",
                label: "Recepcion",
                render: (row) => {
                  const totalQty = row.orden_compra_items.reduce((a, i) => a + Number(i.cantidad), 0);
                  const recibido = row.orden_compra_items.reduce((a, i) => a + Number(i.cantidad_recibida), 0);
                  const pct = totalQty > 0 ? Math.round((recibido / totalQty) * 100) : 0;
                  return (
                    <div className="w-20">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-zinc-500">{pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className={`h-1.5 rounded-full ${pct === 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-500" : "bg-zinc-300"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                },
              },
              {
                key: "presupuesto_origen_id",
                label: "PR origen",
                render: (row) =>
                  row.presupuesto_origen_id ? <Badge variant="info">Vinculado</Badge> : <span className="text-zinc-300">{"\u2014"}</span>,
              },
              {
                key: "acciones",
                label: "Acciones",
                render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {row.estado === "borrador" && (
                      <button
                        onClick={() => handleAdvanceEstado(row, "enviada")}
                        className="p-1 rounded hover:bg-blue-50 text-blue-500 transition-colors"
                        title="Enviar"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    {row.estado === "enviada" && (
                      <button
                        onClick={() => handleAdvanceEstado(row, "confirmada")}
                        className="p-1 rounded hover:bg-green-50 text-green-600 transition-colors"
                        title="Confirmar"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    )}
                    {["borrador", "enviada", "confirmada"].includes(row.estado) && (
                      <button
                        onClick={() => handleCancel(row)}
                        className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors"
                        title="Cancelar"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            data={filtered}
            onRowClick={handleRowClick}
          />
        </Card>
      </div>

      {/* ── Create OC Modal ─────────────────────────────────────────── */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-lg font-semibold dark:text-white">Nueva Orden de Compra</h2>
              <button onClick={() => setCreateOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{formError}</div>
              )}
              {/* Proveedor */}
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Proveedor *</label>
                <select
                  value={formData.proveedor_id}
                  onChange={(e) => setFormData((p) => ({ ...p, proveedor_id: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                >
                  <option value="">Seleccionar proveedor...</option>
                  {proveedores.map((prov) => (
                    <option key={prov.id} value={prov.id}>{prov.razon_social}</option>
                  ))}
                </select>
              </div>
              {/* Fecha */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha</label>
                  <input
                    type="date"
                    value={formData.fecha}
                    onChange={(e) => setFormData((p) => ({ ...p, fecha: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Entrega estimada</label>
                  <input
                    type="date"
                    value={formData.fecha_entrega_estimada}
                    onChange={(e) => setFormData((p) => ({ ...p, fecha_entrega_estimada: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                  />
                </div>
              </div>
              {/* Moneda */}
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Moneda</label>
                <select
                  value={formData.moneda}
                  onChange={(e) => setFormData((p) => ({ ...p, moneda: e.target.value as "ARS" | "USD" }))}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                >
                  <option value="ARS">ARS - Pesos</option>
                  <option value="USD">USD - Dolares</option>
                </select>
              </div>
              {/* Observaciones */}
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Observaciones</label>
                <textarea
                  value={formData.observaciones}
                  onChange={(e) => setFormData((p) => ({ ...p, observaciones: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={formLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {formLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear OC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Side Panel ───────────────────────────────────────── */}
      {detailOC && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailOC(null)} />
          <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-semibold font-mono dark:text-white">{detailOC.numero}</h2>
                <p className="text-sm text-zinc-500">{detailOC.proveedores?.razon_social}</p>
              </div>
              <button onClick={() => setDetailOC(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-400">Fecha</span>
                  <p className="font-medium">{formatDate(detailOC.fecha)}</p>
                </div>
                <div>
                  <span className="text-zinc-400">Entrega estimada</span>
                  <p className="font-medium">{detailOC.fecha_entrega_estimada ? formatDate(detailOC.fecha_entrega_estimada) : "\u2014"}</p>
                </div>
                <div>
                  <span className="text-zinc-400">Estado</span>
                  <div className="mt-1">
                    <Badge variant={(statusConfig[detailOC.estado] || { variant: "outline" as const }).variant}>
                      {(statusConfig[detailOC.estado] || { label: detailOC.estado }).label}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-zinc-400">Moneda</span>
                  <p className="font-medium">{detailOC.moneda}</p>
                </div>
              </div>

              {/* Observaciones */}
              {detailOC.observaciones && (
                <div className="text-sm">
                  <span className="text-zinc-400">Observaciones</span>
                  <p className="mt-1 text-zinc-700 dark:text-zinc-300">{detailOC.observaciones}</p>
                </div>
              )}

              {/* Totals */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Subtotal</span>
                  <span className="font-mono">{formatCurrency(Number(detailOC.subtotal), detailOC.moneda as "ARS" | "USD")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">IVA</span>
                  <span className="font-mono">{formatCurrency(Number(detailOC.iva), detailOC.moneda as "ARS" | "USD")}</span>
                </div>
                <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold">
                  <span>Total</span>
                  <span className="font-mono">{formatCurrency(Number(detailOC.total), detailOC.moneda as "ARS" | "USD")}</span>
                </div>
              </div>

              {/* Items table */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Items de la orden</h3>
                {detailLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                  </div>
                ) : detailItems.length === 0 ? (
                  <p className="text-sm text-zinc-400 py-4 text-center">Sin items</p>
                ) : (
                  <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800 text-left text-xs text-zinc-500 uppercase">
                          <th className="px-3 py-2">Codigo</th>
                          <th className="px-3 py-2">Descripcion</th>
                          <th className="px-3 py-2 text-right">Cant.</th>
                          <th className="px-3 py-2 text-right">P. Unit.</th>
                          <th className="px-3 py-2 text-right">Subtotal</th>
                          <th className="px-3 py-2">Recepcion</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {detailItems.map((item) => {
                          const pct = Number(item.cantidad) > 0
                            ? Math.round((Number(item.cantidad_recibida) / Number(item.cantidad)) * 100)
                            : 0;
                          return (
                            <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                              <td className="px-3 py-2 font-mono text-xs">{item.codigo}</td>
                              <td className="px-3 py-2">{item.descripcion}</td>
                              <td className="px-3 py-2 text-right">{item.cantidad}</td>
                              <td className="px-3 py-2 text-right font-mono">
                                {formatCurrency(Number(item.precio_unitario), detailOC.moneda as "ARS" | "USD")}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {formatCurrency(Number(item.subtotal), detailOC.moneda as "ARS" | "USD")}
                              </td>
                              <td className="px-3 py-2">
                                <div className="w-20">
                                  <div className="flex justify-between text-xs mb-0.5">
                                    <span>{item.cantidad_recibida}/{item.cantidad}</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                                    <div
                                      className={`h-1.5 rounded-full ${pct === 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-500" : "bg-zinc-300"}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
