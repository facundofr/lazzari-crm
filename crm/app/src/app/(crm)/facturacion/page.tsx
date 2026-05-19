"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { mockFacturas } from "@/lib/mock-data";
import { Receipt, DollarSign, FileCheck, AlertTriangle, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" }> = {
  emitida: { label: "Emitida", variant: "info" },
  pagada: { label: "Pagada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
  vencida: { label: "Vencida", variant: "warning" },
};

interface FacturaRow {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  cliente_id: string;
  fecha: string;
  cae: string | null;
  cae_vencimiento: string | null;
  subtotal: number;
  iva: number;
  total: number;
  estado: string;
  clientes: { razon_social: string; cuit: string } | null;
}

export default function FacturacionPage() {
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const { data, error } = await supabase
          .from("facturas")
          .select(`*, clientes(razon_social, cuit)`)
          .order("fecha", { ascending: false });

        if (!error && data && data.length > 0) {
          setFacturas(data as unknown as FacturaRow[]);
        } else {
          setFacturas(mockFacturas.map((f) => ({
            id: f.id, tipo: f.tipo, punto_venta: f.puntoVenta, numero: f.numero,
            cliente_id: f.clienteId, fecha: f.fecha, cae: f.cae, cae_vencimiento: f.caeVencimiento,
            subtotal: f.subtotal, iva: f.iva, total: f.total, estado: f.estado,
            clientes: { razon_social: f.clienteNombre, cuit: "" },
          })));
        }
      } catch {
        setFacturas(mockFacturas.map((f) => ({
          id: f.id, tipo: f.tipo, punto_venta: f.puntoVenta, numero: f.numero,
          cliente_id: f.clienteId, fecha: f.fecha, cae: f.cae, cae_vencimiento: f.caeVencimiento,
          subtotal: f.subtotal, iva: f.iva, total: f.total, estado: f.estado,
          clientes: { razon_social: f.clienteNombre, cuit: "" },
        })));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const facturadoMes = facturas.reduce((a, f) => a + Number(f.total), 0);
  const pendientesCobro = facturas.filter(f => f.estado === "emitida").reduce((a, f) => a + Number(f.total), 0);
  const caeVigentes = facturas.filter(f => f.cae).length;

  if (loading) {
    return (
      <>
        <Header title="Facturación" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Facturación"
        subtitle="Comprobantes electrónicos AFIP"
        action={{ label: "Nueva factura", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Facturado este mes" value={formatCurrency(facturadoMes)} icon={DollarSign} iconColor="text-emerald-600" />
          <StatCard title="Comprobantes emitidos" value={String(facturas.length)} icon={Receipt} iconColor="text-blue-600" />
          <StatCard title="Pendientes de cobro" value={formatCurrency(pendientesCobro)} icon={AlertTriangle} iconColor="text-amber-500" />
          <StatCard title="CAE vigentes" value={String(caeVigentes)} icon={FileCheck} iconColor="text-emerald-600" />
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="font-semibold text-zinc-900 dark:text-white">Comprobantes emitidos</h3>
          </div>
          <DataTable<FacturaRow>
            columns={[
              {
                key: "tipo", label: "Comprobante",
                render: (row) => (
                  <span className="font-mono text-xs font-bold">
                    {row.tipo} {String(row.punto_venta).padStart(4, "0")}-{String(row.numero).padStart(8, "0")}
                  </span>
                ),
              },
              { key: "clientes", label: "Cliente", render: (row) => <span className="font-medium">{row.clientes?.razon_social}</span> },
              { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
              { key: "cae", label: "CAE", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cae || "—"}</span> },
              { key: "cae_vencimiento", label: "Vto. CAE", render: (row) => <span className="text-zinc-400 text-xs">{row.cae_vencimiento || "—"}</span> },
              { key: "total", label: "Total", className: "text-right", render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(Number(row.total))}</span> },
              {
                key: "estado", label: "Estado",
                render: (row) => {
                  const cfg = estadoConfig[row.estado] || { label: row.estado, variant: "info" as const };
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
            ]}
            data={facturas}
          />
        </Card>

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
              <p className="mt-2 text-lg font-bold font-mono">
                {facturas.length > 0 ? `${facturas[0].tipo} ${String(facturas[0].punto_venta).padStart(4, "0")}-${String(facturas[0].numero).padStart(8, "0")}` : "—"}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
