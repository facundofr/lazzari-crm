"use client";

/**
 * Compras Lazza › Editar OC (Augusto 18/10: "necesito poder abrir las OC y editar; si me equivoco de proveedor tengo que poder cambiarlo").
 * Se abre con el número de la OC en la lista. Se cambia: proveedor, entrega estimada, observaciones y renglones
 * (código, descripción, cantidad, precio; agregar o sacar). Lo que llegó se sigue marcando con "Llegó".
 * Al guardar: el proveedor nuevo pasa a los renglones de la OC y a los del PR de origen (A), y el costo cambiado
 * también al PR si es la misma moneda (B). Con factura cargada o algo ya llegado: avisa, nunca traba.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { Autocompletar } from "@/components/ui/autocompletar";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { estadoPorRecibido } from "@/lib/compras-recepcion";
import { renglonesPrDeOc, totalesOc } from "@/lib/compras-lazza";
import { formatCurrency } from "@/lib/utils";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";

const db = supabase as any;
// "1.234,56" o "1234.56" → número.
const num = (t: string | number) => { const s = String(t ?? "").trim(); return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0; };

type Item = {
  id: string; codigo: string | null; descripcion: string; cantidad: number; cantidad_recibida: number | null; unidad: string | null;
  precio_unitario: number; producto_id: string | null; iva_porcentaje: number | null; orden: number | null;
};
type Renglon = { id: string; codigo: string; descripcion: string; cantidad: string; precio: string; recibida: number; iva: number | null; nuevo?: boolean };
type Oc = {
  id: string; numero: string; estado: string; moneda: string | null; iva: number | null; proveedor_id: string | null;
  fecha_entrega_estimada: string | null; observaciones: string | null; presupuesto_origen_id: string | null;
  presupuesto_origen: { numero: string; modalidad_emision: string | null } | null;
};
type Proveedor = { id: string; razon_social: string; nombre_fantasia: string | null; cuit: string | null };

const inputCls = "w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900";
const nombreProv = (p: Proveedor | undefined) => (p ? (p.nombre_fantasia || p.razon_social || "").trim() : "");

export default function ComprasLazzaOc({ sociedadId, oc: ocRef, onClose }: { sociedadId: string; oc: { id: string; numero: string }; onClose: () => void }) {
  const { toast } = useToast();
  const [oc, setOc] = useState<Oc | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [cambiandoProv, setCambiandoProv] = useState(false);
  const [entrega, setEntrega] = useState("");
  const [obs, setObs] = useState("");
  const [facturas, setFacturas] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [o, its, provs, links, viejas] = await Promise.all([
          db.from("ordenes_compra").select("id, numero, estado, moneda, iva, proveedor_id, fecha_entrega_estimada, observaciones, presupuesto_origen_id, presupuesto_origen:presupuesto_origen_id(numero, modalidad_emision)")
            .eq("id", ocRef.id).eq("sociedad_id", sociedadId).single(),
          db.from("orden_compra_items").select("id, codigo, descripcion, cantidad, cantidad_recibida, unidad, precio_unitario, producto_id, iva_porcentaje, orden").eq("orden_id", ocRef.id).order("orden"),
          db.from("proveedores").select("id, razon_social, nombre_fantasia, cuit").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"),
          db.from("factura_compra_ocs").select("facturas_compra(id, estado)").eq("orden_compra_id", ocRef.id),
          db.from("facturas_compra").select("id, estado").eq("orden_compra_id", ocRef.id).eq("sociedad_id", sociedadId),
        ]);
        if (!vivo) return;
        if (o.error) throw o.error;
        if (its.error) throw its.error;
        const oc_ = o.data as Oc;
        const lista = (its.data || []) as Item[];
        setOc(oc_);
        setItems(lista);
        setRenglones(lista.map(i => ({
          id: i.id, codigo: i.codigo || "", descripcion: i.descripcion || "", cantidad: String(Number(i.cantidad)).replace(".", ","),
          precio: String(Number(i.precio_unitario)).replace(".", ","), recibida: Number(i.cantidad_recibida || 0), iva: i.iva_porcentaje,
        })));
        setProveedores((provs.data || []) as Proveedor[]);
        setProveedorId(oc_.proveedor_id || "");
        setEntrega(oc_.fecha_entrega_estimada || "");
        setObs(oc_.observaciones || "");
        const ids = new Set<string>();
        for (const l of (links.data || []) as any[]) for (const f of Array.isArray(l.facturas_compra) ? l.facturas_compra : [l.facturas_compra]) if (f?.id && f.estado !== "anulada") ids.add(f.id);
        for (const f of (viejas.data || []) as any[]) if (f.estado !== "anulada") ids.add(f.id);
        setFacturas(ids.size);
      } catch (e: any) {
        if (vivo) setError(e?.message || "No se pudo traer la OC");
      } finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [ocRef.id, sociedadId]);

  const sinIva = oc?.presupuesto_origen?.modalidad_emision === "manual" || Number(oc?.iva) === 0;
  const tot = useMemo(() => totalesOc(renglones.map(r => ({ cantidad: num(r.cantidad), precio: num(r.precio), iva: r.iva })), sinIva), [renglones, sinIva]);
  const opcionesProv = useMemo(() => proveedores.map(p => ({ valor: p.id, texto: nombreProv(p), detalle: [p.nombre_fantasia ? p.razon_social : "", p.cuit || ""].filter(Boolean).join(" · ") })), [proveedores]);
  const provActual = proveedores.find(p => p.id === proveedorId);
  const provCambio = !!oc && proveedorId !== (oc.proveedor_id || "");
  const moneda = oc?.moneda || "ARS";
  const mon = moneda === "USD" ? "USD" : "ARS";

  const cambiar = (id: string, campo: keyof Renglon, valor: string) => setRenglones(p => p.map(r => (r.id === id ? { ...r, [campo]: valor } : r)));
  function sacar(r: Renglon) {
    if (r.recibida > 0 && !confirm(`De «${r.descripcion || r.codigo}» ya llegaron ${r.recibida}. ¿Lo sacás igual de la OC?`)) return;
    setRenglones(p => p.filter(x => x.id !== r.id));
  }
  const agregar = () => setRenglones(p => [...p, { id: `new_${Date.now()}`, codigo: "", descripcion: "", cantidad: "1", precio: "0", recibida: 0, iva: sinIva ? 0 : 21, nuevo: true }]);

  async function guardar() {
    if (!oc) return;
    setError("");
    const validos = renglones.filter(r => r.descripcion.trim() || r.codigo.trim());
    if (!validos.length) { setError("La OC tiene que quedar con al menos un artículo."); return; }
    if (provCambio && facturas > 0 && !confirm(`Ojo: esta OC ya tiene ${facturas === 1 ? "una factura cargada" : `${facturas} facturas cargadas`} del proveedor anterior. La factura no cambia de proveedor.\n\n¿Cambiás el proveedor igual?`)) return;
    setGuardando(true);
    try {
      const originales = new Map(items.map(i => [i.id, i]));
      const quedan = new Set(validos.map(r => r.id));
      // Renglón del PR de cada renglón de la OC (con el código y la descripción de antes de editar).
      let enPr = new Map<string, string>();
      let prItems: { id: string; precio_costo: number | null; costo_moneda: string | null }[] = [];
      if (oc.presupuesto_origen_id && !String(oc.observaciones || "").includes("[PR_ITEMS:")) {
        const { data } = await db.from("presupuesto_items").select("id, codigo, descripcion, proveedor_id, precio_costo, costo_moneda").eq("presupuesto_id", oc.presupuesto_origen_id);
        prItems = data || [];
        enPr = renglonesPrDeOc(items, data || [], oc.proveedor_id);
      }

      // 1. Sacar renglones
      for (const i of items.filter(i => !quedan.has(i.id))) {
        const { error: e } = await db.from("orden_compra_items").delete().eq("id", i.id).eq("orden_id", oc.id);
        if (e) throw new Error(`No se pudo sacar «${i.descripcion}» (${e.message})`);
      }
      // 2. Cambios en los que quedan
      const costosPr: { prId: string; precio: number }[] = [];
      for (const r of validos.filter(r => !r.nuevo)) {
        const o = originales.get(r.id)!;
        const cambio: Record<string, unknown> = {};
        if (r.codigo.trim() !== (o.codigo || "")) cambio.codigo = r.codigo.trim();
        if (r.descripcion.trim() !== (o.descripcion || "")) cambio.descripcion = r.descripcion.trim();
        if (num(r.cantidad) !== Number(o.cantidad)) cambio.cantidad = num(r.cantidad);
        if (num(r.precio) !== Number(o.precio_unitario)) {
          cambio.precio_unitario = num(r.precio);
          const prId = enPr.get(r.id);
          if (prId) costosPr.push({ prId, precio: num(r.precio) });
        }
        if (provCambio) cambio.proveedor_id = proveedorId || null;
        if (Object.keys(cambio).length) {
          const { error: e } = await db.from("orden_compra_items").update(cambio).eq("id", r.id).eq("orden_id", oc.id);
          if (e) throw new Error(`No se pudo guardar «${r.descripcion}» (${e.message})`);
        }
      }
      // 3. Renglones nuevos
      const nuevos = validos.filter(r => r.nuevo);
      if (nuevos.length) {
        const ultimo = Math.max(0, ...items.map(i => Number(i.orden || 0)));
        const { error: e } = await db.from("orden_compra_items").insert(nuevos.map((r, k) => ({
          orden_id: oc.id, codigo: r.codigo.trim(), descripcion: r.descripcion.trim(), cantidad: num(r.cantidad), cantidad_recibida: 0,
          unidad: "u", precio_unitario: num(r.precio), iva_porcentaje: sinIva ? 0 : (r.iva ?? 21), orden: ultimo + k + 1, proveedor_id: proveedorId || null,
        })));
        if (e) throw new Error(`No se pudieron agregar los artículos nuevos (${e.message})`);
      }
      // 4. Encabezado: totales, estado por lo que llegó, proveedor, entrega, observaciones
      const estado = estadoPorRecibido(validos.map(r => ({ id: r.id, cantidad: num(r.cantidad), cantidad_recibida: r.recibida })), oc.estado);
      const { error: e4 } = await db.from("ordenes_compra").update({
        proveedor_id: proveedorId || null, subtotal: tot.subtotal, iva: tot.iva, total: tot.total, estado,
        fecha_entrega_estimada: entrega || null, observaciones: obs,
      }).eq("id", oc.id).eq("sociedad_id", sociedadId);
      if (e4) throw new Error(`No se pudo guardar la OC (${e4.message})`);

      // 5. PR de origen: proveedor nuevo (A) y costo cambiado si es la misma moneda (B). Si falla, avisa: la OC ya quedó bien.
      let avisoPr = "";
      try {
        if (provCambio && enPr.size) {
          const ids = [...new Set(enPr.values())];
          const { error: e } = await db.from("presupuesto_items").update({ proveedor_id: proveedorId || null, proveedor_nombre: provActual?.razon_social || "" }).in("id", ids);
          if (e) throw e;
        }
        let saltados = 0;
        for (const c of costosPr) {
          const pr = prItems.find(p => p.id === c.prId);
          if ((pr?.costo_moneda || "ARS") !== moneda) { saltados++; continue; }
          if (Number(pr?.precio_costo) === c.precio) continue;
          const { error: e } = await db.from("presupuesto_items").update({ precio_costo: c.precio }).eq("id", c.prId);
          if (e) throw e;
        }
        if (saltados) avisoPr = ` (${saltados} costo(s) no se pasaron al PR porque está en otra moneda)`;
      } catch (e: any) {
        avisoPr = ` (ojo: no se pudo actualizar el ${oc.presupuesto_origen?.numero || "PR"}: ${e?.message || "error"})`;
      }

      toast.success(`${oc.numero} guardada${avisoPr}`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally { setGuardando(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-2 md:p-4" onClick={() => { if (!guardando) onClose(); }}>
      <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold"><span className="font-mono">{ocRef.numero}</span>
            {oc?.presupuesto_origen?.numero && <span className="ml-2 text-xs font-normal text-zinc-500">de {oc.presupuesto_origen.numero}</span>}
            <span className="ml-2 text-xs font-normal text-zinc-500">{moneda}</span>
          </h2>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        {cargando ? <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo la OC…</p> : !oc ? (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error || "No se encontró la OC."}</p>
        ) : (
          <>
            <div className="mb-3 grid gap-2 text-sm md:grid-cols-[2fr_1fr]">
              <div>
                <span className="mb-0.5 block text-xs text-zinc-500">Proveedor</span>
                {cambiandoProv ? (
                  <div className="flex items-center gap-1">
                    <Autocompletar opciones={opcionesProv} placeholder="Escribí el proveedor…" chico className="flex-1"
                      onElegir={v => { setProveedorId(v); setCambiandoProv(false); }} />
                    <button onClick={() => setCambiandoProv(false)} className="rounded border px-2 py-1 text-xs dark:border-zinc-600">Cancelar</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${proveedorId ? "" : "text-amber-600"}`}>{nombreProv(provActual) || (proveedorId ? "(proveedor inactivo)" : "Sin proveedor")}</span>
                    {provCambio && <span className="rounded bg-orange-100 px-1.5 text-[11px] text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">cambiado</span>}
                    <button onClick={() => setCambiandoProv(true)} className="text-xs text-orange-600 underline">Cambiar</button>
                  </div>
                )}
                {provCambio && <p className="mt-1 text-xs text-zinc-500">Se cambia también en los artículos del {oc.presupuesto_origen?.numero || "PR"}.{facturas > 0 ? " Ojo: ya tiene factura cargada del proveedor anterior." : ""}</p>}
              </div>
              <label className="block">
                <span className="mb-0.5 block text-xs text-zinc-500">Entrega estimada</span>
                <input type="date" value={entrega} onChange={e => setEntrega(e.target.value)} className={inputCls} />
              </label>
            </div>
            {facturas > 0 && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Esta OC ya tiene {facturas === 1 ? "una factura cargada" : `${facturas} facturas cargadas`}: los cambios no modifican la factura ni los pagos.</p>}

            <div className="mb-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
                  <tr><th className="px-1 py-1 text-left">Código</th><th className="px-1 py-1 text-left">Descripción</th><th className="w-20 px-1 py-1 text-right">Cant.</th><th className="w-28 px-1 py-1 text-right">Precio {moneda}</th><th className="w-24 px-1 py-1 text-right">Subtotal</th><th className="w-14 px-1 py-1 text-right">Llegó</th><th className="w-8" /></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {renglones.map(r => (
                    <tr key={r.id}>
                      <td className="w-28 px-1 py-0.5"><input value={r.codigo} onChange={e => cambiar(r.id, "codigo", e.target.value)} className={inputCls} /></td>
                      <td className="min-w-[220px] px-1 py-0.5"><input value={r.descripcion} onChange={e => cambiar(r.id, "descripcion", e.target.value)} className={inputCls} autoFocus={r.nuevo} /></td>
                      <td className="px-1 py-0.5"><input value={r.cantidad} inputMode="decimal" onChange={e => cambiar(r.id, "cantidad", e.target.value)} className={`${inputCls} text-right`} /></td>
                      <td className="px-1 py-0.5"><input value={r.precio} inputMode="decimal" onChange={e => cambiar(r.id, "precio", e.target.value)} className={`${inputCls} text-right`} /></td>
                      <td className="whitespace-nowrap px-1 py-0.5 text-right font-mono text-xs">{formatCurrency(num(r.cantidad) * num(r.precio), mon)}</td>
                      <td className="px-1 py-0.5 text-right font-mono text-xs text-zinc-500">{r.recibida ? String(r.recibida).replace(".", ",") : "—"}</td>
                      <td className="px-1 py-0.5 text-center">
                        <button onClick={() => sacar(r)} title="Sacar este artículo de la OC" className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <button onClick={agregar} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"><Plus className="h-3.5 w-3.5" /> Agregar artículo</button>
              <span className="ml-auto text-xs text-zinc-500">Neto {formatCurrency(tot.subtotal, mon)}{sinIva ? " · sin IVA" : ` + IVA ${formatCurrency(tot.iva, mon)}`} = <b className="text-zinc-800 dark:text-zinc-100">{formatCurrency(tot.total, mon)}</b></span>
            </div>
            <label className="mb-3 block text-sm">
              <span className="mb-0.5 block text-xs text-zinc-500">Observaciones</span>
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} className={inputCls} />
            </label>

            {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={guardando} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-600">Cerrar sin guardar</button>
              <button onClick={() => void guardar()} disabled={guardando} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
