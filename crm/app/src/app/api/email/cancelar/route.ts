/**
 * POST /api/email/cancelar   body: { id }   (id de mails_enviados)
 *
 * Mails programados (Augusto 29/10/2026): cancela en Resend un mail que todavía no salió y lo anota como "cancelado".
 * Puede cancelarlo quien lo programó, o admin / super admin / administrativo.
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = (await createSupabaseServer()) as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "RESEND_API_KEY no configurada" }, { status: 500 });

  let id = "";
  try { id = String((await req.json())?.id || ""); } catch { /* sin cuerpo */ }
  if (!id) return NextResponse.json({ error: "Falta el mail a cancelar" }, { status: 400 });

  const { data: m } = await supabase.from("mails_enviados").select("id, enviado_por, resend_id, estado, enviado_at").eq("id", id).maybeSingle();
  if (!m) return NextResponse.json({ error: "No se encontró el mail" }, { status: 404 });
  if (m.estado !== "programado") return NextResponse.json({ error: "Ese mail no está programado" }, { status: 400 });
  if (m.enviado_por !== user.id) {
    const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (!["admin", "super_admin", "administrativo"].includes(perfil?.role)) return NextResponse.json({ error: "Solo lo puede cancelar quien lo programó" }, { status: 403 });
  }
  if (!m.resend_id) return NextResponse.json({ error: "El mail no tiene id de Resend" }, { status: 400 });

  const { error } = await new Resend(resendKey).emails.cancel(m.resend_id);
  if (error) return NextResponse.json({ error: `No se pudo cancelar: ${error.message}` }, { status: 500 });
  const ahora = new Date().toISOString();
  await supabase.from("mails_enviados").update({ estado: "cancelado", estado_at: ahora, verificado_at: ahora }).eq("id", id);
  return NextResponse.json({ ok: true });
}
