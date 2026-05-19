import { supabase } from "../client";

export async function getPresupuestos() {
  const { data, error } = await supabase
    .from("presupuestos")
    .select(`
      *,
      clientes(razon_social, cuit),
      created_by_profile:created_by(full_name)
    `)
    .order("fecha", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getPresupuestoById(id: string) {
  const { data, error } = await supabase
    .from("presupuestos")
    .select(`
      *,
      clientes(razon_social, cuit, condicion_iva, email, direccion, localidad, provincia),
      created_by_profile:created_by(full_name, email),
      presupuesto_items(*)
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getPresupuestosStats() {
  const { data, error } = await supabase
    .from("presupuestos")
    .select("estado, total");
  if (error) throw error;

  const byEstado: Record<string, { count: number; total: number }> = {};
  data.forEach((p) => {
    if (!byEstado[p.estado]) byEstado[p.estado] = { count: 0, total: 0 };
    byEstado[p.estado].count++;
    byEstado[p.estado].total += Number(p.total);
  });
  return byEstado;
}
