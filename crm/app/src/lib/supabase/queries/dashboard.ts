import { supabase } from "../client";

export async function getDashboardKPIs() {
  const { data, error } = await supabase.rpc("get_dashboard_kpis");
  if (error) throw error;
  return data as Record<string, number>;
}

export async function getPresupuestosPorEstado() {
  const { data, error } = await supabase
    .from("presupuestos")
    .select("estado");
  if (error) throw error;

  const counts: Record<string, number> = {};
  data.forEach((p) => {
    counts[p.estado] = (counts[p.estado] || 0) + 1;
  });
  return counts;
}

export async function getRecentActivity(limit = 10) {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*, profiles:user_id(full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getAlertas() {
  const { data, error } = await supabase
    .from("alertas")
    .select("*")
    .eq("read", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getTopClientes(limit = 5) {
  const { data, error } = await supabase
    .from("facturas")
    .select("cliente_id, clientes(razon_social), total")
    .neq("estado", "anulada");
  if (error) throw error;

  const totals: Record<string, { nombre: string; facturado: number }> = {};
  data.forEach((f: any) => {
    const id = f.cliente_id;
    if (!totals[id]) {
      totals[id] = { nombre: f.clientes?.razon_social || "N/A", facturado: 0 };
    }
    totals[id].facturado += Number(f.total);
  });

  return Object.values(totals)
    .sort((a, b) => b.facturado - a.facturado)
    .slice(0, limit);
}
