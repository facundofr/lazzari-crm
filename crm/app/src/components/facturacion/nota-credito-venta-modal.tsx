"use client";

// Nota de crédito de una factura de venta: UNA sola ventana, la usan Facturación y Finanzas (ficha de la factura).
// Movida tal cual desde facturacion-content.tsx (mismos pasos, misma llamada a /api/facturacion, misma pregunta por el PR).
// Recibe el id de la factura y la vuelve a leer (total, acreditado, cliente) para no depender de qué pantalla la abrió.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileCheck, Loader2, Minus, Plus, ShieldCheck, X } from "lucide-react";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { beginInvoiceIntent, postInvoiceIntent } from "@/lib/invoice-intent";
import { useArcaStatus } from "@/lib/use-arca-status";
import { useFiscalDateLimits } from "@/lib/use-fiscal-date-limits";
import { parseDecimalInput } from "@/lib/decimal-input";
import { creditNoteTotals, creditNoteTypeForInvoice, freeAmountCreditItem, isInvoiceA, type SalesCreditNoteMode } from "@/lib/sales-credit-note";
import { fetchCobradoMap } from "@/lib/cobros-previos-venta";
import { emisorFacturacion } from "@/lib/emisor-facturacion";

type NcItem = { descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number };

interface NcFactura {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  cliente_id: string;
  total: number;
  moneda: string;
  tipo_cambio: number | null;
  estado: string;
  presupuesto_id: string | null;
  total_acreditado?: number | null;
  clientes: { razon_social: string } | null;
}

const SELECT_NC = "id, tipo, punto_venta, numero, cliente_id, total, moneda, tipo_cambio, estado, presupuesto_id, total_acreditado, clientes(razon_social)";

function formatComprobante(tipo: string, pv: number, num: number) {
  return `${tipo} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
}

export function NotaCreditoVentaModal({ facturaId, onClose, onEmitida }: {
  facturaId: string;
  onClose: () => void;
  /** Se llama cuando la NC quedó emitida o guardada: cada pantalla recarga su lista. */
  onEmitida?: () => void | Promise<void>;
}) {
  const { sociedadActiva } = useUser();
  const emisorData = emisorFacturacion(sociedadActiva);
  const arcaStatus = useArcaStatus(sociedadActiva?.id);

  // Ventana de 5 días hacia atrás que usa la NC (además de las fechas que habilita ARCA).
  const dateWindow = new Date(`${todayAR()}T12:00:00Z`);
  dateWindow.setUTCDate(dateWindow.getUTCDate() - 5);
  const dateWindowMin = dateWindow.toISOString().slice(0,10);

  // ── NC (Nota de Crédito) ────────────────────────────────
  // Arranca en "saving" (cargando) hasta tener la factura; si no se puede leer pasa a "error".
  const [ncFactura, setNcFactura] = useState<NcFactura | null>(null);
  const [ncItems, setNcItems] = useState<NcItem[]>([]);
  const [ncOriginalItems, setNcOriginalItems] = useState<NcItem[]>([]);
  const [ncMode, setNcMode] = useState<SalesCreditNoteMode>("total");
  const [ncAmount, setNcAmount] = useState("");
  const [ncAmountIva, setNcAmountIva] = useState(21);
  const [ncCobradoPrevio, setNcCobradoPrevio] = useState(0);
  const [ncFecha, setNcFecha] = useState(todayAR());
  const [ncManual, setNcManual] = useState(false);
  const [ncNumero, setNcNumero] = useState("");
  const [ncSaving, setNcSaving] = useState(false);
  const [ncError, setNcError] = useState("");
  const [ncStep, setNcStep] = useState<"form" | "saving" | "success" | "error">("saving");
  const [ncResult, setNcResult] = useState<string>("");
  const [ncSuccessWarning, setNcSuccessWarning] = useState("");
  // Después de una NC total que deja el PR en "facturar": ¿se vuelve a facturar? Es una pregunta, nunca frena nada.
  const [ncPrPregunta, setNcPrPregunta] = useState<{ prId: string; prNumero: string; notas: string; resuelto: "" | "si" | "no" | "error" } | null>(null);
  const ncRequestKeyRef = useRef("");

  const isFacturaANc = isInvoiceA(ncFactura?.tipo || "");
  const ncEsFce = ncFactura?.tipo === "FCEA" || ncFactura?.tipo === "FCEB";
  const ncTipo = creditNoteTypeForInvoice(ncFactura?.tipo || "FB");
  const ncFiscalDates = useFiscalDateLimits(!ncManual && Boolean(ncFactura), sociedadActiva?.id, emisorData.ptoVta, ncTipo);
  const ncFiscalMinDate = ncFiscalDates.minDate && ncFiscalDates.minDate > dateWindowMin ? ncFiscalDates.minDate : dateWindowMin;
  const ncDateBlocked = !ncFecha || ncFecha < (ncManual ? dateWindowMin : ncFiscalMinDate) || ncFecha > todayAR()
    || (!ncManual && !ncFiscalDates.ready);
  const ncAmountValue = parseDecimalInput(ncAmount);
  const ncItemsParaEmitir = ncMode === "amount"
    ? [freeAmountCreditItem(ncAmountValue, ncAmountIva, isFacturaANc)]
    : ncItems;
  const ncTotals = creditNoteTotals(ncItemsParaEmitir, isFacturaANc);
  const ncSaldoPendiente = Math.max(0, Number(ncFactura?.total || 0) - Number(ncFactura?.total_acreditado || 0) - ncCobradoPrevio);
  const ncExcedeSaldo = ncTotals.total > ncSaldoPendiente + 0.01;

  async function cargarNc(facturaId: string, vivo: () => boolean) {
    const { data: facturaDb, error: facturaErr } = await supabase.from("facturas").select(SELECT_NC).eq("id", facturaId).single();
    if (facturaErr || !facturaDb) { setNcError(facturaErr?.message || "No se encontró la factura."); setNcStep("error"); return; }
    const factura = facturaDb as unknown as NcFactura;
    if (!vivo()) return;
    beginInvoiceIntent(`nc:${sociedadActiva?.id}:${factura.id}`);
    // Cargar items de la factura original
    const { data: items } = await supabase
      .from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje")
      .eq("factura_id", factura.id)
      .order("orden");

    const originalItems = items && items.length > 0
      ? items.map(it => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21 }))
      : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }];
    let cobrado = 0;
    try { cobrado = (await fetchCobradoMap(sociedadActiva, { id: factura.id, moneda: factura.moneda }))[factura.id] || 0; } catch { /* El servidor vuelve a calcular bajo lock. */ }
    if (!vivo()) return;
    setNcFactura(factura);
    setNcPrPregunta(null);
    setNcOriginalItems(originalItems);
    setNcItems(originalItems);
    setNcMode("total");
    setNcAmount("");
    setNcAmountIva(originalItems[0]?.iva_porcentaje ?? 21);
    setNcCobradoPrevio(cobrado);
    // Las FCE solo se ajustan con su NC MiPyME autorizada.
    setNcManual(!["FCEA", "FCEB"].includes(factura.tipo) && arcaStatus !== null && arcaStatus.certOk === false);
    setNcNumero("");
    setNcFecha(todayAR());
    setNcError("");
    setNcStep("form");
    setNcResult("");
    setNcSuccessWarning("");
    ncRequestKeyRef.current = crypto.randomUUID();
  }

  useEffect(() => {
    let vivo = true;
    void cargarNc(facturaId, () => vivo);
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturaId, sociedadActiva?.id]);

  // ARCA puede contestar después de abrir la ventana: si el certificado no está, queda en manual (igual que cuando se abría con ARCA ya consultada).
  useEffect(() => {
    if (ncFactura && arcaStatus !== null && arcaStatus.certOk === false && !["FCEA", "FCEB"].includes(ncFactura.tipo)) setNcManual(true);
  }, [ncFactura?.id, arcaStatus?.certOk]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateNC() {
    if (!ncFactura) return;
    if (ncEsFce && ncManual) {
      setNcError(`La ${ncFactura.tipo} requiere ${ncTipo} electrónica con CAE. No puede registrarse como NC manual.`); return;
    }
    if (ncMode === "amount" && (!Number.isFinite(ncAmountValue) || ncAmountValue <= 0)) {
      setNcError("El campo Importe a acreditar debe ser mayor que cero y puede usar coma o punto decimal."); return;
    }
    if (ncItemsParaEmitir.some(it => !it.descripcion.trim() || !Number.isFinite(it.cantidad) || it.cantidad <= 0 || !Number.isFinite(it.precio_unitario) || it.precio_unitario < 0)) {
      setNcError("Cada ítem necesita una descripción, una cantidad mayor que cero y un precio válido."); return;
    }
    if (ncManual && (!ncNumero || Number(ncNumero) <= 0)) {
      setNcError("Ingresá el número de comprobante"); return;
    }
    if (ncDateBlocked) {
      setNcError(ncFiscalDates.error || `Elegí una fecha válida entre ${formatDate(ncManual ? dateWindowMin : ncFiscalMinDate)} y ${formatDate(todayAR())}`); return;
    }
    setNcSaving(true);
    setNcStep("saving");
    setNcError("");

    try {
      if (!ncManual) {
        // Electrónica via ARCA
        const { data: { session } } = await supabase.auth.getSession();
        const res = await postInvoiceIntent(`nc:${sociedadActiva?.id}:${ncFactura.id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            tipo: ncTipo,
            cliente_id: ncFactura.cliente_id,
            punto_venta: emisorData.ptoVta,
            moneda: ncFactura.moneda || "ARS",
            tipo_cambio: ncFactura.tipo_cambio || null,
            items: ncItemsParaEmitir,
            sociedad_id: sociedadActiva?.id,
            factura_origen_id: ncFactura.id,
            nota_credito_modo: ncMode,
            fecha: ncFecha,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Error al emitir NC");
        if (data.reconciliation_required) throw new Error(data.warning || "La NC fue autorizada y requiere completar su aplicación local. Reintentá sin cambiar los datos.");

        setNcResult(data.factura.comprobante + (data.factura.cae ? ` — CAE: ${data.factura.cae}` : ""));
        setNcSuccessWarning(data.warning || "");
      } else {
        // Manual sin ARCA: una sola llamada atómica e idempotente (A8).
        // Si la NC supera el saldo pendiente, la base avisa y se pide confirmación (nunca bloquea).
        if (!sociedadActiva?.id) throw new Error("No se pudo determinar la sociedad activa");
        if (!ncRequestKeyRef.current) ncRequestKeyRef.current = crypto.randomUUID();
        const ncManualParams = {
          p_request_key: ncRequestKeyRef.current,
          p_sociedad_id: sociedadActiva.id,
          p_factura_origen_id: ncFactura.id,
          p_tipo: ncTipo,
          p_punto_venta: emisorData.ptoVta,
          p_numero: Number(ncNumero),
          p_fecha: ncFecha,
          p_subtotal: ncTotals.neto,
          p_iva: ncTotals.iva,
          p_total: ncTotals.total,
          p_items: ncItemsParaEmitir.map((it, idx) => ({ descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, iva_porcentaje: isFacturaANc ? it.iva_porcentaje : 21, orden: idx })),
          p_modo: ncMode,
          p_observaciones: `Comprobante asociado: ${formatComprobante(ncFactura.tipo, ncFactura.punto_venta, ncFactura.numero)}`,
        };
        let { data: ncRpc, error: ncRpcErr } = await (supabase as any).rpc("crear_nota_credito_manual_venta", { ...ncManualParams, p_confirmar: false });
        if (ncRpcErr) throw new Error(ncRpcErr.message);
        if (ncRpc?.requires_confirmation) {
          const seguir = window.confirm(`${ncRpc.warning || "La NC supera el saldo pendiente de la factura."}\n\n¿Querés registrarla igual?`);
          if (!seguir) { setNcStep("form"); return; }
          ({ data: ncRpc, error: ncRpcErr } = await (supabase as any).rpc("crear_nota_credito_manual_venta", { ...ncManualParams, p_confirmar: true }));
          if (ncRpcErr) throw new Error(ncRpcErr.message);
        }
        if (!ncRpc?.ok) throw new Error("No se pudo registrar la nota de crédito.");
        ncRequestKeyRef.current = "";

        setNcResult(formatComprobante(ncTipo, emisorData.ptoVta, Number(ncNumero)) + " (manual)");
        setNcSuccessWarning(ncRpc?.warning || (ncExcedeSaldo ? "La NC supera el saldo pendiente; revisá el saldo a favor del cliente en su cuenta corriente." : ""));
      }

      setNcStep("success");
      await onEmitida?.();
      try {
        if (ncFactura.presupuesto_id) {
          const db = supabase as any;
          const [{ data: fAct }, { data: pAct }] = await Promise.all([
            db.from("facturas").select("estado").eq("id", ncFactura.id).single(),
            db.from("presupuestos").select("numero, estado, notas_internas").eq("id", ncFactura.presupuesto_id).single(),
          ]);
          if (fAct?.estado === "anulada" && pAct?.estado === "facturar") {
            setNcPrPregunta({ prId: ncFactura.presupuesto_id, prNumero: pAct.numero, notas: pAct.notas_internas || "", resuelto: "" });
          }
        }
      } catch { /* la pregunta es opcional: la NC ya está emitida */ }
    } catch (err: unknown) {
      setNcError(err instanceof Error ? err.message : "Error al crear NC");
      setNcStep("error");
    } finally {
      setNcSaving(false);
    }
  }

  return (
    <>
      {ncFactura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-bold dark:text-white">Nota de crédito</h2>
                <p className="text-sm text-zinc-400">
                  Para {formatComprobante(ncFactura.tipo, ncFactura.punto_venta, ncFactura.numero)} — {ncFactura.clientes?.razon_social}
                </p>
              </div>
              <button onClick={() => onClose()} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            {ncStep === "form" && (
              <div className="p-6 space-y-5">
                {ncError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{ncError}</div>}

                {/* Referencia a la factura original */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-zinc-500">Comprobante original</span>
                    <span className="font-mono font-semibold">{formatComprobante(ncFactura.tipo, ncFactura.punto_venta, ncFactura.numero)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Total original</span>
                    <span className="font-mono">{formatCurrency(Number(ncFactura.total), ncFactura.moneda as "USD" | "ARS")}</span>
                  </div>
                  {Number(ncFactura.total_acreditado) > 0 && (
                    <div className="flex justify-between text-amber-600 dark:text-amber-400 mt-1">
                      <span>Ya acreditado</span>
                      <span className="font-mono">{formatCurrency(Number(ncFactura.total_acreditado), ncFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>

                {ncEsFce && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                    Se emitirá una {ncTipo === "NCEA" ? "Nota de Crédito Electrónica MiPyME A — código ARCA 203" : "Nota de Crédito Electrónica MiPyME B — código ARCA 208"}, vinculada a la FCE original. El modo manual está deshabilitado para evitar un comprobante fiscal incorrecto.
                  </div>
                )}

                {/* Toggle ARCA / Manual */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                    <button
                      onClick={() => setNcManual(false)}
                      disabled={arcaStatus !== null && arcaStatus.certOk === false}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!ncManual ? "bg-orange-500 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Con ARCA
                    </button>
                    <button
                      onClick={() => setNcManual(true)}
                      disabled={ncEsFce}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ncManual ? "bg-zinc-700 text-white dark:bg-zinc-600" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    >
                      <FileCheck className="h-3.5 w-3.5" /> Manual (sin CAE)
                    </button>
                  </div>
                  {arcaStatus !== null && arcaStatus.certOk === false && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {ncEsFce
                        ? "ARCA no está configurado. Una nota MiPyME no puede emitirse manualmente."
                        : "ARCA no configurado — solo modo manual disponible."}
                    </p>
                  )}
                  {ncEsFce && (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Se emitirá {ncTipo} — código ARCA {ncTipo === "NCEA" ? "203" : "208"} — asociada a la FCE original. El modo manual no corresponde a este comprobante.
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha de emisión *</label>
                    <input
                      type="date"
                      value={ncFecha}
                      min={ncManual ? dateWindowMin : ncFiscalMinDate}
                      max={todayAR()}
                      disabled={!ncManual && !ncFiscalDates.ready}
                      onChange={(e) => setNcFecha(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    {!ncManual && (
                      <div className="mt-1 text-xs text-zinc-500">
                        {ncFiscalDates.error ? <><span className="text-red-600">{ncFiscalDates.error}</span> <button type="button" onClick={ncFiscalDates.retry} className="underline">Reintentar</button></>
                          : !ncFiscalDates.ready ? "Consultando fechas habilitadas en ARCA…"
                          : <>{ncFiscalDates.warning ? <span className="text-amber-600 dark:text-amber-400">{ncFiscalDates.warning} </span> : <>Primera fecha habilitada: {formatDate(ncFiscalMinDate)}. </>}{ncFecha < ncFiscalMinDate && <span className="text-red-600">Cambiá la fecha seleccionada.</span>}</>}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
                    <div className="flex justify-between"><span className="text-zinc-500">Saldo pendiente</span><span className="font-mono font-semibold">{formatCurrency(ncSaldoPendiente, ncFactura.moneda as "USD" | "ARS")}</span></div>
                    {ncCobradoPrevio > 0 && <div className="mt-1 flex justify-between text-zinc-500"><span>Cobros previos</span><span className="font-mono">{formatCurrency(ncCobradoPrevio, ncFactura.moneda as "USD" | "ARS")}</span></div>}
                  </div>
                </div>

                {/* Número manual */}
                {ncManual && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">N° Comprobante *</label>
                      <input type="number" min={1} value={ncNumero} onChange={(e) => setNcNumero(e.target.value)} placeholder="00000001" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    </div>
                    <div className="flex items-end pb-2">
                      <p className="text-xs text-amber-600 dark:text-amber-400">Sin CAE. Ajustá el número al talonario.</p>
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-sm font-medium dark:text-zinc-300">Alcance de la nota de crédito</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ["total", "Total"],
                      ["items", "Por ítems"],
                      ["amount", "Importe libre"],
                    ] as const).map(([mode, label]) => (
                      <button key={mode} type="button" onClick={() => {
                        setNcMode(mode);
                        if (mode !== "amount") setNcItems(ncOriginalItems.map((item) => ({...item})));
                        setNcError("");
                      }} className={`rounded-lg border px-3 py-2 text-xs font-medium ${ncMode === mode ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {ncMode === "amount" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Importe total a acreditar</label>
                      <input type="text" inputMode="decimal" value={ncAmount} onChange={(e) => setNcAmount(e.target.value)} placeholder="0,00"
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                      <p className="mt-1 text-xs text-zinc-500">Acepta coma o punto decimal.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">IVA aplicado</label>
                      <select value={ncAmountIva} onChange={(e) => setNcAmountIva(Number(e.target.value))}
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                        <option value={21}>21%</option><option value={10.5}>10,5%</option><option value={27}>27%</option><option value={0}>0%</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Items NC — editables para NC parcial */}
                {ncMode !== "amount" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium dark:text-zinc-300">
                      Items a acreditar <span className="text-xs font-normal text-zinc-400">{ncMode === "items" ? "(cantidades y precios editables)" : "(factura completa)"}</span>
                    </label>
                    {ncMode === "items" && <button
                      onClick={() => setNcItems(p => [...p, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }])}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      <Plus className="h-3 w-3" /> Agregar
                    </button>}
                  </div>
                  <div className="space-y-2">
                    {ncItems.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <div className={isFacturaANc ? "col-span-5" : "col-span-7"}>
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Descripción</label>}
                          <input disabled={ncMode === "total"} value={item.descripcion} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, descripcion: e.target.value } : it))} placeholder="Descripción" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white disabled:opacity-70" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Cant.</label>}
                          <input disabled={ncMode === "total"} type="number" min={0} step="0.01" value={item.cantidad} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, cantidad: Number(e.target.value) } : it))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white disabled:opacity-70" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">{isFacturaANc ? "Neto unit." : "Precio"}</label>}
                          <input disabled={ncMode === "total"} type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, precio_unitario: Number(e.target.value) } : it))} placeholder="0.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white disabled:opacity-70" />
                        </div>
                        {isFacturaANc && (
                          <div className="col-span-2">
                            {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">IVA %</label>}
                            <select disabled={ncMode === "total"} value={item.iva_porcentaje} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, iva_porcentaje: Number(e.target.value) } : it))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white disabled:opacity-70">
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className="col-span-1 flex items-end">
                          {ncMode === "items" && ncItems.length > 1 && (
                            <button onClick={() => setNcItems(p => p.filter((_, i) => i !== idx))} className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-500">
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                )}

                {/* Totals */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
                  {isFacturaANc ? (
                    <>
                      <div className="flex justify-between"><span className="text-zinc-500">Neto gravado</span><span className="font-mono">{formatCurrency(ncTotals.neto, ncFactura?.moneda as "USD" | "ARS")}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(ncTotals.iva, ncFactura?.moneda as "USD" | "ARS")}</span></div>
                      <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold text-base">
                        <span>Total NC</span><span className="font-mono">{formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between font-semibold text-base">
                      <span>Total NC</span><span className="font-mono">{formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>

                {ncExcedeSaldo && (
                  <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>El total de la NC supera el saldo pendiente. Se emitirá igualmente y la diferencia quedará identificada como saldo a favor del cliente.</span>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => onClose()} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
                  <button
                    onClick={handleCreateNC}
                    disabled={ncSaving || ncTotals.total <= 0}
                    className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 ${ncManual ? "bg-zinc-700 hover:bg-zinc-800" : "bg-orange-500 hover:bg-orange-600"}`}
                  >
                    {ncManual ? <FileCheck className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    {ncManual ? "Guardar NC manual" : "Emitir NC con ARCA"}
                  </button>
                </div>
              </div>
            )}

            {ncStep === "saving" && (
              <div className="p-12 flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                <p className="text-sm text-zinc-500">{ncManual ? "Guardando nota de crédito..." : "Autorizando NC con ARCA..."}</p>
              </div>
            )}

            {ncStep === "success" && (
              <div className="p-8 flex flex-col items-center gap-4">
                <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold dark:text-white">Nota de Crédito emitida</h3>
                <p className="text-sm font-mono text-emerald-700 dark:text-emerald-400">{ncResult}</p>
                <p className="text-xs text-zinc-400">Total acreditado: {formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</p>
                {ncSuccessWarning && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{ncSuccessWarning}</p>}
                {ncPrPregunta && (
                  <div className="w-full rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm dark:border-orange-900 dark:bg-orange-950/20">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">¿Se vuelve a facturar el {ncPrPregunta.prNumero}?</p>
                    <p className="mt-0.5 text-xs text-zinc-500">La factura quedó anulada y el PR volvió a &quot;Facturar&quot;. Si no se refactura, sigue contando como venta.</p>
                    {ncPrPregunta.resuelto === "" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button onClick={() => setNcPrPregunta((p) => p ? { ...p, resuelto: "si" } : p)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-200">Sí, se refactura (queda en Ventas)</button>
                        <button onClick={async () => {
                          const p = ncPrPregunta;
                          try {
                            const nota = `[${new Date().toLocaleDateString("es-AR")}] NC total ${ncResult.split(" — ")[0]}: no se vuelve a facturar. PR cerrado como rechazado.`;
                            const { error } = await (supabase as any).from("presupuestos").update({ estado: "rechazado", motivo_rechazo: "NC total, no se vuelve a facturar", respondido_at: new Date().toISOString(), notas_internas: p.notas ? `${p.notas}
${nota}` : nota }).eq("id", p.prId).eq("sociedad_id", sociedadActiva?.id);
                            if (error) throw error;
                            setNcPrPregunta({ ...p, resuelto: "no" });
                          } catch { setNcPrPregunta((q) => q ? { ...q, resuelto: "error" } : q); }
                        }} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600">No, cerrar el PR (rechazado)</button>
                      </div>
                    )}
                    {ncPrPregunta.resuelto === "si" && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Listo: el PR queda en Finanzas Lazza → Facturar para re-facturar (corregí el precio antes si hace falta).</p>}
                    {ncPrPregunta.resuelto === "no" && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Listo: el PR quedó como rechazado, con una nota interna, y ya no cuenta como venta.</p>}
                    {ncPrPregunta.resuelto === "error" && <p className="mt-2 text-xs text-red-600">No se pudo cerrar el PR. Podés pasarlo a Rechazado a mano desde Presupuestos.</p>}
                  </div>
                )}
                <button onClick={() => onClose()} className="mt-2 px-6 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Cerrar</button>
              </div>
            )}

            {ncStep === "error" && (
              <div className="p-8 flex flex-col items-center gap-4">
                <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
                <h3 className="text-lg font-bold dark:text-white">Error al emitir NC</h3>
                <p className="text-sm text-red-600 dark:text-red-400 text-center">{ncError}</p>
                <button onClick={() => setNcStep("form")} className="px-6 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-medium dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">Volver</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
