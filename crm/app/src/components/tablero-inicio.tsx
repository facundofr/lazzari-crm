"use client";

// Inicio de Augusto (02/11/2026, boceto D elegido con Augusto: "simple pero estético y funcional"). La primera pantalla del CRM
// para el super_admin: la plata de un vistazo y todo en pesos. Solo lectura, salvo «Subir archivos del banco», que abre la misma
// ventana de Bancos → Movimientos (banco simple): al guardar se cruza solo y al cerrarla estos números se recalculan.
// - Arriba: la línea del banco (última subida, saldo de las cuentas según el banco, líneas sin cruzar) y el aviso de lo que falta subir.
// - 3 frases armadas con los números (sin IA), los 4 números (facturado, a cobrar, a pagar, cheques a cubrir esta semana),
//   las próximas 4 semanas (lo que vence para cobrar contra lo que vence para pagar y los cheques) y la agenda de esta semana.
// Mismos datos que Finanzas: traerDeudas (saldo por factura), cheques propios (lib/cheques-lazza), facturadoMesNeto y el objetivo
// general. Cuentas en lib/tablero-inicio (prueba: scripts/test-tablero-inicio.ts). Cada bloque se calcula aparte: si uno falla, muestra "—".
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Landmark, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { facturadoMesNeto } from "@/lib/facturado-mes";
import { periodoDeFecha, sumarMeses } from "@/lib/reportes-comprobantes";
import type { FilaVencimiento } from "@/lib/finanzas-lazza";
import { separarSacados } from "@/lib/saldos-pendientes";
import {
  MESES, agendaSemana, aPesos, chequesPorDia, frasesInicio, listaDias, mayorVencido, nombreDia, pesosCorto, plazosCheques, plazosFacturas,
  semanasTablero, type ChequeTablero, type ItemAgenda, type Parte, type Plazos,
} from "@/lib/tablero-inicio";
import { traerDeudas } from "@/components/finanzas-lazza/datos";
import { CargaDiaria } from "@/components/finanzas-lazza/carga-diaria";
import { BancoSimple } from "@/components/finanzas-lazza/banco-simple";
import { Modal } from "@/components/ui/modal";

const db = supabase as any;

const COLOR = { entra: "bg-emerald-500", pagos: "bg-rose-400", cheques: "bg-amber-400", vencido: "bg-red-500", resto: "bg-zinc-200 dark:bg-zinc-700" };

interface CuentaBanco { nombre: string; moneda: string; saldo: number; fecha: string | null }
interface Datos {
  filas: FilaVencimiento[] | null;
  cheques: ChequeTablero[] | null;
  dolar: { valor: number; fecha: string } | null;
  facturado: { actual: number; anterior: number } | null;
  objetivo: number | null;
  cuentas: CuentaBanco[] | null;
  sinCruzar: number | null;
  ultimaSubida: string | null;
}

/** Todo lo que muestra el inicio. Cada parte por separado: si una falla, queda en null y el resto se ve igual. */
async function traerDatos(sociedadId: string, hoy: string): Promise<Datos> {
  const periodo = periodoDeFecha(hoy);
  const anterior = sumarMeses(periodo, -1);
  const parte = async <T,>(p: () => Promise<T>, nombre: string): Promise<T | null> => {
    try { return await p(); } catch (e) { console.error(`Inicio · ${nombre}:`, e); return null; }
  };
  const [filas, cheques, dolar, facturado, objetivo, cuentas, ultimaSubida] = await Promise.all([
    // Sin los saldos chicos sacados de pendientes (Cobrar y Pagar, 02/11/2026).
    parte(async () => { const d = await traerDeudas(sociedadId, hoy); return separarSacados(d.vencimientos, d.sacados).pendientes; }, "a cobrar y a pagar"),
    parte(() => traerTodo<ChequeTablero>(() => db.from("echeqs").select("id, numero, monto, moneda, fecha_pago, estado, direccion, destino_nombre")
      .eq("sociedad_id", sociedadId).eq("direccion", "emitido").in("estado", ["pendiente", "entregado"]).order("id")), "cheques"),
    parte(async () => {
      const { data, error } = await db.from("cotizaciones_dolar").select("fecha, valor_venta").eq("tipo", "oficial_divisas")
        .lte("fecha", hoy).order("fecha", { ascending: false }).limit(1);
      if (error) throw error;
      const r = (data || [])[0];
      return r && Number(r.valor_venta) > 0 ? { valor: Number(r.valor_venta), fecha: String(r.fecha).slice(0, 10) } : null;
    }, "dólar del día"),
    parte(async () => {
      const [rows, anuladas] = await Promise.all([
        traerTodo<any>(() => db.from("facturas").select("id, fecha, tipo, estado, moneda, subtotal, total, tipo_cambio, factura_origen_id")
          .eq("sociedad_id", sociedadId).gte("fecha", `${anterior}-01`).neq("estado", "anulada").order("fecha").order("id")),
        traerTodo<{ id: string }>(() => db.from("facturas").select("id").eq("sociedad_id", sociedadId).eq("estado", "anulada").order("id")),
      ]);
      const ids = anuladas.map((r) => r.id);
      const dia = Number(hoy.slice(8, 10));
      return {
        actual: facturadoMesNeto(rows, periodo, { idsAnulados: ids }).equivalenteARS,
        anterior: facturadoMesNeto(rows, anterior, { hastaDia: dia, idsAnulados: ids }).equivalenteARS,
      };
    }, "facturado"),
    // El objetivo general del mes, el mismo que el recuadro de gastos fijos (sin vendedor, en pesos; el más alto si hay varios).
    parte(async () => {
      const { data, error } = await db.from("objetivos").select("monto_target, moneda, usuario_id").eq("activo", true)
        .lte("periodo_inicio", hoy).gte("periodo_fin", hoy).or(`sociedad_id.is.null,sociedad_id.eq.${sociedadId}`);
      if (error) throw error;
      const generales = ((data || []) as any[]).filter((o) => !o.usuario_id && (o.moneda || "ARS") === "ARS").map((o) => Number(o.monto_target) || 0);
      return generales.length ? Math.max(...generales) : null;
    }, "objetivo"),
    parte(async () => {
      const { data, error } = await db.from("cuentas_financieras").select("id, nombre, tipo, moneda, activa, saldo_banco, saldo_banco_fecha").eq("sociedad_id", sociedadId);
      if (error) throw error;
      const todas = (data || []) as any[];
      const { count, error: e2 } = todas.length
        ? await db.from("extracto_movimientos").select("id", { count: "exact", head: true }).in("cuenta_id", todas.map((c) => c.id)).eq("estado", "pendiente")
        : { count: 0, error: null };
      if (e2) throw e2;
      const bancos: CuentaBanco[] = todas
        .filter((c) => c.activa !== false && ["cuenta_corriente", "caja_ahorro"].includes(c.tipo) && c.saldo_banco !== null)
        .map((c) => ({ nombre: c.nombre, moneda: c.moneda || "ARS", saldo: Number(c.saldo_banco) || 0, fecha: c.saldo_banco_fecha ? String(c.saldo_banco_fecha).slice(0, 10) : null }));
      return { bancos, sinCruzar: count ?? 0 };
    }, "bancos"),
    parte(async () => {
      const { data, error } = await db.from("finanzas_registro").select("created_at").eq("sociedad_id", sociedadId)
        .in("accion", ["extracto_cargado", "cheques_cargados"]).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return (data || [])[0]?.created_at ? String(data[0].created_at) : null;
    }, "última subida"),
  ]);
  return {
    filas, cheques, dolar, facturado, objetivo,
    cuentas: cuentas?.bancos ?? null, sinCruzar: cuentas?.sinCruzar ?? null, ultimaSubida,
  };
}

const millones = (n: number) => (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 });
const fechaCorta = (f: string) => formatDate(f).slice(0, 5);

/** "hoy 10:56", "ayer 18:20", "vie 30/10". */
function cuandoSubio(iso: string, hoy: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const hora = d.toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (dia === hoy) return `hoy ${hora}`;
  if (dia === ayer) return `ayer ${hora}`;
  return `${nombreDia(dia).slice(0, 3)} ${fechaCorta(dia)}`;
}

function saludo(): string {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

function Frase({ partes }: { partes: Parte[] }) {
  return (
    <p>
      {partes.map((p, i) => typeof p === "string" ? <span key={i}>{p}</span> : (
        <b key={i} className={`font-semibold ${p.tono === "rojo" ? "text-red-600 dark:text-red-400" : p.tono === "naranja" ? "text-amber-600 dark:text-amber-400" : "text-zinc-900 dark:text-white"}`}>{p.fuerte}</b>
      ))}
    </p>
  );
}

function Tarjeta({ href, titulo, valor, children }: { href: string; titulo: string; valor: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-[104px] flex-col rounded-xl border border-zinc-200 bg-white p-3 transition-colors hover:border-orange-300 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs text-zinc-500">{titulo}</span>
      <span className="text-xl font-semibold text-zinc-900 dark:text-white">{valor}</span>
      {children}
    </Link>
  );
}

/** Barra finita: vencido (rojo), esta semana (color del lado) y el resto (gris). */
function BarraPlazos({ p, colorSemana }: { p: Plazos; colorSemana: string }) {
  const resto = Math.max(p.total - p.vencido - p.semanas[0], 0);
  const pct = (n: number) => (p.total > 0 ? `${(n / p.total) * 100}%` : "0%");
  return (
    <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div className={COLOR.vencido} style={{ width: pct(p.vencido) }} />
      <div className={colorSemana} style={{ width: pct(p.semanas[0]) }} />
      <div className={COLOR.resto} style={{ width: pct(resto) }} />
    </div>
  );
}

function Dolares({ usd, dolar }: { usd: number; dolar: Datos["dolar"] }) {
  if (usd < 0.5) return null;
  const monto = `US$ ${Math.round(usd).toLocaleString("es-AR")}`;
  return (
    <span className="mt-0.5 text-[11px] text-zinc-400">
      {dolar ? `incluye ${monto} a ${formatCurrency(dolar.valor).replace(/,00$/, "")}${dolar.fecha !== todayAR() ? ` (${fechaCorta(dolar.fecha)})` : ""}` : `${monto} sin pasar a pesos: falta el dólar del día`}
    </span>
  );
}

function Anillo({ pct }: { pct: number | null }) {
  const largo = 2 * Math.PI * 16;
  const lleno = pct === null ? 0 : Math.min(Math.max(pct, 0), 100) / 100 * largo;
  return (
    <svg width="46" height="46" viewBox="0 0 44 44" aria-hidden="true" className="shrink-0">
      <circle cx="22" cy="22" r="16" fill="none" strokeWidth="6" className="stroke-zinc-100 dark:stroke-zinc-800" />
      {lleno > 0 && <circle cx="22" cy="22" r="16" fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-emerald-500"
        strokeDasharray={`${lleno} ${largo}`} transform="rotate(-90 22 22)" />}
      <text x="22" y="26" textAnchor="middle" className="fill-zinc-700 text-[11px] dark:fill-zinc-200">{pct === null ? "—" : `${Math.round(pct)} %`}</text>
    </svg>
  );
}

const ETIQUETA: Record<ItemAgenda["tipo"], { texto: string; clase: string }> = {
  cobro: { texto: "Cobro", clase: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  pago: { texto: "Pago", clase: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  cheque: { texto: "Cheque", clase: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
};

function linkAgenda(a: ItemAgenda): string {
  if (a.tipo === "cobro") return a.entidadId ? `/finanzas?seccion=cuentas&cliente=${encodeURIComponent(a.entidadId)}` : "/finanzas?seccion=cobrar";
  return a.tipo === "pago" ? "/finanzas?seccion=pagar" : "/finanzas?seccion=cheques";
}

export function TableroInicio({ sociedadId, nombre }: { sociedadId: string; nombre: string }) {
  const hoy = todayAR();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [bancoAbierto, setBancoAbierto] = useState(false);
  const [verTodo, setVerTodo] = useState(false);

  const cargar = useCallback(async () => {
    setDatos(await traerDatos(sociedadId, hoy));
  }, [sociedadId, hoy]);

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    traerDatos(sociedadId, hoy).then((d) => { if (vivo) setDatos(d); });
    return () => { vivo = false; };
  }, [sociedadId, hoy]);

  const semanas = useMemo(() => semanasTablero(hoy), [hoy]);
  const cuentas = useMemo(() => {
    if (!datos) return null;
    const dolar = datos.dolar?.valor ?? null;
    const cobrar = datos.filas ? plazosFacturas(datos.filas, "venta", hoy, dolar, semanas) : null;
    const pagar = datos.filas ? plazosFacturas(datos.filas, "compra", hoy, dolar, semanas) : null;
    const cheques = datos.cheques ? plazosCheques(datos.cheques, hoy, dolar, semanas) : null;
    const dias = datos.cheques ? chequesPorDia(datos.cheques, hoy, dolar, semanas[0]) : null;
    const agenda = datos.filas && datos.cheques ? agendaSemana(datos.filas, datos.cheques, hoy, dolar, semanas[0]) : null;
    const frases = frasesInicio({
      hoy,
      facturado: datos.facturado?.actual ?? null,
      facturadoAnterior: datos.facturado?.anterior ?? null,
      objetivo: datos.objetivo,
      cheques: { cantidad: dias ? dias.reduce((s, d) => s + d.cantidad, 0) : 0, pesos: cheques?.semanas[0] ?? 0, fechas: (dias || []).filter((d) => d.cantidad).map((d) => d.fecha) },
      pagosSemana: pagar?.semanas[0] ?? 0,
      vencidoCobrar: cobrar?.vencido ?? 0,
      mayorVencido: datos.filas ? mayorVencido(datos.filas, hoy, dolar) : null,
    });
    const enBancos = datos.cuentas ? datos.cuentas.reduce((s, c) => s + aPesos(c.saldo, c.moneda, dolar), 0) : null;
    return { cobrar, pagar, cheques, dias, agenda, frases, enBancos };
  }, [datos, hoy, semanas]);

  const mes = MESES[Number(hoy.slice(5, 7)) - 1];
  const fechaLarga = new Date(`${hoy}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  const pctObjetivo = datos?.facturado && datos.objetivo ? (datos.facturado.actual / datos.objetivo) * 100 : null;
  const cargando = !datos || !cuentas;

  // Las 4 semanas: altura de las barras contra la semana más cargada (lo que entra o lo que sale).
  const filasSemanas = cuentas?.cobrar && cuentas.pagar && cuentas.cheques
    ? semanas.map((s, i) => ({ s, entra: cuentas.cobrar!.semanas[i], pagos: cuentas.pagar!.semanas[i], cheques: cuentas.cheques!.semanas[i] }))
    : null;
  const tope = filasSemanas ? Math.max(1, ...filasSemanas.map((x) => Math.max(x.entra, x.pagos + x.cheques))) : 1;
  const alto = (n: number) => `${Math.round((n / tope) * 112)}px`;
  const agenda = cuentas?.agenda || [];
  const agendaVisible = verTodo ? agenda : agenda.slice(0, 6);

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{saludo()}, {nombre}</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{fechaLarga}</p>
      </div>

      {/* La línea del banco: cuándo se subió, cuánto hay según el banco y lo que quedó sin cruzar. El botón abre Movimientos del banco. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <Landmark className="h-4 w-4 shrink-0 text-zinc-400" />
        <span>Banco · última subida <b className="font-medium text-zinc-800 dark:text-zinc-100">{datos?.ultimaSubida ? cuandoSubio(datos.ultimaSubida, hoy) : cargando ? "…" : "—"}</b></span>
        {cuentas?.enBancos !== null && cuentas?.enBancos !== undefined && datos?.cuentas?.length ? (
          <span title={datos.cuentas.map((c) => `${c.nombre}: ${formatCurrency(c.saldo, c.moneda === "USD" ? "USD" : "ARS")}${c.fecha ? ` (${fechaCorta(c.fecha)})` : ""}`).join("\n")}>
            · en bancos <b className="font-medium text-zinc-800 dark:text-zinc-100">{pesosCorto(cuentas.enBancos)}</b>
          </span>
        ) : null}
        {datos?.sinCruzar ? (
          <button type="button" onClick={() => setBancoAbierto(true)} className="text-amber-700 hover:underline dark:text-amber-400">
            · {datos.sinCruzar} línea{datos.sinCruzar > 1 ? "s" : ""} sin cruzar
          </button>
        ) : null}
        <span className="flex-1" />
        <button type="button" onClick={() => setBancoAbierto(true)}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-medium text-zinc-700 hover:border-orange-300 hover:text-orange-600 dark:border-zinc-700 dark:text-zinc-200">
          <Upload className="h-3.5 w-3.5" /> Subir archivos del banco
        </button>
      </div>
      <CargaDiaria sociedadId={sociedadId} hoy={hoy} soloSiFalta onIr={() => setBancoAbierto(true)} />

      <div className="space-y-0.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        {cargando ? <div className="h-10 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /> : cuentas.frases.map((f, i) => <Frase key={i} partes={f} />)}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/finanzas?seccion=facturas" className="flex min-h-[104px] items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3 transition-colors hover:border-orange-300 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-zinc-500">Facturado {mes}</span>
            <span className="text-xl font-semibold text-zinc-900 dark:text-white">{datos?.facturado ? pesosCorto(datos.facturado.actual) : cargando ? "…" : "—"}</span>
            <span className="text-[11px] text-zinc-400">{datos?.objetivo ? `de ${pesosCorto(datos.objetivo)} · sin IVA` : "sin IVA · sin objetivo cargado"}</span>
          </span>
          <Anillo pct={pctObjetivo} />
        </Link>
        <Tarjeta href="/finanzas?seccion=cobrar" titulo="A cobrar" valor={cuentas?.cobrar ? pesosCorto(cuentas.cobrar.total) : cargando ? "…" : "—"}>
          {cuentas?.cobrar && <>
            <BarraPlazos p={cuentas.cobrar} colorSemana={COLOR.entra} />
            <span className="mt-1 text-[11px] text-zinc-500"><span className="text-red-600 dark:text-red-400">vencido {pesosCorto(cuentas.cobrar.vencido)}</span> · semana {pesosCorto(cuentas.cobrar.semanas[0])}</span>
            <Dolares usd={cuentas.cobrar.usd} dolar={datos?.dolar ?? null} />
          </>}
        </Tarjeta>
        <Tarjeta href="/finanzas?seccion=pagar" titulo="A pagar" valor={cuentas?.pagar ? pesosCorto(cuentas.pagar.total) : cargando ? "…" : "—"}>
          {cuentas?.pagar && <>
            <BarraPlazos p={cuentas.pagar} colorSemana={COLOR.pagos} />
            <span className="mt-1 text-[11px] text-zinc-500"><span className="text-red-600 dark:text-red-400">vencido {pesosCorto(cuentas.pagar.vencido)}</span> · semana {pesosCorto(cuentas.pagar.semanas[0])}</span>
            <Dolares usd={cuentas.pagar.usd} dolar={datos?.dolar ?? null} />
          </>}
        </Tarjeta>
        <Tarjeta href="/finanzas?seccion=cheques" titulo="A cubrir esta semana" valor={cuentas?.cheques ? pesosCorto(cuentas.cheques.semanas[0]) : cargando ? "…" : "—"}>
          {cuentas?.dias && <>
            <div className="mt-1.5 flex h-6 items-end gap-1" aria-hidden="true">
              {cuentas.dias.map((d) => {
                const max = Math.max(1, ...cuentas.dias!.map((x) => x.pesos));
                return <div key={d.fecha} title={`${nombreDia(d.fecha)} ${fechaCorta(d.fecha)}: ${formatCurrency(d.pesos)}`}
                  className={`flex-1 rounded-sm ${d.pesos > 0 ? COLOR.cheques : COLOR.resto}`} style={{ height: d.pesos > 0 ? `${Math.max(6, (d.pesos / max) * 24)}px` : "2px" }} />;
              })}
            </div>
            <span className="mt-1 text-[11px] text-zinc-500">
              {(() => {
                const con = cuentas.dias.filter((d) => d.cantidad);
                const n = con.reduce((s, d) => s + d.cantidad, 0);
                return n ? `${n} cheque${n > 1 ? "s" : ""} · ${listaDias(con.map((d) => d.fecha), hoy)}` : "sin cheques esta semana";
              })()}
            </span>
          </>}
        </Tarjeta>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Próximas 4 semanas <span className="text-xs font-normal text-zinc-400">· en millones</span></p>
          <p className="mb-2 flex flex-wrap items-center gap-x-3 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-sm ${COLOR.entra}`} />Vence para cobrar</span>
            <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-sm ${COLOR.pagos}`} />Pagos</span>
            <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-sm ${COLOR.cheques}`} />Cheques</span>
          </p>
          {filasSemanas ? (
            <div className="flex gap-2">
              {filasSemanas.map(({ s, entra, pagos, cheques }, i) => (
                <div key={s.desde} className="flex min-w-0 flex-1 flex-col items-center"
                  title={`${fechaCorta(s.desde)} al ${fechaCorta(s.hasta)}\nVence para cobrar: ${formatCurrency(entra)}\nPagos: ${formatCurrency(pagos)}\nCheques: ${formatCurrency(cheques)}`}>
                  <div className="flex h-28 items-end gap-1">
                    <div className={`w-4 rounded-t ${COLOR.entra}`} style={{ height: alto(entra) }} />
                    <div className="flex w-4 flex-col">
                      <div className={`${COLOR.cheques} ${cheques > 0 ? "rounded-t" : ""}`} style={{ height: alto(cheques) }} />
                      <div className={`${COLOR.pagos} ${cheques > 0 ? "" : "rounded-t"}`} style={{ height: alto(pagos) }} />
                    </div>
                  </div>
                  <span className={`mt-1 text-[11px] ${i === 0 ? "font-semibold text-zinc-700 dark:text-zinc-200" : "text-zinc-500"}`}>{i === 0 ? "esta semana" : `${s.desde.slice(8, 10)}–${fechaCorta(s.hasta)}`}</span>
                  <span className="text-[11px] text-zinc-400">+{millones(entra)} · −{millones(pagos + cheques)}</span>
                </div>
              ))}
            </div>
          ) : <div className="h-36 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />}
          <p className="mt-2 text-[11px] text-zinc-400">Lo vencido no está acá: está en los números de arriba.</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">Esta semana, día por día</p>
          {cargando ? <div className="h-36 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /> : !cuentas.agenda ? (
            <p className="py-6 text-center text-xs text-zinc-400">—</p>
          ) : agenda.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-400">Esta semana no vence nada.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {agendaVisible.map((a, i) => (
                <Link key={`${a.tipo}-${a.fecha}-${i}`} href={linkAgenda(a)} className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="w-12 shrink-0 text-zinc-500">{a.fecha === hoy ? "hoy" : `${nombreDia(a.fecha).slice(0, 3)} ${a.fecha.slice(8, 10)}`}</span>
                    <span className={`shrink-0 rounded px-1.5 py-px text-[11px] ${ETIQUETA[a.tipo].clase}`}>{ETIQUETA[a.tipo].texto}</span>
                    <span className="truncate text-zinc-700 dark:text-zinc-200" title={`${a.nombre} · ${a.detalle}`}>{a.nombre || a.detalle}</span>
                    {a.cantidad > 1 && <span className="shrink-0 text-[11px] text-zinc-400">{a.detalle}</span>}
                    {a.usd !== null && <span className="shrink-0 text-[11px] text-zinc-400">US$ {Math.round(a.usd).toLocaleString("es-AR")}</span>}
                    {a.enFechaDesde && <span className="shrink-0 text-[11px] text-amber-600">en fecha desde {fechaCorta(a.enFechaDesde)}</span>}
                  </span>
                  <span className="shrink-0 font-medium text-zinc-800 dark:text-zinc-100">{pesosCorto(a.pesos)}</span>
                </Link>
              ))}
              {agenda.length > 6 && (
                <button type="button" onClick={() => setVerTodo((v) => !v)} className="w-full pt-1.5 text-left text-xs font-medium text-orange-600 hover:underline">
                  {verTodo ? "Ver menos" : `Ver ${agenda.length - 6} más`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={bancoAbierto} onClose={() => { setBancoAbierto(false); void cargar(); }} title="Movimientos del banco" size="2xl">
        {bancoAbierto && <BancoSimple sociedadId={sociedadId} />}
      </Modal>
    </div>
  );
}
