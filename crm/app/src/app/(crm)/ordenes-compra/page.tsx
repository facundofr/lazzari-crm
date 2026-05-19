"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { mockOrdenesCompra } from "@/lib/mock-data";
import type { OrdenCompra, OCStatus } from "@/lib/types";
import { ShoppingCart, Clock, CheckCircle2, Truck, Package, Search, XCircle, Send, FileText } from "lucide-react";
import { useState } from "react";

const statusConfig: Record<OCStatus, { label: string; variant: "success" | "warning" | "danger" | "info" | "outline" | "purple" }> = {
  borrador: { label: "Borrador", variant: "outline" },
  enviada: { label: "Enviada", variant: "info" },
  confirmada: { label: "Confirmada", variant: "warning" },
  recibida_parcial: { label: "Parcial", variant: "purple" },
  recibida: { label: "Recibida", variant: "success" },
  cancelada: { label: "Cancelada", variant: "danger" },
};

export default function OrdenesCompraPage() {
  const [filter, setFilter] = useState<OCStatus | "todas">("todas");

  const filtered = mockOrdenesCompra.filter((oc) => filter === "todas" || oc.estado === filter);
  const totalPendiente = mockOrdenesCompra.filter(oc => ["enviada", "confirmada"].includes(oc.estado)).reduce((a, oc) => a + oc.total, 0);
  const pendientesRecepcion = mockOrdenesCompra.filter(oc => ["enviada", "confirmada", "recibida_parcial"].includes(oc.estado)).length;

  return (
    <>
      <Header
        title="Órdenes de compra"
        subtitle={`${mockOrdenesCompra.length} órdenes de compra`}
        action={{ label: "Nueva OC", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total OC este mes" value={String(mockOrdenesCompra.length)} icon={ShoppingCart} iconColor="text-blue-600" />
          <StatCard title="Monto pendiente" value={formatCurrency(totalPendiente)} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Pend. recepción" value={String(pendientesRecepcion)} icon={Truck} iconColor="text-violet-600" />
          <StatCard title="Recibidas completas" value={String(mockOrdenesCompra.filter(oc => oc.estado === "recibida").length)} icon={CheckCircle2} iconColor="text-emerald-600" />
        </div>

        {/* Status tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["todas", "borrador", "enviada", "confirmada", "recibida_parcial", "recibida", "cancelada"] as const).map((status) => {
            const count = status === "todas" ? mockOrdenesCompra.length : mockOrdenesCompra.filter(oc => oc.estado === status).length;
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

        {/* Table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<OrdenCompra>
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
              { key: "proveedorNombre", label: "Proveedor", render: (row) => <span className="font-medium">{row.proveedorNombre}</span> },
              { key: "items", label: "Items", render: (row) => <span className="text-zinc-500">{row.items.length} líneas</span> },
              { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
              {
                key: "fechaEntregaEstimada", label: "Entrega est.",
                render: (row) => <span className="text-zinc-500">{row.fechaEntregaEstimada}</span>,
              },
              { key: "total", label: "Total", className: "text-right", render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(row.total)}</span> },
              {
                key: "estado", label: "Estado",
                render: (row) => {
                  const cfg = statusConfig[row.estado];
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
              {
                key: "recepcion", label: "Recepción",
                render: (row) => {
                  const totalQty = row.items.reduce((a, i) => a + i.cantidad, 0);
                  const recibido = row.items.reduce((a, i) => a + i.cantidadRecibida, 0);
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
                key: "presupuestoOrigenId", label: "PR origen",
                render: (row) => row.presupuestoOrigenId ? <Badge variant="info">Vinculado</Badge> : <span className="text-zinc-300">—</span>,
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
