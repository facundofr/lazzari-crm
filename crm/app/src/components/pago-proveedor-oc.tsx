"use client";

// "Pago que pide el proveedor" en el detalle de una OC. Arranca con lo que tiene cargado el proveedor; el comprador lo puede
// cambiar para esta compra. Si el proveedor todavía no tenía cómo se le paga, se le guarda también a él (así no se pregunta
// de nuevo). Si falta, avisa en amarillo: nunca frena.
import { useEffect, useState } from "react";
import { Loader2, Pencil, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { CondicionPagoEditor } from "@/components/condicion-pago-editor";
import { textoCondicionPago, type PlanPago } from "@/lib/condicion-pago";

const CAMPOS_OC = "condicion_pago, dias_pago, dias_pago_hasta, medio_pago_preferido, plazo_cheque_dias, descuento_pronto_pago";
const CAMPOS_PROV = `${CAMPOS_OC}, medios_pago`;

function soloPlan(p: PlanPago): PlanPago {
  return {
    condicion_pago: p.condicion_pago || null,
    dias_pago: p.dias_pago ?? null,
    dias_pago_hasta: p.condicion_pago === "escalonado" ? p.dias_pago_hasta ?? null : null,
    medio_pago_preferido: p.medio_pago_preferido || null,
    plazo_cheque_dias: p.plazo_cheque_dias ?? null,
    descuento_pronto_pago: p.descuento_pronto_pago ?? null,
  };
}

export function PagoProveedorOC({ ocId, proveedorId, sociedadId, puedeEditar }: { ocId: string; proveedorId: string; sociedadId: string; puedeEditar: boolean }) {
  const [plan, setPlan] = useState<PlanPago>({});
  const [delProveedor, setDelProveedor] = useState<PlanPago | null>(null);
  const [propioDeLaOC, setPropioDeLaOC] = useState(false);
  const [editando, setEditando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true); setError(""); setAviso(""); setEditando(false);
      const db = supabase as any;
      const [oc, prov] = await Promise.all([
        db.from("ordenes_compra").select(CAMPOS_OC).eq("id", ocId).single(),
        db.from("proveedores").select(CAMPOS_PROV).eq("id", proveedorId).single(),
      ]);
      if (cancelado) return;
      setCargando(false);
      const p = (prov.data || null) as PlanPago | null;
      const o = (oc.data || null) as PlanPago | null;
      setDelProveedor(p);
      setPropioDeLaOC(Boolean(o?.condicion_pago));
      setPlan(o?.condicion_pago ? { ...o, medios_pago: p?.medios_pago || [] } : { ...(p || {}) });
    })();
    return () => { cancelado = true; };
  }, [ocId, proveedorId]);

  async function guardar() {
    setGuardando(true); setError(""); setAviso("");
    try {
      const db = supabase as any;
      const datos = soloPlan(plan);
      const { error: e1 } = await db.from("ordenes_compra").update(datos).eq("id", ocId).eq("sociedad_id", sociedadId);
      if (e1) throw e1;
      // Proveedor sin "cómo se le paga": se le guarda lo que pidió en esta OC.
      if (!delProveedor?.condicion_pago && datos.condicion_pago) {
        const medios = Array.from(new Set([...(delProveedor?.medios_pago || []), ...(datos.medio_pago_preferido ? [datos.medio_pago_preferido] : [])]));
        const { error: e2 } = await db.from("proveedores").update({ ...datos, medios_pago: medios }).eq("id", proveedorId).eq("sociedad_id", sociedadId);
        if (e2) setAviso(`Se guardó en la OC, pero no en el proveedor: ${e2.message}`);
        else { setDelProveedor({ ...datos, medios_pago: medios }); setAviso("También quedó guardado en el proveedor."); }
      }
      setPropioDeLaOC(true);
      setEditando(false);
    } catch (err: any) {
      setError(err?.message || "No se pudo guardar");
    } finally { setGuardando(false); }
  }

  if (cargando) return <p className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Pago que pide el proveedor…</p>;

  const texto = textoCondicionPago(plan);
  const distintoDelProveedor = propioDeLaOC && delProveedor?.condicion_pago && textoCondicionPago(delProveedor) !== texto;
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${texto ? "border-zinc-200 dark:border-zinc-700" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"}`}>
      <div className="flex items-center gap-2">
        <Wallet className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <span className="text-xs text-zinc-500">Pago que pide el proveedor:</span>
        {texto ? <span className="font-medium">{texto}</span> : <span className="font-medium text-amber-700 dark:text-amber-400">⚠️ Sin indicar — cargalo así Pagos no tiene que preguntar</span>}
        {puedeEditar && !editando && (
          <button type="button" onClick={() => setEditando(true)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30">
            <Pencil className="h-3 w-3" /> {texto ? "Cambiar" : "Indicar"}
          </button>
        )}
      </div>
      {distintoDelProveedor && !editando && <p className="mt-1 text-[11px] text-zinc-400">En esta OC. El proveedor tiene cargado: {textoCondicionPago(delProveedor)}</p>}
      {editando && (
        <div className="mt-3 space-y-2">
          <CondicionPagoEditor value={plan} onChange={setPlan} compacto />
          {!delProveedor?.condicion_pago && <p className="text-[11px] text-zinc-500">El proveedor no tiene cargado cómo se le paga: se le va a guardar también a él.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditando(false)} className="rounded-lg border border-zinc-200 px-3 py-1 text-xs dark:border-zinc-700">Cancelar</button>
            <button type="button" onClick={guardar} disabled={guardando} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">
              {guardando && <Loader2 className="h-3 w-3 animate-spin" />} Guardar en la OC
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {aviso && <p className="mt-1 text-xs text-emerald-600">{aviso}</p>}
    </div>
  );
}
