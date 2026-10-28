"use client";

// 28/10/2026 (Augusto): la Finanzas vieja se sacó del sistema. Esta dirección queda solo para links y favoritos viejos: lleva a Finanzas.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function FinanzasViejaRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace(`/finanzas${window.location.search}`); }, [router]);
  return <div className="flex items-center justify-center p-24"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>;
}
