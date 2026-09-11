"use client";

import { useState } from "react";
import { CheckCircle2, FileUp, Loader2, X, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, todayAR } from "@/lib/utils";

type Provider = { id: string; razon_social: string; cuit?: string | null };
type OC = { id: string; numero: string; proveedor_id: string; proveedor_nombre: string; moneda: string };
type QueueRow = { id: string; file: File; state: "pending" | "parsing" | "ready" | "saved" | "error"; message?: string; data?: any; provider?: Provider; oc?: OC };

export default function CargaMasivaFacturasCompra({ sociedadId, profileId, proveedores, ordenes, onClose, onSuccess }: { sociedadId: string; profileId: string | null; proveedores: Provider[]; ordenes: OC[]; onClose: () => void; onSuccess: () => void }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [saving, setSaving] = useState(false);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list).filter(f => /^(application\/pdf|image\/(png|jpe?g|webp))$/i.test(f.type));
    setRows(prev => [...prev, ...files.map(file => ({ id: `${Date.now()}-${Math.random()}`, file, state: "pending" as const }))]);
  }

  async function parseOne(row: QueueRow) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "parsing" } : r));
    try {
      const body = new FormData(); body.append("file", row.file);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo leer el archivo");
      const data = json.data || {};
      const cuit = String(data.proveedor?.cuit || "").replace(/\D/g, "");
      const provider = proveedores.find(p => cuit && String(p.cuit || "").replace(/\D/g, "") === cuit);
      const normalized = String(data.numero_factura || "").trim();
      const oc = provider ? ordenes.find(o => o.proveedor_id === provider.id) : undefined;
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "ready", data: { ...data, numero_factura: normalized }, provider, oc, message: provider ? undefined : "Proveedor no identificado: revisar manualmente" } : r));
    } catch (e) { setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "error", message: e instanceof Error ? e.message : "Error de lectura" } : r)); }
  }

  async function saveAll() {
    const ready = rows.filter(r => r.state === "ready" && r.data?.numero_factura && r.provider);
    if (!ready.length) return;
    setSaving(true);
    try {
      for (const row of ready) {
        const d = row.data;
        const { data: dup, error: dupErr } = await (supabase as any).from("facturas_compra").select("id, estado").eq("sociedad_id", sociedadId).eq("proveedor_id", row.provider!.id).eq("numero_factura", d.numero_factura).limit(1);
        if (dupErr) throw dupErr;
        if (dup?.length) { setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "error", message: "Duplicada: ya existe una factura con este proveedor y número" } : r)); continue; }
        const items = Array.isArray(d.items) ? d.items : [];
        const subtotal = Number(d.subtotal) || items.reduce((s: number, it: any) => s + (Number(it.cantidad) || 1) * (Number(it.precio_unitario) || 0), 0);
        const iva = Number(d.iva) || subtotal * ((Number(d.iva_porcentaje) || 21) / 100);
        const total = Number(d.total) || subtotal + iva + (Number(d.percepciones) || 0);
        const insert = { sociedad_id: sociedadId, created_by: profileId, proveedor_id: row.provider!.id, numero_factura: d.numero_factura, fecha: d.fecha || todayAR(), fecha_vencimiento: d.fecha_vencimiento || null, subtotal, iva_porcentaje: Number(d.iva_porcentaje) || 21, iva, percepciones: Number(d.percepciones) || 0, total, moneda: d.moneda === "USD" ? "USD" : "ARS", estado: "pendiente", tipo: "mercaderia", tipo_comprobante: d.tipo_comprobante || "FC A", notas: d.notas || null, cae: d.cae || null };
        const { data: saved, error } = await (supabase as any).from("facturas_compra").insert(insert).select("id").single();
        if (error) throw error;
        if (items.length && saved?.id) {
          const { error: itemError } = await (supabase as any).from("facturas_compra_items").insert(items.map((it: any) => ({ factura_compra_id: saved.id, sociedad_id: sociedadId, descripcion: it.descripcion || "Sin descripción", cantidad: Number(it.cantidad) || 1, precio_unitario: Number(it.precio_unitario) || 0, descuento_porcentaje: Number(it.descuento_porcentaje) || 0, iva_porcentaje: Number(it.iva_porcentaje) || Number(d.iva_porcentaje) || 21, unidad: it.unidad || "UN", codigo: it.codigo || null })));
          if (itemError) throw itemError;
        }
        const ext = row.file.name.split(".").pop() || "pdf";
        const path = `${sociedadId}/${saved.id}/factura.${ext}`;
        const upload = await supabase.storage.from("facturas-compra").upload(path, row.file, { upsert: true });
        if (!upload.error) {
          const url = supabase.storage.from("facturas-compra").getPublicUrl(path).data.publicUrl;
          await (supabase as any).from("facturas_compra").update({ archivo_url: url, archivo_nombre: row.file.name }).eq("id", saved.id).eq("sociedad_id", sociedadId);
        }
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "saved" } : r));
      }
      onSuccess();
    } catch (e) { alert(e instanceof Error ? e.message : "No se pudieron guardar todas las facturas"); }
    finally { setSaving(false); }
  }

  async function parsePending() {
    const pending = rows.filter(r => r.state === "pending");
    // Sequential parsing keeps the AI/API queue predictable and avoids
    // rate-limit failures when a user drops a large batch.
    for (const row of pending) await parseOne(row);
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold dark:text-white">Carga masiva de facturas de proveedores</h2><p className="text-xs text-zinc-500">Subí varias facturas. La IA las lee, busca proveedor/OC y deja en revisión las que no coinciden.</p></div><button onClick={onClose}><X className="h-5 w-5 text-zinc-400" /></button></div>
      <label className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 p-6 text-sm text-zinc-500 hover:border-orange-400"><FileUp className="h-5 w-5" /> Elegir varios PDF o imágenes<input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={e => addFiles(e.target.files)} /></label>
      <div className="max-h-[48vh] space-y-2 overflow-y-auto">{rows.map(row => <div key={row.id} className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium dark:text-white">{row.file.name}</p><p className="text-xs text-zinc-500">{row.state === "ready" ? `${row.provider?.razon_social || "Sin proveedor"}${row.oc ? ` · ${row.oc.numero}` : ""} · ${formatCurrency(Number(row.data?.total || 0), row.data?.moneda === "USD" ? "USD" : "ARS")}` : row.state === "saved" ? "Guardada" : row.message || row.state}</p></div>{row.state === "pending" && <button onClick={() => parseOne(row)} className="rounded bg-orange-500 px-2 py-1 text-xs text-white">Leer IA</button>}{row.state === "parsing" && <Loader2 className="h-4 w-4 animate-spin text-orange-500" />}{row.state === "ready" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}{row.state === "error" && <AlertTriangle className="h-4 w-4 text-red-500" />}</div>)}</div>
      <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cerrar</button><button disabled={!rows.some(r => r.state === "pending")} onClick={parsePending} className="rounded-lg border border-orange-500 px-4 py-2 text-sm font-medium text-orange-600 disabled:opacity-50">Leer pendientes con IA</button><button disabled={saving || !rows.some(r => r.state === "ready")} onClick={saveAll} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar facturas identificadas</button></div>
    </div>
  </div>;
}
