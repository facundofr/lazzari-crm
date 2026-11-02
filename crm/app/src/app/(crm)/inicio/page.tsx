"use client";

// Inicio (02/11/2026, Augusto): la primera pantalla del CRM para el super_admin, con la plata de un vistazo (components/tablero-inicio).
// Los demás usuarios siguen entrando a Presupuestos (lib/supabase/middleware); si llegan acá por el link, vuelven a Presupuestos.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { TableroInicio } from "@/components/tablero-inicio";
import { useUser } from "@/lib/auth-context";

export default function InicioPage() {
  const { profile, role, loading, sociedadActiva } = useUser();
  const router = useRouter();
  const esAugusto = role === "super_admin";
  useEffect(() => {
    if (!loading && profile && !esAugusto) router.replace("/presupuestos");
  }, [loading, profile, esAugusto, router]);

  return (
    <>
      <Header title="Inicio" subtitle="La plata de un vistazo" />
      {esAugusto && sociedadActiva?.id ? (
        <TableroInicio sociedadId={sociedadActiva.id} nombre={profile?.full_name?.split(" ")[0] || "Augusto"} />
      ) : (
        <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      )}
    </>
  );
}
