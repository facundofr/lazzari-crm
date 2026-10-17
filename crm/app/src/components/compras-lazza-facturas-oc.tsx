"use client";

/**
 * Compras Lazza › Facturas de una OC (Augusto 17/10): una OC puede tener varias facturas, y si se cargó una por error
 * se la "saca": la factura queda ANULADA (no se borra, con anular_factura_compra), la OC vuelve a quedar sin facturar
 * (o en parte), se sacan los renglones que esa factura sumó a la OC (envío, diferencia) y los costos que actualizó
 * vuelven al valor anterior en la OC y en el PR (si nadie los cambió después). Si estaba pagada: avisa y pregunta.
 * Después se la puede volver a cargar en la OC correcta (las anuladas no cuentan como "ya cargada").
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { formatCurrency, formatDate } from "@/lib/utils";
import { costoPrAnterior } from "@/lib/compras-lazza";
import { AlertTriangle, Loader2, Plus, Trash2, X } from "lucide-react";

const db = supabase as any;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Renglones que la factura le SUMÓ a la OC (se borran al sacarla). */
const ORIGEN_AGREGADO = new Set(["envio", "diferencia", "vinculo"]);
/** Renglones a los que la factura les pudo cambiar el precio (solo cuando era seguro). */
const ORIGEN_PRECIO = new Set(["codigo", "nombre", "parecido"]);

type Factura = { id: string; numero_factura: string; tipo_comprobante: string | null; total: number; moneda: string | null; estado: string; fecha: string | null };
type Asig = { orden_compra_id: string; orden_compra_item_id: string; precio_factura: number; precio_oc: number; origen: string | null };

export default function ComprasLazzaFacturasOc({ sociedadId, oc, onClose, onCargar }: {
  sociedadId: string; oc: { id: string; numero: string }; onClose: () => void; onCargar: () => void;
}) {
  const { toast } = useToast();
  const { profile } = useUser();
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [cargando, setCargando] = useState(true);
  const [confirmar, setConfirmar] = useState<{ f: Factura; avisos: string[] } | null>(null);
  const [sacando, setSacando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    const sel = "id, numero_factura, tipo_comprobante, total, moneda, estado, fecha";
    const [links, viejas] = await Promise.all([
      db.from("factura_compra_ocs").select(`facturas_compra(${sel})`).eq("orden_compra_id", oc.id),
      db.from("facturas_compra").select(sel).eq("orden_compra_id", oc.id).eq("sociedad_id", sociedadId),
    ]);
    const m = new Map<string, Factura>();
    for (const l of links.data || []) for (const f of [l.facturas_compra].flat()) if (f?.id) m.set(f.id, f);
    for (const f of viejas.data || []) m.set(f.id, f);
    setFacturas([...m.values()].filter(f => f.estado !== "anulada").sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || ""))));
    setCargando(false);
  }, [oc.id, sociedadId]);
  useEffect(() => { void cargar(); }, [cargar]);

  /** Antes de sacar: avisos de plata (pagada, con orden de pago). Nunca frena. */
  async function preparar(f: Factura) {
    setError("");
    const avisos: string[] = [];
    if (f.estado === "pagada") avisos.push("Ya figura pagada: el pago queda a favor del proveedor.");
    const { data: ops } = await db.from("op_facturas_compra").select("orden_pago_id, ordenes_pago(numero, estado)").eq("factura_compra_id", f.id);
    const vivas = ((ops || []) as any[]).filter(o => o.ordenes_pago?.estado !== "anulada");
    if (vivas.length) avisos.push(`Tiene orden de pago (${vivas.map(o => o.ordenes_pago?.numero).filter(Boolean).join(", ")}): si ya se pagó, queda a favor del proveedor.`);
    setConfirmar({ f, avisos });
  }

  async function sacar(f: Factura) {
    setSacando(true); setError("");
    const avisos: string[] = [];
    try {
      // 1) Qué hizo la factura en las OC (se lee ANTES de anular: anular borra las asignaciones).
      const { data: asData, error: eA } = await db.from("factura_compra_asignaciones").select("orden_compra_id, orden_compra_item_id, precio_factura, precio_oc, origen").eq("factura_compra_id", f.id);
      if (eA) throw eA;
      const asigs = (asData || []) as Asig[];

      // 2) Anular (no se borra). Libera las OC y recalcula si quedan facturadas.
      const { data: res, error: eN } = await db.rpc("anular_factura_compra", { p_factura_id: f.id, p_motivo: `Cargada por error en ${oc.numero} (Compras Lazza${profile?.full_name ? `, ${profile.full_name}` : ""})` });
      if (eN) throw new Error(eN.code === "42501" ? "Solo administración (Augusto o Mariana) puede sacar facturas." : eN.message);
      for (const a of (res?.avisos || []) as string[]) avisos.push(a);
      const tocadas = new Set(asigs.map(a => a.orden_compra_id));

      // 3) Renglones que esa factura le sumó a la OC (envío, diferencia): se sacan si no los usa otra factura.
      const agregados = [...new Set(asigs.filter(a => ORIGEN_AGREGADO.has(a.origen || "")).map(a => a.orden_compra_item_id))];
      if (agregados.length) {
        const { data: usados } = await db.from("factura_compra_asignaciones").select("orden_compra_item_id").in("orden_compra_item_id", agregados);
        const libres = agregados.filter(id => !((usados || []) as any[]).some(u => u.orden_compra_item_id === id));
        if (libres.length) {
          const { error: eD } = await db.from("orden_compra_items").delete().in("id", libres);
          if (eD) avisos.push(`No se pudieron sacar los renglones de envío/diferencia (${eD.message}).`);
        }
        if (libres.length < agregados.length) avisos.push("Algún renglón de envío/diferencia lo usa otra factura: quedó en la OC.");
      }

      // 4) Precios que la factura actualizó: vuelven al anterior en la OC y en el PR (si nadie los cambió después).
      const cambiados = asigs.filter(a => ORIGEN_PRECIO.has(a.origen || "") && Math.abs(Number(a.precio_factura) - Number(a.precio_oc)) >= 0.005);
      for (const a of cambiados) {
        const { data: it } = await db.from("orden_compra_items").select("id, descripcion, precio_unitario, presupuesto_item_id").eq("id", a.orden_compra_item_id).single();
        if (!it) continue;
        if (Math.abs(Number(it.precio_unitario) - Number(a.precio_factura)) < 0.005) {
          await db.from("orden_compra_items").update({ precio_unitario: a.precio_oc }).eq("id", it.id);
        } else { avisos.push(`«${it.descripcion}»: el costo de la OC cambió después de la factura, no se tocó.`); continue; }
        if (!it.presupuesto_item_id) { avisos.push(`«${it.descripcion}»: no está atado a un renglón del PR; revisá su costo.`); continue; }
        const { data: pi } = await db.from("presupuesto_items")
          .select("id, descripcion, precio_costo, costo_moneda, markup_porcentaje, precio_venta, precio_lista, presupuesto_id, presupuestos(moneda, tipo_cambio, tipo_cambio_divisas, notas_internas)")
          .eq("id", it.presupuesto_item_id).single();
        const nuevo = pi ? costoPrAnterior({
          costoActual: Number(pi.precio_costo), costoMoneda: pi.costo_moneda, precioFactura: Number(a.precio_factura), precioAnterior: Number(a.precio_oc),
          prMoneda: pi.presupuestos?.moneda, tc: pi.presupuestos?.tipo_cambio, tcDivisas: pi.presupuestos?.tipo_cambio_divisas,
          precioVenta: pi.precio_venta, precioLista: pi.precio_lista, markupActual: pi.markup_porcentaje,
        }) : null;
        if (!pi || !nuevo) { avisos.push(`«${it.descripcion}»: el costo del PR no se volvió atrás (lo cambiaron después o la moneda no cierra).`); continue; }
        const { error: eP } = await db.from("presupuesto_items").update(nuevo).eq("id", pi.id);
        if (eP) { avisos.push(`«${it.descripcion}»: no se pudo volver el costo del PR (${eP.message}).`); continue; }
        const hoy = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        await db.from("presupuestos").update({ notas_internas: `${pi.presupuestos?.notas_internas || ""}\n[${hoy}] Se sacó la FC ${f.numero_factura}: ${pi.descripcion} costo ${pi.precio_costo} → ${nuevo.precio_costo} (margen ${pi.markup_porcentaje ?? 0}% → ${nuevo.markup_porcentaje}%)`.trim() }).eq("id", pi.presupuesto_id);
      }

      // 5) Totales de las OC tocadas.
      for (const ocId of tocadas) {
        const { data: its } = await db.from("orden_compra_items").select("cantidad, precio_unitario, iva_porcentaje").eq("orden_id", ocId);
        const neto = round2((its || []).reduce((t: number, i: any) => t + Number(i.cantidad) * Number(i.precio_unitario), 0));
        const iva = round2((its || []).reduce((t: number, i: any) => t + Number(i.cantidad) * Number(i.precio_unitario) * Number(i.iva_porcentaje ?? 21) / 100, 0));
        // Facturada / en parte / sin facturar, otra vez (ya sin los renglones de envío que se sacaron).
        const { data: pend } = await db.from("orden_compra_items_pendientes").select("cantidad_asignada, cantidad_pendiente").eq("orden_id", ocId);
        const falta = (pend || []).reduce((t: number, p: any) => t + Number(p.cantidad_pendiente || 0), 0);
        const asignada = (pend || []).reduce((t: number, p: any) => t + Number(p.cantidad_asignada || 0), 0);
        const estadoFact = asignada > 0 ? (falta <= 0.0001 ? "facturada" : "parcial") : null;
        await db.from("ordenes_compra").update({ subtotal: neto, iva, total: round2(neto + iva), estado_facturacion: estadoFact, updated_at: new Date().toISOString() }).eq("id", ocId).eq("sociedad_id", sociedadId);
      }

      toast.success(`FC ${f.numero_factura} sacada de ${oc.numero} (quedó anulada). Ya la podés cargar en la OC correcta.`);
      for (const a of avisos) toast.warning(a);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      setConfirmar(null);
      await cargar();
    } catch (e: any) {
      setError(e?.message || "No se pudo sacar la factura");
    } finally { setSacando(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => { if (!sacando) onClose(); }}>
      <div className="w-full max-w-lg rounded-xl bg-white p-4 text-sm shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Facturas · <span className="font-mono">{oc.numero}</span></h2>
          <button onClick={onClose} disabled={sacando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>
        {cargando ? <p className="flex items-center gap-2 text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo las facturas…</p> : (
          <>
            {!facturas.length && <p className="mb-3 text-zinc-500">Esta OC no tiene facturas.</p>}
            <ul className="mb-3 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
              {facturas.map(f => (
                <li key={f.id} className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1"><b>{f.tipo_comprobante || "FC"} {f.numero_factura}</b> <span className="text-xs text-zinc-500">{f.fecha ? formatDate(f.fecha) : ""} · {f.estado === "pagada" ? "pagada" : "a pagar"}</span></span>
                    <span className="whitespace-nowrap font-medium">{formatCurrency(Number(f.total) || 0, (f.moneda || "ARS") as any)}</span>
                    <button onClick={() => void preparar(f)} disabled={sacando} title="Se cargó por error: anularla y sacarla de esta OC"
                      className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" /> Sacar</button>
                  </div>
                  {confirmar?.f.id === f.id && (
                    <div className="mt-1.5 space-y-1.5 rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-300">
                      <p>La factura queda <b>anulada</b> (no se borra), la OC vuelve a quedar sin facturar y los costos que cambió vuelven al valor anterior. ¿La sacamos?</p>
                      {confirmar.avisos.map(a => <p key={a} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}</p>)}
                      <div className="flex gap-2">
                        <button onClick={() => void sacar(f)} disabled={sacando} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-40">
                          {sacando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Sí, sacarla
                        </button>
                        <button onClick={() => setConfirmar(null)} disabled={sacando} className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200">No</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
            <button onClick={onCargar} disabled={sacando} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> Cargar otra factura en esta OC
            </button>
          </>
        )}
      </div>
    </div>
  );
}
