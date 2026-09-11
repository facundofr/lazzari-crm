"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { X, Loader2, Sparkles, Check, Search, Plus, Trash2, Maximize2, Minimize2, AlertTriangle } from "lucide-react";
import { formatCurrency, todayAR } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────
export interface OCParaVincular {
  id: string;
  numero: string;
  proveedor_id: string;
  proveedor_nombre: string;
  total: number;
  moneda: string;
  estado: string;
  fecha: string;
}

interface ProveedorOption {
  id: string;
  razon_social: string;
  cuit: string | null;
}

interface FCItem {
  tempId: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_porcentaje: number;
  iva_porcentaje: number;
  unidad: string;
}

const emptyNuevoProveedor = {
  razon_social: "",
  cuit: "",
  condicion_iva: "RI",
  rubro: "",
  email: "",
  telefono: "",
  direccion: "",
  localidad: "",
  provincia: "",
  forma_pago: "Transferencia",
  dias_cuenta_corriente: 30,
  limite_credito: 0,
  cbu: "",
  alias_bancario: "",
  numero_cuenta: "",
  notas: "",
};

interface Props {
  sociedadId: string;
  profileId: string | null;
  ordenes: OCParaVincular[];
  preselectedOCId?: string;
  showTipoToggle?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const itemNeto = (item: FCItem) => (
  Number(item.cantidad) * Number(item.precio_unitario) * (1 - Number(item.descuento_porcentaje || 0) / 100)
);
// ── Component ────────────────────────────────────────────
export default function CargarFacturaOC({
  sociedadId, profileId, ordenes, preselectedOCId, showTipoToggle, onClose, onSuccess,
}: Props) {
  const initialOC = preselectedOCId ? ordenes.find((oc) => oc.id === preselectedOCId) : undefined;
  // ── Form state ──
  const [proveedorId, setProveedorId] = useState(initialOC?.proveedor_id || "");
  const [proveedorSearch, setProveedorSearch] = useState(initialOC?.proveedor_nombre || "");
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [proveedoresLoaded, setProveedoresLoaded] = useState(false);
  const [nuevoProveedorOpen, setNuevoProveedorOpen] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState(emptyNuevoProveedor);
  const [nuevoProveedorSaving, setNuevoProveedorSaving] = useState(false);
  const [nuevoProveedorError, setNuevoProveedorError] = useState("");
  const [tipoComprobante, setTipoComprobante] = useState("FC A");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fecha, setFecha] = useState(todayAR());
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [cae, setCae] = useState("");
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [subtotal, setSubtotal] = useState(0);
  const [ivaPorcentaje, setIvaPorcentaje] = useState(21);
  const [percepciones, setPercepciones] = useState(0);
  const [notas, setNotas] = useState("");
  const [items, setItems] = useState<FCItem[]>([]);
  const [tipoFC, setTipoFC] = useState<"mercaderia" | "solo_iva" | "transporte">("mercaderia");
  const [costoReal, setCostoReal] = useState(0);

  // ── OC selection ──
  const [selectedOCIds, setSelectedOCIds] = useState<Set<string>>(new Set(preselectedOCId ? [preselectedOCId] : []));
  const [ocSearch, setOcSearch] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [pagadaSinOP, setPagadaSinOP] = useState(false);
  const [cuitLoading, setCuitLoading] = useState(false);

  // ── File & parsing ──
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [parseError, setParseError] = useState("");

  // ── Save ──
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [linkedInvoices, setLinkedInvoices] = useState<{ total: number; moneda: string }[]>([]);
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [alignmentError, setAlignmentError] = useState("");
  const [overrideOC, setOverrideOC] = useState(false);
  // La IA devuelve el subtotal impreso. Se conserva una pasada para que el
  // efecto que recalcula desde renglones no lo pise inmediatamente (especialmente FC B).
  const parsedSubtotalRef = useRef<number | null>(null);

  // ── Computed ──
  const iva = useMemo(() => {
    if (items.length === 0) return Math.round(subtotal * ivaPorcentaje) / 100;
    return Math.round(items.reduce((sum, item) => (
      sum + itemNeto(item) * Number(item.iva_porcentaje || 0) / 100
    ), 0) * 100) / 100;
  }, [items, subtotal, ivaPorcentaje]);
  const total = useMemo(() => Math.round((subtotal + iva + percepciones) * 100) / 100, [subtotal, iva, percepciones]);
  const totalSinPercepciones = useMemo(() => Math.round((subtotal + iva) * 100) / 100, [subtotal, iva]);

  // Filter OCs by selected proveedor (unless showAllOCs is enabled)
  const [showAllOCs, setShowAllOCs] = useState(false);
  const ocsFiltered = useMemo(() => {
    const q = ocSearch.trim().toLowerCase();
    return ordenes.filter((oc) => {
      if (!showAllOCs && proveedorId && oc.proveedor_id !== proveedorId) return false;
      if (q && !`${oc.numero} ${oc.proveedor_nombre} ${oc.estado}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ordenes, proveedorId, ocSearch, showAllOCs]);

  const filteredProveedores = useMemo(() => {
    if (!proveedorSearch.trim()) return proveedores.slice(0, 20);
    const q = proveedorSearch.toLowerCase();
    return proveedores.filter(p =>
      p.razon_social.toLowerCase().includes(q) || (p.cuit || "").includes(q)
    ).slice(0, 20);
  }, [proveedores, proveedorSearch]);

  const selectedProvNombre = proveedores.find(p => p.id === proveedorId)?.razon_social || "";
  const selectedOCKey = useMemo(() => Array.from(selectedOCIds).sort().join("|"), [selectedOCIds]);
  const selectedOCs = useMemo(() => ordenes.filter((oc) => selectedOCIds.has(oc.id)), [ordenes, selectedOCIds]);
  const ocCurrencies = useMemo(() => new Set(selectedOCs.map((oc) => oc.moneda)), [selectedOCs]);
  const ocTotal = useMemo(() => roundMoney(selectedOCs.reduce((sum, oc) => sum + Number(oc.total || 0), 0)), [selectedOCs]);
  const alreadyInvoiced = useMemo(() => roundMoney(linkedInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0)), [linkedInvoices]);
  const remainingOC = roundMoney(ocTotal - alreadyInvoiced);
  const alignmentDifference = roundMoney(remainingOC - totalSinPercepciones);
  const currencyMismatch = (ocCurrencies.size > 0 && !ocCurrencies.has(moneda)) || linkedInvoices.some((invoice) => invoice.moneda !== moneda);
  const exceedsOC = alignmentDifference < -0.01;
  // Un excedente genera una OC abierta al guardar; solo una diferencia de
  // moneda requiere confirmación explícita para tocar la OC vinculada.
  const needsOverride = currencyMismatch;
  const alignmentBlocked = selectedOCs.length > 0 && (
    Boolean(alignmentError)
    || (needsOverride && !overrideOC)
  );

  async function fetchLinkedInvoicesForOCs(ids: string[]) {
    const [{ data: junctionLinks, error: junctionError }, { data: legacyInvoices, error: legacyError }] = await Promise.all([
      (supabase as any)
        .from("factura_compra_ocs")
        .select("factura_compra_id, facturas_compra(id, estado, total, percepciones, moneda)")
        .in("orden_compra_id", ids),
      (supabase as any)
        .from("facturas_compra")
        .select("id, estado, total, percepciones, moneda")
        .in("orden_compra_id", ids),
    ]);
    if (junctionError || legacyError) {
      throw new Error("No se pudo verificar lo ya facturado para estas OC.");
    }

    const byId = new Map<string, { total: number; moneda: string }>();
    for (const link of junctionLinks || []) {
      const raw = Array.isArray(link.facturas_compra) ? link.facturas_compra[0] : link.facturas_compra;
      if (!raw || raw.estado === "anulada" || byId.has(raw.id)) continue;
      byId.set(raw.id, { total: Number(raw.total || 0) - Number(raw.percepciones || 0), moneda: raw.moneda || "ARS" });
    }
    for (const raw of legacyInvoices || []) {
      if (!raw || raw.estado === "anulada" || byId.has(raw.id)) continue;
      byId.set(raw.id, { total: Number(raw.total || 0) - Number(raw.percepciones || 0), moneda: raw.moneda || "ARS" });
    }
    return Array.from(byId.values());
  }

  useEffect(() => {
    if (items.length > 0) {
      if (parsedSubtotalRef.current != null) {
        setSubtotal(parsedSubtotalRef.current);
        parsedSubtotalRef.current = null;
        return;
      }
      setSubtotal(roundMoney(items.reduce((sum, item) => sum + itemNeto(item), 0)));
    }
  }, [items]);

  useEffect(() => {
    if (!selectedOCKey) {
      setLinkedInvoices([]);
      setAlignmentError("");
      return;
    }

    let cancelled = false;
    setAlignmentLoading(true);
    setAlignmentError("");
    (async () => {
      const ids = selectedOCKey.split("|");
      try {
        const invoices = await fetchLinkedInvoicesForOCs(ids);
        if (!cancelled) setLinkedInvoices(invoices);
      } catch (loadError) {
        if (!cancelled) {
          setAlignmentError(loadError instanceof Error ? loadError.message : "No se pudo verificar las OC.");
          setLinkedInvoices([]);
        }
      }
      if (cancelled) return;
      setAlignmentLoading(false);
    })();

    return () => { cancelled = true; };
  }, [selectedOCKey]);

  useEffect(() => {
    void loadProveedores();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sociedadId]);

  async function lookupNuevoProveedor() {
    const cuit = nuevoProveedor.cuit.replace(/\D/g, "");
    if (cuit.length !== 11) { setNuevoProveedorError("El CUIT debe tener 11 dígitos"); return; }
    setCuitLoading(true);
    setNuevoProveedorError("");
    try {
      const res = await fetch(`/api/cuit-lookup?cuit=${cuit}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo consultar AFIP");
      setNuevoProveedor((prev) => ({
        ...prev,
        cuit,
        razon_social: data.razon_social || prev.razon_social,
        condicion_iva: data.condicion_iva || prev.condicion_iva,
        direccion: data.direccion || prev.direccion,
        localidad: data.localidad || prev.localidad,
        provincia: data.provincia || prev.provincia,
      }));
    } catch (err) {
      setNuevoProveedorError(err instanceof Error ? err.message : "No se pudo consultar AFIP");
    } finally {
      setCuitLoading(false);
    }
  }

  // ── Load proveedores ──
  async function loadProveedores() {
    if (proveedoresLoaded) return;
    try {
      let q = supabase.from("proveedores").select("id, razon_social, cuit").eq("activo", true).order("razon_social");
      if (sociedadId) q = q.eq("sociedad_id" as any, sociedadId);
      const { data } = await q;
      if (data) setProveedores(data as ProveedorOption[]);
    } catch { /* noop */ }
    setProveedoresLoaded(true);
  }

  function openNuevoProveedor() {
    setNuevoProveedor({ ...emptyNuevoProveedor, razon_social: proveedorSearch.trim() });
    setNuevoProveedorError("");
    setNuevoProveedorOpen(true);
  }

  async function handleCrearProveedor() {
    if (!nuevoProveedor.razon_social.trim() || !nuevoProveedor.cuit.trim()) {
      setNuevoProveedorError("Razón social y CUIT son obligatorios");
      return;
    }
    setNuevoProveedorSaving(true);
    setNuevoProveedorError("");
    try {
      const { data, error: insertError } = await (supabase as any)
        .from("proveedores")
        .insert({
          ...nuevoProveedor,
          razon_social: nuevoProveedor.razon_social.trim(),
          cuit: nuevoProveedor.cuit.trim(),
          sociedad_id: sociedadId,
          created_by: profileId,
        })
        .select("id, razon_social, cuit")
        .single();
      if (insertError || !data) throw new Error(insertError?.message || "No se pudo crear el proveedor");

      const created = data as ProveedorOption;
      setProveedores(prev => [...prev.filter(p => p.id !== created.id), created].sort((a, b) => a.razon_social.localeCompare(b.razon_social)));
      setProveedorId(created.id);
      setProveedorSearch(created.razon_social);
      setSelectedOCIds(new Set());
      setNuevoProveedorOpen(false);
    } catch (err: any) {
      setNuevoProveedorError(err?.message || "Error al crear el proveedor");
    } finally {
      setNuevoProveedorSaving(false);
    }
  }

  // ── Parse PDF ──
  async function handleParseFile(f: File) {
    setFile(f);
    setParsing(true);
    setParseError("");
    setParsed(false);

    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setParseError(json.error || "Error al procesar el archivo");
        return;
      }

      const d = json.data;

      // Detect nota de pedido → auto-set tipo manual + IVA 0%
      const rawTipo = (d.tipo_comprobante || "").toUpperCase().trim();
      const isNotaPedido = /NOTA\s*DE\s*PEDIDO|^NP$|^N\.?\s?P\.?$/.test(rawTipo) || (!d.cae && /PEDIDO|PRESUPUESTO|COTIZACI[OÓ]N|PROFORMA/.test(rawTipo));

      // Auto-fill form
      if (isNotaPedido) {
        setTipoComprobante("FC Manual");
      } else if (d.tipo_comprobante) {
        const tc = rawTipo;
        if (tc === "A" || tc === "FACTURA A") setTipoComprobante("FC A");
        else if (tc === "B" || tc === "FACTURA B") setTipoComprobante("FC B");
        else if (tc === "C" || tc === "FACTURA C") setTipoComprobante("FC C");
        else if (["FC A", "FC B", "FC C", "FC Manual", "ND A", "ND B", "NC A", "NC B", "Recibo"].includes(d.tipo_comprobante)) setTipoComprobante(d.tipo_comprobante);
      }
      if (d.numero_factura) setNumeroFactura(d.numero_factura);
      if (d.fecha) setFecha(d.fecha);
      if (d.fecha_vencimiento) setFechaVencimiento(d.fecha_vencimiento);
      if (d.cae) setCae(d.cae);
      if (d.moneda) setMoneda(d.moneda === "USD" ? "USD" : "ARS");
      if (d.subtotal != null) {
        parsedSubtotalRef.current = Number(d.subtotal) || 0;
        setSubtotal(parsedSubtotalRef.current);
      }
      setIvaPorcentaje(isNotaPedido ? 0 : (d.iva_porcentaje != null ? (Number(d.iva_porcentaje) || 0) : 21));
      if (d.percepciones && !isNotaPedido) setPercepciones(Number(d.percepciones) || 0);
      if (d.notas) setNotas(d.notas);

      // Auto-fill items
      if (d.items && Array.isArray(d.items) && d.items.length > 0) {
        setItems(d.items.map((it: any, idx: number) => ({
          tempId: `ai-${Date.now()}-${idx}`,
          descripcion: it.descripcion || "",
          cantidad: Number(it.cantidad) || 1,
          precio_unitario: Number(it.precio_unitario) || 0,
          descuento_porcentaje: Math.max(0, Math.min(100, Number(it.descuento_porcentaje ?? d.descuento_general_porcentaje) || 0)),
          iva_porcentaje: isNotaPedido ? 0 : (it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21),
          unidad: it.unidad || "UN",
        })));
      }

      // Match proveedor by CUIT
      if (d.proveedor?.cuit) {
        await loadProveedores();
        const cuitClean = String(d.proveedor.cuit).replace(/\D/g, "");
        // Need to wait for proveedores to be set — use direct query
        let q = supabase.from("proveedores").select("id, razon_social, cuit").eq("activo", true);
        if (sociedadId) q = q.eq("sociedad_id" as any, sociedadId);
        const { data: provs } = await q;
        if (provs) {
          setProveedores(provs as ProveedorOption[]);
          setProveedoresLoaded(true);
          const match = provs.find((p: any) => p.cuit?.replace(/\D/g, "") === cuitClean);
          if (match) {
            setProveedorId(match.id);
            setProveedorSearch(match.razon_social);
          } else if (d.proveedor.razon_social) {
            setProveedorSearch(d.proveedor.razon_social);
          }
        }
      }

      setParsed(true);
    } catch (err: any) {
      setParseError(err.message || "Error al procesar");
    } finally {
      setParsing(false);
    }
  }

  // ── Toggle OC ──
  function toggleOC(ocId: string) {
    setSelectedOCIds(prev => {
      const next = new Set(prev);
      if (next.has(ocId)) next.delete(ocId);
      else next.add(ocId);
      return next;
    });
  }

  async function validateOCAlignmentLive() {
    const ids = Array.from(selectedOCIds);
    const { data: freshOCs, error: ocError } = await (supabase as any)
      .from("ordenes_compra")
      .select("id, numero, total, moneda")
      .in("id", ids);
    if (ocError || !freshOCs || freshOCs.length !== ids.length) {
      throw new Error("No se pudieron verificar los importes actuales de las OC. No se guardó nada.");
    }

    const currencies = new Set(freshOCs.map((oc: any) => oc.moneda));
    if (!overrideOC && (currencies.size !== 1 || !currencies.has(moneda))) {
      throw new Error(`La factura está en ${moneda} y las OC seleccionadas están en otra moneda.`);
    }

    const previousInvoices = await fetchLinkedInvoicesForOCs(ids);
    if (!overrideOC && previousInvoices.some((invoice) => invoice.moneda !== moneda)) {
      throw new Error("Hay facturas anteriores vinculadas en otra moneda. Revisá la OC antes de continuar.");
    }

    const freshOCTotal = roundMoney(freshOCs.reduce((sum: number, oc: any) => sum + Number(oc.total || 0), 0));
    const previousTotal = roundMoney(previousInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0));
    const remaining = roundMoney(freshOCTotal - previousTotal);
    // Un excedente se registra en una OC abierta separada al guardar. No se
    // modifica la OC original ni se permite que el importe desaparezca.
    return { remaining, partial: remaining - totalSinPercepciones > 0.01, freshOCs };
  }

  // ── Save ──
  async function handleSave() {
    if (!proveedorId) { setError("Seleccioná un proveedor"); return; }
    if (!numeroFactura.trim()) { setError("Ingresá el número de factura"); return; }
    if (subtotal <= 0) { setError("El subtotal debe ser mayor a 0"); return; }
    if (tipoFC === "mercaderia" && selectedOCIds.size === 0 && ocsFiltered.length > 0) { setError("Seleccioná al menos una orden de compra"); return; }
    const isMercaderia = tipoFC === "mercaderia";

    setSaving(true);
    setError("");

    try {
      let alignmentResult: { remaining: number; partial: boolean; freshOCs: any[] } | null = null;
      if (isMercaderia && selectedOCIds.size > 0) {
        alignmentResult = await validateOCAlignmentLive();
      }

      // Insert FC
      const insertData: Record<string, unknown> = {
        numero_factura: numeroFactura.trim(),
        tipo_comprobante: tipoComprobante,
        proveedor_id: proveedorId,
        fecha,
        fecha_vencimiento: fechaVencimiento || null,
        subtotal,
        iva_porcentaje: ivaPorcentaje,
        iva,
        percepciones,
        total,
        moneda,
        estado: pagadaSinOP ? "pagada" : "pendiente_aprobacion",
        tipo: tipoFC,
        solo_iva: tipoFC !== "mercaderia",
        notas: notas || null,
        cae: cae || null,
        sociedad_id: sociedadId,
        created_by: profileId,
      };

      const { data: fcData, error: fcErr } = await (supabase as any)
        .from("facturas_compra")
        .insert(insertData)
        .select("id")
        .single();

      if (fcErr) throw new Error(fcErr.message);

      // Insert items
      if (items.length > 0 && fcData?.id) {
        const itemsInsert = items.map(it => ({
          factura_compra_id: fcData.id,
          producto_id: null,
          codigo: null,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          precio_unitario: it.precio_unitario,
          descuento_porcentaje: it.descuento_porcentaje,
          unidad: it.unidad,
          iva_porcentaje: it.iva_porcentaje,
          sociedad_id: sociedadId,
        }));
        const { error: itemsError } = await (supabase as any).from("facturas_compra_items").insert(itemsInsert);
        if (itemsError) throw new Error(`Error al guardar los items: ${itemsError.message}`);
      }

      // Insert OC links (junction table)
      if (isMercaderia && selectedOCIds.size > 0 && fcData?.id) {
        const links = Array.from(selectedOCIds).map(ocId => ({
          factura_compra_id: fcData.id,
          orden_compra_id: ocId,
        }));
        const { error: linkErr } = await (supabase as any)
          .from("factura_compra_ocs")
          .insert(links);
        if (linkErr) throw new Error(linkErr.message);
      }

      // Si el comprobante supera el saldo de la OC, la diferencia no se
      // fuerza sobre la OC original ni sobre el presupuesto: queda como una
      // OC abierta independiente para que Compras la revise y la asocie si
      // corresponde. Esto evita perder el excedente o duplicar costos.
      if (isMercaderia && alignmentResult && alignmentResult.remaining < totalSinPercepciones - 0.01) {
        const excedente = roundMoney(totalSinPercepciones - alignmentResult.remaining);
        const { data: extraOc, error: extraOcError } = await (supabase as any)
          .from("ordenes_compra")
          .insert({
            proveedor_id: proveedorId,
            fecha: todayAR(),
            moneda,
            estado: "pendiente",
            subtotal: excedente,
            iva: 0,
            total: excedente,
            observaciones: `OC abierta generada por excedente de FC ${numeroFactura.trim()}. Revisar y asociar manualmente si corresponde.`,
            sociedad_id: sociedadId,
            presupuesto_origen_id: null,
            created_by: profileId,
          })
          .select("id")
          .single();
        if (extraOcError || !extraOc) throw new Error(extraOcError?.message || "No se pudo generar la OC abierta por excedente");
        const { error: extraItemError } = await (supabase as any)
          .from("orden_compra_items")
          .insert({
            orden_id: extraOc.id,
            codigo: "",
            descripcion: `Excedente FC ${numeroFactura.trim()} (revisión pendiente)`,
            cantidad: 1,
            cantidad_recibida: 0,
            unidad: "UN",
            precio_unitario: excedente,
            iva_porcentaje: 0,
            orden: 1,
          });
        if (extraItemError) throw new Error(extraItemError.message);
      }

      // Override OC from FC: REPLACE OC items with FC items, update totals/moneda, cascade to PR
      if (isMercaderia && overrideOC && selectedOCIds.size > 0 && items.length > 0) {
        for (const ocId of Array.from(selectedOCIds)) {
          // Save old OC items for PR cascade matching by position
          const { data: oldOCItems } = await supabase
            .from("orden_compra_items")
            .select("id, descripcion, precio_unitario")
            .eq("orden_id", ocId)
            .order("orden");

          // Delete ALL old OC items
          await supabase.from("orden_compra_items").delete().eq("orden_id", ocId);

          // Insert ALL FC items as new OC items
          const newOCItems = items.map((fcItem, idx) => ({
            orden_id: ocId,
            codigo: "",
            descripcion: fcItem.descripcion,
            cantidad: fcItem.cantidad,
            precio_unitario: fcItem.precio_unitario,
            unidad: fcItem.unidad,
            iva_porcentaje: fcItem.iva_porcentaje,
            orden: idx + 1,
            cantidad_recibida: 0,
          }));
          await supabase.from("orden_compra_items").insert(newOCItems as any);

          // Update OC header totals + moneda
          await (supabase as any)
            .from("ordenes_compra")
            .update({ subtotal, iva, total: subtotal + iva, moneda })
            .eq("id", ocId);

          // Cascade to presupuesto: update precio_costo by position
          const { data: ocRow } = await supabase
            .from("ordenes_compra")
            .select("presupuesto_origen_id")
            .eq("id", ocId)
            .single();

          if (ocRow?.presupuesto_origen_id) {
            const prId = ocRow.presupuesto_origen_id;
            const { data: prItems } = await supabase
              .from("presupuesto_items")
              .select("id, descripcion, precio_costo, orden")
              .eq("presupuesto_id", prId)
              .order("orden");

            if (prItems && oldOCItems) {
              // Match old OC items to PR items by description, then update PR with FC price + moneda
              const oldItems = oldOCItems || [];
              for (let i = 0; i < oldItems.length && i < items.length; i++) {
                const oldDesc = (oldItems[i].descripcion || "").toLowerCase().trim();
                const prItem = prItems.find((pr: any) => (pr.descripcion || "").toLowerCase().trim() === oldDesc);
                if (prItem) {
                  await supabase
                    .from("presupuesto_items")
                    .update({ precio_costo: items[i].precio_unitario, costo_moneda: moneda } as any)
                    .eq("id", prItem.id);
                }
              }
            }
          }
        }
      }

      // Si la factura trae costos distintos, actualizar el costo de la OC y del
      // PR asociado sin tocar el precio de venta. Se conserva cantidad/recepción
      // de la OC; el detalle del cambio queda visible en observaciones.
      if (isMercaderia && !overrideOC && selectedOCIds.size > 0 && items.length > 0) {
        const stamp = new Date().toLocaleString("es-AR");
        for (const ocId of Array.from(selectedOCIds)) {
          const { data: ocRow, error: ocLoadError } = await (supabase as any)
            .from("ordenes_compra")
            .select("id, subtotal, iva, total, moneda, observaciones, presupuesto_origen_id")
            .eq("id", ocId).single();
          if (ocLoadError || !ocRow) throw new Error(ocLoadError?.message || "No se pudo leer la OC vinculada");
          const { data: ocItems, error: itemsLoadError } = await (supabase as any)
            .from("orden_compra_items")
            .select("id, descripcion, precio_unitario, cantidad")
            .eq("orden_id", ocId).order("orden");
          if (itemsLoadError) throw new Error(itemsLoadError.message);
          const changed: string[] = [];
          for (let i = 0; i < Math.min((ocItems || []).length, items.length); i++) {
            const oldItem = ocItems[i];
            const newCost = roundMoney(Number(items[i].precio_unitario || 0));
            if (Math.abs(Number(oldItem.precio_unitario || 0) - newCost) < 0.005) continue;
            const { error: itemUpdateError } = await (supabase as any)
              .from("orden_compra_items").update({ precio_unitario: newCost }).eq("id", oldItem.id);
            if (itemUpdateError) throw new Error(itemUpdateError.message);
            changed.push(`${oldItem.descripcion || `item ${i + 1}`}: ${oldItem.precio_unitario} → ${newCost} ${moneda}`);
          }
          // Para una sola OC, sus totales deben reflejar el comprobante. En
          // facturas divididas se dejan los totales originales y se actualiza el
          // costo de cada línea, evitando asignar todo el total a cada OC.
          if (selectedOCIds.size === 1) {
            const { error: headerUpdateError } = await (supabase as any)
              .from("ordenes_compra").update({ subtotal, iva, total, moneda }).eq("id", ocId);
            if (headerUpdateError) throw new Error(headerUpdateError.message);
          }
          if (changed.length > 0) {
            const history = `\n[${stamp}] Costo actualizado desde FC ${numeroFactura.trim()}: ${changed.join("; ")}`;
            const { error: ocHistoryError } = await (supabase as any)
              .from("ordenes_compra").update({ observaciones: `${ocRow.observaciones || ""}${history}` }).eq("id", ocId);
            if (ocHistoryError) throw new Error(ocHistoryError.message);

            if (ocRow.presupuesto_origen_id) {
              const { data: prRow } = await (supabase as any).from("presupuestos")
                .select("observaciones").eq("id", ocRow.presupuesto_origen_id).single();
              const { data: prItems } = await (supabase as any).from("presupuesto_items")
                .select("id, descripcion, precio_costo").eq("presupuesto_id", ocRow.presupuesto_origen_id).order("orden");
              for (let i = 0; i < Math.min((ocItems || []).length, items.length); i++) {
                const oldItem = ocItems[i];
                const prItem = (prItems || []).find((pr: any) =>
                  String(pr.descripcion || "").trim().toLowerCase() === String(oldItem.descripcion || "").trim().toLowerCase()
                ) || (prItems || [])[i];
                if (!prItem) continue;
                const { error: prCostError } = await (supabase as any).from("presupuesto_items")
                  .update({ precio_costo: roundMoney(Number(items[i].precio_unitario || 0)), costo_moneda: moneda })
                  .eq("id", prItem.id);
                if (prCostError) throw new Error(prCostError.message);
              }
              await (supabase as any).from("presupuestos").update({
                observaciones: `${prRow?.observaciones || ""}${history}`,
              }).eq("id", ocRow.presupuesto_origen_id);
            }
          }
        }
      }

      // Upload file
      if (file && fcData?.id) {
        const ext = file.name.split(".").pop() || "pdf";
        const filePath = `${sociedadId}/${fcData.id}/factura.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("facturas-compra")
          .upload(filePath, file, { upsert: true });

        if (!upErr) {
          const { data: urlData } = supabase.storage
            .from("facturas-compra")
            .getPublicUrl(filePath);
          if (urlData?.publicUrl) {
            await (supabase as any).from("facturas_compra")
              .update({ archivo_url: urlData.publicUrl, archivo_nombre: file.name })
              .eq("id", fcData.id);
          }
        }
      }

      // Create gasto_manual for solo_iva with costo_real
      if (tipoFC === "solo_iva" && costoReal > 0 && fcData?.id) {
        await (supabase as any).from("gastos_manuales").insert({
          descripcion: `Compra crédito fiscal IVA — FC ${numeroFactura.trim()}`,
          categoria: "Impuestos",
          monto: costoReal,
          moneda,
          fecha,
          proveedor_id: proveedorId,
          sociedad_id: sociedadId,
          created_by: profileId,
          tipo_recurrencia: "eventual",
          tipo_gasto: "Compra IVA",
          medio_pago: "efectivo",
        });
      }

      // If pagadaSinOP, mark linked OCs as completadas
      if (pagadaSinOP && selectedOCIds.size > 0) {
        for (const ocId of Array.from(selectedOCIds)) {
          await (supabase as any).from("ordenes_compra")
            .update({ estado: "completada", pago: "tarjeta" })
            .eq("id", ocId);
        }
      }

      alert(pagadaSinOP ? "Factura cargada como pagada (sin orden de pago)" : "Factura cargada y enviada para aprobación");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4 pt-8 pb-8">
      <div className={`bg-white dark:bg-zinc-900 w-full rounded-xl shadow-2xl ${fullscreen ? "min-h-[calc(100vh-2rem)] max-w-none" : "max-w-5xl"}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Cargar factura o nota de pedido</h2>
            <p className="text-sm text-zinc-500">Cargá el comprobante y vinculalo a las órdenes de compra correspondientes</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setFullscreen((value) => !value)} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" title={fullscreen ? "Reducir" : "Ampliar"}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={20} /></button>
          </div>
        </div>

        <div className={`px-6 py-5 space-y-6 overflow-y-auto ${fullscreen ? "max-h-[calc(100vh-10rem)]" : "max-h-[75vh]"}`}>
          {/* ── 1. Upload ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              1. Cargar factura
            </h3>
            {!parsed && !parsing && (
              <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-xl cursor-pointer hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-900/10 transition-colors">
                <div className="flex items-center gap-2 text-orange-600">
                  <Sparkles size={20} />
                  <span className="font-semibold">Importar con IA desde PDF o imagen</span>
                </div>
                <p className="text-xs text-zinc-400">PDF, PNG, JPG o WEBP — la IA extrae los datos automaticamente</p>
                <input
                  type="file"
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleParseFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {parsing && (
              <div className="flex items-center gap-3 p-6 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
                <span className="text-sm font-medium text-orange-700 dark:text-orange-300">Procesando con IA...</span>
              </div>
            )}
            {parseError && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
                {parseError}
                <button onClick={() => { setParseError(""); setFile(null); }}
                  className="ml-3 underline text-xs">Reintentar</button>
              </div>
            )}
            {parsed && (
              <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-green-700 dark:text-green-400 text-sm">
                <Check size={16} />
                Factura procesada: <span className="font-mono font-bold">{file?.name}</span>
                <button onClick={() => { setParsed(false); setFile(null); setParseError(""); }}
                  className="ml-auto text-xs underline">Cambiar archivo</button>
              </div>
            )}
          </section>

          {/* ── Tipo toggle (solo si showTipoToggle) ── */}
          {showTipoToggle && (
            <div className="flex gap-3">
              <button type="button" onClick={() => setTipoFC("mercaderia")}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 flex-1 transition-colors ${tipoFC === "mercaderia" ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
                <span className={`text-sm font-semibold ${tipoFC === "mercaderia" ? "text-orange-700 dark:text-orange-300" : "text-zinc-600 dark:text-zinc-300"}`}>Compra</span>
              </button>
              <button type="button" onClick={() => setTipoFC("transporte")}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 flex-1 transition-colors ${tipoFC === "transporte" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
                <span className={`text-sm font-semibold ${tipoFC === "transporte" ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-600 dark:text-zinc-300"}`}>Transporte</span>
              </button>
              <button type="button" onClick={() => setTipoFC("solo_iva")}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 flex-1 transition-colors ${tipoFC === "solo_iva" ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
                <span className={`text-sm font-semibold ${tipoFC === "solo_iva" ? "text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-300"}`}>Solo IVA / contable</span>
              </button>
            </div>
          )}

          {/* ── 2. Datos de la factura ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              2. Datos de la factura
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Proveedor */}
              <div className="sm:col-span-2 lg:col-span-3 relative">
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Proveedor</label>
                {proveedorId ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-sm">
                    <Check size={14} className="text-green-600" />
                    <span className="font-medium">{selectedProvNombre}</span>
                    <button onClick={() => { setProveedorId(""); setProveedorSearch(""); setSelectedOCIds(new Set()); }}
                      className="ml-auto text-xs text-zinc-400 hover:text-zinc-600">Cambiar</button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Buscar por razon social o CUIT..."
                        value={proveedorSearch}
                        onFocus={loadProveedores}
                        onChange={e => setProveedorSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
                      />
                    </div>
                    {proveedorSearch && filteredProveedores.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg">
                        {filteredProveedores.map(p => (
                          <button key={p.id} onClick={() => { setProveedorId(p.id); setProveedorSearch(p.razon_social); setSelectedOCIds(new Set()); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">
                            <span className="font-medium">{p.razon_social}</span>
                            {p.cuit && <span className="ml-2 text-xs text-zinc-400">{p.cuit}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={openNuevoProveedor}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-orange-300 px-3 py-2 text-xs font-semibold text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/30"
                    >
                      <Plus size={14} />
                      {proveedorSearch.trim() ? `Crear “${proveedorSearch.trim()}” como proveedor` : "Crear proveedor nuevo"}
                    </button>
                  </>
                )}
              </div>

              {/* Tipo de comprobante */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Tipo</label>
                <select value={tipoComprobante} onChange={e => setTipoComprobante(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                  <option value="FC A">FC A</option>
                  <option value="FC B">FC B</option>
                  <option value="FC C">FC C</option>
                  <option value="FC Manual">FC Manual</option>
                  <option value="ND A">ND A</option>
                  <option value="ND B">ND B</option>
                  <option value="NC A">NC A</option>
                  <option value="NC B">NC B</option>
                  <option value="Recibo">Recibo</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>

              {/* N° Factura */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">N° Factura</label>
                <input type="text" value={numeroFactura} onChange={e => setNumeroFactura(e.target.value)}
                  placeholder="0001-00012345"
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>

              {/* Fecha */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Fecha</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              </div>

              {/* Vencimiento */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Vencimiento</label>
                <input type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              </div>

              {/* CAE */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">CAE</label>
                <input type="text" value={cae} onChange={e => setCae(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>

              {/* Moneda */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Moneda</label>
                <select value={moneda} onChange={e => setMoneda(e.target.value as "ARS" | "USD")}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              {/* Subtotal */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Subtotal (neto)</label>
                <input type="number" step="0.01" min="0" value={subtotal || ""} onChange={e => setSubtotal(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>

              {/* IVA % */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">IVA %</label>
                <select value={ivaPorcentaje} onChange={e => {
                  const value = Number(e.target.value);
                  setIvaPorcentaje(value);
                  setItems((prev) => prev.map((item) => ({ ...item, iva_porcentaje: value })));
                }}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                  <option value={0}>0% (Exento)</option>
                  <option value={10.5}>10.5%</option>
                  <option value={21}>21%</option>
                  <option value={27}>27%</option>
                </select>
              </div>

              {/* Percepciones */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Percepciones</label>
                <input type="number" step="0.01" min="0" value={percepciones || ""} onChange={e => setPercepciones(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>
            </div>

            {/* Totals summary */}
            <div className="mt-3 flex items-center justify-end gap-6 text-sm">
              <span className="text-zinc-500">IVA: <span className="font-mono font-medium">{formatCurrency(iva, moneda)}</span></span>
              <span className="font-bold text-zinc-900 dark:text-zinc-100">Total: <span className="font-mono text-orange-600">{formatCurrency(total, moneda)}</span></span>
            </div>

            {/* Items editables */}
            {items.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between"><p className="text-[10px] uppercase text-zinc-400">Items detectados y editables ({items.length})</p><button type="button" onClick={() => setItems((prev) => [...prev, { tempId: uid(), descripcion: "", cantidad: 1, precio_unitario: 0, descuento_porcentaje: 0, iva_porcentaje: ivaPorcentaje, unidad: "UN" }])} className="inline-flex items-center gap-1 text-xs font-medium text-orange-600"><Plus size={13} /> Agregar item</button></div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full min-w-[780px] text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800 text-zinc-500">
                        <th className="px-1 py-1 text-left">Descripción</th>
                        <th className="px-1 py-1 text-right w-20">Cant.</th>
                        <th className="px-1 py-1 text-right w-28">P. Unit.</th>
                        <th className="px-1 py-1 text-right w-20">Desc. %</th>
                        <th className="px-1 py-1 text-right w-[70px]">IVA</th>
                        <th className="px-2 py-1 text-right w-28">Neto</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, index) => (
                        <tr key={it.tempId} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="px-1 py-1"><input value={it.descripcion} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, descripcion: e.target.value } : item))} className="w-full rounded border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" step="0.01" value={it.cantidad} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, cantidad: Number(e.target.value) || 0 } : item))} className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1.5 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" step="0.01" value={it.precio_unitario} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, precio_unitario: Number(e.target.value) || 0 } : item))} className="w-28 rounded border border-zinc-200 bg-transparent px-2 py-1.5 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" max="100" step="0.01" value={it.descuento_porcentaje || ""} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, descuento_porcentaje: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : item))} placeholder="0" className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1.5 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><select value={it.iva_porcentaje} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, iva_porcentaje: Number(e.target.value) } : item))} className="rounded border border-zinc-200 bg-transparent px-1 py-1.5 dark:border-zinc-700"><option value={0}>0%</option><option value={10.5}>10,5%</option><option value={21}>21%</option><option value={27}>27%</option></select></td>
                          <td className="px-2 py-1 text-right font-mono font-medium">{formatCurrency(itemNeto(it), moneda)}</td>
                          <td><button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))} className="rounded p-1 text-zinc-400 hover:text-red-500"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ── Costo real (solo_iva) ── */}
          {tipoFC === "solo_iva" && (
            <section>
              <label className="block text-[10px] uppercase text-zinc-400 mb-1">Costo real del crédito fiscal (opcional)</label>
              <input type="number" step="0.01" value={costoReal || ""} onChange={e => setCostoReal(Number(e.target.value))}
                placeholder="Monto real pagado por el crédito fiscal"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              <p className="text-xs text-zinc-400 mt-1">Si se ingresa, se crea un gasto manual asociado.</p>
            </section>
          )}

          {/* ── 3. Vincular OCs ── */}
          {tipoFC === "mercaderia" && <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">3. Vincular órdenes de compra</h3>
                {proveedorId && (
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-500">
                    <input type="checkbox" checked={showAllOCs} onChange={(e) => setShowAllOCs(e.target.checked)} className="accent-orange-600 h-3 w-3" />
                    Ver todas
                  </label>
                )}
              </div>
              <div className="relative w-72 max-w-full"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" /><input value={ocSearch} onChange={(e) => setOcSearch(e.target.value)} placeholder="Buscar OC, proveedor o estado..." className="w-full rounded-lg border border-zinc-200 bg-transparent py-1.5 pl-8 pr-2 text-xs dark:border-zinc-700" /></div>
            </div>
            {ocsFiltered.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-zinc-400 italic">
                  {proveedorId
                    ? "No hay ordenes de compra activas para este proveedor"
                    : "Seleccioná un proveedor para filtrar las OCs"}
                </p>
                {proveedorId && !showAllOCs && ordenes.length > 0 && (
                  <button type="button" onClick={() => setShowAllOCs(true)}
                    className="text-xs font-medium text-orange-600 hover:text-orange-700 underline">
                    Ver todas las OCs ({ordenes.length})
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {ocsFiltered.map(oc => {
                  const sel = selectedOCIds.has(oc.id);
                  return (
                    <label key={oc.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        sel ? "bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700" : "bg-zinc-50 dark:bg-zinc-800/50 border border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-700/50"
                      }`}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOC(oc.id)}
                        className="accent-orange-600 h-4 w-4" />
                      <div className="flex-1 min-w-0">
                        <span className="font-mono font-medium text-sm">{oc.numero}</span>
                        <span className="ml-2 text-xs text-zinc-500">{oc.proveedor_nombre}</span>
                      </div>
                      <span className="text-xs text-zinc-500">{oc.estado}</span>
                      <span className="font-mono text-sm font-medium">{formatCurrency(oc.total, oc.moneda as "ARS" | "USD")}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {selectedOCIds.size > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-orange-600 font-medium">
                  {selectedOCIds.size} OC{selectedOCIds.size > 1 ? "s" : ""} seleccionada{selectedOCIds.size > 1 ? "s" : ""}
                </p>
                {alignmentLoading ? (
                  <div className="flex items-center gap-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500 dark:bg-zinc-800"><Loader2 size={14} className="animate-spin" />Verificando importes ya facturados...</div>
                ) : (alignmentBlocked || (needsOverride && overrideOC)) ? (
                  <div className="space-y-2">
                    <div className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${overrideOC ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"}`}>
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>{alignmentError || (currencyMismatch ? `La factura está en ${moneda} y la OC en ${[...ocCurrencies].join("/")}. Activá la opción de abajo para actualizar la OC.` : `El comprobante supera el saldo de las OC en ${formatCurrency(Math.abs(alignmentDifference), moneda)}.`)}</span>
                    </div>
                    {needsOverride && !alignmentError && (
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-800 dark:bg-orange-950/30">
                        <input type="checkbox" checked={overrideOC} onChange={(e) => setOverrideOC(e.target.checked)} className="mt-0.5 accent-orange-600" />
                        <span>
                          <strong className="text-orange-700 dark:text-orange-300">Actualizar OC desde esta factura</strong>
                          <span className="block text-zinc-500 mt-0.5">Se actualizarán los items, totales{currencyMismatch ? ` y moneda (→ ${moneda})` : ""} de la OC. Los items que matcheen también actualizarán el precio de costo en el presupuesto.</span>
                        </span>
                      </label>
                    )}
                  </div>
                ) : Math.abs(alignmentDifference) <= 0.01 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"><Check size={15} />Importe conciliado: comprobante y OC coinciden.</div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    Factura parcial: después de guardarla quedarán {formatCurrency(alignmentDifference, moneda)} pendientes en la OC. Ya facturado: {formatCurrency(alreadyInvoiced, moneda)}.
                  </div>
                )}
              </div>
            )}
          </section>}

          {/* ── Notas ── */}
          <section>
            <label className="block text-[10px] uppercase text-zinc-400 mb-1">Notas / observaciones</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
              placeholder="Opcional"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700"><input type="checkbox" checked={pagadaSinOP} onChange={(e) => setPagadaSinOP(e.target.checked)} className="mt-0.5 accent-orange-600" /><span><strong>Ya pagada con tarjeta / marketplace</strong><span className="block text-xs font-normal text-zinc-500">La factura queda pagada sin generar una orden de pago ni duplicar el gasto.</span></span></label>
          </section>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
          <p className="text-xs text-zinc-400">
            La factura quedara pendiente de aprobacion por administracion
          </p>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || alignmentLoading || alignmentBlocked}
              className="px-6 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Guardando..." : "Enviar para aprobacion"}
            </button>
          </div>
        </div>
      </div>

      {nuevoProveedorOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/65 p-4">
          <div className="my-6 w-full max-w-2xl rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white">Nuevo proveedor</h3>
                <p className="text-xs text-zinc-500">Se guardará y quedará seleccionado en esta factura.</p>
              </div>
              <button type="button" onClick={() => setNuevoProveedorOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={18} /></button>
            </div>

            <div className="max-h-[72vh] overflow-y-auto p-6">
              {nuevoProveedorError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">{nuevoProveedorError}</div>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><label className="text-xs font-medium text-zinc-500">Razón social *</label><input value={nuevoProveedor.razon_social} onChange={e => setNuevoProveedor({ ...nuevoProveedor, razon_social: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">CUIT *</label><div className="mt-1 flex gap-2"><input value={nuevoProveedor.cuit} onChange={e => setNuevoProveedor({ ...nuevoProveedor, cuit: e.target.value })} placeholder="XX-XXXXXXXX-X" className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono dark:border-zinc-600 dark:bg-zinc-800" /><button type="button" onClick={lookupNuevoProveedor} disabled={cuitLoading} className="inline-flex items-center gap-1 rounded-lg border border-blue-300 px-3 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50">{cuitLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} AFIP</button></div></div>
                <div><label className="text-xs font-medium text-zinc-500">Condición IVA</label><select value={nuevoProveedor.condicion_iva} onChange={e => setNuevoProveedor({ ...nuevoProveedor, condicion_iva: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"><option value="RI">Responsable Inscripto</option><option value="Monotributo">Monotributo</option><option value="Exento">Exento</option></select></div>
                <div><label className="text-xs font-medium text-zinc-500">Rubro</label><input value={nuevoProveedor.rubro} onChange={e => setNuevoProveedor({ ...nuevoProveedor, rubro: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Email</label><input type="email" value={nuevoProveedor.email} onChange={e => setNuevoProveedor({ ...nuevoProveedor, email: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Teléfono</label><input value={nuevoProveedor.telefono} onChange={e => setNuevoProveedor({ ...nuevoProveedor, telefono: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Dirección</label><input value={nuevoProveedor.direccion} onChange={e => setNuevoProveedor({ ...nuevoProveedor, direccion: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Localidad</label><input value={nuevoProveedor.localidad} onChange={e => setNuevoProveedor({ ...nuevoProveedor, localidad: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Provincia</label><input value={nuevoProveedor.provincia} onChange={e => setNuevoProveedor({ ...nuevoProveedor, provincia: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Forma de pago</label><select value={nuevoProveedor.forma_pago} onChange={e => setNuevoProveedor({ ...nuevoProveedor, forma_pago: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Cheque">Cheque</option><option value="Efectivo">Efectivo</option><option value="Cuenta corriente">Cuenta corriente</option></select></div>
                <div><label className="text-xs font-medium text-zinc-500">Días cuenta corriente</label><input type="number" value={nuevoProveedor.dias_cuenta_corriente} onChange={e => setNuevoProveedor({ ...nuevoProveedor, dias_cuenta_corriente: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Límite de crédito</label><input type="number" value={nuevoProveedor.limite_credito} onChange={e => setNuevoProveedor({ ...nuevoProveedor, limite_credito: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>

                <div className="sm:col-span-2 mt-2 border-t border-zinc-200 pt-4 dark:border-zinc-700"><h4 className="text-sm font-semibold">Datos bancarios <span className="font-normal text-zinc-400">(opcionales)</span></h4></div>
                <div><label className="text-xs font-medium text-zinc-500">CBU / CVU</label><input value={nuevoProveedor.cbu} onChange={e => setNuevoProveedor({ ...nuevoProveedor, cbu: e.target.value.replace(/\s/g, "") })} placeholder="22 dígitos" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Alias</label><input value={nuevoProveedor.alias_bancario} onChange={e => setNuevoProveedor({ ...nuevoProveedor, alias_bancario: e.target.value })} placeholder="alias.del.proveedor" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">N° de cuenta</label><input value={nuevoProveedor.numero_cuenta} onChange={e => setNuevoProveedor({ ...nuevoProveedor, numero_cuenta: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div className="sm:col-span-2"><label className="text-xs font-medium text-zinc-500">Notas</label><textarea rows={2} value={nuevoProveedor.notas} onChange={e => setNuevoProveedor({ ...nuevoProveedor, notas: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
              <button type="button" onClick={() => setNuevoProveedorOpen(false)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600">Cancelar</button>
              <button type="button" onClick={handleCrearProveedor} disabled={nuevoProveedorSaving} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{nuevoProveedorSaving && <Loader2 size={15} className="animate-spin" />}{nuevoProveedorSaving ? "Creando..." : "Crear y seleccionar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
