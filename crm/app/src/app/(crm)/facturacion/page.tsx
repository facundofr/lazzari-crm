"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useUser } from "@/lib/auth-context";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { FacturacionContent } from "./facturacion-content";

// Facturación vive en Finanzas > Cobrar > Facturas de venta (una sola pantalla).
// Esta dirección queda para los links viejos: lleva ahí. Quien no tiene Finanzas sigue viéndola acá.
export default function FacturacionPage() {
  const { role, loading } = useUser();
  const router = useRouter();
  const tieneFinanzas = !!role && ROLE_PERMISSIONS[role]?.some((p) => p.module === "*" || p.module === "finanzas");

  useEffect(() => {
    if (loading || !tieneFinanzas) return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "facturacion");
    params.set("grupo", "cobrar");
    router.replace(`/finanzas?${params.toString()}`);
  }, [loading, tieneFinanzas, router]);

  if (loading || tieneFinanzas) {
    return (
      <div className="flex items-center justify-center p-24">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }
  return <FacturacionContent autoSelectId={typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("factura") || undefined : undefined} />;
}
