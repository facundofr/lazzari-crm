/**
 * GET /api/email/config
 *
 * Says whether email sending (Resend) is configured. Never returns the key itself.
 */

import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServer();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  return NextResponse.json({
    configurado: !!process.env.RESEND_API_KEY,
    remitente_propio: !!process.env.EMAIL_FROM,
  }, { headers: { "Cache-Control": "no-store" } });
}
