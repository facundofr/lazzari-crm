import { supabase } from "../client";

export async function getProductos() {
  const { data, error } = await supabase
    .from("productos")
    .select(`
      *,
      proveedores(razon_social)
    `)
    .order("codigo");
  if (error) throw error;
  return data;
}

export async function getStockAlertas() {
  const { data, error } = await supabase
    .from("v_stock_alertas")
    .select("*");
  if (error) throw error;
  return data;
}

export async function searchProductos(query: string) {
  const { data, error } = await supabase
    .from("productos")
    .select("*")
    .or(`codigo.ilike.%${query}%,nombre.ilike.%${query}%`)
    .eq("activo", true)
    .limit(20);
  if (error) throw error;
  return data;
}

export async function createProducto(data: Record<string, unknown>) {
  const { data: result, error } = await supabase
    .from("productos")
    .insert(data as any)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function updateProducto(id: string, data: Record<string, unknown>) {
  const { data: result, error } = await supabase
    .from("productos")
    .update(data as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function deleteProducto(id: string) {
  const { error } = await supabase.from("productos").delete().eq("id", id);
  if (error) throw error;
}

export async function updateStock(id: string, cantidad: number, operacion: "add" | "set") {
  if (operacion === "set") {
    const { error } = await supabase.from("productos").update({ stock: cantidad }).eq("id", id);
    if (error) throw error;
  } else {
    // Atomic increment via RPC — no read-then-write race condition
    const { error } = await (supabase as any).rpc("increment_stock", { producto_id: id, cantidad });
    if (error) throw error;
  }
}
