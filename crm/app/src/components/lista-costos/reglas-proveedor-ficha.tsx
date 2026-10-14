"use client";

/**
 * Ficha del proveedor > "Reglas comerciales" de su lista de costos (solo para ver).
 * El proveedor del CRM se une con el nombre de la lista por catalogo_proveedores; si no hay vínculo, por nombre de fantasía.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { normalizarProveedor } from "@/components/presupuestos/catalogo-picker";
import { useReglasCostos } from "./reglas-datos";
import { DetalleRegla } from "./regla-info";

const db = supabase as any;

export function ReglasProveedorFicha({ proveedorId, nombres }: { proveedorId: string; nombres: string[] }) {
  const datos = useReglasCostos();
  const [vinculadas, setVinculadas] = useState<string[] | null>(null);
  useEffect(() => {
    let vivo = true;
    setVinculadas(null);
    db.from("catalogo_proveedores").select("proveedor_lista").eq("proveedor_id", proveedorId)
      .then(({ data }: any) => { if (vivo) setVinculadas([...new Set<string>((data || []).map((v: any) => v.proveedor_lista))]); }, () => { if (vivo) setVinculadas([]); });
    return () => { vivo = false; };
  }, [proveedorId]);

  const normNombres = nombres.map(normalizarProveedor).filter(Boolean);
  const listas = (vinculadas?.length ? vinculadas : Object.keys(datos.reglas).filter((k) => normNombres.includes(normalizarProveedor(k))))
    .filter((k) => datos.reglas[k] || datos.opcionales[k]?.length);
  if (!listas.length) return null;

  return (
    <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <h3 className="mb-2 text-sm font-semibold">Reglas comerciales <span className="text-[11px] font-normal text-zinc-400">(lista de costos · solo aviso)</span></h3>
      <div className="space-y-3">
        {listas.map((k) => (
          <div key={k} className="rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800">
            <p className="mb-1 text-xs font-semibold">Lista «{k}»</p>
            <DetalleRegla proveedor={k} datos={datos} />
          </div>
        ))}
      </div>
    </div>
  );
}
