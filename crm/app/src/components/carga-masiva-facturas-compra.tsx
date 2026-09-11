"use client";

import { useState } from "react";
import { CheckCircle2, FileUp, Loader2, X, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import CargarFacturaOC, { type OCParaVincular } from "@/components/cargar-factura-oc";
import { formatCurrency, todayAR } from "@/lib/utils";

type Provider = { id: string; razon_social: string; cuit?: string | null };
type OC = { id: string; numero: string; proveedor_id: string; proveedor_nombre: string; moneda: string };
type QueueRow = { id: string; file: File; state: "pending" | "parsing" | "ready" | "saved" | "error"; message?: string; data?: any; provider?: Provider; oc?: OC };

export default function CargaMasivaFacturasCompra({ sociedadId, profileId, proveedores, ordenes, onClose, onSuccess }: { sociedadId: string; profileId: string | null; proveedores: Provider[]; ordenes: OC[]; onClose: () => void; onSuccess: () => void }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<{row: QueueRow; orders: OCParaVincular[]} | null>(null);

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
      const candidates = ordenes.filter(o => o.proveedor_id === provider?.id && o.moneda === (data.moneda === "USD" ? "USD" : "ARS"));
      const oc = candidates.length === 1 ? candidates[0] : undefined;
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "ready", data: { ...data, numero_factura: normalized }, provider, oc, message: provider ? undefined : "Proveedor no identificado: revisar manualmente" } : r));
    } catch (e) { setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "error", message: e instanceof Error ? e.message : "Error de lectura" } : r)); }
  }

  async function openReview(row: QueueRow) {
    setSaving(true);
    try {
      if (!sociedadId) throw new Error("Seleccioná una sociedad");
      const { data, error } = await (supabase as any).from("ordenes_compra")
        .select("id, numero, proveedor_id, total, moneda, estado, fecha, proveedores(razon_social)")
        .eq("sociedad_id", sociedadId).in("estado", ["enviada", "confirmada", "recibida_parcial", "recibida"]);
      if (error) throw error;
      setReview({ row, orders: (data || []).map((o: any) => ({ ...o, proveedor_nombre: o.proveedores?.razon_social || "Sin proveedor" })) });
    } catch (e) { alert(e instanceof Error ? e.message : "No se pudieron cargar las OC"); }
    finally { setSaving(false); }
  }

  async function parsePending() {
    const pending = rows.filter(r => r.state === "pending");
    // Sequential parsing keeps the AI/API queue predictable and avoids
    // rate-limit failures when a user drops a large batch.
    for (const row of pending) await parseOne(row);
  }

  const busy = saving || rows.some(r => r.state === "parsing");
  const close = () => rows.some(r => r.state === "saved") ? onSuccess() : onClose();
  if (review) return <CargarFacturaOC key={review.row.id} sociedadId={sociedadId} profileId={profileId}
    ordenes={review.orders} initialImport={{ data: review.row.data || {}, file: review.row.file }}
    preselectedOCId={review.orders.some(o => o.id === review.row.oc?.id) ? review.row.oc?.id : undefined}
    onClose={() => setReview(null)} onSuccess={() => {
      setRows(prev => prev.map(r => r.id === review.row.id ? { ...r, state: "saved" } : r)); setReview(null);
    }} />;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold dark:text-white">Carga masiva de facturas de proveedores</h2><p className="text-xs text-zinc-500">Subí varias facturas. Revisá y confirmá cada una con sus importes, proveedor y OC antes de guardarla.</p></div><button disabled={busy} onClick={close}><X className="h-5 w-5 text-zinc-400" /></button></div>
      <label className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 p-6 text-sm text-zinc-500 hover:border-orange-400"><FileUp className="h-5 w-5" /> Elegir varios PDF o imágenes<input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={e => addFiles(e.target.files)} /></label>
      <div className="max-h-[48vh] space-y-2 overflow-y-auto">{rows.map(row => <div key={row.id} className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium dark:text-white">{row.file.name}</p><p className="text-xs text-zinc-500">{row.state === "ready" ? `${row.provider?.razon_social || "Sin proveedor"}${row.oc ? ` · ${row.oc.numero}` : ""} · ${formatCurrency(Number(row.data?.total || 0), row.data?.moneda === "USD" ? "USD" : "ARS")}` : row.state === "saved" ? "Guardada" : row.message || row.state}</p></div>{row.state === "pending" && <button disabled={busy} onClick={() => parseOne(row)} className="rounded bg-orange-500 px-2 py-1 text-xs text-white">Leer IA</button>}{row.state === "parsing" && <Loader2 className="h-4 w-4 animate-spin text-orange-500" />}{row.state === "ready" && <button disabled={busy} onClick={() => openReview(row)} className="rounded bg-orange-500 px-2 py-1 text-xs text-white">Revisar y confirmar</button>}{row.state === "error" && <button disabled={busy} onClick={() => openReview(row)} className="rounded border px-2 py-1 text-xs">Cargar manualmente</button>}</div>)}</div>
      <div className="mt-5 flex justify-end gap-2"><button disabled={busy} onClick={close} className="rounded-lg border px-4 py-2 text-sm">Cerrar</button><button disabled={busy || !rows.some(r => r.state === "pending")} onClick={parsePending} className="rounded-lg border border-orange-500 px-4 py-2 text-sm font-medium text-orange-600 disabled:opacity-50">Leer pendientes con IA</button></div>
    </div>
  </div>;
}
