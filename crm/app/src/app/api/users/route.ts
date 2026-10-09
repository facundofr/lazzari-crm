import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

const VALID_ROLES = ["super_admin", "admin", "vendedor", "administrativo", "viewer"] as const;

async function getAdminContext() {
  const callerClient = await createSupabaseServer();
  const { data: { user } } = await callerClient.auth.getUser();
  if (!user) return { error: Response.json({ error: "No autenticado" }, { status: 401 }) };
  const { data: profile } = await callerClient.from("profiles").select("role, active").eq("id", user.id).single();
  if (!profile || profile.active === false || !["super_admin", "admin"].includes(profile.role)) {
    return { error: Response.json({ error: "No tenés permisos para administrar usuarios" }, { status: 403 }) };
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { error: Response.json({ error: "Service role key no configurada" }, { status: 500 }) };
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return { user, profile, admin };
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await getAdminContext();
    if (context.error) return context.error;
    const { id, full_name, role } = await request.json();
    if (!id) return Response.json({ error: "Falta el usuario" }, { status: 400 });
    if (role && !VALID_ROLES.includes(role)) return Response.json({ error: "Rol inválido" }, { status: 400 });
    if (role === "super_admin" && context.profile!.role !== "super_admin") {
      return Response.json({ error: "Solo un super admin puede asignar ese rol" }, { status: 403 });
    }
    const { data: target } = await context.admin!.from("profiles").select("role").eq("id", id).single();
    if (!target) return Response.json({ error: "Usuario inexistente" }, { status: 404 });
    if (target.role === "super_admin" && context.profile!.role !== "super_admin") {
      return Response.json({ error: "Solo un super admin puede modificar a otro super admin" }, { status: 403 });
    }
    const changes: Record<string, string> = {};
    if (typeof full_name === "string") {
      if (!full_name.trim()) return Response.json({ error: "El nombre no puede quedar vacío" }, { status: 400 });
      changes.full_name = full_name.trim();
    }
    if (role) changes.role = role;
    if (!Object.keys(changes).length) return Response.json({ error: "No hay cambios" }, { status: 400 });

    const { error } = await context.admin!.from("profiles").update(changes).eq("id", id);
    if (error) throw error;
    if (changes.full_name) {
      const { error: metadataError } = await context.admin!.auth.admin.updateUserById(id, { user_metadata: { full_name: changes.full_name } });
      if (metadataError) throw metadataError;
    }
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const context = await getAdminContext();
    if (context.error) return context.error;
    const { id } = await request.json();
    if (!id) return Response.json({ error: "Falta el usuario" }, { status: 400 });
    if (id === context.user!.id) return Response.json({ error: "No podés eliminar tu propio usuario" }, { status: 400 });
    const { data: target } = await context.admin!.from("profiles").select("role").eq("id", id).single();
    if (!target) return Response.json({ error: "Usuario inexistente" }, { status: 404 });
    if (target.role === "super_admin" && context.profile!.role !== "super_admin") {
      return Response.json({ error: "Solo un super admin puede eliminar a otro super admin" }, { status: 403 });
    }

    const { error: deleteError } = await context.admin!.auth.admin.deleteUser(id);
    if (!deleteError) return Response.json({ success: true, mode: "deleted" });

    // Si existen movimientos históricos con FK restrictiva, se revoca el acceso
    // y se oculta el usuario sin borrar su trazabilidad contable.
    const { error: disableError } = await context.admin!.from("profiles").update({ active: false, role: "viewer" }).eq("id", id);
    if (disableError) throw deleteError;
    const { error: banError } = await context.admin!.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    if (banError) throw banError;
    return Response.json({ success: true, mode: "disabled" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error interno" }, { status: 500 });
  }
}
