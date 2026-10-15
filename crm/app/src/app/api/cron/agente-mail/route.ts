import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { correrAgenteMail } from "@/lib/agente-mail-server";

/**
 * GET /api/cron/agente-mail — lunes a viernes 8:30, 12:30 y 16:00 (hora Argentina).
 * Lee los mails NUEVOS de administracion@ (octubre 2026 en adelante, los ya procesados no se releen), los clasifica y
 * cruza avisos de pago con facturas abiertas. Solo sugiere: no registra cobros ni responde mails.
 * Protegido por CRON_SECRET. Necesita SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY y GMAIL_* en Vercel.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY) as any;
  const r = await correrAgenteMail(db, "cron");
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
