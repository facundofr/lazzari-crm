"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import {
  ListChecks, Plus, Trash2, Check, ChevronDown, ChevronUp,
  CalendarClock, Link2, Loader2, X,
} from "lucide-react";

interface Pendiente {
  id: string;
  texto: string;
  presupuesto_id: string | null;
  fecha_vencimiento: string | null;
  completado: boolean;
  created_at: string;
}

interface PendientesWidgetProps {
  /** List of presupuestos for linking */
  presupuestoOptions?: { id: string; numero: string }[];
}

export function PendientesWidget({ presupuestoOptions = [] }: PendientesWidgetProps) {
  const { profile, sociedadActiva } = useUser();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(false);

  // New item form
  const [showForm, setShowForm] = useState(false);
  const [newTexto, setNewTexto] = useState("");
  const [newPresupuestoId, setNewPresupuestoId] = useState("");
  const [newFecha, setNewFecha] = useState("");
  const [saving, setSaving] = useState(false);

  const incompleteCount = items.filter((i) => !i.completado).length;

  const fetchPendientes = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      let query = (supabase as any)
        .from("pendientes")
        .select("id, texto, presupuesto_id, fecha_vencimiento, completado, created_at")
        .eq("user_id", profile.id)
        .order("completado", { ascending: true })
        .order("fecha_vencimiento", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (sociedadActiva?.id) {
        query = query.eq("sociedad_id", sociedadActiva.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setItems(data ?? []);
    } catch (err) {
      console.error("Error fetching pendientes:", err);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, sociedadActiva?.id]);

  useEffect(() => {
    fetchPendientes();
  }, [fetchPendientes]);

  async function handleAdd() {
    if (!newTexto.trim() || !profile?.id) return;
    setSaving(true);
    try {
      const row: Record<string, any> = {
        user_id: profile.id,
        texto: newTexto.trim(),
        completado: false,
      };
      if (newPresupuestoId) row.presupuesto_id = newPresupuestoId;
      if (newFecha) row.fecha_vencimiento = newFecha;
      if (sociedadActiva?.id) row.sociedad_id = sociedadActiva.id;

      const { error } = await (supabase as any).from("pendientes").insert(row);
      if (error) throw error;

      setNewTexto("");
      setNewPresupuestoId("");
      setNewFecha("");
      setShowForm(false);
      fetchPendientes();
    } catch (err) {
      console.error("Error adding pendiente:", err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleComplete(id: string, current: boolean) {
    try {
      const { error } = await (supabase as any)
        .from("pendientes")
        .update({ completado: !current })
        .eq("id", id);
      if (error) throw error;
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, completado: !current } : i))
      );
    } catch (err) {
      console.error("Error toggling pendiente:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await (supabase as any)
        .from("pendientes")
        .delete()
        .eq("id", id);
      if (error) throw error;
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error("Error deleting pendiente:", err);
    }
  }

  function formatVencimiento(fecha: string | null) {
    if (!fecha) return null;
    const d = new Date(fecha + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const formatted = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
    if (diff < 0) return { text: formatted, className: "text-red-500" };
    if (diff === 0) return { text: "Hoy", className: "text-orange-500 font-medium" };
    if (diff === 1) return { text: "Manana", className: "text-orange-400" };
    return { text: formatted, className: "text-zinc-400" };
  }

  function getLinkedPRNumero(presupuestoId: string | null) {
    if (!presupuestoId) return null;
    const pr = presupuestoOptions.find((p) => p.id === presupuestoId);
    return pr?.numero ?? null;
  }

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          open
            ? "bg-orange-500 text-white shadow-sm"
            : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
        }`}
      >
        <ListChecks className="h-4 w-4" />
        Pendientes
        {incompleteCount > 0 && (
          <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
            open ? "bg-white/20 text-white" : "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
          }`}>
            {incompleteCount}
          </span>
        )}
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {/* Collapsible panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-96 max-h-[70vh] rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              Lista de Pendientes
            </h3>
            <button
              onClick={() => { setShowForm(true); }}
              className="flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar
            </button>
          </div>

          {/* Add form */}
          {showForm && (
            <div className="border-b border-zinc-200 px-4 py-3 space-y-2 dark:border-zinc-700">
              <input
                type="text"
                placeholder="Descripcion de la tarea..."
                value={newTexto}
                onChange={(e) => setNewTexto(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                autoFocus
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-zinc-500 mb-0.5">Presupuesto (opc.)</label>
                  <select
                    value={newPresupuestoId}
                    onChange={(e) => setNewPresupuestoId(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  >
                    <option value="">Sin vincular</option>
                    {presupuestoOptions.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.numero}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-zinc-500 mb-0.5">Vencimiento (opc.)</label>
                  <input
                    type="date"
                    value={newFecha}
                    onChange={(e) => setNewFecha(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setShowForm(false); setNewTexto(""); setNewPresupuestoId(""); setNewFecha(""); }}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newTexto.trim() || saving}
                  className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  Guardar
                </button>
              </div>
            </div>
          )}

          {/* Items list */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              </div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-400">
                No hay pendientes
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {items.map((item) => {
                  const venc = formatVencimiento(item.fecha_vencimiento);
                  const prNumero = getLinkedPRNumero(item.presupuesto_id);
                  return (
                    <li
                      key={item.id}
                      className={`flex items-start gap-3 px-4 py-2.5 group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
                        item.completado ? "opacity-50" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleComplete(item.id, item.completado)}
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                          item.completado
                            ? "border-green-500 bg-green-500 text-white"
                            : "border-zinc-300 hover:border-orange-400 dark:border-zinc-600"
                        }`}
                      >
                        {item.completado && <Check className="h-3 w-3" />}
                      </button>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-snug ${
                          item.completado
                            ? "line-through text-zinc-400 dark:text-zinc-500"
                            : "text-zinc-700 dark:text-zinc-200"
                        }`}>
                          {item.texto}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {prNumero && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-blue-500">
                              <Link2 className="h-3 w-3" />
                              {prNumero}
                            </span>
                          )}
                          {venc && (
                            <span className={`inline-flex items-center gap-0.5 text-xs ${venc.className}`}>
                              <CalendarClock className="h-3 w-3" />
                              {venc.text}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="mt-0.5 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer with count */}
          {items.length > 0 && (
            <div className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-700">
              {incompleteCount} pendiente{incompleteCount !== 1 ? "s" : ""} &middot; {items.filter((i) => i.completado).length} completado{items.filter((i) => i.completado).length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
