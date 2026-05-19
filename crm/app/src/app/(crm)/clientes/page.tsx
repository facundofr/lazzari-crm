"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatCurrency } from "@/lib/utils";
import { mockClients } from "@/lib/mock-data";
import { mockUsers } from "@/lib/mock-data";
import type { Client } from "@/lib/types";
import { Search, Filter, Download, Building2, MapPin, Phone, Mail } from "lucide-react";
import { useState } from "react";

const condicionLabels: Record<string, string> = {
  RI: "Resp. Inscripto",
  Monotributo: "Monotributo",
  Exento: "Exento",
  CF: "Cons. Final",
};

export default function ClientesPage() {
  const [view, setView] = useState<"table" | "cards">("table");
  const [search, setSearch] = useState("");

  const filtered = mockClients.filter(
    (c) =>
      c.razonSocial.toLowerCase().includes(search.toLowerCase()) ||
      c.cuit.includes(search)
  );

  const vendedorName = (id?: string) => mockUsers.find((u) => u.id === id)?.name ?? "—";

  return (
    <>
      <Header
        title="Clientes"
        subtitle={`${mockClients.length} clientes activos`}
        action={{ label: "Nuevo cliente", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por razón social o CUIT..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <button className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
            <Filter className="h-4 w-4" /> Filtros
          </button>
          <button className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
            <Download className="h-4 w-4" /> Exportar
          </button>
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <button onClick={() => setView("table")} className={`px-3 py-2 text-xs font-medium ${view === "table" ? "bg-zinc-100 text-zinc-800" : "bg-white text-zinc-400"}`}>Tabla</button>
            <button onClick={() => setView("cards")} className={`px-3 py-2 text-xs font-medium ${view === "cards" ? "bg-zinc-100 text-zinc-800" : "bg-white text-zinc-400"}`}>Tarjetas</button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Total clientes</p>
            <p className="mt-1 text-2xl font-bold">{mockClients.length}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Saldo total CC</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(mockClients.reduce((a, c) => a + c.saldoCuentaCorriente, 0))}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Crédito otorgado</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(mockClients.reduce((a, c) => a + c.limiteCredito, 0))}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Provincias</p>
            <p className="mt-1 text-2xl font-bold">{new Set(mockClients.map((c) => c.provincia)).size}</p>
          </div>
        </div>

        {view === "table" ? (
          <Card className="p-0 overflow-hidden">
            <DataTable<Client>
              columns={[
                {
                  key: "razonSocial", label: "Razón social",
                  render: (row) => (
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600 font-bold text-xs">
                        {row.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-white">{row.razonSocial}</p>
                        <p className="text-xs text-zinc-400">{row.cuit}</p>
                      </div>
                    </div>
                  ),
                },
                { key: "condicionIva", label: "IVA", render: (row) => <Badge variant="outline">{condicionLabels[row.condicionIva]}</Badge> },
                { key: "localidad", label: "Ubicación", render: (row) => <span className="text-zinc-500">{row.localidad}, {row.provincia}</span> },
                { key: "listaPrecio", label: "Lista", render: (row) => <Badge variant="info">{row.listaPrecio}</Badge> },
                { key: "saldoCuentaCorriente", label: "Saldo CC", className: "text-right", render: (row) => <span className="font-mono block text-right">{formatCurrency(row.saldoCuentaCorriente)}</span> },
                { key: "assignedTo", label: "Vendedor", render: (row) => <span className="text-zinc-500 text-xs">{vendedorName(row.assignedTo)}</span> },
                { key: "activo", label: "Estado", render: (row) => <Badge variant={row.activo ? "success" : "danger"}>{row.activo ? "Activo" : "Inactivo"}</Badge> },
              ]}
              data={filtered}
              onRowClick={() => {}}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((client) => (
              <Card key={client.id} className="cursor-pointer hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600 font-bold text-sm">
                      {client.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}
                    </div>
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-white">{client.razonSocial}</p>
                      <p className="text-xs text-zinc-400">{client.cuit}</p>
                    </div>
                  </div>
                  <Badge variant={client.activo ? "success" : "danger"}>
                    {client.activo ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <div className="mt-4 space-y-2 text-sm text-zinc-500">
                  <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {client.localidad}, {client.provincia}</div>
                  <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {client.telefono}</div>
                  <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {client.email}</div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  <div>
                    <p className="text-xs text-zinc-400">Saldo CC</p>
                    <p className="font-mono font-semibold">{formatCurrency(client.saldoCuentaCorriente)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-400">Lista</p>
                    <Badge variant="info">{client.listaPrecio}</Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
