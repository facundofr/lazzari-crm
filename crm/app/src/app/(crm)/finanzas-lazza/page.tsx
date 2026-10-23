"use client";

// Mudanza de Finanzas (23/10/2026): Finanzas Lazza ahora vive en /finanzas. Esta dirección queda para links y favoritos viejos.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function FinanzasLazzaRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace(`/finanzas${window.location.search}`); }, [router]);
  return <div className="flex items-center justify-center p-24"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>;
}
