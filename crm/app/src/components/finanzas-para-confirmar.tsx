"use client";

// Finanzas > Hoy > Para confirmar (Finanzas con IA, Etapa A — docs/FINANZAS-IA.md, 16/10/2026).
// Subís el extracto y el sistema deja armado qué es cada línea del banco: cobros completos (facturas + retenciones),
// pagos de gastos ya cargados, impuestos y gastos del banco, cheques, pases entre cuentas. Lo que ninguna regla reconoce
// se lo pregunta a la IA. Una persona confirma con un clic (o "Confirmar los seguros" en bloque). Todo queda en el Registro.
// Nunca traba: lo que no cierra avisa en ámbar y se puede confirmar igual, corregir o descartar.
// La lógica está en lib/finanzas-propuestas.ts (prueba: scripts/test-finanzas-propuestas.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate } from "@/lib/utils";
import { montoCuentaDeOp } from "@/lib/saldo-cuentas";
import { repartirCobro, facturasParaRegistrar } from "@/lib/cobro-reparto";
import {
  armarBandeja, lineasParaIA, resumenBandeja,
  type ItemBandeja, type FacturaBandeja, type Tercero, type PagoMail, type GastoSinPago, type SugerenciaIA, type Confianza,
} from "@/lib/finanzas-propuestas";
import { CLASIFICACION_LABEL, type ClasificacionLinea, type MovCruce, type ChequeCruce, type ReglaCruce } from "@/lib/extracto-bbva";
import { notaLiteral, notaCobro, armarCobroSistemaAnterior, pesos, RETENCION_LABEL, type RetencionNota } from "@/lib/finanzas-notas";
import { leerResumenBbva, cruzarResumen, textoContraparte, type Contraparte } from "@/lib/resumen-bbva";
import { leerArcaRecibidos, facturaDelPago, numeroFactura } from "@/lib/arca-recibidos";
import { gastosFijosParaDebito, cuitEnTexto } from "@/lib/finanzas-propuestas";
import { leerArchivoExtracto, guardarArchivoExtracto, type CuentaRow, type ArchivoPreview } from "@/components/extracto-bbva";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, History, Loader2, Sparkles, Upload, X } from "lucide-react";

interface LineaRow {
  id: string; cuenta_id: string; fecha: string; descripcion: string; monto: number; tipo: "credito" | "debito";
  estado: string; clave: string | null; clasificacion: ClasificacionLinea | null; cheque_id: string | null; match_movimiento_id: string | null;
  /** A quién fue / de quién vino (resumen PDF del BBVA o ARCA). Falta si no se corrió la migración 20261016180000. */
  contraparte?: Contraparte | null;
}
interface MovRow extends MovCruce { orden_pago_id?: string | null }
interface RegistroRow { id: number; created_at: string; accion: string; tipo: string | null; origen: string | null; confianza: string | null; resumen: string | null; usuario_id: string | null; resultado: any }

const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));
const importeDe = (l: Pick<LineaRow, "monto" | "tipo">) => (l.tipo === "credito" ? 1 : -1) * Number(l.monto || 0);
const CLASES_REGLA: ClasificacionLinea[] = ["impuesto", "gasto_bancario", "intereses", "fci", "entre_cuentas", "tarjeta", "personal", "otro"];
const CONF: Record<Confianza, { label: string; clase: string }> = {
  alta: { label: "Seguro", clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  media: { label: "Revisar", clase: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  baja: { label: "Sin resolver", clase: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

/**
 * `simple` (23/10/2026, Bancos > Extracto de Finanzas Lazza): la misma bandeja y la misma lógica, con menos pantalla:
 * tres números arriba, una sola lista "Para vos", los impuestos y comisiones del banco juntos en una fila y el registro como link.
 */
export default function FinanzasParaConfirmar({ onIrATab, simple = false }: { onIrATab?: (tab: string) => void; simple?: boolean }) {
  const { sociedadActiva, profile } = useUser() as any;
  const sociedadId: string | undefined = sociedadActiva?.id;
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [cuentas, setCuentas] = useState<CuentaRow[]>([]);
  const [lineas, setLineas] = useState<LineaRow[]>([]);
  const [datos, setDatos] = useState<{
    movimientos: MovRow[]; cheques: ChequeCruce[]; reglas: ReglaCruce[]; facturas: FacturaBandeja[]; clientes: Tercero[]; proveedores: Tercero[];
    pagosMail: PagoMail[]; gastos: GastoSinPago[]; gastosFijos: { descripcion: string; monto: number; moneda: string; cuit: string | null }[];
    gastosFijosDebito: { id: string; descripcion: string; categoria: string; referencias: string[] }[];
    facturasCompra: { proveedor_id: string | null; punto_venta: number; numero: number; estado: string }[];
  } | null>(null);
  const [ia, setIa] = useState<Map<string, SugerenciaIA>>(new Map());
  const [descartadas, setDescartadas] = useState<Set<string>>(new Set());
  const [registro, setRegistro] = useState<RegistroRow[]>([]);
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());
  const [iaTrabajando, setIaTrabajando] = useState(false);
  const [iaError, setIaError] = useState<string | null>(null);
  const iaPedidas = useRef<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [archivos, setArchivos] = useState<ArchivoPreview[]>([]);
  const [verRegistro, setVerRegistro] = useState(false);
  const [verResueltas, setVerResueltas] = useState(false);
  const [verRuido, setVerRuido] = useState(false);
  const [filtroRegistro, setFiltroRegistro] = useState("");
  const [abiertos, setAbiertos] = useState<Record<Confianza, boolean>>(simple ? { alta: false, media: true, baja: true } : { alta: true, media: true, baja: false });
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [correccion, setCorreccion] = useState<{ clasificacion: ClasificacionLinea | ""; nota: string; recordar: boolean }>({ clasificacion: "", nota: "", recordar: true });
  const [arrastrando, setArrastrando] = useState(false);
  /** Formulario "Cobro de factura del sistema anterior" (facturas que no están en el CRM) abierto en un renglón. */
  const [anterior, setAnterior] = useState<{ linea_id: string; cliente: string; facturas: string; bruto: string; referencia: string; rets: { tipo: string; monto: string; certificado: string }[] } | null>(null);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setCargando(true);
    setError(null);
    const db = supabase as any;
    try {
      const { data: cs, error: e1 } = await db.from("cuentas_financieras").select("id, nombre, tipo, numero, moneda, fecha_corte, activa, saldo_banco, saldo_banco_fecha").eq("sociedad_id", sociedadId).order("orden");
      if (e1) throw e1;
      const lista = (cs || []) as CuentaRow[];
      const ids = lista.map((c) => c.id);
      const corte = lista.map((c) => c.fecha_corte).sort()[0] || "2026-08-31";
      const desde = new Date(`${corte}T12:00:00Z`);
      desde.setUTCDate(desde.getUTCDate() - 10);
      const desdeMovs = desde.toISOString().slice(0, 10);

      const [ls, movs, chs, rg, cli, prov, fs, ap, mails, gm, gf, props, reg] = await Promise.all([
        ids.length ? traerTodo<LineaRow>(() => db.from("extracto_movimientos")
          .select("id, cuenta_id, fecha, descripcion, monto, tipo, estado, clave, clasificacion, cheque_id, match_movimiento_id, contraparte")
          .in("cuenta_id", ids).order("fecha").order("id"))
          // Sin la migración 20261016180000 (columna contraparte) sigue igual que antes.
          .catch(() => traerTodo<LineaRow>(() => db.from("extracto_movimientos")
            .select("id, cuenta_id, fecha, descripcion, monto, tipo, estado, clave, clasificacion, cheque_id, match_movimiento_id")
            .in("cuenta_id", ids).order("fecha").order("id"))) : Promise.resolve([]),
        traerTodo<MovRow>(() => db.from("movimientos")
          .select("id, fecha, monto, moneda, tipo, cliente_id, proveedor_id, anulado, descripcion, nota_credito_compra_id, ajuste_sentido, orden_pago_id")
          .eq("sociedad_id", sociedadId).gte("fecha", desdeMovs).order("fecha").order("id")),
        traerTodo<ChequeCruce>(() => db.from("echeqs").select("id, numero, monto, direccion, estado, fecha_pago, tipo_cheque, destino_nombre, origen_nombre").eq("sociedad_id", sociedadId).order("id")),
        db.from("extracto_reglas").select("texto, sentido, clasificacion, subtipo, contra_cuenta_id, nota").eq("sociedad_id", sociedadId).eq("activa", true),
        traerTodo<Tercero>(() => db.from("clientes").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
        traerTodo<Tercero>(() => db.from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
        traerTodo<any>(() => db.from("facturas").select("id, tipo, punto_venta, numero, fecha, cliente_id, total, total_acreditado, moneda, tipo_cambio, estado, clientes(razon_social, cuit)")
          .eq("sociedad_id", sociedadId).in("estado", ["emitida", "parcial", "vencida", "pagada"]).gte("fecha", "2026-01-01").order("id")),
        traerTodo<{ factura_id: string; monto: number }>(() => db.from("cobro_aplicaciones").select("factura_id, monto, facturas!inner(sociedad_id)").eq("facturas.sociedad_id", sociedadId).order("id")).catch(() => []),
        db.from("agente_mail_procesados").select("id, fecha_mail, asunto, datos").eq("sociedad_id", sociedadId).eq("categoria", "pago_retencion").gte("fecha_mail", desdeMovs).limit(500),
        db.from("gastos_manuales").select("id, fecha, descripcion, monto, moneda, proveedores(cuit)").eq("sociedad_id", sociedadId).gte("fecha", desdeMovs).limit(1000),
        db.from("gastos_fijos").select("id, descripcion, categoria, notas, monto, moneda, activo, proveedores(cuit)").eq("sociedad_id", sociedadId).eq("activo", true),
        db.from("finanzas_propuestas").select("linea_id, origen, datos, confianza, estado").eq("sociedad_id", sociedadId),
        db.from("finanzas_registro").select("id, created_at, accion, tipo, origen, confianza, resumen, usuario_id, resultado").eq("sociedad_id", sociedadId).order("created_at", { ascending: false }).limit(300),
      ]);
      if (props.error || reg.error) {
        const msg = String(props.error?.message || reg.error?.message || "");
        if (/finanzas_propuestas|finanzas_registro|does not exist|schema cache/i.test(msg)) setFaltaMigracion(true);
        else throw props.error || reg.error;
      } else setFaltaMigracion(false);

      // Facturas de compra recientes (para no proponer pagar por ARCA una que ya está en Compras).
      const fcs = await traerTodo<{ proveedor_id: string | null; numero_factura: string | null; estado: string }>(() => db.from("facturas_compra")
        .select("id, proveedor_id, numero_factura, estado").eq("sociedad_id", sociedadId).gte("fecha", "2026-06-01").order("id")).catch(() => []);

      // Parte en transferencia de los pagos de OP mixtos (como en Extractos).
      const idsOp = [...new Set(movs.map((m) => m.orden_pago_id).filter(Boolean) as string[])];
      const parteOp = new Map<string, number | null>();
      for (let i = 0; i < idsOp.length; i += 150) {
        const { data: ops } = await db.from("ordenes_pago").select("id, medios_pago").eq("sociedad_id", sociedadId).in("id", idsOp.slice(i, i + 150));
        for (const op of ops || []) parteOp.set(op.id, montoCuentaDeOp(op.medios_pago));
      }
      const cuitCli = new Map(cli.map((c) => [c.id, c.cuit]));
      const cuitProv = new Map(prov.map((p) => [p.id, p.cuit]));
      const aplicado = new Map<string, number>();
      for (const a of ap) aplicado.set(a.factura_id, (aplicado.get(a.factura_id) || 0) + Number(a.monto || 0));
      const pagados = new Set((movs as any[]).filter((m) => !m.anulado).map((m) => m.gasto_manual_id).filter(Boolean));
      // Gastos sin pago: los que no tienen movimiento atado (se consulta aparte para no traer todos los movimientos viejos).
      const gastosIds = (gm.data || []).map((g: any) => g.id);
      const conPago = new Set<string>(pagados as Set<string>);
      for (let i = 0; i < gastosIds.length; i += 200) {
        const { data: mg } = await db.from("movimientos").select("gasto_manual_id").eq("sociedad_id", sociedadId).eq("anulado", false).in("gasto_manual_id", gastosIds.slice(i, i + 200));
        for (const m of mg || []) conPago.add(m.gasto_manual_id);
      }

      setCuentas(lista);
      setLineas(ls);
      setDatos({
        movimientos: movs.map((m) => ({
          ...m,
          cuit: (m.proveedor_id && cuitProv.get(m.proveedor_id)) || (m.cliente_id && cuitCli.get(m.cliente_id)) || null,
          montoCuenta: m.orden_pago_id && m.tipo === "pago" ? parteOp.get(m.orden_pago_id) ?? null : null,
        })),
        cheques: chs,
        reglas: (rg.data || []) as ReglaCruce[],
        facturas: fs.map((f: any) => ({
          id: f.id, tipo: f.tipo, punto_venta: f.punto_venta, numero: f.numero, fecha: String(f.fecha).slice(0, 10), cliente_id: f.cliente_id,
          cliente_nombre: f.clientes?.razon_social ?? null, cliente_cuit: f.clientes?.cuit ?? null,
          total: Number(f.total), moneda: f.moneda, tipo_cambio: f.tipo_cambio ? Number(f.tipo_cambio) : null, estado: f.estado,
          saldo: Math.max(0, Math.round((Number(f.total) - (aplicado.get(f.id) || 0) - Number(f.total_acreditado || 0)) * 100) / 100),
        })),
        clientes: cli,
        proveedores: prov,
        pagosMail: ((mails.data || []) as any[]).filter((m) => m.datos?.pago).map((m) => ({ id: m.id, fecha_mail: m.fecha_mail ? String(m.fecha_mail).slice(0, 10) : null, asunto: m.asunto, pago: m.datos.pago })),
        gastos: ((gm.data || []) as any[]).filter((g) => !conPago.has(g.id)).map((g) => ({
          id: g.id, fecha: String(g.fecha).slice(0, 10), descripcion: g.descripcion, monto: Number(g.monto), moneda: g.moneda || "ARS", proveedor_cuit: g.proveedores?.cuit ?? null,
        })),
        gastosFijos: ((gf.data || []) as any[]).map((g) => ({ descripcion: g.descripcion, monto: Number(g.monto), moneda: g.moneda || "ARS", cuit: g.proveedores?.cuit ?? null })),
        gastosFijosDebito: gastosFijosParaDebito(((gf.data || []) as any[]).map((g) => ({ id: g.id, descripcion: g.descripcion, categoria: g.categoria || "", notas: g.notas }))),
        facturasCompra: fcs.map((f) => {
          const m = String(f.numero_factura || "").match(/(\d+)\D+(\d+)\s*$/);
          return { proveedor_id: f.proveedor_id, punto_venta: m ? Number(m[1]) : 0, numero: m ? Number(m[2]) : 0, estado: f.estado };
        }),
      });
      const mapaIa = new Map<string, SugerenciaIA>();
      const desc = new Set<string>();
      for (const p of (props.data || []) as any[]) {
        if (p.estado === "descartada") desc.add(p.linea_id);
        else if (p.origen === "ia" && p.datos?.clasificacion) mapaIa.set(p.linea_id, { ...p.datos, confianza: p.confianza });
      }
      setIa(mapaIa);
      setDescartadas(desc);
      setRegistro((reg.data || []) as RegistroRow[]);
      const usuarios = [...new Set(((reg.data || []) as RegistroRow[]).map((r) => r.usuario_id).filter(Boolean))] as string[];
      if (usuarios.length) {
        const { data: ps } = await db.from("profiles").select("id, full_name, email").in("id", usuarios);
        setNombres(new Map((ps || []).map((p: any) => [p.id, p.full_name || p.email])));
      }
    } catch (e) {
      setError(errorTexto(e) || "No se pudo leer la bandeja.");
    } finally {
      setCargando(false);
    }
  }, [sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const pendientes = useMemo(() => lineas.filter((l) => l.estado === "pendiente"), [lineas]);
  const cuentaNombre = useMemo(() => new Map(cuentas.map((c) => [c.id, c.nombre])), [cuentas]);

  const items = useMemo<ItemBandeja[]>(() => {
    if (!datos) return [];
    const yaCruzados = new Set(lineas.map((l) => l.match_movimiento_id).filter(Boolean) as string[]);
    const usados = new Set(lineas.filter((l) => l.cheque_id && l.clasificacion).map((l) => `${l.clasificacion}:${l.cheque_id}`));
    return armarBandeja({
      // El concepto suma lo que dice el resumen del banco (nombre y CUIT de la otra parte): así lo reconocen proveedor, cliente y reglas.
      lineas: pendientes.map((l) => {
        const extra = textoContraparte(l.contraparte);
        return { id: l.id, fecha: String(l.fecha).slice(0, 10), concepto: extra ? `${l.descripcion} · ${extra}` : l.descripcion, importe: importeDe(l), cuenta_id: l.cuenta_id, clasificacion: l.clasificacion, factura_arca: l.contraparte?.factura ?? null };
      }),
      movimientos: datos.movimientos.filter((m) => !m.anulado && !yaCruzados.has(m.id)),
      cheques: datos.cheques, cuentas, reglas: datos.reglas, chequesUsados: usados,
      facturas: datos.facturas, clientes: datos.clientes, proveedores: datos.proveedores,
      pagosMail: datos.pagosMail, gastos: datos.gastos, ia, descartadas,
      gastosFijosDebito: datos.gastosFijosDebito, facturasCompra: datos.facturasCompra,
    });
  }, [datos, lineas, pendientes, cuentas, ia, descartadas]);

  const resumen = useMemo(() => resumenBandeja(items), [items]);
  const porConfianza = useMemo(() => ({
    alta: items.filter((i) => i.confianza === "alta" && i.tipo !== "sin_resolver"),
    media: items.filter((i) => i.confianza === "media" && i.tipo !== "sin_resolver"),
    baja: items.filter((i) => i.confianza === "baja" || i.tipo === "sin_resolver"),
  }), [items]);
  /** Cobros y pagos marcados "a cargar" (ya confirmados, falta el comprobante en el CRM). */
  const aCargar = useMemo(() => {
    const enBandeja = new Set(items.map((i) => i.linea_id));
    return lineas.filter((l) => l.estado === "pendiente" && (l.clasificacion === "cobro" || l.clasificacion === "pago") && !enBandeja.has(l.id));
  }, [lineas, items]);

  // ─── IA: clasifica lo que ninguna regla reconoce (una vez por línea; queda guardado) ──────────────
  const preguntarIA = useCallback(async (lista: ItemBandeja[]) => {
    if (!sociedadId || !datos || faltaMigracion) return;
    const nuevas = lista.filter((i) => !iaPedidas.current.has(i.linea_id)).slice(0, 200);
    if (!nuevas.length) return;
    nuevas.forEach((i) => iaPedidas.current.add(i.linea_id));
    setIaTrabajando(true);
    setIaError(null);
    try {
      const cuits = new Set(nuevas.map((i) => (i.concepto.match(/\b((?:20|23|24|27|30|33|34)\d{9})\b/) || [])[1]).filter(Boolean) as string[]);
      // De a 25 líneas y 4 pedidos a la vez: respuestas cortas y rápidas.
      const tandas: ItemBandeja[][] = [];
      for (let k = 0; k < nuevas.length; k += 25) tandas.push(nuevas.slice(k, k + 25));
      const pedir = (tanda: ItemBandeja[]) => fetch("/api/finanzas/clasificar-lineas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineas: tanda.map((i) => ({ id: i.linea_id, fecha: i.fecha, concepto: i.concepto, importe: i.importe, cuenta: i.cuenta_id ? cuentaNombre.get(i.cuenta_id) : undefined })),
          contexto: {
            empresa: sociedadActiva?.nombre,
            cuentas: cuentas.filter((c) => c.activa).map((c) => ({ nombre: c.nombre, tipo: c.tipo, numero: c.numero })),
            gastosFijos: datos.gastosFijos,
            proveedores: datos.proveedores.filter((p) => cuits.has(String(p.cuit || "").replace(/\D/g, ""))).map((p) => ({ cuit: p.cuit, nombre: p.razon_social })),
            clientes: datos.clientes.filter((p) => cuits.has(String(p.cuit || "").replace(/\D/g, ""))).map((p) => ({ cuit: p.cuit, nombre: p.razon_social })),
            reglas: datos.reglas,
          },
        }),
      }).then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "La IA no respondió");
        return j as { lineas?: (SugerenciaIA & { id: string })[]; modelo?: string };
      });
      const respuestas: { lineas?: (SugerenciaIA & { id: string })[]; modelo?: string }[] = [];
      const fallas: string[] = [];
      for (let k = 0; k < tandas.length; k += 4) {
        const r = await Promise.allSettled(tandas.slice(k, k + 4).map(pedir));
        for (const x of r) {
          if (x.status === "fulfilled") respuestas.push(x.value);
          else fallas.push(errorTexto(x.reason));
        }
      }
      if (fallas.length) setIaError(`${fallas.length} de ${tandas.length} tandas sin respuesta (${fallas[0]})`);
      const json = { modelo: respuestas.find((r) => r.modelo)?.modelo };
      const filas = respuestas.flatMap((r) => r.lineas || []);
      if (filas.length) {
        const { error: e } = await (supabase as any).from("finanzas_propuestas").upsert(filas.map((f) => ({
          sociedad_id: sociedadId, linea_id: f.id, origen: "ia", confianza: f.confianza || "baja", modelo: json.modelo || null,
          datos: { clasificacion: f.clasificacion, subtipo: f.subtipo, nota: f.nota, explicacion: f.explicacion },
        })), { onConflict: "linea_id,origen" });
        if (e) throw e;
        await (supabase as any).from("finanzas_registro").insert({
          sociedad_id: sociedadId, accion: "ia_sugirio", origen: "ia", usuario_id: profile?.id,
          resumen: `La IA clasificó ${filas.length} líneas del banco (${json.modelo || "IA"})`,
          propuesta: { lineas: filas },
        });
        setIa((prev) => {
          const m = new Map(prev);
          for (const f of filas) m.set(f.id, { clasificacion: f.clasificacion, subtipo: f.subtipo, nota: f.nota, explicacion: f.explicacion, confianza: f.confianza });
          return m;
        });
      }
    } catch (e) {
      setIaError(errorTexto(e));
    } finally {
      setIaTrabajando(false);
    }
  }, [sociedadId, datos, faltaMigracion, cuentas, cuentaNombre, sociedadActiva?.nombre, profile?.id]);

  const paraIA = useMemo(() => lineasParaIA(items, ia), [items, ia]);
  useEffect(() => {
    if (!cargando && paraIA.length && !iaTrabajando) void preguntarIA(paraIA);
  }, [cargando, paraIA, iaTrabajando, preguntarIA]);

  // ─── Acciones ──────────────────────────────────────────────────────────────
  async function anotar(item: ItemBandeja | null, accion: string, resultado: Record<string, unknown> = {}, resumenTexto?: string) {
    const { error: e } = await (supabase as any).from("finanzas_registro").insert({
      sociedad_id: sociedadId, linea_id: item?.linea_id ?? null, accion, usuario_id: profile?.id,
      tipo: item ? (item.cobro ? "cobro" : item.gasto ? "gasto" : item.cruce?.clasificacion || item.tipo) : null,
      origen: item?.origen ?? "persona", confianza: item?.confianza ?? null,
      resumen: resumenTexto || (item ? `${formatDate(item.fecha)} ${formatCurrency(item.importe)} · ${item.concepto} → ${item.titulo}` : accion),
      propuesta: item, resultado,
    });
    if (e) console.error("No se pudo anotar en el registro:", e);
  }

  /** Nota literal del renglón (impuesto, retención, IVA, cheque, pago…) para el informe de fin de mes. */
  function notaDe(i: ItemBandeja, clasificacion?: ClasificacionLinea, notaPersona?: string | null): string {
    const c = i.cruce;
    const ch = c?.cheque_id ? (datos?.cheques.find((x) => x.id === c.cheque_id) as (ChequeCruce & { destino_nombre?: string | null; origen_nombre?: string | null }) | undefined) : undefined;
    return notaLiteral({
      fecha: i.fecha, concepto: i.concepto, importe: i.importe,
      clasificacion: clasificacion || c?.clasificacion || "otro",
      subtipo: clasificacion ? null : c?.subtipo,
      contraCuenta: c?.contra_cuenta_id ? cuentaNombre.get(c.contra_cuenta_id) || null : null,
      cheque: ch ? { numero: ch.numero, destino_nombre: ch.destino_nombre, origen_nombre: ch.origen_nombre } : null,
      movimiento: c?.movimiento_id ? datos?.movimientos.find((m) => m.id === c.movimiento_id)?.descripcion || null : null,
      nota: notaPersona !== undefined ? notaPersona : c?.nota,
    });
  }

  async function aplicarCruces(cruces: Record<string, unknown>[]) {
    for (let i = 0; i < cruces.length; i += 150) {
      const { error: e } = await (supabase as any).rpc("aplicar_cruces_extracto", { p_sociedad_id: sociedadId, p_cruces: cruces.slice(i, i + 150) });
      if (e) throw e;
    }
  }

  async function aprenderRegla(item: ItemBandeja, clasificacion: ClasificacionLinea, subtipo: string | null, texto: string | null) {
    if (!texto || !CLASES_REGLA.includes(clasificacion) || !datos) return;
    if (datos.reglas.some((r) => r.texto.trim().toUpperCase() === texto.trim().toUpperCase())) return;
    const sentido = item.importe > 0 ? "credito" : "debito";
    const { error: e } = await (supabase as any).from("extracto_reglas").insert({ sociedad_id: sociedadId, texto, sentido, clasificacion, subtipo, nota: "Aprendida en Para confirmar" });
    if (!e) {
      datos.reglas.push({ texto, sentido, clasificacion, subtipo });
      await anotar(item, "regla_creada", { texto, clasificacion, subtipo }, `Regla nueva: "${texto}" → ${CLASIFICACION_LABEL[clasificacion]}`);
    }
  }

  /** Confirma un renglón tal como lo propuso el sistema. Devuelve true si quedó guardado. */
  async function confirmarUno(item: ItemBandeja): Promise<boolean> {
    if (!sociedadId) return false;
    if (item.cobro) {
      const c = item.cobro;
      const tc = c.tipo_cambio ? { tipo_cambio: c.tipo_cambio } : {};
      const totalPesos = c.neto + c.retenciones.reduce((s, r) => s + r.monto, 0);
      const aplicadoMonedaFactura = c.tipo_cambio ? totalPesos / c.tipo_cambio : totalPesos;
      const reparto = repartirCobro(c.facturas.map((f) => ({ id: f.id, numero: f.numero, fecha: f.fecha, saldo: f.saldo })), aplicadoMonedaFactura);
      const ref = [c.referencia ? `Ref: ${c.referencia}` : "", `Banco ${formatDate(item.fecha)}`, c.tipo_cambio ? `TC: ${c.tipo_cambio.toFixed(2)}` : ""].filter(Boolean).join(" | ");
      const { data, error: e } = await (supabase as any).rpc("registrar_cobro_masivo_seguro", {
        p_cliente_id: c.cliente_id,
        p_facturas: facturasParaRegistrar(reparto),
        p_medios: [{ tipo: "transferencia", monto: c.neto, ...tc, descripcion: `Cobro — ${c.cliente_nombre} — ${ref} (Para confirmar)` }],
        p_retenciones: c.retenciones.map((r) => ({ tipo: r.tipo, monto: r.monto, ...tc, descripcion: `${r.descripcion} — ${c.cliente_nombre}${c.referencia ? ` | Ref: ${c.referencia}` : ""}` })),
        p_fecha: item.fecha,
        p_sociedad_id: sociedadId,
        // Una línea del banco = un cobro: si se aprieta dos veces, la base no lo carga de nuevo.
        p_request_key: item.linea_id,
      });
      if (e) throw e;
      const ids: string[] = data?.inserted_ids || data?.resultado?.inserted_ids || [];
      // La base inserta primero las retenciones y después la transferencia: se cruza el banco con la transferencia.
      let movId: string | null = null;
      if (ids.length) {
        const { data: mv } = await (supabase as any).from("movimientos").select("id, tipo").in("id", ids);
        movId = ((mv || []) as { id: string; tipo: string }[]).find((m) => m.tipo === "transferencia")?.id || null;
      }
      if (!movId) {
        const { data: mv } = await (supabase as any).from("movimientos").select("id").eq("sociedad_id", sociedadId).eq("cliente_id", c.cliente_id)
          .eq("tipo", "transferencia").eq("fecha", item.fecha).eq("anulado", false).order("created_at", { ascending: false }).limit(5);
        movId = (mv || [])[0]?.id || null;
      }
      const nota = notaCobro({
        cliente: c.cliente_nombre, facturas: c.facturas.map((f) => f.numero).join(" + "), neto: c.neto, tipoCambio: c.tipo_cambio,
        retenciones: c.retenciones.map((r) => ({ tipo: r.tipo, monto: r.monto, certificado: (r.descripcion.match(/cert(?:ificado)?\.?:?\s*([\w-]+)/i) || [])[1] || null })),
        referencia: c.referencia ? `Ref: ${c.referencia}` : null,
      });
      if (movId) await aplicarCruces([{ linea_id: item.linea_id, clasificacion: "cobro", movimiento_id: movId, nota }]);
      await anotar(item, "confirmada", { movimientos: ids, movimiento_cruzado: movId, facturas: c.facturas.map((f) => f.numero), nota });
      return true;
    }
    if (item.gastoFijo) {
      // Débito automático: se carga el gasto del mes (atado al gasto fijo) y se paga con la línea del banco.
      const g = item.gastoFijo;
      const mes = new Date(`${item.fecha}T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
      const { data: gm, error: e1 } = await (supabase as any).from("gastos_manuales").insert({
        sociedad_id: sociedadId, fecha: item.fecha, descripcion: `${g.descripcion} — ${mes}`, categoria: g.categoria || "Débitos automáticos", monto: Math.abs(item.importe), moneda: "ARS",
        notas: "Débito automático del banco (Para confirmar).", tipo_gasto: "Gasto fijo", medio_pago: "transferencia", tipo_recurrencia: "mensual", gasto_fijo_id: g.id, created_by: profile?.id,
      }).select("id").single();
      if (e1) throw e1;
      const { data, error: e2 } = await (supabase as any).rpc("pagar_gasto_desde_extracto", { p_sociedad_id: sociedadId, p_linea_id: item.linea_id, p_gasto_id: gm.id });
      if (e2) throw e2;
      if (data?.movimiento_id) await aplicarCruces([{ linea_id: item.linea_id, clasificacion: "pago", movimiento_id: data.movimiento_id, nota: `Débito automático: ${g.descripcion} — ${mes}: ${pesos(item.importe)}.` }]);
      await anotar(item, "confirmada", { gasto_id: gm.id, gasto_fijo_id: g.id, movimiento_id: data?.movimiento_id });
      return true;
    }
    if (item.pagoProveedor) {
      // Pago de una factura de ARCA que no está en Compras: queda el pago al proveedor con la factura en la descripción.
      const pp = item.pagoProveedor;
      const nro = numeroFactura(pp.factura);
      const desc = `Pago — ${pp.proveedor_nombre} — ${nro} del ${formatDate(pp.factura.fecha)} (factura de ARCA, no cargada en Compras)`;
      const { data: mv, error: e1 } = await (supabase as any).from("movimientos").insert({
        tipo: "pago", proveedor_id: pp.proveedor_id, descripcion: desc, monto: Math.abs(item.importe), moneda: "ARS", fecha: item.fecha,
        conciliado: false, sociedad_id: sociedadId, created_by: profile?.id, cuenta_id: item.cuenta_id,
      }).select("id").single();
      if (e1) throw e1;
      await aplicarCruces([{ linea_id: item.linea_id, clasificacion: "pago", movimiento_id: mv.id, nota: `Pago por transferencia: ${pesos(item.importe)} — ${pp.proveedor_nombre} (CUIT ${pp.factura.cuit}) — ${nro} del ${formatDate(pp.factura.fecha)} por ${pesos(pp.factura.total)} (ARCA).` }]);
      await anotar(item, "confirmada", { movimiento_id: mv.id, factura_arca: pp.factura });
      return true;
    }
    if (item.gasto) {
      const { data, error: e } = await (supabase as any).rpc("pagar_gasto_desde_extracto", { p_sociedad_id: sociedadId, p_linea_id: item.linea_id, p_gasto_id: item.gasto.id });
      if (e) throw e;
      if (data?.movimiento_id) {
        await aplicarCruces([{ linea_id: item.linea_id, clasificacion: "pago", movimiento_id: data.movimiento_id, nota: `Pago del gasto "${item.gasto.descripcion}" por transferencia: ${pesos(item.importe)}.` }]);
      }
      await anotar(item, "confirmada", { movimiento_id: data?.movimiento_id, gasto_id: item.gasto.id });
      return true;
    }
    if (item.cruce) {
      await aplicarCruces([{ linea_id: item.linea_id, ...item.cruce, nota: notaDe(item) }]);
      if (item.regla) await aprenderRegla(item, item.regla.clasificacion, item.regla.subtipo || null, item.regla.texto);
      if (item.origen === "ia") await (supabase as any).from("finanzas_propuestas").update({ estado: "confirmada", resuelto_por: profile?.id, resuelto_at: new Date().toISOString() }).eq("linea_id", item.linea_id).eq("origen", "ia");
      await anotar(item, "confirmada", { cruce: item.cruce });
      return true;
    }
    return false;
  }

  async function confirmar(lista: ItemBandeja[], preguntar: boolean) {
    const validos = lista.filter((i) => i.cobro || i.gasto || i.gastoFijo || i.pagoProveedor || i.cruce);
    if (!validos.length) return;
    if (preguntar) {
      const cobros = validos.filter((i) => i.cobro).length, gastos = validos.filter((i) => i.gasto).length;
      const texto = `Se van a confirmar ${validos.length} renglones${cobros ? ` (${cobros} cobros nuevos` : ""}${cobros && gastos ? `, ${gastos} pagos de gastos` : gastos ? ` (${gastos} pagos de gastos` : ""}${cobros || gastos ? ")" : ""}.\n\nTodo queda en el Registro y se puede deshacer desde Extractos.\n\n¿Seguimos?`;
      if (!confirm(texto)) return;
    }
    setOcupado(validos.length === 1 ? validos[0].linea_id : "bloque");
    setAviso(null);
    let ok = 0;
    const errores: string[] = [];
    // Los cruces simples van juntos (más rápido); cobros y gastos de a uno.
    const simples = validos.filter((i) => i.cruce && !i.cobro && !i.gasto && !i.gastoFijo && !i.pagoProveedor);
    const resto = validos.filter((i) => i.cobro || i.gasto || i.gastoFijo || i.pagoProveedor);
    try {
      if (simples.length) {
        await aplicarCruces(simples.map((i) => ({ linea_id: i.linea_id, ...i.cruce, nota: notaDe(i) })));
        for (const i of simples) {
          if (i.regla) await aprenderRegla(i, i.regla.clasificacion, i.regla.subtipo || null, i.regla.texto);
        }
        const ia = simples.filter((i) => i.origen === "ia").map((i) => i.linea_id);
        if (ia.length) await (supabase as any).from("finanzas_propuestas").update({ estado: "confirmada", resuelto_por: profile?.id, resuelto_at: new Date().toISOString() }).in("linea_id", ia).eq("origen", "ia");
        const { error: e } = await (supabase as any).from("finanzas_registro").insert(simples.map((i) => ({
          sociedad_id: sociedadId, linea_id: i.linea_id, accion: "confirmada", usuario_id: profile?.id, tipo: i.cruce?.clasificacion, origen: i.origen, confianza: i.confianza,
          resumen: `${formatDate(i.fecha)} ${formatCurrency(i.importe)} · ${i.concepto} → ${i.titulo}`, propuesta: i, resultado: { cruce: i.cruce },
        })));
        if (e) console.error("Registro:", e);
        ok += simples.length;
      }
    } catch (e) {
      errores.push(`Cruces: ${errorTexto(e)}`);
    }
    for (const i of resto) {
      try {
        if (await confirmarUno(i)) ok++;
      } catch (e) {
        errores.push(`${formatDate(i.fecha)} ${formatCurrency(i.importe)} (${i.titulo}): ${errorTexto(e)}`);
      }
    }
    setOcupado(null);
    setAviso(`${ok} confirmados.${errores.length ? `\n⚠️ ${errores.length} no se pudieron guardar:\n${errores.join("\n")}` : ""}`);
    await cargar();
  }

  async function descartar(item: ItemBandeja) {
    const motivo = prompt("¿Por qué lo descartás? (queda en el Registro; la línea sigue en Extractos para resolverla a mano)", "");
    if (motivo === null) return;
    setOcupado(item.linea_id);
    try {
      const { error: e } = await (supabase as any).from("finanzas_propuestas").upsert({
        sociedad_id: sociedadId, linea_id: item.linea_id, origen: "extracto", estado: "descartada", motivo: motivo || null,
        datos: { titulo: item.titulo }, confianza: item.confianza, resuelto_por: profile?.id, resuelto_at: new Date().toISOString(),
      }, { onConflict: "linea_id,origen" });
      if (e) throw e;
      await anotar(item, "descartada", { motivo });
      setDescartadas((s) => new Set([...s, item.linea_id]));
    } catch (e) {
      alert(`No se pudo descartar: ${errorTexto(e)}`);
    } finally {
      setOcupado(null);
    }
  }

  async function guardarCorreccion(item: ItemBandeja) {
    const c = correccion.clasificacion;
    if (!c) { alert("Elegí qué es."); return; }
    setOcupado(item.linea_id);
    try {
      await aplicarCruces([{ linea_id: item.linea_id, clasificacion: c, nota: notaDe(item, c, correccion.nota.trim() || null) }]);
      if (correccion.recordar) {
        const texto = (await import("@/lib/finanzas-propuestas")).textoParaRegla(item.concepto);
        await aprenderRegla(item, c, null, texto);
      }
      await anotar(item, "corregida", { clasificacion: c, nota: correccion.nota.trim() || null }, `${formatDate(item.fecha)} ${formatCurrency(item.importe)} · ${item.concepto} → corregido a ${CLASIFICACION_LABEL[c]}`);
      setCorrigiendo(null);
      await cargar();
    } catch (e) {
      alert(`No se pudo guardar: ${errorTexto(e)}`);
    } finally {
      setOcupado(null);
    }
  }

  // ─── Cobro de factura del sistema anterior ─────────────────────────────────
  const numeroAR = (s: string) => Number(String(s || "").replace(/\./g, "").replace(",", ".")) || 0;
  const clienteDeTexto = (t: string) => datos?.clientes.find((c) => `${c.razon_social}${c.cuit ? ` — ${c.cuit}` : ""}` === t.trim()) || null;
  function armarAnterior(i: ItemBandeja) {
    if (!anterior || anterior.linea_id !== i.linea_id) return null;
    const cli = clienteDeTexto(anterior.cliente);
    return armarCobroSistemaAnterior({
      linea: { fecha: i.fecha, importe: i.importe },
      cliente: { id: cli?.id || "", nombre: cli?.razon_social || "" },
      facturas: anterior.facturas, bruto: numeroAR(anterior.bruto), referencia: anterior.referencia,
      retenciones: anterior.rets.map((r): RetencionNota => ({ tipo: r.tipo, monto: numeroAR(r.monto), certificado: r.certificado.trim() || null })),
    });
  }

  async function guardarAnterior(i: ItemBandeja) {
    const a = armarAnterior(i);
    const cli = anterior ? clienteDeTexto(anterior.cliente) : null;
    if (!a || !cli) { alert("Elegí el cliente de la lista."); return; }
    if (a.errores.length) { alert(a.errores.join("\n")); return; }
    if (Math.abs(a.diferencia) >= 0.01 && !confirm(`No cierra por ${pesos(a.diferencia)}: bruto − retenciones no da lo que entró al banco.\n\n¿Guardarlo igual? (queda la diferencia anotada en la nota)`)) return;
    setOcupado(i.linea_id);
    try {
      const filas = a.movimientos.map((m, k) => ({
        tipo: m.tipo, cliente_id: cli.id, factura_id: null, descripcion: m.descripcion, monto: m.monto, moneda: "ARS", fecha: i.fecha,
        conciliado: false, created_by: profile?.id, sociedad_id: sociedadId, cuenta_id: k === 0 ? i.cuenta_id : null,
      }));
      const { data: ins, error: e } = await (supabase as any).from("movimientos").insert(filas).select("id, tipo");
      if (e) throw e;
      const tr = ((ins || []) as { id: string; tipo: string }[]).find((m) => m.tipo === "transferencia");
      if (!tr) throw new Error("No se pudo leer la transferencia recién cargada.");
      await aplicarCruces([{ linea_id: i.linea_id, clasificacion: "cobro", movimiento_id: tr.id, nota: a.nota }]);
      await anotar(i, "confirmada", { sistema_anterior: true, movimientos: (ins || []).map((m: any) => m.id), nota: a.nota }, `${formatDate(i.fecha)} ${formatCurrency(i.importe)} · cobro del sistema anterior → ${cli.razon_social} (${anterior?.facturas})`);
      setAnterior(null);
      await cargar();
    } catch (e) {
      alert(`No se pudo guardar: ${errorTexto(e)}`);
    } finally {
      setOcupado(null);
    }
  }

  // ─── Subir extracto (arrastrar o elegir) ───────────────────────────────────
  const clavesPorCuenta = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of lineas) if (l.clave) { if (!m.has(l.cuenta_id)) m.set(l.cuenta_id, new Set()); m.get(l.cuenta_id)!.add(l.clave); }
    return m;
  }, [lineas]);

  async function subir(files: FileList | File[] | null) {
    if (!files || !sociedadId) return;
    const lista = Array.from(files);
    if (!lista.length) return;
    setOcupado("subir");
    setAviso(null);
    const out: ArchivoPreview[] = [];
    const errores: string[] = [];
    const avisos: string[] = [];
    for (const f of lista) {
      try {
        if (/\.pdf$/i.test(f.name)) avisos.push(await subirResumenPdf(f));
        else if (/\.csv$/i.test(f.name)) avisos.push(await subirArcaRecibidos(f));
        else out.push(await leerArchivoExtracto(f, cuentas, clavesPorCuenta));
      } catch (e) { errores.push(`${f.name}: ${errorTexto(e)}`); }
    }
    setArchivos(out);
    setOcupado(null);
    if (avisos.length || errores.length) setAviso([...avisos, ...errores.map((e) => `⚠️ ${e}`)].join("\n"));
    if (avisos.length) await cargar();
  }

  /** Líneas sin cerrar con la cuenta en dígitos, para cruzar con el resumen o con ARCA. */
  const lineasParaDetalle = () => {
    const digitos = new Map(cuentas.map((c) => [c.id, String(c.numero || "").replace(/\D/g, "")]));
    return lineas.filter((l) => l.estado === "pendiente").map((l) => ({ id: l.id, fecha: String(l.fecha).slice(0, 10), importe: importeDe(l), cuentaDigitos: digitos.get(l.cuenta_id) || "" }));
  };

  async function guardarContrapartes(items: { linea_id: string; contraparte: Contraparte }[]) {
    for (let i = 0; i < items.length; i += 200) {
      const { error: e } = await (supabase as any).rpc("guardar_contrapartes_extracto", { p_sociedad_id: sociedadId, p_items: items.slice(i, i + 200) });
      if (e) {
        if (/guardar_contrapartes_extracto|contraparte|schema cache/i.test(String(e.message || ""))) throw new Error("Falta correr la migración 20261016180000_extracto_contraparte.sql en Supabase.");
        throw e;
      }
    }
  }

  /** Resumen PDF del BBVA: nombre y CUIT de cada transferencia, cobro y débito automático. */
  async function subirResumenPdf(f: File): Promise<string> {
    const pdfjs: any = await import("pdfjs-dist");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    let texto = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      texto += (tc.items as any[]).map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("") + "\n";
    }
    const r = leerResumenBbva(texto);
    if (!r.items.length) return `${f.name}: no encontré las secciones de transferencias ni débitos (¿es el resumen mensual del BBVA?).`;
    const cruces = cruzarResumen(r.items, lineasParaDetalle());
    await guardarContrapartes(cruces);
    await anotar(null, "resumen_cargado", { archivo: f.name, renglones: r.items.length, identificadas: cruces.length, hasta: r.hasta },
      `Resumen BBVA ${f.name} (al ${formatDate(r.hasta || "")}): ${r.items.length} renglones, ${cruces.length} líneas del banco identificadas`);
    return `✔ Resumen ${f.name}: ${r.items.length} transferencias y débitos leídos; ${cruces.length} líneas sin cerrar ahora tienen nombre y CUIT.`;
  }

  /** ARCA "Mis comprobantes recibidos": qué factura paga cada transferencia a un proveedor. */
  async function subirArcaRecibidos(f: File): Promise<string> {
    const buf = await f.arrayBuffer();
    let txt = new TextDecoder("utf-8").decode(buf);
    if (txt.includes("\uFFFD")) txt = new TextDecoder("latin1").decode(buf);
    const facturas = leerArcaRecibidos(txt);
    if (!facturas.length) return `${f.name}: no parece el CSV de ARCA "Mis comprobantes recibidos".`;
    const usadas = new Set<string>();
    const porId = new Map(lineas.map((l) => [l.id, l]));
    const items: { linea_id: string; contraparte: Contraparte }[] = [];
    for (const x of lineasParaDetalle().filter((l) => l.importe < 0).sort((a, b) => a.fecha.localeCompare(b.fecha))) {
      const l = porId.get(x.id)!;
      const cuit = l.contraparte?.cuit || cuitEnTexto(l.descripcion);
      if (!cuit) continue;
      const m = facturaDelPago(cuit, x.importe, x.fecha, facturas, usadas);
      if (!m) continue;
      items.push({ linea_id: x.id, contraparte: { fuente: l.contraparte?.fuente || "arca", factura: { tipo: m.factura.tipo, punto_venta: m.factura.punto_venta, numero: m.factura.numero, fecha: m.factura.fecha, total: m.factura.total, emisor: m.factura.emisor, cuit: m.factura.cuit, unica: m.unica } } });
    }
    await guardarContrapartes(items);
    // Facturas de proveedores del CRM que no están cargadas en Compras (aviso, no traba).
    const provPorCuit = new Map((datos?.proveedores || []).map((p) => [String(p.cuit || "").replace(/\D/g, ""), p.id]));
    const enCompras = new Set((datos?.facturasCompra || []).map((c) => `${c.proveedor_id}|${c.punto_venta}|${c.numero}`));
    const faltan = facturas.filter((x) => !x.esNC && provPorCuit.has(x.cuit) && !enCompras.has(`${provPorCuit.get(x.cuit)}|${x.punto_venta}|${x.numero}`));
    await anotar(null, "arca_cargado", { archivo: f.name, facturas: facturas.length, pagos_identificados: items.length, sin_cargar: faltan.length },
      `ARCA recibidos ${f.name}: ${facturas.length} facturas, ${items.length} pagos identificados, ${faltan.length} facturas de proveedores sin cargar en Compras`);
    return `✔ ARCA ${f.name}: ${facturas.length} facturas leídas; ${items.length} transferencias a proveedores tienen su factura.${faltan.length ? ` ${faltan.length} facturas de proveedores del CRM no están cargadas en Compras (ej. ${faltan.slice(0, 3).map((x) => `${x.emisor} ${numeroFactura(x)}`).join(", ")}).` : ""}`;
  }

  async function guardarArchivos() {
    if (!sociedadId) return;
    setOcupado("subir");
    const msgs: string[] = [];
    for (const a of archivos.filter((x) => x.cuenta)) {
      try {
        const r = await guardarArchivoExtracto(sociedadId, a);
        msgs.push(`${a.cuenta!.nombre}: ${r.insertadas} líneas nuevas${r.repetidas ? ` (${r.repetidas} ya estaban)` : ""}`);
        await anotar(null, "extracto_cargado", { archivo: a.nombre, cuenta: a.cuenta!.nombre, ...r, saldo: a.leido.saldoFinal, fecha: a.leido.saldoFecha }, `Extracto ${a.nombre} → ${a.cuenta!.nombre}: ${r.insertadas} líneas nuevas, saldo ${formatCurrency(a.leido.saldoFinal || 0)} al ${formatDate(a.leido.saldoFecha || "")}`);
      } catch (e) {
        msgs.push(`⚠️ ${a.nombre}: ${errorTexto(e)}`);
      }
    }
    setArchivos([]);
    setOcupado(null);
    setAviso(msgs.join("\n"));
    await cargar();
  }

  // ─── Pantalla ──────────────────────────────────────────────────────────────
  if (!sociedadId) return null;

  const registroVisible = registro.filter((r) => !filtroRegistro.trim() || `${r.resumen} ${r.accion} ${r.tipo} ${nombres.get(r.usuario_id || "")}`.toLowerCase().includes(filtroRegistro.trim().toLowerCase()));
  /** Vista simple: impuestos y comisiones que ya cruzan solos van juntos en una fila; lo demás sin cerrar es "para vos". */
  const esRuidoSimple = (i: ItemBandeja) => Boolean(i.cruce && ["impuesto", "gasto_bancario"].includes(i.cruce.clasificacion));
  const ruidoSimple = porConfianza.alta.filter(esRuidoSimple);
  // Las devoluciones (entradas dentro de impuestos o comisiones) se muestran aparte del costo: nunca se mezclan.
  const esDevolucion = (i: ItemBandeja) => String(i.cruce?.subtipo || "").startsWith("devolucion");
  const costoRuido = ruidoSimple.filter((i) => !esDevolucion(i));
  const devolRuido = ruidoSimple.filter(esDevolucion);
  const textoRuido = `${formatCurrency(costoRuido.reduce((s, i) => s + i.importe, 0))} (${costoRuido.length} líneas)${devolRuido.length ? ` · devoluciones ${formatCurrency(devolRuido.reduce((s, i) => s + i.importe, 0))} (${devolRuido.length})` : ""}`;
  const resueltasSimple = porConfianza.alta.filter((i) => !esRuidoSimple(i));
  const paraVosSimple = [...porConfianza.media, ...porConfianza.baja];

  const renglon = (i: ItemBandeja) => {
    const abiertoCorregir = corrigiendo === i.linea_id;
    const puedeConfirmar = Boolean(i.cobro || i.gasto || i.gastoFijo || i.pagoProveedor || i.cruce) && !faltaMigracion;
    return (
      <div key={i.linea_id} className="py-2">
        <div className="flex flex-wrap items-start gap-2 text-sm">
          <span className="w-16 shrink-0 pt-0.5 text-xs text-zinc-500">{formatDate(i.fecha)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-zinc-900 dark:text-white">
              {i.origen === "ia" && <Sparkles className="mr-1 inline h-3.5 w-3.5 text-violet-500" />}
              {i.titulo}
            </p>
            <p className="truncate text-xs text-zinc-500" title={i.concepto}>{i.concepto}{i.cuenta_id ? ` · ${cuentaNombre.get(i.cuenta_id) || ""}` : ""}</p>
            {i.detalle.filter(Boolean).map((d, k) => <p key={k} className="text-xs text-zinc-500">{d}</p>)}
            {i.debil && <p className="text-xs font-semibold text-red-600 dark:text-red-400">⛔ Sin evidencia: es una suposición por la suma de las facturas. Verificá con el aviso de pago antes de confirmar.</p>}
            {i.avisos.map((a, k) => <p key={k} className="text-xs font-medium text-amber-700 dark:text-amber-300">⚠️ {a}</p>)}
          </div>
          <span className={`w-32 shrink-0 text-right font-mono ${i.importe < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(i.importe)}</span>
          <div className="flex shrink-0 gap-1">
            {puedeConfirmar && (
              <button disabled={ocupado !== null} onClick={() => { if (i.debil && !window.confirm("⚠️ Esto es una SUPOSICIÓN: el cobro se armó porque la suma de unas facturas coincide, pero no hay un aviso de pago, un CUIT ni un nombre que confirmen quién pagó. Confirmalo solo si estás seguro de que ese cliente pagó esas facturas. ¿Confirmar igual?")) return; void confirmar([i], Boolean(i.cobro)); }} className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {ocupado === i.linea_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i.debil ? "Confirmar igual…" : simple ? "Sí, es eso" : "Confirmar"}
              </button>
            )}
            <button disabled={ocupado !== null} onClick={() => {
              if (!simple && (i.cobro || i.gasto)) { onIrATab?.("extractos"); return; }
              setCorrigiendo(abiertoCorregir ? null : i.linea_id);
              setCorreccion({ clasificacion: (i.cruce?.clasificacion as ClasificacionLinea) || "", nota: i.cruce?.nota || "", recordar: true });
            }} className="rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800" title={i.cobro || i.gasto ? "Abre Extractos para resolverla a mano" : "Elegir otra clasificación"}>
              {simple ? "Otra cosa" : "Corregir"}
            </button>
            {!simple && i.importe > 0 && !i.cobro && !faltaMigracion && (
              <button disabled={ocupado !== null} onClick={() => setAnterior(anterior?.linea_id === i.linea_id ? null : { linea_id: i.linea_id, cliente: "", facturas: "", bruto: "", referencia: "", rets: [{ tipo: "retencion_ganancias", monto: "", certificado: "" }, { tipo: "retencion_iibb", monto: "", certificado: "" }] })}
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800" title="Cobro de facturas que no están en el CRM: cliente, retenciones con certificado y nota literal">
                Sist. anterior
              </button>
            )}
            {!faltaMigracion && (
              <button disabled={ocupado !== null} onClick={() => void descartar(i)} title="Descartar la propuesta" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800"><X className="h-3.5 w-3.5" /></button>
            )}
          </div>
        </div>
        {abiertoCorregir && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800/50">
            <select value={correccion.clasificacion} onChange={(e) => setCorreccion((c) => ({ ...c, clasificacion: e.target.value as ClasificacionLinea }))} className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
              <option value="">¿Qué es?</option>
              {(i.importe > 0
                ? ["cobro", "intereses", "entre_cuentas", "fci", "impuesto", "personal", "otro"]
                : ["pago", "impuesto", "gasto_bancario", "personal", "tarjeta", "entre_cuentas", "fci", "otro"]
              ).map((c) => <option key={c} value={c}>{CLASIFICACION_LABEL[c as ClasificacionLinea]}{c === "cobro" || c === "pago" ? " (falta cargarlo)" : ""}</option>)}
            </select>
            <input value={correccion.nota} onChange={(e) => setCorreccion((c) => ({ ...c, nota: e.target.value }))} placeholder="Nota (ej. sueldo Mariana)" className="min-w-[12rem] flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
            <label className="flex items-center gap-1"><input type="checkbox" checked={correccion.recordar} onChange={(e) => setCorreccion((c) => ({ ...c, recordar: e.target.checked }))} /> Recordar para la próxima</label>
            <button disabled={ocupado !== null} onClick={() => void guardarCorreccion(i)} className="rounded-md bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Guardar</button>
            {!simple && <button onClick={() => onIrATab?.("extractos")} className="text-orange-600 hover:underline">Cheques, cuentas o movimientos: en Extractos</button>}
          </div>
        )}
        {anterior?.linea_id === i.linea_id && (() => {
          const a = armarAnterior(i);
          const set = (p: Partial<NonNullable<typeof anterior>>) => setAnterior((x) => (x ? { ...x, ...p } : x));
          const campo = "rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";
          return (
            <div className="mt-2 space-y-1.5 rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800/50">
              <p className="font-medium text-zinc-700 dark:text-zinc-200">Cobro de factura del sistema anterior (no toca la cuenta corriente del CRM)</p>
              <div className="flex flex-wrap gap-1.5">
                <input list={`cli-${i.linea_id}`} value={anterior.cliente} onChange={(e) => set({ cliente: e.target.value })} placeholder="Cliente" className={`min-w-[14rem] flex-1 ${campo}`} />
                <datalist id={`cli-${i.linea_id}`}>{(datos?.clientes || []).map((c) => <option key={c.id} value={`${c.razon_social}${c.cuit ? ` — ${c.cuit}` : ""}`} />)}</datalist>
                <input value={anterior.facturas} onChange={(e) => set({ facturas: e.target.value })} placeholder="Facturas (ej. FA A 0009-00000382 + 0009-00000388)" className={`min-w-[14rem] flex-1 ${campo}`} />
                <input value={anterior.bruto} onChange={(e) => set({ bruto: e.target.value })} placeholder="Bruto $" inputMode="decimal" className={`w-32 text-right ${campo}`} />
                <input value={anterior.referencia} onChange={(e) => set({ referencia: e.target.value })} placeholder="OP / aviso / recibo" className={`w-44 ${campo}`} />
              </div>
              {anterior.rets.map((r, k) => (
                <div key={k} className="flex flex-wrap items-center gap-1.5">
                  <select value={r.tipo} onChange={(e) => set({ rets: anterior.rets.map((x, j) => (j === k ? { ...x, tipo: e.target.value } : x)) })} className={campo}>
                    {["retencion_ganancias", "retencion_iibb", "retencion_iva", "retencion_suss"].map((t) => <option key={t} value={t}>{RETENCION_LABEL[t]}</option>)}
                  </select>
                  <input value={r.monto} onChange={(e) => set({ rets: anterior.rets.map((x, j) => (j === k ? { ...x, monto: e.target.value } : x)) })} placeholder="Importe $" inputMode="decimal" className={`w-28 text-right ${campo}`} />
                  <input value={r.certificado} onChange={(e) => set({ rets: anterior.rets.map((x, j) => (j === k ? { ...x, certificado: e.target.value } : x)) })} placeholder="N° de certificado" className={`w-40 ${campo}`} />
                  <button onClick={() => set({ rets: anterior.rets.filter((_, j) => j !== k) })} className="rounded p-1 text-zinc-400 hover:text-zinc-700"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => set({ rets: [...anterior.rets, { tipo: "retencion_iva", monto: "", certificado: "" }] })} className="text-orange-600 hover:underline">+ Retención</button>
                {a && numeroAR(anterior.bruto) > 0 && (Math.abs(a.diferencia) < 0.01
                  ? <span className="font-medium text-emerald-700 dark:text-emerald-300">✔ Cierra exacto: bruto − retenciones = {formatCurrency(i.importe)}</span>
                  : <span className="font-medium text-amber-700 dark:text-amber-300">⚠️ No cierra por {pesos(a.diferencia)}</span>)}
                <span className="flex-1" />
                <button disabled={ocupado !== null} onClick={() => void guardarAnterior(i)} className="rounded-md bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Guardar y cruzar</button>
                <button onClick={() => setAnterior(null)} className="rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700">Cancelar</button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Subir extracto */}
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastrando(false); void subir(e.dataTransfer.files); }}
        className={`rounded-xl border-2 border-dashed p-3 text-sm transition ${arrastrando ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {simple ? <p className="text-zinc-600 dark:text-zinc-300"><b>Arrastrá acá el Excel "Movimientos"</b> del home banking. Se controlan los saldos al centavo y no se duplica nada.</p> : (
          <p className="text-zinc-600 dark:text-zinc-300"><b>Arrastrá acá el Excel del BBVA</b> (se verifican los saldos al centavo), el <b>resumen mensual en PDF</b> (pone nombre y CUIT a cada transferencia y débito automático) y el <b>CSV de ARCA</b> "Mis comprobantes recibidos" (qué factura paga cada transferencia a un proveedor).</p>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600">
            {ocupado === "subir" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Subir extracto
            <input type="file" accept=".xls,.xlsx,.pdf,.csv" multiple className="hidden" onChange={(e) => { void subir(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {archivos.length > 0 && (
          <div className="mt-2 space-y-1 rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800/50">
            {archivos.map((a) => (
              <p key={a.nombre}>
                <b>{a.nombre}</b> → {a.cuenta ? a.cuenta.nombre : <span className="font-semibold text-red-600">no hay una cuenta con ese número</span>}
                {a.leido.lineas.length ? ` · del ${formatDate(a.leido.lineas[0].fecha)} al ${formatDate(a.leido.saldoFecha || "")}` : ""}
                {` · ${a.nuevas} líneas nuevas · saldo ${formatCurrency(a.leido.saldoFinal || 0)}`}
                {a.leido.saltos > 0 ? <span className="font-semibold text-amber-600"> · ⚠️ en {a.leido.saltos} renglones el saldo no cierra</span> : <span className="text-emerald-600"> · saldos ✔</span>}
              </p>
            ))}
            <div className="flex gap-2 pt-1">
              <button disabled={ocupado !== null || !archivos.some((a) => a.cuenta)} onClick={() => void guardarArchivos()} className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Guardar y armar la bandeja</button>
              <button onClick={() => setArchivos([])} className="rounded-md border border-zinc-200 px-3 py-1 dark:border-zinc-700">Cancelar</button>
            </div>
          </div>
        )}
        {aviso && <p className="mt-2 whitespace-pre-line text-xs font-medium text-zinc-700 dark:text-zinc-300">{aviso}</p>}
      </div>

      {faltaMigracion && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><b>Falta correr la migración de la bandeja</b> (20261016120000_finanzas_bandeja.sql). Mientras tanto se ve lo que propone el sistema, pero no se puede confirmar (hace falta el Registro).</div>
        </div>
      )}

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Armando la bandeja…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : (
        <>
          {/* Resumen */}
          {!simple && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span><b className="text-lg">{resumen.total}</b> líneas del banco para cerrar</span>
              <span className="text-emerald-700 dark:text-emerald-300"><b>{resumen.alta}</b> seguras</span>
              {resumen.cobros.n > 0 && <span>Cobros armados: <b>{resumen.cobros.n}</b> · {formatCurrency(resumen.cobros.importe)}</span>}
              {resumen.gastos.n > 0 && <span>Pagos de gastos: <b>{resumen.gastos.n}</b></span>}
              {resumen.impuestos.n > 0 && <span>Impuestos y gastos del banco: <b>{resumen.impuestos.n}</b> · {formatCurrency(resumen.impuestos.importe)}</span>}
              {iaTrabajando && <span className="flex items-center gap-1 text-violet-700 dark:text-violet-300"><Loader2 className="h-3.5 w-3.5 animate-spin" /> La IA está mirando {paraIA.length} líneas…</span>}
              {iaError && <span className="text-amber-700">IA: {iaError} <button className="underline" onClick={() => { iaPedidas.current.clear(); void preguntarIA(paraIA); }}>Reintentar</button></span>}
            </div>
            <button disabled={!porConfianza.alta.length || ocupado !== null || faltaMigracion} onClick={() => void confirmar(porConfianza.alta, true)}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
              {ocupado === "bloque" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar los {porConfianza.alta.length} seguros
            </button>
          </div>
          )}
          {simple && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span className="text-emerald-700 dark:text-emerald-300"><b className="text-lg">{porConfianza.alta.length}</b> resueltas solas</span>
                {ruidoSimple.length > 0 && <span><b>{textoRuido}</b> en impuestos y comisiones</span>}
                <span><b className="text-lg">{paraVosSimple.length}</b> para vos</span>
                {iaTrabajando && <span className="flex items-center gap-1 text-violet-700 dark:text-violet-300"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Mirando {paraIA.length} líneas…</span>}
                {iaError && <span className="text-amber-700">IA: {iaError} <button className="underline" onClick={() => { iaPedidas.current.clear(); void preguntarIA(paraIA); }}>Reintentar</button></span>}
              </div>
              <button disabled={!porConfianza.alta.length || ocupado !== null || faltaMigracion} onClick={() => void confirmar(porConfianza.alta, true)}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                {ocupado === "bloque" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar las {porConfianza.alta.length}
              </button>
            </div>
          )}

          {!items.length && <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">Nada para confirmar: todas las líneas del banco están cerradas. Subí el próximo extracto cuando lo bajes.</p>}

          {!simple && (
            <>
          {(["alta", "media", "baja"] as Confianza[]).map((k) => porConfianza[k].length > 0 && (
            <div key={k} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button onClick={() => setAbiertos((a) => ({ ...a, [k]: !a[k] }))} className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-white">
                  {abiertos[k] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className={`rounded-md px-2 py-0.5 text-xs ${CONF[k].clase}`}>{CONF[k].label}</span>
                  {porConfianza[k].length} · {formatCurrency(porConfianza[k].reduce((s, i) => s + i.importe, 0))}
                </button>
                {k === "media" && porConfianza.media.some((i) => i.cobro || i.gasto || i.cruce) && !faltaMigracion && (
                  <button disabled={ocupado !== null} onClick={() => void confirmar(porConfianza.media, true)} className="rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200">Confirmar todos estos</button>
                )}
                {k === "baja" && <p className="text-xs text-zinc-500">La IA no tuvo pistas suficientes: corregilas acá (con "Recordar") o resolvelas en Extractos.</p>}
              </div>
              {abiertos[k] && <div className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">{porConfianza[k].map(renglon)}</div>}
            </div>
          ))}
            </>
          )}
          {simple && (
            <>
              {paraVosSimple.length > 0 && (
                <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="font-semibold text-zinc-900 dark:text-white">Para vos · {paraVosSimple.length} · {formatCurrency(paraVosSimple.reduce((s, i) => s + i.importe, 0))}</p>
                  <div className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">{paraVosSimple.map(renglon)}</div>
                </div>
              )}
              <div className="space-y-1 text-sm">
                {resueltasSimple.length > 0 && (
                  <button onClick={() => setVerResueltas((v) => !v)} className="flex items-center gap-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-300">
                    {verResueltas ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Ver las {resueltasSimple.length} resueltas solas
                  </button>
                )}
                {verResueltas && <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white px-3 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">{resueltasSimple.map(renglon)}</div>}
                {ruidoSimple.length > 0 && (
                  <button onClick={() => setVerRuido((v) => !v)} className="flex items-center gap-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-300">
                    {verRuido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Impuestos y comisiones del banco: {textoRuido} · ver detalle
                  </button>
                )}
                {verRuido && <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white px-3 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">{ruidoSimple.map(renglon)}</div>}
                <button onClick={() => setVerRegistro((v) => !v)} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"><History className="h-4 w-4" /> Historial</button>
              </div>
            </>
          )}

          {aCargar.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
              <p className="font-semibold text-amber-800 dark:text-amber-200">{aCargar.length} cobros/pagos confirmados que falta cargar en el CRM ({formatCurrency(aCargar.reduce((s, l) => s + importeDe(l), 0))})</p>
              <p className="text-amber-700 dark:text-amber-300">Cuando cargues el cobro o la orden de pago, se cruzan solos. <button onClick={() => onIrATab?.("extractos")} className="underline">Ver en Extractos</button></p>
            </div>
          )}

          {/* Registro */}
          {(!simple || verRegistro) && (
          <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={() => setVerRegistro((v) => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                <History className="h-4 w-4" /> Registro ({registro.length}{registro.length >= 300 ? "+" : ""}) {verRegistro ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {verRegistro && <input value={filtroRegistro} onChange={(e) => setFiltroRegistro(e.target.value)} placeholder="Buscar (cliente, importe, persona, acción)" className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800" />}
            </div>
            {verRegistro && (
              <div className="mt-2 max-h-[26rem] divide-y divide-zinc-100 overflow-y-auto text-xs dark:divide-zinc-800">
                {registroVisible.map((r) => (
                  <div key={r.id} className="flex flex-wrap gap-2 py-1">
                    <span className="w-28 shrink-0 text-zinc-500">{new Date(r.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="w-24 shrink-0 font-medium">{r.accion}</span>
                    <span className="w-28 shrink-0 truncate text-zinc-500">{nombres.get(r.usuario_id || "") || "—"}</span>
                    <span className="min-w-0 flex-1">{r.resumen}{r.resultado?.motivo ? ` · motivo: ${r.resultado.motivo}` : ""}</span>
                  </div>
                ))}
                {!registroVisible.length && <p className="py-2 text-zinc-500">Todavía no hay nada registrado.</p>}
              </div>
            )}
          </div>
          )}
        </>
      )}
    </div>
  );
}
