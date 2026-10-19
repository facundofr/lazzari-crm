"use client";

/**
 * Finanzas Lazza (ex "Admin Augu"), Tanda 1 (18/10/2026): pestaña nueva al lado de Finanzas, que NO se toca.
 * Estructura: Ventas · Compras · Vencimientos · IVA · Tesorería · Reportes. Solo lectura, sin migraciones.
 * Ventas, Compras y Tesorería todavía abren la misma pantalla de Finanzas (se pasan en próximas tandas).
 * Por ahora la ve solo super_admin (en armado con Augusto).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Header } from "@/components/layout/header";
import { useUser } from "@/lib/auth-context";
import { todayAR } from "@/lib/utils";
import { periodoDeFecha, sumarMeses } from "@/lib/reportes-comprobantes";
import { FinanzasLazzaReportes } from "@/components/finanzas-lazza/reportes";
import { FinanzasLazzaIva } from "@/components/finanzas-lazza/iva";
import { FinanzasLazzaVencimientos } from "@/components/finanzas-lazza/vencimientos";

type Seccion = "ventas" | "compras" | "vencimientos" | "iva" | "tesoreria" | "reportes";

const SECCIONES: { id: Seccion; label: string }[] = [
  { id: "ventas", label: "Ventas" },
  { id: "compras", label: "Compras" },
  { id: "vencimientos", label: "Vencimientos" },
  { id: "iva", label: "IVA" },
  { id: "tesoreria", label: "Tesorería" },
  { id: "reportes", label: "Reportes" },
];

/** Subpestañas que por ahora abren la pantalla de siempre (misma pantalla, no copia). */
const ENLACES: Partial<Record<Seccion, { label: string; href: string; detalle: string }[]>> = {
  ventas: [
    { label: "Facturar", href: "/ventas", detalle: "Ventas › Para facturar: PR aprobados sin facturar" },
    { label: "Facturas de venta", href: "/finanzas?tab=facturacion", detalle: "Las facturadas" },
    { label: "CC clientes", href: "/finanzas?tab=cc_clientes", detalle: "Saldos, semáforo BCRA y Cobrar" },
    { label: "Recibos", href: "/finanzas?tab=recibos", detalle: "Recibos de cobro" },
  ],
  compras: [
    { label: "Facturas de compra", href: "/finanzas?tab=facturas_compra", detalle: "Las de Compras Lazza llegan solas" },
    { label: "CC proveedores", href: "/finanzas?tab=cc_proveedores", detalle: "Saldos y BCRA" },
    { label: "Órdenes de pago", href: "/finanzas?tab=ordenes_pago", detalle: "Pagar, con las retenciones adentro" },
  ],
  tesoreria: [
    { label: "Bancos", href: "/finanzas?tab=para_confirmar", detalle: "Efectivo, tarjetas y préstamos" },
    { label: "Cheques", href: "/finanzas?tab=echeqs", detalle: "Emitidos, en cartera y Martín F." },
    { label: "Gastos", href: "/finanzas?tab=gastos_manuales", detalle: "Fijos y eventuales" },
    { label: "Movimientos", href: "/finanzas?tab=movimientos", detalle: "Historial de todo lo que se hizo" },
  ],
};

const CLAVE_SECCION = "lz-finanzas-lazza-seccion";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export default function FinanzasLazzaPage() {
  const { role, sociedadActiva, loading } = useUser();
  const [seccion, setSeccion] = useState<Seccion>("reportes");
  const mesActual = periodoDeFecha(todayAR());
  const [periodo, setPeriodo] = useState(mesActual);

  // La sección elegida se recuerda en esta compu.
  useEffect(() => {
    try {
      const g = localStorage.getItem(CLAVE_SECCION);
      if (g && SECCIONES.some((s) => s.id === g)) setSeccion(g as Seccion);
    } catch { /* sin almacenamiento */ }
  }, []);
  const elegir = (s: Seccion) => {
    setSeccion(s);
    try { localStorage.setItem(CLAVE_SECCION, s); } catch { /* sin almacenamiento */ }
  };

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
  const conMes = seccion === "reportes" || seccion === "iva";
  const enlaces = ENLACES[seccion];

  return (
    <div>
      <Header title="Finanzas Lazza" subtitle={sociedadActiva?.nombre ? `${sociedadActiva.nombre} · solo lectura` : "Solo lectura"} />
      <div className="space-y-3 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {SECCIONES.map((s) => (
              <button key={s.id} type="button" onClick={() => elegir(s.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${seccion === s.id ? "bg-orange-500 text-white" : "border border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
                {s.label}
              </button>
            ))}
          </div>
          {conMes && (
            <div className="flex items-center gap-1 text-sm">
              <button type="button" aria-label="Mes anterior" onClick={() => setPeriodo((p) => sumarMeses(p, -1))} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[8.5rem] text-center font-medium capitalize text-zinc-700 dark:text-zinc-200">{nombreMes(periodo)}</span>
              <button type="button" aria-label="Mes siguiente" disabled={periodo >= mesActual} onClick={() => setPeriodo((p) => sumarMeses(p, 1))} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
        </div>

        {!sociedadId ? (
          <p className="py-6 text-sm text-zinc-500">Elegí una sociedad.</p>
        ) : enlaces ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {enlaces.map((e) => (
              <Link key={e.label} href={e.href}
                className="group rounded-xl border border-zinc-200 bg-white p-3 hover:border-orange-300 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="flex items-center justify-between text-sm font-semibold text-zinc-800 dark:text-zinc-100">{e.label} <ExternalLink className="h-3.5 w-3.5 text-zinc-400 group-hover:text-orange-500" /></p>
                <p className="mt-0.5 text-xs text-zinc-500">{e.detalle}</p>
                <p className="mt-1 text-[10px] text-zinc-400">Por ahora abre la pantalla de siempre</p>
              </Link>
            ))}
          </div>
        ) : seccion === "vencimientos" ? (
          <FinanzasLazzaVencimientos sociedadId={sociedadId} />
        ) : seccion === "iva" ? (
          <FinanzasLazzaIva sociedadId={sociedadId} periodo={periodo} />
        ) : (
          <FinanzasLazzaReportes sociedadId={sociedadId} periodo={periodo} />
        )}
      </div>
    </div>
  );
}
