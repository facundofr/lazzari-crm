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
  const isPublicApi = pathname.startsWith("/api/cron/") || pathname === "/api/cotizacion-bna" || pathname === "/api/migrate-numeracion";

  // Public APIs skip all auth checks
  if (isPublicApi) {
    return supabaseResponse;
  }

  // Supabase unreachable — don't treat as "no user"
  if (authError && !user && authError.status !== 401) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Servicio temporalmente no disponible" }, { status: 503 });
    }
    return supabaseResponse;
  }

  // Not logged in and not on login page
  if (!user && !isLoginPage) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Logged in and on login page -> redirect to dashboard
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
