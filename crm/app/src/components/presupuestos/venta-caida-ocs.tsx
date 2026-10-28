"use client";

// Venta caída (auditoría integral 28/10/2026, H09): cuando un PR pasa a rechazado / perdido / "no facturar" y todavía
// tiene OC vivas, se avisa con la lista. Admin y super admin pueden cancelar las que marquen (vienen marcadas las que
// no recibieron nada); el resto le avisa a Compras por la campana. Nunca frena ni cancela solo.

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/utils";

interface OCViva {
  id: string;
  numero: string | null;
  estado: string;
  total: number;
  moneda: "ARS" | "USD";
  proveedor: string;
  recibido: number;
}

export function VentaCaidaOCs({ prId, prNumero, onClose }: { prId: string; prNumero: string; onClose: () => void }) {
  const { profile, sociedadActiva } = useUser();
  const { toast } = useToast();
  const [ocs, setOcs] = useState<OCViva[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const puedeCancelar = profile?.role === "super_admin" || profile?.role === "admin";
  const socId = sociedadActiva?.id;

  useEffect(() => {
    if (!socId) return;
    let vivo = true;
    (async () => {
      const { data, error } = await (supabase as any).from("ordenes_compra")
        .select("id, numero, estado, total, moneda, proveedores(razon_social), orden_compra_items(cantidad_recibida)")
        .eq("presupuesto_origen_id", prId).eq("sociedad_id", socId).neq("estado", "cancelada");
      if (!vivo) return;
      if (error) { toast.error(`No se pudieron revisar las OC del ${prNumero}: ${error.message}`); onClose(); return; }
      const lista: OCViva[] = ((data || []) as any[]).map((o) => ({
        id: o.id, numero: o.numero, estado: o.estado, total: Number(o.total) || 0, moneda: o.moneda === "USD" ? "USD" : "ARS",
        proveedor: (Array.isArray(o.proveedores) ? o.proveedores[0] : o.proveedores)?.razon_social || "Sin proveedor",
        recibido: ((o.orden_compra_items || []) as { cantidad_recibida: number | null }[]).reduce((s, i) => s + (Number(i.cantidad_recibida) || 0), 0),
      }));
      if (lista.length === 0) { onClose(); return; }
      setOcs(lista);
      setMarcadas(new Set(lista.filter((o) => o.recibido === 0).map((o) => o.id)));
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId, socId]);

  if (!ocs) return null;

  async function cancelarMarcadas() {
    if (!socId || marcadas.size === 0) return;
    setOcupado(true);
    const { data, error } = await (supabase as any).from("ordenes_compra").update({ estado: "cancelada" })
      .in("id", [...marcadas]).eq("sociedad_id", socId).neq("estado", "cancelada").select("id");
    setOcupado(false);
    if (error) { toast.error(`No se pudieron cancelar: ${error.message}`); return; }
    toast.success(`${data?.length || 0} OC cancelada(s) del ${prNumero}`);
    onClose();
  }

  async function avisarACompras() {
    if (!socId) return;
    setOcupado(true);
    const { data: destinos } = await (supabase as any).from("profiles").select("id")
      .eq("active", true).or("prueba_compras_nueva.eq.true,role.in.(super_admin,admin)");
    const lista = (ocs || []).map((o) => `${o.numero || "OC"} (${o.proveedor}${o.recibido > 0 ? ", ya llegó algo" : ""})`).join(", ");
    const filas = ((destinos || []) as { id: string }[]).filter((d) => d.id !== profile?.id).map((d) => ({
      tipo: "seguimiento", title: `Venta caída: ${prNumero}`, description: `El ${prNumero} no sigue y tiene OC vivas: ${lista}. Revisá si se cancelan.`,
      entity_id: prId, entity_type: "presupuesto", module: "presupuestos", user_id: d.id, sociedad_id: socId,
    }));
    if (filas.length === 0) { setOcupado(false); toast.warning("No encontré a quién avisar: decíselo a Compras directamente."); return; }
    const { error } = await (supabase as any).from("alertas").insert(filas);
    setOcupado(false);
    if (error) { toast.error(`No se pudo avisar: ${error.message}`); return; }
    toast.success("Listo: Compras tiene el aviso en la campana");
    onClose();
  }

  const conRecibido = ocs.filter((o) => o.recibido > 0).length;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> {prNumero} no sigue, pero tiene {ocs.length === 1 ? "1 OC viva" : `${ocs.length} OC vivas`}
          </h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-zinc-500">
          {puedeCancelar
            ? "Marcá las que se cancelan. Vienen marcadas las que no recibieron nada; las que ya recibieron mercadería conviene revisarlas con Compras."
            : "Las OC las decide Compras. Avisales para que revisen si se cancelan."}
          {conRecibido > 0 && ` ${conRecibido === 1 ? "Una ya recibió" : `${conRecibido} ya recibieron`} mercadería.`}
        </p>
        <div className="mb-3 max-h-64 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
          {ocs.map((o) => (
            <label key={o.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              {puedeCancelar && (
                <input type="checkbox" checked={marcadas.has(o.id)}
                  onChange={(e) => setMarcadas((prev) => { const n = new Set(prev); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} />
              )}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{o.numero || "OC"}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-500">{o.proveedor}</span>
              <span className="text-zinc-400">{o.estado}{o.recibido > 0 ? " · llegó algo" : ""}</span>
              <span className="font-mono text-zinc-600 dark:text-zinc-300">{formatCurrency(o.total, o.moneda)}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Dejarlas como están
          </button>
          {puedeCancelar ? (
            <button type="button" disabled={ocupado || marcadas.size === 0} onClick={cancelarMarcadas}
              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {ocupado && <Loader2 className="h-3 w-3 animate-spin" />} Cancelar {marcadas.size === 1 ? "la marcada" : `las ${marcadas.size} marcadas`}
            </button>
          ) : (
            <button type="button" disabled={ocupado} onClick={avisarACompras}
              className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">
              {ocupado && <Loader2 className="h-3 w-3 animate-spin" />} Avisar a Compras
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
