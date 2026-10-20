"use client";

/**
 * Compras Lazza › Editar OC (Augusto 18/10: "necesito poder abrir las OC y editar; si me equivoco de proveedor tengo que poder cambiarlo").
 * Se abre con el número de la OC en la lista. Se cambia: proveedor, entrega estimada, observaciones y renglones
 * (código, descripción, cantidad, moneda, precio; agregar o sacar). Lo que llegó se sigue marcando con "Llegó".
 * Augusto 19/10:
 * - Cada artículo tiene su costo en su moneda (orden_compra_items.moneda; vacía = la del costo del PR o la de la OC).
 *   La OC no muestra neto, IVA ni total.
 * - El precio (y la moneda) que se cambia en la OC pasa al renglón del PR de origen.
 * - Proveedor de toda la OC ("Cambiar" de arriba) o de un artículo solo: ese artículo pasa a una OC abierta (sin pedir)
 *   del proveedor nuevo del mismo PR, o a una OC nueva. La OC que queda vacía se cancela (no se borra).
 *   Se muestra y se confirma antes de guardar. El proveedor también cambia en el PR.
 * Con factura cargada o algo ya llegado: avisa, nunca traba.
 * Augusto 19/10 (al sacar del menú la pantalla vieja de Compras): se cambia el operador de la OC (`created_by`) y se puede
 * Anular la OC (queda cancelada, no se borra, con nota de quién y cuándo) o Reactivarla desde la pestaña "Anuladas".
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { Autocompletar } from "@/components/ui/autocompletar";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { estadoPorRecibido } from "@/lib/compras-recepcion";
import { asignarRenglonesAProveedor } from "@/lib/oc-sin-proveedor";
import { monedaRenglonOc, prDeRenglones, totalesOc } from "@/lib/compras-lazza";
import { Ban, Check, Loader2, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";

const db = supabase as any;
// "1.234,56" o "1234.56" → número.
const num = (t: string | number) => { const s = String(t ?? "").trim(); return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0; };
type Moneda = "ARS" | "USD";

type Item = {
  id: string; codigo: string | null; descripcion: string; cantidad: number; cantidad_recibida: number | null; unidad: string | null;
  precio_unitario: number; producto_id: string | null; iva_porcentaje: number | null; orden: number | null;
  presupuesto_item_id?: string | null; moneda?: string | null;
};
/** prov: proveedor propio de este artículo (si es distinto al de la OC, el artículo pasa a otra OC al guardar). */
type Renglon = { id: string; codigo: string; descripcion: string; cantidad: string; precio: string; moneda: Moneda; recibida: number; iva: number | null; prov?: string; nuevo?: boolean };
type Oc = {
  id: string; numero: string; estado: string; moneda: string | null; iva: number | null; proveedor_id: string | null;
  fecha_entrega_estimada: string | null; observaciones: string | null; presupuesto_origen_id: string | null; created_by: string | null;
  presupuesto_origen: { numero: string; modalidad_emision: string | null; created_by: string | null } | null;
};
type Proveedor = { id: string; razon_social: string; nombre_fantasia: string | null; cuit: string | null };
type PrItem = { id: string; codigo: string | null; descripcion: string | null; proveedor_id: string | null; precio_costo: number | null; costo_moneda: string | null };

const inputCls = "w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900";
const nombreProv = (p: Proveedor | undefined) => (p ? (p.nombre_fantasia || p.razon_social || "").trim() : "");
const ITEM_SEL = "id, codigo, descripcion, cantidad, cantidad_recibida, unidad, precio_unitario, producto_id, iva_porcentaje, orden, presupuesto_item_id";

export default function ComprasLazzaOc({ sociedadId, oc: ocRef, onClose }: { sociedadId: string; oc: { id: string; numero: string }; onClose: () => void }) {
  const { toast } = useToast();
  const { profile } = useUser();
  const [oc, setOc] = useState<Oc | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [prItems, setPrItems] = useState<PrItem[]>([]);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [cambiandoProv, setCambiandoProv] = useState(false);
  const [cambiandoRenglon, setCambiandoRenglon] = useState<string | null>(null);
  // La moneda por artículo existe recién cuando se corre la migración 20261019180000: si falta, se ve pero no se guarda en la OC.
  const [conMoneda, setConMoneda] = useState(true);
  const [entrega, setEntrega] = useState("");
  const [perfiles, setPerfiles] = useState<{ id: string; full_name: string | null }[]>([]);
  const [operador, setOperador] = useState("");
  const [obs, setObs] = useState("");
  const [facturas, setFacturas] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const traerItems = (sel: string) => db.from("orden_compra_items").select(sel).eq("orden_id", ocRef.id).order("orden");
        const [o, provs, links, viejas, perfs] = await Promise.all([
          db.from("ordenes_compra").select("id, numero, estado, moneda, iva, proveedor_id, fecha_entrega_estimada, observaciones, presupuesto_origen_id, created_by, presupuesto_origen:presupuesto_origen_id(numero, modalidad_emision, created_by)")
            .eq("id", ocRef.id).eq("sociedad_id", sociedadId).single(),
          db.from("proveedores").select("id, razon_social, nombre_fantasia, cuit").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"),
          db.from("factura_compra_ocs").select("facturas_compra(id, estado)").eq("orden_compra_id", ocRef.id),
          db.from("facturas_compra").select("id, estado").eq("orden_compra_id", ocRef.id).eq("sociedad_id", sociedadId),
          db.from("profiles").select("id, full_name").order("full_name"),
        ]);
        let its = await traerItems(`${ITEM_SEL}, moneda`);
        let tieneMoneda = true;
        if (its.error) { tieneMoneda = false; its = await traerItems(ITEM_SEL); }
        if (!vivo) return;
        if (o.error) throw o.error;
        if (its.error) throw its.error;
        const oc_ = o.data as Oc;
        const lista = (its.data || []) as Item[];
        // Renglones del PR de origen: para la moneda del costo y para pasarle precio y proveedor al guardar.
        let prs: PrItem[] = [];
        if (oc_.presupuesto_origen_id) {
          const { data } = await db.from("presupuesto_items").select("id, codigo, descripcion, proveedor_id, precio_costo, costo_moneda").eq("presupuesto_id", oc_.presupuesto_origen_id);
          prs = (data || []) as PrItem[];
        }
        if (!vivo) return;
        const enPr = prDeRenglones(lista, prs, oc_.proveedor_id);
        const costoMoneda = new Map(prs.map(p => [p.id, p.costo_moneda]));
        setOc(oc_);
        setItems(lista);
        setPrItems(prs);
        setConMoneda(tieneMoneda);
        setRenglones(lista.map(i => ({
          id: i.id, codigo: i.codigo || "", descripcion: i.descripcion || "", cantidad: String(Number(i.cantidad)).replace(".", ","),
          precio: String(Number(i.precio_unitario)).replace(".", ","), recibida: Number(i.cantidad_recibida || 0), iva: i.iva_porcentaje,
          moneda: monedaRenglonOc(i.moneda, costoMoneda.get(enPr.get(i.id) || ""), oc_.moneda),
        })));
        setProveedores((provs.data || []) as Proveedor[]);
        setProveedorId(oc_.proveedor_id || "");
        setEntrega(oc_.fecha_entrega_estimada || "");
        setPerfiles(((perfs.data || []) as { id: string; full_name: string | null }[]).filter(p => p.full_name));
        // Operador: el de la OC; si no tiene, el que cargó el PR (como se ve en la lista).
        setOperador(oc_.created_by || oc_.presupuesto_origen?.created_by || "");
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
  const opcionesProv = useMemo(() => proveedores.map(p => ({ valor: p.id, texto: nombreProv(p), detalle: [p.nombre_fantasia ? p.razon_social : "", p.cuit || ""].filter(Boolean).join(" · ") })), [proveedores]);
  const provPorId = useMemo(() => new Map(proveedores.map(p => [p.id, p])), [proveedores]);
  const provActual = provPorId.get(proveedorId);
  const provCambio = !!oc && proveedorId !== (oc.proveedor_id || "");
  /** Artículos que pasan a otro proveedor (y a otra OC). */
  const seVan = useMemo(() => renglones.filter(r => !r.nuevo && r.prov && r.prov !== proveedorId && (r.descripcion.trim() || r.codigo.trim())), [renglones, proveedorId]);

  const cambiar = (id: string, campo: keyof Renglon, valor: string) => setRenglones(p => p.map(r => (r.id === id ? { ...r, [campo]: valor } : r)));
  function sacar(r: Renglon) {
    if (r.recibida > 0 && !confirm(`De «${r.descripcion || r.codigo}» ya llegaron ${r.recibida}. ¿Lo sacás igual de la OC?`)) return;
    setRenglones(p => p.filter(x => x.id !== r.id));
  }
  const agregar = () => setRenglones(p => [...p, { id: `new_${Date.now()}`, codigo: "", descripcion: "", cantidad: "1", precio: "0", moneda: monedaRenglonOc(null, null, oc?.moneda), recibida: 0, iva: sinIva ? 0 : 21, nuevo: true }]);

  async function guardar() {
    if (!oc) return;
    setError("");
    const validos = renglones.filter(r => r.descripcion.trim() || r.codigo.trim());
    if (!validos.length) { setError("La OC tiene que quedar con al menos un artículo."); return; }
    if (provCambio && facturas > 0 && !confirm(`Ojo: esta OC ya tiene ${facturas === 1 ? "una factura cargada" : `${facturas} facturas cargadas`} del proveedor anterior. La factura no cambia de proveedor.\n\n¿Cambiás el proveedor igual?`)) return;
    const idsSeVan = new Set(seVan.map(r => r.id));
    const quedanEnOc = validos.filter(r => !idsSeVan.has(r.id));
    if (seVan.length) {
      // Mostrar y confirmar antes de guardar (Augusto 19/10). Lo que ya llegó: avisa, no traba.
      const lineas = seVan.map(r => `• ${r.descripcion || r.codigo} → ${nombreProv(provPorId.get(r.prov!)) || "otro proveedor"}${r.recibida > 0 ? ` (ojo: ya llegaron ${String(r.recibida).replace(".", ",")})` : ""}`);
      const msj = [
        `Estos artículos pasan a otro proveedor:`, ...lineas, "",
        "Cada uno va a una OC sin pedir de ese proveedor del mismo PR, o a una OC nueva. También cambia el proveedor en el PR.",
        !quedanEnOc.length ? `\n${oc.numero} queda vacía: se cancela (no se borra).` : "",
        "\n¿Guardás así?",
      ].filter(Boolean).join("\n");
      if (!confirm(msj)) return;
    }
    setGuardando(true);
    try {
      const originales = new Map(items.map(i => [i.id, i]));
      const quedan = new Set(validos.map(r => r.id));
      // Renglón del PR de cada renglón de la OC (el atado al aprobar; si no, por código y descripción de antes de editar).
      const conPr = !!oc.presupuesto_origen_id && !String(oc.observaciones || "").includes("[PR_ITEMS:");
      const enPr = conPr ? prDeRenglones(items, prItems, oc.proveedor_id) : new Map<string, string>();

      // 1. Sacar renglones
      for (const i of items.filter(i => !quedan.has(i.id))) {
        const { error: e } = await db.from("orden_compra_items").delete().eq("id", i.id).eq("orden_id", oc.id);
        if (e) throw new Error(`No se pudo sacar «${i.descripcion}» (${e.message})`);
      }
      // 2. Cambios en los que quedan (y en los que se van, antes de moverlos)
      const costosPr: { prId: string; precio: number; moneda: Moneda }[] = [];
      for (const r of validos.filter(r => !r.nuevo)) {
        const o = originales.get(r.id)!;
        const prId = enPr.get(r.id);
        const pr = prItems.find(p => p.id === prId);
        const monedaAntes = monedaRenglonOc(o.moneda, pr?.costo_moneda, oc.moneda);
        const cambio: Record<string, unknown> = {};
        if (r.codigo.trim() !== (o.codigo || "")) cambio.codigo = r.codigo.trim();
        if (r.descripcion.trim() !== (o.descripcion || "")) cambio.descripcion = r.descripcion.trim();
        if (num(r.cantidad) !== Number(o.cantidad)) cambio.cantidad = num(r.cantidad);
        if (num(r.precio) !== Number(o.precio_unitario)) cambio.precio_unitario = num(r.precio);
        if (conMoneda && r.moneda !== (o.moneda || "")) cambio.moneda = r.moneda;
        // El precio y la moneda del artículo pasan al PR (Augusto 19/10).
        if (prId && (num(r.precio) !== Number(o.precio_unitario) || r.moneda !== monedaAntes)) costosPr.push({ prId, precio: num(r.precio), moneda: r.moneda });
        if (idsSeVan.has(r.id)) cambio.proveedor_id = r.prov;
        else if (provCambio) cambio.proveedor_id = proveedorId || null;
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
          ...(conMoneda ? { moneda: r.moneda } : {}),
        })));
        if (e) throw new Error(`No se pudieron agregar los artículos nuevos (${e.message})`);
      }
      // 4. Encabezado: estado por lo que llegó, proveedor, entrega, observaciones.
      //    El total no se muestra más (cada artículo en su moneda); se sigue guardando para las otras pantallas.
      const tot = totalesOc(quedanEnOc.map(r => ({ cantidad: num(r.cantidad), precio: num(r.precio), iva: r.iva })), sinIva);
      const estado = quedanEnOc.length ? estadoPorRecibido(quedanEnOc.map(r => ({ id: r.id, cantidad: num(r.cantidad), cantidad_recibida: r.recibida })), oc.estado) : oc.estado;
      const { error: e4 } = await db.from("ordenes_compra").update({
        proveedor_id: proveedorId || null, subtotal: tot.subtotal, iva: tot.iva, total: tot.total, estado,
        fecha_entrega_estimada: entrega || null, observaciones: obs,
        ...(operador !== (oc.created_by || oc.presupuesto_origen?.created_by || "") ? { created_by: operador || null } : {}),
      }).eq("id", oc.id).eq("sociedad_id", sociedadId);
      if (e4) throw new Error(`No se pudo guardar la OC (${e4.message})`);

      // 5. Artículos a otro proveedor: a una OC sin pedir de ese proveedor del mismo PR, o a una nueva. La vacía se cancela.
      const destinos: string[] = [];
      const porProv = new Map<string, Renglon[]>();
      for (const r of seVan) porProv.set(r.prov!, [...(porProv.get(r.prov!) || []), r]);
      for (const [pid, rs] of porProv) {
        const p = provPorId.get(pid);
        const res = await asignarRenglonesAProveedor(db, {
          sociedadId, userId: profile?.id, itemIds: rs.map(r => r.id), proveedorId: pid, proveedorNombre: p?.razon_social || "",
          motivo: "al cambiarles el proveedor en la OC", conRecibido: true,
        });
        destinos.push(...res.ocDestino);
      }

      // 6. PR de origen: proveedor (de toda la OC o de cada artículo) y costo con su moneda. Si falla, avisa: la OC ya quedó bien.
      let avisoPr = "";
      try {
        const provPr = new Map<string, string | null>();
        if (provCambio) for (const r of quedanEnOc) { const id = enPr.get(r.id); if (id) provPr.set(id, proveedorId || null); }
        for (const r of seVan) { const id = enPr.get(r.id); if (id) provPr.set(id, r.prov!); }
        const porDestino = new Map<string, string[]>();
        for (const [prId, pid] of provPr) porDestino.set(pid || "", [...(porDestino.get(pid || "") || []), prId]);
        for (const [pid, ids] of porDestino) {
          const { error: e } = await db.from("presupuesto_items").update({ proveedor_id: pid || null, proveedor_nombre: provPorId.get(pid)?.razon_social || "" }).in("id", ids);
          if (e) throw e;
        }
        for (const c of costosPr) {
          const pr = prItems.find(p => p.id === c.prId);
          if (Number(pr?.precio_costo) === c.precio && (pr?.costo_moneda || "ARS") === c.moneda) continue;
          const { error: e } = await db.from("presupuesto_items").update({ precio_costo: c.precio, costo_moneda: c.moneda }).eq("id", c.prId);
          if (e) throw e;
        }
      } catch (e: any) {
        avisoPr = ` (ojo: no se pudo actualizar el ${oc.presupuesto_origen?.numero || "PR"}: ${e?.message || "error"})`;
      }

      let avisoMov = "";
      if (destinos.length) {
        const { data: ds } = await db.from("ordenes_compra").select("numero").in("id", destinos);
        avisoMov = ` · ${seVan.length} artículo(s) pasaron a ${((ds || []) as { numero: string }[]).map(d => d.numero).join(", ") || "otra OC"}`;
      }
      toast.success(`${oc.numero} guardada${avisoMov}${avisoPr}`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally { setGuardando(false); }
  }

  const anulada = oc?.estado === "cancelada";
  const quien = profile?.full_name || "alguien";
  const hoyTxt = () => new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

  // Anular: la OC queda cancelada (no se borra) con nota de quién y cuándo. El PR no se toca. Lo que llegó o la factura: avisa, no traba.
  async function anular() {
    if (!oc) return;
    const llegoAlgo = items.some(i => Number(i.cantidad_recibida) > 0);
    const avisos = [
      llegoAlgo ? "• Ya llegó mercadería de esta OC." : "",
      facturas > 0 ? `• Tiene ${facturas === 1 ? "una factura cargada" : `${facturas} facturas cargadas`}: la factura no se anula.` : "",
    ].filter(Boolean);
    if (!confirm([`¿Anulás ${oc.numero}?`, ...(avisos.length ? ["", "Ojo:", ...avisos] : []), "", "Queda en la pestaña \"Anuladas\" (no se borra) y se puede reactivar. El PR no cambia."].join("\n"))) return;
    setGuardando(true); setError("");
    const { error: e } = await db.from("ordenes_compra").update({ estado: "cancelada", observaciones: `${oc.observaciones || ""} · Anulada el ${hoyTxt()} por ${quien}`.replace(/^ · /, "") }).eq("id", oc.id).eq("sociedad_id", sociedadId);
    setGuardando(false);
    if (e) { setError(`No se pudo anular (${e.message})`); return; }
    toast.success(`${oc.numero} anulada`);
    window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
    onClose();
  }
  // Reactivar: vuelve al estado que corresponde por lo que llegó (Por pedir / Pedido / Parcial / Completo).
  async function reactivar() {
    if (!oc) return;
    setGuardando(true); setError("");
    const estado = estadoPorRecibido(items.map(i => ({ id: i.id, cantidad: Number(i.cantidad), cantidad_recibida: Number(i.cantidad_recibida || 0) })), "enviada");
    const { error: e } = await db.from("ordenes_compra").update({ estado, observaciones: `${oc.observaciones || ""} · Reactivada el ${hoyTxt()} por ${quien}`.replace(/^ · /, "") }).eq("id", oc.id).eq("sociedad_id", sociedadId);
    setGuardando(false);
    if (e) { setError(`No se pudo reactivar (${e.message})`); return; }
    toast.success(`${oc.numero} reactivada`);
    window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-2 md:p-4" onClick={() => { if (!guardando) onClose(); }}>
      <div className="w-full max-w-5xl rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold"><span className="font-mono">{ocRef.numero}</span>
            {oc?.presupuesto_origen?.numero && <span className="ml-2 text-xs font-normal text-zinc-500">de {oc.presupuesto_origen.numero}</span>}
            {anulada && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">Anulada</span>}
          </h2>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        {cargando ? <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo la OC…</p> : !oc ? (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error || "No se encontró la OC."}</p>
        ) : (
          <>
            <div className="mb-3 grid gap-2 text-sm md:grid-cols-[2fr_1fr_1fr]">
              <div>
                <span className="mb-0.5 block text-xs text-zinc-500">Proveedor de toda la OC</span>
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
              <label className="block">
                <span className="mb-0.5 block text-xs text-zinc-500">Operador</span>
                <select value={operador} onChange={e => setOperador(e.target.value)} className={inputCls}>
                  <option value="">Sin operador</option>
                  {perfiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </label>
            </div>
            {facturas > 0 && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Esta OC ya tiene {facturas === 1 ? "una factura cargada" : `${facturas} facturas cargadas`}: los cambios no modifican la factura ni los pagos.</p>}

            <div className="mb-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
                  <tr><th className="px-1 py-1 text-left">Código</th><th className="px-1 py-1 text-left">Descripción</th><th className="w-20 px-1 py-1 text-right">Cant.</th><th className="w-20 px-1 py-1 text-left">Moneda</th><th className="w-28 px-1 py-1 text-right">Precio</th><th className="w-44 px-1 py-1 text-left">Proveedor</th><th className="w-14 px-1 py-1 text-right">Llegó</th><th className="w-8" /></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {renglones.map(r => {
                    const seVa = !r.nuevo && !!r.prov && r.prov !== proveedorId;
                    return (
                      <tr key={r.id} className={seVa ? "bg-orange-50/60 dark:bg-orange-950/20" : ""}>
                        <td className="w-28 px-1 py-0.5"><input value={r.codigo} onChange={e => cambiar(r.id, "codigo", e.target.value)} className={inputCls} /></td>
                        <td className="min-w-[200px] px-1 py-0.5"><input value={r.descripcion} onChange={e => cambiar(r.id, "descripcion", e.target.value)} className={inputCls} autoFocus={r.nuevo} /></td>
                        <td className="px-1 py-0.5"><input value={r.cantidad} inputMode="decimal" onChange={e => cambiar(r.id, "cantidad", e.target.value)} className={`${inputCls} text-right`} /></td>
                        <td className="px-1 py-0.5">
                          <select value={r.moneda} onChange={e => cambiar(r.id, "moneda", e.target.value)}
                            title={conMoneda ? "Moneda del costo de este artículo" : "Falta correr la migración de la moneda por artículo: se pasa al PR pero no queda en la OC"}
                            className={inputCls}>
                            <option value="ARS">$</option>
                            <option value="USD">US$</option>
                          </select>
                        </td>
                        <td className="px-1 py-0.5"><input value={r.precio} inputMode="decimal" onChange={e => cambiar(r.id, "precio", e.target.value)} className={`${inputCls} text-right`} /></td>
                        <td className="px-1 py-0.5 text-xs">
                          {r.nuevo ? <span className="text-zinc-400">el de la OC</span> : cambiandoRenglon === r.id ? (
                            <div className="flex items-center gap-1">
                              <Autocompletar opciones={opcionesProv} placeholder="Proveedor…" chico className="flex-1"
                                onElegir={v => { setRenglones(p => p.map(x => (x.id === r.id ? { ...x, prov: v } : x))); setCambiandoRenglon(null); }} />
                              <button onClick={() => setCambiandoRenglon(null)} title="Cancelar" className="rounded p-0.5 text-zinc-400 hover:text-zinc-700"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className={`truncate ${seVa ? "font-medium text-orange-700 dark:text-orange-300" : "text-zinc-600 dark:text-zinc-300"}`} title={seVa ? "Al guardar pasa a una OC de este proveedor" : undefined}>
                                {seVa ? `→ ${nombreProv(provPorId.get(r.prov!))}` : nombreProv(provActual) || "Sin proveedor"}
                              </span>
                              {seVa
                                ? <button onClick={() => setRenglones(p => p.map(x => (x.id === r.id ? { ...x, prov: undefined } : x)))} title="Dejarlo en esta OC" className="rounded p-0.5 text-zinc-400 hover:text-zinc-700"><Undo2 className="h-3.5 w-3.5" /></button>
                                : <button onClick={() => setCambiandoRenglon(r.id)} className="text-orange-600 underline">Cambiar</button>}
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-0.5 text-right font-mono text-xs text-zinc-500">{r.recibida ? String(r.recibida).replace(".", ",") : "—"}</td>
                        <td className="px-1 py-0.5 text-center">
                          <button onClick={() => sacar(r)} title="Sacar este artículo de la OC" className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <button onClick={agregar} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"><Plus className="h-3.5 w-3.5" /> Agregar artículo</button>
              {seVan.length > 0 && <span className="text-xs text-orange-700 dark:text-orange-300">{seVan.length} artículo(s) pasan a otro proveedor al guardar.</span>}
              <span className="ml-auto text-xs text-zinc-500">El precio y la moneda que cambies pasan al {oc.presupuesto_origen?.numero || "PR"}.</span>
            </div>
            <label className="mb-3 block text-sm">
              <span className="mb-0.5 block text-xs text-zinc-500">Observaciones</span>
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} className={inputCls} />
            </label>

            {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              {anulada
                ? <button onClick={() => void reactivar()} disabled={guardando} title="Vuelve a En curso (o Terminadas si ya llegó todo)" className="mr-auto inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"><RotateCcw className="h-4 w-4" /> Reactivar</button>
                : <button onClick={() => void anular()} disabled={guardando} title="La OC queda anulada (no se borra) y se puede reactivar" className="mr-auto inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"><Ban className="h-4 w-4" /> Anular OC</button>}
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
