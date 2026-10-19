"use client";

// Finanzas Lazza → IVA del mes, solo según el sistema (sin percepciones, retenciones, saldo anterior ni ARCA).
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ivaDelMes, type FilaIva } from "@/lib/finanzas-lazza";
import { traerComprasDelMes, traerTcDelDia, traerVentasDelMes } from "./datos";

export function FinanzasLazzaIva({ sociedadId, periodo }: { sociedadId: string; periodo: string }) {
  const [datos, setDatos] = useState<{ ventas: Awaited<ReturnType<typeof traerVentasDelMes>>; compras: Awaited<ReturnType<typeof traerComprasDelMes>>; tcDia: Awaited<ReturnType<typeof traerTcDelDia>> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    Promise.all([traerVentasDelMes(sociedadId, periodo), traerComprasDelMes(sociedadId, periodo), traerTcDelDia(periodo)])
      .then(([ventas, compras, tcDia]) => { if (vivo) setDatos({ ventas, compras, tcDia }); })
      .catch((e) => { console.error("Finanzas Lazza · IVA:", e); if (vivo) setError("No se pudieron cargar los datos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, periodo]);

  const r = useMemo(() => (datos ? ivaDelMes({ periodo, ...datos }) : null), [datos, periodo]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  if (!r) return <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p>;

  const renglon = (titulo: string, monto: number, fuerte = false, nota?: string) => (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${fuerte ? "border-t border-zinc-200 font-semibold dark:border-zinc-700" : ""}`}>
      <span className="text-zinc-600 dark:text-zinc-300">{titulo}{nota && <span className="block text-[11px] font-normal text-zinc-400">{nota}</span>}</span>
      <span className="whitespace-nowrap font-mono">{formatCurrency(monto)}</span>
    </div>
  );

  const detalle = (titulo: string, filas: FilaIva[]) => (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-orange-600 hover:underline">{titulo} ({filas.length})</summary>
      <table className="mt-1 w-full text-xs">
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${f.iva < 0 ? "text-red-600" : ""}`}>
              <td className="py-0.5 pr-2 whitespace-nowrap">{formatDate(f.fecha)}</td>
              <td className="py-0.5 pr-2 font-mono whitespace-nowrap">{f.comprobante}</td>
              <td className="py-0.5 pr-2">{f.nombre}{f.soloIva && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">Solo IVA</span>}{f.aviso && <span className="ml-1 text-amber-600">⚠ {f.aviso}</span>}</td>
              <td className="py-0.5 pl-2 text-right font-mono">{formatCurrency(f.iva)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-600">IVA ventas (débito)</p>
          {renglon("Facturas del mes", r.ventas.facturas)}
          {renglon("Menos NC del mes", -r.ventas.nc)}
          {renglon("Débito", r.ventas.debito, true)}
          {detalle("Ver comprobantes", r.ventas.filas)}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-orange-600">IVA compras (crédito)</p>
          {renglon("Facturas de compra del mes", r.compras.facturas)}
          {renglon("Menos NC de compra", -r.compras.nc)}
          {renglon("Crédito", r.compras.credito, true, r.compras.deSoloIva ? `De eso, de facturas Solo IVA: ${formatCurrency(r.compras.deSoloIva)}` : undefined)}
          {detalle("Ver comprobantes", r.compras.filas)}
        </div>
      </div>
      <div className={`rounded-xl border-2 p-3 text-sm ${r.diferencia >= 0 ? "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20" : "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20"}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">Diferencia débito − crédito</span>
          <span className="font-mono text-base font-bold">{formatCurrency(r.diferencia)}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-500">Solo referencia, según lo cargado en el sistema. No incluye percepciones, retenciones, saldo anterior ni lo de ARCA. US$ al TC de cada comprobante (compras: dólar BNA del día).</p>
        {r.sinCotizacion.length > 0 && <p className="mt-1 text-[11px] text-amber-600">En US$ sin cotización (no suman): {r.sinCotizacion.join(", ")}</p>}
      </div>
    </div>
  );
}
