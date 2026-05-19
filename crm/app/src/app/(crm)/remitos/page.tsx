"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { mockRemitos } from "@/lib/mock-data";
import { Sparkles, Truck, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "info" }> = {
  pendiente: { label: "Pendiente", variant: "warning" },
  entregado: { label: "Entregado", variant: "success" },
  parcial: { label: "Parcial", variant: "info" },
};

interface RemitoRow {
  id: string;
  numero: string;
  cliente_id: string;
  presupuesto_id: string | null;
  fecha: string;
  cae: string | null;
  estado: string;
  observaciones: string;
  clientes: { razon_social: string } | null;
  remito_items: { id: string }[];
}

export default function RemitosPage() {
  const [remitos, setRemitos] = useState<RemitoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const { data, error } = await supabase
          .from("remitos")
          .select(`*, clientes(razon_social), remito_items(id)`)
          .order("fecha", { ascending: false });

        if (!error && data && data.length > 0) {
          setRemitos(data as unknown as RemitoRow[]);
        } else {
          setRemitos(mockRemitos.map((r) => ({
            id: r.id, numero: r.numero, cliente_id: r.clienteId,
            presupuesto_id: r.presupuestoId || null, fecha: r.fecha,
            cae: r.cae || null, estado: r.estado, observaciones: r.observaciones,
            clientes: { razon_social: r.clienteNombre },
            remito_items: r.items.map((i) => ({ id: i.id })),
          })));
        }
      } catch {
        setRemitos(mockRemitos.map((r) => ({
          id: r.id, numero: r.numero, cliente_id: r.clienteId,
          presupuesto_id: r.presupuestoId || null, fecha: r.fecha,
          cae: r.cae || null, estado: r.estado, observaciones: r.observaciones,
          clientes: { razon_social: r.clienteNombre },
          remito_items: r.items.map((i) => ({ id: i.id })),
        })));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <>
        <Header title="Remitos" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Remitos"
        subtitle="Remitos con CAE — asistidos por IA"
        action={{ label: "Nuevo remito", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
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
          <DataTable<RemitoRow>
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
              { key: "clientes", label: "Cliente", render: (row) => <span className="font-medium">{row.clientes?.razon_social}</span> },
              { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
              { key: "remito_items", label: "Items", render: (row) => <span className="text-zinc-500">{row.remito_items.length} productos</span> },
              { key: "cae", label: "CAE", render: (row) => row.cae ? <span className="font-mono text-xs text-zinc-500">{row.cae}</span> : <Badge variant="outline">Sin CAE</Badge> },
              { key: "presupuesto_id", label: "PR Origen", render: (row) => row.presupuesto_id ? <Badge variant="info">Vinculado</Badge> : <span className="text-zinc-400">—</span> },
              {
                key: "estado", label: "Estado",
                render: (row) => {
                  const cfg = estadoConfig[row.estado] || { label: row.estado, variant: "info" as const };
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
            ]}
            data={remitos}
          />
        </Card>
      </div>
    </>
  );
}
