"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import {
  dashboardKPIs, presupuestosPorEstado, topClientes, mockPresupuestos,
} from "@/lib/mock-data";
import { TrendingUp, Users, FileText, Download, DollarSign, XCircle, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#f97316", "#3b82f6", "#22c55e", "#ef4444", "#a855f7", "#eab308"];

export default function ReportesPage() {
  const [loading, setLoading] = useState(true);
  const [ventasMensuales, setVentasMensuales] = useState<{ mes: string; total: number }[]>([]);
  const [prEstadoData, setPrEstadoData] = useState<{ name: string; value: number }[]>([]);
  const [topClientesData, setTopClientesData] = useState<{ nombre: string; facturado: number }[]>([]);

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
    </>
  );
}
