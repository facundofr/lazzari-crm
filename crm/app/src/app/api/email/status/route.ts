/**
 * GET /api/email/status?resend_id=xxx
 *
 * Checks the delivery status of an email via the Resend API.
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const resendId = req.nextUrl.searchParams.get("resend_id");
  if (!resendId) {
    return NextResponse.json({ error: "resend_id requerido" }, { status: 400 });
  }

  // Auth check
  const supabase = await createSupabaseServer();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY no configurada" }, { status: 500 });
  }

  try {
    const resend = new Resend(resendKey);
    const { data: email, error } = await resend.emails.get(resendId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Map Resend last_event to our status
    const lastEvent = (email as any)?.last_event;
    const status = lastEvent === "delivered" ? "delivered"
      : lastEvent === "bounced" ? "bounced"
      : lastEvent === "complained" ? "complained"
      : lastEvent === "delivery_delayed" ? "delivery_delayed"
      : "sent";

    return NextResponse.json({
      status,
      to: (email as any)?.to,
      subject: (email as any)?.subject,
      created_at: (email as any)?.created_at,
      last_event: lastEvent,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error consultando Resend" }, { status: 500 });
  }
}
