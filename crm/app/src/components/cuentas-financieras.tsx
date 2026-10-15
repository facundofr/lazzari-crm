"use client";

// Finanzas > Cuentas: saldo de cada cuenta (bancos, FCI, efectivo, tarjetas y cheques) desde la fecha de corte.
// El cálculo está en lib/saldo-cuentas.ts.
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import {
  calcularSaldosCuentas, sugerenciasCuentas, montoCuentaDeOp, debitosPorSemana, debitosACubrir, diaDeRescate, TIPO_CUENTA_LABEL,
  type CuentaFinanciera, type MovimientoCuenta, type ChequeCuenta, type TipoCuenta, type PaseCuenta, type TotalesCuentas,
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
  orden_pago_id?: string | null;
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
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
/** "2026-10-13" → "mar 13/10". */
const diaCorto = (f: string) => `${DIAS[new Date(`${f}T12:00:00Z`).getUTCDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`;

function leerImporte(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const limpio = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const num = Number(limpio.replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

/** Día hábil anterior (lun → vie). Sirve para saber si el extracto del banco está al día. */
function diaHabilAnterior(f: string): string {
  const d = new Date(`${f}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Domingo de la semana de hoy (para "Pagos de esta semana"). */
export function finDeSemana(f: string): string {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

export interface AvisoHoy { texto: ReactNode; tab?: string; color?: "rojo" | "ambar" | "gris" }

export default function CuentasFinancieras({ onIrACheques, resumen, cobertura, onIr, pagosSemana, avisos }: {
  onIrACheques?: () => void;
  /** Si viene, reemplaza a los recuadros de totales (Finanzas → Hoy usa el Resumen económico). */
  resumen?: (totales: { ARS: TotalesCuentas; USD: TotalesCuentas }) => ReactNode;
  /** Finanzas → Hoy: recuadro "¿Cubro los gastos fijos?" (va en la misma franja que el resumen). */
  cobertura?: ReactNode;
  /** Finanzas → Hoy: botón "Ir" de cada aviso (recibe la pestaña). Si viene, la pantalla se arma en modo Hoy. */
  onIr?: (tab: string) => void;
  /** Facturas de compra que vencen hasta el domingo (incluye vencidas). */
  pagosSemana?: { ARS: number; USD: number; cantidad: number; vencidas: number };
  /** Avisos que arma Finanzas (además de los propios de las cuentas). */
  avisos?: AvisoHoy[];
}) {
  const { sociedadActiva } = useUser();
  const sociedadId = sociedadActiva?.id;
  const [cuentas, setCuentas] = useState<CuentaRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoRow[]>([]);
  const [cheques, setCheques] = useState<ChequeCuenta[]>([]);
  const [pases, setPases] = useState<PaseCuenta[]>([]);
  /** Líneas del extracto sin cruzar (entradas = cobros a confirmar). */
  const [sinCruzar, setSinCruzar] = useState<{ creditos: number; montoCreditos: number; debitos: number; montoDebitos: number } | null>(null);
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
          .select("id, cuenta_id, fecha, monto, moneda, tipo, cliente_id, proveedor_id, anulado, descripcion, nota_credito_compra_id, orden_pago_id")
          .eq("sociedad_id", sociedadId).gt("fecha", corte).order("fecha", { ascending: false }).order("id")),
        traerTodo<ChequeCuenta>(() => db.from("echeqs")
          .select("id, direccion, estado, monto, moneda, fecha_pago")
          .eq("sociedad_id", sociedadId).in("estado", ["en_cartera", "depositado", "pendiente", "entregado"]).order("id")),
      ]);
      // Pagos de OP: solo la parte en transferencias sale del banco ese día (lo de cheques sale al debitarse).
      const idsOp = [...new Set(movs.map((m) => m.orden_pago_id).filter(Boolean) as string[])];
      const mediosOp = new Map<string, number | null>();
      for (let i = 0; i < idsOp.length; i += 150) {
        const { data: ops, error: eOp } = await db.from("ordenes_pago").select("id, medios_pago").eq("sociedad_id", sociedadId).in("id", idsOp.slice(i, i + 150));
        if (eOp) throw eOp;
        for (const op of ops || []) mediosOp.set(op.id, montoCuentaDeOp(op.medios_pago));
      }
      for (const m of movs) {
        if (m.orden_pago_id && String(m.tipo) === "pago") m.montoCuenta = mediosOp.get(m.orden_pago_id) ?? null;
      }
      // Pases del extracto (FCI, entre cuentas, efectivo). Si falta la migración de la etapa 2, sigue sin pases.
      let pasesLeidos: PaseCuenta[] = [];
      if (lista.length) {
        try {
          const lineas = await traerTodo<{ contra_cuenta_id: string; fecha: string; monto: number; tipo: string }>(() => db.from("extracto_movimientos")
            .select("id, contra_cuenta_id, fecha, monto, tipo")
            .in("cuenta_id", lista.map((c) => c.id)).in("clasificacion", ["fci", "entre_cuentas"])
            .not("contra_cuenta_id", "is", null).gt("fecha", corte).order("id"));
          pasesLeidos = lineas.map((l) => ({ cuenta_id: l.contra_cuenta_id, fecha: l.fecha, importe: l.tipo === "credito" ? -Number(l.monto) : Number(l.monto) }));
        } catch { pasesLeidos = []; }
      }
      // Líneas del banco sin cruzar (para "Cobros a confirmar" y "Para hacer hoy"). Si falla, no se muestra.
      let pendientes: typeof sinCruzar = null;
      if (lista.length) {
        try {
          const lineas = await traerTodo<{ monto: number; tipo: string }>(() => db.from("extracto_movimientos")
            .select("id, monto, tipo").in("cuenta_id", lista.map((c) => c.id)).eq("estado", "pendiente").order("id"));
          const cr = lineas.filter((l) => l.tipo === "credito");
          const de = lineas.filter((l) => l.tipo !== "credito");
          pendientes = {
            creditos: cr.length, montoCreditos: cr.reduce((a, l) => a + Number(l.monto || 0), 0),
            debitos: de.length, montoDebitos: de.reduce((a, l) => a + Number(l.monto || 0), 0),
          };
        } catch { pendientes = null; }
      }
      setSinCruzar(pendientes);
      setCuentas(lista);
      setMovimientos(movs);
      setCheques(chs);
      setPases(pasesLeidos);
    } catch (e: any) {
      setError(e?.message || "No se pudieron leer las cuentas.");
    } finally {
      setLoading(false);
    }
  }, [sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const resultado = useMemo(() => calcularSaldosCuentas(cuentas, movimientos, cheques, hoy, pases), [cuentas, movimientos, cheques, hoy, pases]);
  const sugerencias = useMemo(() => sugerenciasCuentas(cuentas, resultado, hoy), [cuentas, resultado, hoy]);
  const debitosEmitidos = useMemo(() => {
    const emi = cuentas.find((c) => c.activa && c.tipo === "cheques_emitidos" && c.moneda === "ARS");
    return (emi && resultado.porCuenta[emi.id]?.debitos) || [];
  }, [cuentas, resultado]);
  const semanas = useMemo(() => debitosPorSemana(debitosEmitidos, hoy), [debitosEmitidos, hoy]);
  /** Próximo rescate después de hoy (para avisar con tiempo). */
  const proximoRescate = useMemo(() => {
    const yaCubiertos = new Set(debitosACubrir(debitosEmitidos, hoy));
    const prox = debitosEmitidos.find((d) => !yaCubiertos.has(d));
    if (!prox) return null;
    const rescatarEl = diaDeRescate(prox.fecha);
    const mismoDia = debitosEmitidos.filter((d) => !d.atrasado && diaDeRescate(d.fecha) === rescatarEl);
    return { rescatarEl, fechas: mismoDia.map((d) => d.fecha), monto: mismoDia.reduce((a, d) => a + d.monto, 0) };
  }, [debitosEmitidos, hoy]);
  const urgentes = sugerencias.filter((sg) => sg.chequesProximos > 0 || sg.saldo < 0);
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

  // ── Finanzas → Hoy: 4 números, "Para hacer hoy", franja chica y cuentas en tabla ──
  const habilAnterior = diaHabilAnterior(hoy);
  const bancosAtrasados = activas.filter((c) => (c.tipo === "cuenta_corriente" || c.tipo === "caja_ahorro")
    && (!c.saldo_banco_fecha || String(c.saldo_banco_fecha).slice(0, 10) < habilAnterior));
  const paraCubrir = urgentes.reduce((a, sg) => a + sg.monto, 0);
  const domingo = finDeSemana(hoy);
  const chequesSemana = semanas.semanas.filter((w) => w.desde <= domingo).reduce((a, w) => a + w.dias.filter((d) => d.fecha <= domingo).reduce((x, d) => x + d.monto, 0), 0) + semanas.atrasado;
  const ir = (tab: string) => { if (tab === "echeqs" && onIrACheques) onIrACheques(); else onIr?.(tab); };

  const paraHacer: AvisoHoy[] = [
    ...urgentes.map((sg): AvisoHoy => ({
      color: "rojo",
      texto: sg.tipo === "rescatar_fci"
        ? <>Rescatá <b>{formatCurrency(sg.monto)}</b> del {nombreCuenta(sg.desdeId || null)} a {nombreCuenta(sg.cuentaId)}<span className="text-zinc-500"> (saldo {formatCurrency(sg.saldo)}{sg.chequesProximos > 0 ? `; cheques a debitar${sg.debitoHasta ? ` hasta el ${diaCorto(sg.debitoHasta)}` : " atrasados"}: ${formatCurrency(sg.chequesProximos)}` : ""})</span></>
        : <>A {nombreCuenta(sg.cuentaId)} le faltan <b>{formatCurrency(sg.monto)}</b>{sg.desdeId ? ` aunque rescates todo el ${nombreCuenta(sg.desdeId)}` : " y no hay FCI para rescatar"}</>,
      tab: "echeqs",
    })),
    ...(bancosAtrasados.length ? [{
      color: "ambar" as const,
      texto: <>Cargá el extracto de {bancosAtrasados.map((c) => `${c.nombre}${c.saldo_banco_fecha ? ` (está al ${formatDate(String(c.saldo_banco_fecha))})` : ""}`).join(", ")}: hasta entonces el saldo es el del sistema.</>,
      tab: "extractos",
    }] : []),
    ...(sinCruzar && sinCruzar.creditos > 0 ? [{
      color: "ambar" as const,
      texto: <><b>{sinCruzar.creditos} entradas del banco sin cruzar</b> ({formatCurrency(sinCruzar.montoCreditos)}): el sistema ya armó los cruces, confirmalos.</>,
      tab: "para_confirmar",
    }] : []),
    ...(sinCruzar && sinCruzar.debitos > 0 ? [{
      color: "gris" as const,
      texto: <>{sinCruzar.debitos} salidas del banco sin cruzar ({formatCurrency(sinCruzar.montoDebitos)}): confirmalas en Para confirmar.</>,
      tab: "para_confirmar",
    }] : []),
    ...((sinARS.cantidad > 0 || sinUSD.cantidad > 0) ? [{
      color: "gris" as const,
      texto: <>{sinARS.cantidad + sinUSD.cantidad} cobros y pagos sin cuenta (entran {formatCurrency(sinARS.ingresos)}, salen {formatCurrency(sinARS.egresos)}{sinUSD.cantidad > 0 ? `; U$S ${formatCurrency(sinUSD.ingresos, "USD")} / ${formatCurrency(sinUSD.egresos, "USD")}` : ""}): se asignan solos al subir el extracto.</>,
      tab: "movimientos",
    }] : []),
    ...(avisos || []),
    ...(proximoRescate && urgentes.length === 0 ? [{
      color: "gris" as const,
      texto: <>Próximo rescate: <b>{diaCorto(proximoRescate.rescatarEl)}</b>, {formatCurrency(proximoRescate.monto)} para los cheques del {proximoRescate.fechas.map(diaCorto).join(", ")}.</>,
      tab: "echeqs",
    }] : []),
  ];
  const colorAviso = { rojo: "text-red-700 dark:text-red-300", ambar: "text-amber-800 dark:text-amber-200", gris: "text-zinc-700 dark:text-zinc-300" };
  const puntoAviso = { rojo: "bg-red-500", ambar: "bg-amber-500", gris: "bg-zinc-300 dark:bg-zinc-600" };

  return (
    <div className="space-y-3">
      {/* 1) Cuatro números en una franja */}
      {onIr && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Numero titulo="Bancos hoy" valor={formatCurrency(tARS.disponible)} extra={tUSD.disponible ? `+ ${formatCurrency(tUSD.disponible, "USD")}` : "bancos + FCI + efectivo"} />
          <Numero titulo="Para cubrir hoy" valor={paraCubrir > 0 ? formatCurrency(paraCubrir) : "Nada"} extra={paraCubrir > 0 ? "rescatar / transferir hoy" : "ninguna cuenta en rojo"} color={paraCubrir > 0 ? "text-red-600" : "text-emerald-600"} onClick={paraCubrir > 0 ? () => ir("echeqs") : undefined} />
          <Numero titulo="Cobros a confirmar" valor={sinCruzar ? formatCurrency(sinCruzar.montoCreditos) : "—"} extra={sinCruzar ? `${sinCruzar.creditos} entrada${sinCruzar.creditos === 1 ? "" : "s"} del banco sin cruzar` : undefined} color={sinCruzar?.creditos ? "text-amber-600" : undefined} onClick={() => ir("para_confirmar")} />
          <Numero titulo="Pagos de esta semana" valor={formatCurrency(chequesSemana + (pagosSemana?.ARS || 0))}
            extra={`cheques ${formatCurrency(chequesSemana)} · facturas ${formatCurrency(pagosSemana?.ARS || 0)}${pagosSemana?.USD ? ` + ${formatCurrency(pagosSemana.USD, "USD")}` : ""}${pagosSemana?.vencidas ? ` (${pagosSemana.vencidas} vencidas)` : ""}`}
            onClick={() => ir("vencimientos")} />
        </div>
      )}

      {/* 2) Para hacer hoy: todos los avisos juntos, cada uno con Ir */}
      {onIr && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {urgentes.length > 0 ? <AlertTriangle className="h-4 w-4 text-red-500" /> : <Lightbulb className="h-4 w-4 text-orange-500" />} Para hacer hoy
          </p>
          {paraHacer.length === 0 ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Todo al día ✓</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {paraHacer.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className={`flex min-w-0 items-start gap-2 ${colorAviso[a.color || "gris"]}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${puntoAviso[a.color || "gris"]}`} />
                    <span>{a.texto}</span>
                  </span>
                  {a.tab && (
                    <button type="button" onClick={() => ir(a.tab!)} className="shrink-0 rounded-md border border-zinc-200 px-2.5 py-0.5 text-xs font-medium text-orange-600 hover:border-orange-300 hover:bg-orange-50 dark:border-zinc-700 dark:hover:bg-orange-950/30">Ir</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 3) "¿Cubro los gastos fijos?" y el resumen, en una sola franja */}
      {resumen ? (
        cobertura ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div>{cobertura}</div>
            <div>{resumen(resultado.totales)}</div>
          </div>
        ) : resumen(resultado.totales)
      ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Total titulo="Disponible (bancos + FCI + efectivo)" valor={formatCurrency(tARS.disponible)} extra={tUSD.disponible ? `+ ${formatCurrency(tUSD.disponible, "USD")}` : undefined} color="text-emerald-600" />
        <Total titulo="Cheques en cartera" valor={formatCurrency(tARS.chequesCartera)} extra={tARS.chequesDepositados ? `+ ${formatCurrency(tARS.chequesDepositados)} depositados sin acreditar` : undefined} color="text-blue-600" onClick={onIrACheques} />
        <Total titulo="Comprometido en cheques emitidos" valor={formatCurrency(tARS.comprometidoEmitidos)} extra="Sale del banco cuando se debitan" color="text-orange-500" onClick={onIrACheques} />
        <Total titulo="Tarjetas" valor="Por resumen" extra="Se cargan con el resumen mensual (próxima etapa)" color="text-zinc-500" />
      </div>
      )}

      {/* 4) Cuentas en tabla compacta: un renglón por cuenta */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Cuentas</h3>
          <button onClick={() => setForm({ ...formVacio })} className="flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-600">
            <Plus className="h-3.5 w-3.5" /> Nueva cuenta
          </button>
        </div>
        {activas.length === 0 ? (
          <p className="p-4 text-center text-sm text-zinc-500">Todavía no hay cuentas cargadas para esta sociedad.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                  <th className="px-3 py-1.5 font-medium">Cuenta</th>
                  <th className="px-3 py-1.5 text-right font-medium">Saldo hoy</th>
                  <th className="px-3 py-1.5 text-right font-medium">Según el banco</th>
                  <th className="px-3 py-1.5 text-right font-medium">Desde el extracto</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {activas.map((c) => {
                  const s = resultado.porCuenta[c.id];
                  if (!s) return null;
                  const Icono = ICONO[c.tipo] || Wallet;
                  const pasadoDeAcuerdo = c.tipo === "cuenta_corriente" && s.disponibleConAcuerdo !== null && s.disponibleConAcuerdo < 0;
                  const esCheques = c.tipo === "cheques_cartera" || c.tipo === "cheques_emitidos";
                  const abiertaEsta = abierta === c.id;
                  const movsCuenta = abiertaEsta ? movimientos.filter((m) => m.cuenta_id === c.id && String(m.fecha).slice(0, 10) > c.fecha_corte) : [];
                  const bancoAtrasado = bancosAtrasados.some((b) => b.id === c.id);
                  const diferencia = s.segunBanco ? s.saldo - Number(c.saldo_banco || 0) : null;
                  return (
                    <Fragment key={c.id}>
                      <tr className="border-t border-zinc-100 align-top dark:border-zinc-800">
                        <td className="px-3 py-1.5">
                          <button type="button" onClick={() => setAbierta(abiertaEsta ? null : c.id)} className="flex min-w-0 items-center gap-2 text-left">
                            <Icono className="h-4 w-4 shrink-0 text-zinc-400" />
                            <span className="min-w-0">
                              <span className="font-medium text-zinc-900 hover:text-orange-600 dark:text-white">{c.nombre}</span>
                              <span className="ml-1.5 text-[11px] text-zinc-400">{TIPO_CUENTA_LABEL[c.tipo]}{c.numero ? ` · ${c.numero}` : ""}{c.moneda === "USD" ? " · U$S" : ""}</span>
                              {c.predeterminada && <span className="ml-1.5 text-[10px] text-blue-600">sugerida</span>}
                              {c.uso === "mixto" && <span className="ml-1.5 text-[10px] text-amber-600">uso mixto</span>}
                              {s.faltaSaldoInicial && <span className="ml-1.5 text-[10px] font-semibold text-red-600">falta saldo al corte</span>}
                            </span>
                          </button>
                        </td>
                        <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold ${s.saldo < 0 ? "text-red-600" : "text-zinc-900 dark:text-white"}`}>
                          {c.tipo === "tarjeta_credito" ? <span className="font-sans text-xs font-normal text-zinc-400">por resumen</span> : formatCurrency(s.saldo, c.moneda)}
                          {pasadoDeAcuerdo && <span className="block text-[10px] font-semibold text-red-600">pasado del acuerdo {formatCurrency(Math.abs(s.disponibleConAcuerdo || 0))}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                          {s.segunBanco ? (
                            <span className={bancoAtrasado ? "text-amber-700 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400"}>
                              <span className="font-mono">{formatCurrency(Number(c.saldo_banco || 0), c.moneda)}</span> al {formatDate(s.segunBanco).slice(0, 5)}
                            </span>
                          ) : esCheques ? (
                            <span className="text-zinc-500">{s.cantidadCheques} ch.{s.vencimientos?.vencidos ? <span className="text-red-600"> · {formatCurrency(s.vencimientos.vencidos)} fecha pasada</span> : ""}</span>
                          ) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs ${diferencia !== null && diferencia < -0.01 ? "text-red-600" : "text-zinc-500"}`}>
                          {diferencia !== null && Math.abs(diferencia) >= 0.01 ? `${diferencia > 0 ? "+" : "−"}${formatCurrency(Math.abs(diferencia), c.moneda)}` : diferencia !== null ? "—" : ""}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">
                          {!esCheques && (
                            <button onClick={() => editar(c)} title="Editar" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                      {abiertaEsta && (
                        <tr className="bg-zinc-50/70 dark:bg-zinc-800/30">
                          <td colSpan={5} className="px-3 py-2 text-xs text-zinc-500">
                            {usaSaldoInicial(c.tipo) && (
                              <p>Saldo al {formatDate(c.fecha_corte)}: <span className="font-mono">{c.saldo_inicial === null ? "—" : formatCurrency(Number(c.saldo_inicial), c.moneda)}</span>
                                {" · "}Desde el corte: <span className="text-emerald-600">+{formatCurrency(s.ingresos, c.moneda)}</span> / <span className="text-red-600">−{formatCurrency(s.egresos, c.moneda)}</span> ({s.cantidadMovimientos} mov.)
                                {!s.segunBanco && Boolean(s.pases) && ` · incluye ${formatCurrency(s.pases || 0, c.moneda)} de ${c.tipo === "fci" ? "suscripciones y rescates" : "pases"} del extracto`}
                              </p>
                            )}
                            {c.tipo === "cuenta_corriente" && Number(c.acuerdo || 0) > 0 && s.disponibleConAcuerdo !== null && (
                              <p>Con acuerdo de {formatCurrency(Number(c.acuerdo))}: {pasadoDeAcuerdo ? "pasado " : "disponible "}{formatCurrency(Math.abs(s.disponibleConAcuerdo))}</p>
                            )}
                            {esCheques && s.vencimientos && (
                              <p>
                                {s.vencimientos.vencidos > 0 && <span className="font-semibold text-red-600">{c.tipo === "cheques_emitidos" ? "Fecha pasada, sin debitar" : "Fecha de pago pasada"}: {formatCurrency(s.vencimientos.vencidos)} · </span>}
                                Próximos 7 días: <span className="font-mono">{formatCurrency(s.vencimientos.proximos7)}</span> · Resto del mes: <span className="font-mono">{formatCurrency(s.vencimientos.restoMes)}</span> · Más adelante: <span className="font-mono">{formatCurrency(s.vencimientos.despues)}</span>
                                {c.tipo === "cheques_cartera" && (s.depositados || 0) > 0 && <> · Depositados sin acreditar: <span className="font-mono">{formatCurrency(s.depositados || 0)}</span></>}
                              </p>
                            )}
                            {c.tipo === "tarjeta_credito" && <p>Va por resumen mensual. {c.se_paga_desde ? `Se paga desde ${nombreCuenta(c.se_paga_desde)}.` : "Sin cuenta de pago."}</p>}
                            {c.observaciones && <p className="italic text-zinc-400">{c.observaciones}</p>}
                            {movsCuenta.length > 0 && (
                              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900">
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
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800">
          <span>Tocá una cuenta para ver el detalle y sus movimientos. &quot;Desde el extracto&quot; = lo que el CRM sumó o restó después del último extracto cargado.</span>
          {inactivas.length > 0 && (
            <span>Inactivas: {inactivas.map((c, i) => (
              <button key={c.id} onClick={() => editar(c)} className="hover:underline">{i > 0 ? ", " : ""}{c.nombre}</button>
            ))}</span>
          )}
        </div>
      </div>

      {/* Cheques propios a debitar, semana por semana (plegado) */}
      <details className="rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm dark:border-violet-900 dark:bg-violet-950/30">
        <summary className="cursor-pointer text-xs font-medium text-violet-800 dark:text-violet-200">Cheques propios a debitar, semana por semana</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {semanas.atrasado > 0 && (
                <tr className="border-t border-violet-100 dark:border-violet-900">
                  <td className="py-1 pr-3 text-amber-700 dark:text-amber-400">Fecha pasada, sin debitar</td>
                  <td className="py-1 pr-3 text-right font-mono text-amber-700 dark:text-amber-400">{formatCurrency(semanas.atrasado)}</td>
                  <td className="py-1 text-zinc-500">Se pueden presentar hasta 30 días después de su fecha: se cubren hoy. Si ya salieron del banco, se marcan solos al subir el extracto.</td>
                </tr>
              )}
              {semanas.semanas.map((w) => (
                <tr key={w.desde} className="border-t border-violet-100 align-top dark:border-violet-900">
                  <td className="whitespace-nowrap py-1 pr-3 text-zinc-600 dark:text-zinc-400">Semana {formatDate(w.desde).slice(0, 5)} – {formatDate(w.hasta).slice(0, 5)}</td>
                  <td className={`whitespace-nowrap py-1 pr-3 text-right font-mono ${w.monto ? "font-semibold text-zinc-900 dark:text-white" : "text-zinc-400"}`}>{w.monto ? formatCurrency(w.monto) : "—"}</td>
                  <td className="py-1 text-zinc-500">
                    {w.dias.map((d) => `${diaCorto(d.fecha)}: ${formatCurrency(d.monto)} (${d.cantidad} ch., rescatar ${diaCorto(d.rescatarEl)})`).join(" · ")}
                  </td>
                </tr>
              ))}
              {semanas.despues > 0 && (
                <tr className="border-t border-violet-100 dark:border-violet-900">
                  <td className="py-1 pr-3 text-zinc-600 dark:text-zinc-400">Más adelante</td>
                  <td className="py-1 pr-3 text-right font-mono text-zinc-700 dark:text-zinc-300">{formatCurrency(semanas.despues)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>

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

function Numero({ titulo, valor, extra, color, onClick }: { titulo: string; valor: string; extra?: string; color?: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left dark:border-zinc-800 dark:bg-zinc-900 ${onClick ? "transition-colors hover:border-orange-300" : ""}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{titulo}</p>
      <p className={`font-mono text-lg font-bold ${color || "text-zinc-900 dark:text-white"}`}>{valor}</p>
      {extra && <p className="truncate text-[11px] text-zinc-400" title={extra}>{extra}</p>}
    </Tag>
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
