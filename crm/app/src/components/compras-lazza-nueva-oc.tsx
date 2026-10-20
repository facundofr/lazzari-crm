"use client";

/**
 * Compras Lazza › Nueva OC a mano (Augusto 19/10: pasar de la pantalla vieja de Compras lo que todavía hace falta).
 * Para compras sin PR (stock, insumos, OC complementaria). Proveedor (opcional), entrega estimada, observaciones
 * y artículos (código, descripción, cantidad, moneda, precio). Sin factura ni pago: eso va aparte ("Cargar factura").
 * Queda "Por pedir" y el operador es quien la crea (se cambia después abriendo la OC).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { Autocompletar } from "@/components/ui/autocompletar";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { monedaNuevaOc, totalesOc } from "@/lib/compras-lazza";
import { todayAR } from "@/lib/utils";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";

const db = supabase as any;
const num = (t: string) => { const s = String(t ?? "").trim(); return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0; };
type Moneda = "ARS" | "USD";
type Renglon = { id: string; codigo: string; descripcion: string; cantidad: string; precio: string; moneda: Moneda };
type Proveedor = { id: string; razon_social: string; nombre_fantasia: string | null; cuit: string | null };

const inputCls = "w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900";
const nombreProv = (p: Proveedor | undefined) => (p ? (p.nombre_fantasia || p.razon_social || "").trim() : "");
const vacio = (): Renglon => ({ id: `n_${Date.now()}_${Math.random()}`, codigo: "", descripcion: "", cantidad: "1", precio: "0", moneda: "ARS" });

export default function ComprasLazzaNuevaOc({ sociedadId, onClose }: { sociedadId: string; onClose: () => void }) {
  const { toast } = useToast();
  const { profile } = useUser();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [eligiendo, setEligiendo] = useState(true);
  const [entrega, setEntrega] = useState("");
  const [obs, setObs] = useState("");
  const [renglones, setRenglones] = useState<Renglon[]>([vacio()]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    void db.from("proveedores").select("id, razon_social, nombre_fantasia, cuit").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social")
      .then(({ data }: { data: Proveedor[] | null }) => { if (vivo) setProveedores(data || []); });
    return () => { vivo = false; };
  }, [sociedadId]);

  const opcionesProv = useMemo(() => proveedores.map(p => ({ valor: p.id, texto: nombreProv(p), detalle: [p.nombre_fantasia ? p.razon_social : "", p.cuit || ""].filter(Boolean).join(" · ") })), [proveedores]);
  const provActual = proveedores.find(p => p.id === proveedorId);
  const cambiar = (id: string, campo: keyof Renglon, valor: string) => setRenglones(p => p.map(r => (r.id === id ? { ...r, [campo]: valor } : r)));

  async function crear() {
    setError("");
    const validos = renglones.filter(r => r.descripcion.trim() || r.codigo.trim());
    if (!validos.length) { setError("Agregá al menos un artículo."); return; }
    setGuardando(true);
    let ocId = "";
    try {
      const tot = totalesOc(validos.map(r => ({ cantidad: num(r.cantidad), precio: num(r.precio), iva: 21 })), false);
      const { data: nueva, error: e1 } = await db.from("ordenes_compra").insert({
        proveedor_id: proveedorId || null, sociedad_id: sociedadId, fecha: todayAR(), fecha_entrega_estimada: entrega || null,
        moneda: monedaNuevaOc(validos.map(r => r.moneda)), estado: "enviada", subtotal: tot.subtotal, iva: tot.iva, total: tot.total,
        observaciones: obs.trim(), created_by: profile?.id || null, presupuesto_origen_id: null,
      }).select("id, numero").single();
      if (e1 || !nueva) throw new Error(e1?.message || "No se pudo crear la OC");
      ocId = nueva.id;
      const { error: e2 } = await db.from("orden_compra_items").insert(validos.map((r, k) => ({
        orden_id: nueva.id, codigo: r.codigo.trim(), descripcion: r.descripcion.trim(), cantidad: num(r.cantidad), cantidad_recibida: 0,
        unidad: "u", precio_unitario: num(r.precio), iva_porcentaje: 21, orden: k + 1, proveedor_id: proveedorId || null, moneda: r.moneda,
      })));
      if (e2) {
        // Sin artículos la OC no sirve: se cancela (no se borra) y se avisa.
        await db.from("ordenes_compra").update({ estado: "cancelada", observaciones: `${obs.trim()} · No se pudieron cargar los artículos`.replace(/^ · /, "") }).eq("id", nueva.id).eq("sociedad_id", sociedadId);
        throw new Error(`No se pudieron cargar los artículos (${e2.message}). La OC quedó cancelada: probá de nuevo.`);
      }
      toast.success(`${nueva.numero} creada: queda Por pedir`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo crear la OC");
      if (ocId) window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
    } finally { setGuardando(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-2 md:p-4" onClick={() => { if (!guardando) onClose(); }}>
      <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">Nueva OC <span className="text-xs font-normal text-zinc-500">sin PR (stock, insumos, complementaria)</span></h2>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-3 grid gap-2 text-sm md:grid-cols-[2fr_1fr]">
          <div>
            <span className="mb-0.5 block text-xs text-zinc-500">Proveedor (si no lo sabés, dejalo vacío)</span>
            {eligiendo ? (
              <div className="flex items-center gap-1">
                <Autocompletar opciones={opcionesProv} placeholder="Escribí el proveedor…" chico className="flex-1" onElegir={v => { setProveedorId(v); setEligiendo(false); }} />
                {proveedorId && <button onClick={() => setEligiendo(false)} className="rounded border px-2 py-1 text-xs dark:border-zinc-600">Cancelar</button>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className={`font-medium ${proveedorId ? "" : "text-amber-600"}`}>{nombreProv(provActual) || "Sin proveedor"}</span>
                <button onClick={() => setEligiendo(true)} className="text-xs text-orange-600 underline">Cambiar</button>
              </div>
            )}
          </div>
          <label className="block">
            <span className="mb-0.5 block text-xs text-zinc-500">Entrega estimada</span>
            <input type="date" value={entrega} onChange={e => setEntrega(e.target.value)} className={inputCls} />
          </label>
        </div>

        <div className="mb-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
              <tr><th className="px-1 py-1 text-left">Código</th><th className="px-1 py-1 text-left">Descripción</th><th className="w-20 px-1 py-1 text-right">Cant.</th><th className="w-20 px-1 py-1 text-left">Moneda</th><th className="w-28 px-1 py-1 text-right">Precio</th><th className="w-8" /></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {renglones.map((r, k) => (
                <tr key={r.id}>
                  <td className="w-28 px-1 py-0.5"><input value={r.codigo} onChange={e => cambiar(r.id, "codigo", e.target.value)} className={inputCls} /></td>
                  <td className="min-w-[220px] px-1 py-0.5"><input value={r.descripcion} onChange={e => cambiar(r.id, "descripcion", e.target.value)} className={inputCls} autoFocus={k > 0 && k === renglones.length - 1} /></td>
                  <td className="px-1 py-0.5"><input value={r.cantidad} inputMode="decimal" onChange={e => cambiar(r.id, "cantidad", e.target.value)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-0.5">
                    <select value={r.moneda} onChange={e => cambiar(r.id, "moneda", e.target.value)} className={inputCls}>
                      <option value="ARS">$</option>
                      <option value="USD">US$</option>
                    </select>
                  </td>
                  <td className="px-1 py-0.5"><input value={r.precio} inputMode="decimal" onChange={e => cambiar(r.id, "precio", e.target.value)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-0.5 text-center">
                    <button onClick={() => setRenglones(p => p.filter(x => x.id !== r.id))} title="Sacar este artículo" className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => setRenglones(p => [...p, { ...vacio(), moneda: p[p.length - 1]?.moneda || "ARS" }])} className="mb-3 inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"><Plus className="h-3.5 w-3.5" /> Agregar artículo</button>
        <label className="mb-3 block text-sm">
          <span className="mb-0.5 block text-xs text-zinc-500">Observaciones</span>
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} className={inputCls} />
        </label>

        {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={guardando} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-600">Cerrar sin crear</button>
          <button onClick={() => void crear()} disabled={guardando} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Crear OC
          </button>
        </div>
      </div>
    </div>
  );
}
