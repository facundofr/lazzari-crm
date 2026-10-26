"use client";

// Bancos > Cheques > "Cargar estado de cheques" (24/10/2026, Augusto): se suben todos los reportes de eCheq juntos
// ("23-10-2026-eCheqs-aceptados.xls", "…-emitidos.xls", "…-deposito.xls", etc.; el estado va en el nombre del archivo).
// Cada cheque se identifica por su CheqID; se guarda el estado del banco tal cual y no se crean cheques ni se cambia el estado del CRM
// (salvo lo que ya hacía el sistema). Lo dudoso se avisa y no se toca. La lectura está en lib/echeq-reportes.ts y la carga en la función
// de base aplicar_reporte_echeqs.
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { leerHojas, esMovimientos } from "@/components/extracto-bbva";
import { armarItemsEcheq, leerReporteEcheq, type EcheqReporte, type ItemAplicar } from "@/lib/echeq-reportes";
import { formatCurrency } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";

// armarItemsEcheq vive en lib/echeq-reportes (la usan esta pantalla, Bancos > Movimientos y los scripts de carga).
export { armarItemsEcheq };
export interface Resultado {
  vinculados: number; actualizados: number; sin_cambio: number; pagados: number; no_estan_total: number; conflictos_total: number;
  no_estan: Array<Record<string, unknown>>; conflictos: Array<Record<string, unknown>>; diferencias: Array<Record<string, unknown>>;
}

const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));

/** Aplica los cheques de los reportes (de a 200) con la función de base aplicar_reporte_echeqs y suma los resultados. */
export async function aplicarReportesEcheq(sociedadId: string, items: ItemAplicar[]): Promise<Resultado> {
  const total: Resultado = { vinculados: 0, actualizados: 0, sin_cambio: 0, pagados: 0, no_estan_total: 0, conflictos_total: 0, no_estan: [], conflictos: [], diferencias: [] };
  for (let i = 0; i < items.length; i += 200) {
    const { data, error: e } = await (supabase as any).rpc("aplicar_reporte_echeqs", {
      p_sociedad_id: sociedadId,
      p_cheques: items.slice(i, i + 200).map(({ archivo: _a, ...c }) => ({ ...c, pagado_antes_corte: false })),
    });
    if (e) throw e;
    const r = data as Resultado;
    total.vinculados += Number(r.vinculados || 0); total.actualizados += Number(r.actualizados || 0); total.sin_cambio += Number(r.sin_cambio || 0);
    total.pagados += Number(r.pagados || 0); total.no_estan_total += Number(r.no_estan_total || 0); total.conflictos_total += Number(r.conflictos_total || 0);
    total.no_estan.push(...(r.no_estan || [])); total.conflictos.push(...(r.conflictos || [])); total.diferencias.push(...(r.diferencias || []));
  }
  return total;
}

export function CargarEstadoCheques({ sociedadId, onAplicado }: { sociedadId: string; onAplicado?: () => void }) {
  const [leyendo, setLeyendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [reportes, setReportes] = useState<EcheqReporte[]>([]);
  const [sospechosos, setSospechosos] = useState<string[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir(files: FileList | null) {
    if (!files?.length) return;
    setLeyendo(true);
    setResultado(null);
    setError(null);
    const out: EcheqReporte[] = [];
    const raros: string[] = [];
    try {
      for (const f of Array.from(files)) {
        try {
          const hojas = await leerHojas(f);
          const r = leerReporteEcheq(hojas[0] || [], f.name);
          if (!r.direccion && esMovimientos(hojas)) raros.push(`${f.name}: parece los Movimientos de la cuenta, no un reporte de cheques. Subilo en Bancos > Movimientos.`);
          else out.push(r);
        } catch (e) { raros.push(`${f.name}: no se pudo leer (${errorTexto(e)})`); }
      }
    } finally {
      setReportes(out);
      setSospechosos(raros);
      setLeyendo(false);
    }
  }

  const { items, avisos: avisosUnion } = armarItemsEcheq(reportes);
  const avisos = [...sospechosos, ...reportes.flatMap((r) => r.advertencias.map((a) => `${r.archivo}: ${a}`)), ...avisosUnion];

  async function aplicar() {
    if (!items.length) return;
    setAplicando(true);
    setError(null);
    try {
      const total = await aplicarReportesEcheq(sociedadId, items);
      setResultado(total);
      setReportes([]);
      setSospechosos([]);
      onAplicado?.();
    } catch (e) {
      setError(`No se pudieron aplicar los cheques: ${errorTexto(e)}`);
    } finally {
      setAplicando(false);
    }
  }

  const linea = (x: Record<string, unknown>) => `N° ${String(x.numero ?? "?")}${x.monto !== undefined ? ` · ${formatCurrency(Number(x.monto))}` : ""} — ${String(x.motivo ?? (x.crm ? `el CRM dice "${x.crm}" y el banco "${x.banco}"` : ""))}`;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-zinc-600 dark:text-zinc-300"><b>Cargar estado de cheques:</b> subí juntos los reportes de eCheq del banco (recibidos y emitidos). Se identifica cada cheque por su ID y se guarda el estado del banco; no se crea ni se cambia nada más.</p>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600">
          {leyendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Cargar estado de cheques
          <input type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={(e) => { void elegir(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      {reportes.length > 0 && (
        <div className="mt-2 space-y-1 rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800/50">
          {reportes.map((r) => (
            <p key={r.archivo}><b>{r.archivo}</b> · {r.tipo || "tipo ?"} · {r.direccion ? `${r.direccion}s` : "?"} · {r.filas.length} cheques</p>
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button disabled={!items.length || aplicando} onClick={() => void aplicar()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : `Aplicar ${items.length} cheques`}
            </button>
            <button disabled={aplicando} onClick={() => { setReportes([]); setSospechosos([]); }} className="text-zinc-500 hover:underline">Cancelar</button>
          </div>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="mt-2 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
          {avisos.map((a, i) => <p key={i} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{a}</p>)}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}

      {resultado && (
        <div className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
          <p className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Listo: {resultado.vinculados} cheques identificados por primera vez, {resultado.actualizados} con estado actualizado, {resultado.sin_cambio} sin cambios{resultado.pagados ? `, ${resultado.pagados} pasaron a cobrados` : ""}.</p>
          {resultado.no_estan_total > 0 && (
            <details><summary className="cursor-pointer">{resultado.no_estan_total} cheques que no están en el CRM o no coinciden (no se tocaron)</summary>
              <ul className="ml-4 list-disc">{resultado.no_estan.map((x, i) => <li key={i}>{linea(x)}</li>)}</ul>
              {resultado.no_estan_total > resultado.no_estan.length && <p className="ml-4">…y {resultado.no_estan_total - resultado.no_estan.length} más.</p>}
            </details>
          )}
          {resultado.conflictos_total > 0 && (
            <details open><summary className="cursor-pointer font-semibold text-amber-700">{resultado.conflictos_total} para revisar (no se tocaron)</summary>
              <ul className="ml-4 list-disc">{resultado.conflictos.map((x, i) => <li key={i}>{linea(x)}</li>)}</ul>
            </details>
          )}
          {resultado.diferencias.length > 0 && (
            <details open><summary className="cursor-pointer font-semibold text-amber-700">{resultado.diferencias.length} donde el banco y el CRM no coinciden (no se cambió nada)</summary>
              <ul className="ml-4 list-disc">{resultado.diferencias.map((x, i) => <li key={i}>{linea(x)}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
