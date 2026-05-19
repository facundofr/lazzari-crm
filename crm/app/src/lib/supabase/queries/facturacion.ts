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
