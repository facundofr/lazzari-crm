"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

/** Match the server's per-line VAT and final-total rounding at the threshold. */
export function fceTotalArs(items: { cantidad: number; precio_unitario: number; iva_porcentaje: number }[], isA: boolean, rate = 1) {
  const round = (value: number) => Math.round(value * 100) / 100;
  let net = 0, vat = 0;
  for (const item of items) {
    const amount = item.cantidad * item.precio_unitario;
    const itemNet = isA ? amount : round(amount / (1 + item.iva_porcentaje / 100));
    net += itemNet;
    vat += isA ? round(itemNet * item.iva_porcentaje / 100) : round(amount - itemNet);
  }
  return round(round(round(net) + round(vat)) * rate);
}

/** Read-only eligibility lookup; a result is never reused for another CUIT/date/society. */
export function useFceCheck(enabled: boolean, sociedadId?: string, clienteId?: string, fecha?: string) {
  const [attempt, setAttempt] = useState(0);
  const key = enabled && sociedadId && clienteId && fecha ? `${sociedadId}:${clienteId}:${fecha}:${attempt}` : "";
  const [result, setResult] = useState<{ key: string; obligado?: boolean; montoDesde?: number | null; error?: string }>({ key: "" });
  useEffect(() => {
    if (!key) { setResult({ key: "" }); return; }
    const controller = new AbortController();
    setResult({ key: "" });
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        const params = new URLSearchParams({ action: "fce-check", sociedad_id: sociedadId!, cliente_id: clienteId!, fecha: fecha! });
        const response = await fetch(`/api/facturacion?${params}`, { signal: controller.signal, cache: "no-store", headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
        const data = await response.json();
        if (!response.ok || typeof data.obligado !== "boolean") throw new Error(data.error || "No se pudo verificar el régimen FCE en ARCA.");
        if (data.obligado && !(Number(data.montoDesde) > 0)) throw new Error("ARCA no devolvió un monto mínimo FCE válido.");
        if (!controller.signal.aborted) setResult({ key, obligado: data.obligado, montoDesde: data.montoDesde == null ? null : Number(data.montoDesde) });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "No se pudo consultar FCE." });
      }
    })();
    return () => controller.abort();
  }, [key, sociedadId, clienteId, fecha]);
  const current = result.key === key && key !== "";
  return { ready: Boolean(current && result.obligado !== undefined && !result.error), obligado: current ? result.obligado : undefined, montoDesde: current ? result.montoDesde : null, error: current ? result.error : undefined, retry: () => setAttempt(value => value + 1) };
}
