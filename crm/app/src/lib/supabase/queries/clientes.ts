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
