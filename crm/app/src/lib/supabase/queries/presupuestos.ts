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

export async function createPresupuesto(data: Record<string, unknown>) {
  const { data: result, error } = await supabase
    .from("presupuestos")
    .insert(data as any)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function updatePresupuesto(id: string, data: Record<string, unknown>) {
  const { data: result, error } = await supabase
    .from("presupuestos")
    .update(data as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function updatePresupuestoEstado(id: string, estado: string, motivo_rechazo?: string) {
  const update: Record<string, unknown> = { estado };
  if (motivo_rechazo) update.motivo_rechazo = motivo_rechazo;
  if (estado === "pendiente") update.enviado_at = new Date().toISOString();
  if (["aprobado", "rechazado", "postergado"].includes(estado)) update.respondido_at = new Date().toISOString();

  const { data: result, error } = await supabase
    .from("presupuestos")
    .update(update as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function deletePresupuesto(id: string) {
  const { error } = await supabase
    .from("presupuestos")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function addPresupuestoItem(presupuestoId: string, item: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("presupuesto_items")
    .insert({ ...item, presupuesto_id: presupuestoId } as any)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePresupuestoItem(id: string, data: Record<string, unknown>) {
  const { data: result, error } = await supabase
    .from("presupuesto_items")
    .update(data as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function deletePresupuestoItem(id: string) {
  const { error } = await supabase
    .from("presupuesto_items")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function duplicatePresupuesto(id: string) {
  const original = await getPresupuestoById(id);
  if (!original) throw new Error("Presupuesto no encontrado");

  const { id: _id, numero: _num, created_at: _ca, updated_at: _ua, enviado_at: _ea, respondido_at: _ra, presupuesto_items, clientes: _cl, created_by_profile: _cbp, ...rest } = original as Record<string, unknown> & { presupuesto_items?: Record<string, unknown>[] };

  const { data: newPR, error } = await supabase
    .from("presupuestos")
    .insert({ ...rest, estado: "pendiente", version: 1 } as any)
    .select()
    .single();
  if (error) throw error;

  if (presupuesto_items && presupuesto_items.length > 0) {
    // precio_venta, subtotal, iva, total are GENERATED columns — strip them
    const items = presupuesto_items.map(({ id: _iid, presupuesto_id: _pid, created_at: _ica, precio_venta: _pv, subtotal: _st, iva: _iv, total: _t, ...itemRest }) => ({
      ...itemRest,
      presupuesto_id: newPR.id,
    }));
    await supabase.from("presupuesto_items").insert(items as any);
  }

  return newPR;
}
