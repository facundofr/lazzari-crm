"use client";

/**
 * Ventana ÚNICA para emitir una factura de venta (ARCA o manual sin CAE).
 * La usan Facturación (factura libre, se elige el cliente) y Ventas (factura de un presupuesto).
 * Con `presupuesto`: cliente fijo, renglones y OC del PR, y al emitir el PR pasa a "facturado".
 * Tipo de dólar según la ficha del cliente, sin fecha anterior a la OC y sugerencia de fecha (lib/factura-moneda).
 * Se monta solo cuando está abierta: cada apertura arranca de cero.
 */

import { AvisoBCRA } from "@/components/clientes/bcra-card";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { canOverrideInvoiceRate } from "@/lib/invoice-rate-permission";
import { useFiscalDateLimits } from "@/lib/use-fiscal-date-limits";
import { beginInvoiceIntent, postInvoiceIntent } from "@/lib/invoice-intent";
import { useFceCheck, fceTotalArs } from "@/lib/use-fce-check";
import { precioUnitarioParaFactura } from "@/lib/precio-factura";
import { abrirFacturaPDF } from "@/lib/factura-pdf";
import {
  CONDICIONES_VENTA, calcFechaVencimiento, condicionVentaCliente, puntosVentaSociedad, tipoFacturaPorCondicionIva,
  precioNetoItemPresupuesto, convertirItemsEntreAyB, convertirPrecioMoneda,
} from "@/lib/factura-condicion";
import {
  type Modalidad, puedeDestrabarFactura, modalidadFicha, modalidadFactura, modalidadContraFicha, nombreModalidad,
  fechaMinimaFactura, fechaAntesDeOc, sugerenciaFechaFactura, leyendaCotizacion, observacionesConCotizacion,
} from "@/lib/factura-moneda";
import {
  AlertTriangle, CheckCircle2, Download, FileCheck, Loader2, Maximize2, Minimize2, Minus, Plus, Search, ShieldCheck, X, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { observacionesParaCliente } from "@/lib/observaciones-cliente";

export interface EmitItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
}

export interface PresupuestoAFacturar {
  id: string;
  numero: string;
  cliente_id: string;
  moneda: string;
  cotizacion_modalidad?: "divisas" | "billetes" | null;
  modalidad_emision?: string | null;
  oc_cliente: string | null;
  oc_cliente_fecha?: string | null;
  archivo_url?: string | null;
  observaciones?: string | null;
  cliente: {
    razon_social: string; cuit: string | null; condicion_iva: string | null;
    forma_pago?: string | null; dias_cuenta_corriente?: number | null; limite_credito?: number | null;
    moneda_predeterminada?: string | null;
  } | null;
  items: { descripcion: string; cantidad: number; precio_venta: number | null; iva_porcentaje: number; total: number | null }[];
}

interface ClienteOption {
  id: string;
  razon_social: string;
  cuit: string;
  condicion_iva: string | null;
  limite_credito?: number | null;
  dias_cuenta_corriente?: number | null;
  forma_pago?: string | null;
  moneda_predeterminada?: string | null;
}

const esA = (tipo: string) => tipo.endsWith("A"); // X se cobra como B: precio final

const INPUT = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm dark:text-white";
const LABEL = "block text-xs font-medium mb-0.5 text-zinc-600 dark:text-zinc-300";

function formatComprobante(tipo: string, pv: number, num: number) {
  return `${tipo} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
}

export function EmitirFacturaModal({
  presupuesto, arcaCertOk, saldoClienteArs, onClose, onEmitted,
}: {
  presupuesto?: PresupuestoAFacturar | null;
  /** false = la sociedad no tiene certificado ARCA: solo manual. */
  arcaCertOk?: boolean | null;
  /** Saldo real en pesos del cliente, para el aviso de límite de crédito (null si no se sabe). */
  saldoClienteArs?: (clienteId: string) => number | null;
  onClose: () => void;
  onEmitted?: (facturaId: string) => void;
}) {
  const { sociedadActiva, profile } = useUser();
  const pr = presupuesto || null;
  const canOverrideRate = canOverrideInvoiceRate(profile?.email);
  const puedeDestrabar = puedeDestrabarFactura(profile?.role);
  const pvOpciones = puntosVentaSociedad(sociedadActiva?.nombre);
  const intentScope = pr ? `presupuesto:${sociedadActiva?.id}:${pr.id}` : `facturacion:${sociedadActiva?.id}:emit`;
  const sourceIsManual = pr?.modalidad_emision === "manual";
  const forceManual = arcaCertOk === false;
  const tipoCliente = pr ? tipoFacturaPorCondicionIva(pr.cliente?.condicion_iva) : "FB";
  const ocFecha = pr?.oc_cliente_fecha ? String(pr.oc_cliente_fecha).slice(0, 10) : null;

  const [emitManual, setEmitManual] = useState(forceManual || sourceIsManual);
  const [rateOverride, setRateOverride] = useState(false);
  const [emitFullscreen, setEmitFullscreen] = useState(false);
  const [emitStep, setEmitStep] = useState<"form" | "emitting" | "success" | "error">("form");
  const [emitResult, setEmitResult] = useState<any>(null);
  const [emitError, setEmitError] = useState("");
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [emitClienteSearch, setEmitClienteSearch] = useState("");
  const [cotizBna, setCotizBna] = useState<{ valor_venta: number; fecha: string; fuente: string; modalidad: string } | null>(null);
  const [cotizBnaLoading, setCotizBnaLoading] = useState(false);
  const [cotizError, setCotizError] = useState("");
  const cotizRequest = useRef(0);
  // Tipo de dólar: manda la ficha del cliente; si no dice, el del presupuesto.
  const [modalidad, setModalidad] = useState<Modalidad>(() => modalidadFactura(pr?.cliente?.moneda_predeterminada, pr?.cotizacion_modalidad));
  const [permitirAntesOc, setPermitirAntesOc] = useState(false);
  const [cotizFecha, setCotizFecha] = useState("");
  const [latestFacturaDate, setLatestFacturaDate] = useState("");
  const [descargando, setDescargando] = useState(false);
  const [emitData, setEmitData] = useState(() => {
    const manual = forceManual || sourceIsManual;
    const tipo = manual ? "X" : tipoCliente;
    const hoy = todayAR();
    const condicion = pr ? condicionVentaCliente(pr.cliente?.dias_cuenta_corriente, pr.cliente?.forma_pago) : "Cta. Cte.";
    // Precio de cada renglón según cómo lo guardó el PR (lib/precio-factura). X va con precio final, como B.
    const items: EmitItem[] = pr ? pr.items.map(it => {
      const iva = Number(it.iva_porcentaje ?? 21);
      return {
        descripcion: it.descripcion,
        cantidad: Number(it.cantidad),
        precio_unitario: precioUnitarioParaFactura({ tipo: manual ? "FB" : tipo, sourceIsManual, precioNeto: precioNetoItemPresupuesto(it), ivaPorcentaje: iva }),
        iva_porcentaje: iva,
      };
    }) : [];
    return {
      tipo,
      cliente_id: pr?.cliente_id || "",
      punto_venta: manual ? 0 : pvOpciones[0],
      numero_manual: "",
      moneda: (pr?.moneda === "USD" ? "USD" : "ARS") as "ARS" | "USD",
      tipo_cambio: 0,
      fecha: hoy,
      condicion_venta: condicion,
      fecha_vencimiento: calcFechaVencimiento(condicion, hoy, pr?.cliente?.dias_cuenta_corriente),
      fce_cbu: "",
      fce_transmision: "",
      // Las observaciones del PR (PO, SES, etc.) vienen precargadas y se pueden editar; los renglones automáticos de costo/margen nunca pasan.
      observaciones: pr ? observacionesParaCliente(pr.observaciones) : "",
      items: items.length > 0 ? items : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }],
    };
  });

  const editRate = emitManual || (canOverrideRate && rateOverride);
  const isFacturaA = esA(emitData.tipo);
  const isUSD = emitData.moneda === "USD";
  const tc = emitData.tipo_cambio || 0;
  // Los renglones están en la moneda del PR; si la factura va en otra moneda se convierten al emitir.
  const monedaOrigen = pr ? (pr.moneda === "USD" ? "USD" : "ARS") : emitData.moneda;
  const convierteMoneda = monedaOrigen !== emitData.moneda;
  const needsRate = isUSD || convierteMoneda;
  const itemsFactura = useMemo(
    () => emitData.items.map(it => ({ ...it, precio_unitario: convertirPrecioMoneda(it.precio_unitario, monedaOrigen, emitData.moneda, tc) })),
    [emitData.items, monedaOrigen, emitData.moneda, tc],
  );
  const clienteElegido = pr ? null : clientes.find(c => c.id === emitData.cliente_id) || null;
  const diasCliente = pr?.cliente?.dias_cuenta_corriente ?? clienteElegido?.dias_cuenta_corriente ?? null;
  const fichaMoneda = pr ? pr.cliente?.moneda_predeterminada ?? null : clienteElegido?.moneda_predeterminada ?? null;
  const fichaModalidad = modalidadFicha(fichaMoneda);

  // ── Apertura: intención anti-duplicados, clientes y número ─────
  useEffect(() => {
    beginInvoiceIntent(intentScope);
    if (!pr) {
      const q = supabase.from("clientes").select("id, razon_social, cuit, condicion_iva, limite_credito, dias_cuenta_corriente, forma_pago, moneda_predeterminada").eq("activo", true).order("razon_social");
      (sociedadActiva?.id ? q.eq("sociedad_id" as any, sociedadActiva.id) : q)
        .then(({ data }) => { if (data) setClientes(data as unknown as ClienteOption[]); });
    }
    void fetchNumero(emitData.tipo, emitData.punto_venta);
    // Solo al abrir.
  }, []);

  async function fetchNumero(tipo: string, pv: number) {
    try {
      if (!sociedadActiva?.id) return;
      const { data: last } = await supabase.from("facturas").select("numero").eq("sociedad_id" as any, sociedadActiva.id).eq("tipo" as any, tipo).eq("punto_venta" as any, pv).order("numero", { ascending: false }).limit(1);
      setEmitData(prev => ({ ...prev, numero_manual: last && last.length > 0 ? String(Number((last[0] as any).numero) + 1) : "1" }));
    } catch { /* ignore */ }
  }

  // ── Fechas permitidas ──────────────────────────────────────────
  const minFecha = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    const fallback = d.toISOString().slice(0, 10);
    return latestFacturaDate && latestFacturaDate > fallback ? latestFacturaDate : fallback;
  }, [latestFacturaDate]);
  const fiscalDates = useFiscalDateLimits(!emitManual, sociedadActiva?.id, emitData.punto_venta, emitData.tipo);
  const dateWindow = new Date(`${todayAR()}T12:00:00Z`);
  dateWindow.setUTCDate(dateWindow.getUTCDate() - 5);
  const dateWindowMin = dateWindow.toISOString().slice(0, 10);
  const fiscalMinDate = fiscalDates.minDate && fiscalDates.minDate > dateWindowMin ? fiscalDates.minDate : dateWindowMin;
  const fiscalDateBlocked = !emitManual && (!fiscalDates.ready || emitData.fecha < fiscalMinDate || emitData.fecha > todayAR());
  // OC del cliente: no se factura antes de su fecha (administración lo puede destrabar).
  const ocActiva = permitirAntesOc ? null : ocFecha;
  const minBase = emitManual ? minFecha : fiscalMinDate;
  const minPermitida = fechaMinimaFactura(minBase, ocActiva);
  const ocBlocked = fechaAntesDeOc(emitData.fecha, ocActiva);
  const sugerenciaFecha = (emitManual || fiscalDates.ready)
    ? sugerenciaFechaFactura({ fecha: emitData.fecha, hoy: todayAR(), minFiscal: minBase, ocFecha: ocActiva })
    : null;

  function cambiarFecha(fecha: string) {
    setEmitData(p => ({ ...p, fecha, fecha_vencimiento: calcFechaVencimiento(p.condicion_venta, fecha, diasCliente) }));
  }

  function destrabarOc() {
    if (!puedeDestrabar) return;
    if (!confirm(`La OC del cliente es del ${formatDate(ocFecha!)}.\n\n¿Permitir facturar con fecha anterior a la OC?`)) return;
    setPermitirAntesOc(true);
  }

  useEffect(() => {
    if (!sociedadActiva?.id || !emitData.tipo) return;
    (async () => {
      const { data } = await (supabase as any).from("facturas")
        .select("fecha")
        .eq("sociedad_id", sociedadActiva.id)
        .eq("tipo", emitManual ? "X" : emitData.tipo)
        .eq("punto_venta", emitData.punto_venta)
        .order("fecha", { ascending: false }).limit(1).maybeSingle();
      setLatestFacturaDate(data?.fecha || "");
    })();
  }, [emitManual, emitData.tipo, emitData.punto_venta, sociedadActiva?.id]);

  // ── Moneda y tipo de dólar ─────────────────────────────────────
  function elegirMoneda(valor: string) {
    if (valor === "ARS") { setEmitData(p => ({ ...p, moneda: "ARS" })); return; }
    const nueva: Modalidad = valor === "USD:billetes" ? "billetes" : "divisas";
    if (modalidadContraFicha(fichaMoneda, nueva)) {
      const ficha = nombreModalidad(fichaModalidad!);
      if (!puedeDestrabar) { alert(`Este cliente se factura en dólar ${ficha} (ficha del cliente). Solo administración lo puede cambiar.`); return; }
      if (!confirm(`Según la ficha, este cliente se factura en dólar ${ficha}.\n\n¿Facturar en dólar ${nombreModalidad(nueva)} igual?`)) return;
    }
    setModalidad(nueva);
    setEmitData(p => ({ ...p, moneda: "USD" }));
  }

  // ── Cotización ─────────────────────────────────────────────────
  async function fetchCotizBna(fecha?: string) {
    const requestId = ++cotizRequest.current;
    setCotizBnaLoading(true);
    setCotizError("");
    setCotizBna(null);
    setEmitData(p => ({ ...p, tipo_cambio: 0 }));
    try {
      const params = new URLSearchParams({ modalidad });
      // Por defecto: último día hábil del BNA anterior a la fecha de la factura (saltea feriados).
      // Solo una fecha explícita en el selector cambia esta regla.
      const fechaExplicita = editRate ? fecha || cotizFecha : "";
      if (fechaExplicita) params.set("fecha", fechaExplicita);
      else params.set("fecha_factura", emitData.fecha);
      const res = await fetch(`/api/cotizacion-bna?${params}`);
      const data = await res.json();
      if (requestId !== cotizRequest.current) return;
      if (!res.ok) throw new Error(data.error || "No se pudo consultar la cotización.");
      if (fechaExplicita && (data.stale || data.fecha !== fechaExplicita)) {
        throw new Error(`La cotización disponible es del ${data.fecha}, no del ${params.get("fecha")}. No se aplicó; ingresá el valor correcto manualmente.`);
      }
      if (Number(data.valor_venta) > 0) {
        setCotizBna({ valor_venta: data.valor_venta, fecha: data.fecha, fuente: data.fuente, modalidad: data.modalidad || modalidad });
        setEmitData((p) => ({ ...p, tipo_cambio: data.valor_venta }));
      } else throw new Error("La cotización recibida no es válida. Ingresá el valor correcto manualmente.");
    } catch (error) { if (requestId === cotizRequest.current) setCotizError(error instanceof Error ? error.message : "No se pudo consultar la cotización. Ingresala manualmente."); } finally {
      if (requestId === cotizRequest.current) setCotizBnaLoading(false);
    }
  }

  // Automática: BNA venta del tipo de dólar elegido, día hábil anterior a la fecha de la factura (se rehace al cambiar la fecha).
  // En manual también se trae sola (se puede corregir a mano); solo "Modificar (Augusto)" en ARCA la deja a mano.
  const rateAMano = editRate && !emitManual;
  useEffect(() => {
    if (!needsRate) return;
    if (rateAMano) { setCotizBnaLoading(false); return; }
    void fetchCotizBna();
    return () => { cotizRequest.current += 1; };
  }, [needsRate, emitData.fecha, rateAMano, modalidad]);

  // ── FCE ────────────────────────────────────────────────────────
  const fceApplies = !emitManual && ["FA", "FB", "FCEA", "FCEB"].includes(emitData.tipo);
  const fceCheck = useFceCheck(fceApplies, sociedadActiva?.id, emitData.cliente_id, emitData.fecha);
  const fceRateReady = !needsRate || (tc > 0 && !cotizBnaLoading && (editRate || !!cotizBna));
  const fceRequired = fceCheck.ready && fceCheck.obligado && fceTotalArs(itemsFactura, isFacturaA, isUSD ? tc : 1) >= (fceCheck.montoDesde || Infinity);
  const fceExpectedTipo = isFacturaA ? (fceRequired ? "FCEA" : "FA") : (fceRequired ? "FCEB" : "FB");
  const fceBlocked = fceApplies && (!fceCheck.ready || !fceRateReady || emitData.tipo !== fceExpectedTipo);
  useEffect(() => {
    if (!fceApplies || !fceCheck.ready || !fceRateReady) return;
    if (emitData.tipo !== fceExpectedTipo) setEmitData(p => ({ ...p, tipo: fceExpectedTipo }));
  }, [fceApplies, fceCheck.ready, fceRateReady, emitData.tipo, fceExpectedTipo]);

  // ── Renglones y totales ────────────────────────────────────────
  const addItem = () => setEmitData((p) => ({ ...p, items: [...p.items, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }] }));
  const removeItem = (idx: number) => setEmitData((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx: number, field: keyof EmitItem, value: string | number) => {
    setEmitData((p) => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [field]: value } : it) }));
  };

  /** Cambia el tipo y pasa los precios entre neto (A) y final (B/X) sin cambiar el total. */
  function cambiarTipo(nuevo: string, extra: Partial<typeof emitData> = {}) {
    setEmitData(p => ({ ...p, ...extra, tipo: nuevo, items: convertirItemsEntreAyB(p.items, esA(p.tipo), esA(nuevo)) }));
  }

  const emitTotals = itemsFactura.reduce((acc, it) => {
    if (emitManual || emitData.tipo === "X") {
      const total = it.cantidad * it.precio_unitario;
      return { neto: acc.neto + total, iva: acc.iva, total: acc.total + total };
    }
    if (isFacturaA) {
      const neto = it.cantidad * it.precio_unitario;
      const iva = neto * (it.iva_porcentaje / 100);
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + neto + iva };
    }
    const total = it.cantidad * it.precio_unitario;
    const ivaPct = it.iva_porcentaje ?? 21;
    const neto = Math.round(total / (1 + ivaPct / 100) * 100) / 100;
    const iva = Math.round((total - neto) * 100) / 100;
    return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + total };
  }, { neto: 0, iva: 0, total: 0 });

  const emitFilteredClientes = useMemo(() => {
    const term = emitClienteSearch.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (!term) return clientes;
    return clientes.filter(c =>
      c.razon_social.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(term) ||
      (c.cuit || "").includes(term)
    );
  }, [clientes, emitClienteSearch]);

  const limiteCliente = pr ? pr.cliente?.limite_credito : clienteElegido?.limite_credito;
  const saldoCliente = emitData.cliente_id && emitData.cliente_id !== "consumidor_final" && saldoClienteArs ? saldoClienteArs(emitData.cliente_id) : null;
  const alcanzoLimite = !!limiteCliente && saldoCliente != null && saldoCliente >= Number(limiteCliente);

  // Leyenda de la cotización usada: va sola en las observaciones de la factura.
  const leyendaTc = needsRate && tc > 0
    ? leyendaCotizacion({
      modalidad, valor: tc,
      fecha: cotizBna?.fecha || (editRate ? cotizFecha || null : null),
      conversion: convierteMoneda ? { desde: monedaOrigen, hacia: emitData.moneda } : null,
    })
    : null;

  // ── Emitir ─────────────────────────────────────────────────────
  function validarComun(): string | null {
    if (!emitData.cliente_id) return "Selecciona un cliente";
    if (emitData.items.some((it) => !it.descripcion || !(it.precio_unitario > 0) || !(it.cantidad > 0))) return "Completá todos los ítems con descripción, cantidad mayor a 0 y precio.";
    if (needsRate && !(tc > 0)) return convierteMoneda ? `Ingresá el tipo de cambio para pasar de ${monedaOrigen} a ${emitData.moneda}.` : "Factura en USD requiere tipo de cambio";
    if (ocBlocked) return `La OC del cliente es del ${formatDate(ocFecha!)}: la factura no puede tener fecha anterior.${puedeDestrabar ? " Podés destrabarlo al lado de la fecha." : ""}`;
    return null;
  }

  /** Datos que van igual en ARCA y manual (incluye el presupuesto y su OC). */
  function datosComunes() {
    return {
      cliente_id: emitData.cliente_id,
      punto_venta: emitData.punto_venta,
      moneda: emitData.moneda,
      tipo_cambio: isUSD ? tc : null,
      cotizacion_modalidad: isUSD ? modalidad : null,
      fecha: emitData.fecha || null,
      condicion_venta: emitData.condicion_venta || null,
      fecha_vencimiento: emitData.fecha_vencimiento || null,
      observaciones: observacionesConCotizacion(emitData.observaciones, leyendaTc) || null,
      items: itemsFactura,
      sociedad_id: sociedadActiva?.id,
      presupuesto_id: pr?.id || undefined,
      oc_cliente: pr?.oc_cliente || null,
      oc_cliente_fecha: pr?.oc_cliente_fecha || null,
    };
  }

  async function postFactura(body: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await postInvoiceIntent(intentScope, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { res, data: await res.json() };
  }

  /** Después de emitir: el presupuesto pasa a "facturado". */
  async function marcarPresupuestoFacturado() {
    if (!pr || !sociedadActiva?.id) return;
    const { error } = await (supabase as any).from("presupuestos").update({ estado: "facturado" }).eq("id", pr.id).eq("sociedad_id", sociedadActiva.id);
    if (error) console.error("Error al marcar PR como facturado:", error.message);
  }

  const handleEmit = async () => {
    const error = validarComun();
    if (error) { setEmitError(error); return; }
    if (fceBlocked) { setEmitError(fceCheck.error || "Esperá la verificación de FCE y de la cotización antes de emitir."); return; }
    if (fiscalDateBlocked) { setEmitError(fiscalDates.error || `Elegí una fecha válida desde ${fiscalMinDate}; esperá la verificación de ARCA si está en curso.`); return; }
    if (["FCEA", "FCEB"].includes(emitData.tipo)) {
      if (!emitData.fecha_vencimiento || emitData.fecha_vencimiento < emitData.fecha || emitData.fecha_vencimiento < todayAR()) {
        setEmitError("La FCE requiere un vencimiento igual o posterior a hoy y a la fecha de emisión."); return;
      }
      if (!/^\d{22}$/.test(emitData.fce_cbu) || !["SCA", "ADC"].includes(emitData.fce_transmision)) {
        setEmitError("La FCE requiere la CBU del emisor (22 dígitos) y elegir SCA o ADC."); return;
      }
    }
    setEmitStep("emitting");
    setEmitError("");
    try {
      const { data } = await postFactura({
        ...datosComunes(),
        tipo: emitData.tipo,
        cotizacion_override: canOverrideRate && rateOverride,
        cotizacion_fecha: cotizFecha || cotizBna?.fecha || null,
        fce_cbu: ["FCEA", "FCEB"].includes(emitData.tipo) ? emitData.fce_cbu : undefined,
        fce_transmision: ["FCEA", "FCEB"].includes(emitData.tipo) ? emitData.fce_transmision : undefined,
      });
      if (data.success) {
        await marcarPresupuestoFacturado();
        setEmitResult({ ...data.factura, warnings: data.warnings, warning: data.warning });
        setEmitStep("success");
        onEmitted?.(data.factura.id);
      } else {
        setEmitError(data.error || "Error al emitir factura");
        setEmitStep("error");
      }
    } catch (err: unknown) {
      setEmitError(err instanceof Error ? err.message : "Error de conexion");
      setEmitStep("error");
    }
  };

  const handleEmitManual = async () => {
    const error = validarComun();
    if (error) { setEmitError(error); return; }
    if (emitData.fecha < minFecha) { setEmitError(`La fecha no puede ser anterior a la última factura (${minFecha})`); return; }
    const numManual = Number(emitData.numero_manual);
    if (!numManual || numManual <= 0) { setEmitError("Ingresa el numero de comprobante"); return; }
    setEmitStep("emitting");
    setEmitError("");
    try {
      const { res, data } = await postFactura({ ...datosComunes(), manual: true, tipo: "X", numero_manual: numManual });
      if (!res.ok || !data.success) throw new Error(data.error || "Error al guardar factura manual");
      await marcarPresupuestoFacturado();
      setEmitResult({
        id: data.factura?.id,
        comprobante: formatComprobante("X", emitData.punto_venta, numManual),
        cae: null,
        cae_vencimiento: null,
        total: data.factura?.total ?? emitTotals.total,
        manual: true,
      });
      setEmitStep("success");
      if (data.factura?.id) onEmitted?.(data.factura.id);
    } catch (err: unknown) {
      setEmitError(err instanceof Error ? err.message : "Error al guardar factura");
      setEmitStep("error");
    }
  };

  async function descargarPDF() {
    if (!emitResult?.id || !sociedadActiva || descargando) return;
    setDescargando(true);
    try { await abrirFacturaPDF(emitResult.id, sociedadActiva); }
    catch (error) { console.error("Error descargando factura:", error); alert("No se pudo descargar la factura. Intentá nuevamente."); }
    finally { setDescargando(false); }
  }

  const cerrar = () => { if (emitStep !== "emitting") onClose(); };
  const clienteNombre = pr ? pr.cliente?.razon_social || "" : emitData.cliente_id === "consumidor_final" ? "Consumidor Final" : clienteElegido?.razon_social || "";
  const monedaTotal = isUSD ? "USD" : "ARS";
  const valorMoneda = isUSD ? `USD:${modalidad}` : "ARS";
  const emitDisabled = emitManual ? ocBlocked : (ocBlocked || fiscalDateBlocked || fceBlocked || (needsRate && (cotizBnaLoading || (!editRate && !cotizBna) || tc <= 0)));

  const toggleArca = (
    <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5">
      <button
        onClick={() => {
          if (!emitManual) return;
          const tipoArca = pr ? tipoCliente : "FA";
          setEmitManual(false);
          cambiarTipo(tipoArca, { punto_venta: pvOpciones[0] });
          void fetchNumero(tipoArca, pvOpciones[0]);
        }}
        disabled={forceManual}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${!emitManual ? "bg-orange-500 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"} disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <ShieldCheck className="h-3.5 w-3.5" /> ARCA
      </button>
      <button
        onClick={() => {
          if (emitManual) return;
          setEmitManual(true);
          cambiarTipo("X", { punto_venta: 0 });
          void fetchNumero("X", 0);
        }}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${emitManual ? "bg-zinc-700 text-white dark:bg-zinc-600" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
      >
        <FileCheck className="h-3.5 w-3.5" /> Manual
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className={`bg-white dark:bg-zinc-900 rounded-xl shadow-2xl flex flex-col overflow-hidden ${emitFullscreen ? "fixed inset-2 max-w-none max-h-none mx-0" : "w-full max-w-4xl mx-2 sm:mx-4 max-h-[94vh]"}`}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold dark:text-white truncate">{emitManual ? "Factura manual" : "Emitir factura ARCA"}{pr ? ` — ${pr.numero}` : ""}</h2>
            <p className="text-xs text-zinc-400">{emitManual ? "Se guarda sin autorizar en ARCA (sin CAE)" : "Se autoriza en tiempo real con ARCA"}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {emitStep === "form" && toggleArca}
            <button onClick={() => setEmitFullscreen(f => !f)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400" title={emitFullscreen ? "Restaurar" : "Maximizar"}>
              {emitFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button onClick={cerrar} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {emitStep === "form" && (<>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {emitError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-1.5">{emitError}</div>}
            {emitData.cliente_id && emitData.cliente_id !== "consumidor_final" && <AvisoBCRA clienteId={emitData.cliente_id} />}
            {forceManual && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> ARCA no configurado para esta sociedad — solo modo manual disponible.
              </p>
            )}

            {/* Tipo + Cliente + PV + Número */}
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-12 sm:col-span-3">
                <label className={LABEL}>Tipo *</label>
                <select value={emitData.tipo} disabled={emitManual} onChange={(e) => {
                  const nuevo = e.target.value;
                  cambiarTipo(nuevo);
                  void fetchNumero(nuevo, emitData.punto_venta);
                }} className={`${INPUT} disabled:cursor-not-allowed disabled:bg-zinc-100 dark:disabled:bg-zinc-800/60`}>
                  {emitManual ? (
                    <option value="X">Comprobante X (sin IVA)</option>
                  ) : pr ? (<>
                    {tipoCliente === "FA" && <option value="FA">Factura A (discrimina IVA)</option>}
                    <option value="FB">Factura B (precio final)</option>
                    {tipoCliente === "FA" && <option value="FCEA">FCE A (MiPyMEs)</option>}
                    <option value="FCEB">FCE B (MiPyMEs)</option>
                  </>) : (<>
                    <optgroup label="Facturas">
                      <option value="FA">Factura A</option>
                      <option value="FB">Factura B</option>
                    </optgroup>
                    <optgroup label="Factura de Crédito Electrónica">
                      <option value="FCEA">FCE A (MiPyMEs)</option>
                      <option value="FCEB">FCE B (MiPyMEs)</option>
                    </optgroup>
                    <optgroup label="Notas de crédito">
                      <option value="NCA">NC A</option>
                      <option value="NCB">NC B</option>
                      <option value="NCEA">NCE A (MiPyMEs)</option>
                      <option value="NCEB">NCE B (MiPyMEs)</option>
                    </optgroup>
                  </>)}
                </select>
              </div>
              <div className="col-span-12 sm:col-span-5 relative">
                <label className={LABEL}>Cliente *</label>
                {pr ? (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1.5 min-w-0">
                    <p className="text-sm font-medium dark:text-white truncate" title={clienteNombre}>{clienteNombre}</p>
                    <p className="text-[11px] leading-tight text-zinc-400">{pr.cliente?.condicion_iva || "—"} · {pr.cliente?.cuit || "Sin CUIT"}{fichaModalidad ? ` · dólar ${nombreModalidad(fichaModalidad)}` : ""}</p>
                  </div>
                ) : (<>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                    <input
                      value={emitData.cliente_id ? clienteNombre : emitClienteSearch}
                      onChange={(e) => {
                        setEmitClienteSearch(e.target.value);
                        if (emitData.cliente_id) setEmitData(p => ({ ...p, cliente_id: "" }));
                      }}
                      onFocus={() => { if (emitData.cliente_id) { setEmitClienteSearch(""); setEmitData(p => ({ ...p, cliente_id: "" })); } }}
                      placeholder="Buscar cliente por nombre o CUIT..."
                      autoComplete="off"
                      className={`${INPUT} pl-8 pr-8`}
                    />
                    {emitData.cliente_id && (
                      <button onClick={() => { setEmitData(p => ({ ...p, cliente_id: "" })); setEmitClienteSearch(""); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {!emitData.cliente_id && emitClienteSearch.trim() && (
                    <div className="mt-1 border rounded-lg dark:border-zinc-700 max-h-40 overflow-y-auto bg-white dark:bg-zinc-800 shadow-lg absolute z-20 left-0 right-0">
                      {(!isFacturaA || emitData.tipo === "X") && (
                        <button onClick={() => { setEmitData(p => ({ ...p, cliente_id: "consumidor_final" })); setEmitClienteSearch(""); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white font-medium text-orange-600">
                          Consumidor Final
                        </button>
                      )}
                      {emitFilteredClientes.slice(0, 12).map(c => (
                        <button key={c.id} onClick={() => {
                          const condicion = condicionVentaCliente(c.dias_cuenta_corriente, c.forma_pago);
                          const extra = { cliente_id: c.id, condicion_venta: condicion, fecha_vencimiento: calcFechaVencimiento(condicion, emitData.fecha, c.dias_cuenta_corriente) };
                          if (emitManual || !["FA", "FB", "FCEA", "FCEB"].includes(emitData.tipo)) setEmitData(p => ({ ...p, ...extra }));
                          else cambiarTipo(tipoFacturaPorCondicionIva(c.condicion_iva), extra);
                          setModalidad(modalidadFactura(c.moneda_predeterminada, null));
                          setEmitClienteSearch("");
                        }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white flex justify-between">
                          <span>{c.razon_social}</span>
                          <span className="text-xs text-zinc-400">{c.cuit || "Sin CUIT"}</span>
                        </button>
                      ))}
                      {emitFilteredClientes.length === 0 && (
                        <p className="px-3 py-2 text-sm text-zinc-400">No se encontraron clientes</p>
                      )}
                    </div>
                  )}
                </>)}
                {alcanzoLimite && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> Límite de crédito alcanzado; podés continuar con la emisión.
                  </p>
                )}
              </div>
              <div className="col-span-5 sm:col-span-2">
                <label className={LABEL}>PV</label>
                {emitManual ? (
                  <input type="number" min={0} value={emitData.punto_venta} onChange={(e) => {
                    const newPv = Number(e.target.value);
                    setEmitData((p) => ({ ...p, punto_venta: newPv }));
                    void fetchNumero(emitData.tipo, newPv);
                  }} className={`${INPUT} font-mono`} />
                ) : pvOpciones.length > 1 ? (
                  <select
                    value={emitData.punto_venta}
                    onChange={(e) => {
                      const newPv = Number(e.target.value);
                      setEmitData((p) => ({ ...p, punto_venta: newPv }));
                      void fetchNumero(emitData.tipo, newPv);
                    }}
                    className={`${INPUT} font-mono`}
                  >
                    {pvOpciones.map((pv) => (
                      <option key={pv} value={pv}>{String(pv).padStart(4, "0")}</option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1.5 text-sm font-mono text-zinc-500 dark:text-zinc-400">
                    {String(emitData.punto_venta).padStart(4, "0")}
                  </div>
                )}
              </div>
              <div className="col-span-7 sm:col-span-2">
                <label className={LABEL}>{emitManual ? "N° *" : "Próximo N°"}</label>
                {emitManual ? (
                  <input type="number" min={1} value={emitData.numero_manual} onChange={(e) => setEmitData((p) => ({ ...p, numero_manual: e.target.value }))} placeholder="00000001" className={`${INPUT} font-mono`} />
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1.5 text-sm font-mono font-semibold text-orange-600 dark:text-orange-400" title="Lo confirma ARCA">
                    {emitData.numero_manual ? String(Number(emitData.numero_manual)).padStart(8, "0") : "…"}
                  </div>
                )}
              </div>
            </div>
            {emitManual && <p className="-mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">No se autoriza con ARCA: no tendrá CAE.</p>}

            {/* Datos del presupuesto: OC del cliente (siempre a la vista) y observaciones. Las OC a proveedores no van acá. */}
            {pr && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                {(pr.oc_cliente || pr.oc_cliente_fecha || pr.archivo_url) ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-zinc-500 font-medium">OC cliente:</span>
                    <span className="font-mono font-bold dark:text-white">{pr.oc_cliente || "Sin número"}</span>
                    <span className="text-zinc-600 dark:text-zinc-300">({pr.oc_cliente_fecha ? formatDate(pr.oc_cliente_fecha) : "sin fecha"})</span>
                    {pr.archivo_url && <a href={pr.archivo_url} target="_blank" rel="noreferrer" className="font-semibold text-orange-600 hover:underline">Abrir OC</a>}
                  </span>
                ) : (
                  <span><span className="text-zinc-500 font-medium">OC cliente:</span> <span className="text-amber-600 dark:text-amber-400">no cargada</span></span>
                )}
                {pr.observaciones && (
                  <span className="basis-full text-zinc-600 dark:text-zinc-300"><span className="text-zinc-500 font-medium">Obs. PR:</span> {pr.observaciones}</span>
                )}
              </div>
            )}

            {/* Moneda + Cotización + Fecha + Condición + Vencimiento */}
            <div className="grid grid-cols-2 sm:grid-cols-12 gap-2">
              <div className="col-span-1 sm:col-span-2">
                <label className={LABEL}>Moneda</label>
                <select value={valorMoneda} onChange={(e) => elegirMoneda(e.target.value)} className={INPUT}>
                  <option value="ARS">$ Pesos</option>
                  <option value="USD:divisas" disabled={fichaModalidad === "billetes" && !puedeDestrabar}>USD divisa{fichaModalidad === "billetes" ? " (no es la de la ficha)" : ""}</option>
                  <option value="USD:billetes" disabled={fichaModalidad === "divisas" && !puedeDestrabar}>USD billete{fichaModalidad === "divisas" ? " (no es la de la ficha)" : ""}</option>
                </select>
                {convierteMoneda && <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">PR en {monedaOrigen} → factura en {emitData.moneda}</p>}
                {isUSD && modalidadContraFicha(fichaMoneda, modalidad) && <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">Ficha: dólar {nombreModalidad(fichaModalidad!)}</p>}
              </div>
              <div className="col-span-1 sm:col-span-3">
                <label className={LABEL}>Cotización {needsRate ? `USD ${nombreModalidad(modalidad)}` : ""}{needsRate && !emitManual ? " *" : ""}</label>
                {needsRate ? (<>
                  <input type="number" readOnly={!editRate} step="0.01" min={0} value={emitData.tipo_cambio || ""} onChange={(e) => { cotizRequest.current += 1; setCotizBnaLoading(false); setCotizBna(null); setEmitData((p) => ({ ...p, tipo_cambio: Number(e.target.value) })); }} placeholder={editRate ? "Ej: 1450.00" : "Verificando BNA…"} className={`${INPUT} font-mono ${!editRate ? "bg-zinc-50 dark:bg-zinc-800/50" : ""}`} />
                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[11px]">
                    {cotizBnaLoading && <span className="text-zinc-400">Consultando BNA…</span>}
                    {cotizBna && <span className="text-zinc-500">BNA {nombreModalidad(modalidad)} venta del {formatDate(cotizBna.fecha)}</span>}
                    {editRate && <>
                      <button type="button" onClick={() => fetchCotizBna(cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-blue-600 hover:underline disabled:opacity-50">Traer BNA</button>
                      <input type="date" value={cotizFecha} onChange={e => { cotizRequest.current += 1; setCotizFecha(e.target.value); setCotizBnaLoading(false); setCotizBna(null); setCotizError(""); setEmitData(p => ({ ...p, tipo_cambio: 0 })); }} className="border border-zinc-300 dark:border-zinc-600 rounded px-1 bg-white dark:bg-zinc-800 dark:text-white" title="Fecha cotización (vacío = día hábil anterior)" />
                    </>}
                    {!emitManual && canOverrideRate && <label className="text-zinc-500"><input type="checkbox" checked={rateOverride} onChange={e => setRateOverride(e.target.checked)} /> Modificar (Augusto)</label>}
                  </div>
                  {cotizError && <p role="alert" className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">{cotizError}</p>}
                </>) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1.5 text-sm text-zinc-400">No hace falta</div>
                )}
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className={LABEL}>Fecha facturación</label>
                <input type="date" value={emitData.fecha} min={minPermitida} max={todayAR()} disabled={!emitManual && !fiscalDates.ready}
                  onChange={(e) => cambiarFecha(e.target.value)} className={INPUT} />
                <div className="mt-0.5 text-[11px] text-zinc-500 space-y-0.5">
                  {!emitManual && fiscalDates.error && <p><span className="text-red-600">{fiscalDates.error}</span> <button type="button" onClick={fiscalDates.retry} className="underline">Reintentar</button></p>}
                  {!emitManual && !fiscalDates.error && !fiscalDates.ready && <p>Consultando fechas habilitadas en ARCA…</p>}
                  {!emitManual && fiscalDates.ready && fiscalDates.warning && <p className="text-amber-600 dark:text-amber-400">{fiscalDates.warning}</p>}
                  {!emitManual && fiscalDates.ready && emitData.fecha < fiscalMinDate && <p className="text-red-600">ARCA permite desde el {formatDate(fiscalMinDate)}.</p>}
                  {ocBlocked && (
                    <p className="text-red-600">
                      No puede ser antes de la OC ({formatDate(ocFecha!)}).{" "}
                      {puedeDestrabar && <button type="button" onClick={destrabarOc} className="underline text-zinc-600 dark:text-zinc-300">Destrabar</button>}
                    </p>
                  )}
                  {!ocBlocked && sugerenciaFecha && (
                    <p className="text-emerald-700 dark:text-emerald-400">
                      Podés facturar con fecha {formatDate(sugerenciaFecha.fecha)} ({sugerenciaFecha.dias} {sugerenciaFecha.dias === 1 ? "día" : "días"} antes).{" "}
                      <button type="button" onClick={() => cambiarFecha(sugerenciaFecha.fecha)} className="font-semibold underline">Usar</button>
                    </p>
                  )}
                  {permitirAntesOc && ocFecha && <p className="text-amber-600 dark:text-amber-400">Destrabado: se permite antes de la OC.</p>}
                </div>
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className={LABEL}>Condición</label>
                <select value={emitData.condicion_venta}
                  onChange={(e) => setEmitData((p) => ({ ...p, condicion_venta: e.target.value, fecha_vencimiento: calcFechaVencimiento(e.target.value, p.fecha, diasCliente) }))}
                  className={INPUT}>
                  {CONDICIONES_VENTA.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className={LABEL}>Vencimiento</label>
                <input type="date" value={emitData.fecha_vencimiento} onChange={(e) => setEmitData((p) => ({ ...p, fecha_vencimiento: e.target.value }))} className={INPUT} />
              </div>
            </div>

            {fceApplies && <div className="text-xs text-zinc-500 dark:text-zinc-400" role="status">
              {fceCheck.error ? <><span className="text-red-600">{fceCheck.error}</span> <button type="button" onClick={fceCheck.retry} className="underline">Reintentar verificación FCE</button></>
                : !emitData.cliente_id ? "Seleccioná un cliente para verificar el régimen FCE."
                : !fceCheck.ready ? "Consultando encuadre FCE del cliente en ARCA…"
                : !fceRateReady ? "Esperando cotización para determinar si corresponde FCE…"
                : fceRequired ? `Corresponde FCE por consulta ARCA e importe. Mínimo: ${formatCurrency(fceCheck.montoDesde || 0, "ARS")}.`
                : `Factura común (consulta ARCA e importe).${fceCheck.obligado ? ` Mínimo FCE: ${formatCurrency(fceCheck.montoDesde || 0, "ARS")}.` : ""}`}
            </div>}
            {!emitManual && ["FCEA", "FCEB"].includes(emitData.tipo) && (
              <div className="rounded-lg border border-blue-200 p-2.5 dark:border-blue-900">
                <p className="text-xs mb-1.5 dark:text-zinc-200">Datos obligatorios de la FCE. La CBU debe ser del emisor de esta sociedad. El vencimiento no puede ser anterior a hoy ni a la emisión.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={LABEL}>CBU del emisor *
                    <input inputMode="numeric" maxLength={22} value={emitData.fce_cbu} onChange={e => setEmitData(p => ({ ...p, fce_cbu: e.target.value.replace(/\D/g, "") }))} className={`${INPUT} mt-0.5 font-mono`} />
                  </label>
                  <label className={LABEL}>Transmisión de la FCE *
                    <select value={emitData.fce_transmision} onChange={e => setEmitData(p => ({ ...p, fce_transmision: e.target.value }))} className={`${INPUT} mt-0.5`}>
                      <option value="">Seleccioná una modalidad</option>
                      <option value="SCA">SCA — Sistema de Circulación Abierta</option>
                      <option value="ADC">ADC — Agente de Depósito Colectivo</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {/* Items (en la moneda del PR si viene de un presupuesto) */}
            <div>
              <div className="grid grid-cols-12 gap-2 items-end mb-0.5">
                <span className={`${isFacturaA ? "col-span-6" : "col-span-8"} text-xs font-medium text-zinc-600 dark:text-zinc-300`}>Ítems *{convierteMoneda ? ` (precios en ${monedaOrigen})` : ""}</span>
                <span className="col-span-1 text-[11px] text-zinc-400">Cant.</span>
                <span className="col-span-2 text-[11px] text-zinc-400">{isFacturaA ? "Neto unit." : "Precio"}</span>
                {isFacturaA && <span className="col-span-2 text-[11px] text-zinc-400">IVA</span>}
                <button onClick={addItem} className="col-span-1 flex items-center justify-end text-orange-500 hover:text-orange-600" title="Agregar ítem">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1">
                {emitData.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className={isFacturaA ? "col-span-6" : "col-span-8"}>
                      <input value={item.descripcion} onChange={(e) => updateItem(idx, "descripcion", e.target.value)} placeholder="Ej: Botín de seguridad" className={INPUT} />
                    </div>
                    <div className="col-span-1">
                      <input type="number" min={1} value={item.cantidad} onChange={(e) => updateItem(idx, "cantidad", Number(e.target.value))} className={`${INPUT} font-mono px-1.5`} />
                    </div>
                    <div className="col-span-2">
                      <input type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={(e) => updateItem(idx, "precio_unitario", Number(e.target.value))} placeholder="0.00" className={`${INPUT} font-mono px-1.5`} />
                    </div>
                    {isFacturaA && (
                      <div className="col-span-2">
                        <select value={item.iva_porcentaje} onChange={(e) => updateItem(idx, "iva_porcentaje", Number(e.target.value))} className={`${INPUT} px-1.5`}>
                          <option value={21}>21%</option>
                          <option value={10.5}>10.5%</option>
                          <option value={27}>27%</option>
                          <option value={0}>0%</option>
                        </select>
                      </div>
                    )}
                    <div className="col-span-1 flex justify-end">
                      {emitData.items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-500" title="Quitar ítem">
                          <Minus className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className={LABEL}>Observaciones (salen en la factura)</label>
              <input value={emitData.observaciones} onChange={e => setEmitData(p => ({ ...p, observaciones: e.target.value }))} placeholder="Notas para la factura..." className={INPUT} />
              {leyendaTc && <p className="mt-0.5 text-[11px] text-zinc-500">Se agrega sola: “{leyendaTc}”</p>}
            </div>
          </div>

          {/* Totales y botones: siempre a la vista */}
          <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-700 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm">
              {isFacturaA && <>
                <span className="text-zinc-500">Neto <span className="font-mono text-zinc-800 dark:text-zinc-200">{formatCurrency(emitTotals.neto, monedaTotal)}</span></span>
                <span className="text-zinc-500">IVA <span className="font-mono text-zinc-800 dark:text-zinc-200">{formatCurrency(emitTotals.iva, monedaTotal)}</span></span>
              </>}
              <span className="font-semibold text-base dark:text-white">{isFacturaA ? "Total" : emitManual || emitData.tipo === "X" ? "Total (sin IVA)" : "Total (IVA incl.)"} <span className="font-mono">{formatCurrency(emitTotals.total, monedaTotal)}</span></span>
              {isUSD && tc > 0 && <span className="text-xs text-zinc-400">1 USD = {tc.toLocaleString("es-AR")} ARS</span>}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={cerrar} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
              {emitManual ? (
                <button onClick={handleEmitManual} disabled={emitDisabled} className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg bg-zinc-700 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
                  <FileCheck className="h-4 w-4" /> Guardar manual
                </button>
              ) : (
                <button onClick={handleEmit} disabled={emitDisabled} className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
                  <ShieldCheck className="h-4 w-4" /> Emitir con ARCA
                </button>
              )}
            </div>
          </div>
        </>)}

        {emitStep === "emitting" && (
          <div className="p-12 flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
            <p className="text-sm text-zinc-500">{emitManual ? "Guardando factura..." : "Autorizando con ARCA..."}</p>
            {!emitManual && <p className="text-xs text-zinc-400">Esto puede tomar unos segundos</p>}
          </div>
        )}

        {emitStep === "success" && emitResult && (
          <div className="p-8 space-y-6 overflow-y-auto">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold dark:text-white">{emitResult.manual ? "Factura guardada" : "Factura emitida exitosamente"}</h3>
              {emitResult.warning && <p className="text-sm text-amber-700 dark:text-amber-400">{emitResult.warning}</p>}
              {emitResult.warnings?.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">Advertencias ARCA: {emitResult.warnings.map((w: any) => typeof w === "string" ? w : (w.Msg || w.message || JSON.stringify(w))).join("; ")}</p>}
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Comprobante</span><span className="font-mono font-bold">{emitResult.comprobante}</span></div>
              {emitResult.manual ? (
                <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">CAE</span><span className="text-zinc-400 italic">Sin CAE (manual)</span></div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">CAE</span><span className="font-mono">{emitResult.cae}</span></div>
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Vto CAE</span><span>{emitResult.cae_vencimiento ? formatDate(emitResult.cae_vencimiento) : "—"}</span></div>
                </>
              )}
              <div className="flex justify-between border-t border-emerald-200 dark:border-emerald-700 pt-2"><span className="text-emerald-700 dark:text-emerald-400 font-semibold">Total</span><span className="font-mono font-bold">{formatCurrency(emitResult.total, emitData.moneda)}</span></div>
            </div>
            <div className="flex justify-center gap-3">
              {emitResult.id && (
                <button onClick={descargarPDF} disabled={descargando} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
                  {descargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar PDF
                </button>
              )}
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cerrar</button>
            </div>
          </div>
        )}

        {emitStep === "error" && (
          <div className="p-8 space-y-6">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
              <h3 className="text-lg font-bold dark:text-white">Error al emitir</h3>
              <p className="text-sm text-red-600 text-center max-w-md">{emitError}</p>
            </div>
            <div className="flex justify-center gap-3">
              <button onClick={() => setEmitStep("form")} className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">Intentar de nuevo</button>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cerrar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
