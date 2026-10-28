import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === "/login";
  const pathname = request.nextUrl.pathname;
  const isPublicAuthFlow = pathname === "/auth/confirm";
  // /api/cotizacion-bna ya no es pública (auditoría 28/10/2026): todas las pantallas que la llaman tienen sesión.
  const isPublicApi = pathname.startsWith("/api/cron/");
  const redirectWithSessionCookies = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  // Public APIs skip all auth checks
  if (isPublicApi) {
    return supabaseResponse;
  }

  // Supabase unreachable — don't treat as "no user"
  const missingSession = authError?.name === "AuthSessionMissingError";
  if (authError && !user && authError.status !== 401 && !missingSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Servicio temporalmente no disponible" }, { status: 503 });
    }
    return supabaseResponse;
  }

  // Not logged in and not on login page
  if (!user && !isLoginPage && !isPublicAuthFlow) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return redirectWithSessionCookies(url);
  }

  // Una cuenta desactivada conserva su perfil para trazabilidad contable, pero
  // no debe seguir operando con una sesión emitida antes de la baja.
  // Sin ficha = no fue invitado por el super_admin: tampoco entra (ni a mirar).
  if (user && !isPublicAuthFlow) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("active")
      .eq("id", user.id)
      .maybeSingle();
    if (!profileError && (!profile || profile.active === false)) {
      await supabase.auth.signOut();
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Usuario inactivo" }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return redirectWithSessionCookies(url);
    }
  }

  // Logged in and on login page -> redirect to Presupuestos (sin Dashboard desde 20/10)
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/presupuestos";
    return redirectWithSessionCookies(url);
  }

  return supabaseResponse;
}
