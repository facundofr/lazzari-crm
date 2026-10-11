"use client";

// Finanzas > Cuentas: saldo de cada cuenta (bancos, FCI, efectivo, tarjetas y cheques) desde la fecha de corte.
// El cálculo está en lib/saldo-cuentas.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  calcularSaldosCuentas, sugerenciasCuentas, TIPO_CUENTA_LABEL,
  type CuentaFinanciera, type MovimientoCuenta, type ChequeCuenta, type TipoCuenta,
} from "@/lib/saldo-cuentas";
import { clasificarMovimiento } from "@/lib/tipos-movimiento";
import { AlertTriangle, Banknote, CreditCard, Landmark, Lightbulb, Loader2, PiggyBank, Plus, Pencil, Receipt, Send, Wallet, X } from "lucide-react";

interface CuentaRow extends CuentaFinanciera {
  sociedad_id: string;
  banco: string | null;
  numero: string | null;
  admite_usd: boolean;
  acuerdo: number | string;
  se_paga_desde: string | null;
  uso: "trabajo" | "mixto";
  predeterminada: boolean;
  activa: boolean;
  orden: number;
  observaciones: string | null;
}

interface MovimientoRow extends MovimientoCuenta {
  id: string;
}

const ICONO: Record<TipoCuenta, typeof Wallet> = {
  cuenta_corriente: Landmark,
  caja_ahorro: Landmark,
  fci: PiggyBank,
  tarjeta_credito: CreditCard,
  efectivo: Banknote,
  cheques_cartera: Receipt,
  cheques_emitidos: Send,
};

const TIPOS_EDITABLES: TipoCuenta[] = ["cuenta_corriente", "caja_ahorro", "fci", "tarjeta_credito", "efectivo"];
const usaSaldoInicial = (t: TipoCuenta) => t === "cuenta_corriente" || t === "caja_ahorro" || t === "fci" || t === "efectivo";

const formVacio = {
  id: "" as string,
  nombre: "",
  tipo: "cuenta_corriente" as TipoCuenta,
  banco: "BBVA",
  numero: "",
  moneda: "ARS" as "ARS" | "USD",
  admite_usd: false,
  fecha_corte: "2026-08-31",
  saldo_inicial: "",
  acuerdo: "0",
  uso: "trabajo" as "trabajo" | "mixto",
  predeterminada: false,
  activa: true,
  observaciones: "",
};

/** "1.234.567,89" o "1234567.89" → número; vacío → null. */
function leerImporte(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const limpio = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const num = Number(limpio.replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

export default function CuentasFinancieras({ onIrACheques }: { onIrACheques?: () => void }) {
  const { sociedadActiva } = useUser();
  const sociedadId = sociedadActiva?.id;
  const [cuentas, setCuentas] = useState<CuentaRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoRow[]>([]);
  const [cheques, setCheques] = useState<ChequeCuenta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [form, setForm] = useState<typeof formVacio | null>(null);
  const [guardando, setGuardando] = useState(false);
  const hoy = todayAR();

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setLoading(true);
    setError(null);
    setFaltaMigracion(false);
    const db = supabase as any;
    try {
      const { data: cs, error: e1 } = await db.from("cuentas_financieras").select("*").eq("sociedad_id", sociedadId).order("orden").order("created_at");
      if (e1) {
        if (e1.code === "42P01" || /cuentas_financieras/.test(String(e1.message || ""))) { setFaltaMigracion(true); return; }
        throw e1;
      }
      const lista = (cs || []) as CuentaRow[];
      const corte = lista.map((c) => c.fecha_corte).sort()[0] || "2026-08-31";
      const [movs, chs] = await Promise.all([
        traerTodo<MovimientoRow>(() => db.from("movimientos")
          .select("id, cuenta_id, fecha, monto, moneda, tipo, cliente_id, proveedor_id, anulado, descripcion, nota_credito_compra_id")
          .eq("sociedad_id", sociedadId).gt("fecha", corte).order("fecha", { ascending: false }).order("id")),
        traerTodo<ChequeCuenta>(() => db.from("echeqs")
          .select("id, direccion, estado, monto, moneda, fecha_pago")
          .eq("sociedad_id", sociedadId).in("estado", ["en_cartera", "depositado", "pendiente", "entregado"]).order("id")),
      ]);
      setCuentas(lista);
      setMovimientos(movs);
      setCheques(chs);
    } catch (e: any) {
      setError(e?.message || "No se pudieron leer las cuentas.");
    } finally {
      setLoading(false);
    }
  }, [sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const resultado = useMemo(() => calcularSaldosCuentas(cuentas, movimientos, cheques, hoy), [cuentas, movimientos, cheques, hoy]);
  const sugerencias = useMemo(() => sugerenciasCuentas(cuentas, resultado), [cuentas, resultado]);
  const activas = cuentas.filter((c) => c.activa);
  const inactivas = cuentas.filter((c) => !c.activa);
  const nombreCuenta = (id: string | null) => cuentas.find((c) => c.id === id)?.nombre || "";

  async function guardar() {
    if (!form || !sociedadId) return;
    if (!form.nombre.trim()) { alert("Poné un nombre para la cuenta."); return; }
    const payload: Record<string, unknown> = {
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      banco: form.banco.trim() || null,
      numero: form.numero.trim() || null,
      moneda: form.moneda,
      admite_usd: form.tipo === "tarjeta_credito" ? form.admite_usd : false,
      fecha_corte: form.fecha_corte || "2026-08-31",
      saldo_inicial: usaSaldoInicial(form.tipo) ? leerImporte(form.saldo_inicial) : null,
      acuerdo: form.tipo === "cuenta_corriente" ? (leerImporte(form.acuerdo) ?? 0) : 0,
      uso: form.uso,
      predeterminada: form.predeterminada,
      activa: form.activa,
      observaciones: form.observaciones.trim() || null,
    };
    if (form.tipo === "tarjeta_credito" && !form.id) {
      payload.se_paga_desde = cuentas.find((c) => c.tipo === "cuenta_corriente" && c.predeterminada && c.activa)?.id ?? null;
    }
    setGuardando(true);
    try {
      const db = supabase as any;
      // Una sola predeterminada por tipo y moneda: se avisa y se pasa la marca a la nueva.
      if (form.predeterminada) {
        const otra = cuentas.find((c) => c.id !== form.id && c.predeterminada && c.activa && c.moneda === form.moneda
          && (c.tipo === form.tipo || (["cuenta_corriente", "caja_ahorro"].includes(c.tipo) && ["cuenta_corriente", "caja_ahorro"].includes(form.tipo))));
        if (otra) {
          if (!confirm(`"${otra.nombre}" es hoy la cuenta sugerida para lo nuevo. ¿Pasar la sugerencia a "${form.nombre}"?`)) { setGuardando(false); return; }
          const { error: eOtra } = await db.from("cuentas_financieras").update({ predeterminada: false }).eq("id", otra.id).eq("sociedad_id", sociedadId);
          if (eOtra) throw eOtra;
        }
      }
      const q = form.id
        ? db.from("cuentas_financieras").update(payload).eq("id", form.id).eq("sociedad_id", sociedadId)
        : db.from("cuentas_financieras").insert({ ...payload, sociedad_id: sociedadId, orden: (cuentas.reduce((m, c) => Math.max(m, c.orden || 0), 0) + 10) });
      const { error: e } = await q;
      if (e) throw e;
      setForm(null);
      await cargar();
    } catch (e: any) {
      alert(`No se pudo guardar: ${e?.message || e}`);
    } finally {
      setGuardando(false);
    }
  }

  function editar(c: CuentaRow) {
    setForm({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      banco: c.banco || "",
      numero: c.numero || "",
      moneda: c.moneda,
      admite_usd: c.admite_usd,
      fecha_corte: c.fecha_corte,
      saldo_inicial: c.saldo_inicial === null || c.saldo_inicial === undefined ? "" : String(c.saldo_inicial),
      acuerdo: String(c.acuerdo ?? 0),
      uso: c.uso,
      predeterminada: c.predeterminada,
      activa: c.activa,
      observaciones: c.observaciones || "",
    });
  }

  if (loading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando cuentas…</div>;
  }
  if (faltaMigracion) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        Falta correr la migración <b>20261011170000_cuentas_financieras.sql</b> en Supabase para ver las cuentas.
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        {error} <button onClick={() => void cargar()} className="ml-2 underline">Reintentar</button>
      </div>
    );
  }

  const tARS = resultado.totales.ARS;
  const tUSD = resultado.totales.USD;
  const sinARS = resultado.sinCuenta.ARS;
  const sinUSD = resultado.sinCuenta.USD;

  return (
    <div className="space-y-4">
      {/* Totales */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Total titulo="Disponible (bancos + FCI + efectivo)" valor={formatCurrency(tARS.disponible)} extra={tUSD.disponible ? `+ ${formatCurrency(tUSD.disponible, "USD")}` : undefined} color="text-emerald-600" />
        <Total titulo="Cheques en cartera" valor={formatCurrency(tARS.chequesCartera)} extra={tARS.chequesDepositados ? `+ ${formatCurrency(tARS.chequesDepositados)} depositados sin acreditar` : undefined} color="text-blue-600" onClick={onIrACheques} />
        <Total titulo="Comprometido en cheques emitidos" valor={formatCurrency(tARS.comprometidoEmitidos)} extra="Sale del banco cuando se debitan" color="text-orange-500" onClick={onIrACheques} />
        <Total titulo="Tarjetas" valor="Por resumen" extra="Se cargan con el resumen mensual (próxima etapa)" color="text-zinc-500" />
      </div>

      {/* Sugerencias del día */}
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-violet-800 dark:text-violet-200"><Lightbulb className="h-4 w-4" /> Sugerencias</p>
        {sugerencias.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Todo en orden: ninguna cuenta corriente en negativo ni cheques propios sin cubrir esta semana.</p>
        ) : (
          <ul className="space-y-1.5">
            {sugerencias.map((sg) => (
              <li key={sg.cuentaId} className="text-zinc-700 dark:text-zinc-300">
                {sg.tipo === "rescatar_fci" ? (
                  <>👉 <b>Rescatá {formatCurrency(sg.monto)} del {nombreCuenta(sg.desdeId || null)}</b> a <b>{nombreCuenta(sg.cuentaId)}</b></>
                ) : (
                  <>⚠️ <b>A {nombreCuenta(sg.cuentaId)} le faltan {formatCurrency(sg.monto)}</b>{sg.desdeId ? ` aunque rescates todo el ${nombreCuenta(sg.desdeId)}` : " y no hay FCI para rescatar"}</>
                )}
                <span className="text-zinc-500">
                  {" — "}saldo {formatCurrency(sg.saldo)}
                  {sg.chequesProximos > 0 ? `; cheques propios a debitar en 7 días: ${formatCurrency(sg.chequesProximos)}` : ""}
                  {sg.saldo < 0 ? ". Así queda en 0 y no pagás intereses." : "."}
                </span>
              </li>
            ))}
          </ul>
        )}
        {sinARS.cantidad > 0 && (
          <p className="mt-1.5 text-xs text-zinc-500">Ojo: hasta que se cargue el extracto del día, el saldo de los bancos es el del sistema y la sugerencia puede no coincidir con el banco.</p>
        )}
      </div>

      {(sinARS.cantidad > 0 || sinUSD.cantidad > 0) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>{sinARS.cantidad + sinUSD.cantidad} cobros y pagos desde el corte todavía no tienen cuenta</b>
            {sinARS.cantidad > 0 && <> (entradas {formatCurrency(sinARS.ingresos)}, salidas {formatCurrency(sinARS.egresos)}</>}
            {sinUSD.cantidad > 0 && <>{sinARS.cantidad > 0 ? "; " : " ("}U$S: entradas {formatCurrency(sinUSD.ingresos, "USD")}, salidas {formatCurrency(sinUSD.egresos, "USD")}</>}
            ). No suman a ningún saldo: se asignan solos al cruzar con el extracto del banco. Los nuevos ya toman la cuenta sugerida.
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Cuentas</h3>
        <button onClick={() => setForm({ ...formVacio })} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600">
          <Plus className="h-4 w-4" /> Nueva cuenta
        </button>
      </div>

      {activas.length === 0 && (
        <div className="rounded-xl border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">Todavía no hay cuentas cargadas para esta sociedad.</div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {activas.map((c) => {
          const s = resultado.porCuenta[c.id];
          if (!s) return null;
          const Icono = ICONO[c.tipo] || Wallet;
          const pasadoDeAcuerdo = c.tipo === "cuenta_corriente" && s.disponibleConAcuerdo !== null && s.disponibleConAcuerdo < 0;
          const esCheques = c.tipo === "cheques_cartera" || c.tipo === "cheques_emitidos";
          const movsCuenta = abierta === c.id ? movimientos.filter((m) => m.cuenta_id === c.id && String(m.fecha).slice(0, 10) > c.fecha_corte) : [];
          return (
            <div key={c.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="rounded-lg bg-zinc-100 p-2 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><Icono className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-900 dark:text-white">{c.nombre}</p>
                    <p className="text-xs text-zinc-500">
                      {TIPO_CUENTA_LABEL[c.tipo]}{c.numero ? ` · ${c.numero}` : ""}{c.moneda === "USD" ? " · U$S" : ""}{c.admite_usd ? " · $ y U$S" : ""}
                    </p>
                  </div>
                </div>
                {!esCheques && (
                  <button onClick={() => editar(c)} title="Editar" className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-3">
                {c.tipo === "tarjeta_credito" ? (
                  <p className="text-sm text-zinc-500">Va por resumen mensual. Falta cargar el primer resumen.</p>
                ) : (
                  <p className={`text-2xl font-bold ${s.saldo < 0 ? "text-red-600" : "text-zinc-900 dark:text-white"}`}>{formatCurrency(s.saldo, c.moneda)}</p>
                )}
                {c.tipo === "cuenta_corriente" && Number(c.acuerdo || 0) > 0 && s.disponibleConAcuerdo !== null && (
                  <p className={`text-xs ${pasadoDeAcuerdo ? "font-semibold text-red-600" : "text-zinc-500"}`}>
                    Con acuerdo de {formatCurrency(Number(c.acuerdo))}: {pasadoDeAcuerdo ? "pasado " : "disponible "}{formatCurrency(Math.abs(s.disponibleConAcuerdo))}
                  </p>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {c.predeterminada && <Badge variant="info">Sugerida para lo nuevo</Badge>}
                {c.uso === "mixto" && <Badge variant="warning">Uso mixto (también personal)</Badge>}
                {s.faltaSaldoInicial && <Badge variant="danger">Falta el saldo al corte</Badge>}
              </div>

              {usaSaldoInicial(c.tipo) && (
                <div className="mt-3 space-y-0.5 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
                  <p>Saldo al {formatDate(c.fecha_corte)}: <span className="font-mono">{c.saldo_inicial === null ? "—" : formatCurrency(Number(c.saldo_inicial), c.moneda)}</span></p>
                  <p>Desde el corte: <span className="text-emerald-600">+{formatCurrency(s.ingresos, c.moneda)}</span> / <span className="text-red-600">−{formatCurrency(s.egresos, c.moneda)}</span> ({s.cantidadMovimientos} mov.)</p>
                </div>
              )}

              {esCheques && s.vencimientos && (
                <div className="mt-3 space-y-0.5 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
                  <p>{s.cantidadCheques} cheque{s.cantidadCheques === 1 ? "" : "s"}</p>
                  {s.vencimientos.vencidos > 0 && <p className="font-semibold text-red-600">{c.tipo === "cheques_emitidos" ? "Fecha de pago pasada, sin debitar" : "Fecha de pago pasada"}: {formatCurrency(s.vencimientos.vencidos)}</p>}
                  <p>Próximos 7 días: <span className="font-mono">{formatCurrency(s.vencimientos.proximos7)}</span></p>
                  <p>Resto del mes: <span className="font-mono">{formatCurrency(s.vencimientos.restoMes)}</span></p>
                  <p>Más adelante: <span className="font-mono">{formatCurrency(s.vencimientos.despues)}</span></p>
                  {c.tipo === "cheques_cartera" && (s.depositados || 0) > 0 && <p>Depositados sin acreditar: <span className="font-mono">{formatCurrency(s.depositados || 0)}</span></p>}
                </div>
              )}

              {c.tipo === "tarjeta_credito" && (
                <p className="mt-3 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
                  {c.se_paga_desde ? `Se paga desde ${nombreCuenta(c.se_paga_desde)}.` : "Sin cuenta de pago."}
                </p>
              )}

              {c.observaciones && <p className="mt-2 text-xs italic text-zinc-400">{c.observaciones}</p>}

              {usaSaldoInicial(c.tipo) && s.cantidadMovimientos > 0 && (
                <button onClick={() => setAbierta(abierta === c.id ? null : c.id)} className="mt-2 text-xs font-medium text-orange-600 hover:underline">
                  {abierta === c.id ? "Ocultar movimientos" : "Ver movimientos"}
                </button>
              )}
              {movsCuenta.length > 0 && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
                  <table className="w-full text-xs">
                    <tbody>
                      {movsCuenta.map((m) => {
                        const clase = clasificarMovimiento(m);
                        if (clase !== "ingreso" && clase !== "egreso") return null;
                        return (
                          <tr key={m.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                            <td className="whitespace-nowrap px-2 py-1 text-zinc-500">{formatDate(m.fecha)}</td>
                            <td className="px-2 py-1 text-zinc-700 dark:text-zinc-300">{m.descripcion}</td>
                            <td className={`whitespace-nowrap px-2 py-1 text-right font-mono ${clase === "ingreso" ? "text-emerald-600" : "text-red-600"}`}>
                              {clase === "ingreso" ? "+" : "−"}{formatCurrency(Number(m.monto || 0), c.moneda)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {inactivas.length > 0 && (
        <p className="text-xs text-zinc-400">
          Inactivas: {inactivas.map((c, i) => (
            <button key={c.id} onClick={() => editar(c)} className="hover:underline">{i > 0 ? ", " : ""}{c.nombre}</button>
          ))}
        </p>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !guardando && setForm(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">{form.id ? "Editar cuenta" : "Nueva cuenta"}</h3>
              <button onClick={() => setForm(null)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Campo label="Nombre" full><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Tipo">
                <select value={form.tipo} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoCuenta })} className={inputCls}>
                  {TIPOS_EDITABLES.map((t) => <option key={t} value={t}>{TIPO_CUENTA_LABEL[t]}</option>)}
                </select>
              </Campo>
              <Campo label="Moneda">
                <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as "ARS" | "USD" })} className={inputCls}>
                  <option value="ARS">Pesos</option><option value="USD">Dólares</option>
                </select>
              </Campo>
              <Campo label="Banco"><input value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Número"><input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} className={inputCls} /></Campo>
              {usaSaldoInicial(form.tipo) && (
                <>
                  <Campo label="Fecha de corte"><input type="date" value={form.fecha_corte} onChange={(e) => setForm({ ...form, fecha_corte: e.target.value })} className={inputCls} /></Campo>
                  <Campo label="Saldo al cierre de esa fecha"><input value={form.saldo_inicial} placeholder="Ej: 10.829.781,65" onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })} className={`${inputCls} font-mono`} /></Campo>
                </>
              )}
              {form.tipo === "cuenta_corriente" && (
                <Campo label="Acuerdo (descubierto)"><input value={form.acuerdo} onChange={(e) => setForm({ ...form, acuerdo: e.target.value })} className={`${inputCls} font-mono`} /></Campo>
              )}
              {form.tipo === "tarjeta_credito" && (
                <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={form.admite_usd} onChange={(e) => setForm({ ...form, admite_usd: e.target.checked })} /> El resumen trae pesos y dólares</label>
              )}
              <Campo label="Uso">
                <select value={form.uso} onChange={(e) => setForm({ ...form, uso: e.target.value as "trabajo" | "mixto" })} className={inputCls}>
                  <option value="trabajo">Solo trabajo</option><option value="mixto">Mixto (también personal)</option>
                </select>
              </Campo>
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={form.predeterminada} onChange={(e) => setForm({ ...form, predeterminada: e.target.checked })} /> Sugerirla para los cobros y pagos nuevos</label>
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} /> Activa</label>
              <Campo label="Observaciones" full><textarea value={form.observaciones} rows={2} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} className={inputCls} /></Campo>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setForm(null)} disabled={guardando} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
              <button onClick={() => void guardar()} disabled={guardando} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-60">
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

function Campo({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Total({ titulo, valor, extra, color, onClick }: { titulo: string; valor: string; extra?: string; color: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${onClick ? "transition-colors hover:border-orange-300" : ""}`}>
      <p className="text-xs font-medium text-zinc-500">{titulo}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{valor}</p>
      {extra && <p className="mt-0.5 text-xs text-zinc-400">{extra}</p>}
    </Tag>
  );
}
