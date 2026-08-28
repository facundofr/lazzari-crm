"use client";

import { useState, useMemo } from "react";
import { X, Upload, Loader2, Sparkles, Check, Search, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
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
  onClose: () => void;
  onSuccess: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => new Date().toISOString().slice(0, 10);

// ── Component ────────────────────────────────────────────
export default function CargarFacturaOC({
  sociedadId, profileId, ordenes, onClose, onSuccess,
}: Props) {
  // ── Form state ──
  const [proveedorId, setProveedorId] = useState("");
  const [proveedorSearch, setProveedorSearch] = useState("");
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [proveedoresLoaded, setProveedoresLoaded] = useState(false);
  const [nuevoProveedorOpen, setNuevoProveedorOpen] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState(emptyNuevoProveedor);
  const [nuevoProveedorSaving, setNuevoProveedorSaving] = useState(false);
  const [nuevoProveedorError, setNuevoProveedorError] = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fecha, setFecha] = useState(todayStr());
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [cae, setCae] = useState("");
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [subtotal, setSubtotal] = useState(0);
  const [ivaPorcentaje, setIvaPorcentaje] = useState(21);
  const [percepciones, setPercepciones] = useState(0);
  const [notas, setNotas] = useState("");
  const [items, setItems] = useState<FCItem[]>([]);

  // ── OC selection ──
  const [selectedOCIds, setSelectedOCIds] = useState<Set<string>>(new Set());

  // ── File & parsing ──
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [parseError, setParseError] = useState("");

  // ── Save ──
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── Computed ──
  const iva = useMemo(() => Math.round(subtotal * ivaPorcentaje) / 100, [subtotal, ivaPorcentaje]);
  const total = useMemo(() => Math.round((subtotal + iva + percepciones) * 100) / 100, [subtotal, iva, percepciones]);

  // Filter OCs by selected proveedor
  const ocsFiltered = useMemo(() => {
    if (!proveedorId) return ordenes;
    return ordenes.filter(oc => oc.proveedor_id === proveedorId);
  }, [ordenes, proveedorId]);

  const filteredProveedores = useMemo(() => {
    if (!proveedorSearch.trim()) return proveedores.slice(0, 20);
    const q = proveedorSearch.toLowerCase();
    return proveedores.filter(p =>
      p.razon_social.toLowerCase().includes(q) || (p.cuit || "").includes(q)
    ).slice(0, 20);
  }, [proveedores, proveedorSearch]);

  const selectedProvNombre = proveedores.find(p => p.id === proveedorId)?.razon_social || "";

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

      // Auto-fill form
      if (d.numero_factura) setNumeroFactura(d.numero_factura);
      if (d.fecha) setFecha(d.fecha);
      if (d.fecha_vencimiento) setFechaVencimiento(d.fecha_vencimiento);
      if (d.cae) setCae(d.cae);
      if (d.moneda) setMoneda(d.moneda === "USD" ? "USD" : "ARS");
      if (d.subtotal) setSubtotal(Number(d.subtotal) || 0);
      if (d.iva_porcentaje != null) setIvaPorcentaje(Number(d.iva_porcentaje) || 21);
      if (d.percepciones) setPercepciones(Number(d.percepciones) || 0);
      if (d.notas) setNotas(d.notas);

      // Auto-fill items
      if (d.items && Array.isArray(d.items) && d.items.length > 0) {
        setItems(d.items.map((it: any, idx: number) => ({
          tempId: `ai-${Date.now()}-${idx}`,
          descripcion: it.descripcion || "",
          cantidad: Number(it.cantidad) || 1,
          precio_unitario: Number(it.precio_unitario) || 0,
          iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21,
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

  // ── Save ──
  async function handleSave() {
    if (!proveedorId) { setError("Seleccioná un proveedor"); return; }
    if (!numeroFactura.trim()) { setError("Ingresá el número de factura"); return; }
    if (subtotal <= 0) { setError("El subtotal debe ser mayor a 0"); return; }
    if (selectedOCIds.size === 0) { setError("Seleccioná al menos una orden de compra"); return; }

    setSaving(true);
    setError("");

    try {
      // Insert FC
      const insertData: Record<string, unknown> = {
        numero_factura: numeroFactura.trim(),
        proveedor_id: proveedorId,
        fecha,
        fecha_vencimiento: fechaVencimiento || null,
        subtotal,
        iva_porcentaje: ivaPorcentaje,
        iva,
        percepciones,
        total,
        moneda,
        estado: "pendiente_aprobacion",
        tipo: "mercaderia",
        solo_iva: false,
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
          unidad: it.unidad,
          iva_porcentaje: it.iva_porcentaje,
          sociedad_id: sociedadId,
        }));
        await (supabase as any).from("facturas_compra_items").insert(itemsInsert);
      }

      // Insert OC links (junction table)
      if (selectedOCIds.size > 0 && fcData?.id) {
        const links = Array.from(selectedOCIds).map(ocId => ({
          factura_compra_id: fcData.id,
          orden_compra_id: ocId,
        }));
        const { error: linkErr } = await (supabase as any)
          .from("factura_compra_ocs")
          .insert(links);
        if (linkErr) throw new Error(linkErr.message);
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

      alert("Factura cargada y enviada para aprobacion");
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
      <div className="bg-white dark:bg-zinc-900 w-full max-w-4xl rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Cargar factura de proveedor</h2>
            <p className="text-sm text-zinc-500">Cargá la factura y vinculala a las ordenes de compra correspondientes</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 max-h-[75vh] overflow-y-auto">
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
                <select value={ivaPorcentaje} onChange={e => setIvaPorcentaje(Number(e.target.value))}
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

            {/* Items preview */}
            {items.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase text-zinc-400 mb-1">Items detectados ({items.length})</p>
                <div className="max-h-32 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800 text-zinc-500">
                        <th className="px-2 py-1 text-left">Descripcion</th>
                        <th className="px-2 py-1 text-right">Cant.</th>
                        <th className="px-2 py-1 text-right">P. Unit.</th>
                        <th className="px-2 py-1 text-right">IVA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => (
                        <tr key={it.tempId} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="px-2 py-1 truncate max-w-[200px]">{it.descripcion}</td>
                          <td className="px-2 py-1 text-right font-mono">{it.cantidad}</td>
                          <td className="px-2 py-1 text-right font-mono">{formatCurrency(it.precio_unitario, moneda)}</td>
                          <td className="px-2 py-1 text-right">{it.iva_porcentaje}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ── 3. Vincular OCs ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              3. Vincular ordenes de compra
            </h3>
            {ocsFiltered.length === 0 ? (
              <p className="text-sm text-zinc-400 italic">
                {proveedorId
                  ? "No hay ordenes de compra activas para este proveedor"
                  : "Seleccioná un proveedor para filtrar las OCs"}
              </p>
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
              <p className="mt-2 text-xs text-orange-600 font-medium">
                {selectedOCIds.size} OC{selectedOCIds.size > 1 ? "s" : ""} seleccionada{selectedOCIds.size > 1 ? "s" : ""}
              </p>
            )}
          </section>

          {/* ── Notas ── */}
          <section>
            <label className="block text-[10px] uppercase text-zinc-400 mb-1">Notas / observaciones</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
              placeholder="Opcional"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
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
            <button onClick={handleSave} disabled={saving}
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
                <div><label className="text-xs font-medium text-zinc-500">CUIT *</label><input value={nuevoProveedor.cuit} onChange={e => setNuevoProveedor({ ...nuevoProveedor, cuit: e.target.value })} placeholder="XX-XXXXXXXX-X" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Condición IVA</label><select value={nuevoProveedor.condicion_iva} onChange={e => setNuevoProveedor({ ...nuevoProveedor, condicion_iva: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"><option value="RI">Responsable Inscripto</option><option value="Monotributo">Monotributo</option><option value="Exento">Exento</option></select></div>
                <div><label className="text-xs font-medium text-zinc-500">Rubro</label><input value={nuevoProveedor.rubro} onChange={e => setNuevoProveedor({ ...nuevoProveedor, rubro: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Email</label><input type="email" value={nuevoProveedor.email} onChange={e => setNuevoProveedor({ ...nuevoProveedor, email: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Teléfono</label><input value={nuevoProveedor.telefono} onChange={e => setNuevoProveedor({ ...nuevoProveedor, telefono: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Dirección</label><input value={nuevoProveedor.direccion} onChange={e => setNuevoProveedor({ ...nuevoProveedor, direccion: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Localidad</label><input value={nuevoProveedor.localidad} onChange={e => setNuevoProveedor({ ...nuevoProveedor, localidad: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Provincia</label><input value={nuevoProveedor.provincia} onChange={e => setNuevoProveedor({ ...nuevoProveedor, provincia: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Forma de pago</label><select value={nuevoProveedor.forma_pago} onChange={e => setNuevoProveedor({ ...nuevoProveedor, forma_pago: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"><option value="Transferencia">Transferencia</option><option value="Cheque">Cheque</option><option value="Efectivo">Efectivo</option><option value="Cuenta corriente">Cuenta corriente</option></select></div>
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
