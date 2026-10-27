"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { X, Plus, Trash2, AlertCircle, Copy, ArrowDown, RefreshCw, Maximize2, Minimize2, Upload, Sparkles, Loader2, FileCheck2 } from "lucide-react";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { parseDecimalInput, toDecimalInput } from "@/lib/decimal-input";
import { buildOrdenPagoPlan, pagoOriginal, type OpParsed } from "@/lib/orden-pago-plan";
import { fechaMedioCobro, avisoFechaCobroFutura } from "@/lib/fecha-cobro";
import { repartirCobro, avisoDiferenciaCobro, facturasParaRegistrar } from "@/lib/cobro-reparto";
import { fuentesSaldoFavorCliente, repartirSaldoFavorCliente, faltaSegunOrden, cubreConSaldoFavor, type FuenteSaldoFavorCliente } from "@/lib/saldo-favor-cliente";
import { claveArchivo, mismaRetencion, mismoPago, sinRepetir } from "@/lib/comprobante-medios";
import { guardarRevisar } from "@/components/dejar-revisar";
import { ZonaArchivos } from "@/components/ui/zona-archivos";
import { useToast } from "@/components/ui/toast";
import { textoCobro } from "@/lib/cartel-guardado";
import { numerosDeRecibo } from "@/lib/recibo-numero";

// ── Types ────────────────────────────────────────────────
export interface LiquidacionFactura {
  id: string;
  numero: string; // formatted "FA 0015-00000123"
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  total_acreditado: number;
  saldo: number;
  moneda: string;
}

interface MedioPago {
  _id: string;
  tipo: string;
  monto: string;
  fecha: string;
  referencia: string;
  observaciones: string;
  cheque_banco: string;
  cheque_numero: string;
  cheque_fecha_pago: string;
}

interface RetencionLinea {
  _id: string;
  tipo: string;
  organismo: string;
  certificado: string;
  monto: string;
  observaciones: string;
}

interface Props {
  facturas: LiquidacionFactura[];
  clienteId: string;
  clienteNombre: string;
  sociedadId: string;
  profileId: string | null;
  moneda: "ARS" | "USD";
  onClose: () => void;
  onSuccess: () => void;
  /** Orden de pago ya leída por IA: se aplica al abrir (cobro de todas las facturas de una OP). */
  ordenPago?: OpParsed;
  /** Mensajes del paso a paso cuando se cobran todas las facturas de una OP. */
  ordenPagoAvisos?: string[];
  /** Si la OP paga otras facturas, ofrece cobrarlas todas juntas. */
  onCobrarOrdenCompleta?: (ordenPago: OpParsed) => void;
}

// ── Helpers ──────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => todayAR();
// Acepta "1.241.525,27", "1241525,27" o "1241525.27". Vacío o inválido = 0.
const num = (v: string) => { const n = parseDecimalInput(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

const MEDIO_TIPOS = [
  { value: "transferencia", label: "Transferencia bancaria" },
  { value: "efectivo", label: "Efectivo" },
  { value: "echeq", label: "Cheque / E-Cheq" },
  { value: "deposito", label: "Depósito" },
  // Augusto 20/10/2026: cobros con link de pago de Mercado Pago (sin cuenta de banco).
  { value: "link_pago", label: "Link de pago (Mercado Pago)" },
];

const RETENCION_TIPOS = [
  { value: "retencion_iva", label: "Retención de IVA" },
  { value: "retencion_ganancias", label: "Retención de Ganancias" },
  { value: "retencion_iibb", label: "Retención de IIBB" },
  { value: "retencion_suss", label: "Retención SUSS" },
  { value: "percepcion_iva", label: "Percepción de IVA" },
  { value: "percepcion_iibb", label: "Percepción de IIBB" },
  { value: "ajuste", label: "Otro descuento / ajuste" },
];

function newMedio(): MedioPago {
  return { _id: uid(), tipo: "transferencia", monto: "", fecha: todayStr(), referencia: "", observaciones: "", cheque_banco: "", cheque_numero: "", cheque_fecha_pago: "" };
}
function newRetencion(): RetencionLinea {
  return { _id: uid(), tipo: "retencion_iva", organismo: "", certificado: "", monto: "", observaciones: "" };
}

// Map percepciones to "ajuste" for DB (enum may not have them yet)
function mapTipoDB(tipo: string): string {
  if (tipo === "percepcion_iva" || tipo === "percepcion_iibb") return "ajuste";
  return tipo;
}

function buildDesc(prefix: string, ref: string, obs: string, opRef: string): string {
  const parts: string[] = [];
  if (opRef) parts.push(`OP: ${opRef}`);
  if (ref) parts.push(`Ref: ${ref}`);
  if (obs) parts.push(obs);
  return parts.length > 0 ? `${prefix} — ${parts.join(" | ")}` : prefix;
}

// ── Component ────────────────────────────────────────────
export default function CobroMasivoLiquidacion({
  facturas, clienteId, clienteNombre, sociedadId, moneda, onClose, onSuccess, ordenPago, ordenPagoAvisos, onCobrarOrdenCompleta,
}: Props) {
  const { toast } = useToast();
  const [opReferencia, setOpReferencia] = useState("");
  const [medios, setMedios] = useState<MedioPago[]>([newMedio()]);
  const [retenciones, setRetenciones] = useState<RetencionLinea[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [opFiles, setOpFiles] = useState<File[]>([]);
  const [parsingOP, setParsingOP] = useState(false);
  const [opParseMessage, setOpParseMessage] = useState("");
  // 26/10/2026 (auditoría UX, arreglo 6): lo que leyó la IA sale en ámbar si trae avisos (antes salía en verde igual).
  const [opParseAviso, setOpParseAviso] = useState(false);
  const [opConOtras, setOpConOtras] = useState<OpParsed | null>(null);
  const requestKeyRef = useRef("");

  // ── Saldo a favor del cliente (Augusto 26/10: "que el sistema también mire la cuenta corriente") ──
  // Pagos de más, facturas pagadas y después anuladas, ajustes de crédito. Nunca se tilda solo.
  const [fuentesSF, setFuentesSF] = useState<FuenteSaldoFavorCliente[]>([]);
  const [usarSF, setUsarSF] = useState(false);
  const [faltaOP, setFaltaOP] = useState<Record<string, number>>({});
  // Si el cobro falla después de aplicar el saldo a favor, no se vuelve a aplicar al reintentar.
  const sfAplicadoRef = useRef(false);
  useEffect(() => {
    let vivo = true;
    (supabase as any).from("movimientos").select("id, monto, fecha, descripcion, anulado, factura_id, ajuste_sentido, moneda")
      .eq("sociedad_id", sociedadId).eq("cliente_id", clienteId).eq("tipo", "ajuste").eq("ajuste_sentido", "credito")
      .is("factura_id", null).eq("moneda", moneda).order("fecha")
      .then(async ({ data, error: e }: any) => {
        if (!vivo || e || !data?.length) return;
        const ids = data.map((r: any) => r.id);
        const { data: aps } = await (supabase as any).from("cobro_aplicaciones").select("movimiento_id").in("movimiento_id", ids);
        if (vivo) setFuentesSF(fuentesSaldoFavorCliente(data, new Set((aps || []).map((a: any) => a.movimiento_id))));
      });
    return () => { vivo = false; };
  }, [sociedadId, clienteId, moneda]);

  // ── Tipo de cambio (solo para facturas USD) ──
  const isUSD = moneda === "USD";
  const [cotizacion, setCotizacion] = useState("");
  const [cotizModalidad, setCotizModalidad] = useState<"divisas" | "billetes">("divisas");
  const [fetchingCotiz, setFetchingCotiz] = useState(false);

  async function fetchCotizBNA(modalidad: "divisas" | "billetes") {
    setFetchingCotiz(true);
    try {
      const res = await fetch(`/api/cotizacion-bna?modalidad=${modalidad}`);
      if (res.ok) {
        const data = await res.json();
        setCotizacion(toDecimalInput(Number(data.valor_venta)));
        setCotizModalidad(modalidad);
      }
    } catch { /* ignore */ } finally { setFetchingCotiz(false); }
  }

  // Auto-fetch cotización on mount if USD
  useEffect(() => { if (isUSD) fetchCotizBNA("divisas"); }, [isUSD]);

  const cotizNum = num(cotizacion);

  // ── Computed totals ──
  const totalNeto = useMemo(() => facturas.reduce((s, f) => s + (f.subtotal || 0), 0), [facturas]);
  const totalIva = useMemo(() => facturas.reduce((s, f) => s + (f.iva || 0), 0), [facturas]);
  const totalGeneral = useMemo(() => facturas.reduce((s, f) => s + f.total, 0), [facturas]);
  const totalSaldoBruto = useMemo(() => facturas.reduce((s, f) => s + f.saldo, 0), [facturas]);
  const totalSF = r2(fuentesSF.reduce((s, f) => s + f.monto, 0));
  const aplicacionesSF = useMemo(() => usarSF
    ? repartirSaldoFavorCliente(fuentesSF, facturas.map((f) => ({ id: f.id, numero: f.numero, fecha: f.fecha, saldo: f.saldo })), faltaOP)
    : [], [usarSF, fuentesSF, facturas, faltaOP]);
  const totalSFAplicado = r2(aplicacionesSF.reduce((s, a) => s + a.monto, 0));
  // Saldo de cada factura después de aplicar el saldo a favor: es lo que tiene que cubrir el cobro.
  const facturasCobro = useMemo(() => facturas.map((f) => ({
    ...f, saldo: r2(f.saldo - aplicacionesSF.filter((a) => a.factura_id === f.id).reduce((s, a) => s + a.monto, 0)),
  })), [facturas, aplicacionesSF]);
  const totalSaldo = r2(totalSaldoBruto - totalSFAplicado);
  const totalMedios = useMemo(() => medios.reduce((s, m) => s + num(m.monto), 0), [medios]);
  const totalRetenciones = useMemo(() => retenciones.reduce((s, r) => s + num(r.monto), 0), [retenciones]);
  // Retenciones siempre en la moneda de cobro (ARS si USD, moneda original si ARS)
  const totalSaldoARS = isUSD && cotizNum > 0 ? r2(totalSaldo * cotizNum) : totalSaldo;
  const totalEsperado = r2(totalSaldoARS - totalRetenciones);
  const diferencia = r2(totalMedios - totalEsperado);
  // Regla 1: con diferencia se puede confirmar igual (avisa y pregunta antes de guardar).
  const hayDiferencia = Math.abs(diferencia) >= 0.01;
  // Arreglo 24 (27/10/2026): si el saldo a favor cubre todo lo tildado, se confirma con $ 0 (solo se aplica el saldo a favor).
  const soloSaldoFavor = cubreConSaldoFavor({ aplicado: totalSFAplicado, deuda: totalSaldoBruto, medios: totalMedios, retenciones: totalRetenciones });
  const canConfirm = (totalMedios > 0 || soloSaldoFavor) && !saving && !parsingOP && (!isUSD || cotizNum > 0 || soloSaldoFavor);
  // Cómo queda cada factura (en su moneda): de la más vieja a la más nueva.
  const reparto = useMemo(() => {
    const aplicadoARS = totalMedios + totalRetenciones;
    const aplicado = isUSD ? (cotizNum > 0 ? aplicadoARS / cotizNum : 0) : aplicadoARS;
    return repartirCobro(facturasCobro.map((f) => ({ id: f.id, numero: f.numero, fecha: f.fecha, saldo: f.saldo })), aplicado);
  }, [facturasCobro, totalMedios, totalRetenciones, isUSD, cotizNum]);
  const [dejarEnRevisar, setDejarEnRevisar] = useState(true);
  // Si falta plata: dejar el saldo en la factura más nueva ("factura") o pasar la diferencia a la cuenta corriente ("cc").
  // La opción "cc" es solo para facturas en pesos (en dólares el cobro va en pesos y la cuenta no cierra igual).
  const [destinoDiferencia, setDestinoDiferencia] = useState<"factura" | "cc">("factura");
  const diferenciaCC = r2(Math.max(0, -diferencia));
  const usarDiferenciaCC = !isUSD && reparto.falta > 0 && destinoDiferencia === "cc" && diferenciaCC > 0;

  // ── Medio handlers ──
  const addMedio = () => setMedios(p => [...p, newMedio()]);
  const removeMedio = (id: string) => setMedios(p => p.filter(m => m._id !== id));
  const updateMedio = (id: string, field: string, value: string) =>
    setMedios(p => p.map(m => m._id === id ? { ...m, [field]: value } : m));

  // ── Retencion handlers ──
  const addRetencion = () => setRetenciones(p => [...p, newRetencion()]);
  const removeRetencion = (id: string) => setRetenciones(p => p.filter(r => r._id !== id));
  const updateRetencion = (id: string, field: string, value: string) =>
    setRetenciones(p => p.map(r => r._id === id ? { ...r, [field]: value } : r));

  async function parseClientPaymentOrder(files: File[]) {
    if (!files.length) return;
    setParsingOP(true);
    setOpParseMessage("");
    setOpParseAviso(false);
    setError("");
    // El mismo archivo otra vez no se lista dos veces.
    setOpFiles((prev) => [...prev.filter((p) => !files.some((f) => claveArchivo(f) === claveArchivo(p))), ...files]);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("file", file));
      form.append("contexto", "orden_pago_cliente");
      const response = await fetch("/api/parse-cobro", { method: "POST", body: form });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "No se pudo leer la orden de pago");

      aplicarOrdenPago((json.data || {}) as OpParsed);
    } catch (parseError) {
      setOpParseMessage(parseError instanceof Error ? parseError.message : "No se pudo leer la orden de pago");
    } finally {
      setParsingOP(false);
    }
  }

  function aplicarOrdenPago(ordenLeida: OpParsed) {
    try {
      const parsed = ordenLeida as OpParsed & { pagos?: any[] };
      // Solo lo que corresponde a las facturas de esta liquidación: si la OP también
      // paga otras facturas (por ejemplo en dólares), su parte queda informada aparte.
      const plan = buildOrdenPagoPlan(parsed, facturas.map((f) => ({ id: f.id, numero: f.numero })));
      const originales: any[] = Array.isArray(parsed.pagos) ? parsed.pagos : [];
      // Cada pago leído se usa una sola vez (27/10/2026: dos eCheqs de Rebsa del mismo importe salían con el N° y la fecha del primero).
      const usados = new Set<any>();
      const original = (tipo: string, monto: number, referencia?: string): any => pagoOriginal(originales, usados, tipo, monto, referencia) || {};
      const parsedRetenciones: RetencionLinea[] = plan.retenciones.map((r) => {
        const p = original(r.tipo, r.monto, r.certificado);
        return {
          _id: uid(),
          tipo: RETENCION_TIPOS.some((option) => option.value === r.tipo) ? r.tipo : "ajuste",
          organismo: String(r.organismo || p.organismo || p.destinatario || ""),
          certificado: String(r.certificado || p.certificado || p.referencia || ""),
          monto: toDecimalInput(r.monto),
          observaciones: String(p.notas || p.concepto || ""),
        };
      });
      const parsedMedios: MedioPago[] = plan.medios.map((m) => {
        const p = original(m.tipo, m.monto, m.referencia);
        const tipo = m.tipo;
        // Todo cheque recibido se presume electrónico. Solo el operador puede
        // cambiarlo a físico con la casilla explícita antes de confirmar.
        const normalizedType = tipo === "cheque" || tipo === "echeq"
          ? "echeq"
          : MEDIO_TIPOS.some((option) => option.value === tipo) ? tipo : "transferencia";
        return {
          _id: uid(),
          tipo: normalizedType,
          monto: toDecimalInput(m.monto),
          // El cobro va con la fecha en que se recibe; la del cheque queda en cheque_fecha_pago.
          fecha: fechaMedioCobro({ tipo, fecha: m.fecha || p.fecha, fecha_cobro: p.fecha_cobro }, todayStr()),
          referencia: String(m.referencia || p.cheque_numero || p.cheque_id_digital || ""),
          observaciones: String(p.notas || p.concepto || ""),
          cheque_banco: String(m.banco || p.banco || ""),
          cheque_numero: String(p.cheque_numero || p.cheque_id_digital || ""),
          cheque_fecha_pago: String(p.cheque_fecha || m.fecha || p.fecha_cobro || p.fecha || ""),
        };
      });
      setOpConOtras(plan.otras.length && !ordenPagoAvisos ? ordenLeida : null);
      setFaltaOP(faltaSegunOrden(facturas.map((f) => ({ id: f.id, numero: f.numero, fecha: f.fecha, saldo: f.saldo })), plan.incluidas));
      // Una transferencia o un cheque suelto no trae detalle de facturas: ese aviso es solo para órdenes de pago.
      const esOrden = !!parsed.orden_pago_cliente || (parsed.facturas_pagadas || []).length > 0;
      const avisosPlan = esOrden ? plan.avisos : plan.avisos.filter((a) => !a.startsWith("La IA no encontró el detalle de facturas"));
      const otrasLineas = ordenPagoAvisos ? ordenPagoAvisos : plan.otras.map((o) => `La orden también paga ${o.comprobante} por ${formatCurrency(o.importe, "ARS")}: cobrala aparte (${formatCurrency(o.medios, "ARS")} del pago + ${formatCurrency(o.retenciones.reduce((s, r) => s + r.monto, 0), "ARS")} de retenciones).`);

      // 26/10/2026 (auditoría UX, arreglo 3): volver a subir el comprobante (o la retención que ya venía en la OP)
      // no suma de nuevo lo que ya está cargado; se avisa (lib/comprobante-medios.ts).
      const pagoDe = (x: MedioPago) => ({ tipo: x.tipo, monto: num(x.monto), numero: x.cheque_numero || x.referencia, fecha: x.fecha });
      const mismoMedio = (a: MedioPago, b: MedioPago) => mismoPago(pagoDe(a), pagoDe(b));
      const retDe = (x: RetencionLinea) => ({ tipo: x.tipo, monto: num(x.monto), certificado: x.certificado });
      const mismaRet = (a: RetencionLinea, b: RetencionLinea) => mismaRetencion(retDe(a), retDe(b));
      const mediosRepetidos = sinRepetir(medios, parsedMedios, mismoMedio).repetidos;
      const retencionesRepetidas = sinRepetir(retenciones, parsedRetenciones, mismaRet).repetidos;
      const monedaMedios = isUSD ? "ARS" : moneda;
      const repetidos = [
        ...mediosRepetidos.map((x) => `${MEDIO_TIPOS.find((t) => t.value === x.tipo)?.label || x.tipo} ${formatCurrency(num(x.monto), monedaMedios)}`),
        ...retencionesRepetidas.map((x) => `${RETENCION_TIPOS.find((t) => t.value === x.tipo)?.label || x.tipo} ${formatCurrency(num(x.monto), monedaMedios)}`),
      ];
      const lineaRepetidos = repetidos.length ? [`Ya estaba cargado y no se sumó de nuevo: ${repetidos.join(" · ")}.`] : [];

      if (parsedMedios.length) {
        setMedios((current) => {
          const base = current.length === 1 && !current[0].monto && !current[0].referencia ? [] : current;
          return [...base, ...sinRepetir(base, parsedMedios, mismoMedio).agregar];
        });
      }
      if (parsedRetenciones.length) setRetenciones((current) => [...current, ...sinRepetir(current, parsedRetenciones, mismaRet).agregar]);
      if (parsed.orden_pago_cliente) setOpReferencia(String(parsed.orden_pago_cliente));
      if (!parsedMedios.length && !parsedRetenciones.length) throw new Error(["La IA no encontró medios de pago ni retenciones en el archivo.", ...otrasLineas, ...avisosPlan].join(" "));
      const nMedios = parsedMedios.length - mediosRepetidos.length;
      const nRetenciones = parsedRetenciones.length - retencionesRepetidas.length;
      setOpParseMessage([`IA completó ${nMedios} medio${nMedios === 1 ? "" : "s"} y ${nRetenciones} retención${nRetenciones === 1 ? "" : "es"}. Revisá los datos antes de confirmar.`, ...otrasLineas, ...avisosPlan, ...lineaRepetidos].join(" "));
      setOpParseAviso(otrasLineas.length > 0 || avisosPlan.length > 0 || lineaRepetidos.length > 0);
    } catch (parseError) {
      setOpParseMessage(parseError instanceof Error ? parseError.message : "No se pudo aplicar la orden de pago");
    }
  }

  // Orden de pago recibida ya leída: se aplica una sola vez al abrir.
  const ordenPagoAplicada = useRef(false);
  useEffect(() => {
    if (!ordenPago || ordenPagoAplicada.current) return;
    ordenPagoAplicada.current = true;
    aplicarOrdenPago(ordenPago);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenPago]);

  // El saldo a favor tildado se aplica una sola vez, aunque después se reintente el cobro.
  async function aplicarSaldoFavor() {
    if (!aplicacionesSF.length || sfAplicadoRef.current) return;
    const { error: sfErr } = await (supabase as any).rpc("aplicar_saldo_favor_cliente", {
      p_sociedad_id: sociedadId, p_cliente_id: clienteId,
      p_aplicaciones: aplicacionesSF.map((a) => ({ movimiento_id: a.movimiento_id, factura_id: a.factura_id, monto: a.monto })),
    });
    if (sfErr) {
      if (/aplicar_saldo_favor_cliente/.test(String(sfErr.message || "")) && /function|funci/i.test(String(sfErr.message || ""))) {
        throw new Error("Falta correr la migración 20261026160000 (saldo a favor del cliente). Destildá \"Aplicar\" para cobrar sin usarlo.");
      }
      throw new Error(`No se pudo aplicar el saldo a favor: ${sfErr.message}. No se guardó nada.`);
    }
    sfAplicadoRef.current = true;
  }

  // ── Confirm & register ──
  async function handleConfirmar() {
    if (!canConfirm) return;
    setSaving(true);
    setError("");

    try {
      // Arreglo 24: el saldo a favor cubre todo y no entra plata → solo se aplica; no hay cobro ni recibo.
      if (soloSaldoFavor) {
        await aplicarSaldoFavor();
        alert(`Saldo a favor aplicado: ${aplicacionesSF.map((a) => `${fc(a.monto, m)} a la ${a.numero}`).join("; ")}.\n\n${facturas.length > 1 ? `Las ${facturas.length} facturas quedaron pagadas` : "La factura quedó pagada"}. No se hizo recibo porque no entró plata.`);
        onSuccess();
        return;
      }

      const fechaPago = medios[0]?.fecha || todayStr();
      const avisoFecha = avisoFechaCobroFutura(fechaPago, todayStr());
      if (avisoFecha && !confirm(avisoFecha)) { setSaving(false); return; }
      if (hayDiferencia) {
        const aviso = usarDiferenciaCC
          ? `Faltan ${fc(diferenciaCC, m)}.\n\nLas ${facturas.length} facturas quedan PAGADAS y los ${fc(diferenciaCC, m)} quedan como deuda del cliente en su cuenta corriente (sin factura).\n\n¿Registrar el cobro así?`
          : avisoDiferenciaCobro(reparto, (n) => fc(n, m)) || `La diferencia es ${fc(diferencia, isUSD ? "ARS" : m)}.\n\n¿Registrar el cobro igual?`;
        if (!confirm(aviso)) { setSaving(false); return; }
      }

      const cotizSuffix = isUSD && cotizNum > 0 ? ` | TC: ${cotizNum.toFixed(2)} (${cotizModalidad})` : "";

      // En dólares los montos van en pesos: la base necesita el tipo de cambio para aplicarlos a las facturas.
      const tcPayload = isUSD ? { tipo_cambio: cotizNum } : {};

      // Build medios array (one movimiento per medio)
      const mediosPayload = medios.filter(m => num(m.monto) > 0).map(m => ({
        tipo: m.tipo === "echeq" ? "cheque_recibido" : m.tipo,
        monto: num(m.monto),
        ...tcPayload,
        descripcion: buildDesc(
          `Cobro${clienteNombre ? ` — ${clienteNombre}` : ""}${cotizSuffix}`,
          m.referencia, m.observaciones, opReferencia
        ),
        ...((m.tipo === "cheque_recibido" || m.tipo === "echeq") ? {
          tipo_cheque: m.tipo === "echeq" ? "echeq" : "fisico",
          cheque_numero: m.cheque_numero || m.referencia || "",
          cheque_banco: m.cheque_banco || "",
          cheque_fecha_pago: m.cheque_fecha_pago || m.fecha || fechaPago,
        } : {}),
      }));

      // Build retenciones array (one movimiento per retención)
      const retencionesPayload = retenciones.filter(r => num(r.monto) > 0).map(r => {
        const label = RETENCION_TIPOS.find(t => t.value === r.tipo)?.label || r.tipo;
        return {
          tipo: mapTipoDB(r.tipo),
          monto: num(r.monto),
          ...tcPayload,
          descripcion: buildDesc(
            label,
            r.certificado ? `Cert: ${r.certificado}` : "",
            [r.organismo, r.observaciones].filter(Boolean).join(" | "),
            opReferencia
          ),
        };
      });

      if (mediosPayload.length === 0) throw new Error("No hay medios de pago");

      // Build facturas array
      // La base calcula el saldo real y reparte de la más vieja a la más nueva; si sobra, queda a favor del cliente.
      // Si falta plata, van solo las facturas que reciben algo.
      // Con "diferencia a la cuenta corriente" van los saldos reales: la base cierra las facturas con un ajuste
      // y deja la diferencia como deuda suelta del cliente.
      const facturasPayload = usarDiferenciaCC ? facturasParaRegistrar({ filas: reparto.filas, falta: 0 }) : facturasParaRegistrar(reparto);

      if (!requestKeyRef.current) requestKeyRef.current = crypto.randomUUID();

      // Primero el saldo a favor (si se tildó): así la base ve el saldo real de cada factura al registrar el cobro.
      await aplicarSaldoFavor();

      // Una unica RPC confirma movimientos, aplicaciones y cheques en cartera.
      const base = {
        p_cliente_id: clienteId,
        p_facturas: facturasPayload,
        p_medios: mediosPayload,
        p_retenciones: retencionesPayload,
        p_fecha: fechaPago,
        p_sociedad_id: sociedadId,
        p_request_key: requestKeyRef.current,
      };
      const { data, error: rpcErr } = usarDiferenciaCC
        ? await (supabase as any).rpc("registrar_cobro_masivo_diferencia_cc", {
          ...base,
          p_diferencia: diferenciaCC,
          p_descripcion: `Diferencia de cobro pasada a la cuenta corriente — Facturas: ${facturas.map((f) => f.numero).join(", ")}${opReferencia ? ` | OP: ${opReferencia}` : ""}`,
        })
        : await (supabase as any).rpc("registrar_cobro_masivo_seguro", base);
      if (rpcErr) {
        if (usarDiferenciaCC && /registrar_cobro_masivo_diferencia_cc/.test(String(rpcErr.message || ""))) {
          throw new Error("Falta correr la migración 20261012110000 (diferencia a la cuenta corriente). Mientras tanto elegí \"Saldo en la factura más nueva\".");
        }
        throw new Error(sfAplicadoRef.current && aplicacionesSF.length
          ? `${rpcErr.message}. El saldo a favor (${fc(totalSFAplicado, m)}) ya quedó aplicado: volvé a confirmar para registrar el cobro.`
          : rpcErr.message);
      }

      let avisoRevisar: { texto: string; falló: boolean } | null = null;
      if (hayDiferencia && dejarEnRevisar) {
        const conSaldo = reparto.filas.filter((f) => f.queda > 0);
        const ultima = conSaldo[conSaldo.length - 1] || reparto.filas[reparto.filas.length - 1];
        const falta = reparto.falta > 0;
        const errRevisar = await guardarRevisar(sociedadId, {
          entidad_tipo: "factura_venta",
          entidad_id: ultima?.id || null,
          titulo: usarDiferenciaCC ? `Diferencia de cobro en la cuenta corriente — ${clienteNombre}`
            : falta ? `Cobro con diferencia — ${clienteNombre}${ultima ? ` (${ultima.numero})` : ""}` : `Cobro de más — ${clienteNombre}`,
          motivo: "diferencia_cobro",
          importe: falta ? reparto.falta : reparto.sobra,
          moneda: m,
          cliente_id: clienteId,
          nota: [
            opReferencia ? `OP del cliente: ${opReferencia}.` : "",
            `Recibido ${fc(totalMedios, isUSD ? "ARS" : m)}${totalRetenciones > 0 ? ` + retenciones ${fc(totalRetenciones, isUSD ? "ARS" : m)}` : ""}.`,
            usarDiferenciaCC
              ? `Faltan ${fc(diferenciaCC, m)} (¿retenciones sin certificado?). Facturas pagadas; la diferencia quedó como deuda en la cuenta corriente.`
              : falta
                ? `Faltan ${fc(reparto.falta, m)} (¿retenciones sin certificado?). ${conSaldo.map((f) => `${f.numero} queda con ${fc(f.queda, m)}`).join("; ")}.`
                : `Sobran ${fc(reparto.sobra, m)}: quedaron como saldo a favor del cliente en su cuenta corriente.`,
          ].filter(Boolean).join(" "),
        });
        avisoRevisar = errRevisar
          ? { texto: `El cobro quedó guardado, pero no se pudo anotar la diferencia en Revisar: ${errRevisar}`, falló: true }
          : { texto: "La diferencia quedó anotada en Revisar (se abre en /finanzas-vieja?tab=revisar).", falló: false };
      }
      // Cartel verde (auditoría UX 27/10, arreglo 2): el N° de recibo lo arma la base al guardar; si no se puede leer, sale sin número.
      const numerosRecibo = await numerosDeRecibo({ movimientoIds: data?.inserted_ids });
      const notaSF = aplicacionesSF.length ? ` · saldo a favor aplicado ${fc(totalSFAplicado, m)}` : "";
      toast.success(`${textoCobro(numerosRecibo, facturas.length)}${notaSF}`);
      if (avisoRevisar) (avisoRevisar.falló ? toast.warning : toast.info)(avisoRevisar.texto);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Error al registrar el cobro");
    } finally {
      setSaving(false);
    }
  }

  const fc = formatCurrency;
  const m = moneda;

  // 26/10/2026 (auditoría UX, arreglo 3): con algo cargado, la X pregunta antes de cerrar (como Presupuestos, 21/10).
  // «Cancelar» cierra directo; mientras guarda no se cierra.
  const hayCargado = opFiles.length > 0 || retenciones.length > 0 || !!opReferencia.trim()
    || medios.some((x) => num(x.monto) > 0 || !!x.referencia.trim());
  function pedirCierre() {
    if (saving) return;
    if (hayCargado && !confirm("¿Estás seguro que deseas salir sin guardar? Se pierde lo que cargaste en este cobro.")) return;
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4 pt-8 pb-8">
      <div className={`bg-white dark:bg-zinc-900 rounded-xl shadow-2xl transition-all ${fullscreen ? "fixed inset-2 z-50 max-h-[calc(100vh-1rem)] overflow-y-auto" : "w-full max-w-5xl"}`}>
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Liquidación de cobro</h2>
            <p className="text-sm text-zinc-500">{clienteNombre}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setFullscreen(f => !f)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" title={fullscreen ? "Reducir" : "Maximizar"}>{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
            <button onClick={pedirCierre} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* ── 1. Facturas incluidas ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              Facturas incluidas ({facturas.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-800 text-zinc-500 text-xs uppercase">
                    <th className="px-3 py-2 text-left">Comprobante</th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-right">Neto</th>
                    <th className="px-3 py-2 text-right">IVA</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Saldo pend.</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map(f => (
                    <tr key={f.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="px-3 py-2 font-medium">{f.numero}</td>
                      <td className="px-3 py-2">{formatDate(f.fecha)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fc(f.subtotal, m)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fc(f.iva, m)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fc(f.total, m)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-bold">{fc(f.saldo, m)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50 dark:bg-zinc-800 font-bold text-sm">
                    <td className="px-3 py-2" colSpan={2}>Totales</td>
                    <td className="px-3 py-2 text-right font-mono">{fc(totalNeto, m)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fc(totalIva, m)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fc(totalGeneral, m)}</td>
                    <td className="px-3 py-2 text-right font-mono text-orange-600">{fc(totalSaldoBruto, m)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── 1b. Saldo a favor del cliente (cuenta corriente) ── */}
          {totalSF > 0 && (() => {
            const faltaTotal = r2(Object.values(faltaOP).reduce((s, n) => s + n, 0));
            const coincide = faltaTotal > 0 && Math.abs(faltaTotal - totalSF) < 0.01;
            return (
              <section className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={usarSF} onChange={(e) => setUsarSF(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                  <span>El cliente tiene <b className="font-mono">{fc(totalSF, m)}</b> a favor en su cuenta corriente. <b>Aplicar a este cobro</b></span>
                </label>
                <ul className="mt-1 ml-6 list-disc text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                  {fuentesSF.map((f) => <li key={f.id}>{fc(f.monto, m)} — {f.descripcion.replace(/\s*\[[^\]]*\]\s*$/, "")}</li>)}
                </ul>
                {faltaTotal > 0 && !usarSF && (
                  <p className="mt-1 ml-6 font-medium">
                    {coincide
                      ? `La orden de pago descuenta ${fc(faltaTotal, m)}: es justo el saldo a favor. Tildá "Aplicar" si corresponde.`
                      : `La orden de pago paga ${fc(faltaTotal, m)} menos que el saldo de las facturas. Si es por el saldo a favor, tildá "Aplicar".`}
                  </p>
                )}
                {usarSF && aplicacionesSF.length > 0 && (
                  <p className="mt-1 ml-6 font-medium">Se aplica {aplicacionesSF.map((a) => `${fc(a.monto, m)} a la ${a.numero}`).join("; ")}{totalSFAplicado < totalSF ? ` (quedan ${fc(r2(totalSF - totalSFAplicado), m)} a favor)` : ""}.</p>
                )}
              </section>
            );
          })()}

          {/* ── 2. Orden de pago (opcional) ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              Orden de pago y comprobantes <span className="text-zinc-400 font-normal">(opcional)</span>
            </h3>
            <ZonaArchivos onArchivos={(files) => void parseClientPaymentOrder(files)} disabled={parsingOP} className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="N° de orden de pago o referencia del cliente"
                value={opReferencia}
                onChange={e => setOpReferencia(e.target.value)}
                className="w-full max-w-md px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
              />
              <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300 ${parsingOP ? "pointer-events-none opacity-60" : ""}`}>
                {parsingOP ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4" /><Sparkles className="h-3.5 w-3.5" /></>}
                {parsingOP ? "Leyendo con IA..." : "Adjuntar comprobante y leer con IA"}
                <input
                  type="file"
                  multiple
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={parsingOP}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    void parseClientPaymentOrder(files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Arrastrá acá (o pegá con Ctrl+V) la OP del cliente, la transferencia, el cheque o la retención: la IA completa los medios y las retenciones.</p>
            </ZonaArchivos>
            {opFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {opFiles.map((file) => <span key={`${file.name}-${file.size}`} className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><FileCheck2 className="h-3.5 w-3.5" />{file.name}</span>)}
              </div>
            )}
            {opParseMessage && (() => {
              const leyo = opParseMessage.startsWith("IA completó");
              return <p className={`mt-2 text-xs ${!leyo ? "text-red-600 dark:text-red-400" : opParseAviso ? "font-medium text-amber-700 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-400"}`}>{leyo && opParseAviso ? "⚠️ " : ""}{opParseMessage}</p>;
            })()}
            {opConOtras && onCobrarOrdenCompleta && <button type="button" onClick={() => onCobrarOrdenCompleta(opConOtras)} className="mt-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white">Cobrar todas las facturas de esta orden de pago</button>}
          </section>

          {/* ── 2b. Tipo de cambio (solo USD) ── */}
          {isUSD && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
                Tipo de cambio <span className="text-zinc-400 font-normal">(facturas en USD → cobro en ARS)</span>
              </h3>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-[10px] uppercase text-zinc-400 mb-1">Modalidad BNA</label>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => fetchCotizBNA("divisas")} disabled={fetchingCotiz}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${cotizModalidad === "divisas" && cotizNum > 0 ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                      {fetchingCotiz && cotizModalidad === "divisas" ? <RefreshCw size={12} className="animate-spin" /> : "Divisas"}
                    </button>
                    <button type="button" onClick={() => fetchCotizBNA("billetes")} disabled={fetchingCotiz}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${cotizModalidad === "billetes" && cotizNum > 0 ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                      {fetchingCotiz && cotizModalidad === "billetes" ? <RefreshCw size={12} className="animate-spin" /> : "Billetes"}
                    </button>
                  </div>
                </div>
                <div className="w-40">
                  <label className="block text-[10px] uppercase text-zinc-400 mb-1">Cotización ($/US$)</label>
                  <input type="text" inputMode="decimal" placeholder="Ej: 1.250,00"
                    value={cotizacion} onChange={e => setCotizacion(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
                </div>
                {cotizNum > 0 && (
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    {fc(totalSaldo, "USD")} × {cotizNum.toFixed(2)} = <span className="font-bold text-zinc-900 dark:text-white">{fc(totalSaldoARS, "ARS")}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── 3. Medios de pago ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">Medios de pago</h3>
              <button onClick={addMedio} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-semibold">
                <Plus size={14} /> Agregar medio
              </button>
            </div>
            <div className="space-y-2">
              {medios.map(medio => (
                <div key={medio._id} className="flex flex-wrap items-end gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                  <div className="w-44">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Forma de pago</label>
                    <select value={medio.tipo === "cheque_recibido" ? "echeq" : medio.tipo} onChange={e => updateMedio(medio._id, "tipo", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                      {MEDIO_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="w-36">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Importe</label>
                    <div className="flex items-center gap-1">
                    <input type="text" inputMode="decimal" placeholder="0,00"
                      value={medio.monto} onChange={e => updateMedio(medio._id, "monto", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
                    <button type="button" title="Completar con lo que falta cobrar" onClick={() => { const otros = medios.reduce((s, m2) => m2._id === medio._id ? s : s + num(m2.monto), 0); updateMedio(medio._id, "monto", toDecimalInput(Math.max(0, r2(totalEsperado - otros)))); }} className="shrink-0 rounded p-1 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40"><Sparkles size={14} /></button>
                    </div>
                  </div>
                  <div className="w-32">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Fecha</label>
                    <input type="date" value={medio.fecha} onChange={e => updateMedio(medio._id, "fecha", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                  </div>
                  <div className="w-36">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Referencia / N° op.</label>
                    <input type="text" placeholder="N° transf, cheque..."
                      value={medio.referencia} onChange={e => updateMedio(medio._id, "referencia", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Observaciones</label>
                    <input type="text" placeholder="Opcional"
                      value={medio.observaciones} onChange={e => updateMedio(medio._id, "observaciones", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                  </div>
                  {medios.length > 1 && (
                    <button onClick={() => removeMedio(medio._id)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                      <Trash2 size={16} />
                    </button>
                  )}
                  {(medio.tipo === "cheque_recibido" || medio.tipo === "echeq") && (
                    <div className="w-full flex flex-wrap gap-2 mt-1">
                      <div className="w-48">
                        <label className="block text-[10px] uppercase text-zinc-400 mb-1">Banco emisor</label>
                        <input type="text" placeholder="Ej: Galicia"
                          value={medio.cheque_banco} onChange={e => updateMedio(medio._id, "cheque_banco", e.target.value)}
                          className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                      </div>
                      <div className="w-36">
                        <label className="block text-[10px] uppercase text-zinc-400 mb-1">N° cheque</label>
                        <input type="text" placeholder="00000131"
                          value={medio.cheque_numero} onChange={e => updateMedio(medio._id, "cheque_numero", e.target.value)}
                          className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
                      </div>
                      <div className="w-36">
                        <label className="block text-[10px] uppercase text-zinc-400 mb-1">Fecha de pago cheque</label>
                        <input type="date"
                          value={medio.cheque_fecha_pago} onChange={e => updateMedio(medio._id, "cheque_fecha_pago", e.target.value)}
                          className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                      </div>
                      <label className="flex items-center gap-2 self-end rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={medio.tipo === "cheque_recibido"}
                          onChange={(e) => updateMedio(medio._id, "tipo", e.target.checked ? "cheque_recibido" : "echeq")}
                          className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                        />
                        Cheque físico
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 text-right text-sm font-bold">
              Total medios: <span className="font-mono text-orange-600">{fc(totalMedios, isUSD ? "ARS" : m)}</span>
            </div>
          </section>

          {/* ── 4. Retenciones y percepciones ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">
                Retenciones, percepciones y descuentos
              </h3>
              <button onClick={addRetencion} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-semibold">
                <Plus size={14} /> Agregar
              </button>
            </div>
            {retenciones.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">Sin retenciones ni percepciones. Hacé clic en &quot;Agregar&quot; si corresponde.</p>
            ) : (
              <div className="space-y-2">
                {retenciones.map(ret => (
                  <div key={ret._id} className="flex flex-wrap items-end gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <div className="w-48">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">Tipo</label>
                      <select value={ret.tipo} onChange={e => updateRetencion(ret._id, "tipo", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                        {RETENCION_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="w-32">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">Organismo</label>
                      <input type="text" placeholder="Opcional"
                        value={ret.organismo} onChange={e => updateRetencion(ret._id, "organismo", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                    </div>
                    <div className="w-36">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">N° certificado</label>
                      <input type="text" placeholder="Opcional"
                        value={ret.certificado} onChange={e => updateRetencion(ret._id, "certificado", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                    </div>
                    <div className="w-32">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">Importe</label>
                      <input type="text" inputMode="decimal" placeholder="0,00"
                        value={ret.monto} onChange={e => updateRetencion(ret._id, "monto", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
                    </div>
                    <div className="flex-1 min-w-[100px]">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">Observaciones</label>
                      <input type="text" placeholder="Opcional"
                        value={ret.observaciones} onChange={e => updateRetencion(ret._id, "observaciones", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                    </div>
                    <button onClick={() => removeRetencion(ret._id)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <div className="mt-2 text-right text-sm font-bold">
                  Total retenciones/percepciones: <span className="font-mono text-orange-600">{fc(totalRetenciones, isUSD ? "ARS" : m)}</span>
                </div>
              </div>
            )}
          </section>

          {/* ── 5. Resumen final ── */}
          <section className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">Resumen</h3>
            <div className="max-w-md ml-auto space-y-1 text-sm">
              <div className="flex justify-between"><span>Total facturas (saldo)</span><span className="font-mono">{fc(totalSaldoBruto, m)}</span></div>
              {totalSFAplicado > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><span>(-) Saldo a favor aplicado</span><span className="font-mono">{fc(totalSFAplicado, m)}</span></div>
              )}
              {isUSD && cotizNum > 0 && (
                <div className="flex justify-between text-zinc-500"><span>Conversión a ARS (× {cotizNum.toFixed(2)})</span><span className="font-mono">{fc(totalSaldoARS, "ARS")}</span></div>
              )}
              {totalRetenciones > 0 && (
                <div className="flex justify-between text-zinc-500"><span>(-) Retenciones / percepciones</span><span className="font-mono">{fc(totalRetenciones, isUSD ? "ARS" : m)}</span></div>
              )}
              <div className="flex justify-between items-center font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1">
                <span>Total esperado a cobrar</span>
                <span className="flex items-center gap-1.5">
                  <button type="button" title="Copiar monto" onClick={() => { navigator.clipboard.writeText(totalEsperado.toFixed(2)); }}
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600"><Copy size={13} /></button>
                  <button type="button" title="Completar en medio de pago" onClick={() => { if (medios.length > 0) { const remaining = r2(totalEsperado - medios.slice(1).reduce((s, m2) => s + num(m2.monto), 0)); updateMedio(medios[0]._id, "monto", toDecimalInput(Math.max(0, remaining))); } }}
                    className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-400 hover:text-orange-600"><ArrowDown size={13} /></button>
                  <span className="font-mono">{fc(totalEsperado, isUSD ? "ARS" : m)}</span>
                </span>
              </div>
              <div className="flex justify-between"><span>Total recibido (medios)</span><span className="font-mono">{fc(totalMedios, isUSD ? "ARS" : m)}</span></div>
              <div className={`flex justify-between font-bold text-base pt-1 border-t border-zinc-300 dark:border-zinc-600 ${
                Math.abs(diferencia) < 0.01 ? "text-green-600" : "text-amber-600"
              }`}>
                <span>Diferencia</span>
                <span className="flex items-center gap-1.5">
                  <button type="button" title="Copiar pendiente" onClick={() => { navigator.clipboard.writeText(Math.abs(diferencia).toFixed(2)); }}
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600"><Copy size={13} /></button>
                  <button type="button" title="Completar en medio de pago" onClick={() => { if (medios.length > 0 && diferencia > 0.01) { const remaining = r2(totalEsperado - medios.slice(1).reduce((s, m2) => s + num(m2.monto), 0)); updateMedio(medios[0]._id, "monto", toDecimalInput(Math.max(0, remaining))); } }}
                    className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-400 hover:text-orange-600"><ArrowDown size={13} /></button>
                  <span className="font-mono">{fc(diferencia, isUSD ? "ARS" : m)}</span>
                </span>
              </div>
            </div>
            {hayDiferencia && totalMedios > 0 && (
              <div className="mt-3 ml-auto max-w-md rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-semibold">
                  {reparto.falta > 0 ? `Faltan ${fc(reparto.falta, m)}: podés confirmar igual.` : reparto.sobra > 0 ? `Sobran ${fc(reparto.sobra, m)}: quedan a favor del cliente en su cuenta corriente.` : "Hay diferencia: podés confirmar igual."}
                </p>
                {reparto.falta > 0 && !isUSD && (
                  <div className="mt-2 space-y-1">
                    <label className="flex items-center gap-2">
                      <input type="radio" name="destino-diferencia" checked={destinoDiferencia === "factura"} onChange={() => setDestinoDiferencia("factura")} />
                      Saldo en la factura más nueva
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="destino-diferencia" checked={destinoDiferencia === "cc"} onChange={() => setDestinoDiferencia("cc")} />
                      Diferencia a la cuenta corriente (las facturas quedan pagadas)
                    </label>
                  </div>
                )}
                {reparto.falta > 0 && usarDiferenciaCC && (
                  <p className="mt-2">Las {facturas.length} facturas quedan <b>pagadas</b> y {fc(diferenciaCC, m)} quedan como deuda del cliente en su cuenta corriente.</p>
                )}
                {reparto.falta > 0 && !usarDiferenciaCC && (
                  <table className="mt-2 w-full">
                    <tbody>
                      {reparto.filas.map((f) => (
                        <tr key={f.id}>
                          <td className="py-0.5">{f.numero}</td>
                          <td className="py-0.5 text-right font-mono">{fc(f.aplicado, m)}</td>
                          <td className="py-0.5 pl-2 text-right">{f.queda > 0 ? <span className="font-semibold">queda {fc(f.queda, m)}</span> : "pagada"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={dejarEnRevisar} onChange={(e) => setDejarEnRevisar(e.target.checked)} />
                  Dejar en Revisar: diferencia a confirmar (¿retenciones?)
                </label>
              </div>
            )}
          </section>

          {/* ── Error ── */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
              <AlertCircle size={16} /> {error}
            </div>
          )}
        </div>

        {/* ── Footer actions ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
          <div className="text-xs text-zinc-400">
            {soloSaldoFavor
              ? "El saldo a favor cubre todo: se confirma sin plata (no se hace recibo)"
              : Math.abs(diferencia) < 0.01
                ? "La diferencia es $0 — listo para confirmar"
                : "Hay diferencia: al confirmar te avisa cómo queda cada factura"}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">
              Cancelar
            </button>
            <button onClick={handleConfirmar} disabled={!canConfirm}
              className="px-6 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Registrando..." : soloSaldoFavor ? "Aplicar saldo a favor" : "Confirmar cobro"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
