"use client";

/**
 * Compras Lazza (Augusto 16/10): versión MUY simple de Compras, para probarla ellos. Lo de Compras nueva no se toca.
 * - Lista de OC con los mismos filtros (components/compras-lista-oc) + 📋 Copiar para WhatsApp.
 * - Las OC se arman solas al aprobar el PR (como siempre).
 * - "Llegó": Completo o Parcial por artículo (components/compras-lazza-llego).
 * - "Cargar factura": simple y permisiva (components/compras-lazza-factura); lo que no coincide queda en "Observar".
 * Solo la ven en el menú los que tienen la casilla "Prueba: Compras nueva".
 */
import { useState } from "react";
import { Header } from "@/components/layout/header";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase/client";
import ComprasListaOC, { type OcLazza } from "@/components/compras-lista-oc";
import ComprasLazzaLlego from "@/components/compras-lazza-llego";
import ComprasLazzaFactura from "@/components/compras-lazza-factura";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { Check, FileUp, Loader2, X } from "lucide-react";

const db = supabase as any;

export default function ComprasLazzaPage() {
  const { profile, sociedadActiva } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;
  const [factura, setFactura] = useState(false);
  const [llego, setLlego] = useState<OcLazza | null>(null);
  const [observar, setObservar] = useState<OcLazza | null>(null);
  const [sacando, setSacando] = useState(false);

  async function yaEstaBien(oc: OcLazza) {
    if (!sociedadId) return;
    setSacando(true);
    try {
      const firma = `[Resuelta ${new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}${profile?.full_name ? ` por ${profile.full_name}` : ""}]`;
      const nota = `${firma} ${oc.observar_nota || ""}`.trim();
      const { error } = await db.from("ordenes_compra").update({ observar: false, observar_nota: nota }).eq("id", oc.id).eq("sociedad_id", sociedadId);
      if (error) throw error;
      // Las facturas de esa OC que estaban en Observar también se sacan.
      const { data: links } = await db.from("factura_compra_ocs").select("factura_compra_id").eq("orden_compra_id", oc.id);
      const ids = ((links || []) as { factura_compra_id: string }[]).map(l => l.factura_compra_id);
      if (ids.length) await db.from("facturas_compra").update({ observar: false }).in("id", ids).eq("observar", true).eq("sociedad_id", sociedadId);
      toast.success(`${oc.numero}: ya no está en Observar`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      setObservar(null);
    } catch (e: any) {
      toast.error(`No se pudo sacar la marca (${e?.message || "error"})`);
    } finally { setSacando(false); }
  }

  return (
    <div>
      <Header title="Compras Lazza" subtitle="Las OC se arman solas al aprobar un PR. Marcás lo que llegó y cargás la factura." />
      <div className="space-y-3 p-4 md:p-6">
        <div className="flex justify-end">
          <button onClick={() => setFactura(true)} disabled={!sociedadId}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            title="Subí la factura del proveedor, elegí la o las OC y guardá">
            <FileUp className="h-4 w-4" /> Cargar factura
          </button>
        </div>
        <ComprasListaOC sociedadId={sociedadId} lazza={{ onLlego: setLlego, onObservar: setObservar }} />
      </div>

      {factura && sociedadId && <ComprasLazzaFactura sociedadId={sociedadId} onClose={() => setFactura(false)} />}
      {llego && sociedadId && <ComprasLazzaLlego sociedadId={sociedadId} oc={llego} onClose={() => setLlego(null)} />}
      {observar && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!sacando) setObservar(null); }}>
          <div className="w-full max-w-md rounded-xl bg-white p-4 text-sm shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={e => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-bold">👁 Observar · <span className="font-mono">{observar.numero}</span></h2>
              <button onClick={() => setObservar(null)} disabled={sacando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 whitespace-pre-wrap rounded-lg bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{observar.observar_nota || "Sin nota."}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setObservar(null)} disabled={sacando} className="rounded-lg border px-3 py-1.5 dark:border-zinc-600">Cerrar</button>
              <button onClick={() => void yaEstaBien(observar)} disabled={sacando} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
                {sacando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Ya está bien
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
