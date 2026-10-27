// N° de recibo de un cobro recién guardado, para el cartel «Recibo N° … registrado» (auditoría UX 27/10/2026, arreglo 2).
// La base arma el recibo con un trigger al insertar los movimientos (migración 20261019210000): se busca por los movimientos
// del cobro, o por la liquidación FX (cobro en US$). Nunca frena ni falla: si no se puede leer, devuelve [] y el cartel sale sin número.
import { supabase } from "@/lib/supabase/client";

const db = supabase as any;

export async function numerosDeRecibo(origen: { movimientoIds?: string[] | null; liquidacionFxId?: string | null }): Promise<number[]> {
  try {
    let ids = origen.movimientoIds || [];
    if (!ids.length && origen.liquidacionFxId) {
      const { data } = await db.from("movimientos").select("id").eq("liquidacion_fx_id", origen.liquidacionFxId);
      ids = (data || []).map((m: any) => m.id as string);
    }
    if (!ids.length) return [];
    const { data, error } = await db.from("recibo_movimientos").select("movimiento_id, recibos(numero)").in("movimiento_id", ids);
    if (error) return [];
    const numeros = (data || []).map((r: any) => Number((Array.isArray(r.recibos) ? r.recibos[0] : r.recibos)?.numero)).filter((n: number) => Number.isFinite(n));
    return [...new Set<number>(numeros)];
  } catch {
    return [];
  }
}

/** N° de una OP por su id (pago en US$ de la OP). null si no se pudo leer. */
export async function numeroDeOP(opId: string | null | undefined): Promise<string | null> {
  if (!opId) return null;
  try {
    const { data } = await db.from("ordenes_pago").select("numero").eq("id", opId).maybeSingle();
    return data?.numero ? String(data.numero) : null;
  } catch {
    return null;
  }
}
