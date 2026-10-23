"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  DollarSign, FileText, TrendingUp, Percent,
  ArrowRight, Clock, AlertTriangle, Package,
  Loader2, Users, Target,
} from "lucide-react";
import { formatCurrency, formatDateTime, todayAR } from "@/lib/utils";
import { facturadoMesNeto, type FacturadoMes } from "@/lib/facturado-mes";
import Link from "next/link";
import CoberturaFijos from "@/components/cobertura-fijos";
import { useUser } from "@/lib/auth-context";
import {
  dashboardKPIs as mockKPIs,
  mockPresupuestos,
  mockActivity,
  mockAlerts,
  ventasPorMes as mockVentasPorMes,
  presupuestosPorEstado as mockPresupuestosPorEstado,
  mockGastosFijos,
  mockObjetivos,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import {
  equivalenteARS, filtrarParaGestion, inicioDeMesHace, montoFirmado, normalizarMoneda,
  periodoDeFecha, sumarMeses, totalesMensuales,
} from "@/lib/reportes-comprobantes";
import type { Presupuesto, ActivityLog, Alert, GastoFijo, Objetivo } from "@/lib/types";
import { facturaDelMes, pagoDelMes, type FacturaParaGasto, type PagoParaGasto } from "@/lib/gasto-fijo-factura";
import { PendientesWidget } from "@/components/presupuestos/pendientes-widget";

const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "purple" | "outline" | "info" }> = {
  solicitud: { label: "Solicitud", variant: "info" },
  pendiente: { label: "Pendiente", variant: "warning" },
  aprobado: { label: "Aprobado", variant: "success" },
  rechazado: { label: "Rechazado", variant: "danger" },
  postergado: { label: "Postergado", variant: "purple" },
  vencido: { label: "Vencido", variant: "danger" },
};

const alertIcons: Record<string, typeof AlertTriangle> = {
  stock_bajo: Package,
  vencimiento_pr: Clock,
  cheque_proximo: DollarSign,
  seguimiento: FileText,
  cc_vencida: AlertTriangle,
};

const estadoColorMap: Record<string, string> = {
  solicitud: "#3b82f6",
  aprobado: "#22c55e",
  pendiente: "#f59e0b",
  rechazado: "#ef4444",
  postergado: "#8b5cf6",
  vencido: "#dc2626",
};

const estadoLabelMap: Record<string, string> = {
  solicitud: "Solicitudes",
  aprobado: "Aprobados",
  pendiente: "Pendientes",
  rechazado: "Rechazados",
  postergado: "Postergados",
  vencido: "Vencidos",
};

const DASHBOARD_ALERT_LIMIT = 5;

interface ClienteTop { nombre: string; ARS: number; USD: number; equivalente: number }

/** Envuelve traerTodo con la forma { data, error } de Supabase, para usarlo dentro del Promise.all. */
function comoResultado<T>(p: Promise<T[]>): Promise<{ data: T[] | null; error: unknown }> {
  return p.then((data) => ({ data, error: null }), (error) => ({ data: null, error }));
}

function calcChange(current: number, previous: number): number | undefined {
  if (!previous || previous === 0) return undefined;
  return Math.round(((current - previous) / previous) * 100);
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Buenos dias";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

export default function DashboardPage() {
  const { profile, sociedadActiva } = useUser();
  const [loading, setLoading] = useState(true);
  // Margen real del mes (ganancia sobre venta neta), lo informa el recuadro de gastos fijos; null = no disponible (se usa el viejo).
  const [margenMes, setMargenMes] = useState<number | null>(null);
  const [kpi, setKpi] = useState({ ventasMes: 0, ventasMesAnterior: 0, presupuestosActivos: 0, presupuestosPendientes: 0, tasaConversion: 0, tasaConversionAnterior: 0, cobranzasMes: 0, cobranzasPendientes: 0, clientesActivos: 0, stockBajo: 0, facturadoMes: 0, margenPromedio: 0, alertasSinLeer: 0 });
  const [facturadoMonedas, setFacturadoMonedas] = useState({ ARS: 0, USD: 0, anteriorARS: 0 });
  const [facturadoNeto, setFacturadoNeto] = useState<{ actual: FacturadoMes; anteriorARS: number; diaHoy: number } | null>(null);
  const [presupuestosPorEstado, setPresupuestosPorEstado] = useState<{ estado: string; cantidad: number; color: string }[]>([]);
  const [ventasPorMes, setVentasPorMes] = useState<{ mes: string; monto: number }[]>([]);
  const [presupuestos, setPresupuestos] = useState<typeof mockPresupuestos>([]);
  const [alerts, setAlerts] = useState<typeof mockAlerts>([]);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [topClientes, setTopClientes] = useState<ClienteTop[]>([]);
  const [activity, setActivity] = useState<typeof mockActivity>([]);
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([]);
  const [facturasGastos, setFacturasGastos] = useState<FacturaParaGasto[]>([]);
  const [pagosGastos, setPagosGastos] = useState<PagoParaGasto[]>([]);
  const [objetivos, setObjetivos] = useState<Objetivo[]>([]);

  useEffect(() => {
    // Don't fetch until sociedadActiva is loaded
    if (!sociedadActiva?.id) return;
    async function fetchAll() {
      setLoading(true);
      // Reset all state to avoid stale mock data when switching sociedad
      setVentasPorMes([]);
      setPresupuestosPorEstado([]);
      setTopClientes([]);
      setPresupuestos([]);
      setAlerts([]);
      setShowAllAlerts(false);
      setActivity([]);
      setGastosFijos([]);
      setObjetivos([]);
      setFacturadoMonedas({ ARS: 0, USD: 0, anteriorARS: 0 });
      try {
        const sid = sociedadActiva!.id;
        const desde12 = inicioDeMesHace(todayAR(), 11);
        // Todas las páginas (Supabase corta en 1000 filas)
        const qPresupuestosEstado = comoResultado(traerTodo<{ estado: string }>(() => (supabase as any)
          .from("presupuestos")
          .select("id, estado")
          .neq("eliminado", true)
          .eq("sociedad_id", sid)
          .order("id", { ascending: true })));
        // Facturas de los últimos 12 meses (gráfico mensual, facturado del mes y top clientes)
        const qFacturas = comoResultado(traerTodo<any>(() => (supabase as any)
          .from("facturas")
          .select("id, fecha, total, subtotal, moneda, tipo, tipo_cambio, estado, factura_origen_id, cliente_id, clientes(razon_social)")
          .gte("fecha", desde12)
          .neq("estado", "anulada")
          .eq("sociedad_id", sid)
          .order("fecha", { ascending: true })
          .order("id", { ascending: true })));
        // Ids de facturas anuladas: una NC cuya factura ya está anulada no se resta otra vez
        const qAnuladas = comoResultado(traerTodo<{ id: string }>(() => (supabase as any)
          .from("facturas")
          .select("id")
          .eq("estado", "anulada")
          .eq("sociedad_id", sid)
          .order("id", { ascending: true })));
        let qPresupuestosRecent = supabase
          .from("presupuestos")
          .select("id, numero, cliente_id, total, estado, fecha, clientes(razon_social)")
          .neq("eliminado" as any, true)
          .order("created_at", { ascending: false })
          .limit(5);

        qPresupuestosRecent = qPresupuestosRecent.eq("sociedad_id" as any, sid);

        const [
          kpiResult,
          presupuestosEstadoResult,
          presupuestosRecentResult,
          alertasResult,
          anuladasResult,
          activityResult,
          facturasResult,
          gastosFijosResult,
          objetivosResult,
        ] = await Promise.all([
          supabase.rpc("get_dashboard_kpis", { p_sociedad_id: sociedadActiva!.id } as any),
          qPresupuestosEstado,
          qPresupuestosRecent,
          (() => {
            let qAlertas = (supabase as any)
              .from("alertas")
              .select("*")
              .eq("read", false)
              .order("created_at", { ascending: false })
              .eq("sociedad_id", sociedadActiva!.id);
            return qAlertas;
          })(),
          qAnuladas,
          (() => {
            let qActivity = (supabase as any)
              .from("activity_log")
              .select("*, profiles:user_id(full_name)")
              .order("created_at", { ascending: false })
              .limit(10)
              .eq("sociedad_id", sociedadActiva!.id);
            return qActivity;
          })(),
          // Facturación (12 meses)
          qFacturas,
          // Gastos fijos
          (() => {
            let qGastos = (supabase as any)
              .from("gastos_fijos")
              .select("*")
              .eq("activo", true)
              .eq("sociedad_id", sociedadActiva!.id);
            return qGastos;
          })(),
          // Objetivos activos
          (() => {
            let qObjetivos = (supabase as any)
              .from("objetivos")
              .select("*")
              .eq("activo", true)
              .eq("sociedad_id", sociedadActiva!.id);
            return qObjetivos;
          })(),
        ]);

        // --- KPIs ---
        if (!kpiResult.error && kpiResult.data) {
          const d = kpiResult.data as Record<string, number>;
          setKpi({
            ventasMes: d.ventas_mes ?? 0,
            ventasMesAnterior: d.ventas_mes_anterior ?? 0,
            presupuestosActivos: d.presupuestos_activos ?? 0,
            presupuestosPendientes: d.presupuestos_pendientes ?? 0,
            tasaConversion: d.tasa_conversion ?? 0,
            tasaConversionAnterior: d.tasa_conversion_anterior ?? 0,
            cobranzasMes: d.cobranzas_mes ?? 0,
            cobranzasPendientes: d.cobranzas_pendientes ?? 0,
            clientesActivos: d.clientes_activos ?? 0,
            stockBajo: d.stock_bajo ?? 0,
            facturadoMes: d.facturado_mes ?? 0,
            margenPromedio: d.margen_promedio ?? 0,
            alertasSinLeer: d.alertas_sin_leer ?? 0,
          });
        }

        // --- Presupuestos por estado ---
        if (!presupuestosEstadoResult.error && presupuestosEstadoResult.data?.length) {
          const counts: Record<string, number> = {};
          presupuestosEstadoResult.data.forEach((p: { estado: string }) => {
            counts[p.estado] = (counts[p.estado] || 0) + 1;
          });
          const mapped = Object.entries(counts).map(([estado, cantidad]) => ({
            estado: estadoLabelMap[estado] || estado,
            cantidad,
            color: estadoColorMap[estado] || "#a1a1aa",
          }));
          setPresupuestosPorEstado(mapped);
        }

        // --- Facturacion mensual y top clientes ---
        // Mes tomado del texto de la fecha (sin corrimiento de zona horaria), NC en negativo, monedas separadas.
        if (!facturasResult.error && !anuladasResult.error) {
          const vigentes = filtrarParaGestion(facturasResult.data ?? [], (anuladasResult.data ?? []).map((r) => r.id));
          const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
          const porMes = totalesMensuales(vigentes);
          const currentMonth = periodoDeFecha(todayAR());
          const previousMonth = sumarMeses(currentMonth, -1);
          setVentasPorMes(Array.from({ length: 6 }, (_, i) => {
            const key = sumarMeses(currentMonth, i - 5);
            return { mes: monthNames[parseInt(key.split("-")[1]) - 1], monto: porMes[key]?.ARS || 0 };
          }));
          const totals = {
            ARS: porMes[currentMonth]?.ARS || 0,
            USD: porMes[currentMonth]?.USD || 0,
            anteriorARS: porMes[previousMonth]?.ARS || 0,
          };
          setFacturadoMonedas(totals);
          // Facturado del mes SIN IVA (facturas − NC), igual que Finanzas; se compara contra el mismo tramo del mes anterior.
          const idsAnul = (anuladasResult.data ?? []).map((r) => r.id);
          const diaHoy = Number(todayAR().slice(8, 10)) || 1;
          setFacturadoNeto({
            actual: facturadoMesNeto(vigentes as any[], currentMonth, { idsAnulados: idsAnul }),
            anteriorARS: facturadoMesNeto(vigentes as any[], previousMonth, { hastaDia: diaHoy, idsAnulados: idsAnul }).ARS.neto,
            diaHoy,
          });
          setKpi((current) => ({ ...current, facturadoMes: totals.ARS }));

          const porCliente: Record<string, ClienteTop> = {};
          vigentes.forEach((f: any) => {
            const id = f.cliente_id || "?";
            if (!porCliente[id]) porCliente[id] = { nombre: f.clientes?.razon_social || "N/A", ARS: 0, USD: 0, equivalente: 0 };
            const monto = montoFirmado(f);
            porCliente[id][normalizarMoneda(f.moneda)] += monto;
            porCliente[id].equivalente += equivalenteARS(monto, f.moneda, f.tipo_cambio) ?? 0;
          });
          setTopClientes(Object.values(porCliente).sort((a, b) => b.equivalente - a.equivalente).slice(0, 5));
        } else {
          console.error("Error cargando facturas del dashboard:", facturasResult.error || anuladasResult.error);
        }

        // --- Ultimos presupuestos ---
        if (!presupuestosRecentResult.error) {
          setPresupuestos((presupuestosRecentResult.data ?? []).map((p: any) => ({
            ...p,
            clienteNombre: p.clientes?.razon_social || "N/A",
          })));
        }

        // --- Alertas ---
        if (!alertasResult.error) {
          setAlerts((alertasResult.data ?? []).map((a: any) => ({
            id: a.id, type: a.tipo, title: a.title, description: a.description,
            entityId: a.entity_id, module: a.module, read: a.read, createdAt: a.created_at,
          })));
        }

        // --- Actividad reciente ---
        if (!activityResult.error) {
          setActivity((activityResult.data ?? []).map((a: any) => ({
            id: a.id, userId: a.user_id, userName: a.profiles?.full_name || "Usuario",
            action: a.action, module: a.module, entityId: a.entity_id,
            details: a.details, createdAt: a.created_at,
          })));
        }

        // --- Gastos fijos ---
        if (!gastosFijosResult.error) {
          setGastosFijos((gastosFijosResult.data ?? []).map((g: any) => ({
            id: g.id, descripcion: g.descripcion, categoria: g.categoria,
            monto: Number(g.monto), moneda: g.moneda, activo: g.activo,
            notas: g.notas ?? "", createdAt: g.created_at, proveedorId: g.proveedor_id ?? null,
            diaVencimiento: g.dia_vencimiento ?? null, calculo: g.calculo ?? null,
          })));
          // Pagos del mes cargados en Gastos para los gastos fijos (aviso "falta pagar")
          const { data: pagosMes } = await (supabase as any).from("gastos_manuales")
            .select("id, gasto_fijo_id, fecha, monto").eq("sociedad_id", sociedadActiva!.id)
            .not("gasto_fijo_id", "is", null).gte("fecha", `${todayAR().slice(0, 7)}-01`);
          setPagosGastos(((pagosMes ?? []) as any[]).map((r) => ({ ...r, monto: Number(r.monto) })));
          // Facturas del mes de los proveedores de gastos fijos (aviso "falta la factura del mes")
          const provIds = Array.from(new Set((gastosFijosResult.data ?? []).map((g: any) => g.proveedor_id).filter(Boolean))) as string[];
          if (provIds.length > 0) {
            const { data: fcMes } = await (supabase as any).from("facturas_compra")
              .select("id, proveedor_id, fecha, total, estado, tipo_comprobante")
              .eq("sociedad_id", sociedadActiva!.id).in("proveedor_id", provIds).gte("fecha", `${todayAR().slice(0, 7)}-01`);
            setFacturasGastos(((fcMes ?? []) as any[]).map((f) => ({ ...f, total: Number(f.total) })));
          } else setFacturasGastos([]);
        }

        // --- Objetivos ---
        if (!objetivosResult.error) {
          const idsUsuarios = Array.from(new Set((objetivosResult.data ?? []).map((o: any) => o.usuario_id).filter(Boolean)));
          const nombresUsuarios: Record<string, string> = {};
          if (idsUsuarios.length) {
            const { data: perfiles } = await (supabase as any).from("profiles").select("id, full_name").in("id", idsUsuarios);
            for (const p of (perfiles ?? []) as any[]) nombresUsuarios[p.id] = p.full_name;
          }
          setObjetivos((objetivosResult.data ?? []).map((o: any) => ({
            id: o.id, nombre: o.nombre, tipo: o.tipo,
            montoTarget: Number(o.monto_target), moneda: o.moneda,
            periodoInicio: o.periodo_inicio, periodoFin: o.periodo_fin,
            usuarioId: o.usuario_id, usuarioNombre: nombresUsuarios[o.usuario_id] ?? null,
            activo: o.activo, notas: o.notas ?? "", createdAt: o.created_at,
          })));
        }
      } catch (e) {
        console.error("Error fetching dashboard data:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, [sociedadActiva?.id]);

  if (loading) {
    return (
      <>
        <Header title="Dashboard" subtitle="Resumen de operaciones" />
        <div className="p-3 sm:p-5 space-y-4">
          {/* Skeleton KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                  <div className="h-8 w-8 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                </div>
                <div className="mt-3 h-7 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="mt-3 h-3 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            ))}
          </div>
          {/* Skeleton charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700 mb-4" />
              <div className="h-56 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700 mb-4" />
              <div className="h-48 animate-pulse rounded-full mx-auto w-36 bg-zinc-100 dark:bg-zinc-800" />
            </div>
          </div>
        </div>
      </>
    );
  }

  const facturadoChange = facturadoNeto ? calcChange(facturadoNeto.actual.ARS.neto, facturadoNeto.anteriorARS) : undefined;
  const conversionChange = calcChange(kpi.tasaConversion, kpi.tasaConversionAnterior);

  const firstName = profile?.full_name?.split(" ")[0] || "Usuario";
  const userRole = profile?.role ?? "viewer";
  const isAdmin = userRole === "super_admin" || userRole === "admin";

  // Gastos fijos calculation (solo ARS por simplicidad)
  const totalGastosFijos = gastosFijos.filter((g) => g.activo && g.moneda === "ARS").reduce((s, g) => s + g.monto, 0);
  const facturadoMes = kpi.facturadoMes;

  // Objetivos relevantes: admin ve todos, vendedor ve los suyos o globales
  const today = todayAR();
  const objetivosActivos = objetivos.filter((o) =>
    o.activo && o.periodoInicio <= today && o.periodoFin >= today &&
    (isAdmin || !o.usuarioId || o.usuarioId === profile?.id)
  );
  // Avisos de gastos fijos (falta pagar / falta la factura): la tarjeta solo se muestra si hay alguno.
  const hayAvisosFijos = gastosFijos.some((g) => {
    if (!g.proveedorId && g.diaVencimiento) {
      const pm = pagoDelMes(g.id, pagosGastos, todayAR(), g.diaVencimiento);
      return pm.falta && pm.diasAlVencimiento != null && pm.diasAlVencimiento <= 5;
    }
    return !!g.proveedorId && facturaDelMes(g.proveedorId, facturasGastos, todayAR()).falta;
  });
  // El objetivo general del mes ya se ve en el recuadro "¿Cubro los gastos fijos?" (admin y administrativo): acá quedan los individuales.
  const verRecuadroFijos = isAdmin || userRole === "administrativo";
  const objetivosTarjeta = objetivosActivos.filter((o) => !(verRecuadroFijos && !o.usuarioId));
  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, DASHBOARD_ALERT_LIMIT);
  const hiddenAlertsCount = Math.max(alerts.length - DASHBOARD_ALERT_LIMIT, 0);

  return (
    <>
      <Header title="Dashboard" subtitle="Resumen de operaciones" />
      <div className="p-3 sm:p-4 space-y-3">
        {/* Greeting */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
              {getGreeting()}, {firstName}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <div className="flex gap-2">
            {(isAdmin || userRole === "administrativo") && <PendientesWidget />}
            <Link
              href="/presupuestos"
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Nuevo PR</span>
            </Link>
            <Link
              href="/clientes"
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Clientes</span>
            </Link>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Facturado este mes (sin IVA)"
            value={facturadoNeto ? `${formatCurrency(facturadoNeto.actual.ARS.neto)} / ${formatCurrency(facturadoNeto.actual.USD.neto, "USD")}` : "…"}
            detail={facturadoNeto ? `Facturas ${formatCurrency(facturadoNeto.actual.ARS.facturas)} − NC ${formatCurrency(facturadoNeto.actual.ARS.nc)}` : undefined}
            change={facturadoChange}
            changeLabel={facturadoNeto ? `vs. del 1 al ${facturadoNeto.diaHoy} del mes anterior` : undefined}
            icon={DollarSign}
            iconColor="text-emerald-600"
          />
          <StatCard
            title="Presupuestos activos"
            value={String(kpi.presupuestosActivos)}
            icon={FileText}
            iconColor="text-blue-600"
          />
          <StatCard
            title="Tasa de conversion"
            value={`${kpi.tasaConversion}%`}
            change={conversionChange}
            changeLabel="vs. mes anterior"
            icon={Percent}
            iconColor="text-orange-500"
          />
          <StatCard
            title={margenMes !== null ? "Margen del mes" : "Margen promedio"}
            value={margenMes !== null ? `${margenMes.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${kpi.margenPromedio}%`}
            icon={TrendingUp}
            iconColor="text-violet-600"
          />
        </div>

        {/* ¿Cubro los gastos fijos? + ventas del mes: el mismo recuadro que Finanzas > Hoy (cuenta por ganancia, no por facturado) */}
        {verRecuadroFijos && <CoberturaFijos sociedadId={sociedadActiva?.id} onMargen={setMargenMes} />}

        {/* Pagos de gastos fijos pendientes + Objetivos */}
        {((verRecuadroFijos && hayAvisosFijos) || objetivosTarjeta.length > 0) && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Cobertura de gastos - admin y administrativo */}
            {verRecuadroFijos && hayAvisosFijos && (
              <Card>
                <CardHeader>
                  <CardTitle>Gastos fijos por pagar</CardTitle>
                  <Link href="/finanzas" className="flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600">
                    Gestionar <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardHeader>
                <div className="px-6 pb-5 space-y-4">
                  {/* Gastos con vencimiento: avisa desde 5 días antes si todavía no se cargó el pago en Gastos */}
                  {gastosFijos.filter((g) => !g.proveedorId && g.diaVencimiento).map((g) => ({ g, pm: pagoDelMes(g.id, pagosGastos, todayAR(), g.diaVencimiento) }))
                    .filter(({ pm }) => pm.falta && pm.diasAlVencimiento != null && pm.diasAlVencimiento <= 5).map(({ g, pm }) => (
                    <Link key={g.id} href="/finanzas?seccion=gastos" className={`block rounded px-2 py-1 text-xs font-medium ${pm.diasAlVencimiento! <= 0 ? "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300" : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                      ⚠️ {g.descripcion}: falta pagar {pm.mesNombre} ({pm.diasAlVencimiento! < 0 ? `venció el ${g.diaVencimiento}` : pm.diasAlVencimiento === 0 ? "vence hoy" : `vence el ${g.diaVencimiento}`})
                    </Link>
                  ))}
                  {gastosFijos.filter((g) => g.proveedorId && facturaDelMes(g.proveedorId, facturasGastos, todayAR()).falta).map((g) => (
                    <Link key={g.id} href="/finanzas?seccion=gastos" className="block rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300">
                      ⚠️ {g.descripcion}: falta la factura de {facturaDelMes(g.proveedorId, facturasGastos, todayAR()).mesNombre}
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {/* Objetivos */}
            {objetivosTarjeta.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-orange-500" />
                    <CardTitle>Objetivos</CardTitle>
                  </div>
                </CardHeader>
                <div className="px-6 pb-5 space-y-4">
                  {objetivosTarjeta.map((obj) => {
                    // Para vendedores: calcular progreso como % del facturado vs target
                    const facturadoObjetivo = obj.moneda === "USD" ? (facturadoNeto?.actual.USD.neto ?? 0) : (facturadoNeto?.actual.ARS.neto ?? 0);
                    const progreso = obj.montoTarget > 0 ? Math.min(Math.round((facturadoObjetivo / obj.montoTarget) * 100), 999) : 0;
                    return (
                      <div key={obj.id} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{obj.nombre}</span>
                            {obj.usuarioNombre && (
                              <span className="text-[10px] rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-500 dark:bg-zinc-800">{obj.usuarioNombre}</span>
                            )}
                          </div>
                          <span className="text-sm font-bold text-zinc-900 dark:text-white">{progreso}%</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              progreso >= 100 ? "bg-emerald-500" : progreso >= 60 ? "bg-orange-500" : "bg-amber-500"
                            }`}
                            style={{ width: `${Math.min(progreso, 100)}%` }}
                          />
                        </div>
                        {isAdmin && (
                          <p className="text-[10px] text-zinc-500">
                            {formatCurrency(facturadoObjetivo, obj.moneda)} / {formatCurrency(obj.montoTarget, obj.moneda)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Los gráficos históricos (facturación mensual y presupuestos por estado) viven solo en Reportes: acá no se repiten. */}
        <Link href="/reportes" className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-600 hover:border-orange-300 hover:text-orange-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <span>Evolución mensual, presupuestos por estado y comparativas</span>
          <span className="flex items-center gap-1 text-xs font-medium text-orange-500">Ver en Reportes <ArrowRight className="h-3 w-3" /></span>
        </Link>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Ultimos presupuestos */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Ultimos presupuestos</CardTitle>
              <Link href="/presupuestos" className="flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600">
                Ver todos <ArrowRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <DataTable<Presupuesto>
              columns={[
                { key: "numero", label: "N° PR", render: (row) => <span className="font-mono text-xs font-semibold">{row.numero}</span> },
                { key: "clienteNombre", label: "Cliente", render: (row) => <span className="font-medium">{row.clienteNombre}</span> },
                { key: "total", label: "Total", className: "text-right", render: (row) => <span className="font-mono text-right block">{formatCurrency(row.total)}</span> },
                {
                  key: "estado", label: "Estado",
                  render: (row) => {
                    const cfg = statusConfig[row.estado];
                    return cfg ? <Badge variant={cfg.variant}>{cfg.label}</Badge> : <Badge variant="outline">{row.estado}</Badge>;
                  },
                },
                { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-400">{row.fecha}</span> },
              ]}
              data={presupuestos}
              pageSize={5}
            />
          </Card>

          {/* Alertas */}
          <Card className="self-start">
            <CardHeader>
              <CardTitle>Alertas</CardTitle>
              <Badge variant="danger">{alerts.filter((a) => !a.read).length} nuevas</Badge>
            </CardHeader>
            <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
              {visibleAlerts.map((alert) => {
                const Icon = alertIcons[alert.type] || AlertTriangle;
                const moduleLink = alert.module === "presupuestos" ? "/presupuestos" : alert.module === "stock" ? "/stock" : `/${alert.module}`;
                return (
                  <Link
                    key={alert.id}
                    href={moduleLink}
                    className={`flex gap-3 rounded-lg p-3 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      alert.read ? "bg-transparent" : "bg-amber-50 dark:bg-amber-950/30"
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div>
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{alert.description}</p>
                    </div>
                  </Link>
                );
              })}
              {alerts.length === 0 && (
                <p className="py-6 text-center text-sm text-zinc-500">No hay alertas nuevas.</p>
              )}
            </div>
            {hiddenAlertsCount > 0 && (
              <button
                type="button"
                aria-expanded={showAllAlerts}
                onClick={() => setShowAllAlerts((current) => !current)}
                className="mt-4 w-full border-t border-zinc-100 pt-3 text-center text-xs font-medium text-orange-500 transition-colors hover:text-orange-600 dark:border-zinc-800"
              >
                {showAllAlerts ? "Mostrar menos" : `Ver ${hiddenAlertsCount} alertas más`}
              </button>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Top clientes */}
          <Card>
            <CardHeader>
              <CardTitle>Top clientes</CardTitle>
              <span className="text-xs text-zinc-400">Últimos 12 meses · neto de NC</span>
            </CardHeader>
            <div className="space-y-3">
              {topClientes.map((c, i) => {
                const maxFacturado = topClientes[0]?.equivalente || 1;
                const pct = Math.max(0, (c.equivalente / maxFacturado) * 100);
                return (
                  <div key={c.nombre} className="flex items-center gap-3">
                    <span className="w-5 text-right text-xs font-bold text-zinc-400">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{c.nombre}</span>
                        <span className="text-sm font-mono text-zinc-500">
                          {[c.ARS ? formatCurrency(c.ARS) : "", c.USD ? formatCurrency(c.USD, "USD") : ""].filter(Boolean).join(" + ") || formatCurrency(0)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-1.5 rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Actividad reciente */}
          <Card>
            <CardHeader>
              <CardTitle>Actividad reciente</CardTitle>
            </CardHeader>
            <div className="space-y-4">
              {activity.map((a) => (
                <div key={a.id} className="flex gap-3 text-sm">
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-400" />
                  <div>
                    <p className="text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium">{a.userName}</span> — {a.details}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">{formatDateTime(a.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
