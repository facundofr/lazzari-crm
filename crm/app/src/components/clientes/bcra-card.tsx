"use client";

/**
 * Informe BCRA (Central de Deudores) de un cliente: tarjeta completa, aviso corto y hook.
 * Es información para decidir: avisa, nunca bloquea.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { SEMAFORO_LABEL, SITUACION_LABEL, mesActual, type Semaforo } from "@/lib/bcra";
import { formatDate } from "@/lib/utils";
import { esDni } from "@/lib/documento-cliente";
import { AlertTriangle, Landmark, Loader2, RefreshCw } from "lucide-react";

const db = supabase as any;

export interface InformeBCRA {
  id: string; cliente_id: string; cuit: string; mes: string; periodo_bcra: string | null; denominacion: string | null;
  peor_situacion: number | null; deuda_total: number; entidades: number; cheques_rechazados: number; cheques_sin_pagar: number;
  monto_cheques_sin_pagar: number; proceso_judicial: boolean; semaforo: Semaforo; error: string | null; consultado_at: string;
  historial: Array<{ periodo: string; peor_situacion: number; deuda: number }> | null;
  data: { deudas?: Array<{ entidad: string; situacion: number; monto: number; dias_atraso: number | null }>; cheques?: Array<{ causal: string; fecha_rechazo: string | null; monto: number; fecha_pago: string | null }> } | null;
}

export const SEMAFORO_CLASES: Record<Semaforo, { punto: string; caja: string; texto: string }> = {
  verde: { punto: "bg-emerald-500", caja: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30", texto: "text-emerald-700 dark:text-emerald-400" },
  amarillo: { punto: "bg-amber-400", caja: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30", texto: "text-amber-700 dark:text-amber-400" },
  rojo: { punto: "bg-red-500", caja: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30", texto: "text-red-700 dark:text-red-400" },
  gris: { punto: "bg-zinc-400", caja: "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900", texto: "text-zinc-500" },
};

/** Miles de pesos (como informa el BCRA) → texto en pesos. */
export function pesosDesdeMiles(miles: number): string {
  return `$ ${Math.round((Number(miles) || 0) * 1000).toLocaleString("es-AR")}`;
}

const periodoTexto = (p: string | null) => (p && p.length === 6 ? `${p.slice(4)}/${p.slice(0, 4)}` : "—");

export async function actualizarBCRA(sociedadId: string, clienteId: string, tipo: "cliente" | "proveedor" = "cliente"): Promise<{ ok: boolean; error?: string; empeoro?: string | null }> {
  try {
    const res = await fetch("/api/bcra", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sociedad_id: sociedadId, ...(tipo === "proveedor" ? { proveedor_id: clienteId } : { cliente_id: clienteId }) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: j.error || `Error ${res.status}` };
    if (j.semaforo === "gris") return { ok: false, error: j.error || "El BCRA no respondió" };
    return { ok: true, empeoro: j.empeoro || null };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Sin conexión" };
  }
}

export function useInformeBCRA(clienteId: string | null | undefined) {
  const [informe, setInforme] = useState<InformeBCRA | null>(null);
  const [loading, setLoading] = useState(false);
  const cargar = useCallback(async () => {
    if (!clienteId) { setInforme(null); return; }
    setLoading(true);
    const { data } = await db.from("cliente_bcra_informes").select("*").eq("cliente_id", clienteId).order("mes", { ascending: false }).limit(1);
    setInforme(data?.[0] || null);
    setLoading(false);
  }, [clienteId]);
  useEffect(() => { void cargar(); }, [cargar]);
  return { informe, loading, recargar: cargar };
}

/** Aviso corto para presupuestos y facturación: solo aparece si el cliente está en rojo o amarillo. */
function motivosBCRA(informe: Pick<InformeBCRA, "peor_situacion" | "cheques_sin_pagar" | "cheques_rechazados" | "proceso_judicial">): string {
  return [
    informe.peor_situacion && informe.peor_situacion >= 2 ? `situación ${informe.peor_situacion} (${SITUACION_LABEL[informe.peor_situacion] || ""})` : "",
    informe.cheques_sin_pagar ? `${informe.cheques_sin_pagar} cheque(s) rechazado(s) sin pagar` : informe.cheques_rechazados ? `${informe.cheques_rechazados} cheque(s) rechazado(s)` : "",
    informe.proceso_judicial ? "proceso judicial" : "",
  ].filter(Boolean).join(" · ");
}

/** Al aprobar un PR (Augusto 20/10): texto del aviso si el cliente está en ROJO; si no, null. Nunca frena. */
export async function avisoBCRARojo(clienteId: string | null | undefined): Promise<string | null> {
  if (!clienteId) return null;
  try {
    const { data } = await db.from("cliente_bcra_informes").select("peor_situacion, cheques_sin_pagar, cheques_rechazados, proceso_judicial, semaforo").eq("cliente_id", clienteId).order("mes", { ascending: false }).limit(1);
    const inf = data?.[0];
    if (!inf || inf.semaforo !== "rojo") return null;
    return `BCRA: ${SEMAFORO_LABEL.rojo}. ${motivosBCRA(inf) || "Revisá la ficha del cliente."} Es solo un aviso.`;
  } catch { return null; }
}

/** soloRojo: en remitos (Augusto 20/10) avisa solo en rojo; en presupuestos y facturación, rojo o amarillo. */
export function AvisoBCRA({ clienteId, soloRojo = false }: { clienteId: string | null | undefined; soloRojo?: boolean }) {
  const { informe } = useInformeBCRA(clienteId);
  if (!informe || (informe.semaforo !== "rojo" && (soloRojo || informe.semaforo !== "amarillo"))) return null;
  const c = SEMAFORO_CLASES[informe.semaforo];
  const motivos = motivosBCRA(informe);
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${c.caja} ${c.texto}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span><b>BCRA: {SEMAFORO_LABEL[informe.semaforo]}.</b> {motivos || "Revisá la ficha del cliente."} Es solo un aviso: podés seguir igual.</span>
    </div>
  );
}

export function BCRACard({ sociedadId, clienteId, cuit }: { sociedadId: string | undefined; clienteId: string; cuit: string | null | undefined }) {
  const { informe, loading, recargar } = useInformeBCRA(clienteId);
  const [consultando, setConsultando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cuitOk = String(cuit || "").replace(/\D/g, "").length === 11;

  async function actualizar() {
    if (!sociedadId) return;
    setConsultando(true); setError(null);
    const r = await actualizarBCRA(sociedadId, clienteId);
    if (!r.ok) setError(r.error || "No se pudo consultar");
    await recargar();
    setConsultando(false);
  }

  const sem: Semaforo = informe?.semaforo || "gris";
  const c = SEMAFORO_CLASES[sem];
  const viejo = informe && informe.mes !== mesActual();
  const hist = informe?.historial || [];

  return (
    <div className={`rounded-xl border p-4 ${c.caja}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-zinc-500" />
          <div>
            <p className="text-sm font-semibold dark:text-white">Central de Deudores (BCRA)</p>
            <p className="text-[11px] text-zinc-500">
              {informe ? <>Consultado el {formatDate(informe.consultado_at.slice(0, 10))} · datos de {periodoTexto(informe.periodo_bcra)}{viejo ? " · de otro mes" : ""}</> : cuitOk ? "Todavía no se consultó" : esDni(cuit) ? "Con DNI no se consulta BCRA" : "El cliente no tiene CUIT de 11 números"}
            </p>
          </div>
        </div>
        <button onClick={actualizar} disabled={consultando || !cuitOk || !sociedadId} className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {consultando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Actualizar ahora
        </button>
      </div>
      {loading ? <Loader2 className="mt-3 h-4 w-4 animate-spin text-zinc-400" /> : informe && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className={`inline-flex items-center gap-1.5 font-semibold ${c.texto}`}><span className={`h-2.5 w-2.5 rounded-full ${c.punto}`} /> {SEMAFORO_LABEL[sem]}</span>
            {informe.error ? <span className="text-xs text-zinc-500">{informe.error}</span> : (
              <>
                <span className="text-xs text-zinc-600 dark:text-zinc-300">Peor situación: <b>{informe.peor_situacion ? `${informe.peor_situacion} · ${SITUACION_LABEL[informe.peor_situacion] || ""}` : "sin deudas bancarias"}</b></span>
                <span className="text-xs text-zinc-600 dark:text-zinc-300">Deuda en bancos: <b>{pesosDesdeMiles(informe.deuda_total)}</b> ({informe.entidades} entidad{informe.entidades === 1 ? "" : "es"})</span>
                <span className="text-xs text-zinc-600 dark:text-zinc-300">Cheques rechazados: <b>{informe.cheques_rechazados}</b>{informe.cheques_sin_pagar ? <b className="text-red-600"> · {informe.cheques_sin_pagar} sin pagar</b> : null}</span>
                {informe.proceso_judicial && <span className="text-xs font-semibold text-red-600">Proceso judicial</span>}
              </>
            )}
          </div>
          {hist.length > 1 && (
            <div className="mt-3">
              <p className="mb-1 text-[10px] text-zinc-500">Últimos {hist.length} meses (peor situación de cada mes)</p>
              <div className="flex h-8 items-end gap-0.5">
                {hist.map(h => (
                  <div key={h.periodo} title={`${periodoTexto(h.periodo)}: situación ${h.peor_situacion} · ${pesosDesdeMiles(h.deuda)}`}
                    className={`flex-1 rounded-sm ${h.peor_situacion >= 3 ? "bg-red-500" : h.peor_situacion === 2 ? "bg-amber-400" : "bg-emerald-500"}`}
                    style={{ height: `${Math.max(20, h.peor_situacion * 20)}%` }} />
                ))}
              </div>
            </div>
          )}
          {!!informe.data?.deudas?.length && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-zinc-500">Ver detalle por banco</summary>
              <table className="mt-1 w-full">
                <tbody>
                  {informe.data.deudas.map((d, i) => (
                    <tr key={i} className="border-t border-zinc-200/60 dark:border-zinc-700/60">
                      <td className="py-1 dark:text-zinc-200">{d.entidad}</td>
                      <td className="text-center">Sit. {d.situacion}</td>
                      <td className="text-right">{pesosDesdeMiles(d.monto)}</td>
                      <td className="text-right text-zinc-500">{d.dias_atraso ? `${d.dias_atraso} días atraso` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
