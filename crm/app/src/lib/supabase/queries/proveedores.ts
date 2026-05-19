import { supabase } from "../client";

export async function getProveedores() {
  const { data, error } = await supabase
    .from("proveedores")
    .select(`
      *,
      contactos(*),
      listas_precios(id, nombre, moneda, vigencia_hasta, estado)
    `)
    .order("razon_social");
  if (error) throw error;
  return data;
}

export async function getListasPrecios() {
  const { data, error } = await supabase
    .from("listas_precios")
    .select(`
      *,
      proveedores(razon_social),
      lista_precios_items(*)
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getComparadorPrecios() {
  const { data, error } = await supabase
    .from("v_comparador_precios")
    .select("*");
  if (error) throw error;
  return data;
}
