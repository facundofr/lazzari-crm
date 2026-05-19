import { supabase } from "../client";

export async function getMovimientos() {
  const { data, error } = await supabase
    .from("movimientos")
    .select(`
      *,
      clientes(razon_social),
      proveedores(razon_social),
      facturas(tipo, punto_venta, numero)
    `)
    .order("fecha", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getCCClientes() {
  const { data, error } = await supabase
    .from("v_cuenta_corriente_clientes")
    .select("*");
  if (error) throw error;
  return data;
}

export async function getCCProveedores() {
  const { data, error } = await supabase
    .from("v_cuenta_corriente_proveedores")
    .select("*");
  if (error) throw error;
  return data;
}

export async function getExtractos() {
  const { data, error } = await supabase
    .from("extractos_bancarios")
    .select(`
      *,
      extracto_movimientos(*)
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getLineasCredito() {
  const { data, error } = await supabase
    .from("lineas_credito")
    .select(`
      *,
      proveedores(razon_social)
    `)
    .order("vencimiento");
  if (error) throw error;
  return data;
}
