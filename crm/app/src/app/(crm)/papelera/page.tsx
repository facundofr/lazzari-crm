"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { RotateCcw, Trash2, ShieldCheck } from "lucide-react";

type TrashKind = "Presupuesto" | "OC" | "Factura compra" | "Factura venta" | "OP" | "Remito";
type TrashRow = { id: string; kind: TrashKind; number: string; state: string; date: string | null; recoverable: boolean };

/** Papelera transversal. Los documentos fiscales anulados se conservan como historial. */
export default function PapeleraPage() {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!sociedadActiva?.id) return;
    setLoading(true);
    const run = async (table: string, select: string, filter: (q: any) => any) => {
      try {
        let q: any = (supabase as any).from(table).select(select).eq("sociedad_id", sociedadActiva.id);
        const result = await filter(q);
        return result.error ? [] : (result.data || []);
      } catch { return []; }
    };
    const [budgets, ocs, purchaseInvoices, salesInvoices, payments, remitos] = await Promise.all([
      run("presupuestos", "id, numero, estado, fecha, created_at, eliminado", q => q.eq("eliminado", true)),
      run("ordenes_compra", "id, numero, estado, fecha, updated_at", q => q.eq("estado", "cancelada")),
      run("facturas_compra", "id, numero_factura, estado, fecha, created_at", q => q.eq("estado", "anulada")),
      run("facturas", "id, numero, punto_venta, tipo, estado, fecha, created_at", q => q.eq("estado", "anulada")),
      run("ordenes_pago", "id, numero, estado, fecha, created_at", q => q.eq("estado", "anulada")),
      run("remitos", "id, numero, estado, fecha, created_at", q => q.in("estado", ["cancelado", "anulado", "anulada"])),
    ]);
    const all: TrashRow[] = [
      ...budgets.map((r: any) => ({ id: r.id, kind: "Presupuesto" as const, number: r.numero || "Sin número", state: "eliminado", date: r.fecha || r.created_at, recoverable: true })),
      ...ocs.map((r: any) => ({ id: r.id, kind: "OC" as const, number: r.numero || "Sin número", state: r.estado, date: r.fecha || r.updated_at, recoverable: false })),
      ...purchaseInvoices.map((r: any) => ({ id: r.id, kind: "Factura compra" as const, number: r.numero_factura || "Sin número", state: r.estado, date: r.fecha || r.created_at, recoverable: false })),
      ...salesInvoices.map((r: any) => ({ id: r.id, kind: "Factura venta" as const, number: `${r.tipo || "FC"} ${r.punto_venta ? `${String(r.punto_venta).padStart(4, "0")}-` : ""}${r.numero || "—"}`, state: r.estado, date: r.fecha || r.created_at, recoverable: false })),
      ...payments.map((r: any) => ({ id: r.id, kind: "OP" as const, number: r.numero || "Sin número", state: r.estado, date: r.fecha || r.created_at, recoverable: false })),
      ...remitos.map((r: any) => ({ id: r.id, kind: "Remito" as const, number: r.numero || "Sin número", state: r.estado, date: r.fecha || r.created_at, recoverable: false })),
    ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    setRows(all);
    setLoading(false);
  }, [sociedadActiva?.id, toast]);

  useEffect(() => { load(); }, [load]);

  async function restore(row: TrashRow) {
    const { error } = await (supabase as any).from("presupuestos")
      .update({ eliminado: false })
      .eq("id", row.id).eq("sociedad_id", sociedadActiva?.id).eq("eliminado", true);
    if (error) { toast.error(`No se pudo restaurar: ${error.message}`); return; }
    toast.success(`${row.number || "Presupuesto"} restaurado`);
    await load();
  }

  return (
    <>
      <Header title="Papelera" subtitle="Registros eliminados de forma reversible" />
      <div className="p-4 md:p-6">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <Trash2 className="h-5 w-5 text-zinc-500" />
            <div><h2 className="font-semibold dark:text-white">Todos los módulos</h2><p className="text-xs text-zinc-500">Las facturas, OP y remitos anulados se conservan como historial y no se pueden borrar ni reactivar desde aquí.</p></div>
          </div>
          {loading ? <p className="p-6 text-sm text-zinc-500">Cargando...</p> : rows.length === 0 ? <p className="p-6 text-sm text-zinc-500">La papelera está vacía.</p> : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((row) => <div key={`${row.kind}-${row.id}`} className="flex items-center justify-between gap-4 px-5 py-4">
                <div><div className="flex flex-wrap items-center gap-2"><Badge variant={row.recoverable ? "outline" : "danger"}>{row.kind}</Badge><Badge variant="outline">{row.state === "eliminado" ? "Eliminado" : row.state}</Badge></div><p className="mt-1 font-medium dark:text-white">{row.number}</p><p className="text-xs text-zinc-500">{row.date ? new Date(row.date).toLocaleDateString("es-AR") : "Fecha no disponible"}</p></div>
                {row.recoverable ? <button onClick={() => restore(row)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"><RotateCcw className="h-4 w-4" /> Restaurar</button> : <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><ShieldCheck className="h-4 w-4" /> Conservado</span>}
              </div>)}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
