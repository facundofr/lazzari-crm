"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { mockRemitos } from "@/lib/mock-data";
import { Sparkles, Truck, Loader2, CheckCircle2, Package, X, Download, Copy, Check, ClipboardCopy, Mail } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-orange-500 transition-colors" title={label || "Copiar"}>
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {label && <span>{copied ? "Copiado" : label}</span>}
    </button>
  );
}
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "info" }> = {
  pendiente: { label: "Pendiente", variant: "warning" },
  entregado: { label: "Entregado", variant: "success" },
  parcial: { label: "Parcial", variant: "info" },
};

interface RemitoRow {
  id: string;
  numero: string;
  cliente_id: string;
  presupuesto_id: string | null;
  fecha: string;
  cae: string | null;
  estado: string;
  observaciones: string;
  valor_declarado: number | null;
  clientes: { razon_social: string; email?: string } | null;
  remito_items: { id: string }[];
}

interface RemitoDetailItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  orden: number;
}

interface PresupuestoIA {
  id: string;
  numero: string;
  cliente_id: string;
  clientes: { razon_social: string } | null;
  presupuesto_items: { id: string; descripcion: string; cantidad: number; unidad: string }[];
}

export default function RemitosPage() {
  const { sociedadActiva } = useUser();
  const [remitos, setRemitos] = useState<RemitoRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Create remito modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    numero: "",
    cliente_id: "",
    fecha: new Date().toISOString().split("T")[0],
    observaciones: "",
    presupuesto_id: "",
    valor_declarado: "",
  });
  const [clientes, setClientes] = useState<{ id: string; razon_social: string }[]>([]);
  const [presupuestosAprobados, setPresupuestosAprobados] = useState<{ id: string; numero: string }[]>([]);
  const [creating, setCreating] = useState(false);

  // Detail panel
  const [detailRemito, setDetailRemito] = useState<RemitoRow | null>(null);
  const [detailItems, setDetailItems] = useState<RemitoDetailItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // IA generation modal state
  const [iaModalOpen, setIaModalOpen] = useState(false);
  const [presupuestosIA, setPresupuestosIA] = useState<PresupuestoIA[]>([]);
  const [selectedPresupuestos, setSelectedPresupuestos] = useState<Set<string>>(new Set());
  const [generatingIA, setGeneratingIA] = useState(false);
  const [iaSuccess, setIaSuccess] = useState("");

  // SmartFilters state
  const [smartFilterValues, setSmartFilterValues] = useState<FilterValues>({
    fecha: { from: "", to: "" },
    estado: "",
    vinculado: "",
  });

  const smartFilterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    {
      key: "estado",
      label: "Estado",
      type: "select",
      options: [
        { value: "pendiente", label: "Pendiente" },
        { value: "entregado", label: "Entregado" },
        { value: "parcial", label: "Parcial" },
      ],
    },
    {
      key: "vinculado",
      label: "Vinculado a PR",
      type: "select",
      options: [
        { value: "si", label: "Sí" },
        { value: "no", label: "No" },
      ],
    },
  ];

  const fetchData = useCallback(async () => {
      try {
        let q = supabase
          .from("remitos")
          .select(`*, clientes(razon_social, email), remito_items(id)`)
          .order("fecha", { ascending: false });

        if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);

        const { data, error } = await q;

        if (!error && data && data.length > 0) {
          setRemitos(data as unknown as RemitoRow[]);
        } else {
          setRemitos(mockRemitos.map((r) => ({
            id: r.id, numero: r.numero, cliente_id: r.clienteId,
            presupuesto_id: r.presupuestoId || null, fecha: r.fecha,
            cae: r.cae || null, estado: r.estado, observaciones: r.observaciones,
            valor_declarado: null,
            clientes: { razon_social: r.clienteNombre },
            remito_items: r.items.map((i) => ({ id: i.id })),
          })));
        }
      } catch {
        setRemitos(mockRemitos.map((r) => ({
          id: r.id, numero: r.numero, cliente_id: r.clienteId,
          presupuesto_id: r.presupuestoId || null, fecha: r.fecha,
          cae: r.cae || null, estado: r.estado, observaciones: r.observaciones,
          valor_declarado: null,
          clientes: { razon_social: r.clienteNombre },
          remito_items: r.items.map((i) => ({ id: i.id })),
        })));
      } finally {
        setLoading(false);
      }
  }, [sociedadActiva]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleEstadoChange(id: string, estado: "pendiente" | "entregado" | "parcial") {
    try {
      await supabase.from("remitos").update({ estado }).eq("id", id);
      await fetchData();
    } catch (err) {
      console.error("Error updating remito:", err);
    }
  }

  async function openCreateModal() {
    const maxNum = remitos.reduce((max, r) => {
      const parts = r.numero?.split("-");
      const n = parts?.length === 3 ? parseInt(parts[2]) : 0;
      return n > max ? n : max;
    }, 0);
    const autoNumero = `R-0001-${String(maxNum + 1).padStart(8, "0")}`;
    setCreateForm({
      numero: autoNumero,
      cliente_id: "",
      fecha: new Date().toISOString().split("T")[0],
      observaciones: "",
      presupuesto_id: "",
      valor_declarado: "",
    });
    // Fetch clientes and presupuestos in parallel
    const [clientesRes, presupuestosRes] = await Promise.all([
      supabase.from("clientes").select("id, razon_social").eq("activo", true).order("razon_social"),
      supabase.from("presupuestos").select("id, numero").eq("estado", "aprobado"),
    ]);
    if (clientesRes.data) setClientes(clientesRes.data as { id: string; razon_social: string }[]);
    if (presupuestosRes.data) setPresupuestosAprobados(presupuestosRes.data as { id: string; numero: string }[]);
    setCreateModalOpen(true);
  }

  async function handleCreateRemito() {
    if (!createForm.numero || !createForm.cliente_id || !createForm.fecha) return;
    setCreating(true);
    try {
      await (supabase.from("remitos") as any).insert({
        numero: createForm.numero,
        cliente_id: createForm.cliente_id,
        fecha: createForm.fecha,
        observaciones: createForm.observaciones,
        presupuesto_id: createForm.presupuesto_id || null,
        estado: "pendiente",
        valor_declarado: createForm.valor_declarado ? Number(createForm.valor_declarado) : null,
      });
      setCreateModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error("Error creating remito:", err);
    } finally {
      setCreating(false);
    }
  }

  async function openIAModal() {
    setSelectedPresupuestos(new Set());
    setIaSuccess("");
    const { data } = await supabase
      .from("presupuestos")
      .select("id, numero, cliente_id, clientes(razon_social), presupuesto_items(id, descripcion, cantidad, unidad)")
      .eq("estado", "aprobado");
    if (data) setPresupuestosIA(data as unknown as PresupuestoIA[]);
    setIaModalOpen(true);
  }

  function togglePresupuesto(id: string) {
    setSelectedPresupuestos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerateIA() {
    if (selectedPresupuestos.size === 0) return;
    setGeneratingIA(true);
    try {
      let idx = remitos.reduce((max, r) => {
        const parts = r.numero?.split("-");
        const n = parts?.length === 3 ? parseInt(parts[2]) : 0;
        return n > max ? n : max;
      }, 0) + 1;
      for (const pId of selectedPresupuestos) {
        const p = presupuestosIA.find((x) => x.id === pId);
        if (!p) continue;
        const numero = `R-0001-${String(idx).padStart(8, "0")}`;
        const { data: remitoData } = await (supabase.from("remitos") as any).insert({
          numero,
          cliente_id: p.cliente_id,
          fecha: new Date().toISOString().split("T")[0],
          observaciones: `Generado desde presupuesto ${p.numero}`,
          presupuesto_id: p.id,
          estado: "pendiente",
        }).select("id").single();

        if (remitoData && p.presupuesto_items.length > 0) {
          const items = p.presupuesto_items.map((item, idx) => ({
            remito_id: remitoData.id,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            unidad: item.unidad,
            orden: idx,
          }));
          await (supabase.from("remito_items") as any).insert(items);
        }
        idx++;
      }
      setIaSuccess(`Se generaron ${selectedPresupuestos.size} remito(s) exitosamente.`);
      await fetchData();
    } catch (err) {
      console.error("Error generating remitos:", err);
    } finally {
      setGeneratingIA(false);
    }
  }

  async function handleRowClick(row: RemitoRow) {
    setDetailRemito(row);
    setDetailLoading(true);
    try {
      const { data } = await supabase
        .from("remito_items")
        .select("id, descripcion, cantidad, unidad, orden")
        .eq("remito_id", row.id)
        .order("orden", { ascending: true });
      setDetailItems((data as unknown as RemitoDetailItem[]) || []);
    } catch {
      setDetailItems([]);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleCopySummary() {
    if (!detailRemito) return;
    navigator.clipboard.writeText(buildRemitoSummaryText());
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  }

  function buildRemitoSummaryText() {
    if (!detailRemito) return "";
    const lines = [
      `REMITO ${detailRemito.numero}`,
      `Cliente: ${detailRemito.clientes?.razon_social || "\u2014"}`,
      `Fecha: ${formatDate(detailRemito.fecha)}`,
      `Estado: ${estadoConfig[detailRemito.estado]?.label || detailRemito.estado}`,
      detailRemito.valor_declarado ? `VALOR DECLARADO: $ ${Number(detailRemito.valor_declarado).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` : "",
      detailRemito.observaciones ? `Obs: ${detailRemito.observaciones}` : "",
      "",
      "ITEMS:",
      ...detailItems.map((it, i) => `${i + 1}. ${it.descripcion} — ${it.cantidad} ${it.unidad || "u"}`),
    ].filter(Boolean).join("\n");
    return lines;
  }

  function handleEmailRemito() {
    if (!detailRemito) return;
    const text = buildRemitoSummaryText();
    const emailTo = detailRemito.clientes?.email || "";
    const subject = encodeURIComponent(`Remito ${detailRemito.numero}`);
    const body = encodeURIComponent(text);
    window.open(`mailto:${encodeURIComponent(emailTo)}?subject=${subject}&body=${body}`, "_blank");
  }

  function handleDownloadPDF() {
    if (!detailRemito) return;
    const r = detailRemito;
    const items = detailItems;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Remito ${r.numero}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:40px;color:#333}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #FF4500;padding-bottom:16px;margin-bottom:24px}
      .logo{font-size:24px;font-weight:bold;color:#FF4500}
      .logo span{font-size:12px;color:#666;font-weight:normal;display:block}
      .doc-info{text-align:right}
      .doc-info h2{margin:0;font-size:18px}
      .doc-info p{margin:2px 0;font-size:12px;color:#666}
      .section{margin-bottom:20px}
      .section h3{font-size:13px;text-transform:uppercase;color:#999;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:8px}
      .field{display:inline-block;margin-right:24px;margin-bottom:6px}
      .field label{font-size:11px;color:#999;display:block}
      .field span{font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#f5f5f5;text-align:left;padding:8px;font-size:12px;border-bottom:2px solid #ddd}
      td{padding:8px;font-size:12px;border-bottom:1px solid #eee}
      .footer{margin-top:40px;display:flex;justify-content:space-between}
      .signature{border-top:1px solid #333;width:200px;text-align:center;padding-top:4px;font-size:11px;color:#666}
      .obs{background:#f9f9f9;padding:12px;border-radius:4px;font-size:12px;color:#555;margin-top:16px}
    </style></head><body>
    <div class="header">
      <div class="logo">Lazzari<span>Soluciones Industriales</span></div>
      <div class="doc-info">
        <h2>REMITO</h2>
        <p><strong>${r.numero}</strong></p>
        <p>Fecha: ${formatDate(r.fecha)}</p>
        <p>Estado: ${estadoConfig[r.estado]?.label || r.estado}</p>
        ${r.cae ? `<p>CAE: ${r.cae}</p>` : ""}
      </div>
    </div>
    <div class="section">
      <h3>Cliente</h3>
      <div class="field"><label>Razon Social</label><span>${r.clientes?.razon_social || "—"}</span></div>
    </div>
    <div class="section">
      <h3>Items</h3>
      <table>
        <thead><tr><th>#</th><th>Descripcion</th><th>Cantidad</th><th>Unidad</th></tr></thead>
        <tbody>${items.map((it, i) => `<tr><td>${i + 1}</td><td>${it.descripcion}</td><td>${it.cantidad}</td><td>${it.unidad || "u"}</td></tr>`).join("")}</tbody>
      </table>
    </div>
    ${r.valor_declarado ? `<div class="obs" style="font-size:14px;font-weight:bold;margin-top:16px;background:#fff3e0;border:1px solid #ff9800;padding:12px;border-radius:4px"><strong>VALOR DECLARADO:</strong> $ ${Number(r.valor_declarado).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</div>` : ""}
    ${r.observaciones ? `<div class="obs"><strong>Observaciones:</strong> ${r.observaciones}</div>` : ""}
    <div class="footer">
      <div class="signature">Firma Emisor</div>
      <div class="signature">Firma Receptor</div>
    </div>
    </body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (w) { setTimeout(() => { w.print(); }, 500); }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  if (loading) {
    return (
      <>
        <Header title="Remitos" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Remitos"
        subtitle="Remitos con CAE — asistidos por IA"
        action={{ label: "Nuevo remito", onClick: openCreateModal }}
      />
      <div className="p-4 sm:p-8 space-y-6">
        <div className="flex items-center gap-4 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
          <div className="rounded-lg bg-violet-100 p-2 dark:bg-violet-900">
            <Sparkles className="h-5 w-5 text-violet-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-violet-800 dark:text-violet-300">Asistente IA para remitos</p>
            <p className="text-sm text-violet-600 dark:text-violet-400">
              Generá remitos automáticamente desde presupuestos aprobados. La IA completa items, cantidades y datos de entrega.
            </p>
          </div>
          <button onClick={openIAModal} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
            Generar con IA
          </button>
        </div>

        <SmartFilters
          filters={smartFilterConfigs}
          values={smartFilterValues}
          onChange={setSmartFilterValues}
        />

        <Card className="p-0 overflow-hidden">
          <DataTable<RemitoRow>
            columns={[
              {
                key: "numero", label: "N° Remito",
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              { key: "clientes", label: "Cliente", sortable: false, render: (row) => <span className="font-medium">{row.clientes?.razon_social}</span> },
              { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
              { key: "remito_items", label: "Items", sortable: false, render: (row) => <span className="text-zinc-500">{row.remito_items.length} productos</span> },
              { key: "presupuesto_id", label: "PR Origen", sortable: false, render: (row) => row.presupuesto_id ? <Badge variant="info">Vinculado</Badge> : <span className="text-zinc-400">—</span> },
              {
                key: "estado", label: "Estado", sortable: true,
                render: (row) => {
                  const cfg = estadoConfig[row.estado] || { label: row.estado, variant: "info" as const };
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
              {
                key: "actions", label: "", sortable: false,
                render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {row.estado === "pendiente" && (
                      <>
                        <button onClick={() => handleEstadoChange(row.id, "parcial")} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600" title="Entrega parcial">
                          <Package className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleEstadoChange(row.id, "entregado")} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Marcar entregado">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {row.estado === "parcial" && (
                      <button onClick={() => handleEstadoChange(row.id, "entregado")} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Marcar entregado">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            data={remitos.filter((r) => {
              // fecha filter
              const fechaFilter = smartFilterValues.fecha as { from?: string; to?: string } | undefined;
              if (fechaFilter?.from && r.fecha < fechaFilter.from) return false;
              if (fechaFilter?.to && r.fecha > fechaFilter.to) return false;
              // estado filter
              const estadoFilter = smartFilterValues.estado as string;
              if (estadoFilter && r.estado !== estadoFilter) return false;
              // vinculado filter
              const vinculadoFilter = smartFilterValues.vinculado as string;
              if (vinculadoFilter === "si" && !r.presupuesto_id) return false;
              if (vinculadoFilter === "no" && r.presupuesto_id) return false;
              return true;
            })}
            onRowClick={handleRowClick}
          />
        </Card>
      </div>

      {/* ── Detail Side Panel ───────────────────────────────────────── */}
      {detailRemito && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailRemito(null)} />
          <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold font-mono dark:text-white">{detailRemito.numero}</h2>
                  <Badge variant={(estadoConfig[detailRemito.estado] || { variant: "info" as const }).variant}>
                    {(estadoConfig[detailRemito.estado] || { label: detailRemito.estado }).label}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleEmailRemito} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title="Enviar por correo">
                  <Mail className="h-3.5 w-3.5" /> Email
                </button>
                <button onClick={handleCopySummary} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title="Copiar resumen">
                  {copiedSummary ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  {copiedSummary ? "Copiado" : "Copiar"}
                </button>
                <button onClick={handleDownloadPDF} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title="Descargar PDF">
                  <Download className="h-3.5 w-3.5" /> PDF
                </button>
                <button onClick={() => setDetailRemito(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Action buttons */}
              {detailRemito.estado !== "entregado" && (
                <div className="flex flex-wrap gap-2">
                  {detailRemito.estado === "pendiente" && (
                    <button onClick={() => { handleEstadoChange(detailRemito.id, "parcial"); setDetailRemito({ ...detailRemito, estado: "parcial" }); }} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors">
                      <Package className="h-4 w-4" /> Entrega parcial
                    </button>
                  )}
                  {(detailRemito.estado === "pendiente" || detailRemito.estado === "parcial") && (
                    <button onClick={() => { handleEstadoChange(detailRemito.id, "entregado"); setDetailRemito({ ...detailRemito, estado: "entregado" }); }} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                      <CheckCircle2 className="h-4 w-4" /> Marcar entregado
                    </button>
                  )}
                </div>
              )}

              {/* Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-400">Cliente</span>
                  <p className="font-medium dark:text-white">{detailRemito.clientes?.razon_social || "—"}</p>
                </div>
                <div>
                  <span className="text-zinc-400">Fecha</span>
                  <p className="font-medium dark:text-white">{formatDate(detailRemito.fecha)}</p>
                </div>
                {detailRemito.presupuesto_id && (
                  <div>
                    <span className="text-zinc-400">Presupuesto origen</span>
                    <p className="font-mono text-blue-500 text-xs">{detailRemito.presupuesto_id.slice(0, 8)}...</p>
                  </div>
                )}
                {detailRemito.cae && (
                  <div>
                    <span className="text-zinc-400">CAE</span>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs dark:text-white">{detailRemito.cae}</p>
                      <CopyButton text={detailRemito.cae} />
                    </div>
                  </div>
                )}
                {detailRemito.valor_declarado != null && detailRemito.valor_declarado > 0 && (
                  <div>
                    <span className="text-zinc-400">Valor declarado</span>
                    <p className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                      $ {Number(detailRemito.valor_declarado).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                )}
              </div>

              {detailRemito.observaciones && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <span className="text-xs text-zinc-400 block mb-1">Observaciones</span>
                  <p className="text-sm dark:text-zinc-300">{detailRemito.observaciones}</p>
                </div>
              )}

              {/* Items */}
              <div>
                <h3 className="text-sm font-semibold mb-3 dark:text-white">Items ({detailItems.length})</h3>
                {detailLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>
                ) : detailItems.length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-4">Sin items</p>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500">
                          <th className="text-left px-3 py-2">#</th>
                          <th className="text-left px-3 py-2">Descripcion</th>
                          <th className="text-right px-3 py-2">Cantidad</th>
                          <th className="text-left px-3 py-2">Unidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((item, i) => (
                          <tr key={item.id} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                            <td className="px-3 py-2 dark:text-white">{item.descripcion}</td>
                            <td className="px-3 py-2 text-right font-medium dark:text-white">{item.cantidad}</td>
                            <td className="px-3 py-2 text-zinc-500">{item.unidad || "u"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Remito Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold dark:text-white">Nuevo Remito</h2>
              <button onClick={() => setCreateModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Numero</label>
                <input
                  type="text"
                  value={createForm.numero}
                  onChange={(e) => setCreateForm({ ...createForm, numero: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  placeholder="R-0001-00000012"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cliente</label>
                <select
                  value={createForm.cliente_id}
                  onChange={(e) => setCreateForm({ ...createForm, cliente_id: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.razon_social}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha</label>
                <input
                  type="date"
                  value={createForm.fecha}
                  onChange={(e) => setCreateForm({ ...createForm, fecha: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Observaciones</label>
                <textarea
                  value={createForm.observaciones}
                  onChange={(e) => setCreateForm({ ...createForm, observaciones: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Valor declarado ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={createForm.valor_declarado}
                  onChange={(e) => setCreateForm({ ...createForm, valor_declarado: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  placeholder="Ingrese el valor declarado..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Presupuesto (opcional)</label>
                <select
                  value={createForm.presupuesto_id}
                  onChange={(e) => setCreateForm({ ...createForm, presupuesto_id: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="">Sin presupuesto</option>
                  {presupuestosAprobados.map((p) => (
                    <option key={p.id} value={p.id}>{p.numero}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setCreateModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateRemito}
                disabled={creating || !createForm.numero || !createForm.cliente_id}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear Remito"}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* IA Generation Modal */}
      {iaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-600" />
                <h2 className="text-lg font-semibold dark:text-white">Generar Remitos con IA</h2>
              </div>
              <button onClick={() => setIaModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {iaSuccess ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  <p className="font-medium">{iaSuccess}</p>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-zinc-500">
                  Selecciona presupuestos aprobados para generar remitos automaticamente con sus items.
                </p>
                {presupuestosIA.length === 0 ? (
                  <p className="text-sm text-zinc-400 py-4 text-center">No hay presupuestos aprobados disponibles.</p>
                ) : (
                  <div className="space-y-2">
                    {presupuestosIA.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 cursor-pointer hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPresupuestos.has(p.id)}
                          onChange={() => togglePresupuesto(p.id)}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold">{p.numero}</span>
                            <span className="text-sm text-zinc-500">{p.clientes?.razon_social}</span>
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">{p.presupuesto_items.length} item(s)</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIaModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                {iaSuccess ? "Cerrar" : "Cancelar"}
              </button>
              {!iaSuccess && (
                <button
                  onClick={handleGenerateIA}
                  disabled={generatingIA || selectedPresupuestos.size === 0}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {generatingIA ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generando...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generar {selectedPresupuestos.size > 0 ? `(${selectedPresupuestos.size})` : ""}
                    </>
                  )}
                </button>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
