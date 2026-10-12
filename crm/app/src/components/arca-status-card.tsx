"use client";

// Estado de la conexión con ARCA (factura electrónica) de la sociedad activa.
// Vive en Configuración > Integraciones (antes estaba en Facturación). Solo consulta: no emite nada.

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Server, KeyRound } from "lucide-react";
import { useUser } from "@/lib/auth-context";

type ArcaStatus = { connected: boolean; certOk?: boolean; error?: string; afipError?: string; production?: boolean; ptoVta?: number };

export function ArcaStatusCard() {
  const { sociedadActiva } = useUser();
  const [arcaStatus, setArcaStatus] = useState<ArcaStatus | null>(null);

  const emisor = sociedadActiva?.nombre === "Grupo LA"
    ? { razonSocial: "Grupo LA Servicios Integrales SAS", cuit: "30-71939604-2" }
    : { razonSocial: "Lazzari Soluciones Industriales", cuit: "20-37930912-8" };

  useEffect(() => {
    if (!sociedadActiva?.id) return;
    setArcaStatus(null);
    fetch(`/api/facturacion?action=status&sociedad_id=${sociedadActiva.id}`)
      .then((r) => r.ok ? r.json() : r.json().catch(() => null).then((body: any) => (
        { connected: false, certOk: true, afipError: body?.error || `HTTP ${r.status}`, ptoVta: body?.ptoVta }
      )))
      .then((data: any) => {
        if (data && typeof data === "object" && data.certOk !== undefined) setArcaStatus(data);
        else setArcaStatus({ connected: false, certOk: true, afipError: "No se pudo verificar estado — puede emitir igualmente", ptoVta: data?.ptoVta });
      })
      .catch(() => setArcaStatus({ connected: false, certOk: true, error: "No se pudo verificar estado — puede emitir igualmente" }));
  }, [sociedadActiva?.id]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          <CardTitle>Conexión ARCA — {sociedadActiva?.nombre ?? ""}</CardTitle>
        </div>
      </CardHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700 space-y-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-950">
              <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">WSFE</p>
              <p className="text-xs text-zinc-400">Factura electrónica</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${arcaStatus?.connected ? "bg-emerald-500" : arcaStatus === null ? "bg-zinc-300 dark:bg-zinc-600 animate-pulse" : arcaStatus?.certOk ? "bg-amber-400" : "bg-red-400"}`} />
            <span className="text-xs text-zinc-500">
              {arcaStatus === null ? "Verificando..." : arcaStatus.connected ? `Producción — PV ${arcaStatus.ptoVta}` : arcaStatus?.certOk ? `Configurado — PV ${arcaStatus.ptoVta}` : "Sin conexión"}
            </span>
          </div>
          {arcaStatus && !arcaStatus.connected && arcaStatus.afipError && (
            <p className="text-xs text-amber-500 mt-1 leading-tight">AFIP no responde ahora (normal)</p>
          )}
          {arcaStatus && !arcaStatus.connected && arcaStatus.error && !arcaStatus.certOk && (
            <p className="text-xs text-red-500 mt-1 leading-tight">{arcaStatus.error}</p>
          )}
        </div>
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700 space-y-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-950">
              <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Certificado digital</p>
              <p className="text-xs text-zinc-400">Requerido para emitir</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${arcaStatus === null ? "bg-zinc-300 dark:bg-zinc-600 animate-pulse" : arcaStatus?.connected || arcaStatus?.certOk ? "bg-emerald-500" : "bg-red-400"}`} />
            <span className="text-xs text-zinc-500">
              {arcaStatus === null ? "Verificando..." : arcaStatus?.connected || arcaStatus?.certOk ? "Certificado configurado" : "Certificado no configurado"}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
          <p className="text-xs font-medium text-zinc-500 mb-2">CUIT emisor</p>
          <p className="text-xl font-bold font-mono dark:text-white">{emisor.cuit}</p>
          <p className="text-xs text-zinc-400 mt-1">{emisor.razonSocial}</p>
        </div>
      </div>
    </Card>
  );
}
