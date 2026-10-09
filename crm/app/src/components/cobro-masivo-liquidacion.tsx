"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { X, Plus, Trash2, AlertCircle, Copy, ArrowDown, RefreshCw, Maximize2, Minimize2, Upload, Sparkles, Loader2, FileCheck2 } from "lucide-react";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";

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
}

// ── Helpers ──────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => todayAR();
const num = (v: string) => parseFloat(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

const MEDIO_TIPOS = [
  { value: "transferencia", label: "Transferencia bancaria" },
  { value: "efectivo", label: "Efectivo" },
  { value: "echeq", label: "Cheque / E-Cheq" },
  { value: "deposito", label: "Depósito" },
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
  facturas, clienteId, clienteNombre, sociedadId, moneda, onClose, onSuccess,
}: Props) {
  const [opReferencia, setOpReferencia] = useState("");
  const [medios, setMedios] = useState<MedioPago[]>([newMedio()]);
  const [retenciones, setRetenciones] = useState<RetencionLinea[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [opFiles, setOpFiles] = useState<File[]>([]);
  const [parsingOP, setParsingOP] = useState(false);
  const [opParseMessage, setOpParseMessage] = useState("");
  const requestKeyRef = useRef("");

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
        setCotizacion(String(data.valor_venta));
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
  const totalSaldo = useMemo(() => facturas.reduce((s, f) => s + f.saldo, 0), [facturas]);
  const totalMedios = useMemo(() => medios.reduce((s, m) => s + num(m.monto), 0), [medios]);
  const totalRetenciones = useMemo(() => retenciones.reduce((s, r) => s + num(r.monto), 0), [retenciones]);
  // Retenciones siempre en la moneda de cobro (ARS si USD, moneda original si ARS)
  const totalSaldoARS = isUSD && cotizNum > 0 ? r2(totalSaldo * cotizNum) : totalSaldo;
  const totalEsperado = r2(totalSaldoARS - totalRetenciones);
  const diferencia = r2(totalMedios - totalEsperado);
  const canConfirm = Math.abs(diferencia) < 0.01 && totalMedios > 0 && !saving && !parsingOP && (!isUSD || cotizNum > 0);

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
    setError("");
    setOpFiles(files);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("file", file));
      const response = await fetch("/api/parse-cobro", { method: "POST", body: form });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "No se pudo leer la orden de pago");

      const parsed = json.data || {};
      const payments: any[] = Array.isArray(parsed.pagos) ? parsed.pagos : [];
      const parsedMedios: MedioPago[] = [];
      const parsedRetenciones: RetencionLinea[] = [];
      for (const payment of payments) {
        const tipo = String(payment.tipo || "").toLowerCase();
        const monto = Number(payment.monto || 0);
        if (!(monto > 0)) continue;
        if (tipo.startsWith("retencion_") || tipo.startsWith("percepcion_")) {
          parsedRetenciones.push({
            _id: uid(),
            tipo: RETENCION_TIPOS.some((option) => option.value === tipo) ? tipo : "ajuste",
            organismo: String(payment.organismo || payment.destinatario || ""),
            certificado: String(payment.certificado || payment.referencia || ""),
            monto: String(monto),
            observaciones: String(payment.notas || payment.concepto || ""),
          });
          continue;
        }
        // Todo cheque recibido se presume electrónico. Solo el operador puede
        // cambiarlo a físico con la casilla explícita antes de confirmar.
        const normalizedType = tipo === "cheque" || tipo === "echeq"
          ? "echeq"
          : MEDIO_TIPOS.some((option) => option.value === tipo) ? tipo : "transferencia";
        parsedMedios.push({
          _id: uid(),
          tipo: normalizedType,
          monto: String(monto),
          fecha: String(payment.fecha_cobro || payment.fecha || todayStr()),
          referencia: String(payment.referencia || payment.cheque_numero || payment.cheque_id_digital || ""),
          observaciones: String(payment.notas || payment.concepto || ""),
          cheque_banco: String(payment.banco || ""),
          cheque_numero: String(payment.cheque_numero || payment.cheque_id_digital || ""),
          cheque_fecha_pago: String(payment.cheque_fecha || payment.fecha_cobro || payment.fecha || ""),
        });
      }

      if (parsedMedios.length) {
        setMedios((current) => current.length === 1 && !current[0].monto && !current[0].referencia ? parsedMedios : [...current, ...parsedMedios]);
      }
      if (parsedRetenciones.length) setRetenciones((current) => [...current, ...parsedRetenciones]);
      if (parsed.orden_pago_cliente) setOpReferencia(String(parsed.orden_pago_cliente));
      if (!parsedMedios.length && !parsedRetenciones.length) throw new Error("La IA no encontró medios de pago ni retenciones en el archivo.");
      setOpParseMessage(`IA completó ${parsedMedios.length} medio${parsedMedios.length === 1 ? "" : "s"} y ${parsedRetenciones.length} retención${parsedRetenciones.length === 1 ? "" : "es"}. Revisá los datos antes de confirmar.`);
    } catch (parseError) {
      setOpParseMessage(parseError instanceof Error ? parseError.message : "No se pudo leer la orden de pago");
    } finally {
      setParsingOP(false);
    }
  }

  // ── Confirm & register ──
  async function handleConfirmar() {
    if (!canConfirm) return;
    setSaving(true);
    setError("");

    try {
      const fechaPago = medios[0]?.fecha || todayStr();

      const cotizSuffix = isUSD && cotizNum > 0 ? ` | TC: ${cotizNum.toFixed(2)} (${cotizModalidad})` : "";

      // Build medios array (one movimiento per medio)
      const mediosPayload = medios.filter(m => num(m.monto) > 0).map(m => ({
        tipo: m.tipo === "echeq" ? "cheque_recibido" : m.tipo,
        monto: num(m.monto),
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
      const facturasPayload = facturas.map(f => ({
        id: f.id,
        numero: f.numero,
        saldo: f.saldo,
      }));

      if (!requestKeyRef.current) requestKeyRef.current = crypto.randomUUID();

      // Una unica RPC confirma movimientos, aplicaciones y cheques en cartera.
      const { data, error: rpcErr } = await (supabase as any).rpc("registrar_cobro_masivo_seguro", {
        p_cliente_id: clienteId,
        p_facturas: facturasPayload,
        p_medios: mediosPayload,
        p_retenciones: retencionesPayload,
        p_fecha: fechaPago,
        p_sociedad_id: sociedadId,
        p_request_key: requestKeyRef.current,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      const movCount = data?.movimientos_count || mediosPayload.length + retencionesPayload.length;
      alert(`Cobro registrado: ${movCount} movimiento${movCount > 1 ? "s" : ""} para ${facturas.length} factura${facturas.length > 1 ? "s" : ""}`);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Error al registrar el cobro");
    } finally {
      setSaving(false);
    }
  }

  const fc = formatCurrency;
  const m = moneda;

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
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
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
                    <td className="px-3 py-2 text-right font-mono text-orange-600">{fc(totalSaldo, m)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── 2. Orden de pago (opcional) ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              Orden de pago del cliente <span className="text-zinc-400 font-normal">(opcional)</span>
            </h3>
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
                {parsingOP ? "Leyendo con IA..." : "Adjuntar OP y leer con IA"}
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
            {opFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {opFiles.map((file) => <span key={`${file.name}-${file.size}`} className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><FileCheck2 className="h-3.5 w-3.5" />{file.name}</span>)}
              </div>
            )}
            {opParseMessage && <p className={`mt-2 text-xs ${opParseMessage.startsWith("IA completó") ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{opParseMessage}</p>}
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
                  <input type="number" step="0.01" min="0" placeholder="Ej: 1250.00"
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
                    <input type="number" step="0.01" min="0" placeholder="0.00"
                      value={medio.monto} onChange={e => updateMedio(medio._id, "monto", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
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
                      <input type="number" step="0.01" min="0" placeholder="0.00"
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
              <div className="flex justify-between"><span>Total facturas (saldo)</span><span className="font-mono">{fc(totalSaldo, m)}</span></div>
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
                  <button type="button" title="Completar en medio de pago" onClick={() => { if (medios.length > 0) { const remaining = r2(totalEsperado - medios.slice(1).reduce((s, m2) => s + num(m2.monto), 0)); updateMedio(medios[0]._id, "monto", String(Math.max(0, remaining))); } }}
                    className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-400 hover:text-orange-600"><ArrowDown size={13} /></button>
                  <span className="font-mono">{fc(totalEsperado, isUSD ? "ARS" : m)}</span>
                </span>
              </div>
              <div className="flex justify-between"><span>Total recibido (medios)</span><span className="font-mono">{fc(totalMedios, isUSD ? "ARS" : m)}</span></div>
              <div className={`flex justify-between font-bold text-base pt-1 border-t border-zinc-300 dark:border-zinc-600 ${
                Math.abs(diferencia) < 0.01 ? "text-green-600" : "text-red-600"
              }`}>
                <span>Diferencia</span>
                <span className="flex items-center gap-1.5">
                  <button type="button" title="Copiar pendiente" onClick={() => { navigator.clipboard.writeText(Math.abs(diferencia).toFixed(2)); }}
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600"><Copy size={13} /></button>
                  <button type="button" title="Completar en medio de pago" onClick={() => { if (medios.length > 0 && diferencia > 0.01) { const remaining = r2(totalEsperado - medios.slice(1).reduce((s, m2) => s + num(m2.monto), 0)); updateMedio(medios[0]._id, "monto", String(Math.max(0, remaining))); } }}
                    className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-400 hover:text-orange-600"><ArrowDown size={13} /></button>
                  <span className="font-mono">{fc(diferencia, isUSD ? "ARS" : m)}</span>
                </span>
              </div>
            </div>
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
            {Math.abs(diferencia) < 0.01
              ? "La diferencia es $0 — listo para confirmar"
              : "La diferencia debe ser $0 para confirmar el cobro"}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">
              Cancelar
            </button>
            <button onClick={handleConfirmar} disabled={!canConfirm}
              className="px-6 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Registrando..." : "Confirmar cobro"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
