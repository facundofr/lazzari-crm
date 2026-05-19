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
