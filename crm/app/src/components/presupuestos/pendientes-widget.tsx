"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { ListChecks, ArrowRight } from "lucide-react";

/** Botón del Dashboard: muestra cuántos pendientes abiertos hay y lleva a la pantalla /pendientes. */
export function PendientesWidget() {
  const { profile, sociedadActiva } = useUser();
  const [abiertos, setAbiertos] = useState(0);

  useEffect(() => {
    if (!profile?.id) return;
    let q = (supabase as any).from("pendientes").select("id", { count: "exact", head: true })
      .eq("user_id", profile.id).eq("completado", false);
    if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
    q.then(({ count }: { count: number | null }) => setAbiertos(count || 0));
  }, [profile?.id, sociedadActiva?.id]);

  return (
    <Link
      href="/pendientes"
      className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
    >
      <ListChecks className="h-4 w-4" />
      Pendientes
      {abiertos > 0 && (
        <span className="rounded-full px-1.5 py-0.5 text-xs font-semibold bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
          {abiertos}
        </span>
      )}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}
