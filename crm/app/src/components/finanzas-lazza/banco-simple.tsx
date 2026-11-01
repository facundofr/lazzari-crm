"use client";

/**
 * Bancos → Movimientos, banco simple (Augusto 29–30/10/2026: "que el banco se clasifique solo, sin duplicar y sin confirmar nada").
 * - Subir archivos del banco: la misma subida de siempre (vista previa y controles), sin la bandeja "Para confirmar".
 * - Al guardar, y cada vez que se abre esta pestaña, el motor (lib/banco-motor: reglas seguras, sin IA) procesa las líneas
 *   pendientes con procesar_banco: lo del banco y lo que cruza exacto con lo que ya cargó una persona queda listo solo.
 *   El banco nunca crea ni asigna plata. Lo que cargues después (un cobro, una OP, un gasto) se cruza solo la próxima vez.
 * - Arriba, un control de solo lectura: lo que entró o salió del banco sin su cobro o pago cargado, y lo cargado en el CRM que
 *   no pasó por el banco (pago doble, cuenta equivocada o falta subir un archivo).
 * - La lista: cada línea con su estado (✓ cruzada y con qué, 🏦 del banco, ○ sin cruzar y por qué). «Desatar» deshace un cruce
 *   del motor y no lo vuelve a hacer; «Es otra cosa» explica una línea que no va a cruzar (personal, sistema anterior u otra).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, Landmark, Loader2, Search, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { montoCuentaDeOp } from "@/lib/saldo-cuentas";
import { clasificarMovimiento } from "@/lib/tipos-movimiento";
import { sinCodigoBanco } from "@/lib/bbva-codigos";
import { motorBanco, type DecisionBanco, type MovMotor } from "@/lib/banco-motor";
import { CLASIFICACION_LABEL, SUBTIPO_LABEL, type ChequeCruce, type ClasificacionLinea, type CuentaCruce } from "@/lib/extracto-bbva";
import FinanzasParaConfirmar from "@/components/finanzas-para-confirmar";

const db = supabase as any;
const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));
const DEL_BANCO = new Set(["impuesto", "gasto_bancario", "intereses", "fci", "entre_cuentas", "tarjeta"]);
const sumarDias = (f: string, n: number) => { const d = new Date(`${f.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

interface Linea {
  id: string; cuenta_id: string; fecha: string; descripcion: string | null; monto: number; tipo: "credito" | "debito"; estado: string;
  clasificacion: string | null; subtipo: string | null; match_movimiento_id: string | null; cheque_id: string | null; nota: string | null;
}
interface Mov {
  id: string; fecha: string; monto: number; moneda: string | null; tipo: string; cliente_id: string | null; proveedor_id: string | null; anulado: boolean | null;
  descripcion: string | null; nota_credito_compra_id: string | null; ajuste_sentido: string | null; orden_pago_id: string | null; gasto_manual_id: string | null;
  extracto_movimiento_id: string | null; cuenta_id: string | null;
}
type Estado = "cruzada" | "del_banco" | "sin_cruzar" | "explicada";
interface Fila { linea: Linea; importe: number; estado: Estado; detalle: string; conQue: string; porMotor: boolean }
interface NoPaso { id: string; fecha: string; importe: number; texto: string }
type Filtro = "todas" | Estado | "entradas" | "salidas" | "no_paso";
type Tercero = { id: string; razon_social: string; cuit: string | null };
interface Datos {
  cuentas: CuentaCruce[]; ls: Linea[]; movs: Mov[]; chs: (ChequeCruce & { destino_nombre?: string | null })[]; cli: Tercero[]; prov: Tercero[];
  ops: { id: string; numero: string | null; medios_pago: unknown }[]; gas: { id: string; descripcion: string | null }[];
  reg: { linea_id: string | null; accion: string; propuesta: any; created_at: string }[];
}

/** Lo que el motor necesita: pendientes, movimientos sin cruzar, cheques usados y lo que una persona desató. */
function entradaMotor(d: Datos) {
  const cruzados = new Set<string>();
  for (const l of d.ls) if (l.match_movimiento_id) cruzados.add(l.match_movimiento_id);
  for (const m of d.movs) if (m.extracto_movimiento_id) cruzados.add(m.id);
  const cuit = new Map<string, string | null>([...d.cli.map((c) => [c.id, c.cuit] as const), ...d.prov.map((p) => [p.id, p.cuit] as const)]);
  const parteOp = new Map(d.ops.map((o) => [o.id, montoCuentaDeOp(o.medios_pago)]));
  const gasto = new Map(d.gas.map((g) => [g.id, g.descripcion || ""]));
  const prohibidos = new Set<string>();
  for (const r of d.reg) {
    if (r.accion !== "desatada" || !r.linea_id) continue;
    const movs: string[] = Array.isArray(r.propuesta?.movimientos) ? r.propuesta.movimientos : [];
    if (movs.length) for (const m of movs) prohibidos.add(`${r.linea_id}|${m}`); else prohibidos.add(`${r.linea_id}|*`);
  }
  return {
    lineas: d.ls.filter((l) => l.estado === "pendiente").map((l) => ({ id: l.id, fecha: l.fecha, concepto: l.descripcion || "", importe: (l.tipo === "credito" ? 1 : -1) * Number(l.monto), cuenta_id: l.cuenta_id })),
    movimientos: d.movs.filter((m) => !m.anulado && !cruzados.has(m.id)).map((m): MovMotor => ({
      ...m, cuit: (m.proveedor_id && cuit.get(m.proveedor_id)) || (m.cliente_id && cuit.get(m.cliente_id)) || null,
      montoCuenta: m.orden_pago_id && m.tipo === "pago" ? parteOp.get(m.orden_pago_id) ?? null : null,
      texto: `${m.descripcion || ""} ${(m.gasto_manual_id && gasto.get(m.gasto_manual_id)) || ""}`,
    })),
    cheques: d.chs,
    cuentas: d.cuentas,
    chequesUsados: new Set(d.ls.filter((l) => l.cheque_id && l.clasificacion).map((l) => `${l.clasificacion}:${l.cheque_id}`)),
    prohibidos,
  };
}

export function BancoSimple({ sociedadId }: { sociedadId: string }) {
  const { profile } = useUser() as any;
  const { toast } = useToast();
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [noPaso, setNoPaso] = useState<NoPaso[]>([]);
  const [cuentas, setCuentas] = useState<Map<string, string>>(new Map());
  const [ultimaCarga, setUltimaCarga] = useState<{ carga: string; cuando: string; n: number } | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [todo, setTodo] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [otraCosa, setOtraCosa] = useState<{ id: string; que: "personal" | "anterior" | "otro"; nota: string } | null>(null);
  const motivos = useRef(new Map<string, string>());

  /** Todo lo que hace falta para el motor y para la lista. */
  const leer = useCallback(async (): Promise<Datos | null> => {
    const { data: cs, error: e1 } = await db.from("cuentas_financieras").select("id, nombre, tipo, numero, moneda, activa").eq("sociedad_id", sociedadId);
    if (e1) throw e1;
    const ids = ((cs || []) as CuentaCruce[]).map((c) => c.id);
    if (!ids.length) return null;
    const [ls, movs, chs, cli, prov, ops, gas, reg] = await Promise.all([
      traerTodo<Linea>(() => db.from("extracto_movimientos")
        .select("id, cuenta_id, fecha, descripcion, monto, tipo, estado, clasificacion, subtipo, match_movimiento_id, cheque_id, nota")
        .in("cuenta_id", ids).order("fecha").order("id")),
      traerTodo<Mov>(() => db.from("movimientos")
        .select("id, fecha, monto, moneda, tipo, cliente_id, proveedor_id, anulado, descripcion, nota_credito_compra_id, ajuste_sentido, orden_pago_id, gasto_manual_id, extracto_movimiento_id, cuenta_id")
        .eq("sociedad_id", sociedadId).gte("fecha", "2026-08-21").order("fecha").order("id")),
      traerTodo<ChequeCruce & { destino_nombre?: string | null }>(() => db.from("echeqs")
        .select("id, numero, monto, direccion, estado, fecha_pago, tipo_cheque, movimiento_id, origen_nombre, destino_nombre").eq("sociedad_id", sociedadId).order("id")),
      traerTodo<{ id: string; razon_social: string; cuit: string | null }>(() => db.from("clientes").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
      traerTodo<{ id: string; razon_social: string; cuit: string | null }>(() => db.from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
      traerTodo<{ id: string; numero: string | null; medios_pago: unknown }>(() => db.from("ordenes_pago").select("id, numero, medios_pago").eq("sociedad_id", sociedadId).order("id")),
      traerTodo<{ id: string; descripcion: string | null }>(() => db.from("gastos_manuales").select("id, descripcion").eq("sociedad_id", sociedadId).gte("fecha", "2026-07-01").order("id")),
      traerTodo<{ linea_id: string | null; accion: string; propuesta: any; created_at: string }>(() => db.from("finanzas_registro")
        .select("linea_id, accion, propuesta, created_at").eq("sociedad_id", sociedadId).in("accion", ["cruce_solo", "desatada"]).order("created_at").order("id")),
    ]);
    return { cuentas: (cs || []) as CuentaCruce[], ls, movs, chs, cli, prov, ops, gas, reg };
  }, [sociedadId]);

  /** Arma la lista, el control y la última carga del motor. */
  const mostrar = useCallback((d: Datos) => {
    const nombreCuenta = new Map(d.cuentas.map((c) => [c.id, c.nombre]));
    setCuentas(nombreCuenta);
    const nombre = new Map<string, string>([...d.cli.map((c) => [c.id, c.razon_social] as const), ...d.prov.map((p) => [p.id, p.razon_social] as const)]);
    const opNum = new Map(d.ops.map((o) => [o.id, o.numero || "OP"]));
    const gasto = new Map(d.gas.map((g) => [g.id, g.descripcion || ""]));
    const movPorId = new Map(d.movs.map((m) => [m.id, m]));
    const movsDeLinea = new Map<string, Mov[]>();
    for (const m of d.movs) if (m.extracto_movimiento_id) movsDeLinea.set(m.extracto_movimiento_id, [...(movsDeLinea.get(m.extracto_movimiento_id) || []), m]);
    const cheque = new Map(d.chs.map((c) => [c.id, c]));
    const textoMov = (m: Mov) => [m.orden_pago_id && opNum.get(m.orden_pago_id), (m.cliente_id || m.proveedor_id) && nombre.get((m.cliente_id || m.proveedor_id)!), m.gasto_manual_id && gasto.get(m.gasto_manual_id), !m.orden_pago_id && !m.cliente_id && !m.proveedor_id && !m.gasto_manual_id && m.descripcion]
      .filter(Boolean).join(" · ") || m.tipo;
    // Última decisión de cada línea en el registro: cruce del motor (se puede desatar) o desatada.
    const ultimo = new Map<string, string>();
    const cargas = new Map<string, { cuando: string; lineas: Set<string> }>();
    for (const r of d.reg) {
      if (!r.linea_id) continue;
      ultimo.set(r.linea_id, r.accion);
      const c = r.propuesta?.carga;
      if (r.accion === "cruce_solo" && c) {
        const x = cargas.get(c) || { cuando: r.created_at, lineas: new Set<string>() };
        x.lineas.add(r.linea_id); x.cuando = r.created_at; cargas.set(c, x);
      }
    }
    const lista: Fila[] = d.ls.map((l) => {
      const importe = (l.tipo === "credito" ? 1 : -1) * Number(l.monto);
      const movs = [...new Map([...(l.match_movimiento_id && movPorId.get(l.match_movimiento_id) ? [movPorId.get(l.match_movimiento_id)!] : []), ...(movsDeLinea.get(l.id) || [])].map((m) => [m.id, m])).values()];
      const ch = l.cheque_id ? cheque.get(l.cheque_id) : null;
      let estado: Estado, conQue: string;
      if (l.estado === "pendiente") { estado = "sin_cruzar"; conQue = motivos.current.get(l.id) || (l.tipo === "credito" ? "Falta el cobro" : "Falta el pago"); }
      else if (movs.length || ch) {
        estado = "cruzada";
        conQue = movs.length ? movs.map(textoMov).join(" + ") : `Cheque ${ch!.numero}${ch!.origen_nombre ? ` de ${ch!.origen_nombre}` : (ch as any).destino_nombre ? ` a ${(ch as any).destino_nombre}` : ""}`;
      } else if (l.estado === "matcheado" && DEL_BANCO.has(String(l.clasificacion))) {
        estado = "del_banco";
        conQue = [CLASIFICACION_LABEL[l.clasificacion as ClasificacionLinea] || l.clasificacion, l.subtipo && (SUBTIPO_LABEL[l.subtipo] || l.subtipo)].filter(Boolean).join(" · ");
      } else { estado = "explicada"; conQue = l.nota || CLASIFICACION_LABEL[l.clasificacion as ClasificacionLinea] || "Explicada"; }
      return { linea: l, importe, estado, detalle: sinCodigoBanco(l.descripcion), conQue, porMotor: l.estado !== "pendiente" && ultimo.get(l.id) === "cruce_solo" };
    }).reverse();
    setFilas(lista);
    // Cargado en el CRM que no pasó por el banco: cobros y pagos de las cuentas del banco, del período que ya cubre el extracto.
    const e = entradaMotor(d);
    const bancos = new Set(d.cuentas.filter((c) => ["cuenta_corriente", "caja_ahorro"].includes(c.tipo) && c.moneda === "ARS").map((c) => c.id));
    const fechas = d.ls.map((l) => l.fecha.slice(0, 10)).sort();
    const hasta = fechas.length ? sumarDias(fechas[fechas.length - 1], -2) : "";
    setNoPaso(e.movimientos.filter((m) => fechas.length && m.fecha >= fechas[0] && m.fecha <= hasta && (!m.cuenta_id || bancos.has(m.cuenta_id))
      && ["cobro", "pago", "transferencia", "deposito"].includes(String(m.tipo)) && String(m.moneda || "ARS") === "ARS"
      && ["ingreso", "egreso"].includes(clasificarMovimiento(m)) && !(m.montoCuenta !== null && m.montoCuenta !== undefined && Number(m.montoCuenta) < 0.005))
      .map((m) => ({ id: m.id, fecha: m.fecha, importe: (clasificarMovimiento(m) === "ingreso" ? 1 : -1) * Number(m.monto), texto: textoMov(m as unknown as Mov) }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha)));
    const vivas = [...cargas.entries()].map(([carga, x]) => ({ carga, cuando: x.cuando, n: [...x.lineas].filter((id) => ultimo.get(id) === "cruce_solo").length }))
      .filter((x) => x.n > 0).sort((a, b) => b.cuando.localeCompare(a.cuando));
    setUltimaCarga(vivas[0] || null);
  }, []);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const d = await leer();
      if (d) mostrar(d);
      return d;
    } catch (e) {
      setError(errorTexto(e));
      return null;
    } finally {
      setCargando(false);
    }
  }, [leer, mostrar]);

  /** Corre el motor sobre las pendientes y aplica lo seguro. Lo que queda sin cruzar se muestra con su motivo. */
  const procesar = useCallback(async () => {
    setProcesando(true);
    try {
      const d = await cargar();
      if (!d) return;
      const ds: DecisionBanco[] = motorBanco(entradaMotor(d));
      motivos.current = new Map(ds.filter((x) => x.estado === "sin_cruzar").map((x) => [x.linea_id, x.motivo]));
      // Lo que queda listo solo, y los avisos de cheques rechazados que quedan sin cruzar (van a la campana una sola vez).
      const aplicar = ds.filter((x) => x.estado !== "sin_cruzar" || x.aviso);
      if (!aplicar.length) { mostrar(d); return; }
      const { data, error: e } = await db.rpc("procesar_banco", { p_sociedad_id: sociedadId, p_decisiones: aplicar });
      if (e) {
        setError(/procesar_banco|schema cache|does not exist/i.test(String(e.message || "")) ? "Falta una actualización de la base de datos (banco simple): las líneas no se procesaron." : errorTexto(e));
        mostrar(d);
        return;
      }
      for (const a of (data?.avisos || []) as string[]) toast.warning(a);
      if (Number(data?.aplicadas) > 0) toast.success(`${data.aplicadas} línea${data.aplicadas > 1 ? "s" : ""} del banco quedaron listas solas.`);
      await cargar();
    } finally {
      setProcesando(false);
    }
  }, [cargar, mostrar, sociedadId, toast]);

  // Al abrir la pestaña (y al cambiar de sociedad): lo que se cargó desde la última vez se cruza solo.
  useEffect(() => { void procesar(); }, [procesar]);

  async function desatar(lineaId: string | null, carga: string | null) {
    setOcupado(lineaId || "carga");
    try {
      const { data, error: e } = await db.rpc("deshacer_banco", { p_sociedad_id: sociedadId, p_carga: carga, p_linea_id: lineaId });
      if (e) throw e;
      for (const a of (data?.avisos || []) as string[]) toast.warning(a);
      toast.success(Number(data?.deshechas) ? `Listo: ${data.deshechas} línea${data.deshechas > 1 ? "s" : ""} sin cruzar. El banco no vuelve a hacer ${data.deshechas > 1 ? "esos cruces" : "ese cruce"} solo.` : "No había nada para deshacer (alguien ya la cambió).");
      await cargar();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  }

  async function guardarOtraCosa() {
    if (!otraCosa) return;
    const clasificacion = otraCosa.que === "personal" ? "personal" : "otro";
    const nota = [otraCosa.que === "personal" ? "Personal de Augusto" : otraCosa.que === "anterior" ? "Sistema anterior" : "", otraCosa.nota.trim()].filter(Boolean).join(" — ");
    if (!nota) { toast.warning("Escribí una nota que explique qué es."); return; }
    setOcupado(otraCosa.id);
    try {
      const { data, error: e } = await db.rpc("aplicar_cruces_extracto", { p_sociedad_id: sociedadId, p_cruces: [{ linea_id: otraCosa.id, clasificacion, nota, solo_pendiente: true }] });
      if (e) throw e;
      if (!Number(data?.aplicadas)) toast.info("Esa línea ya la resolvió otra persona.");
      await db.from("finanzas_registro").insert({ sociedad_id: sociedadId, usuario_id: profile?.id, linea_id: otraCosa.id, accion: "corregida", tipo: clasificacion, origen: "persona", resumen: nota });
      setOtraCosa(null);
      await cargar();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  }

  const desde = useMemo(() => sumarDias(todayAR(), -60), []);
  const control = useMemo(() => {
    const sin = filas.filter((f) => f.estado === "sin_cruzar");
    const suma = (xs: { importe: number }[]) => xs.reduce((s, x) => s + x.importe, 0);
    const entradas = sin.filter((f) => f.importe > 0), salidas = sin.filter((f) => f.importe < 0);
    return { entradas: { n: entradas.length, $: suma(entradas) }, salidas: { n: salidas.length, $: Math.abs(suma(salidas)) }, noPaso: { n: noPaso.length, $: suma(noPaso.map((x) => ({ importe: Math.abs(x.importe) }))) } };
  }, [filas, noPaso]);
  const visibles = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return filas.filter((f) => (todo || f.linea.fecha.slice(0, 10) >= desde)
      && (filtro === "todas" || f.estado === filtro || (filtro === "entradas" && f.estado === "sin_cruzar" && f.importe > 0) || (filtro === "salidas" && f.estado === "sin_cruzar" && f.importe < 0))
      && (!t || `${f.detalle} ${f.conQue} ${f.importe}`.toLowerCase().includes(t)));
  }, [filas, filtro, todo, buscar, desde]);
  const cuentasPor = (estado: Estado) => filas.filter((f) => f.estado === estado && (todo || f.linea.fecha.slice(0, 10) >= desde)).length;

  const tarjeta = (activo: boolean) => `rounded-xl border p-2.5 text-left transition ${activo ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900"}`;
  const chip = (activo: boolean) => `rounded-md px-2.5 py-1 text-xs font-medium ${activo ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`;

  return (
    <div className="space-y-3">
      <FinanzasParaConfirmar simple soloSubir onGuardado={() => void procesar()} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        {procesando ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Procesando las líneas del banco…</span>
          : <span>Las líneas del banco se procesan solas al subir los archivos y al abrir esta pestaña. Nada para confirmar.</span>}
        {ultimaCarga && !procesando && (
          <button disabled={ocupado !== null} onClick={() => { if (window.confirm(`¿Deshacer lo que hizo el banco solo el ${new Date(ultimaCarga.cuando).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} (${ultimaCarga.n} línea${ultimaCarga.n > 1 ? "s" : ""})? No lo vuelve a hacer solo.`)) void desatar(null, ultimaCarga.carga); }}
            className="flex items-center gap-1 text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-300">
            {ocupado === "carga" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Deshacer la última carga ({ultimaCarga.n})
          </button>
        )}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</p>}

      {/* Control de solo lectura (no son tareas): tocar un número muestra la lista. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => setFiltro(filtro === "entradas" ? "todas" : "entradas")} className={tarjeta(filtro === "entradas")}>
          <p className="text-xs text-zinc-500">Entró al banco sin cobro cargado</p>
          <p className="font-mono text-base font-semibold text-zinc-900 dark:text-white">{control.entradas.n} · {formatCurrency(control.entradas.$)}</p>
        </button>
        <button type="button" onClick={() => setFiltro(filtro === "salidas" ? "todas" : "salidas")} className={tarjeta(filtro === "salidas")}>
          <p className="text-xs text-zinc-500">Salió del banco sin pago cargado</p>
          <p className="font-mono text-base font-semibold text-zinc-900 dark:text-white">{control.salidas.n} · {formatCurrency(control.salidas.$)}</p>
        </button>
        <button type="button" onClick={() => setFiltro(filtro === "no_paso" ? "todas" : "no_paso")} className={tarjeta(filtro === "no_paso")}>
          <p className="text-xs text-zinc-500">Cargado en el CRM que no pasó por el banco</p>
          <p className="font-mono text-base font-semibold text-zinc-900 dark:text-white">{control.noPaso.n} · {formatCurrency(control.noPaso.$)}</p>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          <button type="button" onClick={() => setFiltro("todas")} className={chip(filtro === "todas")}>Todas</button>
          <button type="button" onClick={() => setFiltro("sin_cruzar")} className={chip(filtro === "sin_cruzar")}>Sin cruzar ({cuentasPor("sin_cruzar")})</button>
          <button type="button" onClick={() => setFiltro("cruzada")} className={chip(filtro === "cruzada")}>Cruzadas ({cuentasPor("cruzada")})</button>
          <button type="button" onClick={() => setFiltro("del_banco")} className={chip(filtro === "del_banco")}>Del banco ({cuentasPor("del_banco")})</button>
          <button type="button" onClick={() => setFiltro("explicada")} className={chip(filtro === "explicada")}>Explicadas ({cuentasPor("explicada")})</button>
        </div>
        <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> Ver todo (si no, los últimos 60 días)</label>
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar (texto o importe)" className="h-8 w-56 rounded-lg border border-zinc-200 bg-white pl-7 pr-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
      </div>

      {cargando ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : filtro === "no_paso" ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <p className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">Cobros y pagos cargados en el CRM del período que ya cubre el banco, que no aparecen en el extracto: puede ser un pago doble, la cuenta equivocada o que falte subir un archivo.</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {noPaso.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{formatDate(m.fecha)}</td>
                  <td className="px-3 py-1.5">{m.texto}</td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono ${m.importe < 0 ? "text-zinc-900 dark:text-zinc-100" : "text-emerald-700 dark:text-emerald-400"}`}>{formatCurrency(m.importe)}</td>
                </tr>
              ))}
              {!noPaso.length && <tr><td className="px-3 py-3 text-zinc-500">Todo lo cargado pasó por el banco.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/50">
              <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Cuenta</th><th className="px-3 py-2">Detalle del banco</th><th className="px-3 py-2 text-right">Importe</th><th className="px-3 py-2">Qué es</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visibles.slice(0, 400).map((f) => (
                <tr key={f.linea.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{formatDate(f.linea.fecha)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-zinc-500">{(cuentas.get(f.linea.cuenta_id) || "").replace(/^BBVA /, "")}</td>
                  <td className="px-3 py-1.5">{f.detalle}</td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono ${f.importe < 0 ? "text-zinc-900 dark:text-zinc-100" : "text-emerald-700 dark:text-emerald-400"}`}>{formatCurrency(f.importe)}</td>
                  <td className="px-3 py-1.5">
                    {otraCosa?.id === f.linea.id ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <select value={otraCosa.que} onChange={(e) => setOtraCosa({ ...otraCosa, que: e.target.value as "personal" | "anterior" | "otro" })} className="h-7 rounded-md border border-zinc-200 bg-white px-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
                          <option value="personal">Personal (retiro)</option>
                          <option value="anterior">Sistema anterior</option>
                          <option value="otro">Otra cosa</option>
                        </select>
                        <input autoFocus value={otraCosa.nota} onChange={(e) => setOtraCosa({ ...otraCosa, nota: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void guardarOtraCosa(); }} placeholder="Qué es (ej. cobro de Racing Colón)" className="h-7 w-56 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                        <button disabled={ocupado !== null} onClick={() => void guardarOtraCosa()} className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{ocupado === f.linea.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}</button>
                        <button onClick={() => setOtraCosa(null)} className="text-xs text-zinc-500 hover:underline">Cancelar</button>
                      </span>
                    ) : (
                      <span className={`flex items-start gap-1.5 ${f.estado === "sin_cruzar" ? "text-amber-700 dark:text-amber-300" : "text-zinc-700 dark:text-zinc-300"}`}>
                        {f.estado === "cruzada" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : f.estado === "del_banco" ? <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" /> : f.estado === "explicada" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        <span>{f.conQue}</span>
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                    {f.porMotor && (
                      <button disabled={ocupado !== null} onClick={() => void desatar(f.linea.id, null)} title="Deshace lo que hizo el banco solo con esta línea; no lo vuelve a hacer" className="text-zinc-500 hover:underline disabled:opacity-50">
                        {ocupado === f.linea.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Desatar"}
                      </button>
                    )}
                    {f.estado === "sin_cruzar" && otraCosa?.id !== f.linea.id && (
                      <button disabled={ocupado !== null} onClick={() => setOtraCosa({ id: f.linea.id, que: "otro", nota: "" })} className="text-zinc-500 hover:underline disabled:opacity-50">Es otra cosa…</button>
                    )}
                  </td>
                </tr>
              ))}
              {!visibles.length && <tr><td colSpan={6} className="px-3 py-3 text-zinc-500">No hay líneas con este filtro.</td></tr>}
            </tbody>
          </table>
          {visibles.length > 400 && <p className="px-3 py-2 text-xs text-zinc-500">Se muestran las 400 más nuevas de {visibles.length}: usá el buscador.</p>}
        </div>
      )}
    </div>
  );
}
