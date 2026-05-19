"use client";

import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  DollarSign, FileText, Users, Package, TrendingUp, Percent,
  ArrowRight, Clock, AlertTriangle, CheckCircle2, XCircle, PauseCircle,
} from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import {
  dashboardKPIs, mockPresupuestos, mockActivity, mockAlerts,
  ventasPorMes, presupuestosPorEstado, topClientes,
} from "@/lib/mock-data";
import type { Presupuesto, ActivityLog, Alert } from "@/lib/types";

const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "purple" | "outline" | "info" }> = {
  borrador: { label: "Borrador", variant: "outline" },
  pendiente: { label: "Pendiente", variant: "warning" },
  aprobado: { label: "Aprobado", variant: "success" },
  rechazado: { label: "Rechazado", variant: "danger" },
  postergado: { label: "Postergado", variant: "purple" },
  vencido: { label: "Vencido", variant: "danger" },
};

const alertIcons: Record<string, typeof AlertTriangle> = {
  stock_bajo: Package,
  vencimiento_pr: Clock,
  cheque_proximo: DollarSign,
  seguimiento: FileText,
  cc_vencida: AlertTriangle,
};

export default function DashboardPage() {
  const kpi = dashboardKPIs;

  return (
    <>
      <Header title="Dashboard" subtitle="Resumen de operaciones — Mayo 2026" />
      <div className="p-8 space-y-8">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Facturado este mes"
            value={formatCurrency(kpi.facturadoMes)}
            change={31}
            changeLabel="vs. mes anterior"
            icon={DollarSign}
            iconColor="text-emerald-600"
          />
          <StatCard
            title="Presupuestos activos"
            value={String(kpi.presupuestosActivos)}
            change={12}
            icon={FileText}
            iconColor="text-blue-600"
          />
          <StatCard
            title="Tasa de conversión"
            value={`${kpi.tasaConversion}%`}
            change={kpi.tasaConversion - kpi.tasaConversionAnterior}
            changeLabel="vs. mes anterior"
            icon={Percent}
            iconColor="text-orange-500"
          />
          <StatCard
            title="Margen promedio"
            value={`${kpi.margenPromedio}%`}
            icon={TrendingUp}
            iconColor="text-violet-600"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Ventas por mes - Chart placeholder */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Facturación mensual</CardTitle>
              <span className="text-xs text-zinc-400">Últimos 6 meses</span>
            </CardHeader>
            <div className="flex items-end gap-3 h-48 px-2">
              {ventasPorMes.map((item) => {
                const maxMonto = Math.max(...ventasPorMes.map((v) => v.monto));
                const heightPct = (item.monto / maxMonto) * 100;
                const isCurrentMonth = item.mes === "May";
                return (
                  <div key={item.mes} className="flex flex-1 flex-col items-center gap-2">
                    <span className="text-xs font-medium text-zinc-500">
                      {formatCurrency(item.monto).replace(",00", "")}
                    </span>
                    <div
                      className={`w-full rounded-t-lg transition-all ${
                        isCurrentMonth ? "bg-orange-500" : "bg-zinc-200 dark:bg-zinc-700"
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className={`text-xs font-medium ${isCurrentMonth ? "text-orange-500" : "text-zinc-400"}`}>
                      {item.mes}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* PR por estado */}
          <Card>
            <CardHeader>
              <CardTitle>Presupuestos por estado</CardTitle>
            </CardHeader>
            <div className="space-y-4">
              {presupuestosPorEstado.map((item) => {
                const total = presupuestosPorEstado.reduce((acc, i) => acc + i.cantidad, 0);
                const pct = Math.round((item.cantidad / total) * 100);
                return (
                  <div key={item.estado} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">{item.estado}</span>
                      <span className="font-medium text-zinc-900 dark:text-white">{item.cantidad} ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Últimos presupuestos */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Últimos presupuestos</CardTitle>
              <button className="flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600">
                Ver todos <ArrowRight className="h-3 w-3" />
              </button>
            </CardHeader>
            <DataTable<Presupuesto>
              columns={[
                { key: "numero", label: "N° PR", render: (row) => <span className="font-mono text-xs font-semibold">{row.numero}</span> },
                { key: "clienteNombre", label: "Cliente", render: (row) => <span className="font-medium">{row.clienteNombre}</span> },
                { key: "total", label: "Total", className: "text-right", render: (row) => <span className="font-mono text-right block">{formatCurrency(row.total)}</span> },
                {
                  key: "estado", label: "Estado",
                  render: (row) => {
                    const cfg = statusConfig[row.estado];
                    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                  },
                },
                { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-400">{row.fecha}</span> },
              ]}
              data={mockPresupuestos.slice(0, 5)}
            />
          </Card>

          {/* Alertas */}
          <Card>
            <CardHeader>
              <CardTitle>Alertas</CardTitle>
              <Badge variant="danger">{mockAlerts.filter((a) => !a.read).length} nuevas</Badge>
            </CardHeader>
            <div className="space-y-3">
              {mockAlerts.map((alert) => {
                const Icon = alertIcons[alert.type] || AlertTriangle;
                return (
                  <div
                    key={alert.id}
                    className={`flex gap-3 rounded-lg p-3 text-sm transition-colors ${
                      alert.read ? "bg-transparent" : "bg-amber-50 dark:bg-amber-950/30"
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div>
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{alert.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Top clientes */}
          <Card>
            <CardHeader>
              <CardTitle>Top clientes (facturado acumulado)</CardTitle>
            </CardHeader>
            <div className="space-y-3">
              {topClientes.map((c, i) => {
                const maxFacturado = topClientes[0].facturado;
                const pct = (c.facturado / maxFacturado) * 100;
                return (
                  <div key={c.nombre} className="flex items-center gap-3">
                    <span className="w-5 text-right text-xs font-bold text-zinc-400">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{c.nombre}</span>
                        <span className="text-sm font-mono text-zinc-500">{formatCurrency(c.facturado)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-1.5 rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Actividad reciente */}
          <Card>
            <CardHeader>
              <CardTitle>Actividad reciente</CardTitle>
            </CardHeader>
            <div className="space-y-4">
              {mockActivity.map((a) => (
                <div key={a.id} className="flex gap-3 text-sm">
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-400" />
                  <div>
                    <p className="text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium">{a.userName}</span> — {a.details}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">{formatDateTime(a.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
