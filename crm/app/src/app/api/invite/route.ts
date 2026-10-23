import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { Resend } from "resend";
import { createSupabaseServer } from "@/lib/supabase/server";
import { isValidEmail, normalizeEmail } from "@/lib/email";

const VALID_ROLES = ["super_admin", "admin", "vendedor", "administrativo", "viewer"];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char] || char);
}

export async function POST(request: NextRequest) {
  try {
    // Solo el super_admin (Augusto) invita usuarios
    const supabaseUser = await createSupabaseServer();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const { data: profile } = await supabaseUser
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .single();
    if (!profile || profile.active === false || profile.role !== "super_admin") {
      return Response.json({ error: "Solo el super admin puede invitar usuarios" }, { status: 403 });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return Response.json({ error: "Service role key no configurada" }, { status: 500 });
    }

    const { email: rawEmail, nombre, role, sociedad_ids, password } = await request.json();
    const conPassword = typeof password === "string" && password.length > 0;
    if (conPassword && password.length < 8) return Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    const email = normalizeEmail(rawEmail);
    if (!email) return Response.json({ error: "Email es obligatorio" }, { status: 400 });
    if (!isValidEmail(email)) return Response.json({ error: "El email no tiene un formato válido" }, { status: 400 });
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
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
    );

    // Supabase's automatic mailer can reject an otherwise valid company address
    // after already creating the auth user. Generate the invite token separately and
    // send it through the same verified Resend account used by the CRM instead.
    let existingUser = null;
    const perPage = 200;
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      existingUser = data.users.find((candidate) => normalizeEmail(candidate.email) === email) || null;
      if (existingUser || data.users.length < perPage) break;
    }
    if (existingUser?.email_confirmed_at) {
      return Response.json({ error: "Ya existe un usuario confirmado con ese email" }, { status: 409 });
    }

    // Con contraseña: el usuario queda creado y activo, sin mail de invitación.
    let invitedUser: { id: string } | null = null;
    let tokenHash: string | undefined;
    if (conPassword) {
      if (existingUser) {
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, { password, email_confirm: true, user_metadata: { full_name: nombre.trim() } });
        if (error) throw error;
        invitedUser = data.user;
      } else {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: nombre.trim() } });
        if (error) throw error;
        invitedUser = data.user;
      }
      if (!invitedUser) throw new Error("No se pudo crear el usuario");
    } else {
      const { data: inviteData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { data: { full_name: nombre.trim() } },
      });
      if (linkError) throw linkError;
      invitedUser = inviteData.user || existingUser;
      tokenHash = inviteData.properties?.hashed_token;
      if (!invitedUser || !tokenHash) throw new Error("No se pudo generar la invitación");
    }

    // Upsert instead of assuming the auth trigger has already finished. This also
    // repairs users left half-created by the previous mailer flow.
    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: invitedUser.id,
      email,
      full_name: nombre.trim(),
      role: validRole,
      active: true,
    } as any, { onConflict: "id" });
    if (profileError) throw profileError;

    // An empty selection intentionally means unrestricted (all sociedades).
    const uniqueSociedadIds = Array.isArray(sociedad_ids)
      ? [...new Set(sociedad_ids.filter((sid): sid is string => typeof sid === "string" && sid.length > 0))]
      : [];
    const { error: clearSocError } = await (supabaseAdmin as any)
      .from("user_sociedades")
      .delete()
      .eq("user_id", invitedUser.id);
    if (clearSocError) throw clearSocError;
    if (uniqueSociedadIds.length) {
      const rows = uniqueSociedadIds.map((sid) => ({
        user_id: invitedUser.id,
        sociedad_id: sid,
      }));
      const { error: socError } = await (supabaseAdmin as any).from("user_sociedades").insert(rows);
      if (socError) throw socError;
    }

    if (conPassword) {
      return Response.json({ success: true, invite_sent: false, created_with_password: true, user: { id: invitedUser.id, email } });
    }

    const appOrigin = new URL(request.url).origin;
    const inviteUrl = new URL("/auth/confirm", appOrigin);
    inviteUrl.searchParams.set("token_hash", tokenHash ?? "");
    inviteUrl.searchParams.set("type", "invite");
    inviteUrl.searchParams.set("next", "/auth/aceptar-invitacion");

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return Response.json({
        success: true,
        invite_sent: false,
        recovered: Boolean(existingUser),
        warning: "El acceso quedó creado, pero falta configurar RESEND_API_KEY para enviar la invitación.",
        user: { id: invitedUser.id, email },
      });
    }

    const configuredFrom = process.env.EMAIL_FROM || "notificaciones@lazzari.com.ar";
    const from = configuredFrom.includes("<") ? configuredFrom : `Lazzari CRM <${configuredFrom}>`;
    const safeName = escapeHtml(nombre.trim());
    const resend = new Resend(resendKey);
    const { error: sendError } = await resend.emails.send({
      from,
      to: [email],
      subject: "Tu acceso a Lazzari CRM",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b">
          <h2 style="color:#ff4500">Bienvenido a Lazzari CRM</h2>
          <p>Hola ${safeName},</p>
          <p>Se creó tu acceso al sistema. Usá el siguiente botón para definir tu contraseña:</p>
          <p style="margin:28px 0"><a href="${escapeHtml(inviteUrl.toString())}" style="background:#ff4500;color:white;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Activar mi cuenta</a></p>
          <p style="font-size:12px;color:#71717a">Si no esperabas esta invitación, podés ignorar este mensaje.</p>
        </div>`,
    });

    if (sendError) {
      console.error("Error sending CRM invite:", sendError);
      return Response.json({
        success: true,
        invite_sent: false,
        recovered: Boolean(existingUser),
        warning: `El acceso quedó creado, pero no se pudo enviar la invitación: ${sendError.message}`,
        user: { id: invitedUser.id, email },
      });
    }

    return Response.json({
      success: true,
      invite_sent: true,
      recovered: Boolean(existingUser),
      user: { id: invitedUser.id, email },
    });
  } catch (error: unknown) {
    console.error("Error inviting user:", error);
    const message = error instanceof Error ? error.message : "Error interno";
    return Response.json({ error: message }, { status: 500 });
  }
}
