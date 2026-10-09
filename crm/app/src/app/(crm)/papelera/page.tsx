"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import { RotateCcw, Trash2, ShieldCheck, Search } from "lucide-react";

type TrashKind = "Presupuesto" | "OC" | "Factura compra" | "Factura venta" | "OP" | "Remito";
type TrashRow = {
  id: string;
  kind: TrashKind;
  number: string;
  state: string;
  date: string | null;
  recoverable: boolean;
  entity: string;
  related: string;
  amount: number | null;
  currency: string | null;
};

const kindOptions: Array<{ value: "" | TrashKind; label: string }> = [
  { value: "", label: "Todos los módulos" },
  { value: "Presupuesto", label: "Presupuestos" },
  { value: "OC", label: "Órdenes de compra" },
  { value: "Factura compra", label: "Facturas de compra" },
  { value: "Factura venta", label: "Facturas de venta" },
  { value: "OP", label: "Órdenes de pago" },
  { value: "Remito", label: "Remitos" },
];

function relationName(value: unknown): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && "razon_social" in row
    ? String((row as { razon_social?: unknown }).razon_social || "")
    : "";
}

function relationNumber(value: unknown): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && "numero" in row
    ? String((row as { numero?: unknown }).numero || "")
    : "";
}

/** Papelera transversal. Los documentos fiscales anulados se conservan como historial. */
export default function PapeleraPage() {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | TrashKind>("");

  const load = useCallback(async () => {
    if (!sociedadActiva?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const run = async (table: string, select: string, filter: (q: any) => any, fallbackSelect?: string) => {
      try {
        const execute = (fields: string) => {
          const q: any = (supabase as any).from(table).select(fields).eq("sociedad_id", sociedadActiva.id);
          return filter(q);
        };
        let result = await execute(select);
        if (result.error && fallbackSelect) result = await execute(fallbackSelect);
        return result.error ? [] : (result.data || []);
      } catch { return []; }
    };
    const [budgets, ocs, purchaseInvoices, salesInvoices, payments, remitos] = await Promise.all([
      run("presupuestos", "id, numero, estado, fecha, created_at, eliminado, total, moneda, cliente:cliente_id(razon_social)", q => q.eq("eliminado", true), "id, numero, estado, fecha, created_at, eliminado, total, moneda"),
      run("ordenes_compra", "id, numero, estado, fecha, updated_at, total, moneda, proveedor:proveedor_id(razon_social), presupuesto_origen:presupuesto_origen_id(numero)", q => q.eq("estado", "cancelada"), "id, numero, estado, fecha, updated_at, total, moneda"),
      run("facturas_compra", "id, numero_factura, estado, fecha, created_at, total, moneda, proveedor:proveedor_id(razon_social), orden_compra:orden_compra_id(numero)", q => q.eq("estado", "anulada"), "id, numero_factura, estado, fecha, created_at, total, moneda"),
      run("facturas", "id, numero, punto_venta, tipo, estado, fecha, created_at, total, moneda, cliente:cliente_id(razon_social), presupuesto:presupuesto_id(numero)", q => q.eq("estado", "anulada"), "id, numero, punto_venta, tipo, estado, fecha, created_at, total, moneda"),
      run("ordenes_pago", "id, numero, estado, fecha, created_at, monto_bruto, moneda, proveedor:proveedor_id(razon_social)", q => q.eq("estado", "anulada"), "id, numero, estado, fecha, created_at, monto_bruto, moneda"),
      run("remitos", "id, numero, estado, fecha, created_at, cliente:cliente_id(razon_social), presupuesto:presupuesto_id(numero)", q => q.in("estado", ["cancelado", "anulado", "anulada"]), "id, numero, estado, fecha, created_at"),
    ]);
    const all: TrashRow[] = [
      ...budgets.map((r: any) => ({ id: r.id, kind: "Presupuesto" as const, number: r.numero || "Sin número", state: "eliminado", date: r.fecha || r.created_at, recoverable: true, entity: relationName(r.cliente), related: "", amount: Number.isFinite(Number(r.total)) ? Number(r.total) : null, currency: r.moneda || null })),
      ...ocs.map((r: any) => ({ id: r.id, kind: "OC" as const, number: r.numero || "Sin número", state: r.estado, date: r.fecha || r.updated_at, recoverable: false, entity: relationName(r.proveedor), related: relationNumber(r.presupuesto_origen), amount: Number.isFinite(Number(r.total)) ? Number(r.total) : null, currency: r.moneda || null })),
      ...purchaseInvoices.map((r: any) => ({ id: r.id, kind: "Factura compra" as const, number: r.numero_factura || "Sin número", state: r.estado, date: r.fecha || r.created_at, recoverable: false, entity: relationName(r.proveedor), related: relationNumber(r.orden_compra), amount: Number.isFinite(Number(r.total)) ? Number(r.total) : null, currency: r.moneda || null })),
      ...salesInvoices.map((r: any) => ({ id: r.id, kind: "Factura venta" as const, number: `${r.tipo || "FC"} ${r.punto_venta ? `${String(r.punto_venta).padStart(4, "0")}-` : ""}${r.numero || "—"}`, state: r.estado, date: r.fecha || r.created_at, recoverable: false, entity: relationName(r.cliente), related: relationNumber(r.presupuesto), amount: Number.isFinite(Number(r.total)) ? Number(r.total) : null, currency: r.moneda || null })),
      ...payments.map((r: any) => ({ id: r.id, kind: "OP" as const, number: r.numero || "Sin número", state: r.estado, date: r.fecha || r.created_at, recoverable: false, entity: relationName(r.proveedor), related: "", amount: Number.isFinite(Number(r.monto_bruto)) ? Number(r.monto_bruto) : null, currency: r.moneda || null })),
      ...remitos.map((r: any) => ({ id: r.id, kind: "Remito" as const, number: r.numero || "Sin número", state: r.estado, date: r.fecha || r.created_at, recoverable: false, entity: relationName(r.cliente), related: relationNumber(r.presupuesto), amount: null, currency: null })),
    ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    setRows(all);
    setLoading(false);
  }, [sociedadActiva?.id, toast]);

  useEffect(() => { load(); }, [load]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    return rows.filter((row) => {
      if (kindFilter && row.kind !== kindFilter) return false;
      if (!term) return true;
      return [row.number, row.entity, row.related, row.kind, row.state]
        .some((value) => value.toLocaleLowerCase("es-AR").includes(term));
    });
  }, [rows, search, kindFilter]);

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
          <div className="grid gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 md:grid-cols-[minmax(0,1fr)_240px_auto] md:items-center">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por número, cliente, proveedor o PR/OC relacionada..."
                className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:focus:ring-orange-950"
              />
            </label>
            <select
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as "" | TrashKind)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              {kindOptions.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
            </select>
            <span className="text-sm text-zinc-500">{filteredRows.length} de {rows.length}</span>
          </div>
          {loading ? <p className="p-6 text-sm text-zinc-500">Cargando...</p> : rows.length === 0 ? <p className="p-6 text-sm text-zinc-500">La papelera está vacía.</p> : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredRows.length === 0 && <p className="p-6 text-sm text-zinc-500">No hay registros que coincidan con la búsqueda.</p>}
              {filteredRows.map((row) => <div key={`${row.kind}-${row.id}`} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={row.recoverable ? "outline" : "danger"}>{row.kind}</Badge><Badge variant="outline">{row.state === "eliminado" ? "Eliminado" : row.state}</Badge></div><p className="mt-1 font-medium dark:text-white">{row.number}</p><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500"><span>{row.date ? formatDate(row.date) : "Fecha no disponible"}</span>{row.entity && <span className="truncate">{row.entity}</span>}{row.related && <span>Relacionado: {row.related}</span>}{row.amount !== null && <span className="font-mono">{new Intl.NumberFormat("es-AR", { style: "currency", currency: row.currency === "USD" ? "USD" : "ARS" }).format(row.amount)}</span>}</div></div>
                {row.recoverable ? <button onClick={() => restore(row)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"><RotateCcw className="h-4 w-4" /> Restaurar</button> : <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><ShieldCheck className="h-4 w-4" /> Conservado</span>}
              </div>)}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
