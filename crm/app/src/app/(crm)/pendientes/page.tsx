"use client";

// 28/10/2026 (Augusto): la pantalla Pendientes se sacó del sistema. Esta dirección queda solo para links y favoritos viejos: lleva al Dashboard.
// Los datos (tabla pendientes) quedan en la base.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function PendientesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard"); }, [router]);
  return <div className="flex items-center justify-center p-24"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>;
}
