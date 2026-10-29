"use client";

/**
 * Finanzas Lazza (ex "Admin Augu"), al lado de Finanzas, que NO se toca.
 * Tanda 1 (18/10/2026): Reportes, IVA y Vencimientos. Tanda 2 (18/10/2026): inicio con 14 tarjetas
 * (Augusto: "juntá la A y la B") y todo adentro, sin abrir las pantallas viejas: Facturas, Cuentas corrientes,
 * Vencimientos de deuda, Órdenes de pago, Recibos, Retenciones, IVA, Movimientos, Objetivos y Reportes.
 * Tanda 3 (19/10/2026): Bancos y Cheques nuevos, y correcciones de Augusto (mandar OP, moneda única en cuentas corrientes,
 * vencimientos editables, columna OP en facturas de compra). Facturar y Gastos se arman en las próximas tandas.
 * 19/10: Facturas reemplaza a Pagar, Cobrar y Vencimientos (una fila por factura, Ventas | Compras, tildar → Pagar/Cobrar);
 * las tarjetas Cobrar y Pagar abren Facturas en Ventas o Compras. Vencimientos sale del inicio (la pantalla queda por si acaso).
 * Mudanza (23/10/2026): esta pantalla es ahora /finanzas (la ven super_admin y administrativo); la vieja quedó en /finanzas-vieja, oculta.
 * /finanzas-lazza redirige acá. Los links viejos (?tab=) los traduce lib/finanzas-destino.ts; esta pantalla abre en ?seccion=.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Hammer } from "lucide-react";
import { Header } from "@/components/layout/header";
import { useUser } from "@/lib/auth-context";
import { todayAR } from "@/lib/utils";
import { esSeccionLazza, EVENTO_ABRIR_FINANZAS, traducirLinkViejo } from "@/lib/finanzas-destino";
import { periodoDeFecha, sumarMeses } from "@/lib/reportes-comprobantes";
import { FinanzasLazzaInicio, TARJETAS, type SeccionFL } from "@/components/finanzas-lazza/inicio";
import { FinanzasLazzaObjetivos, FinanzasLazzaReportes } from "@/components/finanzas-lazza/reportes";
import { FinanzasLazzaIva } from "@/components/finanzas-lazza/iva";
import { FinanzasLazzaContabilidad } from "@/components/finanzas-lazza/contabilidad";
import { FinanzasLazzaVencimientos } from "@/components/finanzas-lazza/vencimientos";
import { FinanzasLazzaCuentasCorrientes } from "@/components/finanzas-lazza/cuentas-corrientes";
import { FinanzasLazzaFacturas } from "@/components/finanzas-lazza/facturas";
import { FinanzasLazzaGastos } from "@/components/finanzas-lazza/gastos";
import { FinanzasLazzaBancos } from "@/components/finanzas-lazza/bancos";
import { FinanzasLazzaMovimientos, FinanzasLazzaOrdenesPago, FinanzasLazzaRecibos, FinanzasLazzaRetenciones } from "@/components/finanzas-lazza/listas";

/** Pantallas nuevas que todavía no están (se diseñan con Augusto en las próximas tandas). */
const EN_ARMADO: Partial<Record<SeccionFL, string>> = {};

/** Secciones que abren por link pero no tienen tarjeta propia: el título sale de acá (Objetivos está adentro de Reportes). */
const NOMBRE_SIN_TARJETA: Partial<Record<SeccionFL, string>> = { objetivos: "Objetivos" };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

/** Sección pedida por link (?seccion=...), si es una de Lazza. */
function seccionDelLink(): SeccionFL | null {
  if (typeof window === "undefined") return null;
  const s = new URLSearchParams(window.location.search).get("seccion");
  return esSeccionLazza(s) ? (s as SeccionFL) : null;
}

export default function FinanzasLazzaPage() {
  const { role, sociedadActiva, loading } = useUser();
  const router = useRouter();
  const [vista, setVista] = useState<SeccionFL | null>(seccionDelLink);
  // Links viejos de Finanzas (?tab=..., ?factura=...): se traducen a la pantalla nueva o a la vieja.
  useEffect(() => {
    const destino = traducirLinkViejo(new URLSearchParams(window.location.search));
    if (!destino) return;
    // Si el destino es otra sección de acá, se abre ya (router.replace solo cambia la dirección, no vuelve a leerla).
    const seccion = new URLSearchParams(destino.split("?")[1] || "").get("seccion");
    if (destino.startsWith("/finanzas?") && esSeccionLazza(seccion)) setVista(seccion as SeccionFL);
    router.replace(destino);
  }, [router]);
  // Cliente cuya ficha se abre sola en Cuentas corrientes (la campana lleva al ítem: arreglo 8, 27/10/2026).
  const [clienteLink, setClienteLink] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("cliente")));
  // Ya estando en Finanzas, la campana no vuelve a montar la pantalla: avisa con un evento y se abre la sección pedida.
  useEffect(() => {
    const abrir = (e: Event) => {
      const q = new URLSearchParams(String((e as CustomEvent).detail || "").split("?")[1] || "");
      const seccion = q.get("seccion");
      if (!esSeccionLazza(seccion)) return;
      setClienteLink(q.get("cliente"));
      setVista(seccion as SeccionFL);
      window.scrollTo(0, 0);
    };
    window.addEventListener(EVENTO_ABRIR_FINANZAS, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_FINANZAS, abrir);
  }, []);
  const mesActual = periodoDeFecha(todayAR());
  const [periodo, setPeriodo] = useState(mesActual);

  if (loading) return <Header title="Finanzas" />;
  if (role !== "super_admin" && role !== "administrativo") {
    return (
      <div>
        <Header title="Finanzas" />
        <p className="px-4 py-10 text-center text-sm text-zinc-500">No tenés acceso a esta pantalla.</p>
      </div>
    );
  }

  const sociedadId = sociedadActiva?.id;
  // Cheques y Movimientos del banco viven en Bancos; Facturar es una pestaña de Facturas.
  const tarjeta = vista ? TARJETAS.find((t) => t.id === (vista === "cheques" || vista === "movimientos_banco" ? "bancos" : vista === "facturar" ? "facturas" : vista)) : null;
  const conMes = vista === "reportes" || vista === "iva" || vista === "objetivos" || vista === "gastos" || vista === "contabilidad";

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
      // Facturas (19/10): una pantalla para cobrar, pagar y ver facturas; Cobrar y Pagar la abren en Ventas o Compras.
      case "cobrar": return <FinanzasLazzaFacturas key="cobrar" sociedadId={sociedadId} ladoInicial="venta" />;
      case "pagar": return <FinanzasLazzaFacturas key="pagar" sociedadId={sociedadId} ladoInicial="compra" />;
      case "facturas": return <FinanzasLazzaFacturas key="facturas" sociedadId={sociedadId} ladoInicial="venta" />;
      case "facturar": return <FinanzasLazzaFacturas key="facturar" sociedadId={sociedadId} ladoInicial="facturar" />;
      case "cuentas": return <FinanzasLazzaCuentasCorrientes sociedadId={sociedadId} abrirCliente={clienteLink} />;
      case "vencimientos": return <FinanzasLazzaVencimientos sociedadId={sociedadId} />;
      case "ordenes_pago": return <FinanzasLazzaOrdenesPago sociedadId={sociedadId} />;
      case "recibos": return <FinanzasLazzaRecibos sociedadId={sociedadId} />;
      case "retenciones": return <FinanzasLazzaRetenciones sociedadId={sociedadId} />;
      case "iva": return <FinanzasLazzaIva sociedadId={sociedadId} periodo={periodo} />;
      case "bancos": return <FinanzasLazzaBancos sociedadId={sociedadId} />;
      // Cheques ya no es una tarjeta: vive en Bancos > Cheques (23/10). El link ?seccion=cheques sigue funcionando y abre esa pestaña.
      case "cheques": return <FinanzasLazzaBancos key="cheques" sociedadId={sociedadId} pestanaInicial="cheques" />;
      // «Ir a Bancos» del aviso «Falta cargar» abre Movimientos, que es donde se suben los archivos del banco (arreglo 8).
      case "movimientos_banco": return <FinanzasLazzaBancos key="movimientos_banco" sociedadId={sociedadId} pestanaInicial="extracto" />;
      case "movimientos": return <FinanzasLazzaMovimientos sociedadId={sociedadId} />;
      case "objetivos": return <FinanzasLazzaObjetivos sociedadId={sociedadId} periodo={periodo} />;
      case "reportes": return <FinanzasLazzaReportes sociedadId={sociedadId} periodo={periodo} />;
      case "gastos": return <FinanzasLazzaGastos sociedadId={sociedadId} periodo={periodo} />;
      case "contabilidad": return <FinanzasLazzaContabilidad sociedadId={sociedadId} periodo={periodo} />;
      default: return null;
    }
  };

  return (
    <div>
      <Header title="Finanzas" subtitle={sociedadActiva?.nombre || undefined} />
      <div className="space-y-3 px-3 py-3 sm:px-4">
        {vista && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setVista(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-sm text-zinc-600 hover:border-orange-300 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <ArrowLeft className="h-4 w-4" /> Finanzas
              </button>
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">{tarjeta?.nombre ?? NOMBRE_SIN_TARJETA[vista]}</h2>
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
