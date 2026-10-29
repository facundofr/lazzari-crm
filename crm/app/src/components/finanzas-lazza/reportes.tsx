"use client";

// Finanzas Lazza → Reportes básico (solo lectura). Cuentas en lib/finanzas-lazza (reporteBasico).
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LineaPremio } from "./premios";
import { OBJETIVOS_MES, reporteBasico, type NetoIva, type ReporteBasico } from "@/lib/finanzas-lazza";
import { traerDatosReporte } from "./datos";

const NIVEL_TEXTO: Record<ReporteBasico["objetivo"]["nivel"], string> = {
  debajo: "Debajo del mínimo", minimo: "Mínimo cumplido", bueno: "Bueno cumplido", muy_bueno: "Muy bueno cumplido",
};

export function FinanzasLazzaReportes({ sociedadId, periodo }: { sociedadId: string; periodo: string }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof traerDatosReporte>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    traerDatosReporte(sociedadId, periodo)
      .then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { console.error("Finanzas Lazza · Reportes:", e); if (vivo) setError("No se pudieron cargar los datos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, periodo]);

  const r = useMemo(() => (datos ? reporteBasico({ periodo, ...datos }) : null), [datos, periodo]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  if (!r) return <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p>;

  const fila = (titulo: string, x: NetoIva, nota?: string) => (
    <tr className="border-t border-zinc-100 dark:border-zinc-800">
      <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200">{titulo}{nota && <span className="block text-[11px] text-zinc-400">{nota}</span>}</td>
      <td className="py-1.5 pl-3 text-right font-mono">{formatCurrency(x.neto)}</td>
      <td className="py-1.5 pl-3 text-right font-mono text-zinc-500">{formatCurrency(x.iva)}</td>
      <td className="py-1.5 pl-3 text-right font-mono font-semibold">{formatCurrency(x.total)}</td>
    </tr>
  );

  return (
    <div className="space-y-3">
      {/* Objetivos adentro de Reportes (auditoría UX 27/10, arreglo 8): antes era una tarjeta aparte con la misma cuenta. */}
      <BarraObjetivo o={r.objetivo} periodo={periodo} />
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="pb-1 text-left font-semibold">En $</th>
              <th className="pb-1 pl-3 text-right font-semibold">Neto</th>
              <th className="pb-1 pl-3 text-right font-semibold">IVA</th>
              <th className="pb-1 pl-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {fila("Facturado", r.facturado, "Facturas del mes − NC (US$ al TC de cada factura)")}
            {fila("Costo de lo vendido", r.costo, "Costo de los artículos de los PR facturados")}
            {fila("Transportes", r.transportes, `Facturas de transporte del mes (${r.transportes.n}): transportistas y liquidaciones internas`)}
          </tbody>
        </table>
        <div className="mt-2 grid grid-cols-1 gap-1 border-t border-zinc-200 pt-2 text-sm sm:grid-cols-3 dark:border-zinc-700">
          <p className="flex justify-between gap-2 sm:block"><span className="text-zinc-500">Gastos fijos</span> <b className="font-mono sm:block">{formatCurrency(r.gastos.fijos)}</b></p>
          <p className="flex justify-between gap-2 sm:block"><span className="text-zinc-500">Gastos eventuales</span> <b className="font-mono sm:block">{formatCurrency(r.gastos.eventuales)}</b></p>
          <p className="flex justify-between gap-2 sm:block"><span className="text-zinc-500">Gastos del mes</span> <b className="font-mono sm:block">{formatCurrency(r.gastos.total)}</b></p>
        </div>
        {r.gastos.enUsdSinCotizacion > 0 && <p className="mt-1 text-[11px] text-amber-600">Hay gastos en US$ por {formatCurrency(r.gastos.enUsdSinCotizacion, "USD")} sin cotización del día: no suman.</p>}
      </div>

      {/* Resultado del mes: neto de venta − neto de costo − transportes − gastos del mes */}
      <div className={`rounded-xl border-2 p-3 text-sm ${r.resultado >= 0 ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">Resultado del mes</span>
          <span className={`font-mono text-lg font-bold ${r.resultado >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>{formatCurrency(r.resultado)}</span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{formatCurrency(r.facturado.neto)} neto de venta − {formatCurrency(r.costo.neto)} neto de costo − {formatCurrency(r.transportes.neto)} transportes − {formatCurrency(r.gastos.total)} gastos del mes</p>
      </div>

      {(r.avisos.length > 0 || r.sinCotizacion.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /> Para revisar (no frena nada)</p>
          <ul className="space-y-0.5 text-amber-900 dark:text-amber-200">
            {r.avisos.map((a) => (
              <li key={a.facturaId} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-xs">{a.comprobante}</span>
                <span>{a.cliente}</span>
                <span className="text-amber-700 dark:text-amber-400">· {a.motivo}</span>
                {a.presupuestoId
                  ? <Link href={`/presupuestos?selected=${a.presupuestoId}`} className="font-medium text-orange-600 hover:underline">Abrir {a.prNumero || "PR"}</Link>
                  : null}
              </li>
            ))}
            {r.sinCotizacion.length > 0 && <li>En US$ sin cotización (no suman): {r.sinCotizacion.join(", ")}</li>}
          </ul>
        </div>
      )}

      <details className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer text-xs font-medium text-orange-600 hover:underline">Ver detalle por factura ({r.filas.length})</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400">
                <th className="py-1 pr-2">Fecha</th><th className="py-1 pr-2">Comprobante</th><th className="py-1 pr-2">Cliente</th><th className="py-1 pr-2">PR</th>
                <th className="py-1 pl-2 text-right">Venta neta</th><th className="py-1 pl-2 text-right">Costo neto</th>
              </tr>
            </thead>
            <tbody>
              {r.filas.map((f) => {
                return (
                  <tr key={f.facturaId} className={`border-t border-zinc-100 dark:border-zinc-800 ${f.esNC ? "text-red-600" : ""}`}>
                    <td className="py-1 pr-2 whitespace-nowrap">{formatDate(f.fecha)}</td>
                    <td className="py-1 pr-2 font-mono whitespace-nowrap">{f.comprobante}</td>
                    <td className="py-1 pr-2">{f.cliente}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{f.presupuestoId ? <Link href={`/presupuestos?selected=${f.presupuestoId}`} className="text-orange-600 hover:underline">{f.prNumero || "PR"}</Link> : "—"}</td>
                    <td className="py-1 pl-2 text-right font-mono">{formatCurrency(f.venta.neto)}</td>
                    <td className="py-1 pl-2 text-right font-mono">{formatCurrency(f.costo.neto)}{f.aviso && <span className="ml-1 text-amber-600" title={f.aviso}>⚠</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Barra de objetivos del mes sobre el neto facturado (Mínimo / Bueno / Muy bueno). */
export function BarraObjetivo({ o, periodo }: { o: ReporteBasico["objetivo"]; periodo?: string }) {
  const tope = OBJETIVOS_MES.muyBueno * 1.1;
  const pct = (m: number) => `${Math.min(100, Math.max(0, (m / tope) * 100))}%`;
  return (
      <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">Objetivo del mes (neto): {NIVEL_TEXTO[o.nivel]}</span>
          <span className="text-xs text-zinc-500">{o.proximo ? <>Faltan <b className="font-mono">{formatCurrency(o.proximo.falta)}</b> para {o.proximo.nombre}</> : "¡Muy bueno superado!"}</span>
        </div>
        <div className="relative h-3 rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className={`h-3 rounded-full ${o.nivel === "debajo" ? "bg-orange-400" : "bg-emerald-500"}`} style={{ width: pct(o.neto) }} />
          {[OBJETIVOS_MES.minimo, OBJETIVOS_MES.bueno, OBJETIVOS_MES.muyBueno].map((m) => (
            <div key={m} className="absolute top-[-3px] h-[18px] w-0.5 bg-zinc-500" style={{ left: pct(m) }} />
          ))}
        </div>
        <div className="relative mt-1 h-4 text-[10px] text-zinc-500">
          {[["Mínimo", OBJETIVOS_MES.minimo], ["Bueno", OBJETIVOS_MES.bueno], ["Muy bueno", OBJETIVOS_MES.muyBueno]].map(([n, m]) => (
            <span key={n} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(m as number) }}>{n} {Number(m) / 1_000_000}M</span>
          ))}
        </div>
        {periodo && <div className="mt-2"><LineaPremio neto={o.neto} periodo={periodo} /></div>}
      </div>
  );
}

/** Finanzas Lazza → Objetivos: barra del mes con el neto facturado (misma cuenta que Reportes). */
export function FinanzasLazzaObjetivos({ sociedadId, periodo }: { sociedadId: string; periodo: string }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof traerDatosReporte>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    traerDatosReporte(sociedadId, periodo)
      .then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { console.error("Finanzas Lazza · Objetivos:", e); if (vivo) setError("No se pudieron cargar los datos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, periodo]);
  const r = useMemo(() => (datos ? reporteBasico({ periodo, ...datos }) : null), [datos, periodo]);
  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  if (!r) return <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p>;
  return (
    <div className="space-y-2">
      <BarraObjetivo o={r.objetivo} periodo={periodo} />
      <p className="text-[11px] text-zinc-500">Neto facturado del mes: <b className="font-mono">{formatCurrency(r.objetivo.neto)}</b> (facturas − NC, US$ al TC de cada factura). Objetivos: Mínimo $64.000.000 · Bueno $80.000.000 · Muy bueno $96.000.000.</p>
    </div>
  );
}
