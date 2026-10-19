"use client";

/**
 * Finanzas Lazza (ex "Admin Augu"), al lado de Finanzas, que NO se toca.
 * Tanda 1 (18/10/2026): Reportes, IVA y Vencimientos. Tanda 2 (18/10/2026): inicio con 14 tarjetas
 * (Augusto: "juntá la A y la B") y todo adentro, sin abrir las pantallas viejas: Facturas, Cuentas corrientes,
 * Vencimientos de deuda, Órdenes de pago, Recibos, Retenciones, IVA, Movimientos, Objetivos y Reportes.
 * Tanda 3 (19/10/2026): Bancos y Cheques nuevos, y correcciones de Augusto (mandar OP, moneda única en cuentas corrientes,
 * vencimientos editables, columna OP en facturas de compra). Facturar y Gastos se arman en las próximas tandas.
 * Por ahora la ve solo super_admin (en armado con Augusto).
 */
import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Hammer } from "lucide-react";
import { Header } from "@/components/layout/header";
import { useUser } from "@/lib/auth-context";
import { todayAR } from "@/lib/utils";
import { periodoDeFecha, sumarMeses } from "@/lib/reportes-comprobantes";
import { FacturasConsulta } from "@/components/facturas-consulta";
import { FinanzasLazzaInicio, TARJETAS, type SeccionFL } from "@/components/finanzas-lazza/inicio";
import { FinanzasLazzaObjetivos, FinanzasLazzaReportes } from "@/components/finanzas-lazza/reportes";
import { FinanzasLazzaIva } from "@/components/finanzas-lazza/iva";
import { FinanzasLazzaVencimientos } from "@/components/finanzas-lazza/vencimientos";
import { FinanzasLazzaCuentasCorrientes } from "@/components/finanzas-lazza/cuentas-corrientes";
import { FinanzasLazzaCheques } from "@/components/finanzas-lazza/cheques";
import { FinanzasLazzaBancos } from "@/components/finanzas-lazza/bancos";
import { FinanzasLazzaMovimientos, FinanzasLazzaOrdenesPago, FinanzasLazzaRecibos, FinanzasLazzaRetenciones } from "@/components/finanzas-lazza/listas";

/** Pantallas nuevas que todavía no están (se diseñan con Augusto en las próximas tandas). */
const EN_ARMADO: Partial<Record<SeccionFL, string>> = {
  facturar: "La pantalla nueva de Facturar se diseña con vos en la Tanda 5.",
  gastos: "Gastos con todas las variantes (grupos, fijos/eventuales, débito automático, editable) se arma en la Tanda 4.",
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export default function FinanzasLazzaPage() {
  const { role, sociedadActiva, loading } = useUser();
  const [vista, setVista] = useState<SeccionFL | null>(null);
  const mesActual = periodoDeFecha(todayAR());
  const [periodo, setPeriodo] = useState(mesActual);

  if (loading) return <Header title="Finanzas Lazza" />;
  if (role !== "super_admin") {
    return (
      <div>
        <Header title="Finanzas Lazza" subtitle="En armado" />
        <p className="px-4 py-10 text-center text-sm text-zinc-500">Esta pantalla se está armando. Por ahora usá Finanzas.</p>
      </div>
    );
  }

  const sociedadId = sociedadActiva?.id;
  const tarjeta = vista ? TARJETAS.find((t) => t.id === vista) : null;
  const conMes = vista === "reportes" || vista === "iva" || vista === "objetivos";

  const contenido = () => {
    if (!sociedadId) return <p className="py-6 text-sm text-zinc-500">Elegí una sociedad.</p>;
    if (!vista) return <FinanzasLazzaInicio sociedadId={sociedadId} onAbrir={(s) => { setVista(s); window.scrollTo(0, 0); }} />;
    if (EN_ARMADO[vista]) return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <Hammer className="h-8 w-8 text-zinc-400" />
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">En armado</p>
        <p className="max-w-md text-sm text-zinc-500">{EN_ARMADO[vista]}</p>
      </div>
    );
    switch (vista) {
      case "facturas": return <FacturasConsulta completa />;
      case "cuentas": return <FinanzasLazzaCuentasCorrientes sociedadId={sociedadId} />;
      case "vencimientos": return <FinanzasLazzaVencimientos sociedadId={sociedadId} />;
      case "ordenes_pago": return <FinanzasLazzaOrdenesPago sociedadId={sociedadId} />;
      case "recibos": return <FinanzasLazzaRecibos sociedadId={sociedadId} />;
      case "retenciones": return <FinanzasLazzaRetenciones sociedadId={sociedadId} />;
      case "iva": return <FinanzasLazzaIva sociedadId={sociedadId} periodo={periodo} />;
      case "bancos": return <FinanzasLazzaBancos sociedadId={sociedadId} />;
      case "cheques": return <FinanzasLazzaCheques sociedadId={sociedadId} />;
      case "movimientos": return <FinanzasLazzaMovimientos sociedadId={sociedadId} />;
      case "objetivos": return <FinanzasLazzaObjetivos sociedadId={sociedadId} periodo={periodo} />;
      case "reportes": return <FinanzasLazzaReportes sociedadId={sociedadId} periodo={periodo} />;
      default: return null;
    }
  };

  return (
    <div>
      <Header title="Finanzas Lazza" subtitle={sociedadActiva?.nombre || undefined} />
      <div className="space-y-3 px-3 py-3 sm:px-4">
        {vista && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setVista(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-sm text-zinc-600 hover:border-orange-300 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <ArrowLeft className="h-4 w-4" /> Finanzas Lazza
              </button>
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">{tarjeta?.nombre}</h2>
            </div>
            {conMes && (
              <div className="flex items-center gap-1 text-sm">
                <button type="button" aria-label="Mes anterior" onClick={() => setPeriodo((p) => sumarMeses(p, -1))} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ChevronLeft className="h-4 w-4" /></button>
                <span className="min-w-[8.5rem] text-center font-medium capitalize text-zinc-700 dark:text-zinc-200">{nombreMes(periodo)}</span>
                <button type="button" aria-label="Mes siguiente" disabled={periodo >= mesActual} onClick={() => setPeriodo((p) => sumarMeses(p, 1))} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ChevronRight className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        )}
        {contenido()}
      </div>
    </div>
  );
}
