import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

const VALID_ROLES = ["super_admin", "admin", "vendedor", "administrativo", "viewer"];

export async function POST(request: NextRequest) {
  try {
    // Verify the caller is admin/super_admin
    const supabaseUser = await createSupabaseServer();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const { data: profile } = await supabaseUser
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || !["super_admin", "admin"].includes(profile.role)) {
      return Response.json({ error: "No tenés permisos para invitar usuarios" }, { status: 403 });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return Response.json({ error: "Service role key no configurada" }, { status: 500 });
    }

    const { email, nombre, role, sociedad_ids } = await request.json();
    if (!email?.trim()) return Response.json({ error: "Email es obligatorio" }, { status: 400 });
    if (!nombre?.trim()) return Response.json({ error: "Nombre es obligatorio" }, { status: 400 });

    // Validate role
    const validRole = VALID_ROLES.includes(role) ? role : "vendedor";
    // Only super_admin can create super_admin users
    if (validRole === "super_admin" && profile.role !== "super_admin") {
      return Response.json({ error: "Solo super_admin puede crear usuarios super_admin" }, { status: 403 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Invite user — this sends an email with a magic link automatically
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.trim(),
      { data: { full_name: nombre.trim() } }
    );

    if (createError) {
      if (createError.message?.includes("already been registered")) {
        return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
      }
      throw createError;
    }

    if (!newUser.user) throw new Error("No se pudo crear el usuario");

    // Update profile with role and name (trigger creates profile row on user creation)
    // Retry a few times since the trigger may not have fired yet
    let profileUpdated = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update({ role: validRole, full_name: nombre.trim() } as any)
        .eq("id", newUser.user.id);
      if (!profileError) { profileUpdated = true; break; }
      // Wait for trigger to create the profile row
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!profileUpdated) {
      console.error("Could not update profile for new user", newUser.user.id);
    }

    // Assign sociedades if provided
    if (sociedad_ids?.length) {
      const rows = sociedad_ids.map((sid: string) => ({
        user_id: newUser.user!.id,
        sociedad_id: sid,
      }));
      const { error: socError } = await (supabaseAdmin as any).from("user_sociedades").insert(rows);
      if (socError) console.error("Error assigning sociedades:", socError);
    }

    return Response.json({
      success: true,
      user: { id: newUser.user.id, email: newUser.user.email },
    });
  } catch (error: unknown) {
    console.error("Error inviting user:", error);
    const message = error instanceof Error ? error.message : "Error interno";
    return Response.json({ error: message }, { status: 500 });
  }
}
