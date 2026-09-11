"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { RotateCcw, Trash2 } from "lucide-react";

type DeletedBudget = { id: string; numero: string | null; cliente_id: string | null; updated_at?: string | null };

/** Punto único de recuperación para registros enviados a papelera.
 * Por ahora expone presupuestos, que es el módulo con borrado reversible.
 * Los demás módulos conservan sus estados de cancelación para no perder
 * trazabilidad contable ni borrar documentos fiscales.
 */
export default function PapeleraPage() {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const [rows, setRows] = useState<DeletedBudget[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!sociedadActiva?.id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("presupuestos")
      .select("id, numero, cliente_id, updated_at")
      .eq("sociedad_id", sociedadActiva.id)
      .eq("eliminado", true)
      .order("updated_at", { ascending: false });
    if (error) toast.error(`No se pudo cargar la papelera: ${error.message}`);
    setRows((data || []) as DeletedBudget[]);
    setLoading(false);
  }, [sociedadActiva?.id, toast]);

  useEffect(() => { load(); }, [load]);

  async function restore(row: DeletedBudget) {
    const { error } = await (supabase as any).from("presupuestos")
      .update({ eliminado: false })
      .eq("id", row.id)
      .eq("sociedad_id", sociedadActiva?.id);
    if (error) { toast.error(`No se pudo restaurar: ${error.message}`); return; }
    toast.success(`${row.numero || "Presupuesto"} restaurado`);
    await load();
  }

  return (
    <>
      <Header title="Papelera" subtitle="Registros eliminados de forma reversible" />
      <div className="p-4 md:p-6">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <Trash2 className="h-5 w-5 text-zinc-500" />
            <div><h2 className="font-semibold dark:text-white">Presupuestos</h2><p className="text-xs text-zinc-500">Los documentos fiscales no se eliminan: se cancelan y conservan su historial.</p></div>
          </div>
          {loading ? <p className="p-6 text-sm text-zinc-500">Cargando...</p> : rows.length === 0 ? <p className="p-6 text-sm text-zinc-500">La papelera está vacía.</p> : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div><Badge variant="outline">Presupuesto</Badge><p className="mt-1 font-medium dark:text-white">{row.numero || "Sin número"}</p></div>
                <button onClick={() => restore(row)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"><RotateCcw className="h-4 w-4" /> Restaurar</button>
              </div>)}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
