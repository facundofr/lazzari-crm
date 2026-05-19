"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatCurrency } from "@/lib/utils";
import { mockPresupuestos } from "@/lib/mock-data";
import type { Presupuesto, PRStatus } from "@/lib/types";
import { Search, Filter, Send, Eye, Copy, FileText, CheckCircle2, XCircle, Clock, PauseCircle, Edit3 } from "lucide-react";
import { useState } from "react";

const statusConfig: Record<PRStatus, { label: string; variant: "success" | "warning" | "danger" | "purple" | "outline" | "info"; icon: typeof Clock }> = {
  borrador: { label: "Borrador", variant: "outline", icon: Edit3 },
  pendiente: { label: "Pendiente", variant: "warning", icon: Clock },
  aprobado: { label: "Aprobado", variant: "success", icon: CheckCircle2 },
  rechazado: { label: "Rechazado", variant: "danger", icon: XCircle },
  postergado: { label: "Postergado", variant: "purple", icon: PauseCircle },
  vencido: { label: "Vencido", variant: "danger", icon: Clock },
};

export default function PresupuestosPage() {
  const [filter, setFilter] = useState<PRStatus | "todos">("todos");
  const [search, setSearch] = useState("");

  const filtered = mockPresupuestos.filter((pr) => {
    if (filter !== "todos" && pr.estado !== filter) return false;
    if (search && !pr.numero.toLowerCase().includes(search.toLowerCase()) && !pr.clienteNombre.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts: Record<string, number> = { todos: mockPresupuestos.length };
  mockPresupuestos.forEach((pr) => { counts[pr.estado] = (counts[pr.estado] || 0) + 1; });

  return (
    <>
      <Header
        title="Presupuestos"
        subtitle={`${mockPresupuestos.length} presupuestos totales`}
        action={{ label: "Nuevo PR", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        {/* Status tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["todos", "borrador", "pendiente", "aprobado", "rechazado", "postergado"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                filter === status
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700"
              }`}
            >
              {status === "todos" ? "Todos" : statusConfig[status].label}
              <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                filter === status ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500"
              }`}>
                {counts[status] || 0}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por N° PR o cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        </div>

        {/* Table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<Presupuesto>
            columns={[
              {
                key: "numero", label: "N° PR",
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              {
                key: "clienteNombre", label: "Cliente",
                render: (row) => <span className="font-medium">{row.clienteNombre}</span>,
              },
              {
                key: "items", label: "Items",
                render: (row) => <span className="text-zinc-500">{row.items.length} líneas</span>,
              },
              {
                key: "markupGeneral", label: "Markup",
                render: (row) => <Badge variant="outline">{row.markupGeneral}%</Badge>,
              },
              {
                key: "total", label: "Total", className: "text-right",
                render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(row.total)}</span>,
              },
              {
                key: "estado", label: "Estado",
                render: (row) => {
                  const cfg = statusConfig[row.estado];
                  const Icon = cfg.icon;
                  return (
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" />
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                    </div>
                  );
                },
              },
              {
                key: "fecha", label: "Fecha",
                render: (row) => (
                  <div>
                    <p className="text-zinc-600 dark:text-zinc-300">{row.fecha}</p>
                    <p className="text-xs text-zinc-400">Vence: {row.vencimiento}</p>
                  </div>
                ),
              },
              {
                key: "actions", label: "",
                render: (row) => (
                  <div className="flex items-center gap-1">
                    <button className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Ver"><Eye className="h-4 w-4" /></button>
                    <button className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Duplicar"><Copy className="h-4 w-4" /></button>
                    {row.estado === "pendiente" && (
                      <button className="rounded p-1.5 text-zinc-400 hover:bg-orange-100 hover:text-orange-600" title="Reenviar"><Send className="h-4 w-4" /></button>
                    )}
                  </div>
                ),
              },
            ]}
            data={filtered}
            onRowClick={() => {}}
          />
        </Card>

        {/* Motivos de rechazo */}
        {mockPresupuestos.some((pr) => pr.motivoRechazo) && (
          <Card>
            <CardHeader>
              <CardTitle>Motivos de rechazo recientes</CardTitle>
            </CardHeader>
            <div className="space-y-3">
              {mockPresupuestos
                .filter((pr) => pr.motivoRechazo)
                .map((pr) => (
                  <div key={pr.id} className="flex items-start gap-3 rounded-lg bg-red-50 p-3 dark:bg-red-950/30">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div>
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {pr.numero} — {pr.clienteNombre}
                      </p>
                      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{pr.motivoRechazo}</p>
                      <p className="mt-1 text-xs text-zinc-400">{pr.respondidoAt}</p>
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
