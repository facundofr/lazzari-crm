"use client";

import { FormEvent, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AceptarInvitacionPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== repeatPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("No se pudo guardar la contraseña. Pedí que te reenvíen la invitación.");
      setSaving(false);
      return;
    }

    router.replace("/presupuestos");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <section className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 text-xl font-bold text-white">L</div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Activar cuenta</h1>
          <p className="mt-1 text-sm text-zinc-500">Definí tu contraseña para ingresar a Lazzari CRM.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Contraseña</label>
            <input id="password" type="password" autoComplete="new-password" required minLength={8}
              value={password} onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white" />
          </div>
          <div>
            <label htmlFor="repeat-password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Repetir contraseña</label>
            <input id="repeat-password" type="password" autoComplete="new-password" required minLength={8}
              value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white" />
          </div>

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

          <button type="submit" disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {saving ? "Guardando..." : "Guardar contraseña e ingresar"}
          </button>
        </form>
      </section>
    </main>
  );
}
