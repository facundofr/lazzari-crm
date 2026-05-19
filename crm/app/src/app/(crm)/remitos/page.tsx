"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { mockRemitos } from "@/lib/mock-data";
import type { Remito } from "@/lib/types";
import { Sparkles, Truck } from "lucide-react";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "info" }> = {
  pendiente: { label: "Pendiente", variant: "warning" },
  entregado: { label: "Entregado", variant: "success" },
  parcial: { label: "Parcial", variant: "info" },
};

export default function RemitosPage() {
  return (
    <>
      <Header
        title="Remitos"
        subtitle="Remitos con CAE — asistidos por IA"
        action={{ label: "Nuevo remito", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        {/* AI Assist banner */}
        <div className="flex items-center gap-4 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
          <div className="rounded-lg bg-violet-100 p-2 dark:bg-violet-900">
            <Sparkles className="h-5 w-5 text-violet-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-violet-800 dark:text-violet-300">Asistente IA para remitos</p>
            <p className="text-sm text-violet-600 dark:text-violet-400">
              Generá remitos automáticamente desde presupuestos aprobados. La IA completa items, cantidades y datos de entrega.
            </p>
          </div>
          <button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
            Generar con IA
          </button>
        </div>

        <Card className="p-0 overflow-hidden">
          <DataTable<Remito>
            columns={[
              {
                key: "numero", label: "N° Remito",
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              { key: "clienteNombre", label: "Cliente", render: (row) => <span className="font-medium">{row.clienteNombre}</span> },
              { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
              { key: "items", label: "Items", render: (row) => <span className="text-zinc-500">{row.items.length} productos</span> },
              { key: "cae", label: "CAE", render: (row) => row.cae ? <span className="font-mono text-xs text-zinc-500">{row.cae}</span> : <Badge variant="outline">Sin CAE</Badge> },
              { key: "presupuestoId", label: "PR Origen", render: (row) => row.presupuestoId ? <Badge variant="info">Vinculado</Badge> : <span className="text-zinc-400">—</span> },
              {
                key: "estado", label: "Estado",
                render: (row) => {
                  const cfg = estadoConfig[row.estado];
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
            ]}
            data={mockRemitos}
          />
        </Card>
      </div>
    </>
  );
}
