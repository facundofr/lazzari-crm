import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

const ALLOWED_TYPES = new Set<EmailOtpType>(["invite"]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type") as EmailOtpType | null;
  const rawNext = url.searchParams.get("next") || "/auth/aceptar-invitacion";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/auth/aceptar-invitacion";

  if (!tokenHash || !rawType || !ALLOWED_TYPES.has(rawType)) {
    return NextResponse.redirect(new URL("/login?error=invite_invalid", url.origin));
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    type: rawType,
    token_hash: tokenHash,
  });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=invite_expired", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
