"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { mockOrdenesCompra } from "@/lib/mock-data";
import type { OCStatus } from "@/lib/types";
import { ShoppingCart, Clock, CheckCircle2, Truck, Package, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

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

export default function OrdenesCompraPage() {
  const [filter, setFilter] = useState<OCStatus | "todas">("todas");
  const [ordenes, setOrdenes] = useState<OCRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const { data, error } = await supabase
          .from("ordenes_compra")
          .select(`*, proveedores(razon_social), orden_compra_items(cantidad, cantidad_recibida)`)
          .order("fecha", { ascending: false });

        if (!error && data && data.length > 0) {
          setOrdenes(data as unknown as OCRow[]);
        } else {
          // Fallback to mock
          setOrdenes(mockOrdenesCompra.map((oc) => ({
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
            orden_compra_items: oc.items.map((i) => ({ cantidad: i.cantidad, cantidad_recibida: i.cantidadRecibida })),
          })));
        }
      } catch {
        setOrdenes(mockOrdenesCompra.map((oc) => ({
          id: oc.id, numero: oc.numero, proveedor_id: oc.proveedorId, fecha: oc.fecha,
          fecha_entrega_estimada: oc.fechaEntregaEstimada, estado: oc.estado, subtotal: oc.subtotal,
          iva: oc.iva, total: oc.total, moneda: oc.moneda, presupuesto_origen_id: oc.presupuestoOrigenId || null,
          observaciones: oc.observaciones, proveedores: { razon_social: oc.proveedorNombre },
          orden_compra_items: oc.items.map((i) => ({ cantidad: i.cantidad, cantidad_recibida: i.cantidadRecibida })),
        })));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const filtered = ordenes.filter((oc) => filter === "todas" || oc.estado === filter);
  const totalPendiente = ordenes.filter(oc => ["enviada", "confirmada"].includes(oc.estado)).reduce((a, oc) => a + Number(oc.total), 0);
  const pendientesRecepcion = ordenes.filter(oc => ["enviada", "confirmada", "recibida_parcial"].includes(oc.estado)).length;

  if (loading) {
    return (
      <>
        <Header title="Órdenes de compra" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Órdenes de compra"
        subtitle={`${ordenes.length} órdenes de compra`}
        action={{ label: "Nueva OC", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total OC este mes" value={String(ordenes.length)} icon={ShoppingCart} iconColor="text-blue-600" />
          <StatCard title="Monto pendiente" value={formatCurrency(totalPendiente)} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Pend. recepción" value={String(pendientesRecepcion)} icon={Truck} iconColor="text-violet-600" />
          <StatCard title="Recibidas completas" value={String(ordenes.filter(oc => oc.estado === "recibida").length)} icon={CheckCircle2} iconColor="text-emerald-600" />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["todas", "borrador", "enviada", "confirmada", "recibida_parcial", "recibida", "cancelada"] as const).map((status) => {
            const count = status === "todas" ? ordenes.length : ordenes.filter(oc => oc.estado === status).length;
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
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${filter === status ? "bg-white/20" : "bg-zinc-100 text-zinc-500"}`}>{count}</span>
              </button>
            );
          })}
        </div>

        <Card className="p-0 overflow-hidden">
          <DataTable<OCRow>
            columns={[
              {
                key: "numero", label: "N° OC",
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              { key: "proveedores", label: "Proveedor", render: (row) => <span className="font-medium">{row.proveedores?.razon_social}</span> },
              { key: "orden_compra_items", label: "Items", render: (row) => <span className="text-zinc-500">{row.orden_compra_items.length} líneas</span> },
              { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
              {
                key: "fecha_entrega_estimada", label: "Entrega est.",
                render: (row) => <span className="text-zinc-500">{row.fecha_entrega_estimada || "—"}</span>,
              },
              { key: "total", label: "Total", className: "text-right", render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(Number(row.total))}</span> },
              {
                key: "estado", label: "Estado",
                render: (row) => {
                  const cfg = statusConfig[row.estado] || { label: row.estado, variant: "outline" as const };
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
              {
                key: "id", label: "Recepción",
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
                        <div className={`h-1.5 rounded-full ${pct === 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-500" : "bg-zinc-300"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                },
              },
              {
                key: "presupuesto_origen_id", label: "PR origen",
                render: (row) => row.presupuesto_origen_id ? <Badge variant="info">Vinculado</Badge> : <span className="text-zinc-300">—</span>,
              },
            ]}
            data={filtered}
            onRowClick={() => {}}
          />
        </Card>
      </div>
    </>
  );
}
