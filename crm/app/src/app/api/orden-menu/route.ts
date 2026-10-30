import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";
import { CLAVE_ORDEN_MENU, ordenValido } from "@/lib/orden-menu";

/**
 * /api/orden-menu — orden del menú que elige Augusto (lib/orden-menu.ts).
 * GET: cualquier usuario logueado (todos ven el mismo orden). PUT: solo super_admin; `{ orden: null }` vuelve al de fábrica.
 * Solo guarda el orden (lista de rutas): los permisos de cada pantalla no cambian.
 * Se lee y guarda del lado del servidor para que el permiso no dependa de las reglas de la tabla `configuracion`.
 */

async function usuario() {
  const supabase = (await createSupabaseServer()) as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
  return perfil?.active ? { role: String(perfil.role) } : null;
}

function base() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;
}

export async function GET() {
  if (!(await usuario())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ orden: null });
  const { data } = await base().from("configuracion").select("value").eq("key", CLAVE_ORDEN_MENU).is("sociedad_id", null).maybeSingle();
  return NextResponse.json({ orden: ordenValido(data?.value) });
}

export async function PUT(req: Request) {
  const u = await usuario();
  if (!u) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (u.role !== "super_admin") return NextResponse.json({ error: "Solo Augusto puede ordenar el menú" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  const cuerpo = await req.json().catch(() => ({}));
  const orden = ordenValido(cuerpo?.orden);
  if (cuerpo?.orden !== null && !orden) return NextResponse.json({ error: "Orden inválido" }, { status: 400 });
  // Volver al de fábrica guarda una lista vacía (la fila queda, sin borrar nada).
  const valor = orden ?? [];
  const db = base();
  // La fila no tiene sociedad: el índice único (sociedad_id, key) no la encuentra con upsert, así que se busca y se actualiza o se crea.
  const { data: fila } = await db.from("configuracion").select("id").eq("key", CLAVE_ORDEN_MENU).is("sociedad_id", null).maybeSingle();
  const { error } = fila
    ? await db.from("configuracion").update({ value: valor, updated_at: new Date().toISOString() }).eq("id", fila.id)
    : await db.from("configuracion").insert({ key: CLAVE_ORDEN_MENU, value: valor, sociedad_id: null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orden });
}
