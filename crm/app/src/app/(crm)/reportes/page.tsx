"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import {
  dashboardKPIs, presupuestosPorEstado, topClientes, mockPresupuestos, mockUsers,
} from "@/lib/mock-data";
import { TrendingUp, Users, FileText, Download, DollarSign, XCircle, Loader2, Percent, Package, BookOpen } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

// ── Comisiones types & helpers ────────────────────────────────────
interface VendedorComision {
  id: string;
  nombre: string;
  presupuestosAprobados: number;
  ventaNeta: number;
  costoTotal: number;
  margen: number;
  comisionVenta: number;
  comisionMargen: number;
  totalComision: number;
}

const COMISION_VENTA_PCT = 3;
const COMISION_MARGEN_PCT = 10;

function buildMockComisiones(): VendedorComision[] {
  const vendedores = mockUsers.filter((u) => u.role === "vendedor");
  return vendedores.map((v) => {
    const aprobados = mockPresupuestos.filter(
      (pr) => pr.creadoPor === v.id && pr.estado === "aprobado"
    );
    const ventaNeta = aprobados.reduce((sum, pr) => sum + pr.subtotal, 0);
    const costoTotal = aprobados.reduce(
      (sum, pr) => sum + pr.items.reduce((s, it) => s + it.precioCosto * it.cantidad, 0),
      0
    );
    const margen = ventaNeta - costoTotal;
    const comisionVenta = ventaNeta * (COMISION_VENTA_PCT / 100);
    const comisionMargen = margen * (COMISION_MARGEN_PCT / 100);
    return {
      id: v.id,
      nombre: v.name,
      presupuestosAprobados: aprobados.length,
      ventaNeta,
      costoTotal,
      margen,
      comisionVenta,
      comisionMargen,
      totalComision: comisionVenta + comisionMargen,
    };
  });
}

// ── Ranking por Articulo types ──────────────────────────────────
interface ArticuloRanking {
  descripcion: string;
  cantidadTotal: number;
  montoTotal: number;
  apariciones: number; // number of facturas/presupuestos where it appears
}

// ── Libro IVA types ──────────────────────────────────────────────
interface LibroIVAVentaRow {
  fecha: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  cuit: string;
  razon_social: string;
  neto_gravado: number;
  iva: number;
  total: number;
  moneda: string;
}

interface LibroIVACompraRow {
  fecha: string;
  numero_factura: string;
  cuit: string;
  razon_social: string;
  neto_gravado: number;
  iva: number;
  percepciones: number;
  total: number;
  moneda: string;
}

const COLORS = ["#f97316", "#3b82f6", "#22c55e", "#ef4444", "#a855f7", "#eab308"];

export default function ReportesPage() {
  const { sociedadActiva } = useUser();
  const [activeTab, setActiveTab] = useState<"comercial" | "comisiones" | "articulos" | "libro_iva">("comercial");
  const [monedaReporte, setMonedaReporte] = useState<"original" | "ARS" | "USD">("original");
  const [tipoCambioReporte, setTipoCambioReporte] = useState<number>(1200);
  const [loading, setLoading] = useState(true);
  const [ventasMensuales, setVentasMensuales] = useState<{ mes: string; total: number }[]>([]);
  const [prEstadoData, setPrEstadoData] = useState<{ name: string; value: number }[]>([]);
  const [topClientesData, setTopClientesData] = useState<{ nombre: string; facturado: number }[]>([]);
  const [comisionesData, setComisionesData] = useState<VendedorComision[]>([]);
  const [comisionesLoading, setComisionesLoading] = useState(true);
  const [articulosData, setArticulosData] = useState<ArticuloRanking[]>([]);
  const [articulosLoading, setArticulosLoading] = useState(true);
  const [articulosSortBy, setArticulosSortBy] = useState<"cantidad" | "monto">("cantidad");
  const [articulosFuente, setArticulosFuente] = useState<"facturas" | "presupuestos" | "ambos">("facturas");

  // Libro IVA
  const [libroIVALoading, setLibroIVALoading] = useState(false);
  const [libroIVAVentas, setLibroIVAVentas] = useState<LibroIVAVentaRow[]>([]);
  const [libroIVACompras, setLibroIVACompras] = useState<LibroIVACompraRow[]>([]);
  const [libroIVASubtab, setLibroIVASubtab] = useState<"ventas" | "compras">("ventas");
  const [libroIVAMes, setLibroIVAMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const now = new Date();
  const mesActual = now.toLocaleString("es-AR", { month: "long", year: "numeric" });


  useEffect(() => {
    async function fetchData() {
      try {
        // Ventas por mes from facturas
        let facturasQuery = supabase
          .from("facturas")
          .select("fecha, total, estado")
          .neq("estado", "anulada");
        if (sociedadActiva?.id) facturasQuery = facturasQuery.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: facturas } = await facturasQuery;

        if (facturas && facturas.length > 0) {
          const byMonth: Record<string, number> = {};
          facturas.forEach((f) => {
            const d = new Date(f.fecha);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            byMonth[key] = (byMonth[key] || 0) + Number(f.total);
          });
          const sorted = Object.entries(byMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-6)
            .map(([key, total]) => {
              const [y, m] = key.split("-");
              const label = new Date(Number(y), Number(m) - 1).toLocaleString("es-AR", { month: "short" });
              return { mes: label, total };
            });
          setVentasMensuales(sorted);
        } else {
          setVentasMensuales([]);
        }

        // PR por estado
        let prsQuery = supabase
          .from("presupuestos")
          .select("estado, total");
        if (sociedadActiva?.id) prsQuery = prsQuery.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: prs } = await prsQuery;

        if (prs && prs.length > 0) {
          const byEstado: Record<string, number> = {};
          prs.forEach((p) => { byEstado[p.estado] = (byEstado[p.estado] || 0) + 1; });
          setPrEstadoData(Object.entries(byEstado).map(([name, value]) => ({ name, value })));
        } else {
          setPrEstadoData(presupuestosPorEstado.map((p) => ({ name: p.estado, value: p.cantidad })));
        }

        // Top clientes
        let topCliQuery = supabase
          .from("facturas")
          .select("clientes(razon_social), total")
          .neq("estado", "anulada");
        if (sociedadActiva?.id) topCliQuery = topCliQuery.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: topCli } = await topCliQuery;

        if (topCli && topCli.length > 0) {
          const byCli: Record<string, number> = {};
          topCli.forEach((f: Record<string, unknown>) => {
            const cli = f.clientes as { razon_social: string } | null;
            const name = cli?.razon_social ?? "Desconocido";
            byCli[name] = (byCli[name] || 0) + Number(f.total);
          });
          const sorted = Object.entries(byCli)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([nombre, facturado]) => ({ nombre, facturado }));
          setTopClientesData(sorted);
        } else {
          setTopClientesData(topClientes);
        }
      } catch {
        setVentasMensuales([]);
        setPrEstadoData([]);
        setTopClientesData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [sociedadActiva]);

  // ── Fetch comisiones data ──────────────────────────────────────
  useEffect(() => {
    async function fetchComisiones() {
      try {
        // Try fetching approved presupuestos with their items and vendedor profiles
        let comPrsQuery = supabase
          .from("presupuestos")
          .select("id, subtotal, created_by, presupuesto_items(cantidad, precio_costo)")
          .eq("estado", "aprobado");
        if (sociedadActiva?.id) comPrsQuery = comPrsQuery.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: prs, error } = await comPrsQuery;

        if (error || !prs || prs.length === 0) {
          setComisionesData(buildMockComisiones());
          return;
        }

        // Get vendedor profiles
        const vendedorIds = [...new Set(prs.map((p) => p.created_by).filter((id): id is string => id != null))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", vendedorIds);

        if (!profiles || profiles.length === 0) {
          setComisionesData(buildMockComisiones());
          return;
        }

        const vendedorMap = new Map(profiles.map((p) => [p.id, p.full_name || "Sin nombre"]));

        // Group by vendedor
        const byVendedor: Record<string, { ventaNeta: number; costoTotal: number; count: number }> = {};
        for (const pr of prs) {
          const vid = pr.created_by;
          if (!vid || !vendedorMap.has(vid)) continue;
          if (!byVendedor[vid]) byVendedor[vid] = { ventaNeta: 0, costoTotal: 0, count: 0 };
          byVendedor[vid].ventaNeta += Number(pr.subtotal) || 0;
          byVendedor[vid].count += 1;
          const items = (pr as Record<string, unknown>).presupuesto_items as { cantidad: number; precio_costo: number }[] | null;
          if (items) {
            byVendedor[vid].costoTotal += items.reduce((s, it) => s + (it.cantidad * it.precio_costo), 0);
          }
        }

        const result: VendedorComision[] = Object.entries(byVendedor).map(([vid, data]) => {
          const margen = data.ventaNeta - data.costoTotal;
          const comisionVenta = data.ventaNeta * (COMISION_VENTA_PCT / 100);
          const comisionMargen = margen * (COMISION_MARGEN_PCT / 100);
          return {
            id: vid,
            nombre: vendedorMap.get(vid) || "Sin nombre",
            presupuestosAprobados: data.count,
            ventaNeta: data.ventaNeta,
            costoTotal: data.costoTotal,
            margen,
            comisionVenta,
            comisionMargen,
            totalComision: comisionVenta + comisionMargen,
          };
        });

        setComisionesData(result.length > 0 ? result : buildMockComisiones());
      } catch {
        setComisionesData(buildMockComisiones());
      } finally {
        setComisionesLoading(false);
      }
    }
    fetchComisiones();
  }, [sociedadActiva]);

  // ── Fetch ranking por articulo ──────────────────────────────────
  useEffect(() => {
    async function fetchArticulos() {
      setArticulosLoading(true);
      try {
        const byDesc: Record<string, { cantidad: number; monto: number; docs: Set<string> }> = {};

        if (articulosFuente === "facturas" || articulosFuente === "ambos") {
          // Get factura_items joined with facturas to filter by sociedad and exclude anuladas
          let facItemsQuery = supabase
            .from("factura_items")
            .select("descripcion, cantidad, subtotal, factura_id, facturas!inner(estado, sociedad_id)");
          if (sociedadActiva?.id) facItemsQuery = facItemsQuery.eq("facturas.sociedad_id" as any, sociedadActiva.id);
          facItemsQuery = facItemsQuery.neq("facturas.estado" as any, "anulada");
          const { data: facItems } = await facItemsQuery;

          if (facItems) {
            facItems.forEach((item: Record<string, unknown>) => {
              const desc = ((item.descripcion as string) || "Sin descripcion").trim();
              if (!byDesc[desc]) byDesc[desc] = { cantidad: 0, monto: 0, docs: new Set() };
              byDesc[desc].cantidad += Number(item.cantidad) || 0;
              byDesc[desc].monto += Number(item.subtotal) || 0;
              byDesc[desc].docs.add(`F-${item.factura_id}`);
            });
          }
        }

        if (articulosFuente === "presupuestos" || articulosFuente === "ambos") {
          // Get presupuesto_items joined with presupuestos (only aprobados)
          let prItemsQuery = supabase
            .from("presupuesto_items")
            .select("descripcion, cantidad, subtotal, presupuesto_id, presupuestos!inner(estado, sociedad_id)")
            .eq("presupuestos.estado" as any, "aprobado");
          if (sociedadActiva?.id) prItemsQuery = prItemsQuery.eq("presupuestos.sociedad_id" as any, sociedadActiva.id);
          const { data: prItems } = await prItemsQuery;

          if (prItems) {
            prItems.forEach((item: Record<string, unknown>) => {
              const desc = ((item.descripcion as string) || "Sin descripcion").trim();
              if (!byDesc[desc]) byDesc[desc] = { cantidad: 0, monto: 0, docs: new Set() };
              byDesc[desc].cantidad += Number(item.cantidad) || 0;
              byDesc[desc].monto += Number(item.subtotal) || 0;
              byDesc[desc].docs.add(`P-${item.presupuesto_id}`);
            });
          }
        }

        const result: ArticuloRanking[] = Object.entries(byDesc).map(([descripcion, data]) => ({
          descripcion,
          cantidadTotal: data.cantidad,
          montoTotal: data.monto,
          apariciones: data.docs.size,
        }));

        setArticulosData(result);
      } catch {
        setArticulosData([]);
      } finally {
        setArticulosLoading(false);
      }
    }
    fetchArticulos();
  }, [sociedadActiva, articulosFuente]);

  // ── Libro IVA fetch ──
  useEffect(() => {
    if (activeTab !== "libro_iva") return;
    async function fetchLibroIVA() {
      setLibroIVALoading(true);
      try {
        const [year, month] = libroIVAMes.split("-").map(Number);
        const desde = `${year}-${String(month).padStart(2, "0")}-01`;
        const hasta = `${year}-${String(month + 1 > 12 ? 1 : month + 1).padStart(2, "0")}-01`;

        // Libro IVA Ventas
        let qVentas = supabase
          .from("facturas")
          .select("fecha, tipo, punto_venta, numero, subtotal, iva, total, moneda, clientes(razon_social, cuit)")
          .gte("fecha", desde)
          .lt("fecha", hasta)
          .neq("estado", "anulada")
          .order("fecha", { ascending: true });
        if (sociedadActiva?.id) qVentas = qVentas.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: ventas } = await qVentas;

        if (ventas) {
          setLibroIVAVentas(ventas.map((f: any) => ({
            fecha: f.fecha,
            tipo: f.tipo,
            punto_venta: f.punto_venta,
            numero: f.numero,
            cuit: f.clientes?.cuit || "",
            razon_social: f.clientes?.razon_social || "",
            neto_gravado: Number(f.subtotal),
            iva: Number(f.iva),
            total: Number(f.total),
            moneda: f.moneda || "ARS",
          })));
        } else {
          setLibroIVAVentas([]);
        }

        // Libro IVA Compras
        let qCompras = (supabase as any)
          .from("facturas_compra")
          .select("fecha, numero_factura, subtotal, iva, percepciones, total, moneda, proveedores:proveedor_id(razon_social, cuit)")
          .gte("fecha", desde)
          .lt("fecha", hasta)
          .order("fecha", { ascending: true });
        if (sociedadActiva?.id) qCompras = qCompras.eq("sociedad_id", sociedadActiva.id);
        const { data: compras } = await qCompras;

        if (compras) {
          setLibroIVACompras(compras.map((f: any) => ({
            fecha: f.fecha,
            numero_factura: f.numero_factura || "",
            cuit: f.proveedores?.cuit || "",
            razon_social: f.proveedores?.razon_social || "",
            neto_gravado: Number(f.subtotal),
            iva: Number(f.iva),
            percepciones: Number(f.percepciones || 0),
            total: Number(f.total),
            moneda: f.moneda || "ARS",
          })));
        } else {
          setLibroIVACompras([]);
        }
      } catch (err) {
        console.error("Error fetching Libro IVA:", err);
        setLibroIVAVentas([]);
        setLibroIVACompras([]);
      } finally {
        setLibroIVALoading(false);
      }
    }
    fetchLibroIVA();
  }, [activeTab, libroIVAMes, sociedadActiva]);

  const articulosSorted = useMemo(() => {
    const sorted = [...articulosData];
    if (articulosSortBy === "cantidad") {
      sorted.sort((a, b) => b.cantidadTotal - a.cantidadTotal);
    } else {
      sorted.sort((a, b) => b.montoTotal - a.montoTotal);
    }
    return sorted;
  }, [articulosData, articulosSortBy]);

  const articulosChartData = useMemo(
    () =>
      articulosSorted.slice(0, 10).map((a) => ({
        nombre: a.descripcion.length > 25 ? a.descripcion.substring(0, 25) + "..." : a.descripcion,
        value: articulosSortBy === "cantidad" ? a.cantidadTotal : a.montoTotal,
      })),
    [articulosSorted, articulosSortBy]
  );

  const rechazados = mockPresupuestos.filter((pr) => pr.motivoRechazo);
  const totalPR = mockPresupuestos.length;
  const ticketPromedio = totalPR > 0 ? mockPresupuestos.reduce((a, pr) => a + pr.total, 0) / totalPR : 0;

  const downloadCSV = useCallback((filename: string, headers: string[], rows: string[][]) => {
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportMetricas = useCallback(() => {
    const rows = [
      ["Tasa de conversion", `${dashboardKPIs.tasaConversion}%`],
      ["Margen promedio", `${dashboardKPIs.margenPromedio}%`],
      ["Ticket promedio", String(ticketPromedio)],
      ["Presupuestos emitidos", String(totalPR)],
      ["Facturado", String(dashboardKPIs.facturadoMes)],
    ];
    downloadCSV(`metricas_${mesActual.replace(/ /g, "_")}`, ["Metrica", "Valor"], rows);
  }, [downloadCSV, mesActual, ticketPromedio, totalPR]);

  const exportComisiones = useCallback(() => {
    const headers = ["Vendedor", "PR Aprobados", "Venta neta", "Costo", "Margen", "Com. venta", "Com. margen", "Total comision"];
    const rows = comisionesData.map((v) => [
      v.nombre, String(v.presupuestosAprobados), String(v.ventaNeta), String(v.costoTotal),
      String(v.margen), String(v.comisionVenta), String(v.comisionMargen), String(v.totalComision),
    ]);
    downloadCSV("comisiones_vendedores", headers, rows);
  }, [downloadCSV, comisionesData]);

  const exportArticulos = useCallback(() => {
    const headers = ["Articulo", "Cantidad total", "Monto total", "Apariciones"];
    const rows = articulosSorted.map((a) => [
      a.descripcion, String(a.cantidadTotal), String(a.montoTotal), String(a.apariciones),
    ]);
    downloadCSV("ranking_articulos", headers, rows);
  }, [downloadCSV, articulosSorted]);

  // Calc rejection percentages dynamically
  const motivoCounts: Record<string, number> = {};
  rechazados.forEach((pr) => {
    const motivo = pr.motivoRechazo?.toLowerCase() || "";
    if (motivo.includes("precio") || motivo.includes("caro") || motivo.includes("cost")) {
      motivoCounts["Precio"] = (motivoCounts["Precio"] || 0) + 1;
    } else if (motivo.includes("plazo") || motivo.includes("entrega") || motivo.includes("tiempo")) {
      motivoCounts["Plazo de entrega"] = (motivoCounts["Plazo de entrega"] || 0) + 1;
    } else {
      motivoCounts["Otros"] = (motivoCounts["Otros"] || 0) + 1;
    }
  });
  const totalRechazos = rechazados.length || 1;

  const comisionesChartData = useMemo(
    () =>
      comisionesData.map((v) => ({
        nombre: v.nombre.split(" ")[0],
        "Comision por venta": Math.round(v.comisionVenta),
        "Comision por margen": Math.round(v.comisionMargen),
      })),
    [comisionesData]
  );

  const totalComisionesGeneral = useMemo(
    () => comisionesData.reduce((s, v) => s + v.totalComision, 0),
    [comisionesData]
  );

  // ── Multi-currency conversion ──────────────────────────────────
  const convertMonto = useCallback(
    (monto: number, monedaOriginal: string): number => {
      if (monedaReporte === "original") return monto;
      const orig = (monedaOriginal || "ARS").toUpperCase();
      const target = monedaReporte;
      if (orig === target) return monto;
      // orig=ARS, target=USD → divide by TC
      if (orig === "ARS" && target === "USD") return monto / tipoCambioReporte;
      // orig=USD, target=ARS → multiply by TC
      if (orig === "USD" && target === "ARS") return monto * tipoCambioReporte;
      return monto;
    },
    [monedaReporte, tipoCambioReporte]
  );

  /** Format currency with conversion applied. monedaOriginal defaults to ARS. */
  const fc = useCallback(
    (monto: number, monedaOriginal: string = "ARS"): string => {
      const converted = convertMonto(monto, monedaOriginal);
      const displayCurrency: "USD" | "ARS" =
        monedaReporte === "original"
          ? (monedaOriginal.toUpperCase() as "USD" | "ARS") || "ARS"
          : monedaReporte;
      return formatCurrency(converted, displayCurrency);
    },
    [convertMonto, monedaReporte]
  );

  if (loading) {
    return (
      <>
        <Header title="Reportes" subtitle="Cargando datos..." />
        <div className="flex items-center justify-center p-16">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Reportes" subtitle="Analisis comercial y operativo" />

      {/* Tab navigation */}
      <div className="px-8 pt-6">
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          <button
            onClick={() => setActiveTab("comercial")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "comercial"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Analisis comercial
            </span>
          </button>
          <button
            onClick={() => setActiveTab("comisiones")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "comisiones"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <Percent className="h-4 w-4" />
              Comisiones
            </span>
          </button>
          <button
            onClick={() => setActiveTab("articulos")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "articulos"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Ranking por Articulo
            </span>
          </button>
          <button
            onClick={() => setActiveTab("libro_iva")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "libro_iva"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Libro IVA
            </span>
          </button>
        </div>
      </div>

      {/* Currency selector */}
      <div className="px-8 pt-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Moneda:</span>
        <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-600 overflow-hidden">
          {([
            { key: "original" as const, label: "Original" },
            { key: "ARS" as const, label: "Todo en ARS" },
            { key: "USD" as const, label: "Todo en USD" },
          ]).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setMonedaReporte(opt.key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                monedaReporte === opt.key
                  ? "bg-orange-500 text-white"
                  : "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {monedaReporte !== "original" && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-zinc-500">TC (1 USD =</label>
            <input
              type="number"
              min={1}
              step={10}
              value={tipoCambioReporte}
              onChange={(e) => setTipoCambioReporte(Number(e.target.value) || 1)}
              className="w-24 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
            <span className="text-sm text-zinc-500">ARS)</span>
          </div>
        )}
      </div>

      {/* Tab: Analisis comercial */}
      {activeTab === "comercial" && (
      <div className="p-4 sm:p-8 space-y-6">
        {/* Charts row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Ventas mensuales */}
          <Card>
            <CardHeader>
              <CardTitle>Facturacion mensual</CardTitle>
            </CardHeader>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ventasMensuales.map((d) => ({ ...d, total: convertMonto(d.total, "ARS") }))}>
                  <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => fc(Number(v))} />
                  <Bar dataKey="total" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* PR por estado */}
          <Card>
            <CardHeader>
              <CardTitle>Presupuestos por estado</CardTitle>
            </CardHeader>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={prEstadoData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {prEstadoData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Metricas clave */}
          <Card>
            <CardHeader>
              <CardTitle>Metricas clave — {mesActual}</CardTitle>
              <button onClick={exportMetricas} className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                <Download className="h-3.5 w-3.5" /> Exportar
              </button>
            </CardHeader>
            <div className="space-y-4">
              {[
                { label: "Tasa de conversion", value: `${dashboardKPIs.tasaConversion}%`, prev: `${dashboardKPIs.tasaConversionAnterior}%`, up: dashboardKPIs.tasaConversion > dashboardKPIs.tasaConversionAnterior },
                { label: "Margen promedio", value: `${dashboardKPIs.margenPromedio}%`, prev: "—", up: false },
                { label: "Ticket promedio", value: fc(ticketPromedio), prev: "—", up: false },
                { label: "Presupuestos emitidos", value: String(totalPR), prev: "—", up: false },
                { label: "Facturado", value: fc(dashboardKPIs.facturadoMes), prev: fc(dashboardKPIs.ventasMesAnterior), up: dashboardKPIs.facturadoMes > dashboardKPIs.ventasMesAnterior },
              ].map((m) => (
                <div key={m.label} className="flex items-center justify-between py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{m.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400">{m.prev}</span>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-white">{m.value}</span>
                    <TrendingUp className={`h-3.5 w-3.5 ${m.up ? "text-emerald-500" : "text-red-500 rotate-180"}`} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Analisis de rechazos */}
          <Card>
            <CardHeader>
              <CardTitle>Analisis de motivos de rechazo</CardTitle>
              <Badge variant="danger">{rechazados.length} rechazados</Badge>
            </CardHeader>
            <div className="space-y-4">
              {Object.entries(motivoCounts).map(([motivo, count]) => {
                const pct = Math.round((count / totalRechazos) * 100);
                const color = motivo === "Precio" ? "bg-red-500" : motivo === "Plazo de entrega" ? "bg-amber-500" : "bg-zinc-400";
                return (
                  <div key={motivo} className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium">{motivo}</span>
                      <span className="text-sm font-bold">{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {rechazados.slice(0, 5).map((pr) => (
                <div key={pr.id} className="flex gap-3 rounded-lg border border-red-100 p-3 dark:border-red-900">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <div>
                    <p className="text-sm font-medium">{pr.numero} — {pr.clienteNombre}</p>
                    <p className="text-xs text-zinc-500">{pr.motivoRechazo}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Top clientes */}
        <Card>
          <CardHeader>
            <CardTitle>Ranking de clientes por facturacion</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">Cliente</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Facturado</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">% del total</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">Barra</th>
                </tr>
              </thead>
              <tbody>
                {topClientesData.map((c, i) => {
                  const totalFact = topClientesData.reduce((a, x) => a + x.facturado, 0);
                  const pct = totalFact > 0 ? ((c.facturado / totalFact) * 100).toFixed(1) : "0";
                  const maxFact = topClientesData[0]?.facturado || 1;
                  return (
                    <tr key={c.nombre} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="px-4 py-3 text-sm font-bold text-zinc-400">{i + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">{c.nombre}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right">{fc(c.facturado)}</td>
                      <td className="px-4 py-3 text-sm text-right text-zinc-500">{pct}%</td>
                      <td className="px-4 py-3 w-40">
                        <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className="h-2 rounded-full bg-orange-500" style={{ width: `${(c.facturado / maxFact) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      )}

      {/* Tab: Ranking por Articulo */}
      {activeTab === "articulos" && (
      <div className="p-4 sm:p-8 space-y-6">
        {articulosLoading ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </div>
        ) : (
          <>
            {/* Controls row */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Source selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Fuente:</span>
                <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-600 overflow-hidden">
                  {([
                    { key: "facturas" as const, label: "Facturas" },
                    { key: "presupuestos" as const, label: "PR aprobados" },
                    { key: "ambos" as const, label: "Ambos" },
                  ]).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setArticulosFuente(opt.key)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        articulosFuente === opt.key
                          ? "bg-orange-500 text-white"
                          : "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Sort toggle */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Ordenar por:</span>
                <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-600 overflow-hidden">
                  {([
                    { key: "cantidad" as const, label: "Cantidad" },
                    { key: "monto" as const, label: "Monto" },
                  ]).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setArticulosSortBy(opt.key)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        articulosSortBy === opt.key
                          ? "bg-orange-500 text-white"
                          : "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-orange-600 bg-orange-50">
                  <Package className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{articulosData.length}</h3>
                <p className="mt-1 text-sm text-zinc-500">Articulos distintos</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-blue-600 bg-blue-50">
                  <FileText className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">
                  {articulosData.reduce((s, a) => s + a.apariciones, 0)}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">Total documentos</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-emerald-600 bg-emerald-50">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">
                  {articulosData.reduce((s, a) => s + a.cantidadTotal, 0).toLocaleString("es-AR")}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">Unidades vendidas</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-violet-600 bg-violet-50">
                  <DollarSign className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">
                  {fc(articulosData.reduce((s, a) => s + a.montoTotal, 0))}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">Monto total</p>
              </Card>
            </div>

            {/* Top 10 chart */}
            {articulosChartData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Top 10 articulos por {articulosSortBy === "cantidad" ? "cantidad" : "monto"}</CardTitle>
                </CardHeader>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={articulosChartData} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <XAxis
                        type="number"
                        tickFormatter={(v) =>
                          articulosSortBy === "monto"
                            ? `${(v / 1000).toFixed(0)}K`
                            : String(v)
                        }
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis type="category" dataKey="nombre" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(v) =>
                          articulosSortBy === "monto"
                            ? fc(Number(v))
                            : Number(v).toLocaleString("es-AR")
                        }
                      />
                      <Bar dataKey="value" fill="#f97316" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* Full table */}
            <Card>
              <CardHeader>
                <CardTitle>Ranking completo de articulos</CardTitle>
                <button onClick={exportArticulos} className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                  <Download className="h-3.5 w-3.5" /> Exportar
                </button>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">Articulo</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">
                        <button
                          onClick={() => setArticulosSortBy("cantidad")}
                          className={`inline-flex items-center gap-1 ${articulosSortBy === "cantidad" ? "text-orange-600 dark:text-orange-400" : ""}`}
                        >
                          Cantidad {articulosSortBy === "cantidad" && <TrendingUp className="h-3 w-3 rotate-180" />}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">
                        <button
                          onClick={() => setArticulosSortBy("monto")}
                          className={`inline-flex items-center gap-1 ${articulosSortBy === "monto" ? "text-orange-600 dark:text-orange-400" : ""}`}
                        >
                          Monto total {articulosSortBy === "monto" && <TrendingUp className="h-3 w-3 rotate-180" />}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-zinc-500">Apariciones</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">Barra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {articulosSorted.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-500">
                          No se encontraron articulos para la fuente seleccionada
                        </td>
                      </tr>
                    ) : (
                      articulosSorted.map((a, i) => {
                        const maxVal = articulosSortBy === "cantidad"
                          ? articulosSorted[0]?.cantidadTotal || 1
                          : articulosSorted[0]?.montoTotal || 1;
                        const currentVal = articulosSortBy === "cantidad" ? a.cantidadTotal : a.montoTotal;
                        const barPct = (currentVal / maxVal) * 100;
                        return (
                          <tr key={a.descripcion} className="border-b border-zinc-100 dark:border-zinc-800">
                            <td className="px-4 py-3 text-sm font-bold text-zinc-400">{i + 1}</td>
                            <td className="px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200 max-w-xs truncate" title={a.descripcion}>
                              {a.descripcion}
                            </td>
                            <td className="px-4 py-3 text-sm font-mono text-right">{a.cantidadTotal.toLocaleString("es-AR")}</td>
                            <td className="px-4 py-3 text-sm font-mono text-right">{fc(a.montoTotal)}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              <Badge variant="outline">{a.apariciones}</Badge>
                            </td>
                            <td className="px-4 py-3 w-40">
                              <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                                <div className="h-2 rounded-full bg-orange-500" style={{ width: `${barPct}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
      )}

      {/* Tab: Comisiones */}
      {activeTab === "comisiones" && (
      <div className="p-4 sm:p-8 space-y-6">
        {comisionesLoading ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-orange-600 bg-orange-50">
                  <Users className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{comisionesData.length}</h3>
                <p className="mt-1 text-sm text-zinc-500">Vendedores</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-emerald-600 bg-emerald-50">
                  <FileText className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{comisionesData.reduce((s, v) => s + v.presupuestosAprobados, 0)}</h3>
                <p className="mt-1 text-sm text-zinc-500">Presupuestos aprobados</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-blue-600 bg-blue-50">
                  <DollarSign className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{fc(comisionesData.reduce((s, v) => s + v.ventaNeta, 0))}</h3>
                <p className="mt-1 text-sm text-zinc-500">Total venta neta</p>
              </Card>
              <Card>
                <div className="rounded-lg p-2.5 w-fit text-violet-600 bg-violet-50">
                  <Percent className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-white">{fc(totalComisionesGeneral)}</h3>
                <p className="mt-1 text-sm text-zinc-500">Total comisiones</p>
              </Card>
            </div>

            {/* Commission rates info */}
            <div className="flex flex-wrap gap-3">
              <Badge variant="info">Comision por venta neta: {COMISION_VENTA_PCT}%</Badge>
              <Badge variant="success">Comision por margen: {COMISION_MARGEN_PCT}%</Badge>
            </div>

            {/* Summary table */}
            <Card>
              <CardHeader>
                <CardTitle>Comisiones por vendedor</CardTitle>
                <button onClick={exportComisiones} className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                  <Download className="h-3.5 w-3.5" /> Exportar
                </button>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-500">Vendedor</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-zinc-500">PR Aprobados</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Venta neta</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Costo</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Margen</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Com. venta ({COMISION_VENTA_PCT}%)</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Com. margen ({COMISION_MARGEN_PCT}%)</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Total comision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comisionesData.map((v) => (
                      <tr key={v.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">{v.nombre}</td>
                        <td className="px-4 py-3 text-sm text-center">
                          <Badge variant={v.presupuestosAprobados > 0 ? "success" : "outline"}>{v.presupuestosAprobados}</Badge>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-right">{fc(v.ventaNeta)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right text-zinc-500">{fc(v.costoTotal)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right">
                          <span className={v.margen > 0 ? "text-emerald-600" : "text-red-500"}>{fc(v.margen)}</span>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-right text-blue-600 dark:text-blue-400">{fc(v.comisionVenta)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right text-emerald-600 dark:text-emerald-400">{fc(v.comisionMargen)}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right font-bold text-orange-600 dark:text-orange-400">{fc(v.totalComision)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/50">
                      <td className="px-4 py-3 text-sm font-bold text-zinc-900 dark:text-white">Total</td>
                      <td className="px-4 py-3 text-sm text-center font-bold">{comisionesData.reduce((s, v) => s + v.presupuestosAprobados, 0)}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold">{fc(comisionesData.reduce((s, v) => s + v.ventaNeta, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-zinc-500">{fc(comisionesData.reduce((s, v) => s + v.costoTotal, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-emerald-600">{fc(comisionesData.reduce((s, v) => s + v.margen, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-blue-600">{fc(comisionesData.reduce((s, v) => s + v.comisionVenta, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-emerald-600">{fc(comisionesData.reduce((s, v) => s + v.comisionMargen, 0))}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right font-bold text-orange-600 dark:text-orange-400">{fc(totalComisionesGeneral)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            {/* Bar chart: commission comparison */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Comparativa de comisiones por vendedor</CardTitle>
                </CardHeader>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comisionesChartData.map((d) => ({ ...d, "Comision por venta": convertMonto(d["Comision por venta"], "ARS"), "Comision por margen": convertMonto(d["Comision por margen"], "ARS") }))} barGap={4}>
                      <XAxis dataKey="nombre" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => fc(Number(v))} />
                      <Legend />
                      <Bar dataKey="Comision por venta" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Comision por margen" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Breakdown detail cards */}
              <div className="space-y-4">
                {comisionesData.map((v) => {
                  const margenPct = v.ventaNeta > 0 ? ((v.margen / v.ventaNeta) * 100).toFixed(1) : "0";
                  return (
                    <Card key={v.id}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">{v.nombre}</h4>
                          <p className="text-xs text-zinc-500">{v.presupuestosAprobados} presupuesto{v.presupuestosAprobados !== 1 ? "s" : ""} aprobado{v.presupuestosAprobados !== 1 ? "s" : ""}</p>
                        </div>
                        <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{fc(v.totalComision)}</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Venta neta</span>
                          <span className="font-mono font-medium">{fc(v.ventaNeta)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Margen ({margenPct}%)</span>
                          <span className="font-mono font-medium text-emerald-600">{fc(v.margen)}</span>
                        </div>
                        <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1" />
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-blue-600 dark:text-blue-400">Com. {COMISION_VENTA_PCT}% s/ venta</span>
                          <span className="font-mono font-medium text-blue-600 dark:text-blue-400">{fc(v.comisionVenta)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-emerald-600 dark:text-emerald-400">Com. {COMISION_MARGEN_PCT}% s/ margen</span>
                          <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">{fc(v.comisionMargen)}</span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
      )}

      {/* Tab: Libro IVA */}
      {activeTab === "libro_iva" && (
      <div className="p-4 sm:p-8 space-y-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-600 overflow-hidden">
            <button
              onClick={() => setLibroIVASubtab("ventas")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${libroIVASubtab === "ventas" ? "bg-orange-500 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300"}`}
            >
              IVA Ventas
            </button>
            <button
              onClick={() => setLibroIVASubtab("compras")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${libroIVASubtab === "compras" ? "bg-orange-500 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300"}`}
            >
              IVA Compras
            </button>
          </div>
          <input
            type="month"
            value={libroIVAMes}
            onChange={(e) => setLibroIVAMes(e.target.value)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
          <button
            onClick={() => {
              const isVentas = libroIVASubtab === "ventas";
              const headers = isVentas
                ? ["Fecha", "Tipo", "PV", "Numero", "CUIT", "Razon Social", "Neto Gravado", "IVA", "Total", "Moneda"]
                : ["Fecha", "N Factura", "CUIT", "Razon Social", "Neto Gravado", "IVA", "Percepciones", "Total", "Moneda"];
              const rows = isVentas
                ? libroIVAVentas.map((r) => [r.fecha, r.tipo, String(r.punto_venta), String(r.numero), r.cuit, r.razon_social, r.neto_gravado.toFixed(2), r.iva.toFixed(2), r.total.toFixed(2), r.moneda])
                : libroIVACompras.map((r) => [r.fecha, r.numero_factura, r.cuit, r.razon_social, r.neto_gravado.toFixed(2), r.iva.toFixed(2), r.percepciones.toFixed(2), r.total.toFixed(2), r.moneda]);
              downloadCSV(`libro_iva_${libroIVASubtab}_${libroIVAMes}.csv`, headers, rows);
            }}
            className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            <Download className="h-4 w-4" /> Exportar CSV
          </button>
        </div>

        {libroIVALoading ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </div>
        ) : libroIVASubtab === "ventas" ? (
          <>
            {/* Totals */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <h3 className="text-sm text-zinc-500">Neto gravado</h3>
                <p className="mt-1 text-lg font-bold font-mono text-zinc-900 dark:text-white">{fc(libroIVAVentas.reduce((s, r) => s + r.neto_gravado, 0))}</p>
              </Card>
              <Card>
                <h3 className="text-sm text-zinc-500">IVA débito fiscal</h3>
                <p className="mt-1 text-lg font-bold font-mono text-blue-600">{fc(libroIVAVentas.reduce((s, r) => s + r.iva, 0))}</p>
              </Card>
              <Card>
                <h3 className="text-sm text-zinc-500">Total facturado</h3>
                <p className="mt-1 text-lg font-bold font-mono text-orange-600">{fc(libroIVAVentas.reduce((s, r) => s + r.total, 0))}</p>
              </Card>
            </div>

            {libroIVAVentas.length === 0 ? (
              <Card><p className="text-center text-sm text-zinc-400 py-8">No hay facturas de venta en el período seleccionado</p></Card>
            ) : (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-700">
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">Fecha</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">Tipo</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">Comprobante</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">CUIT</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">Razón Social</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-zinc-500">Neto</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-zinc-500">IVA</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-zinc-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {libroIVAVentas.map((r, i) => (
                        <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{new Date(r.fecha + "T00:00:00").toLocaleDateString("es-AR")}</td>
                          <td className="px-3 py-2"><Badge variant="outline">{r.tipo}</Badge></td>
                          <td className="px-3 py-2 text-sm font-mono">{String(r.punto_venta).padStart(5, "0")}-{String(r.numero).padStart(8, "0")}</td>
                          <td className="px-3 py-2 text-sm font-mono text-zinc-500">{r.cuit}</td>
                          <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 max-w-[200px] truncate">{r.razon_social}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right">{fc(r.neto_gravado)}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right text-blue-600">{fc(r.iva)}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right font-semibold">{fc(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/50">
                        <td colSpan={5} className="px-3 py-2.5 text-sm font-bold">Totales ({libroIVAVentas.length} comprobantes)</td>
                        <td className="px-3 py-2.5 text-sm font-mono text-right font-bold">{fc(libroIVAVentas.reduce((s, r) => s + r.neto_gravado, 0))}</td>
                        <td className="px-3 py-2.5 text-sm font-mono text-right font-bold text-blue-600">{fc(libroIVAVentas.reduce((s, r) => s + r.iva, 0))}</td>
                        <td className="px-3 py-2.5 text-sm font-mono text-right font-bold text-orange-600">{fc(libroIVAVentas.reduce((s, r) => s + r.total, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            )}
          </>
        ) : (
          <>
            {/* Compras totals */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <Card>
                <h3 className="text-sm text-zinc-500">Neto gravado</h3>
                <p className="mt-1 text-lg font-bold font-mono text-zinc-900 dark:text-white">{fc(libroIVACompras.reduce((s, r) => s + r.neto_gravado, 0))}</p>
              </Card>
              <Card>
                <h3 className="text-sm text-zinc-500">IVA crédito fiscal</h3>
                <p className="mt-1 text-lg font-bold font-mono text-emerald-600">{fc(libroIVACompras.reduce((s, r) => s + r.iva, 0))}</p>
              </Card>
              <Card>
                <h3 className="text-sm text-zinc-500">Percepciones</h3>
                <p className="mt-1 text-lg font-bold font-mono text-violet-600">{fc(libroIVACompras.reduce((s, r) => s + r.percepciones, 0))}</p>
              </Card>
              <Card>
                <h3 className="text-sm text-zinc-500">Total</h3>
                <p className="mt-1 text-lg font-bold font-mono text-orange-600">{fc(libroIVACompras.reduce((s, r) => s + r.total, 0))}</p>
              </Card>
            </div>

            {libroIVACompras.length === 0 ? (
              <Card><p className="text-center text-sm text-zinc-400 py-8">No hay facturas de compra en el período seleccionado</p></Card>
            ) : (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-700">
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">Fecha</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">N° Factura</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">CUIT</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-zinc-500">Razón Social</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-zinc-500">Neto</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-zinc-500">IVA</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-zinc-500">Percep.</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-zinc-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {libroIVACompras.map((r, i) => (
                        <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{new Date(r.fecha + "T00:00:00").toLocaleDateString("es-AR")}</td>
                          <td className="px-3 py-2 text-sm font-mono">{r.numero_factura}</td>
                          <td className="px-3 py-2 text-sm font-mono text-zinc-500">{r.cuit}</td>
                          <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 max-w-[200px] truncate">{r.razon_social}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right">{fc(r.neto_gravado)}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right text-emerald-600">{fc(r.iva)}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right text-violet-600">{fc(r.percepciones)}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right font-semibold">{fc(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/50">
                        <td colSpan={4} className="px-3 py-2.5 text-sm font-bold">Totales ({libroIVACompras.length} comprobantes)</td>
                        <td className="px-3 py-2.5 text-sm font-mono text-right font-bold">{fc(libroIVACompras.reduce((s, r) => s + r.neto_gravado, 0))}</td>
                        <td className="px-3 py-2.5 text-sm font-mono text-right font-bold text-emerald-600">{fc(libroIVACompras.reduce((s, r) => s + r.iva, 0))}</td>
                        <td className="px-3 py-2.5 text-sm font-mono text-right font-bold text-violet-600">{fc(libroIVACompras.reduce((s, r) => s + r.percepciones, 0))}</td>
                        <td className="px-3 py-2.5 text-sm font-mono text-right font-bold text-orange-600">{fc(libroIVACompras.reduce((s, r) => s + r.total, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
      )}
    </>
  );
}
