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

export async function createMovimiento(data: Record<string, unknown>) {
  const { data: result, error } = await supabase.from("movimientos").insert(data as any).select().single();
  if (error) throw error;
  return result;
}

export async function conciliarMovimiento(id: string) {
  const { error } = await supabase.from("movimientos").update({ conciliado: true }).eq("id", id);
  if (error) throw error;
}

export async function deleteMovimiento(id: string) {
  const { error } = await supabase.from("movimientos").delete().eq("id", id);
  if (error) throw error;
}

// ── Gastos fijos ──────────────────────────────────────────────

export async function getGastosFijos() {
  const { data, error } = await supabase
    .from("gastos_fijos")
    .select("*")
    .order("categoria")
    .order("descripcion");
  if (error) throw error;
  return data;
}

export async function createGastoFijo(gasto: Record<string, unknown>) {
  const { data, error } = await supabase.from("gastos_fijos").insert(gasto as any).select().single();
  if (error) throw error;
  return data;
}

export async function updateGastoFijo(id: string, gasto: Record<string, unknown>) {
  const { error } = await supabase.from("gastos_fijos").update(gasto as any).eq("id", id);
  if (error) throw error;
}

export async function deleteGastoFijo(id: string) {
  const { error } = await supabase.from("gastos_fijos").delete().eq("id", id);
  if (error) throw error;
}

// ── Objetivos ─────────────────────────────────────────────────

export async function getObjetivos() {
  const { data, error } = await supabase
    .from("objetivos")
    .select("*, profiles:usuario_id(full_name)")
    .order("periodo_inicio", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createObjetivo(obj: Record<string, unknown>) {
  const { data, error } = await supabase.from("objetivos").insert(obj as any).select().single();
  if (error) throw error;
  return data;
}

export async function updateObjetivo(id: string, obj: Record<string, unknown>) {
  const { error } = await supabase.from("objetivos").update(obj as any).eq("id", id);
  if (error) throw error;
}

export async function deleteObjetivo(id: string) {
  const { error } = await supabase.from("objetivos").delete().eq("id", id);
  if (error) throw error;
}
