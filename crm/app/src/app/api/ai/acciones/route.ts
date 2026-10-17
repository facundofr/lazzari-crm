import { NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { deshacerAccion, hacerPropuesta } from "@/lib/ia-acciones-server";

// Asistente que hace cosas, Etapa 1 (solo super_admin): "Hacer" una propuesta, "Deshacer" una acción y la lista "Lo que hizo la IA".
// Todo con la sesión del usuario (RLS). La propuesta se vuelve a validar contra la base antes de guardar.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = (await createSupabaseServer()) as any;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "super_admin") return Response.json({ error: "Por ahora esto lo usa solo Augusto." }, { status: 403 });

    const { data: us } = await supabase.from("user_sociedades").select("sociedad_id").eq("user_id", user.id);
    const sociedades: string[] = (us || []).map((s: { sociedad_id: string }) => s.sociedad_id);
    const sociedadActiva = typeof body.sociedadId === "string" && sociedades.includes(body.sociedadId) ? body.sociedadId : null;

    if (body.op === "hacer") return Response.json(await hacerPropuesta(supabase, body.propuesta, sociedadActiva ? [sociedadActiva] : sociedades, sociedadActiva));
    if (body.op === "deshacer") return Response.json(await deshacerAccion(supabase, String(body.id || ""), user.id));
    if (body.op === "lista") {
      const { data, error } = await supabase.from("ia_acciones").select("id, created_at, resumen, pedido, estado, nota_deshacer")
        .order("created_at", { ascending: false }).limit(30);
      if (error) return Response.json({ acciones: [], aviso: /ia_acciones/.test(error.message) ? "Falta correr la migración ia_acciones." : error.message });
      return Response.json({ acciones: data || [] });
    }
    return Response.json({ error: "Operación desconocida" }, { status: 400 });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
