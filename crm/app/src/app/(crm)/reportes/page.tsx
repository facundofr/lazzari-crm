"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import {
  dashboardKPIs, presupuestosPorEstado, topClientes, mockPresupuestos, mockUsers,
} from "@/lib/mock-data";
import { TrendingUp, Users, FileText, Download, DollarSign, XCircle, Loader2, Percent } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

// ── Comisiones types & helpers ────────────────────────────────────
interface VendedorComision {
  id: string;
  nombre: string;
  presupuestosAprobados: number;
  ventaNeta: number;
  costoTotal: number;
  margen: number;
  comisionVenta: number;
  comisionMargen: number;
  totalComision: number;
}

const COMISION_VENTA_PCT = 3;
const COMISION_MARGEN_PCT = 10;

function buildMockComisiones(): VendedorComision[] {
  const vendedores = mockUsers.filter((u) => u.role === "vendedor");
  return vendedores.map((v) => {
    const aprobados = mockPresupuestos.filter(
      (pr) => pr.creadoPor === v.id && pr.estado === "aprobado"
    );
    const ventaNeta = aprobados.reduce((sum, pr) => sum + pr.subtotal, 0);
    const costoTotal = aprobados.reduce(
      (sum, pr) => sum + pr.items.reduce((s, it) => s + it.precioCosto * it.cantidad, 0),
      0
    );
    const margen = ventaNeta - costoTotal;
    const comisionVenta = ventaNeta * (COMISION_VENTA_PCT / 100);
    const comisionMargen = margen * (COMISION_MARGEN_PCT / 100);
    return {
      id: v.id,
      nombre: v.name,
      presupuestosAprobados: aprobados.length,
      ventaNeta,
      costoTotal,
      margen,
      comisionVenta,
      comisionMargen,
      totalComision: comisionVenta + comisionMargen,
    };
  });
}

const COLORS = ["#f97316", "#3b82f6", "#22c55e", "#ef4444", "#a855f7", "#eab308"];

export default function ReportesPage() {
  const [activeTab, setActiveTab] = useState<"comercial" | "comisiones">("comercial");
  const [loading, setLoading] = useState(true);
  const [ventasMensuales, setVentasMensuales] = useState<{ mes: string; total: number }[]>([]);
  const [prEstadoData, setPrEstadoData] = useState<{ name: string; value: number }[]>([]);
  const [topClientesData, setTopClientesData] = useState<{ nombre: string; facturado: number }[]>([]);
  const [comisionesData, setComisionesData] = useState<VendedorComision[]>([]);
  const [comisionesLoading, setComisionesLoading] = useState(true);

  const now = new Date();
  const mesActual = now.toLocaleString("es-AR", { month: "long", year: "numeric" });

  useEffect(() => {
    async function fetchData() {
      try {
        // Ventas por mes from facturas
        const { data: facturas } = await supabase
          .from("facturas")
          .select("fecha, total, estado")
          .neq("estado", "anulada");

        if (facturas && facturas.length > 0) {
          const byMonth: Record<string, number> = {};
          facturas.forEach((f) => {
            const d = new Date(f.fecha);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            byMonth[key] = (byMonth[key] || 0) + Number(f.total);
          });
          const sorted = Object.entries(byMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-6)
            .map(([key, total]) => {
              const [y, m] = key.split("-");
              const label = new Date(Number(y), Number(m) - 1).toLocaleString("es-AR", { month: "short" });
              return { mes: label, total };
            });
          setVentasMensuales(sorted);
        } else {
          // Fallback
          setVentasMensuales([
            { mes: "Ene", total: 2500000 }, { mes: "Feb", total: 3100000 },
            { mes: "Mar", total: 2800000 }, { mes: "Abr", total: 3500000 },
            { mes: "May", total: 4200000 }, { mes: "Jun", total: 3800000 },
          ]);
        }

        // PR por estado
        const { data: prs } = await supabase
          .from("presupuestos")
          .select("estado, total");

        if (prs && prs.length > 0) {
          const byEstado: Record<string, number> = {};
          prs.forEach((p) => { byEstado[p.estado] = (byEstado[p.estado] || 0) + 1; });
          setPrEstadoData(Object.entries(byEstado).map(([name, value]) => ({ name, value })));
        } else {
          setPrEstadoData(presupuestosPorEstado.map((p) => ({ name: p.estado, value: p.cantidad })));
        }

        // Top clientes
        const { data: topCli } = await supabase
          .from("facturas")
          .select("clientes(razon_social), total")
          .neq("estado", "anulada");

        if (topCli && topCli.length > 0) {
          const byCli: Record<string, number> = {};
          topCli.forEach((f: Record<string, unknown>) => {
            const cli = f.clientes as { razon_social: string } | null;
            const name = cli?.razon_social ?? "Desconocido";
            byCli[name] = (byCli[name] || 0) + Number(f.total);
          });
          const sorted = Object.entries(byCli)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([nombre, facturado]) => ({ nombre, facturado }));
          setTopClientesData(sorted);
        } else {
          setTopClientesData(topClientes);
        }
      } catch {
        // Fallback to mock data
        setVentasMensuales([
          { mes: "Ene", total: 2500000 }, { mes: "Feb", total: 3100000 },
          { mes: "Mar", total: 2800000 }, { mes: "Abr", total: 3500000 },
        ]);
        setPrEstadoData(presupuestosPorEstado.map((p) => ({ name: p.estado, value: p.cantidad })));
        setTopClientesData(topClientes);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // ── Fetch comisiones data ──────────────────────────────────────
  useEffect(() => {
    async function fetchComisiones() {
      try {
        // Try fetching approved presupuestos with their items and vendedor profiles
        const { data: prs, error } = await supabase
          .from("presupuestos")
          .select("id, subtotal, created_by, presupuesto_items(cantidad, precio_costo)")
          .eq("estado", "aprobado");

        if (error || !prs || prs.length === 0) {
          setComisionesData(buildMockComisiones());
          return;
        }

        // Get vendedor profiles
        const vendedorIds = [...new Set(prs.map((p) => p.created_by).filter((id): id is string => id != null))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", vendedorIds);

        if (!profiles || profiles.length === 0) {
          setComisionesData(buildMockComisiones());
          return;
        }

        const vendedorMap = new Map(profiles.map((p) => [p.id, p.full_name || "Sin nombre"]));

        // Group by vendedor
        const byVendedor: Record<string, { ventaNeta: number; costoTotal: number; count: number }> = {};
        for (const pr of prs) {
          const vid = pr.created_by;
          if (!vid || !vendedorMap.has(vid)) continue;
          if (!byVendedor[vid]) byVendedor[vid] = { ventaNeta: 0, costoTotal: 0, count: 0 };
          byVendedor[vid].ventaNeta += Number(pr.subtotal) || 0;
          byVendedor[vid].count += 1;
          const items = (pr as Record<string, unknown>).presupuesto_items as { cantidad: number; precio_costo: number }[] | null;
          if (items) {
            byVendedor[vid].costoTotal += items.reduce((s, it) => s + (it.cantidad * it.precio_costo), 0);
          }
        }

        const result: VendedorComision[] = Object.entries(byVendedor).map(([vid, data]) => {
          const margen = data.ventaNeta - data.costoTotal;
          const comisionVenta = data.ventaNeta * (COMISION_VENTA_PCT / 100);
          const comisionMargen = margen * (COMISION_MARGEN_PCT / 100);
          return {
            id: vid,
            nombre: vendedorMap.get(vid) || "Sin nombre",
            presupuestosAprobados: data.count,
            ventaNeta: data.ventaNeta,
            costoTotal: data.costoTotal,
            margen,
            comisionVenta,
            comisionMargen,
            totalComision: comisionVenta + comisionMargen,
          };
        });

        setComisionesData(result.length > 0 ? result : buildMockComisiones());
      } catch {
        setComisionesData(buildMockComisiones());
      } finally {
        setComisionesLoading(false);
      }
    }
    fetchComisiones();
  }, []);

  const rechazados = mockPresupuestos.filter((pr) => pr.motivoRechazo);
  const totalPR = mockPresupuestos.length;
  const ticketPromedio = totalPR > 0 ? mockPresupuestos.reduce((a, pr) => a + pr.total, 0) / totalPR : 0;

  // Calc rejection percentages dynamically
  const motivoCounts: Record<string, number> = {};
  rechazados.forEach((pr) => {
    const motivo = pr.motivoRechazo?.toLowerCase() || "";
    if (motivo.includes("precio") || motivo.includes("caro") || motivo.includes("cost")) {
      motivoCounts["Precio"] = (motivoCounts["Precio"] || 0) + 1;
    } else if (motivo.includes("plazo") || motivo.includes("entrega") || motivo.includes("tiempo")) {
      motivoCounts["Plazo de entrega"] = (motivoCounts["Plazo de entrega"] || 0) + 1;
    } else {
      motivoCounts["Otros"] = (motivoCounts["Otros"] || 0) + 1;
    }
  });
  const totalRechazos = rechazados.length || 1;

  const comisionesChartData = useMemo(
    () =>
      comisionesData.map((v) => ({
        nombre: v.nombre.split(" ")[0],
        "Comision por venta": Math.round(v.comisionVenta),
        "Comision por margen": Math.round(v.comisionMargen),
      })),
    [comisionesData]
  );

  const totalComisionesGeneral = useMemo(
    () => comisionesData.reduce((s, v) => s + v.totalComision, 0),
    [comisionesData]
  );

  if (loading) {
    return (
      <>
        <Header title="Reportes" subtitle="Cargando datos..." />
        <div className="flex items-center justify-center p-16">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Reportes" subtitle="Analisis comercial y operativo" />

      {/* Tab navigation */}
      <div className="px-8 pt-6">
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          <button
            onClick={() => setActiveTab("comercial")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "comercial"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Analisis comercial
            </span>
          </button>
          <button
            onClick={() => setActiveTab("comisiones")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "comisiones"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <Percent className="h-4 w-4" />
              Comisiones
            </span>
          </button>
        </div>
      </div>

      {/* Tab: Analisis comercial */}
      {activeTab === "comercial" && (
      <div className="p-8 space-y-6">
        {/* Report categories */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Rendimiento comercial", desc: "Conversion, facturacion, margen", icon: TrendingUp, color: "text-emerald-600 bg-emerald-50" },
            { title: "Analisis de clientes", desc: "Top clientes, frecuencia, ticket", icon: Users, color: "text-blue-600 bg-blue-50" },
            { title: "Presupuestos", desc: "Estados, rechazos, tendencias", icon: FileText, color: "text-orange-600 bg-orange-50" },
            { title: "Financiero", desc: "Cobranzas, CC, flujo de caja", icon: DollarSign, color: "text-violet-600 bg-violet-50" },
          ].map((report) => (
            <Card key={report.title} className="cursor-pointer hover:shadow-md transition-shadow">
              <div className={`rounded-lg p-2.5 w-fit ${report.color}`}>
                <report.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{report.title}</h3>
              <p className="mt-1 text-sm text-zinc-500">{report.desc}</p>
            </Card>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Ventas mensuales */}
          <Card>
            <CardHeader>
              <CardTitle>Facturacion mensual</CardTitle>
            </CardHeader>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ventasMensuales}>
                  <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                  <Bar dataKey="total" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* PR por estado */}
          <Card>
            <CardHeader>
              <CardTitle>Presupuestos por estado</CardTitle>
            </CardHeader>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={prEstadoData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {prEstadoData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Metricas clave */}
          <Card>
            <CardHeader>
              <CardTitle>Metricas clave — {mesActual}</CardTitle>
              <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                <Download className="h-3.5 w-3.5" /> Exportar
              </button>
            </CardHeader>
            <div className="space-y-4">
              {[
                { label: "Tasa de conversion", value: `${dashboardKPIs.tasaConversion}%`, prev: `${dashboardKPIs.tasaConversionAnterior}%`, up: dashboardKPIs.tasaConversion > dashboardKPIs.tasaConversionAnterior },
                { label: "Margen promedio", value: `${dashboardKPIs.margenPromedio}%`, prev: "34.2%", up: true },
                { label: "Ticket promedio", value: formatCurrency(ticketPromedio), prev: formatCurrency(ticketPromedio * 0.88), up: true },
                { label: "Presupuestos emitidos", value: String(totalPR), prev: "—", up: false },
                { label: "Facturado", value: formatCurrency(dashboardKPIs.facturadoMes), prev: formatCurrency(dashboardKPIs.ventasMesAnterior), up: dashboardKPIs.facturadoMes > dashboardKPIs.ventasMesAnterior },
              ].map((m) => (
                <div key={m.label} className="flex items-center justify-between py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{m.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400">{m.prev}</span>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-white">{m.value}</span>
                    <TrendingUp className={`h-3.5 w-3.5 ${m.up ? "text-emerald-500" : "text-red-500 rotate-180"}`} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Analisis de rechazos */}
          <Card>
            <CardHeader>
              <CardTitle>Analisis de motivos de rechazo</CardTitle>
              <Badge variant="danger">{rechazados.length} rechazados</Badge>
            </CardHeader>
            <div className="space-y-4">
              {Object.entries(motivoCounts).map(([motivo, count]) => {
                const pct = Math.round((count / totalRechazos) * 100);
                const color = motivo === "Precio" ? "bg-red-500" : motivo === "Plazo de entrega" ? "bg-amber-500" : "bg-zinc-400";
                return (
                  <div key={motivo} className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium">{motivo}</span>
                      <span className="text-sm font-bold">{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {rechazados.slice(0, 5).map((pr) => (
                <div key={pr.id} className="flex gap-3 rounded-lg border border-red-100 p-3 dark:border-red-900">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <div>
                    <p className="text-sm font-medium">{pr.numero} — {pr.clienteNombre}</p>
                    <p className="text-xs text-zinc-500">{pr.motivoRechazo}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Top clientes */}
        <Card>
          <CardHeader>
            <CardTitle>Ranking de clientes por facturacion</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">Cliente</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Facturado</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">% del total</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">Barra</th>
                </tr>
              </thead>
              <tbody>
                {topClientesData.map((c, i) => {
                  const totalFact = topClientesData.reduce((a, x) => a + x.facturado, 0);
                  const pct = totalFact > 0 ? ((c.facturado / totalFact) * 100).toFixed(1) : "0";
                  const maxFact = topClientesData[0]?.facturado || 1;
                  return (
                    <tr key={c.nombre} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="px-4 py-3 text-sm font-bold text-zinc-400">{i + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">{c.nombre}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right">{formatCurrency(c.facturado)}</td>
                      <td className="px-4 py-3 text-sm text-right text-zinc-500">{pct}%</td>
                      <td className="px-4 py-3 w-40">
                        <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className="h-2 rounded-full bg-orange-500" style={{ width: `${(c.facturado / maxFact) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      )}

      {/* Tab: Comisiones */}
      {activeTab === "comisiones" && (
      <div className="p-8 space-y-6">
        {comisionesLoading ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-orange-600 bg-orange-50">
                  <Users className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{comisionesData.length}</h3>
                <p className="mt-1 text-sm text-zinc-500">Vendedores</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-emerald-600 bg-emerald-50">
                  <FileText className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{comisionesData.reduce((s, v) => s + v.presupuestosAprobados, 0)}</h3>
                <p className="mt-1 text-sm text-zinc-500">Presupuestos aprobados</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-blue-600 bg-blue-50">
                  <DollarSign className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{formatCurrency(comisionesData.reduce((s, v) => s + v.ventaNeta, 0))}</h3>
                <p className="mt-1 text-sm text-zinc-500">Total venta neta</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-violet-600 bg-violet-50">
                  <Percent className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{formatCurrency(totalComisionesGeneral)}</h3>
                <p className="mt-1 text-sm text-zinc-500">Total comisiones</p>
              </Card>
            </div>

            {/* Commission rates info */}
            <div className="flex flex-wrap gap-3">
              <Badge variant="info">Comision por venta neta: {COMISION_VENTA_PCT}%</Badge>
              <Badge variant="success">Comision por margen: {COMISION_MARGEN_PCT}%</Badge>
            </div>

            {/* Summary table */}
            <Card>
              <CardHeader>
                <CardTitle>Comisiones por vendedor</CardTitle>
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                  <Download className="h-3.5 w-3.5" /> Exportar
                </button>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">Vendedor</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-zinc-500">PR Aprobados</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Venta neta</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Costo</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Margen</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Com. venta ({COMISION_VENTA_PCT}%)</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Com. margen ({COMISION_MARGEN_PCT}%)</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Total comision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comisionesData.map((v) => (
                      <tr key={v.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">{v.nombre}</td>
                        <td className="px-4 py-3 text-sm text-center">
                          <Badge variant={v.presupuestosAprobados > 0 ? "success" : "outline"}>{v.presupuestosAprobados}</Badge>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-right">{formatCurrency(v.ventaNeta)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right text-zinc-500">{formatCurrency(v.costoTotal)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right">
                          <span className={v.margen > 0 ? "text-emerald-600" : "text-red-500"}>{formatCurrency(v.margen)}</span>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-right text-blue-600 dark:text-blue-400">{formatCurrency(v.comisionVenta)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right text-emerald-600 dark:text-emerald-400">{formatCurrency(v.comisionMargen)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right font-bold text-orange-600 dark:text-orange-400">{formatCurrency(v.totalComision)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/50">
                      <td className="px-4 py-3 text-sm font-bold text-zinc-900 dark:text-white">Total</td>
                      <td className="px-4 py-3 text-sm text-center font-bold">{comisionesData.reduce((s, v) => s + v.presupuestosAprobados, 0)}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold">{formatCurrency(comisionesData.reduce((s, v) => s + v.ventaNeta, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-zinc-500">{formatCurrency(comisionesData.reduce((s, v) => s + v.costoTotal, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-emerald-600">{formatCurrency(comisionesData.reduce((s, v) => s + v.margen, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-blue-600">{formatCurrency(comisionesData.reduce((s, v) => s + v.comisionVenta, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-emerald-600">{formatCurrency(comisionesData.reduce((s, v) => s + v.comisionMargen, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-orange-600 dark:text-orange-400">{formatCurrency(totalComisionesGeneral)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            {/* Bar chart: commission comparison */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Comparativa de comisiones por vendedor</CardTitle>
                </CardHeader>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comisionesChartData} barGap={4}>
                      <XAxis dataKey="nombre" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                      <Legend />
                      <Bar dataKey="Comision por venta" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Comision por margen" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Breakdown detail cards */}
              <div className="space-y-4">
                {comisionesData.map((v) => {
                  const margenPct = v.ventaNeta > 0 ? ((v.margen / v.ventaNeta) * 100).toFixed(1) : "0";
                  return (
                    <Card key={v.id}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">{v.nombre}</h4>
                          <p className="text-xs text-zinc-500">{v.presupuestosAprobados} presupuesto{v.presupuestosAprobados !== 1 ? "s" : ""} aprobado{v.presupuestosAprobados !== 1 ? "s" : ""}</p>
                        </div>
                        <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{formatCurrency(v.totalComision)}</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Venta neta</span>
                          <span className="font-mono font-medium">{formatCurrency(v.ventaNeta)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Margen ({margenPct}%)</span>
                          <span className="font-mono font-medium text-emerald-600">{formatCurrency(v.margen)}</span>
                        </div>
                        <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1" />
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-blue-600 dark:text-blue-400">Com. {COMISION_VENTA_PCT}% s/ venta</span>
                          <span className="font-mono font-medium text-blue-600 dark:text-blue-400">{formatCurrency(v.comisionVenta)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-emerald-600 dark:text-emerald-400">Com. {COMISION_MARGEN_PCT}% s/ margen</span>
                          <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(v.comisionMargen)}</span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
      )}
    </>
  );
}
