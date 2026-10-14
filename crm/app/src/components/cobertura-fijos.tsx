"use client";

// Recuadro de Finanzas → Hoy y del Dashboard: ¿estoy cubriendo los gastos fijos? + ventas del mes contra el objetivo.
// Solo informativo (nunca bloquea). La cuenta está en lib/cobertura-fijos.ts (con prueba).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, todayAR } from "@/lib/utils";
import { calcularCobertura, type PRDelMes, type FijoEntrada } from "@/lib/cobertura-fijos";
import { Target, TrendingUp } from "lucide-react";

const CLAVE_DOLAR = "lz-dolar-fijos";
const ESTADOS_VENDIDOS = ["aprobado", "facturar", "facturado"];

function leerDolar(): string {
  try { return localStorage.getItem(CLAVE_DOLAR) || ""; } catch { return ""; }
}

function Barra({ pct }: { pct: number }) {
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
    </div>
  );
}

export default function CoberturaFijos({ sociedadId, onMargen }: { sociedadId: string | null | undefined; onMargen?: (margenSobreVentaPct: number | null) => void }) {
  const [prs, setPrs] = useState<PRDelMes[]>([]);
  const [fijos, setFijos] = useState<(FijoEntrada & { descripcion?: string })[]>([]);
  const [objetivo, setObjetivo] = useState<number | null>(null);
  const [prsPorFacturar, setPrsPorFacturar] = useState<PRDelMes[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [dolar, setDolar] = useState("");

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
        const [prRes, fijosRes, objRes, porFacturarRes] = await Promise.all([
          db.from("presupuestos")
            .select("id, estado, moneda, tipo_cambio, tipo_cambio_divisas, modalidad_emision, costo_envio_interno, presupuesto_items(cantidad, precio_venta, precio_costo, costo_moneda)")
            .eq("sociedad_id", sociedadId).eq("eliminado", false).in("estado", ESTADOS_VENDIDOS)
            .gte("fecha", `${mes}-01`).lt("fecha", mesSiguiente),
          db.from("gastos_fijos").select("descripcion, monto, moneda, activo").eq("sociedad_id", sociedadId),
          db.from("objetivos").select("monto_target, moneda, periodo_inicio, periodo_fin, activo, usuario_id").eq("activo", true)
            .lte("periodo_inicio", hoy).gte("periodo_fin", hoy)
            .or(`sociedad_id.is.null,sociedad_id.eq.${sociedadId}`),
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
        setFijos(((fijosRes.data || []) as any[]).map((g) => ({ descripcion: g.descripcion, monto: Number(g.monto) || 0, moneda: g.moneda || "ARS", activo: !!g.activo })));
        const globales = ((objRes.data || []) as any[]).filter((o) => !o.usuario_id && (o.moneda || "ARS") === "ARS");
        setObjetivo(globales.length ? Math.max(...globales.map((o) => Number(o.monto_target) || 0)) : null);
      } catch (e: any) {
        if (vivo) setError(e?.message || "No se pudo calcular");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [sociedadId, mes, hoy]);

  const dolarNum = Number(String(dolar).replace(",", ".")) || 0;
  const c = useMemo(() => calcularCobertura({ prs, fijos, dolarFijos: dolarNum, diaDelMes, diasDelMes }), [prs, fijos, dolarNum, diaDelMes, diasDelMes]);

  // Avisa al Dashboard el margen real del mes (ganancia sobre venta neta) para su tarjeta "Margen del mes".
  useEffect(() => {
    if (!onMargen || cargando) return;
    onMargen(c.margenSobreVenta === null ? null : Math.round(c.margenSobreVenta * 1000) / 10);
  }, [onMargen, cargando, c.margenSobreVenta]);

  function guardarDolar(v: string) {
    setDolar(v);
    try { localStorage.setItem(CLAVE_DOLAR, v); } catch { /* sin guardado: sigue andando */ }
  }

  if (!sociedadId) return null;
  const ventaTotal = c.ventaNeta + c.ventaSinCosto;
  // Falta facturar: lo vendido que todavía no tiene factura (PR aprobados o en "facturar").
  const cFalta = calcularCobertura({ prs: prsPorFacturar, fijos: [], dolarFijos: 0, diaDelMes, diasDelMes });
  const faltaFacturar = cFalta.ventaNeta + cFalta.ventaSinCosto;
  const hayFijos = c.fijosARS + c.fijosUSD > 0;
  const pctObjetivo = objetivo && objetivo > 0 ? Math.round((ventaTotal / objetivo) * 100) : null;
  const mesNombre = new Date(`${mes}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long" });

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
          <TrendingUp className="h-4 w-4 text-orange-500" /> ¿Cubro los gastos fijos? <span className="font-normal capitalize text-zinc-400">· {mesNombre}</span>
        </h3>
        <Link href="/finanzas?tab=gastos_fijos" className="text-xs text-orange-600 hover:underline">ver gastos fijos</Link>
      </div>

      {error ? (
        <p className="text-xs text-red-600">No se pudo calcular: {error}</p>
      ) : cargando ? (
        <p className="text-xs text-zinc-400">Calculando…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* 1) Ventas del mes */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-zinc-500">Vendido en el mes (neto, sin IVA)</p>
            <p className="font-mono text-xl font-bold text-zinc-900 dark:text-white">{formatCurrency(ventaTotal)}</p>
            <p className="text-[11px] text-zinc-500">Falta facturar {formatCurrency(faltaFacturar)} <span className="text-zinc-400">(vendido y aún sin factura, de cualquier mes)</span></p>
            {pctObjetivo !== null ? (
              <>
                <Barra pct={pctObjetivo} />
                <p className="text-[11px] text-zinc-500">{pctObjetivo}% del objetivo de {formatCurrency(objetivo!)}</p>
              </>
            ) : (
              <Link href="/finanzas?tab=objetivos" className="inline-flex items-center gap-1 text-[11px] text-orange-600 hover:underline"><Target className="h-3 w-3" /> Cargá tu objetivo del mes</Link>
            )}
            <p className="text-[10px] text-zinc-400">Vendido = presupuestos aprobados, a facturar y facturados con fecha del mes. Lo facturado (facturas menos NC) está en la tarjeta de arriba. Todo sin IVA, US$ al tipo de cambio de cada uno.</p>
          </div>

          {/* 2) Cobertura */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-zinc-500">Ganancia vs. gastos fijos</p>
            {!hayFijos ? (
              <p className="text-sm text-zinc-500">Esta sociedad no tiene gastos fijos cargados. <Link href="/finanzas?tab=gastos_fijos" className="text-orange-600 hover:underline">Cargalos acá</Link>.</p>
            ) : c.coberturaPct === null ? (
              <>
                <p className="font-mono text-xl font-bold text-zinc-900 dark:text-white">{formatCurrency(c.ganancia)}</p>
                <p className="text-[11px] text-zinc-500">de ganancia en el mes</p>
                <p className="text-sm text-amber-700 dark:text-amber-300">Poné abajo el dólar del alquiler para ver el porcentaje.</p>
              </>
            ) : (
              <>
                <p className={`font-mono text-xl font-bold ${c.coberturaPct >= 100 ? "text-emerald-600" : c.coberturaPct >= 60 ? "text-amber-600" : "text-red-600"}`}>{c.coberturaPct}%</p>
                <Barra pct={c.coberturaPct} />
                <p className="text-[11px] text-zinc-500">Ganancia {formatCurrency(c.ganancia)} de {formatCurrency(c.fijosTotal || 0)} de fijos</p>
              </>
            )}
            {c.fijosUSD > 0 && (
              <label className="flex items-center gap-1 text-[11px] text-zinc-500" title="Dólar que usás para el alquiler (blue). Se guarda solo en esta compu.">
                Alquiler US$ {c.fijosUSD} × dólar
                <input value={dolar} inputMode="decimal" placeholder="ej. 1500" onChange={(e) => guardarDolar(e.target.value)}
                  className="w-20 rounded border border-zinc-200 px-1 py-0.5 text-right font-mono dark:border-zinc-700 dark:bg-zinc-800" />
              </label>
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
              <p className="text-sm text-zinc-500">Falta el dólar del alquiler para calcularlo.</p>
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
      )}

      {(c.prSinCosto > 0 || c.prSinTC > 0) && !cargando && !error && (
        <p className="mt-3 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          ⚠️ {c.prSinCosto > 0 && `${c.prSinCosto} venta${c.prSinCosto > 1 ? "s" : ""} del mes sin costo cargado (${formatCurrency(c.ventaSinCosto)}): no suman a la ganancia, la cobertura puede estar más baja o más alta que la real. `}
          {c.prSinTC > 0 && `${c.prSinTC} en US$ sin tipo de cambio: no se cuentan.`}
        </p>
      )}
    </div>
  );
}
