import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";
import { correrAgenteMail } from "@/lib/agente-mail-server";

/**
 * POST /api/agente-mail/ejecutar — botón "Revisar ahora" de la pantalla Mail y cobros.
 * Mismo trabajo que el cron, pero lo pide una persona logueada (admin, super_admin o administrativo).
 * Solo lee Gmail y guarda sugerencias; no registra cobros ni responde mails.
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = (await createSupabaseServer()) as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: perfil } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
  if (!perfil?.active || !["super_admin", "admin", "administrativo"].includes(String(perfil.role))) {
    return NextResponse.json({ error: "Tu usuario no tiene permiso para esto" }, { status: 403 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY) as any;
  // "Volver a leer": borra solo las filas del propio agente que Augusto todavía no marcó como vistas, y las lee de nuevo.
  const cuerpo = await req.json().catch(() => ({}));
  if (cuerpo?.releer) {
    const { error } = await db.from("agente_mail_procesados").delete().is("visto_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const r = await correrAgenteMail(db, "manual");
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
