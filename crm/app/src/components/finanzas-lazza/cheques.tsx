"use client";

// Finanzas Lazza → Cheques (diseño de Augusto 19/10/2026): todos los cheques con todos los estados, filtrables y por categoría;
// arriba lo que está EN FECHA de pago y de cobro, el resumen por estado y las próximas 4 semanas. Solo informativo:
// los estados cambian solos con cobros, OP y el Excel del banco (sin botones a mano). Pestaña aparte "Martín F."
// = la misma pantalla de Finanzas (components/cheques-tercero, echeqs.cubre_tercero). Cálculos en lib/cheques-lazza.
// 27/10/2026 (auditoría UX, arreglos 19 y 20): la lista abre con lo pendiente ("Ver todos" a un clic), el pie suma por estado,
// lo que el banco ya tiene sale de "para depositar" y el detalle muestra la OP o el recibo del cheque, con link.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Upload, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import ChequesTercero from "@/components/cheques-tercero";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { chequePendiente } from "@/lib/cheques-plazo";
import { enFecha, estaEnFecha, estadoCheque, opsDeCheques, ordenCheques, proximaSemana, proximasSemanas, resumenPorEstado, situacionPago, type ChequeFL, type OpDelCheque, type Total } from "@/lib/cheques-lazza";
import { ChequesBanco } from "./cheques-banco";
import { verOP } from "./orden-pago-doc";
import { abrirRecibo, traerRecibo } from "./recibo-doc";

const MOSTRAR_SUBIR_VIEJO = false;
import { diferenciaConBanco } from "@/lib/cheques-estado-banco";
import { nombreEstadoBancoTitulo } from "@/lib/nombres-estados";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Cheque extends ChequeFL {
  banco: string; cuit: string; tipo: string; emision: string | null; pago: string;
  origen: string; destino: string; fechaEndoso: string | null; fechaDeposito: string | null; observaciones: string;
  /** Estado según el banco (reportes eCheq), tal cual; vacío si todavía no se cargó. */
  estadoBanco: string;
  /** Día en que la plata se movió en la cuenta según el Excel "Movimientos" (débito, depósito o devolución), o null (26/10/2026, Augusto). */
  diaBanco: string | null;
  /** OP donde figura (auditoría UX 26/10/2026, arreglo 20): la que pagó un propio o donde se endosó uno recibido; vigentes primero. */
  ops: OpDelCheque[];
  /** Recibo en que entró un cheque recibido (por su cobro), o null. */
  recibo: { id: string; numero: number } | null;
  /** El cobro del cheque está anulado (por ejemplo, cheque rechazado). */
  cobroAnulado: boolean;
}

const TONO: Record<string, string> = {
  naranja: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  azul: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  verde: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  rojo: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  violeta: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  gris: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const montos = (t: Total) => <>{formatCurrency(t.ARS)}{t.USD > 0 && <span className="ml-1 text-xs text-zinc-500">+ {formatCurrency(t.USD, "USD")}</span>}</>;

async function traerCheques(sociedadId: string): Promise<Cheque[]> {
  const [rows, lineas, ops] = await Promise.all([
    traerTodo<any>(() => db.from("echeqs")
      .select("id, numero, banco_emisor, cuit_emisor, monto, moneda, fecha_emision, fecha_pago, estado, origen_nombre, destino_nombre, fecha_endoso, fecha_deposito, observaciones, tipo_cheque, direccion, cubre_tercero, estado_banco, movimiento_id")
      .eq("sociedad_id", sociedadId).order("fecha_pago", { ascending: false }).order("id")),
    // 26/10/2026: el día exacto lo da la línea del Excel atada al cheque (la última: un rechazado tiene depósito y devolución).
    traerTodo<{ cheque_id: string; fecha: string }>(() => db.from("extracto_movimientos")
      .select("cheque_id, fecha").not("cheque_id", "is", null).in("clasificacion", ["cheque_emitido", "cheque_acreditado", "cheque_devuelto"]).order("id")).catch(() => []),
    // Arreglo 20 (27/10/2026): el cheque no guarda su OP; está en los medios de la OP. Si falla, la lista se ve igual.
    traerTodo<any>(() => db.from("ordenes_pago").select("id, numero, estado, fecha, medios_pago").eq("sociedad_id", sociedadId).order("id")).catch(() => []),
  ]);
  const ids = new Set(rows.map((r) => r.id));
  const diaBanco = new Map<string, string>();
  for (const l of lineas) {
    if (!ids.has(l.cheque_id)) continue;
    const f = String(l.fecha).slice(0, 10);
    if (f > (diaBanco.get(l.cheque_id) || "")) diaBanco.set(l.cheque_id, f);
  }
  // Recibo en que entró cada cheque recibido: por su cobro (echeqs.movimiento_id), como las retenciones (arreglo 14).
  const movIds = [...new Set(rows.map((r) => r.movimiento_id).filter(Boolean))] as string[];
  const reciboDeMov = new Map<string, { id: string; numero: number; anulado: boolean }>();
  for (let i = 0; i < movIds.length; i += 200) {
    const { data } = await db.from("recibo_movimientos").select("movimiento_id, recibos(id, numero), movimientos(anulado)").in("movimiento_id", movIds.slice(i, i + 200));
    for (const r of data || []) if (r.recibos?.numero) reciboDeMov.set(r.movimiento_id, { id: r.recibos.id, numero: r.recibos.numero, anulado: !!r.movimientos?.anulado });
  }
  const cheques = rows.map((r) => {
    const recibo = r.movimiento_id ? reciboDeMov.get(r.movimiento_id) : undefined;
    return {
      id: r.id, numero: String(r.numero ?? ""), direccion: r.direccion === "emitido" ? "emitido" as const : "recibido" as const, estado: r.estado || "",
      fecha_pago: r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : null, monto: Number(r.monto || 0), moneda: r.moneda === "USD" ? "USD" : "ARS",
      cubre_tercero: r.cubre_tercero || null,
      banco: r.banco_emisor || "", cuit: r.cuit_emisor || "", tipo: r.tipo_cheque === "fisico" ? "Físico" : "eCheq",
      emision: r.fecha_emision ? String(r.fecha_emision).slice(0, 10) : null, pago: r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : "",
      origen: r.origen_nombre || "", destino: r.destino_nombre || "", fechaEndoso: r.fecha_endoso || null, fechaDeposito: r.fecha_deposito || null,
      observaciones: r.observaciones || "", estadoBanco: r.estado_banco || "", diaBanco: diaBanco.get(r.id) || null,
      ops: [] as OpDelCheque[], recibo: recibo ? { id: recibo.id, numero: recibo.numero } : null, cobroAnulado: !!recibo?.anulado,
    };
  });
  const opsPorCheque = opsDeCheques(cheques, ops.map((o) => ({ id: o.id, numero: o.numero, estado: o.estado, fecha: o.fecha, medios: o.medios_pago })));
  return cheques.map((c) => ({ ...c, ops: opsPorCheque.get(c.id) || [] }));
}

/** Con quién: en los recibidos, quién lo dio (y a quién se endosó); en los emitidos, a quién se le dio. */
const conQuien = (c: Cheque) => (c.direccion === "emitido" ? c.destino : [c.origen, c.destino ? `→ ${c.destino}` : ""].filter(Boolean).join(" "));

/** Nombre del estado en el pie: "Rechazado" y "Anulado" hay de los dos lados. */
const nombreEstado = (e: { clave: string; label: string; direccion: "emitido" | "recibido" }) =>
  (/:(rechazado|anulado)$/.test(e.clave) ? `${e.label} (${e.direccion === "emitido" ? "propios" : "recibidos"})` : e.label);

/** Estado de la lista (arreglo 19, 27/10/2026): abre con lo pendiente (propios sin debitar y recibidos en cartera). "" = todos. */
const PENDIENTES = "pendientes";

export function FinanzasLazzaCheques({ sociedadId }: { sociedadId: string }) {
  const { sociedadActiva } = useUser();
  const [pestana, setPestana] = useState<"todos" | "martin">("todos");
  const [cheques, setCheques] = useState<Cheque[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<"" | "emitido" | "recibido">("");
  const [estado, setEstado] = useState(PENDIENTES);
  const [tipo, setTipo] = useState("");
  const [segunBanco, setSegunBanco] = useState<"" | "diferencia" | "con" | "sin">("");
  const [soloEnFecha, setSoloEnFecha] = useState(false);
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierto, setAbierto] = useState<Cheque | null>(null);
  const [subir, setSubir] = useState(false);
  const hoy = todayAR();

  const cargar = useCallback(() => {
    let vivo = true;
    setError(null);
    traerCheques(sociedadId)
      .then((c) => { if (vivo) setCheques(c); })
      .catch((e) => { console.error("Finanzas Lazza · Cheques:", e); if (vivo) setError("No se pudieron cargar los cheques. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId]);
  useEffect(() => { setCheques(null); return cargar(); }, [cargar]);

  const todos = cheques || [];
  const fecha = useMemo(() => enFecha(todos, hoy), [todos, hoy]);
  const semana = useMemo(() => proximaSemana(todos, hoy), [todos, hoy]);
  const porEstado = useMemo(() => resumenPorEstado(todos), [todos]);
  const semanas = useMemo(() => proximasSemanas(todos, hoy), [todos, hoy]);

  const q = sinAcentos(texto.trim());
  // Todos los filtros menos el de estado (así "Ver todos" y "Solo pendientes" dicen cuántos van a mostrar).
  const base = useMemo(() => todos.filter((c) => {
    if (categoria && c.direccion !== categoria) return false;
    if (tipo && c.tipo !== tipo) return false;
    if (segunBanco === "diferencia" && !diferenciaConBanco(c.direccion, c.estado, c.estadoBanco)) return false;
    if (segunBanco === "con" && !c.estadoBanco) return false;
    if (segunBanco === "sin" && c.estadoBanco) return false;
    if (soloEnFecha && !estaEnFecha(c, hoy)) return false;
    if (desde && c.pago < desde) return false;
    if (hasta && c.pago > hasta) return false;
    // También por la OP o el recibo (arreglo 20): "OP-000083" trae sus cheques.
    if (q && !sinAcentos(`${c.numero} ${c.banco} ${c.cuit} ${c.origen} ${c.destino} ${c.cubre_tercero || ""} ${c.monto} ${c.ops.map((o) => o.numero).join(" ")} ${c.recibo ? `recibo ${c.recibo.numero}` : ""}`).includes(q)) return false;
    return true;
  }), [todos, categoria, tipo, segunBanco, soloEnFecha, desde, hasta, q, hoy]);
  const pendientes = useMemo(() => base.filter((c) => chequePendiente(c)), [base]);
  // Arreglo 19: lo pendiente primero, de la fecha de pago más cercana a la más lejana; el resto, del más nuevo al más viejo.
  const visibles = useMemo(() => (estado === PENDIENTES ? pendientes : estado ? base.filter((c) => estadoCheque(c).clave === estado) : base).slice().sort(ordenCheques),
    [base, pendientes, estado]);
  const totalesPie = useMemo(() => resumenPorEstado(visibles), [visibles]);

  const limpiar = () => { setCategoria(""); setEstado(PENDIENTES); setTipo(""); setSegunBanco(""); setSoloEnFecha(false); setTexto(""); setDesde(""); setHasta(""); };
  const filtrar = (f: { categoria?: "" | "emitido" | "recibido"; estado?: string; enFecha?: boolean; desde?: string; hasta?: string }) => {
    limpiar();
    if (f.categoria !== undefined) setCategoria(f.categoria);
    if (f.estado) setEstado(f.estado);
    if (f.enFecha) setSoloEnFecha(true);
    if (f.desde) setDesde(f.desde);
    if (f.hasta) setHasta(f.hasta);
  };

  const cols: Column<Cheque>[] = [
    { key: "emision", label: "Emisión", sortable: true, sortValue: (c) => c.emision || "", render: (c) => (c.emision ? formatDate(c.emision) : "—") },
    { key: "pago", label: "Pago", sortable: true, sortValue: (c) => c.pago, render: (c) => {
      // Regla de los 30 días (auditoría UX 26/10/2026, arreglo 6): no debitado o sin depositar en la fecha no es atraso (ámbar);
      // pasados 30 días el cheque vence (rojo). Antes cualquier fecha pasada salía en rojo.
      const s = situacionPago(c, hoy);
      return <span className={`whitespace-nowrap ${s === "vencido" ? "font-semibold text-red-600" : s === "en_fecha" ? "font-semibold text-amber-700 dark:text-amber-300" : ""}`}>{c.pago ? formatDate(c.pago) : "—"}{s && <span className="block text-[10px]" title={s === "vencido" ? "Pasaron más de 30 días de la fecha de pago" : "Hasta 30 días después de la fecha de pago"}>{s === "vencido" ? "vencido (+30 días)" : "en fecha"}</span>}</span>;
    } },
    { key: "numero", label: "N°", sortable: true, sortValue: (c) => c.numero, render: (c) => <span className="font-mono text-xs">{c.numero}</span> },
    { key: "quien", label: "De / Para", sortable: true, sortValue: (c) => conQuien(c), render: (c) => (
      <span className="text-sm">{conQuien(c) || "—"}{c.cubre_tercero && <span className="ml-1 rounded bg-violet-50 px-1 text-[10px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">Martín F.</span>}</span>
    ) },
    { key: "monto", label: "Monto", sortable: true, sortValue: (c) => Number(c.monto), className: "text-right", render: (c) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(Number(c.monto), c.moneda === "USD" ? "USD" : "ARS")}</span> },
    { key: "banco", label: "Banco", sortable: true, sortValue: (c) => c.banco, render: (c) => <span className="text-xs">{c.banco || "—"}</span> },
    { key: "estado", label: "Estado", sortable: true, sortValue: (c) => estadoCheque(c).label, render: (c) => { const e = estadoCheque(c); return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${TONO[e.tono]}`}>{e.label}</span>; } },
    { key: "diaBanco", label: "Día en el banco", sortable: true, sortValue: (c) => c.diaBanco || "", render: (c) => (
      c.diaBanco ? <span className="whitespace-nowrap text-xs" title="Día en que se movió la plata en la cuenta (Excel Movimientos)">{formatDate(c.diaBanco)}</span> : <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
    ) },
    { key: "segunBanco", label: "Según el banco", sortable: true, sortValue: (c) => c.estadoBanco, render: (c) => {
      if (!c.estadoBanco) return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>;
      const dif = diferenciaConBanco(c.direccion, c.estado, c.estadoBanco);
      return <span title={dif || undefined} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${dif ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{dif ? "⚠️ " : ""}{nombreEstadoBancoTitulo(c.estadoBanco)}</span>;
    } },
  ];

  /** Arreglo 20: la OP y el recibo del cheque se abren en otra pestaña, como en el Resumen de cuenta. */
  const verLaOP = (id: string) => { if (sociedadActiva) void verOP(id, sociedadActiva); };
  const verElRecibo = async (id: string) => {
    if (!sociedadActiva) return;
    const r = await traerRecibo(sociedadId, id).catch(() => null);
    if (r) abrirRecibo(r, sociedadActiva, true);
    else alert("No se pudo abrir el recibo.");
  };

  const boton =(activo: boolean) => `rounded-lg border px-3 py-1 text-xs font-medium ${activo ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setPestana("todos")} className={boton(pestana === "todos")}>Todos los cheques</button>
          <button type="button" onClick={() => setPestana("martin")} className={boton(pestana === "martin")}>Martín F.</button>
        </div>
        {/* 26/10/2026 (Finanzas simple, una sola puerta): el botón viejo cambiaba estados del CRM por su cuenta; se oculta (no se borra).
            Los archivos del banco se suben solo en Bancos > Movimientos > "Subir archivos del banco". */}
        {MOSTRAR_SUBIR_VIEJO && pestana === "todos" && (
          <button type="button" onClick={() => setSubir(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 hover:border-orange-300 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <Upload className="h-3.5 w-3.5" /> Subir Excel del banco
          </button>
        )}
      </div>

      {pestana === "martin" ? <ChequesTercero /> : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>
      ) : !cheques ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <>
          {/* En fecha: lo que el banco puede debitar hoy y lo que ya se puede depositar */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <button type="button" onClick={() => filtrar({ categoria: "emitido", enFecha: true })} title="Ver estos cheques en la lista"
              className={`rounded-xl border p-3 text-left hover:border-orange-300 ${fecha.pagar.cantidad ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">En fecha para pagar</p>
              <p className="font-mono text-lg font-bold text-zinc-900 dark:text-white">{montos(fecha.pagar)}</p>
              <p className="text-xs text-zinc-500">{fecha.pagar.cantidad} cheque{fecha.pagar.cantidad === 1 ? "" : "s"} propio{fecha.pagar.cantidad === 1 ? "" : "s"} que el banco puede debitar hoy (hasta 30 días después de la fecha)</p>
            </button>
            <button type="button" onClick={() => filtrar({ categoria: "recibido", enFecha: true })} title="Ver estos cheques en la lista"
              className={`rounded-xl border p-3 text-left hover:border-orange-300 ${fecha.cobrar.cantidad ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">En fecha para cobrar</p>
              <p className="font-mono text-lg font-bold text-zinc-900 dark:text-white">{montos(fecha.cobrar)}</p>
              <p className="text-xs text-zinc-500">{fecha.cobrar.cantidad} cheque{fecha.cobrar.cantidad === 1 ? "" : "s"} en cartera que ya se puede{fecha.cobrar.cantidad === 1 ? "" : "n"} depositar</p>
              {/* Arreglo 19: los que el banco ya tiene (depositados, presentados o en custodia) no hay que depositarlos: van aparte. */}
              {fecha.depositados.cantidad > 0 && (
                <p className="text-xs text-zinc-500">+ {fecha.depositados.cantidad} ya depositado{fecha.depositados.cantidad === 1 ? "" : "s"} según el banco ({montos(fecha.depositados)}), esperando la acreditación</p>
              )}
            </button>
            {/* Próxima semana (26/10/2026, Augusto): sin comparar con el saldo del banco, solo indica. */}
            {(["pagar", "cobrar"] as const).map((lado) => (
              <button key={lado} type="button" disabled={!semana[lado].cantidad} title="Ver estos cheques en la lista"
                onClick={() => filtrar({ categoria: lado === "pagar" ? "emitido" : "recibido", estado: lado === "pagar" ? "emitido:sin_debitar" : "recibido:en_cartera", desde: semana.desde, hasta: semana.hasta })}
                className="rounded-xl border border-zinc-200 bg-white p-3 text-left hover:border-orange-300 disabled:cursor-default disabled:hover:border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900">
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${lado === "pagar" ? "text-orange-600" : "text-emerald-600"}`}>Próxima semana {lado === "pagar" ? "a pagar" : "a cobrar"}</p>
                <p className="font-mono text-lg font-bold text-zinc-900 dark:text-white">{montos(semana[lado])}</p>
                <p className="text-xs text-zinc-500">{semana[lado].cantidad} cheque{semana[lado].cantidad === 1 ? "" : "s"} {lado === "pagar" ? `propio${semana[lado].cantidad === 1 ? "" : "s"}` : "en cartera"} del {formatDate(semana.desde).slice(0, 5)} al {formatDate(semana.hasta).slice(0, 5)}</p>
              </button>
            ))}
          </div>

          {/* 26/10/2026 (Augusto): "¿Alcanza la plata?" se sacó (comparaba contra el saldo del banco, que no se muestra por ahora). Queda en cobertura-cheques-card.tsx. */}

          {/* Resumen por estado */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {porEstado.map((e) => (
              <button key={e.clave} type="button" onClick={() => filtrar({ categoria: e.direccion, estado: e.clave })} title="Ver estos cheques en la lista"
                className={`rounded-lg border px-3 py-2 text-left hover:border-orange-300 ${estado === e.clave ? "border-orange-400" : "border-zinc-200 dark:border-zinc-800"} bg-white dark:bg-zinc-900`}>
                <p className="flex items-center justify-between gap-1 text-[11px] text-zinc-500">
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${TONO[e.tono]}`}>{e.label}</span>
                  <span>{e.direccion === "emitido" ? "Emitidos" : "Recibidos"}</span>
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-zinc-900 dark:text-white">{montos(e.total)}</p>
                <p className="text-[11px] text-zinc-500">{e.total.cantidad} cheque{e.total.cantidad === 1 ? "" : "s"}</p>
              </button>
            ))}
          </div>

          {/* Próximas 4 semanas */}
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-zinc-400">
                  <th className="px-3 py-2">Próximas 4 semanas</th>
                  {semanas.map((s, i) => <th key={s.desde} className="px-3 py-2 text-right">{i === 0 ? "Esta semana" : `Semana ${i + 1}`}<span className="block font-normal normal-case">{formatDate(s.desde).slice(0, 5)} al {formatDate(s.hasta).slice(0, 5)}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {(["pagar", "cobrar"] as const).map((lado) => (
                  <tr key={lado} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className={`px-3 py-2 text-xs font-semibold ${lado === "pagar" ? "text-orange-600" : "text-emerald-600"}`}>{lado === "pagar" ? "A pagar (propios)" : "A cobrar (cartera)"}</td>
                    {semanas.map((s) => (
                      <td key={s.desde} className="px-3 py-2 text-right">
                        <button type="button" disabled={!s[lado].cantidad} onClick={() => filtrar({ categoria: lado === "pagar" ? "emitido" : "recibido", estado: lado === "pagar" ? "emitido:sin_debitar" : "recibido:en_cartera", desde: s.desde, hasta: s.hasta })}
                          className="font-mono hover:text-orange-600 disabled:cursor-default disabled:text-zinc-300">
                          {s[lado].cantidad ? montos(s[lado]) : "—"}
                          {s[lado].cantidad > 0 && <span className="block text-[10px] text-zinc-400">{s[lado].cantidad} ch.</span>}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Lista */}
          <div className="flex flex-wrap items-center gap-1.5">
            {([["", "Todos"], ["emitido", "Emitidos"], ["recibido", "Recibidos"]] as const).map(([k, l]) => (
              // Un estado del otro lado no tiene sentido: vuelve a Pendientes (antes volvía a todos los estados).
              <button key={k} type="button" onClick={() => { setCategoria(k); if (k && estado.includes(":") && !estado.startsWith(`${k}:`)) setEstado(PENDIENTES); }} className={boton(categoria === k)}>{l}</button>
            ))}
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar N°, banco, CUIT, cliente, proveedor, importe, OP o recibo" className={`${control} w-full pl-8`} />
            </div>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} className={control}>
              <option value={PENDIENTES}>Pendientes</option>
              <option value="">Todos los estados</option>
              {porEstado.filter((e) => !categoria || e.direccion === categoria).map((e) => <option key={e.clave} value={e.clave}>{e.label} ({e.direccion === "emitido" ? "emitidos" : "recibidos"})</option>)}
            </select>
            {estado === PENDIENTES && <button type="button" onClick={() => setEstado("")} className={boton(false)} title="Ver también los debitados, cobrados, endosados, rechazados y anulados">Ver todos ({base.length})</button>}
            {estado === "" && <button type="button" onClick={() => setEstado(PENDIENTES)} className={boton(false)} title="Solo propios sin debitar y recibidos en cartera">Solo pendientes ({pendientes.length})</button>}
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={control}>
              <option value="">eCheq y físicos</option><option value="eCheq">eCheq</option><option value="Físico">Físicos</option>
            </select>
            <select value={segunBanco} onChange={(e) => setSegunBanco(e.target.value as typeof segunBanco)} className={control}>
              <option value="">Estado del banco: todos</option><option value="diferencia">Con diferencia con el banco</option><option value="con">Con estado del banco</option><option value="sin">Sin estado del banco</option>
            </select>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Fecha de pago desde" className={control} />
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Fecha de pago hasta" className={control} />
            {soloEnFecha && <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">Solo en fecha</span>}
            {(categoria || estado !== PENDIENTES || tipo || segunBanco || soloEnFecha || texto || desde || hasta) && <button type="button" onClick={limpiar} className="text-xs text-orange-600 hover:underline">Limpiar</button>}
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {/* Arreglo 19: si lo que se busca está en un cheque que ya no está pendiente, se avisa (si no, parecería que no existe). */}
            {estado === PENDIENTES && q && base.length > pendientes.length && (
              <p className="border-b border-zinc-200 px-3 py-1.5 text-xs text-amber-700 dark:border-zinc-700 dark:text-amber-300">
                Hay {base.length - pendientes.length} más con «{texto.trim()}» que no {base.length - pendientes.length === 1 ? "está pendiente" : "están pendientes"}.{" "}
                <button type="button" onClick={() => setEstado("")} className="font-medium underline hover:text-orange-600">Ver todos</button>
              </p>
            )}
            <DataTable columns={cols} data={visibles} onRowClick={setAbierto} emptyMessage="No hay cheques con ese filtro" />
            {/* Arreglo 19: un total por estado, nunca todo junto (antes sumaba debitados, anulados y rechazados con lo pendiente). */}
            <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
              <span>{visibles.length} cheque{visibles.length === 1 ? "" : "s"}</span>
              {totalesPie.map((e) => (
                <span key={e.clave} className="whitespace-nowrap">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${TONO[e.tono]}`}>{nombreEstado(e)}</span> {e.total.cantidad} · <b className="font-mono">{montos(e.total)}</b>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setAbierto(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-white">Cheque <span className="font-mono">{abierto.numero}</span></h2>
                <p className="text-sm text-zinc-500">{abierto.direccion === "emitido" ? "Propio (emitido)" : "Recibido"} · {abierto.tipo}</p>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setAbierto(null)} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <dl className="space-y-1.5 text-sm">
              {([
                ["Estado", <span key="e" className={`rounded px-1.5 py-0.5 text-xs font-semibold ${TONO[estadoCheque(abierto).tono]}`}>{estadoCheque(abierto).label}</span>],
                ...(abierto.estadoBanco ? [["Según el banco", <span key="sb">{nombreEstadoBancoTitulo(abierto.estadoBanco)}{diferenciaConBanco(abierto.direccion, abierto.estado, abierto.estadoBanco) && <span className="mt-0.5 block text-xs font-medium text-amber-700 dark:text-amber-300">⚠️ {diferenciaConBanco(abierto.direccion, abierto.estado, abierto.estadoBanco)} No se cambió nada solo.</span>}</span>]] : []),
                ["Monto", <b key="m" className="font-mono">{formatCurrency(Number(abierto.monto), abierto.moneda === "USD" ? "USD" : "ARS")}</b>],
                ["De dónde vino", abierto.direccion === "emitido" ? "Lo emitimos nosotros" : abierto.origen || "—"],
                // Arreglo 20 (27/10/2026): el recibo en que entró y la OP que pagó (o donde se endosó), con link a su PDF.
                ...(abierto.direccion === "recibido" ? [["Recibo", abierto.recibo ? (
                  <button key="rec" type="button" onClick={() => verElRecibo(abierto.recibo!.id)} title="Ver el recibo (se abre en otra pestaña)" className="font-medium text-orange-600 hover:underline">
                    Entró en el recibo N° {abierto.recibo.numero}{abierto.cobroAnulado ? " · cobro anulado" : ""}
                  </button>
                ) : <span key="rec" className="text-zinc-400">No tiene recibo en el CRM</span>]] : []),
                ["A dónde fue", abierto.destino || (abierto.direccion === "recibido" && abierto.estado === "en_cartera" ? "Sigue en cartera" : "—")],
                ...(abierto.direccion === "emitido" || abierto.ops.length ? [["Orden de pago", abierto.ops.length ? (
                  <span key="op" className="flex flex-col items-end gap-0.5">
                    {abierto.ops.map((o, i) => (
                      <button key={o.id} type="button" onClick={() => verLaOP(o.id)} title="Ver la OP (se abre en otra pestaña)"
                        className={o.anulada ? "text-xs text-zinc-500 hover:text-orange-600 hover:underline" : "font-medium text-orange-600 hover:underline"}>
                        {o.anulada ? `${i === 0 ? "Estuvo en" : "Antes en"} la ${o.numero} (anulada)` : `${abierto.direccion === "emitido" ? "Pagó" : "Se endosó en"} la ${o.numero}`}
                      </button>
                    ))}
                  </span>
                ) : <span key="op" className="text-zinc-400">No figura en ninguna OP del CRM</span>]] : []),
                ["Banco", abierto.banco || "—"],
                ["CUIT del emisor", abierto.cuit || "—"],
                ["Emisión", abierto.emision ? formatDate(abierto.emision) : "—"],
                ["Fecha de pago", abierto.pago ? formatDate(abierto.pago) : "—"],
                ...(abierto.fechaDeposito ? [["Depositado", formatDate(abierto.fechaDeposito)]] : []),
                ...(abierto.fechaEndoso ? [["Endosado", formatDate(abierto.fechaEndoso)]] : []),
                ...(abierto.cubre_tercero ? [["Lo cubre", abierto.cubre_tercero]] : []),
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-zinc-100 pb-1.5 dark:border-zinc-800"><dt className="text-zinc-500">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
            {abierto.observaciones && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">{abierto.observaciones}</p>}
          </div>
        </div>
      )}

      {subir && <ChequesBanco sociedadId={sociedadId} cheques={todos.map((c) => ({ id: c.id, numero: c.numero, direccion: c.direccion, estado: c.estado, monto: Number(c.monto), cuit_emisor: c.cuit || null }))} onClose={() => setSubir(false)} onGuardado={() => { cargar(); }} />}
    </div>
  );
}
