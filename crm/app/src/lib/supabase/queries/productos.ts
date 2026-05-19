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
