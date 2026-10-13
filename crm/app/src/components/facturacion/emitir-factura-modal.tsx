"use client";

/**
 * Ventana ÚNICA para emitir una factura de venta (ARCA o manual sin CAE).
 * La usan Facturación (factura libre, se elige el cliente) y Ventas (factura de un presupuesto).
 * Con `presupuesto`: cliente fijo, renglones y OC del PR, y al emitir el PR pasa a "facturado".
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
  AlertTriangle, CheckCircle2, Download, FileCheck, Loader2, Maximize2, Minimize2, Minus, Plus, Search, ShieldCheck, X, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  } | null;
  items: { descripcion: string; cantidad: number; precio_venta: number | null; iva_porcentaje: number; total: number | null }[];
  ordenesCompra?: { id: string; numero: string; fecha: string }[];
}

interface ClienteOption {
  id: string;
  razon_social: string;
  cuit: string;
  condicion_iva: string | null;
  limite_credito?: number | null;
  dias_cuenta_corriente?: number | null;
  forma_pago?: string | null;
}

const esA = (tipo: string) => tipo.endsWith("A"); // X se cobra como B: precio final

function formatComprobante(tipo: string, pv: number, num: number) {
  return `${tipo} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
}

function previousBusinessDay(iso: string): string {
  const d = new Date(`${iso || todayAR()}T12:00:00`);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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
  const pvOpciones = puntosVentaSociedad(sociedadActiva?.nombre);
  const intentScope = pr ? `presupuesto:${sociedadActiva?.id}:${pr.id}` : `facturacion:${sociedadActiva?.id}:emit`;
  const sourceIsManual = pr?.modalidad_emision === "manual";
  const forceManual = arcaCertOk === false;
  const tipoCliente = pr ? tipoFacturaPorCondicionIva(pr.cliente?.condicion_iva) : "FB";
  const modalidadPr: "divisas" | "billetes" = pr?.cotizacion_modalidad === "billetes" ? "billetes" : "divisas";

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
  const [cotizModalidad, setCotizModalidad] = useState<"divisas" | "billetes">(modalidadPr);
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
      observaciones: "",
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
  const diasCliente = pr?.cliente?.dias_cuenta_corriente ?? clientes.find(c => c.id === emitData.cliente_id)?.dias_cuenta_corriente ?? null;

  // ── Apertura: intención anti-duplicados, clientes y número ─────
  useEffect(() => {
    beginInvoiceIntent(intentScope);
    if (!pr) {
      const q = supabase.from("clientes").select("id, razon_social, cuit, condicion_iva, limite_credito, dias_cuenta_corriente, forma_pago").eq("activo", true).order("razon_social");
      (sociedadActiva?.id ? q.eq("sociedad_id" as any, sociedadActiva.id) : q)
        .then(({ data }) => { if (data) setClientes(data as ClienteOption[]); });
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

  // ── Cotización ─────────────────────────────────────────────────
  async function fetchCotizBna(modalidad: "divisas" | "billetes" = "divisas", fecha?: string) {
    const requestId = ++cotizRequest.current;
    setCotizModalidad(modalidad);
    setCotizBnaLoading(true);
    setCotizError("");
    setCotizBna(null);
    setEmitData(p => ({ ...p, tipo_cambio: 0 }));
    try {
      const params = new URLSearchParams({ modalidad });
      // Por defecto se usa el día hábil anterior a la fecha de la factura.
      // Solo un valor explícito en el selector permite cambiar esta regla.
      if (editRate) params.set("fecha", fecha || cotizFecha || previousBusinessDay(emitData.fecha));
      else params.set("fecha_factura", emitData.fecha);
      const res = await fetch(`/api/cotizacion-bna?${params}`);
      const data = await res.json();
      if (requestId !== cotizRequest.current) return;
      if (!res.ok) throw new Error(data.error || "No se pudo consultar la cotización.");
      if (editRate && (data.stale || data.fecha !== params.get("fecha"))) {
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

  // Automática: BNA venta (modalidad del PR, o divisas), día hábil anterior a la fecha de la factura (fecha_factura).
  useEffect(() => {
    if (!needsRate) return;
    if (editRate) { setCotizBnaLoading(false); return; }
    void fetchCotizBna(modalidadPr);
    return () => { cotizRequest.current += 1; };
  }, [needsRate, emitData.fecha, editRate, modalidadPr]);

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

  const limiteCliente = pr ? pr.cliente?.limite_credito : clientes.find(c => c.id === emitData.cliente_id)?.limite_credito;
  const saldoCliente = emitData.cliente_id && emitData.cliente_id !== "consumidor_final" && saldoClienteArs ? saldoClienteArs(emitData.cliente_id) : null;
  const alcanzoLimite = !!limiteCliente && saldoCliente != null && saldoCliente >= Number(limiteCliente);

  // ── Emitir ─────────────────────────────────────────────────────
  function validarComun(): string | null {
    if (!emitData.cliente_id) return "Selecciona un cliente";
    if (emitData.items.some((it) => !it.descripcion || !(it.precio_unitario > 0) || !(it.cantidad > 0))) return "Completá todos los ítems con descripción, cantidad mayor a 0 y precio.";
    if (needsRate && !(tc > 0)) return convierteMoneda ? `Ingresá el tipo de cambio para pasar de ${monedaOrigen} a ${emitData.moneda}.` : "Factura en USD requiere tipo de cambio";
    return null;
  }

  /** Datos que van igual en ARCA y manual (incluye el presupuesto y su OC). */
  function datosComunes() {
    return {
      cliente_id: emitData.cliente_id,
      punto_venta: emitData.punto_venta,
      moneda: emitData.moneda,
      tipo_cambio: isUSD ? tc : null,
      cotizacion_modalidad: isUSD ? cotizModalidad : null,
      fecha: emitData.fecha || null,
      condicion_venta: emitData.condicion_venta || null,
      fecha_vencimiento: emitData.fecha_vencimiento || null,
      observaciones: emitData.observaciones.trim() || null,
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
  const clienteNombre = pr ? pr.cliente?.razon_social || "" : emitData.cliente_id === "consumidor_final" ? "Consumidor Final" : clientes.find(c => c.id === emitData.cliente_id)?.razon_social || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className={`bg-white dark:bg-zinc-900 rounded-xl shadow-2xl overflow-y-auto ${emitFullscreen ? "fixed inset-2 max-w-none max-h-none mx-0" : "w-full max-w-2xl mx-4 max-h-[90vh]"}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <div>
            <h2 className="text-lg font-bold dark:text-white">{emitManual ? "Factura manual" : "Emitir factura ARCA"}{pr ? ` — ${pr.numero}` : ""}</h2>
            <p className="text-sm text-zinc-400">{emitManual ? "Se guarda sin autorizar en ARCA (sin CAE)" : "Se autorizara en tiempo real con ARCA"}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setEmitFullscreen(f => !f)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400" title={emitFullscreen ? "Restaurar" : "Maximizar"}>
              {emitFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button onClick={cerrar} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {emitStep === "form" && (
          <div className="p-6 space-y-5">
            {emitError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{emitError}</div>}
            {emitData.cliente_id && emitData.cliente_id !== "consumidor_final" && <AvisoBCRA clienteId={emitData.cliente_id} />}

            {/* Toggle ARCA / Manual */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                <button
                  onClick={() => {
                    if (!emitManual) return;
                    const tipoArca = pr ? tipoCliente : "FA";
                    setEmitManual(false);
                    cambiarTipo(tipoArca, { punto_venta: pvOpciones[0] });
                    void fetchNumero(tipoArca, pvOpciones[0]);
                  }}
                  disabled={forceManual}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!emitManual ? "bg-orange-500 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> Con ARCA
                </button>
                <button
                  onClick={() => {
                    if (emitManual) return;
                    setEmitManual(true);
                    cambiarTipo("X", { punto_venta: 0 });
                    void fetchNumero("X", 0);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${emitManual ? "bg-zinc-700 text-white dark:bg-zinc-600" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                >
                  <FileCheck className="h-3.5 w-3.5" /> Manual (sin CAE)
                </button>
              </div>
              {forceManual && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> ARCA no configurado para esta sociedad — solo modo manual disponible.
                </p>
              )}
            </div>

            {/* Tipo + Cliente + PV */}
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 sm:col-span-3">
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Tipo *</label>
                <select value={emitData.tipo} disabled={emitManual} onChange={(e) => {
                  const nuevo = e.target.value;
                  cambiarTipo(nuevo);
                  void fetchNumero(nuevo, emitData.punto_venta);
                }} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white disabled:cursor-not-allowed disabled:bg-zinc-100 dark:disabled:bg-zinc-800/60">
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
              <div className="col-span-8 sm:col-span-7 relative">
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cliente *</label>
                {pr ? (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-1.5">
                    <p className="text-sm font-medium dark:text-white">{clienteNombre}</p>
                    <p className="text-xs text-zinc-400">{pr.cliente?.condicion_iva || "—"} · {pr.cliente?.cuit || "Sin CUIT"}</p>
                  </div>
                ) : (<>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                    <input
                      value={emitData.cliente_id ? clienteNombre : emitClienteSearch}
                      onChange={(e) => {
                        setEmitClienteSearch(e.target.value);
                        if (emitData.cliente_id) setEmitData(p => ({ ...p, cliente_id: "" }));
                      }}
                      onFocus={() => { if (emitData.cliente_id) { setEmitClienteSearch(""); setEmitData(p => ({ ...p, cliente_id: "" })); } }}
                      placeholder="Buscar cliente por nombre o CUIT..."
                      autoComplete="off"
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 pl-9 pr-8 py-2 text-sm dark:text-white"
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
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Límite de crédito alcanzado; podés continuar con la emisión.
                  </p>
                )}
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">PV</label>
                {emitManual ? (
                  <input type="number" min={0} value={emitData.punto_venta} onChange={(e) => {
                    const newPv = Number(e.target.value);
                    setEmitData((p) => ({ ...p, punto_venta: newPv }));
                    void fetchNumero(emitData.tipo, newPv);
                  }} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                ) : pvOpciones.length > 1 ? (
                  <select
                    value={emitData.punto_venta}
                    onChange={(e) => {
                      const newPv = Number(e.target.value);
                      setEmitData((p) => ({ ...p, punto_venta: newPv }));
                      void fetchNumero(emitData.tipo, newPv);
                    }}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white"
                  >
                    {pvOpciones.map((pv) => (
                      <option key={pv} value={pv}>{String(pv).padStart(4, "0")}</option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-sm font-mono text-zinc-500 dark:text-zinc-400">
                    {String(emitData.punto_venta).padStart(4, "0")}
                  </div>
                )}
              </div>
            </div>

            {emitManual ? (
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-4">
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">N° Comprobante *</label>
                  <input type="number" min={1} value={emitData.numero_manual} onChange={(e) => setEmitData((p) => ({ ...p, numero_manual: e.target.value }))} placeholder="00000001" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                </div>
                <div className="col-span-8 flex items-end">
                  <p className="text-xs text-amber-600 dark:text-amber-400 pb-2">Esta factura no se autoriza con ARCA. No tendrá CAE.</p>
                </div>
              </div>
            ) : emitData.numero_manual && (
              <p className="text-xs text-zinc-500">Próximo número: <span className="font-mono font-semibold text-orange-600 dark:text-orange-400">{formatComprobante(emitData.tipo, emitData.punto_venta, Number(emitData.numero_manual))}</span> (lo confirma ARCA)</p>
            )}

            {/* Datos del presupuesto: OC del cliente, OC a proveedores y observaciones */}
            {pr && (pr.oc_cliente || pr.oc_cliente_fecha || pr.archivo_url || pr.observaciones || (pr.ordenesCompra?.length || 0) > 0) && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1">
                {(pr.oc_cliente || pr.oc_cliente_fecha || pr.archivo_url) && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-zinc-500 font-medium">OC cliente:</span>
                    <span className="font-mono font-bold dark:text-white">{pr.oc_cliente || "Sin número informado"}</span>
                    <span className="text-zinc-600 dark:text-zinc-300">Fecha: {pr.oc_cliente_fecha ? formatDate(pr.oc_cliente_fecha) : "Sin informar"}</span>
                    {pr.archivo_url && <a href={pr.archivo_url} target="_blank" rel="noreferrer" className="rounded border border-orange-200 bg-white px-2 py-1 text-xs font-semibold text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:bg-zinc-900">Abrir OC adjunta</a>}
                  </div>
                )}
                {(pr.ordenesCompra?.length || 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-zinc-500 font-medium">OC proveedor:</span>
                    {pr.ordenesCompra!.map(oc => (
                      <span key={oc.id} className="inline-flex items-center gap-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                        {oc.numero} <span className="font-normal text-zinc-400">({formatDate(oc.fecha)})</span>
                      </span>
                    ))}
                  </div>
                )}
                {pr.observaciones && (
                  <div className="text-sm">
                    <span className="text-zinc-500 font-medium">Observaciones PR:</span>
                    <p className="text-zinc-700 dark:text-zinc-300 mt-0.5">{pr.observaciones}</p>
                  </div>
                )}
              </div>
            )}

            {/* Moneda + Tipo de cambio */}
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 sm:col-span-4">
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Moneda factura</label>
                <select value={emitData.moneda} onChange={(e) => setEmitData((p) => ({ ...p, moneda: e.target.value as "ARS" | "USD" }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                  <option value="ARS">ARS — Pesos</option>
                  <option value="USD">USD — Dolares</option>
                </select>
                {convierteMoneda && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">PR en {monedaOrigen} → factura en {emitData.moneda}</p>}
              </div>
              {needsRate && (
                <div className="col-span-12 sm:col-span-8">
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cotizacion USD/ARS {emitManual ? "" : "*"}</label>
                  <input type="number" readOnly={!editRate} step="0.01" min={0} value={emitData.tipo_cambio || ""} onChange={(e) => { cotizRequest.current += 1; setCotizBnaLoading(false); setCotizBna(null); setEmitData((p) => ({ ...p, tipo_cambio: Number(e.target.value) })); }} placeholder={editRate ? "Ej: 1450.00" : "Verificando BNA…"} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    {editRate && <>
                      <span className="text-xs text-zinc-400">BNA:</span>
                      <button type="button" onClick={() => fetchCotizBna("divisas", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                        {cotizBnaLoading ? "…" : "Divisas"}
                      </button>
                      <span className="text-xs text-zinc-300">·</span>
                      <button type="button" onClick={() => fetchCotizBna("billetes", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                        {cotizBnaLoading ? "…" : "Billetes"}
                      </button>
                      <input type="date" value={cotizFecha} onChange={e => { cotizRequest.current += 1; setCotizFecha(e.target.value); setCotizBnaLoading(false); setCotizBna(null); setCotizError(""); setEmitData(p => ({ ...p, tipo_cambio: 0 })); }} className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 bg-white dark:bg-zinc-800 dark:text-white" title="Fecha cotización (vacío = día hábil anterior)" />
                    </>}
                    {!editRate && <span className="text-xs text-zinc-500">Automática: BNA {modalidadPr} venta, día hábil anterior a la factura (fecha_factura).</span>}
                    {!emitManual && canOverrideRate && <label className="text-xs"><input type="checkbox" checked={rateOverride} onChange={e => setRateOverride(e.target.checked)} /> Modificar cotización (Augusto)</label>}
                    {cotizBna && <span className="text-xs text-zinc-400">→ Venta {cotizBna.modalidad}: ${cotizBna.valor_venta.toLocaleString("es-AR")} ({cotizBna.fecha})</span>}
                  </div>
                  {cotizError && <p role="alert" className="mt-1 text-xs text-amber-700 dark:text-amber-400">{cotizError}</p>}
                  {convierteMoneda && tc > 0 && <p className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">Los ítems se convierten de {monedaOrigen} a {emitData.moneda} al tipo de cambio {tc.toLocaleString("es-AR")}.</p>}
                </div>
              )}
            </div>

            {/* Fecha facturación + Condicion de venta + Fecha vencimiento */}
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 sm:col-span-4">
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha facturación</label>
                <input type="date" value={emitData.fecha} min={emitManual ? minFecha : fiscalMinDate} max={todayAR()} disabled={!emitManual && !fiscalDates.ready}
                  onChange={(e) => setEmitData((p) => ({ ...p, fecha: e.target.value, fecha_vencimiento: calcFechaVencimiento(p.condicion_venta, e.target.value, diasCliente) }))}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                {!emitManual && <div className="mt-1 text-xs text-zinc-500">{fiscalDates.error ? <><span className="text-red-600">{fiscalDates.error}</span> <button type="button" onClick={fiscalDates.retry} className="underline">Reintentar</button></> : !fiscalDates.ready ? "Consultando fechas habilitadas en ARCA…" : <>{fiscalDates.warning ? <span className="text-amber-600 dark:text-amber-400">{fiscalDates.warning} </span> : <>Primera fecha habilitada: {formatDate(fiscalMinDate)}. </>}{emitData.fecha < fiscalMinDate && <span className="text-red-600">Cambiá la fecha seleccionada.</span>}</>}</div>}
              </div>
              <div className="col-span-6 sm:col-span-4">
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Condición de venta</label>
                <select value={emitData.condicion_venta}
                  onChange={(e) => setEmitData((p) => ({ ...p, condicion_venta: e.target.value, fecha_vencimiento: calcFechaVencimiento(e.target.value, p.fecha, diasCliente) }))}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                  {CONDICIONES_VENTA.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-6 sm:col-span-4">
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha vencimiento</label>
                <input type="date" value={emitData.fecha_vencimiento} onChange={(e) => setEmitData((p) => ({ ...p, fecha_vencimiento: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
              </div>
            </div>

            {fceApplies && <div className="text-sm text-zinc-600 dark:text-zinc-300" role="status">
              {fceCheck.error ? <><span className="text-red-600">{fceCheck.error}</span> <button type="button" onClick={fceCheck.retry} className="underline">Reintentar verificación FCE</button></>
                : !emitData.cliente_id ? "Seleccioná un cliente para verificar el régimen FCE."
                : !fceCheck.ready ? "Consultando encuadre FCE del cliente en ARCA…"
                : !fceRateReady ? "Esperando cotización para determinar si corresponde FCE…"
                : fceRequired ? `Corresponde FCE por consulta ARCA e importe. Mínimo: ${formatCurrency(fceCheck.montoDesde || 0, "ARS")}.`
                : `Corresponde factura común según la consulta y el importe.${fceCheck.obligado ? ` Mínimo FCE: ${formatCurrency(fceCheck.montoDesde || 0, "ARS")}.` : ""}`}
            </div>}
            {!emitManual && ["FCEA", "FCEB"].includes(emitData.tipo) && (
              <div className="rounded-lg border border-blue-200 p-3 space-y-3 dark:border-blue-900">
                <p className="text-sm dark:text-zinc-200">Datos obligatorios de la FCE. La CBU debe pertenecer al emisor de esta sociedad. El vencimiento es obligatorio y no puede ser anterior a hoy ni a la emisión.</p>
                <label className="block text-sm dark:text-zinc-300">CBU del emisor *
                  <input inputMode="numeric" maxLength={22} value={emitData.fce_cbu} onChange={e => setEmitData(p => ({ ...p, fce_cbu: e.target.value.replace(/\D/g, "") }))} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
                </label>
                <label className="block text-sm dark:text-zinc-300">Transmisión de la FCE *
                  <select value={emitData.fce_transmision} onChange={e => setEmitData(p => ({ ...p, fce_transmision: e.target.value }))} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                    <option value="">Seleccioná una modalidad</option>
                    <option value="SCA">SCA — Sistema de Circulación Abierta</option>
                    <option value="ADC">ADC — Agente de Depósito Colectivo</option>
                  </select>
                </label>
              </div>
            )}

            {/* Items (en la moneda del PR si viene de un presupuesto) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium dark:text-zinc-300">Items *{convierteMoneda ? ` (precios en ${monedaOrigen})` : ""}</label>
                <button onClick={addItem} className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium">
                  <Plus className="h-3 w-3" /> Agregar item
                </button>
              </div>
              <div className="space-y-3">
                {emitData.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                    <div className={isFacturaA ? "col-span-5" : "col-span-7"}>
                      {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Descripcion</label>}
                      <input
                        value={item.descripcion} onChange={(e) => updateItem(idx, "descripcion", e.target.value)}
                        placeholder="Ej: Botín de seguridad"
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                      />
                    </div>
                    <div className="col-span-2">
                      {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Cantidad</label>}
                      <input type="number" min={1} value={item.cantidad} onChange={(e) => updateItem(idx, "cantidad", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    </div>
                    <div className="col-span-2">
                      {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">{isFacturaA ? "Neto unit." : "Precio"}</label>}
                      <input type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={(e) => updateItem(idx, "precio_unitario", Number(e.target.value))} placeholder="0.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    </div>
                    {isFacturaA && (
                      <div className="col-span-2">
                        {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">IVA %</label>}
                        <select value={item.iva_porcentaje} onChange={(e) => updateItem(idx, "iva_porcentaje", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                          <option value={21}>21%</option>
                          <option value={10.5}>10.5%</option>
                          <option value={27}>27%</option>
                          <option value={0}>0%</option>
                        </select>
                      </div>
                    )}
                    <div className="col-span-1 flex items-end">
                      {emitData.items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-500">
                          <Minus className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Observaciones (salen en la factura)</label>
              <input value={emitData.observaciones} onChange={e => setEmitData(p => ({ ...p, observaciones: e.target.value }))} placeholder="Notas para la factura..." className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
            </div>

            {/* Totals preview (en la moneda de la factura) */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
              {isFacturaA ? (
                <>
                  <div className="flex justify-between"><span className="text-zinc-500">Neto gravado</span><span className="font-mono">{formatCurrency(emitTotals.neto, isUSD ? "USD" : "ARS")}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(emitTotals.iva, isUSD ? "USD" : "ARS")}</span></div>
                  <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold text-base">
                    <span>Total</span><span className="font-mono">{formatCurrency(emitTotals.total, isUSD ? "USD" : "ARS")}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between font-semibold text-base">
                  <span>{emitManual || emitData.tipo === "X" ? "Total (sin IVA)" : "Total (IVA incluido)"}</span><span className="font-mono">{formatCurrency(emitTotals.total, isUSD ? "USD" : "ARS")}</span>
                </div>
              )}
              {isUSD && tc > 0 && (
                <div className="text-xs text-zinc-400 text-right">Cotizacion ARCA: 1 USD = {tc.toLocaleString("es-AR")} ARS</div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={cerrar} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
              {emitManual ? (
                <button onClick={handleEmitManual} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-zinc-700 text-white hover:bg-zinc-800 transition-colors">
                  <FileCheck className="h-4 w-4" /> Guardar manual
                </button>
              ) : (
                <button onClick={handleEmit} disabled={fiscalDateBlocked || fceBlocked || (needsRate && (cotizBnaLoading || (!editRate && !cotizBna) || tc <= 0))} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
                  <ShieldCheck className="h-4 w-4" /> Emitir con ARCA
                </button>
              )}
            </div>
          </div>
        )}

        {emitStep === "emitting" && (
          <div className="p-12 flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
            <p className="text-sm text-zinc-500">{emitManual ? "Guardando factura..." : "Autorizando con ARCA..."}</p>
            {!emitManual && <p className="text-xs text-zinc-400">Esto puede tomar unos segundos</p>}
          </div>
        )}

        {emitStep === "success" && emitResult && (
          <div className="p-8 space-y-6">
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
