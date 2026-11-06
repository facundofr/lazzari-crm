"use client";

// Finanzas Lazza → IVA del mes, estimado con lo cargado en el sistema (arreglo 16, 27/10/2026; la cuenta está en lib/finanzas-lazza → ivaDelMes):
// débito − crédito (con el IVA de las comisiones del banco) − retenciones de IVA sufridas con certificado = a pagar o a favor.
// Las retenciones sin certificado y las percepciones van aparte (no se restan); lo pagado con VEP se compara con el estimado.
// Sin saldo a favor de meses anteriores. Solo lee.
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ivaDelMes, type FilaIva } from "@/lib/finanzas-lazza";
import { sumarMeses } from "@/lib/reportes-comprobantes";
import { traerComprasDelMes, traerIvaACuenta, traerTcDelDia, traerVentasDelMes } from "./datos";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export function FinanzasLazzaIva({ sociedadId, periodo }: { sociedadId: string; periodo: string }) {
  const [datos, setDatos] = useState<{
    ventas: Awaited<ReturnType<typeof traerVentasDelMes>>; compras: Awaited<ReturnType<typeof traerComprasDelMes>>;
    tcDia: Awaited<ReturnType<typeof traerTcDelDia>>; aCuenta: Awaited<ReturnType<typeof traerIvaACuenta>>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    Promise.all([traerVentasDelMes(sociedadId, periodo), traerComprasDelMes(sociedadId, periodo), traerTcDelDia(periodo), traerIvaACuenta(sociedadId, periodo)])
      .then(([ventas, compras, tcDia, aCuenta]) => { if (vivo) setDatos({ ventas, compras, tcDia, aCuenta }); })
      .catch((e) => { console.error("Finanzas Lazza · IVA:", e); if (vivo) setError("No se pudieron cargar los datos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, periodo]);

  const r = useMemo(() => (datos ? ivaDelMes({ periodo, ventas: datos.ventas, compras: datos.compras, tcDia: datos.tcDia, ...datos.aCuenta }) : null), [datos, periodo]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  if (!r) return <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p>;

  const aPagar = r.estimado >= 0;
  const conCertificados = r.estimado - r.retenciones.sinCertificado;
  const sinImpuesto = r.vep.sinImpuesto.filas.length;
  const aviso = "text-[11px] text-amber-700 dark:text-amber-400";

  const renglon = (titulo: string, monto: number, fuerte = false, nota?: string) => (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${fuerte ? "border-t border-zinc-200 font-semibold dark:border-zinc-700" : ""}`}>
      <span className="text-zinc-600 dark:text-zinc-300">{titulo}{nota && <span className="block text-[11px] font-normal text-zinc-400">{nota}</span>}</span>
      <span className="whitespace-nowrap font-mono">{formatCurrency(monto)}</span>
    </div>
  );

  const detalle = (titulo: string, filas: FilaIva[]) => (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-orange-600 hover:underline">{titulo} ({filas.length})</summary>
      {/* Una lista ancha (proveedores con nombre largo) scrollea dentro de su tarjeta, no corre la pantalla. */}
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-xs">
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${f.iva < 0 ? "text-red-600" : ""}`}>
                <td className="py-0.5 pr-2 whitespace-nowrap">{formatDate(f.fecha)}</td>
                <td className="py-0.5 pr-2 font-mono whitespace-nowrap">{f.comprobante}</td>
                <td className="py-0.5 pr-2">{f.nombre}{f.soloIva && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">Solo IVA</span>}{f.aviso && <span className="ml-1 text-amber-600">⚠ {f.aviso}</span>}</td>
                <td className="py-0.5 pl-2 text-right font-mono whitespace-nowrap">{formatCurrency(f.iva)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
          {renglon("IVA de comisiones del banco", r.compras.banco)}
          {renglon("Crédito", r.compras.credito, true, r.compras.deSoloIva ? `De eso, de facturas Solo IVA: ${formatCurrency(r.compras.deSoloIva)}` : undefined)}
          {detalle("Ver comprobantes", r.compras.filas)}
          {r.compras.filasBanco.length > 0 && detalle("Ver líneas del banco", r.compras.filasBanco)}
        </div>
      </div>
      <div className={`rounded-xl border-2 p-3 text-sm ${aPagar ? "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20" : "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20"}`}>
        {renglon("IVA del mes (débito − crédito)", r.diferencia)}
        {renglon("Menos retenciones de IVA sufridas, con certificado", -r.retenciones.conCertificado || 0)}
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-zinc-200 pt-1 dark:border-zinc-700">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{aPagar ? "A pagar, estimado" : "A favor, estimado"}</span>
          <span className="font-mono text-base font-bold">{formatCurrency(Math.abs(r.estimado))}</span>
        </div>
        {r.retenciones.sinCertificado > 0 && (
          <p className={aviso}>⚠ Retenciones sin certificado: {formatCurrency(r.retenciones.sinCertificado)} (no se restan). Con el certificado: {conCertificados >= 0 ? "a pagar" : "a favor"} {formatCurrency(Math.abs(conCertificados))}.</p>
        )}
        {r.retenciones.filas.length > 0 && detalle("Ver retenciones", r.retenciones.filas)}
        <div className="mt-2 border-t border-zinc-200 pt-1 dark:border-zinc-700">
          {r.vep.filas.length > 0 ? (
            <>
              {renglon(`Pagado con VEP (IVA de ${nombreMes(periodo)})`, r.vep.pagado)}
              {r.vep.coincide
                ? <p className="text-[11px] text-emerald-700 dark:text-emerald-400">✓ Coincide con el estimado.</p>
                : <p className={aviso}>⚠ El VEP no coincide con el estimado (diferencia {formatCurrency(Math.abs(r.vep.diferencia ?? 0))}). Puede faltar algo cargado, un saldo a favor de otro mes o un comprobante que el contador tomó en otro mes.</p>}
              {detalle("Ver VEP", r.vep.filas)}
            </>
          ) : (
            <p className="py-1 text-[11px] text-zinc-500">Pagado con VEP: todavía no hay un VEP de IVA de {nombreMes(periodo)} en Gastos.</p>
          )}
          {sinImpuesto > 0 && (
            <>
              <p className={aviso}>{sinImpuesto} VEP de {nombreMes(sumarMeses(periodo, 1))} sin impuesto ({formatCurrency(r.vep.sinImpuesto.monto)}): {sinImpuesto === 1 ? "si es" : "si alguno es"} de IVA, completalo con «Leer VEP (IA)» en Gastos.</p>
              {detalle("Ver VEP sin impuesto", r.vep.sinImpuesto.filas)}
            </>
          )}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">Estimado con lo cargado en el sistema. No incluye saldo a favor de meses anteriores. US$ al TC de cada comprobante (compras sin TC cargado: dólar BNA del día).</p>
        {r.sinCotizacion.length > 0 && <p className="mt-1 text-[11px] text-amber-600">En US$ sin cotización (no suman): {r.sinCotizacion.join(", ")}</p>}
      </div>
      {r.percepciones.filas.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {renglon("Percepciones de facturas de compra (aparte)", r.percepciones.monto, false, "IVA e IIBB vienen juntos en un solo número: no se restan.")}
          {detalle("Ver facturas", r.percepciones.filas)}
        </div>
      )}
    </div>
  );
}
