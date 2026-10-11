"use client";

// Finanzas > Extractos: subir el Excel del BBVA ("Detalle_mov_cuenta"), cruzarlo solo contra el CRM
// y preguntar lo que no cruza. También completa los cheques emitidos desde la planilla o los Excel de eCheq.
// La lógica está en lib/extracto-bbva.ts (prueba: scripts/test-extracto-bbva.mjs).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  leerExtractoBbva, leerListadoCheques, chequesParaCompletar, unirListados, cruzarExtracto, totalesBancoPorMes, numeroCheque,
  CLASIFICACION_LABEL, SUBTIPO_LABEL,
  type ExtractoLeido, type ChequeListado, type ClasificacionLinea, type MovCruce, type ChequeCruce, type ReglaCruce, type Propuesta,
  digitosCuenta,
} from "@/lib/extracto-bbva";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, RotateCcw, Upload, Wand2 } from "lucide-react";

interface CuentaRow {
  id: string;
  nombre: string;
  tipo: string;
  numero: string | null;
  moneda: string;
  fecha_corte: string;
  activa: boolean;
  saldo_banco: number | null;
  saldo_banco_fecha: string | null;
}

interface LineaRow {
  id: string;
  extracto_id: string;
  cuenta_id: string;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: "credito" | "debito";
  estado: "matcheado" | "pendiente" | "ignorado";
  saldo: number | null;
  clave: string | null;
  clasificacion: ClasificacionLinea | null;
  subtipo: string | null;
  match_movimiento_id: string | null;
  cheque_id: string | null;
  contra_cuenta_id: string | null;
  nota: string | null;
}

interface MovRow extends MovCruce {
  descripcion?: string | null;
  conciliado?: boolean | null;
}

interface ChequeRow extends ChequeCruce {
  origen_nombre: string | null;
  destino_nombre: string | null;
}

interface ArchivoPreview {
  nombre: string;
  leido: ExtractoLeido;
  cuenta: CuentaRow | null;
  desdeCorte: ExtractoLeido["lineas"];
  nuevas: number;
  guardado?: string;
}

/** Fecha de corte del listado de cheques: lo que se paga desde acá (o sigue sin pagar) se agrega. */
const CHEQUES_DESDE = "2026-08-01";

/** Botones según la línea sea una entrada (crédito) o una salida (débito). */
const BOTONES_CREDITO: ClasificacionLinea[] = ["cobro", "cheque_acreditado", "fci", "entre_cuentas", "intereses", "impuesto", "personal", "otro"];
const BOTONES_DEBITO: ClasificacionLinea[] = ["pago", "cheque_emitido", "cheque_devuelto", "impuesto", "gasto_bancario", "fci", "entre_cuentas", "tarjeta", "personal", "otro"];
const CON_REGLA: ClasificacionLinea[] = ["impuesto", "gasto_bancario", "intereses", "fci", "entre_cuentas", "tarjeta", "personal", "otro"];
const CON_CUENTA: ClasificacionLinea[] = ["fci", "entre_cuentas", "tarjeta"];
const CON_CHEQUE: ClasificacionLinea[] = ["cheque_acreditado", "cheque_emitido", "cheque_devuelto"];

const importeDe = (l: Pick<LineaRow, "monto" | "tipo">) => (l.tipo === "credito" ? 1 : -1) * Number(l.monto || 0);
const sinNumeros = (s: string) => s.replace(/\d[\d/.:]*/g, " ").replace(/\s+/g, " ").trim();
const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));

async function leerHojas(file: File): Promise<unknown[][][]> {
  const XLSX: any = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((n: string) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" }));
}

export default function ExtractoBbva({ onIrACheques }: { onIrACheques?: () => void }) {
  const { sociedadActiva } = useUser();
  const sociedadId = sociedadActiva?.id;
  const [cuentas, setCuentas] = useState<CuentaRow[]>([]);
  const [lineas, setLineas] = useState<LineaRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovRow[]>([]);
  const [cheques, setCheques] = useState<ChequeRow[]>([]);
  const [reglas, setReglas] = useState<ReglaCruce[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [archivos, setArchivos] = useState<ArchivoPreview[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Revisión
  const [abierta, setAbierta] = useState<string | null>(null);
  const [eleccion, setEleccion] = useState<{ clasificacion: ClasificacionLinea | null; movimiento_id: string | null; cheque_id: string | null; contra_cuenta_id: string | null; nota: string; recordar: boolean; texto: string }>({ clasificacion: null, movimiento_id: null, cheque_id: null, contra_cuenta_id: null, nota: "", recordar: false, texto: "" });
  const [buscarMov, setBuscarMov] = useState("");
  const [filtroCuenta, setFiltroCuenta] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  const [verClasificadas, setVerClasificadas] = useState(false);
  // Cheques
  const [chequesListado, setChequesListado] = useState<ChequeListado[] | null>(null);
  /** Cheques viejos (fuera del listado) que el banco dice pagados: solo para marcarlos como debitados si el CRM los tiene "a pagar". */
  const [chequesViejosPagados, setChequesViejosPagados] = useState<ChequeListado[]>([]);
  const [chequesArchivos, setChequesArchivos] = useState<string[]>([]);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setLoading(true);
    setError(null);
    const db = supabase as any;
    try {
      const { data: cs, error: e1 } = await db.from("cuentas_financieras").select("id, nombre, tipo, numero, moneda, fecha_corte, activa, saldo_banco, saldo_banco_fecha").eq("sociedad_id", sociedadId).order("orden");
      if (e1) {
        if (/saldo_banco|cuentas_financieras/.test(String(e1.message || ""))) { setFaltaMigracion(true); return; }
        throw e1;
      }
      const lista = (cs || []) as CuentaRow[];
      setFaltaMigracion(false);
      const ids = lista.map((c) => c.id);
      const corte = lista.map((c) => c.fecha_corte).sort()[0] || "2026-08-31";
      const desdeMovs = new Date(`${corte}T12:00:00Z`);
      desdeMovs.setUTCDate(desdeMovs.getUTCDate() - 10);
      const [ls, movs, chs, rg, cli, prov] = await Promise.all([
        ids.length ? traerTodo<LineaRow>(() => db.from("extracto_movimientos")
          .select("id, extracto_id, cuenta_id, fecha, descripcion, monto, tipo, estado, saldo, clave, clasificacion, subtipo, match_movimiento_id, cheque_id, contra_cuenta_id, nota")
          .in("cuenta_id", ids).order("fecha").order("id")) : Promise.resolve([]),
        traerTodo<MovRow>(() => db.from("movimientos")
          .select("id, fecha, monto, moneda, tipo, cliente_id, proveedor_id, anulado, descripcion, nota_credito_compra_id, ajuste_sentido, conciliado")
          .eq("sociedad_id", sociedadId).gte("fecha", desdeMovs.toISOString().slice(0, 10)).order("fecha").order("id")),
        traerTodo<ChequeRow>(() => db.from("echeqs")
          .select("id, numero, monto, direccion, estado, fecha_pago, tipo_cheque, origen_nombre, destino_nombre")
          .eq("sociedad_id", sociedadId).order("id")),
        db.from("extracto_reglas").select("texto, sentido, clasificacion, subtipo, contra_cuenta_id, nota").eq("sociedad_id", sociedadId).eq("activa", true),
        traerTodo<{ id: string; cuit: string | null }>(() => db.from("clientes").select("id, cuit").order("id")).catch(() => []),
        traerTodo<{ id: string; cuit: string | null }>(() => db.from("proveedores").select("id, cuit").order("id")).catch(() => []),
      ]);
      if (rg.error && /extracto_reglas/.test(String(rg.error.message || ""))) { setFaltaMigracion(true); return; }
      const cuitCli = new Map(cli.map((c) => [c.id, c.cuit]));
      const cuitProv = new Map(prov.map((p) => [p.id, p.cuit]));
      setCuentas(lista);
      setLineas(ls);
      setMovimientos(movs.map((m) => ({ ...m, cuit: (m.proveedor_id && cuitProv.get(m.proveedor_id)) || (m.cliente_id && cuitCli.get(m.cliente_id)) || null })));
      setCheques(chs);
      setReglas((rg.data || []) as ReglaCruce[]);
    } catch (e) {
      const msg = errorTexto(e);
      if (/clasificacion|saldo_banco|extracto_reglas|column .* does not exist/i.test(msg)) setFaltaMigracion(true);
      else setError(msg || "No se pudo leer el extracto.");
    } finally {
      setLoading(false);
    }
  }, [sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const cuentaPorId = useMemo(() => new Map(cuentas.map((c) => [c.id, c])), [cuentas]);
  const movPorId = useMemo(() => new Map(movimientos.map((m) => [m.id, m])), [movimientos]);
  const chequePorId = useMemo(() => new Map(cheques.map((c) => [c.id, c])), [cheques]);

  const pendientes = useMemo(() => lineas.filter((l) => l.estado === "pendiente"), [lineas]);
  const clasificadas = useMemo(() => lineas.filter((l) => l.estado !== "pendiente"), [lineas]);
  const aCargar = useMemo(() => pendientes.filter((l) => (l.clasificacion === "cobro" || l.clasificacion === "pago") && !l.match_movimiento_id), [pendientes]);

  const propuestas = useMemo(() => {
    const yaCruzados = new Set(lineas.map((l) => l.match_movimiento_id).filter(Boolean) as string[]);
    const libres = movimientos.filter((m) => !m.anulado && !yaCruzados.has(m.id));
    const usados = new Set(lineas.filter((l) => l.cheque_id && l.clasificacion).map((l) => `${l.clasificacion}:${l.cheque_id}`));
    return cruzarExtracto(
      pendientes.map((l) => ({ id: l.id, fecha: l.fecha, concepto: l.descripcion, importe: importeDe(l), cuenta_id: l.cuenta_id, clasificacion: l.clasificacion })),
      libres, cheques, cuentas, reglas, usados,
    );
  }, [lineas, pendientes, movimientos, cheques, cuentas, reglas]);

  const propPorLinea = useMemo(() => new Map(propuestas.map((p) => [p.linea_id, p])), [propuestas]);
  const automaticas = useMemo(() => propuestas.filter((p) => p.auto), [propuestas]);
  const resumenAuto = useMemo(() => {
    const g: Record<string, number> = {};
    for (const p of automaticas) g[p.clasificacion || "otro"] = (g[p.clasificacion || "otro"] || 0) + 1;
    return Object.entries(g).sort((a, b) => b[1] - a[1]);
  }, [automaticas]);

  const aRevisar = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return pendientes
      .filter((l) => !propPorLinea.get(l.id)?.auto)
      .filter((l) => !(l.clasificacion === "cobro" || l.clasificacion === "pago"))
      .filter((l) => !filtroCuenta || l.cuenta_id === filtroCuenta)
      .filter((l) => !q || l.descripcion.toLowerCase().includes(q) || String(l.monto).includes(q.replace(/\./g, "").replace(",", ".")))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [pendientes, propPorLinea, filtroCuenta, filtroTexto]);

  const totalesMes = useMemo(() => totalesBancoPorMes(clasificadas.map((l) => ({ fecha: l.fecha, importe: importeDe(l), clasificacion: l.clasificacion, subtipo: l.subtipo }))), [clasificadas]);
  const mesesTotales = useMemo(() => Object.keys(totalesMes).sort().reverse(), [totalesMes]);
  const subtiposTotales = useMemo(() => [...new Set(Object.values(totalesMes).flatMap((m) => Object.keys(m)))], [totalesMes]);

  const clavesPorCuenta = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of lineas) if (l.clave) { if (!m.has(l.cuenta_id)) m.set(l.cuenta_id, new Set()); m.get(l.cuenta_id)!.add(l.clave); }
    return m;
  }, [lineas]);

  const chequesComparacion = useMemo(() => {
    if (!chequesListado) return null;
    const enCrm = new Set(cheques.filter((c) => c.direccion === "emitido").map((c) => numeroCheque(c.numero)));
    const nuevos = chequesListado.filter((c) => !enCrm.has(numeroCheque(c.numero)));
    const aPagarEnCrm = new Set(cheques.filter((c) => c.direccion === "emitido" && ["pendiente", "entregado"].includes(c.estado)).map((c) => numeroCheque(c.numero)));
    const corte = cuentas.map((c) => c.fecha_corte).sort()[0] || "2026-08-31";
    const pagadosAntes = [...chequesListado, ...chequesViejosPagados].filter((c) => c.estado === "PAGADO" && c.fecha_debito && c.fecha_debito <= corte && aPagarEnCrm.has(numeroCheque(c.numero)));
    return {
      total: chequesListado.length,
      nuevos,
      yaEstan: chequesListado.length - nuevos.length,
      terceros: chequesListado.filter((c) => c.cubre_tercero).length,
      pagadosAntes: pagadosAntes.length,
    };
  }, [chequesListado, chequesViejosPagados, cheques, cuentas]);

  // ─── Acciones ──────────────────────────────────────────────────────────────

  async function elegirArchivos(files: FileList | null) {
    if (!files?.length) return;
    setLeyendo(true);
    setAviso(null);
    const out: ArchivoPreview[] = [];
    for (const f of Array.from(files)) {
      try {
        const [hoja] = await leerHojas(f);
        const leido = leerExtractoBbva(hoja || []);
        const cuenta = cuentas.find((c) => digitosCuenta(c.numero) === leido.cuentaDigitos) || null;
        const desdeCorte = cuenta ? leido.lineas.filter((l) => l.fecha > cuenta.fecha_corte) : leido.lineas;
        const claves = cuenta ? clavesPorCuenta.get(cuenta.id) || new Set<string>() : new Set<string>();
        out.push({ nombre: f.name, leido, cuenta, desdeCorte, nuevas: desdeCorte.filter((l) => !claves.has(l.clave)).length });
      } catch (e) {
        setAviso(`${f.name}: ${errorTexto(e)}`);
      }
    }
    setArchivos(out);
    setLeyendo(false);
  }

  async function guardarExtracto(a: ArchivoPreview) {
    if (!sociedadId || !a.cuenta) return;
    setGuardando(a.nombre);
    try {
      const { data, error: e } = await (supabase as any).rpc("importar_extracto_bbva", {
        p_sociedad_id: sociedadId,
        p_cuenta_id: a.cuenta.id,
        p_archivo: a.nombre,
        p_lineas: a.desdeCorte.map((l) => ({ fecha: l.fecha, concepto: l.concepto, sucursal: l.sucursal, importe: l.importe, saldo: l.saldo, clave: l.clave })),
        p_saldo_final: a.leido.saldoFinal,
        p_saldo_fecha: a.leido.saldoFecha,
      });
      if (e) throw e;
      setArchivos((prev) => prev.map((x) => x.nombre === a.nombre ? { ...x, guardado: `Guardado: ${data?.insertadas ?? 0} líneas nuevas${data?.repetidas ? `, ${data.repetidas} ya estaban` : ""}.` } : x));
      await cargar();
    } catch (e) {
      alert(`No se pudo guardar el extracto: ${errorTexto(e)}`);
    } finally {
      setGuardando(null);
    }
  }

  async function aplicar(cruces: Array<Record<string, unknown>>) {
    if (!sociedadId || !cruces.length) return true;
    for (let i = 0; i < cruces.length; i += 150) {
      const { error: e } = await (supabase as any).rpc("aplicar_cruces_extracto", { p_sociedad_id: sociedadId, p_cruces: cruces.slice(i, i + 150) });
      if (e) { alert(`No se pudo guardar: ${errorTexto(e)}`); return false; }
    }
    return true;
  }

  const cruceDe = (p: Propuesta) => ({
    linea_id: p.linea_id, clasificacion: p.clasificacion, subtipo: p.subtipo || null, movimiento_id: p.movimiento_id || null,
    cheque_id: p.cheque_id || null, contra_cuenta_id: p.contra_cuenta_id || null, nota: p.nota || null,
  });

  async function aplicarAutomaticas() {
    if (!automaticas.length) return;
    if (!confirm(`Se van a guardar ${automaticas.length} cruces automáticos (los movimientos del CRM quedan conciliados y con su cuenta; los cheques debitados o acreditados pasan a "cobrado"). Se puede deshacer línea por línea. ¿Seguimos?`)) return;
    setGuardando("auto");
    const ok = await aplicar(automaticas.map(cruceDe));
    setGuardando(null);
    if (ok) await cargar();
  }

  function abrir(l: LineaRow) {
    const p = propPorLinea.get(l.id);
    setAbierta(l.id);
    setBuscarMov("");
    setEleccion({
      clasificacion: p?.clasificacion || null,
      movimiento_id: p?.movimiento_id || null,
      cheque_id: p?.cheque_id || null,
      contra_cuenta_id: p?.contra_cuenta_id || null,
      nota: p?.nota || "",
      recordar: false,
      texto: sinNumeros(l.descripcion),
    });
  }

  async function guardarEleccion(l: LineaRow) {
    const c = eleccion.clasificacion;
    if (!c) { alert("Elegí qué es esta línea."); return; }
    if (CON_CUENTA.includes(c) && !eleccion.contra_cuenta_id && !confirm("No elegiste la otra cuenta. ¿Guardar igual?")) return;
    const subtipo = c === "impuesto" ? propPorLinea.get(l.id)?.subtipo || null : null;
    setGuardando(l.id);
    const ok = await aplicar([{
      linea_id: l.id, clasificacion: c, subtipo,
      movimiento_id: c === "cobro" || c === "pago" ? eleccion.movimiento_id : null,
      cheque_id: CON_CHEQUE.includes(c) ? eleccion.cheque_id : null,
      contra_cuenta_id: CON_CUENTA.includes(c) ? eleccion.contra_cuenta_id : null,
      nota: eleccion.nota.trim() || null,
    }]);
    if (ok && eleccion.recordar && CON_REGLA.includes(c) && eleccion.texto.trim() && sociedadId) {
      const { error: e } = await (supabase as any).from("extracto_reglas").insert({
        sociedad_id: sociedadId, texto: eleccion.texto.trim(), sentido: l.tipo, clasificacion: c, subtipo,
        contra_cuenta_id: CON_CUENTA.includes(c) ? eleccion.contra_cuenta_id : null, nota: eleccion.nota.trim() || null,
      });
      if (e) alert(`Se guardó la línea, pero no la regla: ${errorTexto(e)}`);
    }
    setGuardando(null);
    if (ok) { setAbierta(null); await cargar(); }
  }

  async function deshacer(l: LineaRow) {
    if (!confirm("¿Deshacer esta línea? Vuelve a quedar para revisar (y su movimiento o cheque vuelve a como estaba).")) return;
    setGuardando(l.id);
    const ok = await aplicar([{ linea_id: l.id, clasificacion: null }]);
    setGuardando(null);
    if (ok) await cargar();
  }

  async function elegirCheques(files: FileList | null) {
    if (!files?.length) return;
    setLeyendo(true);
    try {
      const listados: ChequeListado[][] = [];
      for (const f of Array.from(files)) {
        for (const hoja of await leerHojas(f)) {
          const l = leerListadoCheques(hoja);
          if (l.length) listados.push(l);
        }
      }
      if (!listados.length) { alert("No encontré cheques emitidos en esos archivos (hace falta la hoja \"Emitidos\" o el Excel de eCheq emitidos)."); return; }
      const listado = chequesParaCompletar(listados, CHEQUES_DESDE);
      const enListado = new Set(listado.map((c) => numeroCheque(c.numero)));
      setChequesListado(listado);
      setChequesViejosPagados(unirListados(listados).filter((c) => c.estado === "PAGADO" && c.fecha_debito && !enListado.has(numeroCheque(c.numero))));
      setChequesArchivos(Array.from(files).map((f) => f.name));
    } catch (e) {
      alert(`No se pudo leer: ${errorTexto(e)}`);
    } finally {
      setLeyendo(false);
    }
  }

  async function guardarCheques() {
    if (!sociedadId || !chequesListado?.length) return;
    setGuardando("cheques");
    let agregados = 0, numerados = 0, marcados = 0, pagados = 0;
    const corte = cuentas.map((c) => c.fecha_corte).sort()[0] || "2026-08-31";
    try {
      // Los viejos solo van si el CRM los tiene "a pagar" (para no mandar 1.700 cheques de 2022 en adelante).
      const aPagarEnCrm = new Set(cheques.filter((c) => c.direccion === "emitido" && ["pendiente", "entregado"].includes(c.estado)).map((c) => numeroCheque(c.numero)));
      const viejos = chequesViejosPagados.filter((c) => aPagarEnCrm.has(numeroCheque(c.numero)) && String(c.fecha_debito) <= corte).map((c) => ({ ...c, soloMarcar: true }));
      const todos: Array<ChequeListado & { soloMarcar?: boolean }> = [...chequesListado, ...viejos];
      for (let i = 0; i < todos.length; i += 200) {
        const { data, error: e } = await (supabase as any).rpc("completar_cheques_emitidos", {
          p_sociedad_id: sociedadId,
          p_cheques: todos.slice(i, i + 200).map((c) => ({
            numero: c.numero, monto: c.monto, fecha_emision: c.fecha_emision, fecha_pago: c.fecha_pago,
            beneficiario: c.beneficiario, estado: c.estado, cubre_tercero: c.cubre_tercero,
            pagado_antes_corte: c.estado === "PAGADO" && Boolean(c.fecha_debito) && String(c.fecha_debito) <= corte,
            solo_marcar: Boolean(c.soloMarcar),
          })),
        });
        if (e) throw e;
        agregados += Number(data?.agregados || 0); numerados += Number(data?.numerados || 0); marcados += Number(data?.marcados || 0); pagados += Number(data?.pagados || 0);
      }
      setAviso(`Cheques: ${agregados} agregados, ${numerados} del CRM completados con su número, ${marcados} marcados como de un tercero, ${pagados} que el banco debitó antes del corte pasaron a debitados.`);
      setChequesListado(null);
      setChequesViejosPagados([]);
      await cargar();
    } catch (e) {
      alert(`No se pudieron guardar los cheques: ${errorTexto(e)}`);
    } finally {
      setGuardando(null);
    }
  }

  // ─── Pantalla ──────────────────────────────────────────────────────────────

  if (!sociedadId) return null;
  if (faltaMigracion) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div><b>Falta correr la migración del extracto BBVA</b> (20261011180000_extractos_bbva.sql). Hasta entonces se puede seguir usando la carga de CSV de abajo.</div>
      </div>
    );
  }

  const nombreCuenta = (id: string | null) => (id && cuentaPorId.get(id)?.nombre) || "—";
  const descMov = (m: MovRow) => `${formatDate(m.fecha)} · ${m.descripcion || m.tipo} · ${formatCurrency(Number(m.monto))}${m.conciliado ? " · (marcado conciliado)" : ""}`;
  const descCheque = (c: ChequeRow) => `N° ${c.numero} · ${c.direccion === "emitido" ? c.destino_nombre || "emitido" : c.origen_nombre || "recibido"} · ${formatCurrency(Number(c.monto))} · paga ${c.fecha_pago ? formatDate(c.fecha_pago) : "—"} · ${c.estado}`;
  const cuentasActivas = cuentas.filter((c) => c.activa);
  const visibles = verTodas ? aRevisar : aRevisar.slice(0, 60);

  return (
    <div className="space-y-4">
      {/* 1) Subir extracto */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-white"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Extracto del BBVA (Excel)</p>
            <p className="text-xs text-zinc-500">Subí el "Detalle_mov_cuenta" tal cual lo baja el banco. Se puede subir varios y repetidos: no duplica. Primero se muestra el resumen; no se guarda nada hasta que aprietes Guardar.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600">
            {leyendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Elegir Excel
            <input type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={(e) => { void elegirArchivos(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {archivos.length > 0 && (
          <div className="mt-3 space-y-2">
            {archivos.map((a) => (
              <div key={a.nombre} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-white">{a.nombre}</p>
                    <p className="text-xs text-zinc-500">
                      {a.leido.cuentaTexto} → {a.cuenta ? <b>{a.cuenta.nombre}</b> : <span className="font-semibold text-red-600">no hay una cuenta con ese número (cargala en Cuentas)</span>}
                      {a.leido.lineas.length ? ` · del ${formatDate(a.leido.lineas[0].fecha)} al ${formatDate(a.leido.saldoFecha || "")}` : ""}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {a.desdeCorte.length} líneas desde el corte · <b>{a.nuevas} nuevas</b> · {a.desdeCorte.length - a.nuevas} ya cargadas
                      {a.leido.saldoFinal !== null ? ` · saldo al ${formatDate(a.leido.saldoFecha || "")}: ${formatCurrency(a.leido.saldoFinal)}` : ""}
                    </p>
                    {a.leido.saltos > 0 && <p className="text-xs font-semibold text-amber-600">⚠️ En {a.leido.saltos} renglones el saldo no cierra con el anterior: puede faltar alguna línea en el Excel. Se puede guardar igual.</p>}
                    {a.guardado && <p className="text-xs font-semibold text-emerald-600">{a.guardado}</p>}
                  </div>
                  {!a.guardado && (
                    <button disabled={!a.cuenta || guardando !== null} onClick={() => void guardarExtracto(a)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      {guardando === a.nombre ? <Loader2 className="h-4 w-4 animate-spin" /> : a.nuevas ? `Guardar ${a.nuevas} líneas` : "Actualizar saldo"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {aviso && <p className="mt-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">{aviso}</p>}
        {cuentasActivas.some((c) => c.saldo_banco_fecha) && (
          <p className="mt-2 text-xs text-zinc-500">
            Último extracto: {cuentasActivas.filter((c) => c.saldo_banco_fecha).map((c) => `${c.nombre} al ${formatDate(c.saldo_banco_fecha!)}`).join(" · ")}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo extractos y movimientos…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : (
        <>
          {/* 2) Cruce automático */}
          {pendientes.length > 0 && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-sm dark:border-violet-900 dark:bg-violet-950/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 font-semibold text-violet-800 dark:text-violet-200"><Wand2 className="h-4 w-4" /> Cruce automático</p>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {pendientes.length} líneas sin cerrar: <b>{automaticas.length} se cruzan solas</b>, {aRevisar.length} para revisar{aCargar.length ? `, ${aCargar.length} cobros/pagos a cargar` : ""}.
                  </p>
                  {resumenAuto.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">{resumenAuto.map(([k, v]) => `${CLASIFICACION_LABEL[k as ClasificacionLinea] || k}: ${v}`).join(" · ")}</p>
                  )}
                </div>
                <button disabled={!automaticas.length || guardando !== null} onClick={() => void aplicarAutomaticas()}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                  {guardando === "auto" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Aplicar {automaticas.length} cruces
                </button>
              </div>
            </div>
          )}

          {/* 3) Para revisar */}
          {aRevisar.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-zinc-900 dark:text-white">Para revisar ({aRevisar.length})</p>
                <div className="flex flex-wrap gap-2">
                  <select value={filtroCuenta} onChange={(e) => setFiltroCuenta(e.target.value)} className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                    <option value="">Todas las cuentas</option>
                    {cuentasActivas.filter((c) => lineas.some((l) => l.cuenta_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} placeholder="Buscar concepto o importe" className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
                </div>
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {visibles.map((l) => {
                  const p = propPorLinea.get(l.id);
                  const imp = importeDe(l);
                  const abiertaEsta = abierta === l.id;
                  const c = eleccion.clasificacion;
                  const candMov = abiertaEsta && (c === "cobro" || c === "pago") ? (() => {
                    const base = (p?.candidatos || []).map((id) => movPorId.get(id)).filter(Boolean) as MovRow[];
                    const q = buscarMov.trim().toLowerCase();
                    const extra = q ? movimientos.filter((m) => !m.anulado && !base.includes(m) && !lineas.some((x) => x.match_movimiento_id === m.id)
                      && ((m.descripcion || "").toLowerCase().includes(q) || String(m.monto).includes(q.replace(/\./g, "").replace(",", ".")))).slice(0, 15) : [];
                    return [...base, ...extra];
                  })() : [];
                  const candCh = abiertaEsta && c && CON_CHEQUE.includes(c) ? (() => {
                    const base = (p?.candidatos || []).map((id) => chequePorId.get(id)).filter(Boolean) as ChequeRow[];
                    const mismoMonto = cheques.filter((ch) => !base.includes(ch) && Math.round(Number(ch.monto) * 100) === Math.round(Math.abs(imp) * 100)
                      && (c === "cheque_emitido" ? ch.direccion === "emitido" : ch.direccion !== "emitido"));
                    const sel = eleccion.cheque_id ? chequePorId.get(eleccion.cheque_id) : undefined;
                    return [...(sel && !base.includes(sel) && !mismoMonto.includes(sel) ? [sel] : []), ...base, ...mismoMonto].slice(0, 15);
                  })() : [];
                  return (
                    <div key={l.id} className="py-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-20 shrink-0 text-xs text-zinc-500">{formatDate(l.fecha)}</span>
                        <span className="min-w-0 flex-1 truncate" title={l.descripcion}>{l.descripcion}<span className="ml-1 text-xs text-zinc-400">· {nombreCuenta(l.cuenta_id)}</span></span>
                        <span className={`w-36 shrink-0 text-right font-mono ${imp < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(imp)}</span>
                        <span className="w-56 shrink-0 truncate text-xs text-zinc-500" title={p?.motivo}>{p?.clasificacion ? `${CLASIFICACION_LABEL[p.clasificacion]}? ` : ""}{p?.motivo}</span>
                        <button onClick={() => (abiertaEsta ? setAbierta(null) : abrir(l))} className="rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">{abiertaEsta ? "Cerrar" : "Resolver"}</button>
                      </div>
                      {abiertaEsta && (
                        <div className="mt-2 space-y-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
                          <div className="flex flex-wrap gap-1">
                            {(imp > 0 ? BOTONES_CREDITO : BOTONES_DEBITO).map((b) => (
                              <button key={b} onClick={() => setEleccion((e) => ({ ...e, clasificacion: b }))}
                                className={`rounded-md px-2 py-1 text-xs font-medium ${c === b ? "bg-orange-500 text-white" : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700"}`}>
                                {CLASIFICACION_LABEL[b]}
                              </button>
                            ))}
                          </div>
                          {(c === "cobro" || c === "pago") && (
                            <div className="space-y-1">
                              <p className="text-xs text-zinc-500">¿Con qué {c} del CRM va? Si todavía no lo cargaste, elegí "Todavía no está cargado": queda marcado y se cruza solo cuando lo cargues.</p>
                              <input value={buscarMov} onChange={(e) => setBuscarMov(e.target.value)} placeholder="Buscar otro movimiento por texto o importe" className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                              <label className="flex items-center gap-2 text-xs"><input type="radio" checked={!eleccion.movimiento_id} onChange={() => setEleccion((e) => ({ ...e, movimiento_id: null }))} /> Todavía no está cargado</label>
                              {candMov.map((m) => (
                                <label key={m.id} className="flex items-center gap-2 text-xs"><input type="radio" checked={eleccion.movimiento_id === m.id} onChange={() => setEleccion((e) => ({ ...e, movimiento_id: m.id }))} /> {descMov(m)}</label>
                              ))}
                            </div>
                          )}
                          {c && CON_CHEQUE.includes(c) && (
                            <div className="space-y-1">
                              <label className="flex items-center gap-2 text-xs"><input type="radio" checked={!eleccion.cheque_id} onChange={() => setEleccion((e) => ({ ...e, cheque_id: null }))} /> No está en el CRM</label>
                              {candCh.map((ch) => (
                                <label key={ch.id} className="flex items-center gap-2 text-xs"><input type="radio" checked={eleccion.cheque_id === ch.id} onChange={() => setEleccion((e) => ({ ...e, cheque_id: ch.id }))} /> {descCheque(ch)}</label>
                              ))}
                              {c === "cheque_devuelto" && <p className="text-xs text-amber-600">El rechazo (que anula el cobro) se hace desde Cheques.</p>}
                            </div>
                          )}
                          {c && CON_CUENTA.includes(c) && (
                            <select value={eleccion.contra_cuenta_id || ""} onChange={(e) => setEleccion((x) => ({ ...x, contra_cuenta_id: e.target.value || null }))} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
                              <option value="">¿Con qué cuenta?</option>
                              {cuentasActivas.filter((x) => x.id !== l.cuenta_id && (c === "fci" ? x.tipo === "fci" : c === "tarjeta" ? x.tipo === "tarjeta_credito" : !["cheques_cartera", "cheques_emitidos"].includes(x.tipo))).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                            </select>
                          )}
                          <input value={eleccion.nota} onChange={(e) => setEleccion((x) => ({ ...x, nota: e.target.value }))} placeholder="Nota (opcional): ej. cheque de Juan Pablo Alesso" className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                          {c && CON_REGLA.includes(c) && (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <label className="flex items-center gap-1"><input type="checkbox" checked={eleccion.recordar} onChange={(e) => setEleccion((x) => ({ ...x, recordar: e.target.checked }))} /> Recordar: cuando el concepto diga</label>
                              <input value={eleccion.texto} disabled={!eleccion.recordar} onChange={(e) => setEleccion((x) => ({ ...x, texto: e.target.value }))} className="min-w-[14rem] flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900" />
                              <span className="text-zinc-500">→ {CLASIFICACION_LABEL[c]}</span>
                            </div>
                          )}
                          <div className="flex justify-end">
                            <button disabled={!c || guardando !== null} onClick={() => void guardarEleccion(l)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                              {guardando === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {aRevisar.length > visibles.length && (
                <button onClick={() => setVerTodas(true)} className="mt-2 text-xs font-medium text-orange-600 hover:underline">Ver las {aRevisar.length} líneas</button>
              )}
            </div>
          )}

          {/* 4) Cobros y pagos a cargar */}
          {aCargar.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <p className="mb-1 font-semibold text-amber-800 dark:text-amber-200">Cobros y pagos que están en el banco pero falta cargar en el CRM ({aCargar.length})</p>
              <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">Cuando los cargues (cobro en Facturación, pago en Órdenes de pago) se cruzan solos con "Aplicar cruces".</p>
              <div className="divide-y divide-amber-200/60 dark:divide-amber-900">
                {aCargar.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center gap-2 py-1">
                    <span className="w-20 text-xs text-zinc-500">{formatDate(l.fecha)}</span>
                    <Badge variant={l.clasificacion === "cobro" ? "success" : "warning"}>{l.clasificacion === "cobro" ? "Cobro" : "Pago"}</Badge>
                    <span className="min-w-0 flex-1 truncate">{l.descripcion}{l.nota ? <span className="text-zinc-500"> · {l.nota}</span> : ""}</span>
                    <span className="font-mono">{formatCurrency(importeDe(l))}</span>
                    <button onClick={() => void deshacer(l)} title="Deshacer" className="rounded-md p-1 text-zinc-500 hover:bg-amber-100 dark:hover:bg-amber-900"><RotateCcw className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5) Gastos e impuestos del banco por mes (1a) */}
          {mesesTotales.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-2 font-semibold text-zinc-900 dark:text-white">Gastos e impuestos del banco por mes</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500">
                      <th className="py-1 pr-3">Mes</th>
                      {subtiposTotales.map((s) => <th key={s} className="py-1 pr-3 text-right">{SUBTIPO_LABEL[s] || CLASIFICACION_LABEL[s as ClasificacionLinea] || s}</th>)}
                      <th className="py-1 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mesesTotales.map((mes) => {
                      const fila = totalesMes[mes];
                      const total = Object.values(fila).reduce((a, b) => a + b, 0);
                      return (
                        <tr key={mes} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-3">{mes.slice(5)}/{mes.slice(0, 4)}</td>
                          {subtiposTotales.map((s) => <td key={s} className={`py-1 pr-3 text-right font-mono ${(fila[s] || 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>{fila[s] ? formatCurrency(fila[s]) : "—"}</td>)}
                          <td className={`py-1 text-right font-mono font-semibold ${total < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-zinc-500">El SIRCREB es un pago a cuenta de Ingresos Brutos: pasáselo al contador para la declaración jurada.</p>
            </div>
          )}

          {/* 6) Ya clasificadas */}
          {clasificadas.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <button onClick={() => setVerClasificadas((v) => !v)} className="text-sm font-semibold text-zinc-700 hover:underline dark:text-zinc-300">
                {verClasificadas ? "Ocultar" : "Ver"} las {clasificadas.length} líneas ya cerradas
              </button>
              {verClasificadas && (
                <div className="mt-2 max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                  {[...clasificadas].sort((a, b) => b.fecha.localeCompare(a.fecha)).filter((l) => !filtroTexto.trim() || l.descripcion.toLowerCase().includes(filtroTexto.trim().toLowerCase())).slice(0, 400).map((l) => {
                    const m = l.match_movimiento_id ? movPorId.get(l.match_movimiento_id) : undefined;
                    const ch = l.cheque_id ? chequePorId.get(l.cheque_id) : undefined;
                    return (
                      <div key={l.id} className="flex flex-wrap items-center gap-2 py-1 text-xs">
                        <span className="w-20 text-zinc-500">{formatDate(l.fecha)}</span>
                        <Badge variant="outline">{l.clasificacion ? CLASIFICACION_LABEL[l.clasificacion] : "—"}</Badge>
                        <span className="min-w-0 flex-1 truncate" title={l.descripcion}>
                          {l.descripcion}
                          <span className="text-zinc-500">
                            {m ? ` → ${m.descripcion || m.tipo}` : ""}{ch ? ` → cheque ${ch.numero}` : ""}{l.contra_cuenta_id ? ` → ${nombreCuenta(l.contra_cuenta_id)}` : ""}{l.nota ? ` · ${l.nota}` : ""}
                          </span>
                        </span>
                        <span className={`font-mono ${importeDe(l) < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(importeDe(l))}</span>
                        <button onClick={() => void deshacer(l)} disabled={guardando !== null} title="Deshacer" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><RotateCcw className="h-3.5 w-3.5" /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 7) Completar cheques emitidos */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-zinc-900 dark:text-white">Completar cheques emitidos</p>
            <p className="text-xs text-zinc-500">
              Subí la planilla de cheques (hoja "Emitidos") o los Excel de eCheq emitidos. Solo agrega los que faltan (los que se pagan desde el {formatDate(CHEQUES_DESDE)} o siguen sin pagar); no toca los que ya están.
              La columna "Es Martín Fernández" los marca para su lista aparte.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <Upload className="h-4 w-4" /> Elegir archivos
            <input type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={(e) => { void elegirCheques(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {chequesComparacion && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
            <p>
              {chequesArchivos.join(", ")}: {chequesComparacion.total} cheques que importan · <b>{chequesComparacion.nuevos.length} no están en el CRM</b> · {chequesComparacion.yaEstan} ya están
              {chequesComparacion.terceros ? ` · ${chequesComparacion.terceros} de Martín Fernández` : ""}
              {chequesComparacion.pagadosAntes ? ` · ${chequesComparacion.pagadosAntes} figuran "a pagar" en el CRM pero el banco los debitó antes del corte (pasan a debitados)` : ""}
            </p>
            <button disabled={guardando !== null} onClick={() => void guardarCheques()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {guardando === "cheques" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
            </button>
          </div>
        )}
        {onIrACheques && <button onClick={onIrACheques} className="mt-2 text-xs font-medium text-orange-600 hover:underline">Ir a Cheques</button>}
      </div>
    </div>
  );
}
