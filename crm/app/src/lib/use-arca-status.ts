"use client";

import { useEffect, useState } from "react";

export type ArcaStatus = { connected: boolean; certOk?: boolean; error?: string; afipError?: string; production?: boolean; ptoVta?: number };

/**
 * Estado de ARCA de la sociedad (solo consulta). null = consultando.
 * Si la consulta falla se asume que el certificado existe: se puede emitir igual.
 */
export function useArcaStatus(sociedadId: string | undefined): ArcaStatus | null {
  const [arcaStatus, setArcaStatus] = useState<ArcaStatus | null>(null);
  useEffect(() => {
    if (!sociedadId) return;
    let vigente = true;
    setArcaStatus(null);
    fetch(`/api/facturacion?action=status&sociedad_id=${sociedadId}`)
      .then((r) => r.ok ? r.json() : r.json().catch(() => null).then((body: any) => {
        // API returned non-OK status — assume cert exists, connectivity may fail (normal on Vercel)
        return { connected: false, certOk: true, afipError: body?.error || `HTTP ${r.status}`, ptoVta: body?.ptoVta };
      }))
      .then((data: any) => {
        if (!vigente) return;
        // Guard against unexpected response shapes — if certOk is missing, default to true
        if (data && typeof data === "object" && data.certOk !== undefined) setArcaStatus(data);
        else setArcaStatus({ connected: false, certOk: true, afipError: "No se pudo verificar estado — puede emitir igualmente", ptoVta: data?.ptoVta });
      })
      .catch(() => { if (vigente) setArcaStatus({ connected: false, certOk: true, error: "No se pudo verificar estado — puede emitir igualmente" }); });
    return () => { vigente = false; };
  }, [sociedadId]);
  return arcaStatus;
}
