"use client";

// Finanzas Lazza → Bancos (Tanda 3, 19/10/2026; diseño con Augusto 18/10):
// - Cuentas: saldo según el banco y su fecha (aviso si tiene más de 3 días), efectivo y BAVSA (US$; en $ lo que debe y el
//   vencimiento de la caución, leídos de las observaciones; si no están, "a definir"). Sin extractos acá.
// - Tarjetas: por resumen. "Subir resumen" → la IA lee el PDF (api/finanzas/leer-resumen-tarjeta) → Augusto revisa y guarda (tarjeta_resumenes).
// - Préstamos en dos partes: "Lo que debo" y "Lo que me deben", cada uno con su lista de cuotas o pagos (fecha, monto, falta).
//   Los de la familia no tienen cuotas fijas: "Anotar pago" agrega el pago como cuota pagada.
// 20/10 (Augusto): todo en tarjetas, pestañas "Cuentas y tarjetas" | "Préstamos"; en las cuotas del banco capital, interés y cargos
//   (lo que mostraba Finanzas vieja) y "Marcar pagada" / "Desmarcar".
// Cálculos en lib/bancos-lazza. Sin la migración 20261019120000 muestra lo que hay y avisa.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, CreditCard, Landmark, Loader2, Plus, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { diasDesde, pesosDeObservaciones, resumenPrestamo, type CuotaPrestamo } from "@/lib/bancos-lazza";
import { FinanzasLazzaCheques } from "./cheques";
import { CargarEstadoCheques } from "./cheques-reportes";
import FinanzasParaConfirmar from "@/components/finanzas-para-confirmar";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));
const mon = (m: unknown): "ARS" | "USD" => (m === "USD" ? "USD" : "ARS");
const TIPO_CUENTA: Record<string, string> = { cuenta_corriente: "Cuenta corriente", caja_ahorro: "Caja de ahorro", fci: "Inversión", efectivo: "Efectivo", tarjeta_credito: "Tarjeta" };

interface Cuenta { id: string; nombre: string; tipo: string; banco: string | null; numero: string | null; moneda: "ARS" | "USD"; saldo_banco: number | null; saldo_banco_fecha: string | null; saldo_inicial: number | null; fecha_corte: string; observaciones: string | null; orden: number }
interface Prestamo {
  id: string; nombre: string; entidad: string; paga_nombre: string | null; moneda: "ARS" | "USD"; capital_total: number | null; sentido: "debo" | "me_deben"; notas: string | null;
  titular: string | null; cuenta: string | null; alias: string | null; sistema: string | null; en_caja: boolean;
  cuotas: (CuotaPrestamo & { id: string })[];
}
const botonPestana = (activo: boolean) => `rounded-md px-3 py-1 text-sm font-medium ${activo ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`;
interface Resumen { id: string; cuenta_id: string; cierre: string; vencimiento: string | null; total_ars: number; total_usd: number; minimo_ars: number | null; personal_ars: number; personal_usd: number; archivo_url: string | null; notas: string | null }

async function traerBancos(sociedadId: string) {
  const [cs, ps, rs] = await Promise.all([
    db.from("cuentas_financieras").select("id, nombre, tipo, banco, numero, moneda, saldo_banco, saldo_banco_fecha, saldo_inicial, fecha_corte, observaciones, orden, activa")
      .eq("sociedad_id", sociedadId).order("orden"),
    db.from("prestamos").select("*, prestamo_cuotas(id, numero, fecha_pago, capital, interes, cargos, total, estado, pagada_fecha, notas)").eq("sociedad_id", sociedadId).neq("estado", "cancelado").order("created_at"),
    db.from("tarjeta_resumenes").select("*").eq("sociedad_id", sociedadId).order("cierre", { ascending: false }),
  ]);
  if (cs.error) throw cs.error;
  if (ps.error) throw ps.error;
  const cuentas: Cuenta[] = (cs.data || []).filter((c: any) => c.activa !== false && !String(c.tipo).startsWith("cheques_")).map((c: any) => ({
    ...c, moneda: mon(c.moneda), saldo_banco: c.saldo_banco === null ? null : Number(c.saldo_banco), saldo_inicial: c.saldo_inicial === null ? null : Number(c.saldo_inicial),
  }));
  const prestamos: Prestamo[] = (ps.data || []).map((p: any) => ({
    id: p.id, nombre: p.nombre, entidad: p.entidad, paga_nombre: p.paga_nombre, moneda: mon(p.moneda), capital_total: p.capital_total === null ? null : Number(p.capital_total),
    sentido: p.sentido === "me_deben" ? "me_deben" : "debo", notas: p.notas,
    titular: p.titular ?? null, cuenta: p.cuenta ?? null, alias: p.alias ?? null, sistema: p.sistema ?? null, en_caja: p.en_caja !== false,
    cuotas: (p.prestamo_cuotas || []).map((c: any) => ({ ...c, fecha_pago: String(c.fecha_pago).slice(0, 10) })).sort((a: any, b: any) => a.numero - b.numero),
  }));
  return {
    cuentas, prestamos,
    resumenes: (rs.data || []).map((r: any) => ({ ...r, total_ars: Number(r.total_ars || 0), total_usd: Number(r.total_usd || 0), minimo_ars: r.minimo_ars === null ? null : Number(r.minimo_ars), personal_ars: Number(r.personal_ars || 0), personal_usd: Number(r.personal_usd || 0) })) as Resumen[],
    faltaMigracion: Boolean(rs.error) || (ps.data || []).some((p: any) => !("sentido" in p)),
  };
}

export function FinanzasLazzaBancos({ sociedadId, pestanaInicial = "cuentas" }: { sociedadId: string; pestanaInicial?: "cuentas" | "prestamos" | "cheques" | "extracto" }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof traerBancos>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState<Cuenta | null>(null);
  const [abiertoP, setAbiertoP] = useState<string | null>(null);
  const [abiertaT, setAbiertaT] = useState<string | null>(null);
  const [pago, setPago] = useState<{ prestamo: Prestamo; fecha: string; monto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [pestana, setPestana] = useState<"cuentas" | "prestamos" | "cheques" | "extracto">(pestanaInicial);
  const [marcandoCuota, setMarcandoCuota] = useState<string | null>(null);
  const [versionCheques, setVersionCheques] = useState(0);
  const hoy = todayAR();

  const cargar = useCallback(() => {
    let vivo = true;
    setError(null);
    traerBancos(sociedadId).then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { console.error("Finanzas Lazza · Bancos:", e); if (vivo) setError("No se pudieron cargar los bancos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId]);
  useEffect(() => { setDatos(null); return cargar(); }, [cargar]);

  const cuentas = useMemo(() => (datos?.cuentas || []).filter((c) => c.tipo !== "tarjeta_credito"), [datos]);
  const tarjetas = useMemo(() => (datos?.cuentas || []).filter((c) => c.tipo === "tarjeta_credito"), [datos]);
  const totales = useMemo(() => {
    const t = { ARS: 0, USD: 0 };
    for (const c of cuentas) { const s = c.saldo_banco ?? c.saldo_inicial; if (s !== null) t[c.moneda] += s; }
    return t;
  }, [cuentas]);

  async function anotarPago() {
    if (!pago) return;
    const t = pago.monto.trim();
    const monto = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    if (!pago.fecha || !(monto > 0)) return;
    setGuardando(true);
    const numero = Math.max(0, ...pago.prestamo.cuotas.map((c) => c.numero)) + 1;
    const { error: e } = await db.from("prestamo_cuotas").insert({ prestamo_id: pago.prestamo.id, numero, fecha_pago: pago.fecha, total: monto, estado: "pagada", pagada_fecha: pago.fecha, notas: "Pago anotado en Finanzas Lazza" });
    setGuardando(false);
    if (e) { alert(`No se pudo anotar el pago: ${errorTexto(e)}`); return; }
    setPago(null);
    cargar();
  }

  /** Cuota del banco (BNA): "Marcar pagada" (con la fecha de hoy) o "Desmarcar" (vuelve a pendiente). Solo el dato: no mueve plata. */
  async function marcarCuota(p: Prestamo, c: CuotaPrestamo & { id: string }, pagada: boolean) {
    const texto = `cuota ${c.numero} de ${p.nombre} (${formatDate(c.fecha_pago)} · ${formatCurrency(Number(c.total), p.moneda)})`;
    if (!confirm(pagada ? `¿Marcar la ${texto} como pagada hoy?\n\nEs solo el dato del préstamo: no mueve plata en ninguna cuenta.` : `¿Desmarcar la ${texto}? Vuelve a quedar pendiente.`)) return;
    setMarcandoCuota(c.id);
    const { error: e } = await db.from("prestamo_cuotas").update(pagada ? { estado: "pagada", pagada_fecha: hoy } : { estado: "pendiente", pagada_fecha: null }).eq("id", c.id);
    setMarcandoCuota(null);
    if (e) { alert(`No se pudo guardar: ${errorTexto(e)}`); return; }
    cargar();
  }

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  if (!datos) return <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>;

  const prestamosDe = (s: "debo" | "me_deben") => datos.prestamos.filter((p) => p.sentido === s);
  const tarjeta = "rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900";

  return (
    <div className="space-y-3">
      {datos.faltaMigracion && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" /> Falta correr la migración de Bancos: todavía no se ven BAVSA, los préstamos de la familia ni los resúmenes de tarjeta.
        </p>
      )}

      <div className="flex w-fit rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
        <button type="button" onClick={() => setPestana("cuentas")} className={botonPestana(pestana === "cuentas")}>Cuentas y tarjetas</button>
        <button type="button" onClick={() => setPestana("prestamos")} className={botonPestana(pestana === "prestamos")}>Préstamos ({datos.prestamos.length})</button>
        <button type="button" onClick={() => setPestana("cheques")} className={botonPestana(pestana === "cheques")}>Cheques</button>
        <button type="button" onClick={() => setPestana("extracto")} className={botonPestana(pestana === "extracto")}>Movimientos</button>
      </div>

      {/* Cheques (23/10, Augusto): la tarjeta Cheques salió del inicio y vive acá, con Martín F. adentro. */}
      {pestana === "cheques" && (
        <div className="space-y-3">
          {/* Estado de cheques (24/10, Augusto): los reportes de eCheq del banco se cargan acá. */}
          <CargarEstadoCheques sociedadId={sociedadId} onAplicado={() => setVersionCheques((v) => v + 1)} />
          <FinanzasLazzaCheques key={versionCheques} sociedadId={sociedadId} />
        </div>
      )}

      {/* Extracto (23/10, Augusto): subir el Excel "Movimientos" del BBVA y cerrar las líneas; la bandeja de siempre, en versión simple. */}
      {pestana === "extracto" && <FinanzasParaConfirmar simple />}

      {pestana === "cuentas" && (
        <>
          {/* Cuentas: una tarjeta por cuenta; la primera es el total */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/30">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-violet-700 dark:text-violet-300"><Landmark className="h-4 w-4" /> Total en cuentas</p>
              <p className="mt-1 font-mono text-lg font-bold text-zinc-900 dark:text-white">{formatCurrency(totales.ARS)}</p>
              {totales.USD ? <p className="font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">+ {formatCurrency(totales.USD, "USD")}</p> : null}
            </div>
            {cuentas.map((c) => {
              const dias = diasDesde(c.saldo_banco_fecha, hoy);
              const viejo = dias !== null && dias > 3;
              const esBavsa = /bavsa/i.test(c.nombre);
              return (
                <div key={c.id} className={tarjeta}>
                  <p className="truncate font-medium text-zinc-800 dark:text-zinc-100" title={c.nombre}>{c.nombre}</p>
                  <p className="truncate text-[11px] text-zinc-400">{TIPO_CUENTA[c.tipo] || c.tipo}{c.numero ? ` · ${c.numero}` : ""}{c.moneda === "USD" ? " · US$" : ""}</p>
                  <p className="mt-1 font-mono text-lg font-semibold">
                    {c.saldo_banco !== null ? formatCurrency(c.saldo_banco, c.moneda)
                      : c.saldo_inicial !== null ? <span className="text-zinc-500">{formatCurrency(c.saldo_inicial, c.moneda)}</span> : <span className="text-zinc-400">—</span>}
                  </p>
                  <p className="text-[11px]">
                    {c.saldo_banco !== null ? (
                      <span className={viejo ? "font-semibold text-amber-600" : "text-zinc-500"} title={viejo ? "Saldo viejo: subí el extracto o actualizalo" : undefined}>
                        {c.tipo === "efectivo" ? "al" : "según banco al"} {c.saldo_banco_fecha ? formatDate(c.saldo_banco_fecha) : "—"}{viejo ? ` · hace ${dias} d` : ""}
                      </span>
                    ) : c.saldo_inicial !== null ? <span className="text-zinc-400">al corte {formatDate(c.fecha_corte)}</span> : <span className="text-zinc-400">sin saldo cargado</span>}
                    {esBavsa && (() => {
                      const ars = pesosDeObservaciones(c.observaciones);
                      if (!ars) return <span className="block text-zinc-400">en $: a definir</span>;
                      const vencida = ars.vence !== null && ars.vence <= hoy;
                      return (
                        <>
                          {ars.debe !== null && <span className="block font-semibold text-red-600">en $: debe <span className="font-mono">{formatCurrency(ars.debe)}</span></span>}
                          {ars.vence && (
                            <span className={`block ${vencida ? "font-semibold text-red-600" : "text-amber-600"}`} title="Caución tomadora: pagarla o renovarla">
                              Caución vence {formatDate(ars.vence)}{ars.aPagar !== null ? <> · <span className="font-mono">{formatCurrency(ars.aPagar)}</span></> : null}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </p>
                </div>
              );
            })}
          </div>
          {cuentas.length === 0 && <p className="text-sm text-zinc-400">No hay cuentas cargadas en esta sociedad.</p>}

          {/* Tarjetas de crédito */}
          <h3 className="flex items-center gap-2 pt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100"><CreditCard className="h-4 w-4 text-violet-500" /> Tarjetas</h3>
          {tarjetas.length === 0 ? <p className="text-sm text-zinc-400">No hay tarjetas cargadas en esta sociedad.</p> : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {tarjetas.map((t) => {
                const res = datos.resumenes.filter((r) => r.cuenta_id === t.id);
                const ultimo = res[0];
                const abierta = abiertaT === t.id;
                return (
                  <div key={t.id} className={tarjeta}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-zinc-800 dark:text-zinc-100">{t.nombre}</p>
                      <button type="button" disabled={datos.faltaMigracion} onClick={() => setSubiendo(t)} title={datos.faltaMigracion ? "Falta correr la migración" : "Subí el PDF del resumen: la IA lo lee y vos revisás"}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:border-orange-300 hover:text-orange-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300">
                        <Upload className="h-3.5 w-3.5" /> Subir resumen
                      </button>
                    </div>
                    {ultimo ? (
                      <>
                        <p className="mt-1 font-mono text-lg font-semibold">{formatCurrency(ultimo.total_ars)}{ultimo.total_usd ? <span className="text-sm"> + {formatCurrency(ultimo.total_usd, "USD")}</span> : null}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                          <span>Cierre {formatDate(ultimo.cierre)}</span>
                          <span className={ultimo.vencimiento && ultimo.vencimiento <= hoy ? "font-semibold text-red-600" : ""}>Vence {ultimo.vencimiento ? formatDate(ultimo.vencimiento) : "—"}</span>
                          {ultimo.minimo_ars !== null && <span>Mínimo <span className="font-mono">{formatCurrency(ultimo.minimo_ars)}</span></span>}
                          {(ultimo.personal_ars > 0 || ultimo.personal_usd > 0) && <span>Personal <span className="font-mono">{formatCurrency(ultimo.personal_ars)}{ultimo.personal_usd ? ` + ${formatCurrency(ultimo.personal_usd, "USD")}` : ""}</span> · Empresa <span className="font-mono">{formatCurrency(ultimo.total_ars - ultimo.personal_ars)}</span></span>}
                          {ultimo.archivo_url && <a href={ultimo.archivo_url} target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">PDF</a>}
                          {res.length > 1 && (
                            <button type="button" onClick={() => setAbiertaT(abierta ? null : t.id)} className="inline-flex items-center text-orange-600 hover:underline">
                              {abierta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Resúmenes anteriores
                            </button>
                          )}
                        </div>
                      </>
                    ) : <p className="mt-1 text-xs text-zinc-400">Sin resumen cargado.</p>}
                    {abierta && res.length > 1 && (
                      <table className="mt-2 w-full text-xs">
                        <thead><tr className="text-left text-[10px] uppercase text-zinc-400"><th className="py-1">Cierre</th><th>Vence</th><th className="text-right">Total $</th><th className="text-right">US$</th><th className="text-right">Mínimo</th><th className="text-right">Personal</th></tr></thead>
                        <tbody>
                          {res.map((r) => (
                            <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                              <td className="py-1">{formatDate(r.cierre)}</td><td>{r.vencimiento ? formatDate(r.vencimiento) : "—"}</td>
                              <td className="text-right font-mono">{formatCurrency(r.total_ars)}</td><td className="text-right font-mono">{r.total_usd ? formatCurrency(r.total_usd, "USD") : "—"}</td>
                              <td className="text-right font-mono">{r.minimo_ars !== null ? formatCurrency(r.minimo_ars) : "—"}</td><td className="text-right font-mono">{r.personal_ars ? formatCurrency(r.personal_ars) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Préstamos (pestaña propia, 20/10): una tarjeta por préstamo; adentro las cuotas con capital, interés y cargos y "Marcar pagada". */}
      {pestana === "prestamos" && (["debo", "me_deben"] as const).map((sentido) => {
        const lista = prestamosDe(sentido);
        const faltaTotal = { ARS: 0, USD: 0 };
        for (const p of lista) faltaTotal[p.moneda] += resumenPrestamo(p, p.cuotas, hoy).falta;
        return (
          <div key={sentido} className="space-y-2">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              <Landmark className={`h-4 w-4 ${sentido === "debo" ? "text-orange-500" : "text-emerald-500"}`} />
              {sentido === "debo" ? "Lo que debo" : "Lo que me deben"}
              {lista.length > 0 && <span className="font-normal text-zinc-500">· falta <b className="font-mono text-zinc-800 dark:text-zinc-100">{[faltaTotal.ARS ? formatCurrency(faltaTotal.ARS) : "", faltaTotal.USD ? formatCurrency(faltaTotal.USD, "USD") : ""].filter(Boolean).join(" + ") || formatCurrency(0)}</b></span>}
            </h3>
            {lista.length === 0 ? <p className="text-sm text-zinc-400">{sentido === "debo" ? "No hay préstamos cargados." : "Nadie te debe por ahora."}</p> : (
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {lista.map((p) => {
                  const r = resumenPrestamo(p, p.cuotas, hoy);
                  const abierto = abiertoP === p.id;
                  const datosBanco = [p.titular, p.cuenta, p.alias ? `alias ${p.alias}` : "", p.sistema ? `sistema ${p.sistema}` : ""].filter(Boolean).join(" · ");
                  return (
                    <div key={p.id} className={`${tarjeta} ${abierto ? "lg:col-span-2" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-800 dark:text-zinc-100">{p.nombre}</p>
                          <p className="text-[11px] text-zinc-400">
                            {[p.entidad, p.paga_nombre ? `lo paga ${p.paga_nombre}${p.en_caja ? "" : " (no resta en la caja)"}` : null, r.conCuotas ? `${r.cuotasPagadas} de ${r.cuotasTotal} cuotas pagadas` : "sin cuotas fijas"].filter(Boolean).join(" · ")}
                          </p>
                          {datosBanco && <p className="text-[11px] text-zinc-400">{datosBanco}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-lg font-semibold">{formatCurrency(r.falta, p.moneda)}</p>
                          <p className="text-[11px] text-zinc-400">falta{r.capitalFalta ? ` · capital ${formatCurrency(r.capitalFalta, p.moneda)}` : ""}{r.pagado ? ` · pagado ${formatCurrency(r.pagado, p.moneda)}` : ""}</p>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className={r.vencidas ? "font-semibold text-red-600" : "text-zinc-500"}>
                          {r.vencidas ? `⚠️ ${r.vencidas} atrasada${r.vencidas === 1 ? "" : "s"} · ` : ""}{r.proxima ? `próxima ${formatDate(r.proxima.fecha)} ${formatCurrency(r.proxima.monto, p.moneda)}` : r.conCuotas ? "todas pagadas" : ""}
                        </span>
                        <span className="flex items-center gap-3">
                          {!r.conCuotas && !datos.faltaMigracion && (
                            <button type="button" onClick={() => setPago({ prestamo: p, fecha: hoy, monto: "" })} className="inline-flex items-center gap-1 font-medium text-orange-600 hover:underline">
                              <Plus className="h-3.5 w-3.5" /> Anotar pago
                            </button>
                          )}
                          <button type="button" onClick={() => setAbiertoP(abierto ? null : p.id)} className="inline-flex items-center font-medium text-orange-600 hover:underline">
                            {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} {r.conCuotas ? "Ver cuotas" : "Ver pagos"}
                          </button>
                        </span>
                      </div>
                      {abierto && (
                        <div className="mt-2 space-y-1">
                          {p.notas && <p className="text-[11px] text-zinc-500">{p.notas}</p>}
                          {p.cuotas.length === 0 ? <p className="text-xs text-zinc-400">Sin pagos anotados.</p> : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-[10px] uppercase text-zinc-400">
                                    <th className="py-1">{r.conCuotas ? "Cuota" : "Pago"}</th><th>Fecha</th>
                                    {r.conCuotas && <><th className="text-right">Capital</th><th className="text-right">Interés</th><th className="text-right">Cargos</th></>}
                                    <th className="text-right">Total</th><th className="pl-3">Estado</th>{r.conCuotas && <th />}
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.cuotas.map((c) => {
                                    const pagada = c.estado === "pagada";
                                    const atrasada = !pagada && c.fecha_pago < hoy;
                                    const num = (x: unknown) => (x === null || x === undefined ? "—" : formatCurrency(Number(x), p.moneda));
                                    return (
                                      <tr key={c.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${pagada ? "text-zinc-400" : atrasada ? "text-red-600" : ""}`}>
                                        <td className="py-1">{c.numero}</td>
                                        <td>{formatDate(c.fecha_pago)}</td>
                                        {r.conCuotas && <><td className="text-right font-mono">{num(c.capital)}</td><td className="text-right font-mono">{num(c.interes)}</td><td className="text-right font-mono">{num(c.cargos)}</td></>}
                                        <td className="text-right font-mono">{formatCurrency(Number(c.total), p.moneda)}</td>
                                        <td className={`pl-3 ${pagada ? "text-emerald-600" : atrasada ? "font-semibold" : "text-zinc-500"}`}>
                                          {pagada ? `Pagada${c.pagada_fecha ? ` ${formatDate(c.pagada_fecha)}` : ""}` : atrasada ? "Atrasada" : c.estado === "a_confirmar" ? "A confirmar" : "Pendiente"}
                                        </td>
                                        {r.conCuotas && (
                                          <td className="text-right">
                                            {pagada ? (
                                              <button type="button" disabled={marcandoCuota === c.id} onClick={() => void marcarCuota(p, c, false)} className="text-[11px] text-zinc-400 hover:text-orange-600 hover:underline disabled:opacity-50">Desmarcar</button>
                                            ) : (
                                              <button type="button" disabled={marcandoCuota === c.id} onClick={() => void marcarCuota(p, c, true)}
                                                className="inline-flex items-center gap-1 rounded border border-emerald-300 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
                                                {marcandoCuota === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Marcar pagada
                                              </button>
                                            )}
                                          </td>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {pago && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setPago(null)}>
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="text-base font-bold text-zinc-900 dark:text-white">Anotar pago · {pago.prestamo.nombre}</h2>
              <button type="button" aria-label="Cerrar" onClick={() => setPago(null)} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <label className="block text-xs text-zinc-500">Fecha<input type="date" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} className={`${control} mt-1 w-full`} /></label>
            <label className="block text-xs text-zinc-500">Monto ({pago.prestamo.moneda === "USD" ? "US$" : "$"})<input inputMode="decimal" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} placeholder="0" className={`${control} mt-1 w-full font-mono`} /></label>
            <p className="text-[11px] text-zinc-400">Queda en la lista de pagos del préstamo y baja lo que falta. No mueve plata en ninguna cuenta.</p>
            <button type="button" disabled={guardando || !pago.fecha || !pago.monto} onClick={() => void anotarPago()} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar pago"}
            </button>
          </div>
        </div>
      )}

      {subiendo && <SubirResumen sociedadId={sociedadId} tarjeta={subiendo} onClose={() => setSubiendo(null)} onGuardado={() => { setSubiendo(null); cargar(); }} />}
    </div>
  );
}

/** Subir el PDF del resumen: la IA lo lee, Augusto revisa/corrige y guarda. */
function SubirResumen({ sociedadId, tarjeta, onClose, onGuardado }: { sociedadId: string; tarjeta: Cuenta; onClose: () => void; onGuardado: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [f, setF] = useState({ cierre: "", vencimiento: "", total_ars: "", total_usd: "", minimo_ars: "", personal_ars: "", personal_usd: "", notas: "" });
  const numero = (s: string) => { const t = s.trim(); if (!t) return null; const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return Number.isFinite(n) ? n : null; };

  async function leer(file: File) {
    setArchivo(file); setLeyendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/finanzas/leer-resumen-tarjeta", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "La IA no pudo leer el resumen");
      const d = j.data;
      setF((x) => ({ ...x, cierre: d.cierre || "", vencimiento: d.vencimiento || "", total_ars: d.total_ars ? String(d.total_ars) : "", total_usd: d.total_usd ? String(d.total_usd) : "", minimo_ars: d.minimo_ars !== null && d.minimo_ars !== undefined ? String(d.minimo_ars) : "", notas: d.detalle || "" }));
    } catch (e) {
      alert(`${errorTexto(e)}. Podés completar los datos a mano.`);
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    if (!f.cierre) return;
    setGuardando(true);
    try {
      let archivo_url: string | null = null;
      if (archivo) {
        const ext = archivo.name.split(".").pop() || "pdf";
        const ruta = `${sociedadId}/tarjetas/${tarjeta.id}/${f.cierre}.${ext}`;
        const up = await supabase.storage.from("comprobantes").upload(ruta, archivo, { upsert: true });
        if (!up.error) archivo_url = supabase.storage.from("comprobantes").getPublicUrl(ruta).data.publicUrl;
      }
      const { error } = await db.from("tarjeta_resumenes").upsert({
        sociedad_id: sociedadId, cuenta_id: tarjeta.id, cierre: f.cierre, vencimiento: f.vencimiento || null,
        total_ars: numero(f.total_ars) ?? 0, total_usd: numero(f.total_usd) ?? 0, minimo_ars: numero(f.minimo_ars),
        personal_ars: numero(f.personal_ars) ?? 0, personal_usd: numero(f.personal_usd) ?? 0,
        archivo_url, archivo_nombre: archivo?.name ?? null, notas: f.notas || null,
      }, { onConflict: "cuenta_id,cierre" });
      if (error) throw error;
      onGuardado();
    } catch (e) {
      alert(`No se pudo guardar el resumen: ${errorTexto(e)}`);
    } finally {
      setGuardando(false);
    }
  }

  const campo = (k: keyof typeof f, label: string, tipo: "date" | "num" | "text" = "num") => (
    <label className="block text-xs text-zinc-500">{label}
      <input type={tipo === "date" ? "date" : "text"} inputMode={tipo === "num" ? "decimal" : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}
        className={`${control} mt-1 w-full ${tipo === "num" ? "font-mono" : ""}`} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">Resumen · {tarjeta.nombre}</h2>
            <p className="text-xs text-zinc-500">Subí el PDF: ✨ la IA completa los datos y vos los revisás antes de guardar.</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {leyendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {archivo ? archivo.name : "Elegir PDF del resumen"}
          <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) void leer(x); e.target.value = ""; }} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {campo("cierre", "Cierre", "date")}
          {campo("vencimiento", "Vencimiento", "date")}
          {campo("total_ars", "Total $")}
          {campo("total_usd", "Total US$")}
          {campo("minimo_ars", "Pago mínimo $")}
          <span />
          {campo("personal_ars", "Parte personal $")}
          {campo("personal_usd", "Parte personal US$")}
        </div>
        {campo("notas", "Notas", "text")}
        <p className="text-[11px] text-zinc-400">Empresa = total − parte personal. No mueve plata: el pago de la tarjeta sigue como siempre.</p>
        <button type="button" disabled={guardando || leyendo || !f.cierre} onClick={() => void guardar()} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar resumen"}
        </button>
      </div>
    </div>
  );
}
