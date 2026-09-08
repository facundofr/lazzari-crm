import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

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

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Create user with Supabase Admin API
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      email_confirm: true,
      user_metadata: { nombre: nombre.trim() },
    });

    if (createError) {
      if (createError.message?.includes("already been registered")) {
        return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
      }
      throw createError;
    }

    if (!newUser.user) throw new Error("No se pudo crear el usuario");

    // Update profile with role and name
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ role: role || "vendedor", nombre: nombre.trim() })
      .eq("id", newUser.user.id);
    if (profileError) console.error("Error updating profile:", profileError);

    // Assign sociedades if provided
    if (sociedad_ids?.length) {
      const rows = sociedad_ids.map((sid: string) => ({
        user_id: newUser.user!.id,
        sociedad_id: sid,
      }));
      await supabaseAdmin.from("user_sociedades").insert(rows);
    }

    // Send password reset email so the user can set their password
    const { error: resetError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: email.trim(),
    });
    if (resetError) console.error("Error sending reset link:", resetError);

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
