"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { mockRemitos } from "@/lib/mock-data";
import { Sparkles, Truck, Loader2, CheckCircle2, Package, X, Download, Copy, Check, ClipboardCopy, Mail, Plus, Link2, Trash2, Minus } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatCurrency } from "@/lib/utils";

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

const transporteEstadoConfig: Record<string, { label: string; variant: "success" | "warning" | "info" | "danger" }> = {
  solicitado: { label: "Solicitado", variant: "warning" },
  en_transito: { label: "En tránsito", variant: "info" },
  entregado: { label: "Entregado", variant: "success" },
  cancelado: { label: "Cancelado", variant: "danger" },
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
  clientes: { razon_social: string; email?: string; cuit?: string; direccion?: string } | null;
  sucursal_nombre?: string;
  clienteNombre: string;
  remito_items: { id: string }[];
}

interface RemitoDetailItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  orden: number;
}

interface TransporteLinked {
  id: string;
  transportista: string;
  estado: string;
  fecha: string;
  destino: string | null;
  costo: number | null;
  moneda: string;
}

interface CreateItem {
  tempId: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
}

interface PresupuestoIA {
  id: string;
  numero: string;
  cliente_id: string;
  clientes: { razon_social: string } | null;
  presupuesto_items: { id: string; descripcion: string; cantidad: number; unidad: string }[];
}

export default function RemitosPage() {
  const { sociedadActiva, profile } = useUser();
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
  const [createItems, setCreateItems] = useState<CreateItem[]>([]);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string }[]>([]);
  const [presupuestosAprobados, setPresupuestosAprobados] = useState<{ id: string; numero: string; subtotal: number | null; total: number | null; cliente_id: string | null }[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [loadingPRItems, setLoadingPRItems] = useState(false);

  // Detail panel
  const [detailRemito, setDetailRemito] = useState<RemitoRow | null>(null);
  const [detailItems, setDetailItems] = useState<RemitoDetailItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [detailPRNumero, setDetailPRNumero] = useState<string | null>(null);
  const [detailFacturas, setDetailFacturas] = useState<{ id: string; numero: string; tipo: string; total: number; estado: string }[]>([]);
  const [detailTransportes, setDetailTransportes] = useState<TransporteLinked[]>([]);

  // Create transporte from remito
  const [createTransporteOpen, setCreateTransporteOpen] = useState(false);
  const [transporteForm, setTransporteForm] = useState({
    transportista_id: "",
    transportista: "",
    destino: "",
    origen: "",
    fecha: new Date().toISOString().split("T")[0],
    costo: "",
    moneda: "ARS" as "ARS" | "USD",
    bultos: "",
    tipo_vehiculo: "",
    notas: "",
  });
  const [creatingTransporte, setCreatingTransporte] = useState(false);
  const [catalogTransportistas, setCatalogTransportistas] = useState<{ id: string; nombre: string }[]>([]);

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
    cliente: "",
    vinculado: "",
  });

  // Build unique client options from loaded remitos
  const clienteOptions = Array.from(new Set(remitos.map(r => r.clientes?.razon_social).filter(Boolean)))
    .sort()
    .map(name => ({ value: name!, label: name! }));

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
      key: "cliente",
      label: "Cliente",
      type: "select",
      options: clienteOptions,
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

  // PRs filtered by selected client in create modal
  const filteredPRs = useMemo(() => {
    if (!createForm.cliente_id) return presupuestosAprobados;
    return presupuestosAprobados.filter(p => p.cliente_id === createForm.cliente_id);
  }, [presupuestosAprobados, createForm.cliente_id]);

  const fetchData = useCallback(async () => {
      try {
        let q = supabase
          .from("remitos")
          .select(`*, clientes(razon_social, email, cuit, direccion), remito_items(id)`)
          .order("fecha", { ascending: false });

        if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);

        const { data, error } = await q;

        if (!error && data) {
          setRemitos((data as any[]).map(r => ({ ...r, clienteNombre: r.clientes?.razon_social || "" })) as RemitoRow[]);
        } else if (error) {
          setRemitos(mockRemitos.map((r) => ({
            id: r.id, numero: r.numero, cliente_id: r.clienteId,
            presupuesto_id: r.presupuestoId || null, fecha: r.fecha,
            cae: r.cae || null, estado: r.estado, observaciones: r.observaciones,
            valor_declarado: null,
            clientes: { razon_social: r.clienteNombre },
            clienteNombre: r.clienteNombre,
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
          clienteNombre: r.clienteNombre,
          remito_items: r.items.map((i) => ({ id: i.id })),
        })));
      } finally {
        setLoading(false);
      }
  }, [sociedadActiva?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleEstadoChange(id: string, estado: "pendiente" | "entregado" | "parcial") {
    try {
      const { error } = await supabase.from("remitos").update({ estado }).eq("id", id);
      if (error) {
        alert("Error al actualizar estado: " + error.message);
        return;
      }
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
    setCreateItems([]);
    setCreateError("");

    let clienteQ = supabase.from("clientes").select("id, razon_social").eq("activo", true).order("razon_social");
    if (sociedadActiva?.id) clienteQ = clienteQ.eq("sociedad_id" as any, sociedadActiva.id);

    const [clientesRes, presupuestosRes] = await Promise.all([
      clienteQ,
      (supabase as any).from("presupuestos").select("id, numero, subtotal, total, cliente_id").in("estado", ["aprobado", "remitido"]),
    ]);
    if (clientesRes.data) setClientes(clientesRes.data as { id: string; razon_social: string }[]);
    if (presupuestosRes.data) setPresupuestosAprobados(presupuestosRes.data as any[]);
    setCreateModalOpen(true);
  }

  // Fetch items from PR when selected
  async function handlePRSelect(prId: string) {
    const pr = presupuestosAprobados.find((p) => p.id === prId);
    const autoValor = pr?.total ? String(pr.total) : pr?.subtotal ? String(pr.subtotal) : "";

    setCreateForm((prev) => ({
      ...prev,
      presupuesto_id: prId,
      cliente_id: pr?.cliente_id || prev.cliente_id,
      valor_declarado: prev.valor_declarado === "" || presupuestosAprobados.some((p) => (p.total || p.subtotal) && String(p.total || p.subtotal) === prev.valor_declarado)
        ? autoValor
        : prev.valor_declarado,
    }));

    if (!prId) {
      setCreateItems([]);
      return;
    }

    // Fetch items from presupuesto
    setLoadingPRItems(true);
    try {
      const { data: items } = await supabase
        .from("presupuesto_items")
        .select("descripcion, cantidad, unidad")
        .eq("presupuesto_id", prId)
        .order("orden");

      if (items && items.length > 0) {
        setCreateItems(items.map((it: any, idx: number) => ({
          tempId: `pr-${idx}`,
          descripcion: it.descripcion || "",
          cantidad: Number(it.cantidad) || 1,
          unidad: it.unidad || "UN",
        })));
      } else {
        setCreateItems([]);
      }
    } catch {
      setCreateItems([]);
    } finally {
      setLoadingPRItems(false);
    }
  }

  function addManualItem() {
    setCreateItems(prev => [...prev, {
      tempId: `manual-${Date.now()}`,
      descripcion: "",
      cantidad: 1,
      unidad: "UN",
    }]);
  }

  function updateCreateItem(tempId: string, field: keyof CreateItem, value: string | number) {
    setCreateItems(prev => prev.map(it => it.tempId === tempId ? { ...it, [field]: value } : it));
  }

  function removeCreateItem(tempId: string) {
    setCreateItems(prev => prev.filter(it => it.tempId !== tempId));
  }

  async function handleCreateRemito() {
    setCreateError("");
    if (!createForm.numero.trim()) { setCreateError("El número de remito es obligatorio"); return; }
    if (!createForm.cliente_id) { setCreateError("Seleccioná un cliente"); return; }
    if (!createForm.fecha) { setCreateError("La fecha es obligatoria"); return; }

    // Filter out items with empty description
    const validItems = createItems.filter(it => it.descripcion.trim());
    if (validItems.length === 0) { setCreateError("Agregá al menos un item al remito"); return; }

    setCreating(true);
    try {
      const { data: remitoData, error } = await (supabase.from("remitos") as any).insert({
        numero: createForm.numero,
        cliente_id: createForm.cliente_id,
        fecha: createForm.fecha,
        observaciones: createForm.observaciones,
        presupuesto_id: createForm.presupuesto_id || null,
        estado: "pendiente",
        valor_declarado: createForm.valor_declarado ? Number(createForm.valor_declarado) : null,
        sociedad_id: sociedadActiva?.id || null,
        created_by: profile?.id || null,
      }).select("id").single();

      if (error || !remitoData) {
        setCreateError("Error al crear remito: " + (error?.message || "sin datos"));
        return;
      }

      // Insert items
      const remitoItems = validItems.map((it, idx) => ({
        remito_id: remitoData.id,
        descripcion: it.descripcion,
        cantidad: Number(it.cantidad),
        unidad: it.unidad || "UN",
        orden: idx,
      }));
      const { error: itemsErr } = await (supabase as any).from("remito_items").insert(remitoItems);
      if (itemsErr) {
        console.error("Error inserting remito items:", itemsErr);
      }

      setCreateModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error("Error creating remito:", err);
      setCreateError("Error inesperado al crear remito");
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

        // Fetch total for valor_declarado
        const { data: prHeader } = await supabase
          .from("presupuestos")
          .select("total, subtotal")
          .eq("id", pId)
          .single();
        const valorDeclarado = (prHeader as any)?.total || (prHeader as any)?.subtotal || null;

        const { data: remitoData, error: rErr } = await (supabase.from("remitos") as any).insert({
          numero,
          cliente_id: p.cliente_id,
          fecha: new Date().toISOString().split("T")[0],
          observaciones: `Generado desde presupuesto ${p.numero}`,
          presupuesto_id: p.id,
          estado: "pendiente",
          sociedad_id: sociedadActiva?.id || null,
          valor_declarado: valorDeclarado ? Number(valorDeclarado) : null,
          created_by: profile?.id || null,
        }).select("id").single();

        if (rErr) {
          console.error("Error creating remito:", rErr);
          continue;
        }

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
    setDetailPRNumero(null);
    setDetailFacturas([]);
    setDetailTransportes([]);
    setCreateTransporteOpen(false);
    try {
      const itemsPromise = supabase
        .from("remito_items")
        .select("id, descripcion, cantidad, unidad, orden")
        .eq("remito_id", row.id)
        .order("orden", { ascending: true });

      const prPromise = row.presupuesto_id
        ? supabase.from("presupuestos").select("numero, sucursal_id").eq("id", row.presupuesto_id).single()
        : null;
      const facturasPromise = row.presupuesto_id
        ? supabase.from("facturas").select("id, numero, tipo, total, estado").eq("presupuesto_id" as any, row.presupuesto_id)
        : null;
      const transportesPromise = (supabase as any)
        .from("transportes")
        .select("id, transportista, estado, fecha, destino, costo, moneda")
        .eq("remito_id", row.id);

      const [itemsRes, prRes, facturasRes, transportesRes] = await Promise.all([
        itemsPromise,
        prPromise,
        facturasPromise,
        transportesPromise,
      ]);

      setDetailItems((itemsRes.data as unknown as RemitoDetailItem[]) || []);
      if (prRes?.data) {
        setDetailPRNumero((prRes.data as any).numero || null);
        const sucId = (prRes.data as any).sucursal_id;
        if (sucId) {
          const { data: sucData } = await (supabase as any).from("cliente_sucursales").select("nombre").eq("id", sucId).single();
          if (sucData) setDetailRemito((prev) => prev ? { ...prev, sucursal_nombre: sucData.nombre } : prev);
        }
      }
      if (facturasRes?.data) setDetailFacturas((facturasRes.data as any[]) || []);
      if (transportesRes?.data) setDetailTransportes((transportesRes.data as TransporteLinked[]) || []);
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

    // Determine sociedad info
    const isGrupoLA = sociedadActiva?.id === "fee94607-747a-4e87-ba24-aff9032f7a56";
    const socNombre = isGrupoLA ? "Grupo LA S.A.S." : "Lazzari Soluciones Industriales";
    const socCuit = isGrupoLA ? "30-71939604-2" : "20-37930912-8";
    const socColor = isGrupoLA ? "#2563EB" : "#FF4500";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Remito ${r.numero}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:40px;color:#333;font-size:13px}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${socColor};padding-bottom:16px;margin-bottom:24px}
      .logo{font-size:22px;font-weight:bold;color:${socColor}}
      .logo span{font-size:11px;color:#666;font-weight:normal;display:block;margin-top:2px}
      .doc-info{text-align:right}
      .doc-info h2{margin:0;font-size:20px;color:${socColor}}
      .doc-info p{margin:2px 0;font-size:12px;color:#555}
      .section{margin-bottom:20px}
      .section h3{font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#888;border-bottom:1px solid #e5e5e5;padding-bottom:4px;margin-bottom:10px}
      .fields{display:flex;flex-wrap:wrap;gap:16px}
      .field label{font-size:10px;color:#999;display:block;text-transform:uppercase;letter-spacing:0.3px}
      .field span{font-size:13px;font-weight:500}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#f5f5f5;text-align:left;padding:10px 12px;font-size:11px;border-bottom:2px solid #ddd;text-transform:uppercase;letter-spacing:0.3px;color:#666}
      td{padding:10px 12px;font-size:12px;border-bottom:1px solid #eee}
      tr:last-child td{border-bottom:none}
      .valor-declarado{background:#fff3e0;border:2px solid #ff9800;border-radius:6px;padding:14px 16px;margin-top:20px;font-size:15px;font-weight:bold;color:#e65100}
      .obs{background:#f9f9f9;padding:12px 16px;border-radius:6px;font-size:12px;color:#555;margin-top:16px;border:1px solid #eee}
      .footer{margin-top:50px;display:flex;justify-content:space-between;padding-top:20px}
      .signature{border-top:1px solid #333;width:200px;text-align:center;padding-top:6px;font-size:11px;color:#666}
      .no-items{text-align:center;color:#999;padding:24px;font-style:italic}
      @media print{body{margin:20px}}
    </style></head><body>
    <div class="header">
      <div class="logo">${socNombre}<span>CUIT: ${socCuit}</span></div>
      <div class="doc-info">
        <h2>REMITO</h2>
        <p><strong>${r.numero}</strong></p>
        <p>Fecha: ${formatDate(r.fecha)}</p>
        ${r.cae ? `<p>CAE: ${r.cae}</p>` : ""}
      </div>
    </div>

    <div class="section">
      <h3>Cliente</h3>
      <div class="fields">
        <div class="field"><label>Razón Social</label><span>${r.clientes?.razon_social || "\u2014"}</span></div>
        ${r.clientes?.cuit ? `<div class="field"><label>CUIT</label><span>${r.clientes.cuit}</span></div>` : ""}
        ${r.clientes?.direccion ? `<div class="field"><label>Dirección</label><span>${r.clientes.direccion}</span></div>` : ""}
        ${r.sucursal_nombre ? `<div class="field"><label>Sucursal</label><span>${r.sucursal_nombre}</span></div>` : ""}
      </div>
    </div>

    <div class="section">
      <h3>Items</h3>
      ${items.length > 0 ? `
      <table>
        <thead><tr><th style="width:40px">#</th><th>Descripción</th><th style="width:100px;text-align:right">Cantidad</th><th style="width:80px">Unidad</th></tr></thead>
        <tbody>${items.map((it, i) => `<tr><td>${i + 1}</td><td>${it.descripcion}</td><td style="text-align:right;font-weight:500">${it.cantidad}</td><td>${it.unidad || "u"}</td></tr>`).join("")}</tbody>
      </table>` : `<p class="no-items">Sin items</p>`}
    </div>

    ${detailTransportes.length > 0 ? `
    <div class="section">
      <h3>Transporte</h3>
      <div class="fields">
      ${detailTransportes.map(t => `
        <div class="field"><label>Transportista</label><span>${t.transportista}</span></div>
        ${t.destino ? `<div class="field"><label>Destino</label><span>${t.destino}</span></div>` : ""}
        ${t.costo ? `<div class="field"><label>Costo flete</label><span>${formatCurrency(Number(t.costo), (t.moneda || "ARS") as "USD" | "ARS")}</span></div>` : ""}
      `).join("")}
      </div>
    </div>` : ""}

    ${r.valor_declarado ? `<div class="valor-declarado">VALOR DECLARADO: $ ${Number(r.valor_declarado).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</div>` : ""}
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

  async function handleCreateTransporteFromRemito() {
    const nombreTransportista = transporteForm.transportista_id && transporteForm.transportista_id !== "__manual"
      ? (catalogTransportistas.find(t => t.id === transporteForm.transportista_id)?.nombre || transporteForm.transportista)
      : transporteForm.transportista;
    if (!detailRemito || !nombreTransportista) return;
    setCreatingTransporte(true);
    try {
      const { error } = await (supabase as any).from("transportes").insert({
        sociedad_id: sociedadActiva?.id,
        transportista: nombreTransportista,
        transportista_id: (transporteForm.transportista_id && transporteForm.transportista_id !== "__manual") ? transporteForm.transportista_id : null,
        destino: transporteForm.destino || null,
        origen: transporteForm.origen || null,
        cliente_id: detailRemito.cliente_id,
        remito_id: detailRemito.id,
        fecha: transporteForm.fecha,
        costo: transporteForm.costo ? Number(transporteForm.costo) : null,
        moneda: transporteForm.moneda,
        bultos: transporteForm.bultos ? Number(transporteForm.bultos) : null,
        tipo_vehiculo: transporteForm.tipo_vehiculo || null,
        notas: transporteForm.notas || null,
        estado: "solicitado",
      });
      if (error) {
        alert("Error al crear transporte: " + error.message);
        return;
      }
      setCreateTransporteOpen(false);
      const { data: tData } = await (supabase as any)
        .from("transportes")
        .select("id, transportista, estado, fecha, destino, costo, moneda")
        .eq("remito_id", detailRemito.id);
      if (tData) setDetailTransportes(tData as TransporteLinked[]);
    } catch (err) {
      console.error("Error creating transporte:", err);
    } finally {
      setCreatingTransporte(false);
    }
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
        subtitle="Remitos de entrega"
        action={{ label: "Nuevo remito", onClick: openCreateModal }}
      />
      <div className="p-4 sm:p-8 space-y-6">
        <div className="flex items-center gap-4 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
          <div className="rounded-lg bg-violet-100 p-2 dark:bg-violet-900">
            <Sparkles className="h-5 w-5 text-violet-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-violet-800 dark:text-violet-300">Generar remitos desde PR</p>
            <p className="text-sm text-violet-600 dark:text-violet-400">
              Generá remitos automáticamente desde presupuestos aprobados con todos sus items.
            </p>
          </div>
          <button onClick={openIAModal} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
            Generar desde PR
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
              { key: "clientes", label: "Cliente", sortable: true, sortKey: "clienteNombre", render: (row) => <span className="font-medium">{row.clientes?.razon_social}</span> },
              { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
              { key: "remito_items", label: "Items", sortable: false, render: (row) => (
                <span className={`text-zinc-500 ${row.remito_items.length === 0 ? "text-red-400 font-medium" : ""}`}>
                  {row.remito_items.length === 0 ? "Sin items" : `${row.remito_items.length} productos`}
                </span>
              ) },
              { key: "presupuesto_id", label: "PR Origen", sortable: false, render: (row) => row.presupuesto_id ? <Badge variant="info">Vinculado</Badge> : <span className="text-zinc-400">{"\u2014"}</span> },
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
              const fechaFilter = smartFilterValues.fecha as { from?: string; to?: string } | undefined;
              if (fechaFilter?.from && r.fecha < fechaFilter.from) return false;
              if (fechaFilter?.to && r.fecha > fechaFilter.to) return false;
              const estadoFilter = smartFilterValues.estado as string;
              if (estadoFilter && r.estado !== estadoFilter) return false;
              const clienteFilter = smartFilterValues.cliente as string;
              if (clienteFilter && r.clientes?.razon_social !== clienteFilter) return false;
              const vinculadoFilter = smartFilterValues.vinculado as string;
              if (vinculadoFilter === "si" && !r.presupuesto_id) return false;
              if (vinculadoFilter === "no" && r.presupuesto_id) return false;
              return true;
            })}
            onRowClick={handleRowClick}
          />
        </Card>
      </div>

      {/* Detail Side Panel */}
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
              <div className="flex flex-wrap gap-2">
                {detailRemito.estado !== "entregado" && detailRemito.estado === "pendiente" && (
                  <button onClick={() => { handleEstadoChange(detailRemito.id, "parcial"); setDetailRemito({ ...detailRemito, estado: "parcial" }); }} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors">
                    <Package className="h-4 w-4" /> Entrega parcial
                  </button>
                )}
                {detailRemito.estado !== "entregado" && (detailRemito.estado === "pendiente" || detailRemito.estado === "parcial") && (
                  <button onClick={() => { handleEstadoChange(detailRemito.id, "entregado"); setDetailRemito({ ...detailRemito, estado: "entregado" }); }} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                    <CheckCircle2 className="h-4 w-4" /> Marcar entregado
                  </button>
                )}
              </div>

              {/* Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-400">Cliente</span>
                  <p className="font-medium dark:text-white">{detailRemito.clientes?.razon_social || "\u2014"}</p>
                </div>
                <div>
                  <span className="text-zinc-400">Fecha</span>
                  <p className="font-medium dark:text-white">{formatDate(detailRemito.fecha)}</p>
                </div>
                {detailRemito.clientes?.cuit && (
                  <div>
                    <span className="text-zinc-400">CUIT</span>
                    <p className="font-medium dark:text-white">{detailRemito.clientes.cuit}</p>
                  </div>
                )}
                {detailRemito.presupuesto_id && detailPRNumero && (
                  <div>
                    <span className="text-zinc-400">Presupuesto origen</span>
                    <button
                      onClick={() => window.open(`/presupuestos`, "_self")}
                      className="flex items-center gap-1 mt-0.5"
                      title="Ir a presupuestos"
                    >
                      <Badge variant="info">{detailPRNumero}</Badge>
                    </button>
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

              {/* Linked transportes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-400 font-medium">Transporte</span>
                  {!createTransporteOpen && (
                    <button
                      onClick={async () => {
                        setTransporteForm({
                          transportista_id: "", transportista: "", destino: "", origen: "",
                          fecha: new Date().toISOString().split("T")[0],
                          costo: "", moneda: "ARS", bultos: "", tipo_vehiculo: "", notas: "",
                        });
                        setCreateTransporteOpen(true);
                        try {
                          const { data } = await (supabase as any).from("transportistas").select("id, nombre").eq("activo", true).order("nombre");
                          if (data) setCatalogTransportistas(data as { id: string; nombre: string }[]);
                        } catch { /* ignore */ }
                      }}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      <Plus className="h-3 w-3" /> Agregar transporte
                    </button>
                  )}
                </div>

                {detailTransportes.length > 0 ? (
                  <div className="space-y-2">
                    {detailTransportes.map(t => {
                      const cfg = transporteEstadoConfig[t.estado] || { label: t.estado, variant: "info" as const };
                      return (
                        <div key={t.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Truck className="h-4 w-4 text-zinc-400" />
                              <span className="font-medium text-sm dark:text-white">{t.transportista}</span>
                              <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            </div>
                            <span className="text-xs text-zinc-400">{formatDate(t.fecha)}</span>
                          </div>
                          <div className="flex items-center gap-4 mt-1.5 text-xs text-zinc-500">
                            {t.destino && <span>Destino: {t.destino}</span>}
                            {t.costo != null && (
                              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(t.costo, t.moneda as "USD" | "ARS")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : !createTransporteOpen ? (
                  <p className="text-sm text-zinc-400 text-center py-3 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700">
                    Sin transporte asignado
                  </p>
                ) : null}

                {/* Inline create transporte form */}
                {createTransporteOpen && (
                  <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 p-3 space-y-2 mt-2">
                    <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-2">Nuevo transporte para este remito</p>
                    <div>
                      {catalogTransportistas.length > 0 ? (
                        <select
                          value={transporteForm.transportista_id}
                          onChange={e => {
                            const id = e.target.value;
                            const found = catalogTransportistas.find(t => t.id === id);
                            setTransporteForm({ ...transporteForm, transportista_id: id, transportista: found?.nombre || (id === "__manual" ? transporteForm.transportista : "") });
                          }}
                          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                        >
                          <option value="">Seleccionar transportista *</option>
                          {catalogTransportistas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                          <option value="__manual">Otro (ingresar manualmente)</option>
                        </select>
                      ) : (
                        <input type="text" value={transporteForm.transportista} onChange={e => setTransporteForm({ ...transporteForm, transportista: e.target.value })}
                          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          placeholder="Transportista *" autoFocus />
                      )}
                      {transporteForm.transportista_id === "__manual" && (
                        <input type="text" value={transporteForm.transportista} onChange={e => setTransporteForm({ ...transporteForm, transportista: e.target.value })}
                          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white mt-1"
                          placeholder="Nombre del transportista *" autoFocus />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={transporteForm.origen} onChange={e => setTransporteForm({ ...transporteForm, origen: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Origen" />
                      <input type="text" value={transporteForm.destino} onChange={e => setTransporteForm({ ...transporteForm, destino: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Destino" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input type="date" value={transporteForm.fecha} onChange={e => setTransporteForm({ ...transporteForm, fecha: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                      <input type="number" step="0.01" value={transporteForm.costo} onChange={e => setTransporteForm({ ...transporteForm, costo: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Monto (opc.)" />
                      <select value={transporteForm.moneda} onChange={e => setTransporteForm({ ...transporteForm, moneda: e.target.value as "ARS" | "USD" })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                        <option value="ARS">ARS</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" min="0" value={transporteForm.bultos} onChange={e => setTransporteForm({ ...transporteForm, bultos: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Bultos" />
                      <input type="text" value={transporteForm.tipo_vehiculo} onChange={e => setTransporteForm({ ...transporteForm, tipo_vehiculo: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Tipo vehículo" />
                    </div>
                    <textarea value={transporteForm.notas} onChange={e => setTransporteForm({ ...transporteForm, notas: e.target.value })}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" rows={1} placeholder="Notas..." />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setCreateTransporteOpen(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300">
                        Cancelar
                      </button>
                      <button onClick={handleCreateTransporteFromRemito}
                        disabled={creatingTransporte || (!transporteForm.transportista && !transporteForm.transportista_id) || (transporteForm.transportista_id === "__manual" && !transporteForm.transportista)}
                        className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1">
                        {creatingTransporte && <Loader2 className="h-3 w-3 animate-spin" />}
                        Crear transporte
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Linked facturas */}
              {detailFacturas.length > 0 && (
                <div>
                  <span className="text-xs text-zinc-400 block mb-2">Facturas vinculadas</span>
                  <div className="flex flex-wrap gap-2">
                    {detailFacturas.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => window.open(`/facturacion`, "_self")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                        title="Ir a facturacion"
                      >
                        <Badge variant={f.estado === "pagada" ? "success" : f.estado === "anulada" ? "warning" : "info"}>
                          {f.tipo} {f.numero}
                        </Badge>
                        <span className="text-zinc-500 font-mono">
                          ${Number(f.total).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                  <p className="text-sm text-zinc-400 text-center py-4 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700">Sin items cargados en este remito</p>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500">
                          <th className="text-left px-3 py-2 w-10">#</th>
                          <th className="text-left px-3 py-2">Descripción</th>
                          <th className="text-right px-3 py-2 w-24">Cantidad</th>
                          <th className="text-left px-3 py-2 w-20">Unidad</th>
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
          <Card className="w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold dark:text-white">Nuevo Remito</h2>
              <button onClick={() => setCreateModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
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
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={createForm.fecha}
                    onChange={(e) => setCreateForm({ ...createForm, fecha: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cliente *</label>
                <select
                  value={createForm.cliente_id}
                  onChange={(e) => {
                    const clienteId = e.target.value;
                    setCreateForm((prev) => ({ ...prev, cliente_id: clienteId, presupuesto_id: "" }));
                    setCreateItems([]);
                  }}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.razon_social}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Presupuesto {createForm.cliente_id ? "(filtrado por cliente)" : "(opcional)"}
                </label>
                <select
                  value={createForm.presupuesto_id}
                  onChange={(e) => handlePRSelect(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="">Sin presupuesto</option>
                  {filteredPRs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.numero}{p.total ? ` — $${Number(p.total).toLocaleString("es-AR")}` : p.subtotal ? ` — Neto: $${Number(p.subtotal).toLocaleString("es-AR")}` : ""}
                    </option>
                  ))}
                </select>
                {createForm.cliente_id && filteredPRs.length === 0 && (
                  <p className="text-xs text-zinc-400 mt-1">No hay presupuestos aprobados para este cliente</p>
                )}
              </div>

              {/* Items section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Items del remito *
                  </label>
                  <button
                    type="button"
                    onClick={addManualItem}
                    className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"
                  >
                    <Plus className="h-3 w-3" /> Agregar item
                  </button>
                </div>
                {loadingPRItems ? (
                  <div className="flex items-center justify-center py-4 text-sm text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Cargando items del presupuesto...
                  </div>
                ) : createItems.length === 0 ? (
                  <p className="text-xs text-zinc-400 text-center py-4 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
                    {createForm.presupuesto_id ? "El presupuesto no tiene items" : "Seleccioná un presupuesto o agregá items manualmente"}
                  </p>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500">
                          <th className="text-left px-3 py-2">Descripción</th>
                          <th className="text-center px-2 py-2 w-24">Cantidad</th>
                          <th className="text-center px-2 py-2 w-20">Unidad</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {createItems.map((item) => (
                          <tr key={item.tempId} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={item.descripcion}
                                onChange={(e) => updateCreateItem(item.tempId, "descripcion", e.target.value)}
                                className="w-full rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                                placeholder="Descripción del item"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.cantidad}
                                onChange={(e) => updateCreateItem(item.tempId, "cantidad", Number(e.target.value))}
                                className="w-full rounded border border-zinc-200 px-2 py-1 text-sm text-center dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={item.unidad}
                                onChange={(e) => updateCreateItem(item.tempId, "unidad", e.target.value)}
                                className="w-full rounded border border-zinc-200 px-2 py-1 text-sm text-center dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <button
                                type="button"
                                onClick={() => removeCreateItem(item.tempId)}
                                className="rounded p-1 text-zinc-400 hover:bg-red-100 hover:text-red-500 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Valor declarado ($) <span className="text-zinc-400 font-normal">(requerido para transporte)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={createForm.valor_declarado}
                  onChange={(e) => setCreateForm({ ...createForm, valor_declarado: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  placeholder="Ingrese el valor declarado..."
                />
                {!createForm.valor_declarado && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Sin valor declarado el transportista no puede completar el remito.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Observaciones</label>
                <textarea
                  value={createForm.observaciones}
                  onChange={(e) => setCreateForm({ ...createForm, observaciones: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  rows={2}
                  placeholder="Observaciones opcionales..."
                />
              </div>
            </div>
            {createError && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{createError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setCreateModalOpen(false); setCreateError(""); }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateRemito}
                disabled={creating}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {creating ? "Creando..." : `Crear Remito (${createItems.filter(i => i.descripcion.trim()).length} items)`}
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
                <h2 className="text-lg font-semibold dark:text-white">Generar Remitos desde Presupuestos</h2>
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
                  Seleccioná presupuestos aprobados para generar remitos automáticamente con todos sus items y valor declarado.
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
