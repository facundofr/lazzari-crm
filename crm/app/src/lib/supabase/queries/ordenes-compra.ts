import { supabase } from "../client";

export async function getOrdenesCompra() {
  const { data, error } = await supabase
    .from("v_ordenes_compra_progreso")
    .select("*")
    .order("fecha", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getOrdenCompraById(id: string) {
  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(`
      *,
      proveedores(razon_social, email, telefono),
      created_by_profile:created_by(full_name),
      orden_compra_items(*)
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createOrdenCompra(data: Record<string, unknown>) {
  const { data: result, error } = await supabase.from("ordenes_compra").insert(data as any).select().single();
  if (error) throw error;
  return result;
}

export async function updateOrdenCompra(id: string, data: Record<string, unknown>) {
  const { data: result, error } = await supabase.from("ordenes_compra").update(data as any).eq("id", id).select().single();
  if (error) throw error;
  return result;
}

export async function updateRecepcion(itemId: string, cantidadRecibida: number) {
  const { error } = await supabase.from("orden_compra_items").update({ cantidad_recibida: cantidadRecibida }).eq("id", itemId);
  if (error) throw error;
}

export async function cancelOrdenCompra(id: string) {
  const { error } = await supabase.from("ordenes_compra").update({ estado: "cancelada" }).eq("id", id);
  if (error) throw error;
}
