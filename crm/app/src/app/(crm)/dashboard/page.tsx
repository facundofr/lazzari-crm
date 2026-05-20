"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  DollarSign, FileText, TrendingUp, Percent,
  ArrowRight, Clock, AlertTriangle, Package,
  Loader2,
} from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import Link from "next/link";
import {
  dashboardKPIs as mockKPIs,
  mockPresupuestos,
  mockActivity,
  mockAlerts,
  ventasPorMes as mockVentasPorMes,
  presupuestosPorEstado as mockPresupuestosPorEstado,
  topClientes as mockTopClientes,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase/client";
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

const estadoColorMap: Record<string, string> = {
  aprobado: "#22c55e",
  pendiente: "#f59e0b",
  rechazado: "#ef4444",
  postergado: "#8b5cf6",
  borrador: "#a1a1aa",
  vencido: "#dc2626",
};

const estadoLabelMap: Record<string, string> = {
  aprobado: "Aprobados",
  pendiente: "Pendientes",
  rechazado: "Rechazados",
  postergado: "Postergados",
  borrador: "Borradores",
  vencido: "Vencidos",
};

function calcChange(current: number, previous: number): number | undefined {
  if (!previous || previous === 0) return undefined;
  return Math.round(((current - previous) / previous) * 100);
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState(mockKPIs);
  const [presupuestosPorEstado, setPresupuestosPorEstado] = useState(mockPresupuestosPorEstado);
  const [ventasPorMes, setVentasPorMes] = useState(mockVentasPorMes);
  const [presupuestos, setPresupuestos] = useState(mockPresupuestos.slice(0, 5));
  const [alerts, setAlerts] = useState(mockAlerts);
  const [topClientes, setTopClientes] = useState(mockTopClientes);
  const [activity, setActivity] = useState(mockActivity);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [
          kpiResult,
          presupuestosEstadoResult,
          presupuestosRecentResult,
          alertasResult,
          topClientesResult,
          activityResult,
          facturasResult,
        ] = await Promise.all([
          supabase.rpc("get_dashboard_kpis"),
          supabase.from("presupuestos").select("estado"),
          supabase
            .from("presupuestos")
            .select("id, numero, cliente_id, total, estado, fecha, clientes(razon_social)")
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("alertas")
            .select("*")
            .eq("read", false)
            .order("created_at", { ascending: false }),
          supabase
            .from("facturas")
            .select("cliente_id, clientes(razon_social), total")
            .neq("estado", "anulada"),
          supabase
            .from("activity_log")
            .select("*, profiles:user_id(full_name)")
            .order("created_at", { ascending: false })
            .limit(10),
          // Facturación mensual
          supabase
            .from("facturas")
            .select("fecha, total")
            .neq("estado", "anulada"),
        ]);

        // --- KPIs ---
        if (!kpiResult.error && kpiResult.data) {
          const d = kpiResult.data as Record<string, number>;
          setKpi({
            ventasMes: d.ventas_mes ?? mockKPIs.ventasMes,
            ventasMesAnterior: d.ventas_mes_anterior ?? mockKPIs.ventasMesAnterior,
            presupuestosActivos: d.presupuestos_activos ?? mockKPIs.presupuestosActivos,
            presupuestosPendientes: d.presupuestos_pendientes ?? mockKPIs.presupuestosPendientes,
            tasaConversion: d.tasa_conversion ?? mockKPIs.tasaConversion,
            tasaConversionAnterior: d.tasa_conversion_anterior ?? mockKPIs.tasaConversionAnterior,
            cobranzasMes: d.cobranzas_mes ?? mockKPIs.cobranzasMes,
            cobranzasPendientes: d.cobranzas_pendientes ?? mockKPIs.cobranzasPendientes,
            clientesActivos: d.clientes_activos ?? mockKPIs.clientesActivos,
            stockBajo: d.stock_bajo ?? mockKPIs.stockBajo,
            facturadoMes: d.facturado_mes ?? mockKPIs.facturadoMes,
            margenPromedio: d.margen_promedio ?? mockKPIs.margenPromedio,
          });
        }

        // --- Presupuestos por estado ---
        if (!presupuestosEstadoResult.error && presupuestosEstadoResult.data?.length) {
          const counts: Record<string, number> = {};
          presupuestosEstadoResult.data.forEach((p: { estado: string }) => {
            counts[p.estado] = (counts[p.estado] || 0) + 1;
          });
          const mapped = Object.entries(counts).map(([estado, cantidad]) => ({
            estado: estadoLabelMap[estado] || estado,
            cantidad,
            color: estadoColorMap[estado] || "#a1a1aa",
          }));
          if (mapped.length > 0) setPresupuestosPorEstado(mapped);
        }

        // --- Facturacion mensual ---
        if (!facturasResult.error && facturasResult.data?.length) {
          const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
          const byMonth: Record<string, number> = {};
          facturasResult.data.forEach((f: { fecha: string; total: number }) => {
            const d = new Date(f.fecha);
            const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
            byMonth[key] = (byMonth[key] || 0) + Number(f.total);
          });
          const sorted = Object.entries(byMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-6)
            .map(([key, monto]) => ({
              mes: monthNames[parseInt(key.split("-")[1])],
              monto,
            }));
          if (sorted.length > 0) setVentasPorMes(sorted);
        }

        // --- Ultimos presupuestos ---
        if (!presupuestosRecentResult.error && presupuestosRecentResult.data?.length) {
          setPresupuestos(presupuestosRecentResult.data.map((p: any) => ({
            ...p,
            clienteNombre: p.clientes?.razon_social || "N/A",
          })));
        }

        // --- Alertas ---
        if (!alertasResult.error && alertasResult.data?.length) {
          setAlerts(alertasResult.data.map((a: any) => ({
            id: a.id, type: a.tipo, title: a.title, description: a.description,
            entityId: a.entity_id, module: a.module, read: a.read, createdAt: a.created_at,
          })));
        }

        // --- Top clientes ---
        if (!topClientesResult.error && topClientesResult.data?.length) {
          const totals: Record<string, { nombre: string; facturado: number }> = {};
          topClientesResult.data.forEach((f: any) => {
            const id = f.cliente_id;
            if (!totals[id]) totals[id] = { nombre: f.clientes?.razon_social || "N/A", facturado: 0 };
            totals[id].facturado += Number(f.total);
          });
          const sorted = Object.values(totals).sort((a, b) => b.facturado - a.facturado).slice(0, 5);
          if (sorted.length > 0) setTopClientes(sorted);
        }

        // --- Actividad reciente ---
        if (!activityResult.error && activityResult.data?.length) {
          setActivity(activityResult.data.map((a: any) => ({
            id: a.id, userId: a.user_id, userName: a.profiles?.full_name || "Usuario",
            action: a.action, module: a.module, entityId: a.entity_id,
            details: a.details, createdAt: a.created_at,
          })));
        }
      } catch (e) {
        console.error("Error fetching dashboard data:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  if (loading) {
    return (
      <>
        <Header title="Dashboard" subtitle="Resumen de operaciones" />
        <div className="flex items-center justify-center h-96">
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Cargando dashboard...</span>
          </div>
        </div>
      </>
    );
  }

  const facturadoChange = calcChange(kpi.facturadoMes, kpi.ventasMesAnterior);
  const conversionChange = calcChange(kpi.tasaConversion, kpi.tasaConversionAnterior);

  return (
    <>
      <Header title="Dashboard" subtitle="Resumen de operaciones" />
      <div className="p-8 space-y-8">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Facturado este mes"
            value={formatCurrency(kpi.facturadoMes)}
            change={facturadoChange}
            changeLabel="vs. mes anterior"
            icon={DollarSign}
            iconColor="text-emerald-600"
          />
          <StatCard
            title="Presupuestos activos"
            value={String(kpi.presupuestosActivos)}
            icon={FileText}
            iconColor="text-blue-600"
          />
          <StatCard
            title="Tasa de conversion"
            value={`${kpi.tasaConversion}%`}
            change={conversionChange}
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
          {/* Facturación mensual - Recharts BarChart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Facturacion mensual</CardTitle>
              <span className="text-xs text-zinc-400">Ultimos 6 meses</span>
            </CardHeader>
            <div className="h-56 px-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ventasPorMes} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#a1a1aa" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip formatter={(value) => [formatCurrency(Number(value)), "Facturado"]} />
                  <Bar dataKey="monto" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* PR por estado - Recharts PieChart */}
          <Card>
            <CardHeader>
              <CardTitle>Presupuestos por estado</CardTitle>
            </CardHeader>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={presupuestosPorEstado}
                    dataKey="cantidad"
                    nameKey="estado"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {presupuestosPorEstado.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-2 px-6 pb-4">
              {presupuestosPorEstado.map((item) => (
                <div key={item.estado} className="flex items-center gap-1.5 text-xs">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-zinc-500">{item.estado} ({item.cantidad})</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Ultimos presupuestos */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Ultimos presupuestos</CardTitle>
              <Link href="/presupuestos" className="flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600">
                Ver todos <ArrowRight className="h-3 w-3" />
              </Link>
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
                    return cfg ? <Badge variant={cfg.variant}>{cfg.label}</Badge> : <Badge variant="outline">{row.estado}</Badge>;
                  },
                },
                { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-400">{row.fecha}</span> },
              ]}
              data={presupuestos}
              pageSize={5}
            />
          </Card>

          {/* Alertas */}
          <Card>
            <CardHeader>
              <CardTitle>Alertas</CardTitle>
              <Badge variant="danger">{alerts.filter((a) => !a.read).length} nuevas</Badge>
            </CardHeader>
            <div className="space-y-3">
              {alerts.map((alert) => {
                const Icon = alertIcons[alert.type] || AlertTriangle;
                const moduleLink = alert.module === "presupuestos" ? "/presupuestos" : alert.module === "stock" ? "/stock" : `/${alert.module}`;
                return (
                  <Link
                    key={alert.id}
                    href={moduleLink}
                    className={`flex gap-3 rounded-lg p-3 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      alert.read ? "bg-transparent" : "bg-amber-50 dark:bg-amber-950/30"
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div>
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{alert.description}</p>
                    </div>
                  </Link>
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
                const maxFacturado = topClientes[0]?.facturado || 1;
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
              {activity.map((a) => (
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
