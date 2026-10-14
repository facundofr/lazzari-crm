/**
 * Reglas de la lista de costos (proveedor_reglas, proveedor_descuentos_opcionales, margenes_venta, lista_costos_config).
 * Se traen UNA vez por sesión (son pocas filas) y se comparten entre Proveedores y el presupuesto.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { DescuentoOpcional, MargenVenta, RedondeoConfig, ReglaProveedor } from "@/lib/lista-costos";

const db = supabase as any;

export interface ReglasCostos {
  reglas: Record<string, ReglaProveedor>;
  opcionales: Record<string, DescuentoOpcional[]>;
  margenes: MargenVenta[];
  redondeo: RedondeoConfig | null;
}

const VACIO: ReglasCostos = { reglas: {}, opcionales: {}, margenes: [], redondeo: null };
let cache: Promise<ReglasCostos> | null = null;

export function traerReglasCostos(): Promise<ReglasCostos> {
  if (cache) return cache;
  cache = (async () => {
    const [r, o, m, c] = await Promise.all([
      db.from("proveedor_reglas").select("proveedor_lista, moneda, vigencia_texto, vigencia_hasta, desc1, desc2, en_cascada, como_se_calcula, condiciones"),
      db.from("proveedor_descuentos_opcionales").select("proveedor_lista, tipo, porcentaje, monto_minimo, condicion, requiere_autorizacion, activo").eq("activo", true),
      db.from("margenes_venta").select("orden, rubro, margen, aplica_a").order("orden"),
      db.from("lista_costos_config").select("clave, valor").eq("clave", "redondeo").maybeSingle(),
    ]);
    // Si las tablas no existen o falla, la pantalla sigue andando sin reglas (solo aviso, nunca traba).
    const reglas: Record<string, ReglaProveedor> = {};
    for (const x of r.data || []) reglas[x.proveedor_lista] = { ...x, desc1: x.desc1 == null ? null : Number(x.desc1), desc2: x.desc2 == null ? null : Number(x.desc2) };
    const opcionales: Record<string, DescuentoOpcional[]> = {};
    for (const x of o.data || []) (opcionales[x.proveedor_lista] ||= []).push({ ...x, porcentaje: Number(x.porcentaje), monto_minimo: x.monto_minimo == null ? null : Number(x.monto_minimo) });
    const margenes = (m.data || []).map((x: any) => ({ ...x, margen: Number(x.margen) }));
    return { reglas, opcionales, margenes, redondeo: c.data?.valor || null };
  })();
  cache.catch(() => { cache = null; });
  return cache;
}

export function useReglasCostos(activo = true): ReglasCostos {
  const [datos, setDatos] = useState<ReglasCostos>(VACIO);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    traerReglasCostos().then((d) => { if (vivo) setDatos(d); }, () => {});
    return () => { vivo = false; };
  }, [activo]);
  return datos;
}

/** URL pública de la foto (bucket "productos"). */
export function urlFoto(path: string | null | undefined): string | null {
  if (!path) return null;
  return db.storage.from("productos").getPublicUrl(path).data?.publicUrl || null;
}
