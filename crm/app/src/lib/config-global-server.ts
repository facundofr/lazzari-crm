import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";

// Ajustes que elige Augusto y valen para todos (orden del menú, diseño nuevo): una fila de `configuracion`
// sin sociedad. Se leen y guardan del lado del servidor para que no dependan de las reglas de la tabla.

/** Rol del usuario logueado y activo, o null. */
export async function rolDelUsuario(): Promise<string | null> {
  const supabase = (await createSupabaseServer()) as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
  return perfil?.active ? String(perfil.role) : null;
}

function base() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;
}

export async function leerConfigGlobal(clave: string): Promise<unknown> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data } = await base().from("configuracion").select("value").eq("key", clave).is("sociedad_id", null).maybeSingle();
  return data?.value ?? null;
}

export async function guardarConfigGlobal(clave: string, valor: unknown): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return "Falta SUPABASE_SERVICE_ROLE_KEY";
  const db = base();
  // La fila no tiene sociedad: el índice único (sociedad_id, key) no la encuentra con upsert, así que se busca y se actualiza o se crea.
  const { data: fila } = await db.from("configuracion").select("id").eq("key", clave).is("sociedad_id", null).maybeSingle();
  const { error } = fila
    ? await db.from("configuracion").update({ value: valor, updated_at: new Date().toISOString() }).eq("id", fila.id)
    : await db.from("configuracion").insert({ key: clave, value: valor, sociedad_id: null });
  return error?.message ?? null;
}
