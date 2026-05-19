"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import {
  dashboardKPIs, presupuestosPorEstado, topClientes, ventasPorMes, mockPresupuestos,
} from "@/lib/mock-data";
import { BarChart3, TrendingUp, Users, FileText, Download, Percent, DollarSign, XCircle } from "lucide-react";

export default function ReportesPage() {
  const rechazados = mockPresupuestos.filter((pr) => pr.motivoRechazo);
  const totalPR = mockPresupuestos.length;
  const aprobados = mockPresupuestos.filter((pr) => pr.estado === "aprobado").length;
  const ticketPromedio = mockPresupuestos.reduce((a, pr) => a + pr.total, 0) / totalPR;

  return (
    <>
      <Header title="Reportes" subtitle="Análisis comercial y operativo" />
      <div className="p-8 space-y-6">
        {/* Report categories */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Rendimiento comercial", desc: "Conversión, facturación, margen", icon: TrendingUp, color: "text-emerald-600 bg-emerald-50" },
            { title: "Análisis de clientes", desc: "Top clientes, frecuencia, ticket", icon: Users, color: "text-blue-600 bg-blue-50" },
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Métricas clave */}
          <Card>
            <CardHeader>
              <CardTitle>Métricas clave — Mayo 2026</CardTitle>
              <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700">
                <Download className="h-3.5 w-3.5" /> Exportar
              </button>
            </CardHeader>
            <div className="space-y-4">
              {[
                { label: "Tasa de conversión", value: `${dashboardKPIs.tasaConversion}%`, prev: `${dashboardKPIs.tasaConversionAnterior}%`, up: true },
                { label: "Margen promedio", value: `${dashboardKPIs.margenPromedio}%`, prev: "34.2%", up: true },
                { label: "Ticket promedio", value: formatCurrency(ticketPromedio), prev: formatCurrency(ticketPromedio * 0.88), up: true },
                { label: "Presupuestos emitidos", value: String(totalPR), prev: "8", up: false },
                { label: "Facturado", value: formatCurrency(dashboardKPIs.facturadoMes), prev: formatCurrency(dashboardKPIs.ventasMesAnterior), up: true },
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

          {/* Análisis de rechazos */}
          <Card>
            <CardHeader>
              <CardTitle>Análisis de motivos de rechazo</CardTitle>
              <Badge variant="danger">{rechazados.length} rechazados</Badge>
            </CardHeader>
            <div className="space-y-4">
              <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">Precio</span>
                  <span className="text-sm font-bold">78%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <div className="h-2 rounded-full bg-red-500" style={{ width: "78%" }} />
                </div>
              </div>
              <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">Plazo de entrega</span>
                  <span className="text-sm font-bold">15%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <div className="h-2 rounded-full bg-amber-500" style={{ width: "15%" }} />
                </div>
              </div>
              <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">Otros</span>
                  <span className="text-sm font-bold">7%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <div className="h-2 rounded-full bg-zinc-400" style={{ width: "7%" }} />
                </div>
              </div>
              {rechazados.map((pr) => (
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

        {/* Top clientes detallado */}
        <Card>
          <CardHeader>
            <CardTitle>Ranking de clientes por facturación</CardTitle>
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
                {topClientes.map((c, i) => {
                  const totalFact = topClientes.reduce((a, x) => a + x.facturado, 0);
                  const pct = ((c.facturado / totalFact) * 100).toFixed(1);
                  return (
                    <tr key={c.nombre} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="px-4 py-3 text-sm font-bold text-zinc-400">{i + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">{c.nombre}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right">{formatCurrency(c.facturado)}</td>
                      <td className="px-4 py-3 text-sm text-right text-zinc-500">{pct}%</td>
                      <td className="px-4 py-3 w-40">
                        <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className="h-2 rounded-full bg-orange-500" style={{ width: `${(c.facturado / topClientes[0].facturado) * 100}%` }} />
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
