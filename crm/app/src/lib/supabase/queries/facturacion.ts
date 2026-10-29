import { supabase } from "../client";

export async function getFacturas() {
  const { data, error } = await supabase
    .from("facturas")
    .select(`
      *,
      clientes(razon_social, cuit)
    `)
    .order("fecha", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getRemitos() {
  const { data, error } = await supabase
    .from("remitos")
    .select(`
      *,
      clientes(razon_social),
      remito_items(*)
    `)
    .order("fecha", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createFactura(data: Record<string, unknown>) {
  const { data: result, error } = await supabase.from("facturas").insert(data as any).select().single();
  if (error) throw error;
  return result;
}

/** Anula una factura sin CAE con la función de la base (auditoría H31): cobros a favor del cliente y PR a "facturar". */
export async function anularFactura(id: string) {
  const { error } = await (supabase as any).rpc("gestionar_factura_manual", { p_factura_id: id, p_accion: "anular" });
  if (error) throw error;
}

export async function createRemito(data: Record<string, unknown>) {
  const { data: result, error } = await supabase.from("remitos").insert(data as any).select().single();
  if (error) throw error;
  return result;
}

export async function updateRemitoEstado(id: string, estado: string) {
  const { error } = await supabase.from("remitos").update({ estado } as any).eq("id", id);
  if (error) throw error;
}
