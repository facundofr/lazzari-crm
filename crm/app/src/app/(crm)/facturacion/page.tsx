"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { mockFacturas, dashboardKPIs } from "@/lib/mock-data";
import type { Factura } from "@/lib/types";
import { Receipt, DollarSign, FileCheck, AlertTriangle } from "lucide-react";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" }> = {
  emitida: { label: "Emitida", variant: "info" },
  pagada: { label: "Pagada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
  vencida: { label: "Vencida", variant: "warning" },
};

export default function FacturacionPage() {
  return (
    <>
      <Header
        title="Facturación"
        subtitle="Comprobantes electrónicos AFIP"
        action={{ label: "Nueva factura", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Facturado este mes" value={formatCurrency(dashboardKPIs.facturadoMes)} change={31} icon={DollarSign} iconColor="text-emerald-600" />
          <StatCard title="Comprobantes emitidos" value="1" icon={Receipt} iconColor="text-blue-600" />
          <StatCard title="Pendientes de cobro" value={formatCurrency(dashboardKPIs.cobranzasPendientes)} icon={AlertTriangle} iconColor="text-amber-500" />
          <StatCard title="CAE vigentes" value="1" icon={FileCheck} iconColor="text-emerald-600" />
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="font-semibold text-zinc-900 dark:text-white">Comprobantes emitidos</h3>
          </div>
          <DataTable<Factura>
            columns={[
              {
                key: "tipo", label: "Comprobante",
                render: (row) => (
                  <div>
                    <span className="font-mono text-xs font-bold">{row.tipo} {String(row.puntoVenta).padStart(4, "0")}-{String(row.numero).padStart(8, "0")}</span>
                  </div>
                ),
              },
              { key: "clienteNombre", label: "Cliente", render: (row) => <span className="font-medium">{row.clienteNombre}</span> },
              { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
              { key: "cae", label: "CAE", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cae}</span> },
              { key: "caeVencimiento", label: "Vto. CAE", render: (row) => <span className="text-zinc-400 text-xs">{row.caeVencimiento}</span> },
              { key: "total", label: "Total", className: "text-right", render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(row.total)}</span> },
              {
                key: "estado", label: "Estado",
                render: (row) => {
                  const cfg = estadoConfig[row.estado];
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
            ]}
            data={mockFacturas}
          />
        </Card>

        {/* AFIP integration status */}
        <Card>
          <CardHeader>
            <CardTitle>Integraciones AFIP</CardTitle>
            <Badge variant="success">Conectado</Badge>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500">WSFE (Factura electrónica)</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-emerald-600">Operativo</span>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500">Punto de venta</p>
              <p className="mt-2 text-lg font-bold">0001</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500">Último comprobante</p>
              <p className="mt-2 text-lg font-bold font-mono">FA A-0001-00000234</p>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
