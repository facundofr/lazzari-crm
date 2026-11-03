"use client";

/**
 * Bancos → Movimientos → "Movimientos del banco" (banco simple, Augusto 29–30/10/2026; lista para revisar, 02/11/2026: "quiero que el
 * sistema revise todos los movimientos y me los muestre, yo quiero tildarlos ... asociarla con la sugerencia o manual, pero si no la
 * asocio que no pase nada, que no quede pendiente"; los exactos "que las sugiera").
 * - Subir archivos del banco: la misma subida de siempre (vista previa y controles), sin la bandeja "Para confirmar".
 * - Al guardar, y cada vez que se abre esta pestaña, el motor (lib/banco-motor: reglas seguras, sin IA) revisa las líneas pendientes.
 *   Solo se aplica lo que no es de una persona: lo del banco (impuestos, comisiones, pases, tarjeta) y los cheques por su número.
 *   Un cobro, pago, OP, gasto o VEP que encuentra exacto queda como sugerencia (lib/banco-revision): «Asociar» con un clic o «No es».
 * - Sin sugerencia: «Elegir…» (un cobro o pago ya cargado), «Cargar cobro / Cargar pago» (la misma ventana, con el importe y la fecha
 *   de la línea; al guardar queda asociado a esa línea) o «Es otra cosa…». O nada: tildada «Revisada», la línea sale de la vista y no
 *   queda pendiente en ningún lado. Las marcas van a finanzas_registro.
 * - Pestañas por tipo (lib/movimientos-banco, lo que era "Ver por tipo") con cantidad y total; período, cuenta y buscador.
 * - «No pasó por el banco»: lo cargado en el CRM que no está en el extracto; «No pasa por el BBVA» lo saca (Banco Nación, Gubia…).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, Landmark, Lightbulb, Loader2, Search, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { montoCuentaDeOp } from "@/lib/saldo-cuentas";
import { clasificarMovimiento } from "@/lib/tipos-movimiento";
import { codigoDeConcepto, sinCodigoBanco } from "@/lib/bbva-codigos";
import { nombreCodigoBanco } from "@/lib/nombres-estados";
import { cbusDeFichas, cuitDeLinea, motorBanco, type DecisionBanco, type MovMotor } from "@/lib/banco-motor";
import { candidatosManual, marcasRevision, separarDecisiones } from "@/lib/banco-revision";
import {
  eventosRetencion, modelosRetencion, NOMBRE_RETENCION, sugerirFacturas, textoAplicado, TIPOS_RETENCION,
  type FacturaBanco, type ReglaRetencion, type RetencionEstimada, type SugerenciaFactura,
} from "@/lib/banco-cobros";
import { cobradoPorFactura, saldoFacturaVenta, traerDatosSaldoClientes } from "@/lib/saldo-clientes";
import { comprobanteVenta } from "@/lib/finanzas-lazza";
import { detalleDebitoAutomatico, pestanaDeLinea, PESTANAS_BANCO, resumenImpuestos, resumenPestanas, type LineaMov, type PestanaBanco } from "@/lib/movimientos-banco";
import { CLASIFICACION_LABEL, SUBTIPO_LABEL, type ChequeCruce, type ClasificacionLinea, type CuentaCruce } from "@/lib/extracto-bbva";
import FinanzasParaConfirmar from "@/components/finanzas-para-confirmar";
import { CobrarCliente } from "./cobrar";
import { PagarProveedor } from "./pagar";

const db = supabase as any;
const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));
const DEL_BANCO = new Set(["impuesto", "gasto_bancario", "intereses", "fci", "entre_cuentas", "tarjeta"]);
const sumarDias = (f: string, n: number) => { const d = new Date(`${f.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const NOMBRE_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m: string) => `${NOMBRE_MES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const ACCIONES_REGISTRO = ["cruce_solo", "desatada", "revisada", "no_revisada", "no_pasa_banco", "vuelve_banco"];

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
interface Fila {
  linea: Linea; importe: number; estado: Estado; detalle: string; conQue: string; porMotor: boolean;
  pestana: PestanaBanco; revisada: boolean; sugerencia: { decision: DecisionBanco; texto: string } | null;
  /** Transferencia que entró sin cobro cargado: facturas que pueden ser (saldo exacto, o menos las retenciones de siempre). */
  facturas: SugerenciaFactura[];
}
interface NoPaso { id: string; fecha: string; importe: number; texto: string }
type Vista = "revisar" | "cruzada" | "del_banco" | "revisadas" | "todas" | "no_paso";
type Tercero = { id: string; razon_social: string; cuit: string | null; cbu?: string | null };
/** Facturas de venta con saldo, número de cada factura, facturas de cada cobro y cómo retiene cada cliente (lib/banco-cobros). */
interface DatosFacturas {
  pendientes: FacturaBanco[]; numero: Map<string, string>; facturasDeMov: Map<string, string[]>; modelos: Map<string, ReglaRetencion[]>;
}
interface Datos {
  cuentas: CuentaCruce[]; ls: Linea[]; movs: Mov[]; chs: (ChequeCruce & { destino_nombre?: string | null })[]; cli: Tercero[]; prov: Tercero[];
  ops: { id: string; numero: string | null; medios_pago: unknown }[]; gas: { id: string; descripcion: string | null }[];
  reg: { linea_id: string | null; accion: string; propuesta: any; created_at: string }[];
  /** null si no se pudieron leer: la pantalla anda igual, sin sugerir facturas ni decir si el cobro está aplicado. */
  fac: DatosFacturas | null;
}

/**
 * Facturas de venta con saldo (el de lib/saldo-clientes, el mismo de Cobranzas: acá no se hace otra cuenta), las facturas de
 * cada cobro y las retenciones sufridas de cada cliente (para estimar las del próximo cobro).
 */
async function leerFacturas(sociedadId: string, cli: Tercero[]): Promise<DatosFacturas> {
  const [cc, filas, rets] = await Promise.all([
    traerDatosSaldoClientes(db, sociedadId, traerTodo),
    traerTodo<any>(() => db.from("facturas").select("id, cliente_id, tipo, punto_venta, numero, fecha, subtotal, total, moneda, estado")
      .eq("sociedad_id", sociedadId).neq("estado", "anulada").order("id")),
    traerTodo<any>(() => db.from("movimientos").select("id, tipo, fecha, monto, cliente_id, factura_id, anulado")
      .eq("sociedad_id", sociedadId).in("tipo", TIPOS_RETENCION).not("cliente_id", "is", null).order("id")),
  ]);
  const cobrado = cobradoPorFactura(cc.facturas, cc.movimientos, cc.aplicaciones);
  const ccPorId = new Map(cc.facturas.map((f) => [f.id, f]));
  const cliente = new Map(cli.map((c) => [c.id, c]));
  const numero = new Map<string, string>(filas.map((f) => [f.id, comprobanteVenta(f)]));
  const pendientes: FacturaBanco[] = [];
  for (const f of filas) {
    const c = ccPorId.get(f.id);
    if (!c || !f.cliente_id) continue;
    const saldo = saldoFacturaVenta(c, cobrado[f.id] || 0);
    if (saldo <= 0.005) continue;
    const cl = cliente.get(f.cliente_id);
    pendientes.push({
      id: f.id, clienteId: f.cliente_id, cliente: cl?.razon_social || "", cuit: cl?.cuit || null, tipo: String(f.tipo || ""), numero: numero.get(f.id) || "",
      fecha: String(f.fecha).slice(0, 10), moneda: String(f.moneda || "ARS").toUpperCase() === "USD" ? "USD" : "ARS",
      subtotal: Number(f.subtotal) || 0, total: Number(f.total) || 0, saldo,
    });
  }
  const facturasDeMov = new Map<string, string[]>();
  const sumar = (mov: string | null | undefined, fac: string | null | undefined) => { if (mov && fac) facturasDeMov.set(mov, [...(facturasDeMov.get(mov) || []), fac]); };
  for (const a of cc.aplicaciones) sumar(a.movimiento_id, a.factura_id);
  for (const m of cc.movimientos) sumar(m.id, m.factura_id);
  const eventos = eventosRetencion({ retenciones: rets, aplicaciones: cc.aplicaciones, facturas: new Map(filas.map((f) => [f.id, f])) });
  return { pendientes, numero, facturasDeMov, modelos: modelosRetencion(eventos) };
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
    cbus: cbusDeFichas([...d.prov, ...d.cli]),
  };
}

/** Texto corto de un movimiento del CRM: OP, cliente o proveedor, gasto o su descripción. */
function textoDeMovimiento(d: Datos) {
  const nombre = new Map<string, string>([...d.cli.map((c) => [c.id, c.razon_social] as const), ...d.prov.map((p) => [p.id, p.razon_social] as const)]);
  const opNum = new Map(d.ops.map((o) => [o.id, o.numero || "OP"]));
  const gasto = new Map(d.gas.map((g) => [g.id, g.descripcion || ""]));
  return (m: Pick<Mov, "orden_pago_id" | "cliente_id" | "proveedor_id" | "gasto_manual_id" | "descripcion" | "tipo">) =>
    [m.orden_pago_id && opNum.get(m.orden_pago_id), (m.cliente_id || m.proveedor_id) && nombre.get((m.cliente_id || m.proveedor_id)!), m.gasto_manual_id && gasto.get(m.gasto_manual_id), !m.orden_pago_id && !m.cliente_id && !m.proveedor_id && !m.gasto_manual_id && m.descripcion]
      .filter(Boolean).join(" · ") || m.tipo;
}

export function BancoSimple({ sociedadId }: { sociedadId: string }) {
  const { profile } = useUser() as any;
  const { toast } = useToast();
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [noPaso, setNoPaso] = useState<NoPaso[]>([]);
  const [noPasaMarcados, setNoPasaMarcados] = useState<(NoPaso & { nota: string })[]>([]);
  const [cuentas, setCuentas] = useState<Map<string, string>>(new Map());
  const [ultimaCarga, setUltimaCarga] = useState<{ carga: string; cuando: string; n: number } | null>(null);
  const [vista, setVista] = useState<Vista>("revisar");
  const [pestana, setPestana] = useState<PestanaBanco | "todas">("todas");
  const [periodo, setPeriodo] = useState("60");
  const [cuenta, setCuenta] = useState("");
  const [buscar, setBuscar] = useState("");
  const [tildados, setTildados] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [otraCosa, setOtraCosa] = useState<{ id: string; que: "personal" | "anterior" | "otro"; nota: string } | null>(null);
  const [elegir, setElegir] = useState<{ id: string; ids: Set<string>; buscar: string } | null>(null);
  const [cargarDesde, setCargarDesde] = useState<{
    linea: Linea; tipo: "cobro" | "pago"; sugerido: { id: string; nombre: string } | null;
    /** «Cobrar» de una factura sugerida: la ventana de cobro abre con esa factura, la transferencia y las retenciones estimadas. */
    factura?: { clienteId: string; nombre: string; facturaId: string; retenciones: RetencionEstimada[] };
  } | null>(null);
  const [noPasaNota, setNoPasaNota] = useState<{ id: string; nota: string } | null>(null);
  const [verMarcados, setVerMarcados] = useState(false);
  const motivos = useRef(new Map<string, string>());
  const sugerencias = useRef(new Map<string, DecisionBanco>());
  const datos = useRef<Datos | null>(null);

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
      // El CBU de la ficha (clientes: alias_cbu, si es un CBU de 22 dígitos) reconoce a quién va o de quién viene una transferencia.
      traerTodo<Tercero & { alias_cbu?: string | null }>(() => db.from("clientes").select("id, razon_social, cuit, alias_cbu").eq("sociedad_id", sociedadId).order("id"))
        .then((cs) => cs.map(({ alias_cbu, ...c }) => ({ ...c, cbu: alias_cbu ?? null }))),
      traerTodo<Tercero>(() => db.from("proveedores").select("id, razon_social, cuit, cbu").eq("sociedad_id", sociedadId).order("id")),
      traerTodo<{ id: string; numero: string | null; medios_pago: unknown }>(() => db.from("ordenes_pago").select("id, numero, medios_pago").eq("sociedad_id", sociedadId).order("id")),
      traerTodo<{ id: string; descripcion: string | null }>(() => db.from("gastos_manuales").select("id, descripcion").eq("sociedad_id", sociedadId).gte("fecha", "2026-07-01").order("id")),
      traerTodo<{ linea_id: string | null; accion: string; propuesta: any; created_at: string }>(() => db.from("finanzas_registro")
        .select("linea_id, accion, propuesta, created_at").eq("sociedad_id", sociedadId).in("accion", ACCIONES_REGISTRO).order("created_at").order("id")),
    ]);
    // Si las facturas no se pueden leer, la pantalla sigue igual (solo no sugiere facturas): nunca frena.
    const fac = await leerFacturas(sociedadId, cli).catch((e) => { console.warn("Bancos · facturas para sugerir:", e); return null; });
    return { cuentas: (cs || []) as CuentaCruce[], ls, movs, chs, cli, prov, ops, gas, reg, fac };
  }, [sociedadId]);

  /** Arma la lista, las sugerencias, lo que no pasó por el banco y la última carga del motor. */
  const mostrar = useCallback((d: Datos) => {
    datos.current = d;
    setCuentas(new Map(d.cuentas.map((c) => [c.id, c.nombre])));
    const textoMov = textoDeMovimiento(d);
    const movPorId = new Map(d.movs.map((m) => [m.id, m]));
    const movsDeLinea = new Map<string, Mov[]>();
    for (const m of d.movs) if (m.extracto_movimiento_id) movsDeLinea.set(m.extracto_movimiento_id, [...(movsDeLinea.get(m.extracto_movimiento_id) || []), m]);
    const cheque = new Map(d.chs.map((c) => [c.id, c]));
    const { revisadas, noPasa } = marcasRevision(d.reg);
    // Última decisión del motor sobre cada línea (cruce que se puede desatar, o desatada) y las cargas que se pueden deshacer.
    const ultimo = new Map<string, string>();
    const cargas = new Map<string, { cuando: string; lineas: Set<string> }>();
    for (const r of d.reg) {
      if (!r.linea_id || (r.accion !== "cruce_solo" && r.accion !== "desatada")) continue;
      ultimo.set(r.linea_id, r.accion);
      const c = r.propuesta?.carga;
      if (r.accion === "cruce_solo" && c) {
        const x = cargas.get(c) || { cuando: r.created_at, lineas: new Set<string>() };
        x.lineas.add(r.linea_id); x.cuando = r.created_at; cargas.set(c, x);
      }
    }
    // Cobro de un cliente: si está aplicado a facturas del CRM o no (Augusto 03/11/2026). Pagos y lo demás, sin nada.
    const aplicado = (m: Mov) => (d.fac && m.cliente_id && clasificarMovimiento(m) === "ingreso"
      ? ` · ${textoAplicado((d.fac.facturasDeMov.get(m.id) || []).map((id) => d.fac!.numero.get(id) || ""))}` : "");
    const cbus = cbusDeFichas([...d.prov, ...d.cli]);
    const lista: Fila[] = d.ls.map((l) => {
      const importe = (l.tipo === "credito" ? 1 : -1) * Number(l.monto);
      const movs = [...new Map([...(l.match_movimiento_id && movPorId.get(l.match_movimiento_id) ? [movPorId.get(l.match_movimiento_id)!] : []), ...(movsDeLinea.get(l.id) || [])].map((m) => [m.id, m])).values()];
      const ch = l.cheque_id ? cheque.get(l.cheque_id) : null;
      let estado: Estado, conQue: string;
      let sugerencia: Fila["sugerencia"] = null;
      let facturas: SugerenciaFactura[] = [];
      if (l.estado === "pendiente") {
        estado = "sin_cruzar";
        const s = sugerencias.current.get(l.id);
        if (s) sugerencia = { decision: s, texto: s.movimientos.map((id) => movPorId.get(id)).filter(Boolean).map((m) => `${textoMov(m!)} (${formatCurrency(Number(m!.monto))}, ${formatDate(m!.fecha)})${aplicado(m!)}`).join(" + ") };
        // Entró plata y no hay cobro cargado que coincida: la factura con ese saldo, o la que da con las retenciones de siempre del cliente.
        else if (importe > 0 && d.fac) facturas = sugerirFacturas({ importe, cuit: cuitDeLinea(l.descripcion || "", cbus) }, d.fac.pendientes, d.fac.modelos);
        conQue = motivos.current.get(l.id) || (l.tipo === "credito" ? "No está el cobro en el CRM" : "No está el pago en el CRM");
      } else if (movs.length || ch) {
        estado = "cruzada";
        conQue = movs.length ? movs.map((m) => `${textoMov(m)}${aplicado(m)}`).join(" + ") : `Cheque ${ch!.numero}${ch!.origen_nombre ? ` de ${ch!.origen_nombre}` : (ch as any).destino_nombre ? ` a ${(ch as any).destino_nombre}` : ""}`;
      } else if (l.estado === "matcheado" && DEL_BANCO.has(String(l.clasificacion))) {
        estado = "del_banco";
        conQue = [CLASIFICACION_LABEL[l.clasificacion as ClasificacionLinea] || l.clasificacion, l.subtipo && (SUBTIPO_LABEL[l.subtipo] || l.subtipo)].filter(Boolean).join(" · ");
      } else { estado = "explicada"; conQue = l.nota || CLASIFICACION_LABEL[l.clasificacion as ClasificacionLinea] || "Explicada"; }
      const mov: LineaMov = { ...l, descripcion: l.descripcion || "", monto: Number(l.monto) };
      return {
        linea: l, importe, estado, detalle: sinCodigoBanco(l.descripcion), conQue, porMotor: l.estado !== "pendiente" && ultimo.get(l.id) === "cruce_solo",
        pestana: pestanaDeLinea(mov), revisada: estado === "sin_cruzar" && revisadas.has(l.id), sugerencia, facturas,
      };
    }).reverse();
    setFilas(lista);
    // Cargado en el CRM que no pasó por el banco: cobros y pagos de las cuentas del banco, del período que ya cubre el extracto.
    const e = entradaMotor(d);
    const bancos = new Set(d.cuentas.filter((c) => ["cuenta_corriente", "caja_ahorro"].includes(c.tipo) && c.moneda === "ARS").map((c) => c.id));
    const fechas = d.ls.map((l) => l.fecha.slice(0, 10)).sort();
    const hasta = fechas.length ? sumarDias(fechas[fechas.length - 1], -2) : "";
    const todosNoPaso = e.movimientos.filter((m) => fechas.length && m.fecha >= fechas[0] && m.fecha <= hasta && (!m.cuenta_id || bancos.has(m.cuenta_id))
      && ["cobro", "pago", "transferencia", "deposito"].includes(String(m.tipo)) && String(m.moneda || "ARS") === "ARS"
      && ["ingreso", "egreso"].includes(clasificarMovimiento(m)) && !(m.montoCuenta !== null && m.montoCuenta !== undefined && Number(m.montoCuenta) < 0.005))
      .map((m) => ({ id: m.id, fecha: m.fecha, importe: (clasificarMovimiento(m) === "ingreso" ? 1 : -1) * Number(m.monto), texto: textoMov(m as unknown as Mov) }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    setNoPaso(todosNoPaso.filter((m) => !noPasa.has(m.id)));
    setNoPasaMarcados(todosNoPaso.filter((m) => noPasa.has(m.id)).map((m) => ({ ...m, nota: noPasa.get(m.id) || "" })));
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

  /** Aplica decisiones con procesar_banco (la misma de siempre). Devuelve cuántas quedaron. */
  const aplicar = useCallback(async (ds: DecisionBanco[]): Promise<number> => {
    if (!ds.length) return 0;
    const { data, error: e } = await db.rpc("procesar_banco", { p_sociedad_id: sociedadId, p_decisiones: ds });
    if (e) throw new Error(/procesar_banco|schema cache|does not exist/i.test(String(e.message || "")) ? "Falta una actualización de la base de datos (banco simple): las líneas no se procesaron." : errorTexto(e));
    for (const a of (data?.avisos || []) as string[]) toast.warning(a);
    return Number(data?.aplicadas) || 0;
  }, [sociedadId, toast]);

  /**
   * Corre el motor sobre las pendientes: aplica lo del banco y los cheques; los cobros y pagos exactos quedan como sugerencia.
   * Con asociarLinea (después de «Cargar cobro / pago» desde esa línea), lo que se encuentre para esa línea se asocia: lo pidió la persona.
   */
  const procesar = useCallback(async (asociarLinea?: string) => {
    setProcesando(true);
    try {
      const d = await cargar();
      if (!d) return;
      const ds: DecisionBanco[] = motorBanco(entradaMotor(d));
      const { aplicar: solas, sugerencias: sug } = separarDecisiones(ds);
      motivos.current = new Map(ds.filter((x) => x.estado === "sin_cruzar").map((x) => [x.linea_id, x.motivo]));
      const pedida = asociarLinea ? sug.get(asociarLinea) : undefined;
      if (pedida) sug.delete(asociarLinea!);
      sugerencias.current = sug;
      const lista = pedida ? [...solas, { ...pedida, motivo: `Cargado desde la línea del banco (${profile?.full_name || "persona"})` }] : solas;
      if (!lista.length) { mostrar(d); if (asociarLinea) toast.info("Guardado. No coincide exacto con la línea: asociala con «Elegir…»."); return; }
      try {
        const n = await aplicar(lista);
        if (pedida) toast.success("Guardado y asociado a la línea del banco.");
        else if (n > 0) toast.success(`${n} línea${n > 1 ? "s" : ""} del banco quedaron listas solas.`);
      } catch (e) {
        setError(errorTexto(e));
        mostrar(d);
        return;
      }
      await cargar();
    } finally {
      setProcesando(false);
    }
  }, [aplicar, cargar, mostrar, profile?.full_name, toast]);

  // Al abrir la pestaña (y al cambiar de sociedad): se revisa lo que se cargó desde la última vez.
  useEffect(() => { void procesar(); }, [procesar]);

  async function registrar(filasReg: { linea_id: string | null; accion: string; tipo?: string | null; propuesta?: unknown; resumen: string }[]) {
    const { error: e } = await db.from("finanzas_registro").insert(filasReg.map((r) => ({ sociedad_id: sociedadId, usuario_id: profile?.id, origen: "persona", ...r })));
    if (e) throw e;
  }

  async function desatar(lineaId: string | null, carga: string | null) {
    setOcupado(lineaId || "carga");
    try {
      const { data, error: e } = await db.rpc("deshacer_banco", { p_sociedad_id: sociedadId, p_carga: carga, p_linea_id: lineaId });
      if (e) throw e;
      for (const a of (data?.avisos || []) as string[]) toast.warning(a);
      toast.success(Number(data?.deshechas) ? `Listo: ${data.deshechas} línea${data.deshechas > 1 ? "s" : ""} sin asociar. No se vuelve a sugerir.` : "No había nada para deshacer (alguien ya la cambió).");
      await procesar();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  }

  /** Asocia las sugerencias de esas líneas (un clic, o las tildadas). */
  async function asociar(ids: string[]) {
    const ds = ids.map((id) => filas.find((f) => f.linea.id === id)?.sugerencia?.decision).filter(Boolean)
      .map((dd) => ({ ...dd!, motivo: `Asociado por ${profile?.full_name || "una persona"}: ${dd!.motivo}` }));
    if (!ds.length) return;
    setOcupado(ids.length === 1 ? ids[0] : "lote");
    try {
      const n = await aplicar(ds);
      toast.success(n === ds.length ? `${n === 1 ? "Asociada" : `${n} asociadas`}.` : `${n} de ${ds.length} asociadas: las otras ya las cambió alguien.`);
      setTildados(new Set());
      await procesar();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  }

  /** «No es»: esa sugerencia no se vuelve a hacer (el motor la saltea). */
  async function noEs(f: Fila) {
    if (!f.sugerencia) return;
    setOcupado(f.linea.id);
    try {
      await registrar([{ linea_id: f.linea.id, accion: "desatada", tipo: f.importe > 0 ? "cobro" : "pago", propuesta: { movimientos: f.sugerencia.decision.movimientos }, resumen: `No es: ${f.sugerencia.texto}`.slice(0, 300) }]);
      await procesar();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  }

  /** Tilde «Revisada» (o destildar): la línea sale de «Para revisar»; no cambia nada más. */
  async function marcarRevisada(ids: string[], si: boolean) {
    if (!ids.length) return;
    setOcupado(ids.length === 1 ? ids[0] : "lote");
    try {
      await registrar(ids.map((id) => ({ linea_id: id, accion: si ? "revisada" : "no_revisada", resumen: si ? "Revisada sin asociar" : "Vuelve a Para revisar" })));
      setTildados(new Set());
      await cargar();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  }

  /** «Elegir…»: asocia la línea con los movimientos que eligió la persona (aunque no sumen igual: avisa, no frena). */
  async function asociarElegidos() {
    if (!elegir || !elegir.ids.size) return;
    const f = filas.find((x) => x.linea.id === elegir.id);
    if (!f) return;
    setOcupado(f.linea.id);
    try {
      const n = await aplicar([{ linea_id: f.linea.id, estado: "cruzada", clasificacion: f.importe > 0 ? "cobro" : "pago", subtipo: null, movimientos: [...elegir.ids],
        cheque_id: null, contra_cuenta_id: null, motivo: `Elegido por ${profile?.full_name || "una persona"}` }]);
      toast[n ? "success" : "info"](n ? "Asociada." : "No se pudo: la línea o el movimiento ya los cambió alguien.");
      setElegir(null);
      await procesar();
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
      await registrar([{ linea_id: otraCosa.id, accion: "corregida", tipo: clasificacion, resumen: nota }]);
      setOtraCosa(null);
      await cargar();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  }

  /** «No pasa por el BBVA» (Banco Nación, Gubia, Martínez Bosio…) y «Volver»: solo saca el movimiento de este control. */
  async function noPasaPorBanco(movimientoId: string, si: boolean, nota = "") {
    setOcupado(movimientoId);
    try {
      await registrar([{ linea_id: null, accion: si ? "no_pasa_banco" : "vuelve_banco", propuesta: { movimiento_id: movimientoId, nota: nota.trim() }, resumen: si ? `No pasa por el BBVA${nota.trim() ? `: ${nota.trim()}` : ""}` : "Vuelve al control del banco" }]);
      setNoPasaNota(null);
      await cargar();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  }

  /** «Cobrar» una factura sugerida: la misma ventana de cobro de siempre, directo con la factura tildada; se revisa y se guarda ahí. */
  function abrirCobrarFactura(f: Fila, s: SugerenciaFactura) {
    setCargarDesde({ linea: f.linea, tipo: "cobro", sugerido: null,
      factura: { clienteId: s.factura.clienteId, nombre: s.factura.cliente, facturaId: s.factura.id, retenciones: s.retenciones } });
  }

  function abrirCargar(f: Fila) {
    const d = datos.current;
    const cuit = cuitDeLinea(f.linea.descripcion || "", d ? cbusDeFichas([...d.prov, ...d.cli]) : undefined);
    const lista = f.importe > 0 ? d?.cli : d?.prov;
    const t = cuit ? (lista || []).filter((x) => String(x.cuit || "").replace(/\D/g, "") === cuit) : [];
    setCargarDesde({ linea: f.linea, tipo: f.importe > 0 ? "cobro" : "pago", sugerido: t.length === 1 ? { id: t[0].id, nombre: t[0].razon_social } : null });
  }

  // ── Lo que se ve ──
  const desde = useMemo(() => sumarDias(todayAR(), -60), []);
  const meses = useMemo(() => [...new Set(filas.map((f) => f.linea.fecha.slice(0, 7)))].sort().reverse(), [filas]);
  const cuentasConLineas = useMemo(() => [...new Set(filas.map((f) => f.linea.cuenta_id))].map((id) => ({ id, nombre: cuentas.get(id) || "" })), [filas, cuentas]);
  const enVista = useCallback((f: Fila, v: Vista) => v === "todas" || (v === "revisar" ? f.estado === "sin_cruzar" && !f.revisada
    : v === "revisadas" ? f.revisada || f.estado === "explicada" : f.estado === v), []);
  const base = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return filas.filter((f) => {
      const fe = f.linea.fecha.slice(0, 10);
      return (periodo === "todo" || (periodo === "60" ? fe >= desde : fe.startsWith(periodo))) && (!cuenta || f.linea.cuenta_id === cuenta)
        && (!t || `${f.detalle} ${f.conQue} ${f.sugerencia?.texto || ""} ${Math.abs(f.importe)} ${f.importe}`.toLowerCase().includes(t));
    });
  }, [filas, periodo, desde, cuenta, buscar]);
  const lineaMov = (f: Fila): LineaMov => ({ ...f.linea, descripcion: f.linea.descripcion || "", monto: Number(f.linea.monto) });
  const pestanas = useMemo(() => resumenPestanas(base.filter((f) => enVista(f, vista === "no_paso" ? "todas" : vista)).map(lineaMov)), [base, vista, enVista]);
  const cuentaVista = (v: Vista) => base.filter((f) => (pestana === "todas" || f.pestana === pestana) && enVista(f, v)).length;
  const visibles = useMemo(() => base.filter((f) => (pestana === "todas" || f.pestana === pestana) && enVista(f, vista)), [base, pestana, vista, enVista]);
  const impuestos = useMemo(() => (pestana === "impuestos_comisiones" ? resumenImpuestos(visibles.map(lineaMov)) : []), [pestana, visibles]);
  const tildables = visibles.filter((f) => f.estado === "sin_cruzar");
  const tildadas = filas.filter((f) => tildados.has(f.linea.id));
  const conSugerencia = tildadas.filter((f) => f.sugerencia && f.estado === "sin_cruzar");
  const candidatos = useMemo(() => {
    const d = datos.current;
    const f = elegir ? filas.find((x) => x.linea.id === elegir.id) : null;
    if (!d || !f || !elegir) return [];
    const texto = textoDeMovimiento(d);
    const q = elegir.buscar.trim().toLowerCase();
    return candidatosManual({ fecha: f.linea.fecha, importe: f.importe }, entradaMotor(d).movimientos, 60)
      .map((m) => ({ id: m.id, fecha: String(m.fecha), monto: Number(m.monto), texto: texto(m as unknown as Mov) }))
      .filter((m) => !q || `${m.texto} ${m.monto}`.toLowerCase().includes(q)).slice(0, 25);
  }, [elegir, filas]);
  const sumaElegidos = elegir ? candidatos.filter((m) => elegir.ids.has(m.id)).reduce((s, m) => s + m.monto, 0) : 0;
  const tildar = (id: string, si: boolean) => setTildados((p) => { const n = new Set(p); if (si) n.add(id); else n.delete(id); return n; });

  const chip = (activo: boolean) => `rounded-md px-2.5 py-1 text-xs font-medium ${activo ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`;
  const tab = (activo: boolean) => `shrink-0 rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${activo ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900"}`;
  const totalPestana = (r: { cant: number; entradas: number; salidas: number }) => !r.cant ? "—"
    : r.entradas && r.salidas ? <><span className="text-emerald-700 dark:text-emerald-400">+{formatCurrency(r.entradas)}</span> <span>−{formatCurrency(r.salidas)}</span></>
    : r.entradas ? <span className="text-emerald-700 dark:text-emerald-400">{formatCurrency(r.entradas)}</span> : formatCurrency(r.salidas);
  const boton = "text-zinc-600 hover:underline disabled:opacity-50 dark:text-zinc-300";
  const lineaCargar = cargarDesde ? { monto: Math.abs(Number(cargarDesde.linea.monto)), fecha: cargarDesde.linea.fecha.slice(0, 10) } : null;

  return (
    <div className="space-y-3">
      <FinanzasParaConfirmar simple soloSubir onGuardado={() => void procesar()} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        {procesando ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Revisando las líneas del banco…</span>
          : <span>Lo del banco (impuestos, comisiones, pases, cheques) queda solo. Los cobros y pagos que encuentro los sugiero: los asociás con un clic o los dejás. Nada queda pendiente.</span>}
        {ultimaCarga && !procesando && (
          <button disabled={ocupado !== null} onClick={() => { if (window.confirm(`¿Deshacer lo que hizo el banco el ${new Date(ultimaCarga.cuando).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} (${ultimaCarga.n} línea${ultimaCarga.n > 1 ? "s" : ""})? No lo vuelve a hacer.`)) void desatar(null, ultimaCarga.carga); }}
            className="flex items-center gap-1 text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-300">
            {ocupado === "carga" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Deshacer la última carga ({ultimaCarga.n})
          </button>
        )}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</p>}

      {/* Qué mirar: para revisar (sin asociar y sin tildar), lo asociado, lo del banco, lo revisado y lo cargado que no pasó por el banco. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          <button type="button" onClick={() => setVista("revisar")} className={chip(vista === "revisar")}>Para revisar ({cuentaVista("revisar")})</button>
          <button type="button" onClick={() => setVista("cruzada")} className={chip(vista === "cruzada")}>Asociadas ({cuentaVista("cruzada")})</button>
          <button type="button" onClick={() => setVista("del_banco")} className={chip(vista === "del_banco")}>Del banco ({cuentaVista("del_banco")})</button>
          <button type="button" onClick={() => setVista("revisadas")} className={chip(vista === "revisadas")}>Revisadas sin asociar ({cuentaVista("revisadas")})</button>
          <button type="button" onClick={() => setVista("todas")} className={chip(vista === "todas")}>Todas ({cuentaVista("todas")})</button>
          <button type="button" onClick={() => setVista("no_paso")} className={chip(vista === "no_paso")} title="Cargado en el CRM que no aparece en el extracto">No pasó por el banco ({noPaso.length})</button>
        </div>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
          <option value="60">Últimos 60 días</option>
          <option value="todo">Todo</option>
          {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
        </select>
        {cuentasConLineas.length > 1 && (
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todas las cuentas</option>
            {cuentasConLineas.map((c) => <option key={c.id} value={c.id}>{c.nombre.replace(/^BBVA /, "")}</option>)}
          </select>
        )}
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar (texto o importe)" className="h-8 w-56 rounded-lg border border-zinc-200 bg-white pl-7 pr-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
      </div>

      {vista !== "no_paso" && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[{ id: "todas" as const, nombre: "Todas", ayuda: "" }, ...PESTANAS_BANCO].map((p) => {
            const r = pestanas.find((x) => x.id === p.id)!;
            return (
              <button key={p.id} type="button" title={p.ayuda} onClick={() => setPestana(p.id)} className={tab(pestana === p.id)}>
                <p className="whitespace-nowrap font-semibold text-zinc-900 dark:text-white">{p.nombre} <span className="font-normal text-zinc-500">· {r.cant}</span></p>
                <p className="whitespace-nowrap font-mono text-zinc-600 dark:text-zinc-300">{totalPestana(r)}</p>
              </button>
            );
          })}
        </div>
      )}

      {impuestos.length > 0 && vista !== "no_paso" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          {impuestos.map((c) => (
            <span key={c.categoria}>{c.categoria}: <b className="font-mono">{formatCurrency(c.salidas)}</b> <span className="text-zinc-400">({c.cantSalidas})</span>
              {c.cantDevoluciones > 0 && <span className="text-emerald-700 dark:text-emerald-400"> · devoluciones {formatCurrency(c.devoluciones)}</span>}</span>
          ))}
        </div>
      )}

      {tildadas.length > 0 && vista !== "no_paso" && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm dark:border-orange-900 dark:bg-orange-950/40">
          <span className="font-medium">{tildadas.length} tildada{tildadas.length > 1 ? "s" : ""}</span>
          {conSugerencia.length > 0 && <button disabled={ocupado !== null} onClick={() => void asociar(conSugerencia.map((f) => f.linea.id))} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Asociar las sugerencias ({conSugerencia.length})</button>}
          <button disabled={ocupado !== null} onClick={() => void marcarRevisada(tildadas.filter((f) => !f.revisada).map((f) => f.linea.id), true)} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900">Marcar revisadas sin asociar</button>
          <button onClick={() => setTildados(new Set())} className="text-xs text-zinc-500 hover:underline">Destildar</button>
          {ocupado === "lote" && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      )}

      {cargando ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : vista === "no_paso" ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <p className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">Cobros y pagos cargados en el CRM del período que ya cubre el banco, que no aparecen en el extracto: puede ser un pago doble, la cuenta equivocada, que falte subir un archivo o que no pase por el BBVA (eso se marca y sale de acá).</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {noPaso.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{formatDate(m.fecha)}</td>
                  <td className="px-3 py-1.5">{m.texto}</td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono ${m.importe < 0 ? "text-zinc-900 dark:text-zinc-100" : "text-emerald-700 dark:text-emerald-400"}`}>{formatCurrency(m.importe)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                    {noPasaNota?.id === m.id ? (
                      <span className="flex items-center justify-end gap-1">
                        <input autoFocus value={noPasaNota.nota} onChange={(e) => setNoPasaNota({ ...noPasaNota, nota: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void noPasaPorBanco(m.id, true, noPasaNota.nota); }}
                          placeholder="Por dónde pasó (ej. Banco Nación)" className="h-7 w-52 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                        <button disabled={ocupado !== null} onClick={() => void noPasaPorBanco(m.id, true, noPasaNota.nota)} className="rounded-md bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{ocupado === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Listo"}</button>
                        <button onClick={() => setNoPasaNota(null)} className="text-zinc-500 hover:underline">Cancelar</button>
                      </span>
                    ) : <button disabled={ocupado !== null} onClick={() => setNoPasaNota({ id: m.id, nota: "" })} className={boton}>No pasa por el BBVA</button>}
                  </td>
                </tr>
              ))}
              {!noPaso.length && <tr><td className="px-3 py-3 text-zinc-500">Todo lo cargado pasó por el banco (o está marcado).</td></tr>}
            </tbody>
          </table>
          {noPasaMarcados.length > 0 && (
            <div className="border-t border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800">
              <button onClick={() => setVerMarcados(!verMarcados)} className="text-zinc-500 hover:underline">{verMarcados ? "Ocultar" : "Ver"} los marcados «No pasa por el BBVA» ({noPasaMarcados.length})</button>
              {verMarcados && (
                <ul className="mt-1 space-y-1">
                  {noPasaMarcados.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 text-zinc-500">
                      <span>{formatDate(m.fecha)}</span><span>{m.texto}</span><span className="font-mono">{formatCurrency(m.importe)}</span>{m.nota && <span>· {m.nota}</span>}
                      <button disabled={ocupado !== null} onClick={() => void noPasaPorBanco(m.id, false)} className={boton}>{ocupado === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Volver"}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/50">
              <tr>
                <th className="w-8 px-3 py-2">{tildables.length > 0 && <input type="checkbox" aria-label="Tildar todas las de la lista" className="h-4 w-4 accent-orange-500"
                  checked={tildables.every((f) => tildados.has(f.linea.id))} onChange={(e) => setTildados(e.target.checked ? new Set(tildables.slice(0, 400).map((f) => f.linea.id)) : new Set())} />}</th>
                <th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Cuenta</th><th className="px-2 py-2">Detalle del banco</th><th className="px-2 py-2 text-right">Importe</th><th className="px-2 py-2">Qué es</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visibles.slice(0, 400).map((f) => {
                const codigo = nombreCodigoBanco(codigoDeConcepto(f.linea.descripcion));
                const sin = f.estado === "sin_cruzar";
                return [
                  <tr key={f.linea.id} className={`align-top ${tildados.has(f.linea.id) ? "bg-orange-50/60 dark:bg-orange-950/20" : ""}`}>
                    <td className="px-3 py-1.5">{sin && <input type="checkbox" aria-label="Tildar" className="h-4 w-4 accent-orange-500" checked={tildados.has(f.linea.id)} onChange={(e) => tildar(f.linea.id, e.target.checked)} />}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-zinc-500">{formatDate(f.linea.fecha)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-zinc-500">{(cuentas.get(f.linea.cuenta_id) || "").replace(/^BBVA /, "")}</td>
                    <td className="px-2 py-1.5">
                      {f.detalle}{codigo && <span className="ml-1 text-[10px] text-zinc-400">· {codigo}</span>}
                      {f.pestana === "debitos_automaticos" && detalleDebitoAutomatico(f.linea.nota) && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{detalleDebitoAutomatico(f.linea.nota)}</span>}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono ${f.importe < 0 ? "text-zinc-900 dark:text-zinc-100" : "text-emerald-700 dark:text-emerald-400"}`}>{formatCurrency(f.importe)}</td>
                    <td className="px-2 py-1.5">
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
                      ) : sin && f.sugerencia ? (
                        <span className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
                          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            Parece: {f.sugerencia.texto} <span className="text-xs text-zinc-500">({f.sugerencia.decision.motivo})</span>
                            <span className="ml-2 inline-flex gap-2 whitespace-nowrap text-xs">
                              <button disabled={ocupado !== null} onClick={() => void asociar([f.linea.id])} className="rounded-md bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{ocupado === f.linea.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Asociar"}</button>
                              <button disabled={ocupado !== null} onClick={() => void noEs(f)} className={boton}>No es</button>
                            </span>
                          </span>
                        </span>
                      ) : sin && f.facturas.length > 0 ? (
                        <span className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
                          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {f.facturas.map((s) => {
                              const ret = s.retenciones.reduce((t, r) => t + r.monto, 0);
                              return (
                                <span key={s.factura.id} className="block">
                                  Parece: {s.factura.numero} de {s.factura.cliente} (saldo {formatCurrency(s.factura.saldo)}
                                  {ret > 0 && <> − retenciones {formatCurrency(ret)}: {s.retenciones.map((r) => NOMBRE_RETENCION[r.tipo]).join(", ")}</>})
                                  {" "}<span className="text-xs text-zinc-500">({ret > 0 ? "como el último cobro de este cliente; faltan los certificados" : "saldo exacto"})</span>
                                  <button disabled={ocupado !== null} onClick={() => abrirCobrarFactura(f, s)} title="Abre la ventana de cobro con esta factura y lo que entró al banco: revisás y guardás ahí"
                                    className="ml-2 whitespace-nowrap rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Cobrar</button>
                                </span>
                              );
                            })}
                            <span className="block text-xs text-zinc-500">No está el cobro en el CRM.</span>
                          </span>
                        </span>
                      ) : (
                        <span className="flex items-start gap-1.5 text-zinc-700 dark:text-zinc-300">
                          {f.estado === "cruzada" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : f.estado === "del_banco" ? <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" /> : f.estado === "explicada" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                          <span className={sin ? "text-zinc-500" : ""}>{sin ? `Sin asociar · ${f.conQue}` : f.conQue}{f.revisada && <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Revisada</span>}</span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                      <span className="inline-flex flex-wrap justify-end gap-x-2.5 gap-y-1">
                        {f.porMotor && (
                          <button disabled={ocupado !== null} onClick={() => void desatar(f.linea.id, null)} title="La deja sin asociar; no se vuelve a sugerir" className={boton}>
                            {ocupado === f.linea.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Desatar"}
                          </button>
                        )}
                        {sin && otraCosa?.id !== f.linea.id && (<>
                          <button disabled={ocupado !== null} onClick={() => setElegir(elegir?.id === f.linea.id ? null : { id: f.linea.id, ids: new Set(), buscar: "" })} className={boton}>Elegir…</button>
                          <button disabled={ocupado !== null} onClick={() => abrirCargar(f)} className={boton}>{f.importe > 0 ? "Cargar cobro" : "Cargar pago"}</button>
                          <button disabled={ocupado !== null} onClick={() => setOtraCosa({ id: f.linea.id, que: "otro", nota: "" })} className={boton}>Es otra cosa…</button>
                          <button disabled={ocupado !== null} onClick={() => void marcarRevisada([f.linea.id], !f.revisada)} className={boton}>{f.revisada ? "Volver a revisar" : "Revisada"}</button>
                        </>)}
                      </span>
                    </td>
                  </tr>,
                  elegir?.id === f.linea.id && (
                    <tr key={`${f.linea.id}-elegir`} className="bg-zinc-50 dark:bg-zinc-800/40">
                      <td />
                      <td colSpan={6} className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-zinc-500">{f.importe > 0 ? "Cobros" : "Pagos, OP y gastos"} cargados sin línea del banco (hasta 30 días), primero los de importe más parecido:</span>
                          <input autoFocus value={elegir.buscar} onChange={(e) => setElegir({ ...elegir, buscar: e.target.value })} placeholder="Buscar" className="h-7 w-48 rounded-md border border-zinc-200 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900" />
                        </div>
                        <ul className="mt-1.5 max-h-56 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
                          {candidatos.map((m) => (
                            <li key={m.id}>
                              <label className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                                <input type="checkbox" className="h-4 w-4 accent-orange-500" checked={elegir.ids.has(m.id)}
                                  onChange={(e) => { const ids = new Set(elegir.ids); if (e.target.checked) ids.add(m.id); else ids.delete(m.id); setElegir({ ...elegir, ids }); }} />
                                <span className="w-20 shrink-0 text-zinc-500">{formatDate(m.fecha)}</span>
                                <span className="flex-1">{m.texto}</span>
                                <span className={`font-mono ${Math.abs(m.monto - Math.abs(f.importe)) < 0.005 ? "font-semibold text-emerald-700 dark:text-emerald-400" : ""}`}>{formatCurrency(m.monto)}</span>
                              </label>
                            </li>
                          ))}
                          {!candidatos.length && <li className="px-2 py-2 text-zinc-500">No hay {f.importe > 0 ? "cobros" : "pagos"} cargados sin línea del banco cerca de esa fecha. Usá «{f.importe > 0 ? "Cargar cobro" : "Cargar pago"}».</li>}
                        </ul>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          {elegir.ids.size > 0 && (Math.abs(sumaElegidos - Math.abs(f.importe)) < 0.005
                            ? <span className="text-emerald-700 dark:text-emerald-400">Suma igual a la línea.</span>
                            : <span className="text-amber-700 dark:text-amber-300">Suman {formatCurrency(sumaElegidos)}: diferencia {formatCurrency(sumaElegidos - Math.abs(f.importe))}. Se asocia igual.</span>)}
                          <button disabled={!elegir.ids.size || ocupado !== null} onClick={() => void asociarElegidos()} className="rounded-md bg-emerald-600 px-2.5 py-0.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{ocupado === f.linea.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Asociar"}</button>
                          <button onClick={() => setElegir(null)} className="text-zinc-500 hover:underline">Cancelar</button>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
              {!visibles.length && <tr><td colSpan={7} className="px-3 py-3 text-zinc-500">{vista === "revisar" ? "Nada para revisar con este filtro." : "No hay líneas con este filtro."}</td></tr>}
            </tbody>
          </table>
          {visibles.length > 400 && <p className="px-3 py-2 text-xs text-zinc-500">Se muestran las 400 más nuevas de {visibles.length}: usá el buscador o elegí un mes.</p>}
        </div>
      )}

      {cargarDesde?.tipo === "cobro" && lineaCargar && cargarDesde.factura && (
        <CobrarCliente sociedadId={sociedadId} clienteId={cargarDesde.factura.clienteId} clienteNombre={cargarDesde.factura.nombre}
          preseleccion={[cargarDesde.factura.facturaId]} directo medioInicial={lineaCargar}
          retencionesIniciales={cargarDesde.factura.retenciones.map((r) => ({ tipo: r.tipo, monto: r.monto, observaciones: "Estimada desde Bancos (como el último cobro del cliente)" }))}
          onClose={() => setCargarDesde(null)} onCobrado={() => { const id = cargarDesde.linea.id; setCargarDesde(null); void procesar(id); }} />
      )}
      {cargarDesde?.tipo === "cobro" && lineaCargar && !cargarDesde.factura && (
        <CobrarCliente sociedadId={sociedadId} medioInicial={lineaCargar} sugerido={cargarDesde.sugerido}
          onClose={() => setCargarDesde(null)} onCobrado={() => { const id = cargarDesde.linea.id; setCargarDesde(null); void procesar(id); }} />
      )}
      {cargarDesde?.tipo === "pago" && lineaCargar && (
        <PagarProveedor sociedadId={sociedadId} pagoInicial={lineaCargar} proveedorSugerido={cargarDesde.sugerido}
          onClose={() => setCargarDesde(null)} onPagado={() => { const id = cargarDesde.linea.id; setCargarDesde(null); void procesar(id); }} />
      )}
    </div>
  );
}
