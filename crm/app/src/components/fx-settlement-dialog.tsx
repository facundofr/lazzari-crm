"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ZonaArchivos } from "@/components/ui/zona-archivos";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, todayAR } from "@/lib/utils";
import { parseDecimalInput, toDecimalInput } from "@/lib/decimal-input";
import { buildOrdenPagoPlan, type OpParsed } from "@/lib/orden-pago-plan";
import { diaHabilAnterior } from "@/lib/dias-habiles";
import { modalidadCobroUsd, compararTcCobro, mensajeActualizacionTc, UMBRAL_TC_COBRO, type ModalidadUsd } from "@/lib/tc-cobro-usd";

export interface FxSettlementDocument { id: string; numero: string; saldo: number; total: number; subtotal?: number; cotizacion?: number }
interface Props {
  kind: "cobro" | "pago";
  sociedadId: string;
  counterpartyId: string;
  documents: FxSettlementDocument[];
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
  /** Orden de pago ya leída por IA: se aplica al abrir (cobro de todas las facturas de una OP). */
  ordenPago?: OpParsed;
  /** Mensajes del paso a paso cuando se cobran todas las facturas de una OP. */
  ordenPagoAvisos?: string[];
  /** Si la OP paga otras facturas, ofrece cobrarlas todas juntas. */
  onCobrarOrdenCompleta?: (ordenPago: OpParsed) => void;
}
type Medio = { tipo: string; monto: string; fecha: string; referencia: string };
type Retencion = { tipo: string; monto: string; certificado: string };
const cents = (n: number) => Math.round(n * 100);
// Importes: aceptan coma decimal y puntos de miles ("1.241.525,27"). Ver decimal-input.ts.
// Nunca quitar el punto decimal a mano: 834.77 es USD 834,77, no USD 83.477.
const parseNum = parseDecimalInput;
const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 disabled:opacity-60";
const button = "rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 disabled:opacity-50";
// C4: en cobros, la función liquidar_documentos_fx ya acepta "cheque_recibido" como medio
// (imputa los pesos a la factura USD). No da de alta el cheque en la cartera: se avisa.
const mediosBase = ["transferencia", "efectivo", "deposito"];
const mediosPorKind = (kind: "cobro" | "pago") => (kind === "cobro" ? [...mediosBase, "cheque_recibido"] : mediosBase);
const medioLabel: Record<string, string> = { transferencia: "transferencia", efectivo: "efectivo", deposito: "deposito", cheque_recibido: "cheque / eCheq" };
const retentionTypes = [{ value: "retencion_iva", label: "IVA" }, { value: "retencion_ganancias", label: "Ganancias" }, { value: "retencion_iibb", label: "IIBB" }, { value: "retencion_suss", label: "SUSS" }];

export function FxSettlementDialog({ kind, sociedadId, counterpartyId, documents, onClose, onSuccess, ordenPago, ordenPagoAvisos, onCobrarOrdenCompleta }: Props) {
  const [fecha, setFecha] = useState(todayAR());
  const [cotizacionFecha, setCotizacionFecha] = useState(diaHabilAnterior(todayAR()));
  const [modalidad, setModalidad] = useState<"divisas" | "billetes" | "manual">("divisas");
  const [cotizacion, setCotizacion] = useState("");
  const [bnaRef, setBnaRef] = useState<{ label: string; valor: number; fecha: string } | null>(null);
  // Divisa o billete del cliente: con eso se compara contra el BNA (regla de Augusto, lib/tc-cobro-usd.ts).
  const [modalidadCliente, setModalidadCliente] = useState<ModalidadUsd | null>(null);
  const [copiado, setCopiado] = useState(false);
  // Mientras el usuario no elija otra cotización, se usa la del cliente (TC implícito).
  const tcElegido = useRef(false);
  const [quoteStamp, setQuoteStamp] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>(() => Object.fromEntries(documents.map(d => [d.id, ""])));
  const [medios, setMedios] = useState<Medio[]>([{ tipo: "transferencia", monto: "", fecha: todayAR(), referencia: "" }]);
  const [retenciones, setRetenciones] = useState<Retencion[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [leyendoOp, setLeyendoOp] = useState(false);
  // aviso: lo leído trae algo para revisar → ámbar, no verde (auditoría UX 26/10/2026, arreglo 6).
  const [opMensaje, setOpMensaje] = useState<{ ok: boolean; lineas: string[]; aviso?: boolean } | null>(null);
  const [opConOtras, setOpConOtras] = useState<OpParsed | null>(null);
  const opFileRef = useRef<HTMLInputElement>(null);
  const quoteRequest = useRef(0);
  const inFlight = useRef(false);
  const requestKey = useRef<string | null>(null);
  const sentPayload = useRef<Record<string, unknown> | null>(null);
  const scope = `lazzari.fx-settlement.v1:${kind}:${sociedadId}:${counterpartyId}:${documents.map(d => d.id).sort().join(",")}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(scope);
      if (!raw) return;
      const previous = JSON.parse(raw), p = previous.payload;
      if (!p || p.p_sociedad_id !== sociedadId || p.p_counterparty_id !== counterpartyId || p.p_kind !== kind) throw new Error("No se pudo recuperar la operación pendiente. Revisala antes de generar otra.");
      requestKey.current = previous.key; sentPayload.current = p;
      setFecha(p.p_fecha); setCotizacionFecha(p.p_cotizacion_fecha); setModalidad(p.p_modalidad); setCotizacion(toDecimalInput(Number(p.p_cotizacion)));
      setAllocations(Object.fromEntries(p.p_documentos.map((d: { id: string; monto_usd: number }) => [d.id, toDecimalInput(Number(d.monto_usd))])));
      setMedios(p.p_medios.map((m: Medio) => ({ ...m, monto: toDecimalInput(Number(m.monto)) })));
      setRetenciones(p.p_retenciones.map((r: Retencion) => ({ ...r, monto: toDecimalInput(Number(r.monto)) })));
      setSubmitted(true); setError("Recuperamos una operación pendiente con sus datos originales. Reintentá para consultar o completar el mismo registro, sin duplicarlo.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo recuperar la operación pendiente."); }
  }, [scope, sociedadId, counterpartyId, kind]);
  const rate = parseNum(cotizacion);
  const totalUsd = documents.reduce((sum, d) => sum + cents(parseNum(allocations[d.id] || "0")), 0) / 100;
  const expectedArs = documents.reduce((sum, d) => sum + cents(parseNum(allocations[d.id] || "0") * rate), 0) / 100;
  const paidArs = medios.reduce((sum, m) => sum + cents(parseNum(m.monto || "0")), 0) / 100;
  const retainedArs = retenciones.reduce((sum, r) => sum + cents(parseNum(r.monto || "0")), 0) / 100;
  const difference = cents(expectedArs - paidArs - retainedArs) / 100;
  const initialValue = useMemo(() => documents.reduce((sum, d) => sum + (d.cotizacion && d.cotizacion > 0 ? parseNum(allocations[d.id] || "0") * d.cotizacion : 0), 0), [documents, allocations]);
  const hasAllOriginalRates = documents.filter(d => parseNum(allocations[d.id] || "0") > 0).every(d => d.cotizacion && d.cotizacion > 0);
  // TC implícito: con cuántos pesos (depósito + retenciones) el cliente canceló cada dólar.
  const impliedRate = totalUsd > 0 && paidArs + retainedArs > 0 ? (paidArs + retainedArs) / totalUsd : null;
  const allocatedDocs = documents.filter(d => parseNum(allocations[d.id] || "0") > 0);
  const invoiceRates = Array.from(new Set(allocatedDocs.map(d => d.cotizacion).filter((r): r is number => !!r && r > 0)));
  const invoiceRate = invoiceRates.length === 1 && allocatedDocs.every(d => d.cotizacion === invoiceRates[0]) ? invoiceRates[0] : null;
  const rateCandidates = [
    ...(invoiceRate ? [{ key: "factura", label: "TC de la factura", valor: invoiceRate }] : []),
    ...(bnaRef ? [{ key: "bna", label: bnaRef.label, valor: bnaRef.valor }] : []),
  ];
  // Coincide si la diferencia total en pesos es menor a $1 (redondeos de centavos).
  const matchesImplied = (valor: number) => impliedRate !== null && Math.abs((impliedRate - valor) * totalUsd) < 1;
  // TC de la(s) factura(s): si todas comparten el mismo, se ofrece como botón de un clic.
  const documentRates = Array.from(new Set(documents.map(d => d.cotizacion).filter((r): r is number => !!r && r > 0)));
  const singleDocumentRate = documentRates.length === 1 ? documentRates[0] : null;
  function applyRate(valor: number) { changeQuote(); setModalidad("manual"); setCotizacion(toDecimalInput(Math.round(valor * 1000000) / 1000000)); }

  // Lee la orden de pago del cliente con IA y completa el formulario solo con lo que
  // corresponde a estas facturas. Nada se guarda hasta "Confirmar liquidación".
  async function leerOrdenPago(files: File[]) {
    if (!files.length) return;
    setLeyendoOp(true); setOpMensaje(null); setError("");
    try {
      const form = new FormData();
      files.forEach(f => form.append("file", f));
      form.append("contexto", "orden_pago_cliente");
      const response = await fetch("/api/parse-cobro", { method: "POST", body: form });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "No se pudo leer la orden de pago.");
      aplicarOrdenPago(json.data as OpParsed);
    } catch (e) {
      setOpMensaje({ ok: false, lineas: [e instanceof Error ? e.message : "No se pudo leer la orden de pago."] });
    } finally {
      setLeyendoOp(false);
      if (opFileRef.current) opFileRef.current.value = "";
    }
  }

  function aplicarOrdenPago(parsed: OpParsed) {
    try {
      const plan = buildOrdenPagoPlan(parsed, documents.map(d => ({ id: d.id, numero: d.numero })));
      const lineas: string[] = [];
      const avisos: string[] = [];
      const ars = (n: number) => formatCurrency(n, "ARS");

      // Fecha de la operación = fecha del pago (nunca futura).
      const fechaOp = plan.fecha && /^\d{4}-\d{2}-\d{2}$/.test(plan.fecha) && plan.fecha <= todayAR() ? plan.fecha : fecha;
      setFecha(fechaOp); setCotizacionFecha(diaHabilAnterior(fechaOp));

      // USD a cancelar y tipo de cambio que usó el cliente.
      if (plan.incluidas.length) {
        const nuevasAsignaciones: Record<string, string> = { ...allocations };
        let totalUsdOp = 0, totalArsOp = 0, todasAlTcFactura = true;
        for (const inc of plan.incluidas) {
          const doc = documents.find(d => d.id === inc.docId);
          if (!doc) continue;
          nuevasAsignaciones[doc.id] = toDecimalInput(doc.saldo);
          totalUsdOp += doc.saldo; totalArsOp += inc.importe;
          if (!(doc.cotizacion && Math.abs(doc.saldo * doc.cotizacion - inc.importe) < 1)) todasAlTcFactura = false;
        }
        setAllocations(nuevasAsignaciones);
        const tcFactura = plan.incluidas.map(i => documents.find(d => d.id === i.docId)?.cotizacion).find(Boolean);
        if (todasAlTcFactura && tcFactura && documentRates.length === 1) {
          applyRate(tcFactura);
          lineas.push(`El cliente pagó al TC de la factura (${ars(tcFactura)}).`);
        } else if (totalUsdOp > 0) {
          applyRate(totalArsOp / totalUsdOp);
          lineas.push(`El cliente pagó a un TC de ${ars(totalArsOp / totalUsdOp)} (calculado de lo que pagó). Se asumió que cancela el saldo completo: si fue un pago parcial, corregí "USD a cancelar".`);
        }
      }

      // Medios: transferencia, depósito y efectivo (y en cobros, cheque/eCheq), todos con la fecha de la operación.
      const esCheque = (t: string) => ["cheque", "echeq", "cheque_recibido"].includes(t);
      const permitidos = mediosPorKind(kind);
      const mediosOk = plan.medios
        .map(m => (esCheque(m.tipo) && permitidos.includes("cheque_recibido") ? { ...m, tipo: "cheque_recibido", chequeTipo: m.tipo } : { ...m, chequeTipo: "" }))
        .filter(m => permitidos.includes(m.tipo));
      if (mediosOk.length < plan.medios.length) avisos.push("La orden incluye medios que este formulario no registra (cheques en pagos u otros): revisalos.");
      if (mediosOk.some(m => m.tipo === "cheque_recibido")) avisos.push("La orden incluye cheques o eCheqs: se imputan a la factura, pero no quedan en la cartera de Cheques. Cargalos en Finanzas > Cheques (eso no genera otro cobro).");
      if (mediosOk.length) setMedios(mediosOk.map(m => ({ tipo: m.tipo, monto: toDecimalInput(m.monto), fecha: fechaOp, referencia: [m.chequeTipo === "echeq" ? "eCheq" : m.chequeTipo ? "Cheque" : "", m.tipo === "cheque_recibido" ? m.referencia : "", plan.referencia && `OP ${plan.referencia}`, m.banco].filter(Boolean).join(" · ") || m.referencia })));

      const retOk = plan.retenciones.filter(r => retentionTypes.some(t => t.value === r.tipo));
      if (retOk.length < plan.retenciones.length) avisos.push("Hay percepciones u otros descuentos que este formulario no admite: revisalos.");
      setRetenciones(retOk.map(r => ({ tipo: r.tipo, monto: toDecimalInput(r.monto), certificado: r.certificado })));
      if (retOk.some(r => !r.certificado)) avisos.push("Alguna retención vino sin número de certificado: completalo antes de confirmar.");

      setOpConOtras(plan.otras.length && !ordenPagoAvisos ? parsed : null);
      if (ordenPagoAvisos) avisos.push(...ordenPagoAvisos);
      else for (const o of plan.otras) {
        const det = o.retenciones.map(r => `${retentionTypes.find(t => t.value === r.tipo)?.label || r.tipo} ${ars(r.monto)}`).join(", ");
        avisos.push(`La orden también paga ${o.comprobante} por ${ars(o.importe)}: cobrala aparte con ${ars(o.medios)} del pago${det ? ` + retenciones ${det}` : ""}.`);
      }
      // Una transferencia o un cheque suelto no trae detalle de facturas: ese aviso es solo para órdenes de pago.
      const esOrden = !!parsed.orden_pago_cliente || (parsed.facturas_pagadas || []).length > 0;
      avisos.push(...(esOrden ? plan.avisos : plan.avisos.filter(a => !a.startsWith("La IA no encontró el detalle de facturas"))));
      setOpMensaje({ ok: true, aviso: avisos.length > 0, lineas: [`IA leyó la orden de pago${plan.referencia ? ` N° ${plan.referencia}` : ""}. Revisá los datos antes de confirmar.`, ...lineas, ...avisos] });
    } catch (e) {
      setOpMensaje({ ok: false, lineas: [e instanceof Error ? e.message : "No se pudo aplicar la orden de pago."] });
    }
  }

  // Orden de pago recibida ya leída: se aplica una sola vez al abrir.
  const ordenPagoAplicada = useRef(false);
  useEffect(() => {
    if (!ordenPago || ordenPagoAplicada.current || sentPayload.current) return;
    ordenPagoAplicada.current = true;
    aplicarOrdenPago(ordenPago);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenPago]);

  async function consultarBna() {
    if (modalidad === "manual" || !cotizacionFecha) return;
    const id = ++quoteRequest.current;
    const stamp = `${modalidad}:${cotizacionFecha}`;
    setLoadingQuote(true); setError(""); setQuoteStamp("");
    try {
      const response = await fetch(`/api/cotizacion-bna?modalidad=${modalidad}&fecha=${encodeURIComponent(cotizacionFecha)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !(Number(data.valor_venta) > 0)) throw new Error(data.error || "No se obtuvo una cotización válida.");
      if (data.fecha !== cotizacionFecha) throw new Error(`BNA devolvió ${data.fecha || "otra fecha"}, no ${cotizacionFecha}. No se aplicó: elegí esa fecha explícitamente o usá cotización manual.`);
      if (id === quoteRequest.current) { setCotizacion(toDecimalInput(Number(data.valor_venta))); setQuoteStamp(stamp); }
    } catch (e) { if (id === quoteRequest.current) setError(e instanceof Error ? e.message : "No se pudo consultar BNA."); }
    finally { if (id === quoteRequest.current) setLoadingQuote(false); }
  }
  function changeQuote() { quoteRequest.current += 1; setLoadingQuote(false); setQuoteStamp(""); }

  // Divisa o billete: lo de las facturas o, si no dicen, la ficha del cliente.
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (kind !== "cobro") { setModalidadCliente("divisas"); return; }
      const [{ data: fs }, { data: cli }] = await Promise.all([
        (supabase as any).from("facturas").select("cotizacion_modalidad").in("id", documents.map(d => d.id)),
        (supabase as any).from("clientes").select("moneda_predeterminada").eq("id", counterpartyId).maybeSingle(),
      ]);
      const m = modalidadCobroUsd((fs || []).map((f: { cotizacion_modalidad: string | null }) => f.cotizacion_modalidad), cli?.moneda_predeterminada);
      if (!vivo) return;
      setModalidadCliente(m);
      if (!sentPayload.current && !tcElegido.current) setModalidad(prev => (prev === "manual" ? prev : m));
    })().catch(() => { if (vivo) setModalidadCliente("divisas"); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, counterpartyId]);

  // BNA de referencia (día hábil anterior al cobro), se trae solo.
  useEffect(() => {
    if (!modalidadCliente || !cotizacionFecha) return;
    let vivo = true;
    setBnaRef(null);
    fetch(`/api/cotizacion-bna?modalidad=${modalidadCliente}&fecha=${encodeURIComponent(cotizacionFecha)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (!vivo || !(Number(data.valor_venta) > 0) || !data.fecha) return;
        const dias = (Date.parse(cotizacionFecha) - Date.parse(data.fecha)) / 86400000;
        if (dias < 0 || dias > 7) return;
        setBnaRef({ label: `BNA ${modalidadCliente === "billetes" ? "billete" : "divisa"} ${String(data.fecha).split("-").reverse().join("/")}`, valor: Number(data.valor_venta), fecha: data.fecha });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [modalidadCliente, cotizacionFecha]);

  // Sin cotización elegida a mano: arranca con el BNA y, apenas hay pesos cargados, se cancela con el TC del cliente.
  useEffect(() => {
    if (sentPayload.current || tcElegido.current || modalidad === "manual" || !modalidadCliente || modalidad !== modalidadCliente) return;
    if (quoteStamp !== `${modalidad}:${cotizacionFecha}` && !loadingQuote) void consultarBna();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalidad, modalidadCliente, cotizacionFecha]);
  useEffect(() => {
    if (sentPayload.current || tcElegido.current || impliedRate === null) return;
    const v = Math.round(impliedRate * 1000000) / 1000000;
    if (modalidad === "manual" && Math.abs(rate - v) < 0.000001) return;
    changeQuote(); setModalidad("manual"); setCotizacion(toDecimalInput(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impliedRate]);
  const comparacion = kind === "cobro" && impliedRate !== null && bnaRef ? compararTcCobro(impliedRate, bnaRef.valor, totalUsd) : null;
  const mensajeCliente = comparacion?.estado === "abajo" && bnaRef && impliedRate !== null && modalidadCliente
    ? mensajeActualizacionTc({ facturas: allocatedDocs.map(d => d.numero), tcCliente: impliedRate, tcBna: bnaRef.valor, modalidad: modalidadCliente, fechaBna: bnaRef.fecha, faltante: comparacion.faltante })
    : "";
  const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  async function guardar() {
    if (inFlight.current) return;
    if (!sentPayload.current) {
      if (!sociedadId || !counterpartyId || !fecha || fecha > todayAR() || !cotizacionFecha || cotizacionFecha > fecha || !Number.isFinite(rate) || rate <= 0 || rate > 100000000 || Math.abs(rate - Math.round(rate * 1000000) / 1000000) > 0.000000001) { setError("Completá fechas válidas: operación no futura y cotización no posterior a la operación. La cotización admite hasta seis decimales y debe ser mayor a cero."); return; }
      if (!medios.length) { setError("Agregá al menos un medio en ARS para registrar la liquidación."); return; }
      if (modalidad !== "manual" && quoteStamp !== `${modalidad}:${cotizacionFecha}`) { setError("Consultá BNA para la modalidad y fecha elegidas, o seleccioná Manual."); return; }
      if (!Number.isFinite(totalUsd) || totalUsd <= 0 || documents.some(d => !Number.isFinite(parseNum(allocations[d.id] || "0")) || parseNum(allocations[d.id] || "0") < 0 || cents(parseNum(allocations[d.id] || "0")) > cents(d.saldo))) { setError("Indicá USD a cancelar sin superar el saldo de cada factura."); return; }
      if (medios.some(m => !mediosPorKind(kind).includes(m.tipo) || m.fecha !== fecha || !Number.isFinite(parseNum(m.monto)) || parseNum(m.monto) <= 0) || retenciones.some(r => !retentionTypes.some(t => t.value === r.tipo) || !r.certificado.trim() || !Number.isFinite(parseNum(r.monto)) || parseNum(r.monto) <= 0)) { setError("Completá cada medio y retención con importe positivo. Todos los medios deben tener la fecha de la operación; las retenciones requieren certificado."); return; }
      if ([...documents.map(d => parseNum(allocations[d.id] || "0")), ...medios.map(m => parseNum(m.monto)), ...retenciones.map(r => parseNum(r.monto))].some(value => Math.abs(value - cents(value) / 100) > 0.0000001)) { setError("Los importes admiten como máximo dos decimales."); return; }
      // Allow difference — it's common due to exchange rate variations
    }
    setError(""); setSaving(true); inFlight.current = true;
    try {
      if (!navigator.locks?.request) throw new Error("Este navegador no permite proteger liquidaciones simultáneas. Usá un navegador actualizado.");
      await navigator.locks.request(scope, { mode: "exclusive" }, async () => {
      if (!sentPayload.current) {
        const saved = localStorage.getItem(scope);
        if (saved) {
          throw new Error("Ya existe una liquidación pendiente para estas facturas. Cerrá y volvé a abrir para revisar y recuperar sus datos originales.");
        } else {
          requestKey.current = crypto.randomUUID();
          const payload = {
            p_sociedad_id: sociedadId, p_request_key: requestKey.current, p_kind: kind, p_counterparty_id: counterpartyId,
            p_fecha: fecha, p_cotizacion: rate, p_cotizacion_fecha: cotizacionFecha, p_modalidad: modalidad,
            p_documentos: documents.filter(d => parseNum(allocations[d.id] || "0") > 0).map(d => ({ id: d.id, monto_usd: parseNum(allocations[d.id]) })),
            p_medios: medios.map(m => ({ ...m, monto: parseNum(m.monto) })),
            p_retenciones: retenciones.map(r => ({ ...r, monto: parseNum(r.monto) })),
          };
          localStorage.setItem(scope, JSON.stringify({ key: requestKey.current, payload }));
          sentPayload.current = payload;
        }
      }
      setSubmitted(true);
      const { data, error: rpcError } = await (supabase as any).rpc("liquidar_documentos_fx", sentPayload.current);
      if (rpcError) throw new Error(rpcError.message || "No se pudo registrar la liquidación.");
      if (data?.success === false) throw new Error(data.error || "La liquidación no fue confirmada.");
      localStorage.removeItem(scope);
      await onSuccess();
      });
    } catch (e) { setError(`${e instanceof Error ? e.message : "No se pudo confirmar la liquidación."}${sentPayload.current ? " El reintento conserva la misma operación para evitar duplicados; no se cambiarán sus datos." : ""}`); }
    finally { inFlight.current = false; setSaving(false); }
  }

  // 26/10/2026 (auditoría UX, arreglo 3): con algo cargado, Escape, el clic afuera y la X preguntan antes de cerrar (como Presupuestos).
  // «Cerrar» cierra directo. Una operación ya enviada se recupera sola al volver a abrir: no pregunta.
  const hayCargado = !submitted && (Object.values(allocations).some(v => v.trim() !== "") || medios.some(m => m.monto.trim() !== "" || m.referencia.trim() !== "") || retenciones.length > 0);
  return <Modal open onClose={() => { if (!saving) onClose(); }} confirmarCierre={!saving && hayCargado ? "¿Estás seguro que deseas salir sin guardar? Se pierde lo que cargaste en esta liquidación." : undefined} size="xl" title={`${kind === "cobro" ? "Cobrar" : "Pagar"} facturas USD en pesos`} description="La cotización de esta liquidación no modifica la factura original." footer={<><button type="button" className={button} disabled={saving} onClick={onClose}>Cerrar</button><button type="button" className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={saving || loadingQuote} onClick={guardar}>{saving ? "Registrando…" : submitted ? "Reintentar la misma operación" : "Confirmar liquidación"}</button></>}>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-300 p-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
    {submitted && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">Operación enviada: los datos quedan bloqueados hasta confirmar su resultado. Reintentar no genera una liquidación nueva.</p>}
    <fieldset disabled={saving || submitted} className="space-y-5 dark:text-zinc-200">
      <ZonaArchivos onArchivos={(files) => void leerOrdenPago(files)} disabled={leyendoOp || saving || submitted} className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">¿Tenés la OP, la transferencia o la retención? Arrastrala acá o pegala con Ctrl+V: la IA la lee y completa todo.</p>
          <button type="button" className={`${button} inline-flex items-center gap-2 border-orange-400 text-orange-700 dark:text-orange-400`} disabled={leyendoOp} onClick={() => opFileRef.current?.click()}><Sparkles className="h-4 w-4" />{leyendoOp ? "Leyendo comprobante…" : "Adjuntar comprobante y leer con IA"}</button>
          <input ref={opFileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple className="hidden" onChange={e => void leerOrdenPago(Array.from(e.target.files || []))} />
        </div>
        {opMensaje && <ul className={`mt-2 list-disc space-y-1 pl-5 text-xs ${!opMensaje.ok ? "text-red-700 dark:text-red-400" : opMensaje.aviso ? "font-medium text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400"}`}>{opMensaje.lineas.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        {opConOtras && onCobrarOrdenCompleta && <button type="button" className="mt-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white" onClick={() => onCobrarOrdenCompleta(opConOtras)}>Cobrar todas las facturas de esta orden de pago</button>}
      </ZonaArchivos>
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Fecha de la operación<input className={input} type="date" value={fecha} onChange={e => { const v = e.target.value; setFecha(v); setMedios(p => p.map(m => ({ ...m, fecha: v }))); changeQuote(); setCotizacionFecha(diaHabilAnterior(v)); }} /></label><label className="text-sm">Fecha de cotización<input className={input} type="date" value={cotizacionFecha} onChange={e => { changeQuote(); setCotizacionFecha(e.target.value); }} /></label><label className="text-sm">Cotización ARS por USD<input className={input} type="text" inputMode="decimal" placeholder="Ej: 1.530,50" value={cotizacion} readOnly={modalidad !== "manual"} onChange={e => { tcElegido.current = true; setCotizacion(e.target.value); }} /></label></div>
      <div className="flex flex-wrap items-center gap-2">{(["divisas", "billetes", "manual"] as const).map(m => <button type="button" key={m} className={`${button} ${modalidad === m ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950" : ""}`} onClick={() => { tcElegido.current = true; changeQuote(); setModalidad(m); }}>{m === "divisas" ? "Divisas" : m === "billetes" ? "Billetes" : "Manual"}</button>)}<button type="button" className={button} disabled={modalidad === "manual" || loadingQuote} onClick={consultarBna}>{loadingQuote ? "Consultando…" : "Consultar BNA para esa fecha"}</button>{singleDocumentRate && <button type="button" className={`${button} ${modalidad === "manual" && Math.abs(rate - singleDocumentRate) < 0.000001 ? "border-green-600 text-green-700 dark:text-green-400" : ""}`} onClick={() => { tcElegido.current = true; applyRate(singleDocumentRate); }}>Usar TC de la factura ({formatCurrency(singleDocumentRate, "ARS")})</button>}</div>
      <div className="space-y-3"><h3 className="font-medium">USD a cancelar por factura</h3>{documents.map(d => {
        const allocated = parseNum(allocations[d.id] || "0");
        const exceedsBalance = Number.isFinite(allocated) && cents(allocated) > cents(d.saldo);
        const pending = Number.isFinite(allocated) ? Math.max(0, (cents(d.saldo) - cents(allocated)) / 100) : d.saldo;
        return <div key={d.id} className="grid items-center gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700 sm:grid-cols-3"><div className="text-sm"><p className="font-medium">{d.numero}</p><p>Saldo: {formatCurrency(d.saldo, "USD")}</p>{d.cotizacion && d.cotizacion > 0 ? <p className="text-xs text-zinc-500">TC de la factura: {formatCurrency(d.cotizacion, "ARS")}</p> : null}</div><div className="text-sm"><div className="flex items-center gap-2"><label htmlFor={`usd-${d.id}`}>USD a cancelar</label><button type="button" title="Completar con el saldo total de la factura" aria-label="Completar con el saldo total de la factura" className="rounded-md p-1 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950" onClick={() => setAllocations(p => ({ ...p, [d.id]: toDecimalInput(d.saldo) }))}><Sparkles className="h-4 w-4" /></button></div><input id={`usd-${d.id}`} className={input} type="text" inputMode="decimal" value={allocations[d.id] || ""} onChange={e => setAllocations(p => ({ ...p, [d.id]: e.target.value }))} /></div><p className={`text-sm ${exceedsBalance ? "text-red-600 dark:text-red-400" : ""}`}>{exceedsBalance ? `Supera el saldo por ${formatCurrency((cents(allocated) - cents(d.saldo)) / 100, "USD")}` : `Pendiente: ${formatCurrency(pending, "USD")}`}</p></div>;
      })}</div>
      <div className="space-y-3"><h3 className="font-medium">Medios de {kind === "cobro" ? "cobro" : "pago"} en ARS</h3><p className="text-xs text-zinc-500">Una fecha por liquidación. Para fechas diferentes, registrá operaciones separadas. {kind === "cobro" ? "Cheques y eCheqs: poné banco, número y fecha de pago en Referencia." : "Cheques y eCheqs no se registran desde este formulario."}</p>{kind === "cobro" && medios.some(m => m.tipo === "cheque_recibido") && <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Aviso: el cheque/eCheq se imputa a la factura en pesos, pero no queda en la cartera de Cheques. Cargalo en Finanzas &gt; Cheques (como recibido de este cliente) para poder depositarlo o endosarlo; eso no genera otro cobro.</p>}{medios.map((m, index) => <div key={index} className="grid gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700 sm:grid-cols-5"><label className="text-sm">Medio<select className={input} value={m.tipo} onChange={e => setMedios(p => p.map((v, i) => i === index ? { ...v, tipo: e.target.value } : v))}>{mediosPorKind(kind).map(t => <option key={t} value={t}>{medioLabel[t] || t}</option>)}</select></label><label className="text-sm">ARS<input className={input} type="text" inputMode="decimal" placeholder="Ej: 1.241.525,27" value={m.monto} onChange={e => setMedios(p => p.map((v, i) => i === index ? { ...v, monto: e.target.value } : v))} /></label><label className="text-sm">Fecha<input className={input} type="date" value={m.fecha} readOnly /></label><label className="text-sm">Referencia<input className={input} value={m.referencia} onChange={e => setMedios(p => p.map((v, i) => i === index ? { ...v, referencia: e.target.value } : v))} /></label><button type="button" className={button} onClick={() => setMedios(p => p.filter((_, i) => i !== index))}>Quitar</button></div>)}<button type="button" className={button} onClick={() => setMedios(p => [...p, { tipo: "transferencia", monto: "", fecha, referencia: "" }])}>Agregar medio</button></div>
      <div className="space-y-3"><h3 className="font-medium">Retenciones en ARS</h3><p className="text-xs text-zinc-500">Carga manual según el certificado recibido o emitido. No calcula retenciones automáticamente.</p>{retenciones.map((r, index) => <div key={index} className="grid gap-2 sm:grid-cols-4"><label className="text-sm">Tipo<select className={input} value={r.tipo} onChange={e => setRetenciones(p => p.map((v, i) => i === index ? { ...v, tipo: e.target.value } : v))}>{retentionTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label><label className="text-sm">ARS<input className={input} type="text" inputMode="decimal" value={r.monto} onChange={e => setRetenciones(p => p.map((v, i) => i === index ? { ...v, monto: e.target.value } : v))} /></label><label className="text-sm">Certificado<input className={input} value={r.certificado} onChange={e => setRetenciones(p => p.map((v, i) => i === index ? { ...v, certificado: e.target.value } : v))} /></label><button type="button" className={button} onClick={() => setRetenciones(p => p.filter((_, i) => i !== index))}>Quitar</button></div>)}<button type="button" className={button} onClick={() => setRetenciones(p => [...p, { tipo: "retencion_ganancias", monto: "", certificado: "" }])}>Agregar retención</button></div>
      <div className="rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-800 space-y-1"><p>USD a cancelar: <strong>{formatCurrency(totalUsd, "USD")}</strong></p><p>Equivalente: {formatCurrency(Number.isFinite(expectedArs) ? expectedArs : 0, "ARS")}</p><p>Medios netos: {formatCurrency(paidArs, "ARS")} + retenciones: {formatCurrency(retainedArs, "ARS")}</p><p className={difference !== 0 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}>Diferencia a conciliar: {formatCurrency(Number.isFinite(difference) ? difference : 0, "ARS")}</p>{hasAllOriginalRates && totalUsd > 0 && <p>Diferencia respecto de la cotización original, sobre los USD cancelados: {formatCurrency(expectedArs - initialValue, "ARS")}. Solo informativa; no modifica el comprobante.</p>}
        {impliedRate !== null && <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-700 space-y-1">
          <p>TC implícito del pago: <strong>{formatCurrency(impliedRate, "ARS")}</strong> por USD <span className="text-xs text-zinc-500">(depósitos + retenciones ÷ USD a cancelar)</span></p>
          {rateCandidates.map(c => <p key={c.key} className={matchesImplied(c.valor) ? "text-green-700 dark:text-green-400" : ""}>{c.label}: {formatCurrency(c.valor, "ARS")} {matchesImplied(c.valor) ? "✓ coincide: el cliente pagó con este tipo de cambio" : `· diferencia ${formatCurrency((impliedRate - c.valor) * totalUsd, "ARS")}`}</p>)}
          {!rateCandidates.some(c => matchesImplied(c.valor)) && <p className="text-xs text-zinc-500">{rateCandidates.length ? "No coincide con ninguno de los tipos de cambio de referencia." : "Consultá BNA para comparar con la cotización del día."}</p>}
          {!(modalidad === "manual" && Math.abs(rate - impliedRate) < 0.000001) && <button type="button" className={button} onClick={() => { tcElegido.current = false; applyRate(impliedRate); }}>Usar el TC implícito como cotización</button>}
          {comparacion?.estado === "abajo" && bnaRef && <div role="status" className="mt-2 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <p>⚠️ El cliente pagó a <strong>{formatCurrency(impliedRate, "ARS")}</strong> y el {bnaRef.label} era <strong>{formatCurrency(bnaRef.valor, "ARS")}</strong> ({pct(comparacion.diferenciaPct)}, más de {UMBRAL_TC_COBRO * 100} % abajo). Te faltan <strong>{formatCurrency(comparacion.faltante, "ARS")}</strong>: pedile la actualización al cliente.</p>
            <p className="text-xs">Es solo un aviso: podés confirmar igual.</p>
            <button type="button" className={`${button} border-amber-400 bg-white dark:bg-zinc-900`} onClick={() => { void navigator.clipboard?.writeText(mensajeCliente).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); }).catch(() => {}); }}>{copiado ? "Mensaje copiado ✓" : "Copiar mensaje para el cliente"}</button>
          </div>}
          {comparacion?.estado === "arriba" && bnaRef && <p className="mt-2 rounded-lg border border-green-300 bg-green-50 p-2 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300">El cliente pagó arriba del {bnaRef.label} ({pct(comparacion.diferenciaPct)}): {formatCurrency(-comparacion.faltante, "ARS")} a favor.</p>}
          {comparacion?.estado === "en_rango" && bnaRef && <p className="mt-2 text-xs text-zinc-500">Contra el {bnaRef.label}: {pct(comparacion.diferenciaPct)}, dentro del {UMBRAL_TC_COBRO * 100} %.</p>}
        </div>}
      </div>
    </fieldset>
  </Modal>;
}

export default FxSettlementDialog;
