import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { cuitLimpio } from "@/lib/bcra";
import { consultarBCRA } from "@/lib/bcra-server";

/**
 * GET /api/bcra/preview?cuit=XXXXXXXXXXX
 * Consulta la Central de Deudores para un CUIT SIN guardar nada (alta de cliente).
 * Solo para usuarios con sesión.
 */
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const cuit = cuitLimpio(req.nextUrl.searchParams.get("cuit"));
  if (!cuit) return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });

  const r = await consultarBCRA(cuit);
  return NextResponse.json({
    semaforo: r.semaforo,
    peor_situacion: r.peor_situacion,
    deuda_total: r.deuda_total,
    entidades: r.entidades,
    cheques_sin_pagar: r.cheques_sin_pagar,
    error: r.error,
  });
}
