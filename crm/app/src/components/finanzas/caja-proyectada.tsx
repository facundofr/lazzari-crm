"use client";

// Finanzas (16/10/2026): caja de las próximas 4 semanas (Hoy → Resumen), Cobrar por cliente, Pagar por semana
// y préstamos con cuotas. La cuenta está en lib/caja-proyectada.ts (prueba: scripts/test-caja-proyectada.ts).
// Los préstamos que pagan terceros (BNA 1 Luis María Lazzari, BNA 2 Andrés Leguizamo) se muestran aparte: no restan en la caja.
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { proyectarCaja, clientesACobrar, pagosPorSemana, type MovCaja, type ClienteACobrar, type DeudaCliente } from "@/lib/caja-proyectada";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Landmark } from "lucide-react";

export interface CuotaPrestamo { id: string; numero: number; fecha_pago: string; capital: number | null; interes: number | null; cargos: number | null; total: number; estado: "pendiente" | "pagada" | "a_confirmar"; notas: string | null }
export interface PrestamoConCuotas { id: string; nombre: string; entidad: string; titular: string | null; cuenta: string | null; alias: string | null; paga_nombre: string | null; en_caja: boolean; sistema: string | null; capital_total: number | null; notas: string | null; cuotas: CuotaPrestamo[] }

const TIPO_LABEL: Record<MovCaja["tipo"], string> = {
  factura_venta: "Factura de venta", cheque_cartera: "Cheque en cartera", cheque_emitido: "Cheque propio", factura_compra: "Factura de compra", gasto_fijo: "Gasto fijo",
};
const diaCorto = (f: string) => {
  const d = new Date(`${f}T12:00:00Z`);
  return `${["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][d.getUTCDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`;
};
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/** Último dólar divisa (compra) del BNA cargado en el sistema, para pasar a pesos lo que está en US$. */
export function useDolarDivisa(): number | null {
  const [tc, setTc] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    (supabase as any).from("cotizaciones_dolar").select("valor_compra, fecha").eq("tipo", "oficial_divisas").order("fecha", { ascending: false }).limit(1)
      .then(({ data }: any) => { if (vivo) setTc(Number(data?.[0]?.valor_compra) || null); });
    return () => { vivo = false; };
  }, []);
  return tc;
}

/** Pagos de gastos fijos hechos desde cualquier sociedad (ej. Natalia y Porcel de octubre los pagó Grupo LA con el gasto fijo de Lazzari). */
export function usePagosGastosFijos(ids: string[]): { gasto_fijo_id: string; fecha: string }[] {
  const [pagos, setPagos] = useState<{ gasto_fijo_id: string; fecha: string }[]>([]);
  const clave = [...ids].sort().join(",");
  useEffect(() => {
    if (!clave) { setPagos([]); return; }
    let vivo = true;
    const desde = new Date(Date.now() - 62 * 86_400_000).toISOString().slice(0, 10);
    (supabase as any).from("gastos_manuales").select("gasto_fijo_id, fecha").in("gasto_fijo_id", clave.split(",")).gte("fecha", desde).limit(1000)
      .then(({ data }: any) => { if (vivo) setPagos(((data || []) as any[]).map((g) => ({ gasto_fijo_id: g.gasto_fijo_id, fecha: String(g.fecha).slice(0, 10) }))); });
    return () => { vivo = false; };
  }, [clave]);
  return pagos;
}

/** Préstamos con su tabla de cuotas. `null` mientras carga; `faltaTabla` si no se corrió la migración 20261016170000. */
export function usePrestamos(sociedadId: string | null | undefined): { prestamos: PrestamoConCuotas[] | null; faltaTabla: boolean } {
  const [prestamos, setPrestamos] = useState<PrestamoConCuotas[] | null>(null);
  const [faltaTabla, setFaltaTabla] = useState(false);
  useEffect(() => {
    if (!sociedadId) return;
    let vivo = true;
    (async () => {
      const { data, error } = await (supabase as any).from("prestamos").select("*, prestamo_cuotas(*)").eq("sociedad_id", sociedadId).eq("estado", "activo").order("nombre");
      if (!vivo) return;
      if (error) { setFaltaTabla(/prestamos|schema cache|does not exist/i.test(String(error.message || ""))); setPrestamos([]); return; }
      setFaltaTabla(false);
      setPrestamos(((data || []) as any[]).map((p) => ({
        ...p, capital_total: p.capital_total != null ? Number(p.capital_total) : null,
        cuotas: ((p.prestamo_cuotas || []) as any[]).map((c) => ({ ...c, total: Number(c.total), capital: c.capital != null ? Number(c.capital) : null, interes: c.interes != null ? Number(c.interes) : null, cargos: c.cargos != null ? Number(c.cargos) : null }))
          .sort((a, b) => a.numero - b.numero),
      })));
    })();
    return () => { vivo = false; };
  }, [sociedadId]);
  return { prestamos, faltaTabla };
}

/** Cuotas de préstamos de terceros vencidas sin pagar (aviso: no restan en la caja). */
function cuotasAtrasadas(prestamos: PrestamoConCuotas[] | null, hoy: string) {
  return (prestamos || []).flatMap((p) => p.cuotas.filter((c) => c.estado !== "pagada" && c.fecha_pago < hoy).map((c) => ({ p, c })));
}

// ─── Caja de las próximas 4 semanas ─────────────────────────────────────────
export function CajaProyectadaPanel({ hoy, saldoInicial, entradas, salidas, sinDolar, tc, prestamos, listo, onIr }: {
  hoy: string; saldoInicial: number; entradas: MovCaja[]; salidas: MovCaja[]; sinDolar: string[]; tc: number | null;
  prestamos: PrestamoConCuotas[] | null; listo?: boolean; onIr?: (tab: string) => void;
}) {
  const caja = useMemo(() => proyectarCaja({ hoy, saldoInicial, entradas, salidas }), [hoy, saldoInicial, entradas, salidas]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [verVencido, setVerVencido] = useState(false);
  const atrasadasPrestamos = cuotasAtrasadas(prestamos, hoy);
  const fin = caja.dias[caja.dias.length - 1]?.fecha || hoy;
  const proximasCuotas = (prestamos || []).flatMap((p) => p.cuotas.filter((c) => c.estado !== "pagada" && c.fecha_pago >= hoy && c.fecha_pago <= fin).map((c) => ({ p, c })));

  if (listo === false) return <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">Calculando… (esperando cheques, facturas y gastos)</div>;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-zinc-800 dark:text-zinc-100">Caja de las próximas 4 semanas</p>
        {caja.primerFaltante ? (
          <span className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" /> El {diaCorto(caja.primerFaltante.fecha)} no alcanza: faltan {formatCurrency(caja.primerFaltante.falta)}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Alcanza · el día más justo es el {diaCorto(caja.minimo.fecha)} con {formatCurrency(caja.minimo.saldo)}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">
        Arranca con {formatCurrency(saldoInicial)} (bancos + FCI + efectivo hoy). Entran facturas de venta por vencimiento y cheques en cartera; salen cheques propios, facturas de compra y gastos fijos sin pagar.
        {caja.atrasado > 0 ? ` Lo atrasado (${formatCurrency(caja.atrasado)}) se cuenta hoy.` : ""}{tc ? ` US$ a ${formatCurrency(tc)} (BNA divisa).` : ""}
      </p>
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="py-1 font-medium">Semana</th>
            <th className="py-1 text-right font-medium">Entra</th>
            <th className="py-1 text-right font-medium">Sale</th>
            <th className="py-1 text-right font-medium">Queda</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {caja.semanas.map((w) => {
            const dias = caja.dias.filter((d) => d.fecha >= w.desde && d.fecha <= w.hasta && (d.entra || d.sale));
            const abiertoW = abierta === w.desde;
            return (
              <Fragment key={w.desde}>
                <tr className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => setAbierta(abiertoW ? null : w.desde)}>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1">{abiertoW ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {ddmm(w.desde < hoy ? hoy : w.desde)} al {ddmm(w.hasta > fin ? fin : w.hasta)}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono text-emerald-700 dark:text-emerald-400">{w.entra ? formatCurrency(w.entra) : "—"}</td>
                  <td className="py-1.5 text-right font-mono text-red-600">{w.sale ? formatCurrency(w.sale) : "—"}</td>
                  <td className={`py-1.5 text-right font-mono font-semibold ${w.saldoFinal < 0 ? "text-red-600" : "text-zinc-800 dark:text-zinc-100"}`}>{formatCurrency(w.saldoFinal)}</td>
                </tr>
                {abiertoW && dias.map((d) => (
                  <tr key={d.fecha} className="bg-zinc-50/60 align-top dark:bg-zinc-800/30">
                    <td className="py-1 pl-5 text-zinc-600 dark:text-zinc-300">{diaCorto(d.fecha)}</td>
                    <td colSpan={2} className="py-1">
                      {d.items.map((i, k) => (
                        <p key={k} className={i.sentido === "entra" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}>
                          {i.sentido === "entra" ? "+" : "−"} {formatCurrency(i.monto)} · {TIPO_LABEL[i.tipo]}: {i.detalle}{i.quien ? ` — ${i.quien}` : ""}{i.usd ? ` (US$ ${i.usd.toLocaleString("es-AR")})` : ""}{i.atrasado ? " · atrasado" : ""}
                        </p>
                      ))}
                    </td>
                    <td className={`py-1 text-right font-mono ${d.saldo < 0 ? "text-red-600" : ""}`}>{formatCurrency(d.saldo)}</td>
                  </tr>
                ))}
                {abiertoW && !dias.length && <tr><td colSpan={4} className="py-1 pl-5 text-zinc-500">Sin movimientos esa semana.</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 space-y-0.5 text-xs">
        {caja.vencidoSinCobrar.total > 0 && (
          <p className="text-amber-700 dark:text-amber-300">
            Vencido sin cobrar (no se cuenta porque no se sabe cuándo entra): <b>{formatCurrency(caja.vencidoSinCobrar.total)}</b>.{" "}
            <button onClick={() => setVerVencido((v) => !v)} className="underline">{verVencido ? "Ocultar" : "Ver"}</button>
            {onIr && <> · <button onClick={() => onIr("cobrar_clientes")} className="underline">Cobrar por cliente</button></>}
          </p>
        )}
        {verVencido && caja.vencidoSinCobrar.items.slice(0, 15).map((i, k) => (
          <p key={k} className="pl-3 text-zinc-600 dark:text-zinc-300">{formatDate(i.fecha)} · {formatCurrency(i.monto)} · {i.detalle}{i.quien ? ` — ${i.quien}` : ""}</p>
        ))}
        {sinDolar.length > 0 && <p className="text-amber-700 dark:text-amber-300">Sin dólar para pasar a pesos (no se cuentan): {sinDolar.join(", ")}.</p>}
        {(proximasCuotas.length > 0 || atrasadasPrestamos.length > 0) && (
          <p className="text-zinc-600 dark:text-zinc-300">
            <Landmark className="mr-1 inline h-3.5 w-3.5" />Préstamos aparte (los pagan terceros, no restan en la caja):{" "}
            {proximasCuotas.map(({ p, c }) => `${p.nombre} cuota ${c.numero} el ${ddmm(c.fecha_pago)} ${formatCurrency(c.total)} (paga ${p.paga_nombre || "—"})`).join(" · ")}
            {atrasadasPrestamos.length > 0 && <span className="font-medium text-amber-700 dark:text-amber-300"> · ⚠️ atrasadas: {atrasadasPrestamos.map(({ p, c }) => `${p.nombre} cuota ${c.numero} (${ddmm(c.fecha_pago)}, ${formatCurrency(c.total)}, ${p.paga_nombre})`).join(", ")}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Cobrar por cliente ─────────────────────────────────────────────────────
export function ClientesACobrarPanel({ hoy, deudas, ultimosCobros, tc, listo, onIr }: {
  hoy: string; deudas: DeudaCliente[]; ultimosCobros: Map<string, { fecha: string; monto: number }>; tc: number | null; listo?: boolean; onIr?: (tab: string) => void;
}) {
  const filas = useMemo(() => clientesACobrar(deudas, hoy, ultimosCobros, tc), [deudas, hoy, ultimosCobros, tc]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const visibles = filas.filter((f) => !buscar.trim() || f.nombre.toLowerCase().includes(buscar.trim().toLowerCase()));
  const total = (k: "total" | "vencido", m: "ARS" | "USD") => filas.reduce((s, f) => s + f[m][k], 0);
  const montos = (c: ClienteACobrar, k: "total" | "vencido") => [c.ARS[k] ? formatCurrency(c.ARS[k]) : "", c.USD[k] ? formatCurrency(c.USD[k], "USD") : ""].filter(Boolean).join(" + ") || "—";

  if (listo === false) return <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">Calculando… (esperando cheques, facturas y gastos)</div>;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span><b className="text-lg">{filas.length}</b> clientes con saldo</span>
          <span>Nos deben <b>{formatCurrency(total("total", "ARS"))}</b>{total("total", "USD") ? ` + ${formatCurrency(total("total", "USD"), "USD")}` : ""}</span>
          <span className="text-red-600">Vencido <b>{formatCurrency(total("vencido", "ARS"))}</b>{total("vencido", "USD") ? ` + ${formatCurrency(total("vencido", "USD"), "USD")}` : ""}</span>
        </div>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar cliente" className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 text-right font-medium">Debe</th>
              <th className="px-3 py-2 text-right font-medium">Vencido</th>
              <th className="px-3 py-2 font-medium">Próx. vencimiento</th>
              <th className="px-3 py-2 font-medium">Último cobro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {visibles.map((c) => (
              <Fragment key={c.cliente_id}>
                <tr className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => setAbierto(abierto === c.cliente_id ? null : c.cliente_id)}>
                  <td className="px-3 py-1.5 font-medium text-zinc-900 dark:text-white">
                    <span className="flex items-center gap-1">{abierto === c.cliente_id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{c.nombre}
                      <span className="font-normal text-zinc-500">· {c.facturas} fact.</span></span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{montos(c, "total")}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${c.ARS.vencido || c.USD.vencido ? "font-semibold text-red-600" : "text-zinc-400"}`}>
                    {montos(c, "vencido")}{c.diasMasVencida ? <span className="ml-1 font-normal">({c.diasMasVencida} d)</span> : null}
                  </td>
                  <td className="px-3 py-1.5">{c.proximoVencimiento ? formatDate(c.proximoVencimiento) : "—"}</td>
                  <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300">{c.ultimoCobro ? `${formatDate(c.ultimoCobro.fecha)} · ${formatCurrency(c.ultimoCobro.monto)}` : "—"}</td>
                </tr>
                {abierto === c.cliente_id && c.documentos.map((d, k) => (
                  <tr key={k} className="bg-zinc-50/60 dark:bg-zinc-800/30">
                    <td className="px-3 py-1 pl-8 text-zinc-600 dark:text-zinc-300">{d.documento}</td>
                    <td className="px-3 py-1 text-right font-mono">{formatCurrency(d.saldo, d.moneda)}</td>
                    <td className={`px-3 py-1 ${d.vencimiento.slice(0, 10) < hoy ? "text-red-600" : "text-zinc-500"}`} colSpan={3}>vence {formatDate(d.vencimiento)}{d.vencimiento.slice(0, 10) < hoy ? " (vencida)" : ""}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {!visibles.length && <tr><td colSpan={5} className="px-3 py-3 text-zinc-500">Ningún cliente con saldo.</td></tr>}
          </tbody>
        </table>
      </div>
      {onIr && <p className="text-xs text-zinc-500">Para cargar un cobro: <button onClick={() => onIr("facturacion")} className="text-orange-600 hover:underline">Facturas de venta</button> · el detalle completo en <button onClick={() => onIr("cc_clientes")} className="text-orange-600 hover:underline">CC Clientes</button>.</p>}
    </div>
  );
}

// ─── Pagar por semana ───────────────────────────────────────────────────────
export function PagarPorSemanaPanel({ hoy, salidas, prestamos, faltaTablaPrestamos, listo, onIr }: {
  hoy: string; salidas: MovCaja[]; prestamos: PrestamoConCuotas[] | null; faltaTablaPrestamos?: boolean; listo?: boolean; onIr?: (tab: string) => void;
}) {
  const p = useMemo(() => pagosPorSemana(salidas, hoy), [salidas, hoy]);
  const bloques = [...(p.atrasado.items.length ? [{ titulo: "Atrasado", ...p.atrasado, rojo: true }] : []),
    ...p.semanas.map((w, i) => ({ titulo: i === 0 ? "Esta semana" : i === 1 ? "La semana que viene" : `Del ${ddmm(w.desde)} al ${ddmm(w.hasta)}`, ...w, rojo: false }))];
  const cuotas = (desde: string, hasta: string) => (prestamos || []).flatMap((pr) => pr.cuotas.filter((c) => c.estado !== "pagada" && c.fecha_pago >= desde && c.fecha_pago <= hasta).map((c) => ({ pr, c })));
  const atrasadasPrestamos = cuotasAtrasadas(prestamos, hoy);

  if (listo === false) return <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">Calculando… (esperando cheques, facturas y gastos)</div>;
  return (
    <div className="space-y-2 text-sm">
      {bloques.map((b) => {
        const cq = b.titulo === "Atrasado" ? [] : cuotas(b.desde < hoy ? hoy : b.desde, b.hasta);
        return (
          <div key={b.titulo} className={`rounded-xl border bg-white p-3 dark:bg-zinc-900 ${b.rojo ? "border-red-200 dark:border-red-900" : "border-zinc-200 dark:border-zinc-800"}`}>
            <div className="flex items-center justify-between">
              <p className={`font-semibold ${b.rojo ? "text-red-700 dark:text-red-300" : "text-zinc-800 dark:text-zinc-100"}`}>{b.titulo}{b.titulo !== "Atrasado" && <span className="ml-2 text-xs font-normal text-zinc-500">{ddmm(b.desde)} al {ddmm(b.hasta)}</span>}</p>
              <p className="font-mono font-semibold">{formatCurrency(b.total)}</p>
            </div>
            {b.items.length === 0 ? <p className="text-xs text-zinc-500">Nada para pagar.</p> : (
              <ul className="mt-1 divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
                {b.items.map((i, k) => (
                  <li key={k} className="flex justify-between gap-2 py-1">
                    <span className="min-w-0"><span className="text-zinc-500">{diaCorto(i.fecha)} · {TIPO_LABEL[i.tipo]}:</span> {i.detalle}{i.quien ? ` — ${i.quien}` : ""}{i.usd ? ` (US$ ${i.usd.toLocaleString("es-AR")})` : ""}</span>
                    <span className="shrink-0 font-mono">{formatCurrency(i.monto)}</span>
                  </li>
                ))}
              </ul>
            )}
            {cq.length > 0 && (
              <p className="mt-1 text-xs text-zinc-500"><Landmark className="mr-1 inline h-3.5 w-3.5" />Aparte (lo pagan terceros): {cq.map(({ pr, c }) => `${pr.nombre} cuota ${c.numero} ${diaCorto(c.fecha_pago)} ${formatCurrency(c.total)} — paga ${pr.paga_nombre}`).join(" · ")}</p>
            )}
          </div>
        );
      })}
      {p.despues > 0 && <p className="text-xs text-zinc-500">Después de estas 4 semanas: {formatCurrency(p.despues)}.</p>}
      {atrasadasPrestamos.length > 0 && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">⚠️ Cuotas de préstamos atrasadas (las pagan terceros): {atrasadasPrestamos.map(({ p: pr, c }) => `${pr.nombre} cuota ${c.numero} (${formatDate(c.fecha_pago)}, ${formatCurrency(c.total)}) — ${pr.paga_nombre}`).join(" · ")}</p>}
      {faltaTablaPrestamos && <p className="text-xs text-amber-700">Falta correr la migración de préstamos (20261016170000_prestamos_cuotas.sql) para ver las cuotas del BNA.</p>}
      {onIr && <p className="text-xs text-zinc-500">Detalle: <button onClick={() => onIr("echeqs")} className="text-orange-600 hover:underline">Cheques</button> · <button onClick={() => onIr("facturas_compra")} className="text-orange-600 hover:underline">Facturas de compra</button> · <button onClick={() => onIr("gastos_fijos")} className="text-orange-600 hover:underline">Gastos fijos</button> · <button onClick={() => onIr("lineas_credito")} className="text-orange-600 hover:underline">Créditos y préstamos</button></p>}
    </div>
  );
}

// ─── Préstamos con cuotas (Créditos y préstamos) ────────────────────────────
export function PrestamosPanel({ hoy, prestamos, faltaTabla }: { hoy: string; prestamos: PrestamoConCuotas[] | null; faltaTabla: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  if (faltaTabla) return <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Falta correr la migración de préstamos (20261016170000_prestamos_cuotas.sql): ahí están cargados el Crédito BNA 1 y el BNA 2 con sus cuotas.</p>;
  if (!prestamos?.length) return null;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold text-zinc-800 dark:text-zinc-100">Préstamos con cuotas</p>
      {prestamos.map((p) => {
        const pend = p.cuotas.filter((c) => c.estado !== "pagada");
        const atrasadas = pend.filter((c) => c.fecha_pago < hoy);
        const proxima = pend.find((c) => c.fecha_pago >= hoy);
        const capitalPend = pend.reduce((s, c) => s + (c.capital || 0), 0);
        return (
          <div key={p.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <button onClick={() => setAbierto(abierto === p.id ? null : p.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
              <span className="flex items-center gap-1.5 font-medium text-zinc-900 dark:text-white">
                {abierto === p.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<Landmark className="h-4 w-4 text-blue-600" />{p.nombre}
                <span className="font-normal text-zinc-500">· {p.entidad} · lo paga {p.paga_nombre || "—"}{p.en_caja ? "" : " (no resta en la caja)"}</span>
              </span>
              <span className="text-xs">
                Quedan <b>{pend.length}</b> de {p.cuotas.length} · {formatCurrency(pend.reduce((s, c) => s + c.total, 0))}{capitalPend ? ` (capital ${formatCurrency(capitalPend)})` : ""}
                {proxima ? ` · próxima ${formatDate(proxima.fecha_pago)} ${formatCurrency(proxima.total)}` : ""}
                {atrasadas.length > 0 && <span className="ml-1 font-semibold text-amber-700 dark:text-amber-300">· ⚠️ {atrasadas.length} atrasada{atrasadas.length === 1 ? "" : "s"}</span>}
              </span>
            </button>
            {abierto === p.id && (
              <>
                <p className="mt-1 text-xs text-zinc-500">{[p.titular, p.cuenta, p.alias ? `alias ${p.alias}` : "", p.sistema ? `sistema ${p.sistema}` : "", p.notas].filter(Boolean).join(" · ")}</p>
                <table className="mt-1 w-full text-xs">
                  <thead><tr className="text-left text-zinc-500"><th className="py-1">N°</th><th className="py-1">Fecha</th><th className="py-1 text-right">Capital</th><th className="py-1 text-right">Interés</th><th className="py-1 text-right">Cargos</th><th className="py-1 text-right">Total</th><th className="py-1 pl-3">Estado</th></tr></thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {p.cuotas.map((c) => (
                      <tr key={c.id} className={c.estado !== "pagada" && c.fecha_pago < hoy ? "text-amber-700 dark:text-amber-300" : c.estado === "pagada" ? "text-zinc-400" : ""}>
                        <td className="py-0.5">{c.numero}</td>
                        <td className="py-0.5">{formatDate(c.fecha_pago)}</td>
                        <td className="py-0.5 text-right font-mono">{c.capital != null ? formatCurrency(c.capital) : "—"}</td>
                        <td className="py-0.5 text-right font-mono">{c.interes != null ? formatCurrency(c.interes) : "—"}</td>
                        <td className="py-0.5 text-right font-mono">{c.cargos != null ? formatCurrency(c.cargos) : "—"}</td>
                        <td className="py-0.5 text-right font-mono">{formatCurrency(c.total)}</td>
                        <td className="py-0.5 pl-3">{c.estado === "pagada" ? "Pagada" : c.fecha_pago < hoy ? "Atrasada" : c.estado === "a_confirmar" ? "A confirmar" : "Pendiente"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
