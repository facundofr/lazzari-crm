import { supabase } from "../client";

export async function getClientes() {
  const { data, error } = await supabase
    .from("clientes")
    .select(`
      *,
      assigned_profile:assigned_to(full_name),
      contactos(*)
    `)
    .order("razon_social");
  if (error) throw error;
  return data;
}

export async function getClienteById(id: string) {
  const { data, error } = await supabase
    .from("clientes")
    .select(`
      *,
      assigned_profile:assigned_to(full_name, email),
      contactos(*),
      cliente_sucursales(*),
      presupuestos(id, numero, fecha, total, estado, moneda),
      facturas(id, tipo, punto_venta, numero, fecha, total, estado),
      remitos(id, numero, fecha, estado)
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getClienteStats() {
  const { data, error } = await supabase
    .from("clientes")
    .select("id, activo, saldo_cuenta_corriente, limite_credito");
  if (error) throw error;

  return {
    total: data.length,
    activos: data.filter((c) => c.activo).length,
    saldoTotal: data.reduce((sum, c) => sum + Number(c.saldo_cuenta_corriente), 0),
    creditoTotal: data.reduce((sum, c) => sum + Number(c.limite_credito), 0),
  };
}

export async function createCliente(data: Record<string, unknown>) {
  const { data: result, error } = await supabase
    .from("clientes")
    .insert(data as any)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function updateCliente(id: string, data: Record<string, unknown>) {
  const { data: result, error } = await supabase
    .from("clientes")
    .update(data as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function deleteCliente(id: string) {
  const { error } = await supabase
    .from("clientes")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function toggleClienteActivo(id: string, activo: boolean) {
  const { error } = await supabase
    .from("clientes")
    .update({ activo })
    .eq("id", id);
  if (error) throw error;
}
