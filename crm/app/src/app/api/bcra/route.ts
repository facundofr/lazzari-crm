import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { cuitLimpio } from "@/lib/bcra";
import { actualizarInformeCliente } from "@/lib/bcra-server";

/**
 * POST /api/bcra  { sociedad_id, cliente_id }
 * Consulta la Central de Deudores del BCRA para el CUIT del cliente y guarda el informe del mes.
 * Usa la sesión del usuario: solo puede consultar clientes de sus sociedades.
 */
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clienteId = String(body?.cliente_id || "");
  const sociedadId = String(body?.sociedad_id || "");
  if (!clienteId || !sociedadId) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const db = supabase as any;
  const { data: cliente, error } = await db.from("clientes").select("id, cuit, razon_social, sociedad_id").eq("id", clienteId).eq("sociedad_id", sociedadId).maybeSingle();
  if (error || !cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  const cuit = cuitLimpio(cliente.cuit);
  if (!cuit) return NextResponse.json({ error: "El cliente no tiene un CUIT válido de 11 números" }, { status: 400 });

  try {
    const r = await actualizarInformeCliente(db, { sociedad_id: sociedadId, cliente_id: clienteId, cuit, razon_social: cliente.razon_social });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo guardar el informe" }, { status: 500 });
  }
}
