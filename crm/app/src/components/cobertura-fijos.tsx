"use client";

// Recuadro de Finanzas → Hoy y del Dashboard: ¿estoy cubriendo los gastos fijos? + ventas del mes contra los escalones del
// objetivo (lib/finanzas-lazza: Mínimo / Bueno / Muy bueno, solo Lazzari).
// Solo informativo (nunca bloquea). La cuenta está en lib/cobertura-fijos.ts (con prueba).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, todayAR } from "@/lib/utils";
import { calcularCobertura, type PRDelMes, type FijoEntrada } from "@/lib/cobertura-fijos";
import { NIVEL_OBJETIVO_TEXTO, escalonesTexto, nivelObjetivo, tieneObjetivos } from "@/lib/finanzas-lazza";
import { TrendingUp } from "lucide-react";

const CLAVE_DOLAR = "lz-dolar-fijos";
const ESTADOS_VENDIDOS = ["aprobado", "facturar", "facturado"];

// Respaldo: el dólar que antes se guardaba en esta compu, hasta que se cargue en Finanzas > Gastos fijos.
function leerDolar(): string {
  try { return localStorage.getItem(CLAVE_DOLAR) || ""; } catch { return ""; }
}

function Mini({ titulo, valor, extra, color }: { titulo: string; valor: string; extra?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{titulo}</p>
      <p className={`font-mono text-sm font-bold ${color || "text-zinc-900 dark:text-white"}`}>{valor}</p>
      {extra && <p className="truncate text-[10px] text-zinc-400" title={extra}>{extra}</p>}
    </div>
  );
}

/** En la versión chica (Finanzas → Hoy) el detalle va plegado. */
function Plegado({ compacto, children }: { compacto?: boolean; children: React.ReactNode }) {
  if (!compacto) return <>{children}</>;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-orange-600 hover:underline">Ver detalle</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Barra({ pct }: { pct: number }) {
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
    </div>
  );
}

export default function CoberturaFijos({ sociedadId, onMargen, compacto }: { sociedadId: string | null | undefined; onMargen?: (margenSobreVentaPct: number | null) => void; compacto?: boolean }) {
  const [prs, setPrs] = useState<PRDelMes[]>([]);
  const [fijos, setFijos] = useState<(FijoEntrada & { descripcion?: string })[]>([]);
  const [prsPorFacturar, setPrsPorFacturar] = useState<PRDelMes[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [dolar, setDolar] = useState("");  // respaldo local, ya no se edita acá
  const [dolarBna, setDolarBna] = useState<number | null>(null);

  useEffect(() => { setDolar(leerDolar()); }, []);

  const hoy = todayAR();
  const mes = hoy.slice(0, 7);
  const diaDelMes = Number(hoy.slice(8, 10)) || 1;
  const diasDelMes = new Date(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 0).getDate();
  const mesSiguiente = Number(hoy.slice(5, 7)) === 12 ? `${Number(hoy.slice(0, 4)) + 1}-01-01` : `${hoy.slice(0, 4)}-${String(Number(hoy.slice(5, 7)) + 1).padStart(2, "0")}-01`;

  useEffect(() => {
    if (!sociedadId) return;
    let vivo = true;
    (async () => {
      setCargando(true); setError("");
      try {
        const db = supabase as any;
        const [prRes, fijosRes, porFacturarRes] = await Promise.all([
          db.from("presupuestos")
            .select("id, estado, moneda, tipo_cambio, tipo_cambio_divisas, modalidad_emision, costo_envio_interno, presupuesto_items(cantidad, precio_venta, precio_costo, costo_moneda)")
            .eq("sociedad_id", sociedadId).eq("eliminado", false).in("estado", ESTADOS_VENDIDOS)
            .gte("fecha", `${mes}-01`).lt("fecha", mesSiguiente),
          db.from("gastos_fijos").select("*").eq("sociedad_id", sociedadId),
          // Falta facturar: todo PR aprobado o en "facturar", de cualquier fecha (no solo del mes).
          db.from("presupuestos")
            .select("id, estado, moneda, tipo_cambio, tipo_cambio_divisas, modalidad_emision, costo_envio_interno, presupuesto_items(cantidad, precio_venta, precio_costo, costo_moneda)")
            .eq("sociedad_id", sociedadId).eq("eliminado", false).in("estado", ["aprobado", "facturar"]),
        ]);
        if (!vivo) return;
        if (prRes.error) throw prRes.error;
        setPrs(((prRes.data || []) as any[]).map((p) => ({
          id: p.id,
          estado: p.estado,
          moneda: p.moneda,
          tipoCambio: p.tipo_cambio,
          tipoCambioDivisas: p.tipo_cambio_divisas,
          modalidadEmision: p.modalidad_emision,
          // Si la migración del envío interno todavía no está, la columna no viene y cuenta 0.
          costoEnvioInterno: Number(p.costo_envio_interno) || 0,
          items: (p.presupuesto_items || []).map((it: any) => ({
            cantidad: Number(it.cantidad) || 0, precioVenta: Number(it.precio_venta) || 0,
            precioCosto: Number(it.precio_costo) || 0, costoMoneda: it.costo_moneda,
          })),
        })));
        setPrsPorFacturar(porFacturarRes?.error ? [] : ((porFacturarRes?.data || []) as any[]).map((p) => ({
          id: p.id, estado: p.estado, moneda: p.moneda, tipoCambio: p.tipo_cambio, tipoCambioDivisas: p.tipo_cambio_divisas,
          modalidadEmision: p.modalidad_emision, costoEnvioInterno: Number(p.costo_envio_interno) || 0,
          items: (p.presupuesto_items || []).map((it: any) => ({
            cantidad: Number(it.cantidad) || 0, precioVenta: Number(it.precio_venta) || 0,
            precioCosto: Number(it.precio_costo) || 0, costoMoneda: it.costo_moneda,
          })),
        })));
        setFijos(((fijosRes.data || []) as any[]).map((g) => ({ descripcion: g.descripcion, monto: Number(g.monto) || 0, moneda: g.moneda || "ARS", activo: !!g.activo, dolar: Number(g.dolar_referencia) > 0 ? Number(g.dolar_referencia) : null })));
      } catch (e: any) {
        if (vivo) setError(e?.message || "No se pudo calcular");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [sociedadId, mes, hoy]);

  // Gastos en US$ sin dólar propio (ej. Natalia Inga, se paga en pesos al dólar billete): dólar BNA billete de hoy.
  const usdSinDolar = fijos.filter((f) => f.activo && f.moneda === "USD" && !(Number(f.dolar) > 0));
  const hayUsdSinDolar = usdSinDolar.length > 0;
  useEffect(() => {
    if (!hayUsdSinDolar) return;
    let vivo = true;
    fetch("/api/cotizacion-bna?modalidad=billetes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d && Number(d.valor_venta) > 0) setDolarBna(Number(d.valor_venta)); })
      .catch(() => { /* sin dólar: queda el aviso */ });
    return () => { vivo = false; };
  }, [hayUsdSinDolar]);
  const dolarNum = dolarBna || Number(String(dolar).replace(",", ".")) || 0;
  const c = useMemo(() => calcularCobertura({ prs, fijos, dolarFijos: dolarNum, diaDelMes, diasDelMes }), [prs, fijos, dolarNum, diaDelMes, diasDelMes]);

  // Avisa al Dashboard el margen real del mes (ganancia sobre venta neta) para su tarjeta "Margen del mes".
  useEffect(() => {
    if (!onMargen || cargando) return;
    onMargen(c.margenSobreVenta === null ? null : Math.round(c.margenSobreVenta * 1000) / 10);
  }, [onMargen, cargando, c.margenSobreVenta]);

  if (!sociedadId) return null;
  const ventaTotal = c.ventaNeta + c.ventaSinCosto;
  // Falta facturar: lo vendido que todavía no tiene factura (PR aprobados o en "facturar").
  const cFalta = calcularCobertura({ prs: prsPorFacturar, fijos: [], dolarFijos: 0, diaDelMes, diasDelMes });
  const faltaFacturar = cFalta.ventaNeta + cFalta.ventaSinCosto;
  const hayFijos = c.fijosARS + c.fijosUSD > 0;
  // Escalón de lo vendido en el mes y la barra contra el próximo.
  const objetivo = tieneObjetivos(sociedadId) ? nivelObjetivo(ventaTotal) : null;
  const pctObjetivo = objetivo ? (objetivo.proximo ? Math.round((ventaTotal / objetivo.proximo.monto) * 100) : 100) : null;
  const textoObjetivo = objetivo ? `${NIVEL_OBJETIVO_TEXTO[objetivo.nivel]}${objetivo.proximo ? ` · faltan ${formatCurrency(objetivo.proximo.falta)} para ${objetivo.proximo.nombre}` : ""}` : null;
  const mesNombre = new Date(`${mes}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long" });

  return (
    <div className={`h-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${compacto ? "p-3" : "p-4"}`}>
      <div className={`${compacto ? "mb-2" : "mb-3"} flex items-center justify-between gap-2`}>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
          <TrendingUp className="h-4 w-4 text-orange-500" /> ¿Cubro los gastos fijos? <span className="font-normal capitalize text-zinc-400">· {mesNombre}</span>
        </h3>
        <Link href="/finanzas?seccion=gastos" className="text-xs text-orange-600 hover:underline">ver gastos fijos</Link>
      </div>

      {error ? (
        <p className="text-xs text-red-600">No se pudo calcular: {error}</p>
      ) : cargando ? (
        <p className="text-xs text-zinc-400">Calculando…</p>
      ) : (
        <>
        {compacto && (
          <div className="grid grid-cols-3 gap-2">
            <Mini titulo="Vendido en el mes" valor={formatCurrency(ventaTotal)} extra={textoObjetivo ?? "sin objetivo"} />
            <Mini titulo="Cubro los fijos" valor={!hayFijos ? "—" : c.coberturaPct === null ? "falta dólar" : `${c.coberturaPct}%`}
              color={c.coberturaPct === null ? undefined : c.coberturaPct >= 100 ? "text-emerald-600" : c.coberturaPct >= 60 ? "text-amber-600" : "text-red-600"}
              extra={c.coberturaPct !== null ? `${formatCurrency(c.ganancia)} de ${formatCurrency(c.fijosTotal || 0)}` : undefined} />
            <Mini titulo="Falta vender" valor={!hayFijos ? "—" : c.faltaVender === 0 ? "Cubierto ✓" : c.faltaVender !== null ? formatCurrency(c.faltaVender) : "—"}
              color={c.faltaVender === 0 ? "text-emerald-600" : undefined} extra={c.margenSobreVenta ? `margen ${((c.margenSobreVenta || 0) * 100).toFixed(1)}%` : undefined} />
          </div>
        )}
        <Plegado compacto={compacto}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* 1) Ventas del mes */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-zinc-500">Vendido en el mes (neto, sin IVA)</p>
            <p className="font-mono text-xl font-bold text-zinc-900 dark:text-white">{formatCurrency(ventaTotal)}</p>
            <p className="text-[11px] text-zinc-500">Falta facturar {formatCurrency(faltaFacturar)} <span className="text-zinc-400">(vendido y aún sin factura, de cualquier mes)</span></p>
            {pctObjetivo !== null && (
              <>
                <Barra pct={pctObjetivo} />
                <p className="text-[11px] text-zinc-500">{textoObjetivo}</p>
                <p className="text-[10px] text-zinc-400">Objetivos (sin IVA): {escalonesTexto()}</p>
              </>
            )}
            <p className="text-[10px] text-zinc-400">Vendido = presupuestos aprobados, a facturar y facturados con fecha del mes. Lo facturado (facturas menos NC) está en la tarjeta de arriba. Todo sin IVA, US$ al tipo de cambio de cada uno.</p>
          </div>

          {/* 2) Cobertura */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-zinc-500">Ganancia vs. gastos fijos</p>
            {!hayFijos ? (
              <p className="text-sm text-zinc-500">Esta sociedad no tiene gastos fijos cargados. <Link href="/finanzas?seccion=gastos" className="text-orange-600 hover:underline">Cargalos acá</Link>.</p>
            ) : c.coberturaPct === null ? (
              <>
                <p className="font-mono text-xl font-bold text-zinc-900 dark:text-white">{formatCurrency(c.ganancia)}</p>
                <p className="text-[11px] text-zinc-500">de ganancia en el mes</p>
                <p className="text-sm text-amber-700 dark:text-amber-300">Falta el dólar del alquiler: cargalo en Gastos fijos (Editar) para ver el porcentaje.</p>
              </>
            ) : (
              <>
                <p className={`font-mono text-xl font-bold ${c.coberturaPct >= 100 ? "text-emerald-600" : c.coberturaPct >= 60 ? "text-amber-600" : "text-red-600"}`}>{c.coberturaPct}%</p>
                <Barra pct={c.coberturaPct} />
                <p className="text-[11px] text-zinc-500">Ganancia {formatCurrency(c.ganancia)} de {formatCurrency(c.fijosTotal || 0)} de fijos</p>
              </>
            )}
            {c.fijosUSD > 0 && c.fijosTotal !== null && (
              <p className="text-[11px] text-zinc-500">
                Incluye US$ {c.fijosUSD} al dólar cargado en <Link href="/finanzas?seccion=gastos" className="text-orange-600 hover:underline">Gastos fijos</Link>
                {hayUsdSinDolar && dolarBna ? ` (${usdSinDolar.map((f) => f.descripcion || "gasto en US$").join(", ")}: dólar BNA billete de hoy ${formatCurrency(dolarBna)})` : ""}.
              </p>
            )}
          </div>

          {/* 3) Cuánto falta */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-zinc-500">¿Cuánto me falta vender?</p>
            {!hayFijos ? (
              <p className="text-sm text-zinc-500">Sin gastos fijos no hay nada que cubrir.</p>
            ) : c.faltaVender === 0 ? (
              <p className="text-sm font-semibold text-emerald-600">Ya cubriste los fijos del mes ✓</p>
            ) : c.faltaVender !== null ? (
              <>
                <p className="font-mono text-xl font-bold text-zinc-900 dark:text-white">{formatCurrency(c.faltaVender)}</p>
                <p className="text-[11px] text-zinc-500">de venta neta, con tu margen del mes ({((c.margenSobreVenta || 0) * 100).toFixed(1)}% sobre la venta)</p>
              </>
            ) : c.fijosTotal === null ? (
              <p className="text-sm text-zinc-500">Falta el dólar del alquiler (Finanzas → Gastos fijos) para calcularlo.</p>
            ) : (
              <p className="text-sm text-zinc-500">Todavía no hay ventas con costo para calcular.</p>
            )}
            {c.gananciaProyectada !== null && c.fijosTotal ? (
              <p className={`text-[11px] ${c.gananciaProyectada >= c.fijosTotal ? "text-emerald-600" : "text-amber-700 dark:text-amber-300"}`}>
                A este ritmo, la ganancia a fin de mes sería {formatCurrency(c.gananciaProyectada)}.
              </p>
            ) : null}
          </div>
        </div>
        </Plegado>
        </>
      )}

      {(c.prSinCosto > 0 || c.prSinTC > 0) && !cargando && !error && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          ⚠️ {c.prSinCosto > 0 && `${c.prSinCosto} venta${c.prSinCosto > 1 ? "s" : ""} del mes sin costo cargado (${formatCurrency(c.ventaSinCosto)}): no suman a la ganancia, la cobertura puede estar más baja o más alta que la real. `}
          {c.prSinTC > 0 && `${c.prSinTC} en US$ sin tipo de cambio: no se cuentan.`}
        </p>
      )}
    </div>
  );
}
