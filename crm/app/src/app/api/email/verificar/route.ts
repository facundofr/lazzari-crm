/**
 * POST /api/email/verificar   body: { todos?: boolean }
 *
 * Correos enviados (Augusto 28/10/2026): le pregunta a Resend el estado de los mails que todavía no tienen estado
 * final (enviado / demorado, de los últimos 7 días) y lo anota en mails_enviados. Si uno rebotó o lo marcaron como
 * spam, avisa en la campana a quien lo mandó (una sola vez). Nunca frena nada.
 * Por defecto mira los mails del usuario que entró; con `todos` (solo admin / super admin) mira los de todos.
 * Lo llaman la pantalla Correos enviados y el encabezado (cada 10 minutos mientras se usa el CRM).
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServer } from "@/lib/supabase/server";
import { estadoDesdeResend, hayQueVerificar, avisoRebote, type EstadoMail } from "@/lib/correos-enviados";

export const maxDuration = 60;

const POR_VEZ = 15;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const supabase = (await createSupabaseServer()) as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "RESEND_API_KEY no configurada" }, { status: 500 });

  let todos = false;
  try { todos = Boolean((await req.json())?.todos); } catch { /* sin cuerpo */ }
  if (todos) {
    const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    todos = perfil?.role === "admin" || perfil?.role === "super_admin";
  }

  const desde = new Date(Date.now() - 7 * 86400000).toISOString();
  let q = supabase.from("mails_enviados")
    .select("id, enviado_at, enviado_por, sociedad_id, enviado_a, documento_tipo, documento_nombre, resend_id, estado, verificado_at, aviso_rebote")
    .in("estado", ["enviado", "demorado", "programado"]).not("resend_id", "is", null).gte("enviado_at", desde)
    .order("enviado_at", { ascending: false }).limit(100);
  if (!todos) q = q.eq("enviado_por", user.id);
  const { data: filas, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const resend = new Resend(resendKey);
  const aMirar = (filas || []).filter((m: any) => hayQueVerificar(m)).slice(0, POR_VEZ);
  let cambiados = 0, avisos = 0;
  for (const [i, m] of aMirar.entries()) {
    if (i > 0) await esperar(550); // Resend admite 2 consultas por segundo
    let estado: EstadoMail = m.estado;
    try {
      const { data } = await resend.emails.get(m.resend_id);
      estado = estadoDesdeResend((data as any)?.last_event);
    } catch { /* se vuelve a intentar la próxima vez */ }
    const ahora = new Date().toISOString();
    const cambios: Record<string, unknown> = { verificado_at: ahora };
    if (estado !== m.estado) { cambios.estado = estado; cambios.estado_at = ahora; cambiados++; }
    const avisar = (estado === "rebotado" || estado === "spam") && !m.aviso_rebote;
    if (avisar) cambios.aviso_rebote = true;
    await supabase.from("mails_enviados").update(cambios).eq("id", m.id);
    if (avisar && m.enviado_por) {
      const { title, description } = avisoRebote({ ...m, estado });
      const { error: errAviso } = await supabase.from("alertas").insert({
        tipo: "seguimiento", title, description, module: "correos",
        entity_type: "mail_enviado", entity_id: m.id, user_id: m.enviado_por, sociedad_id: m.sociedad_id, read: false,
      });
      if (!errAviso) avisos++;
    }
  }

  return NextResponse.json({ revisados: aMirar.length, cambiados, avisos, quedan: Math.max(0, (filas || []).filter((m: any) => hayQueVerificar(m)).length - aMirar.length) }, { headers: { "Cache-Control": "no-store" } });
}
