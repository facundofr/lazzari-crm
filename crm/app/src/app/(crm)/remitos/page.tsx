"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { mockRemitos } from "@/lib/mock-data";
import { Sparkles, Truck, Loader2, CheckCircle2, Package, X, Download, Copy, Check, ClipboardCopy, Mail, Plus, Link2, Trash2, Minus, ShieldCheck, GitBranch, MapPin, Maximize2 } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatCurrency, todayAR } from "@/lib/utils";
import { generateRemitoPDF, getSociedadPDF, openPDFWindow } from "@/lib/pdf-templates";

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
  sucursal_direccion?: string;
  sucursal_id?: string;
  clienteNombre: string;
  oc_cliente?: string | null;
  presupuesto_numero?: string | null;
  remito_items: { id: string }[];
}

interface RemitoDetailItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  orden: number;
  presupuesto_item_id?: string | null;
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
  sucursal_id?: string;
  presupuesto_item_id?: string | null;
  orden?: number;
}

interface Sucursal {
  id: string;
  nombre: string;
  direccion: string;
  localidad: string;
  provincia: string;
  cp: string;
}

interface PresupuestoIA {
  id: string;
  numero: string;
  cliente_id: string;
  clientes: { razon_social: string } | null;
  presupuesto_items: { id: string; descripcion: string; cantidad: number; unidad: string; orden?: number }[];
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
    fecha: todayAR(),
    observaciones: "",
    presupuesto_id: "",
    valor_declarado: "0",
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
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [detailPRNumero, setDetailPRNumero] = useState<string | null>(null);
  const [detailFacturas, setDetailFacturas] = useState<{ id: string; numero: string; tipo: string; total: number; estado: string }[]>([]);
  const [detailTransportes, setDetailTransportes] = useState<TransporteLinked[]>([]);
  const [detailOC, setDetailOC] = useState<{ id: string; numero: string } | null>(null);

  // PDF valor declarado modal
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfValorDeclarado, setPdfValorDeclarado] = useState("0");

  // Create transporte from remito
  const [createTransporteOpen, setCreateTransporteOpen] = useState(false);
  const [transporteForm, setTransporteForm] = useState({
    transportista_id: "",
    transportista: "",
    destino: "",
    origen: "",
    fecha: todayAR(),
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

  // AFIP authorization
  const [autorizandoAFIP, setAutorizandoAFIP] = useState(false);
  const [afipError, setAfipError] = useState("");

  // Entrega parcial modal
  const [parcialModalOpen, setParcialModalOpen] = useState(false);
  const [parcialRemito, setParcialRemito] = useState<RemitoRow | null>(null);
  const [parcialItems, setParcialItems] = useState<(RemitoDetailItem & { cantidadEntregada: number })[]>([]);
  const [loadingParcial, setLoadingParcial] = useState(false);
  const [savingParcial, setSavingParcial] = useState(false);

  // Sucursales for create modal split
  const [clienteSucursales, setClienteSucursales] = useState<Sucursal[]>([]);

  // Split existing remito modal
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitItems, setSplitItems] = useState<(RemitoDetailItem & { sucursal_id: string })[]>([]);
  const [splitSucursales, setSplitSucursales] = useState<Sucursal[]>([]);
  const [splittingSaving, setSplittingSaving] = useState(false);
  // Split por cantidad: cada item puede tener múltiples asignaciones de cantidad por sucursal
  const [splitAssignments, setSplitAssignments] = useState<{ itemId: string; sucursal_id: string; cantidad: number; descripcion: string; unidad: string; maxCantidad: number; orden: number; presupuesto_item_id?: string | null }[]>([]);

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
        let q = (supabase as any)
          .from("remitos")
          .select(`*, clientes(razon_social, email, cuit, direccion), presupuestos(numero), remito_items(id)`)
          .order("fecha", { ascending: false });

        if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);

        const { data, error } = await q;

        if (!error && data) {
          setRemitos((data as any[]).map(r => ({ ...r, clienteNombre: r.clientes?.razon_social || "", presupuesto_numero: r.presupuestos?.numero || null })) as RemitoRow[]);
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

  async function openParcialModal(remito: RemitoRow) {
    setParcialRemito(remito);
    setParcialModalOpen(true);
    setLoadingParcial(true);
    try {
      const { data: items } = await (supabase as any)
        .from("remito_items")
        .select("id, descripcion, cantidad, unidad, orden, presupuesto_item_id")
        .eq("remito_id", remito.id)
        .order("orden", { ascending: true });
      if (items && items.length > 0) {
        setParcialItems((items as unknown as RemitoDetailItem[]).map(it => ({
          ...it,
          cantidadEntregada: it.cantidad,
        })));
      } else {
        setParcialItems([]);
      }
    } catch {
      setParcialItems([]);
    } finally {
      setLoadingParcial(false);
    }
  }

  async function handleSaveParcial() {
    if (!parcialRemito || parcialItems.length === 0) return;
    setSavingParcial(true);
    try {
      const entregados = parcialItems.filter(it => it.cantidadEntregada > 0);
      const pendientes = parcialItems
        .filter(it => it.cantidadEntregada < it.cantidad)
        .map(it => ({ ...it, cantidadRestante: it.cantidad - it.cantidadEntregada }));

      // Update existing remito items with delivered quantities
      for (const item of entregados) {
        const { error } = await supabase
          .from("remito_items")
          .update({ cantidad: item.cantidadEntregada })
          .eq("id", item.id);
        if (error) { alert("Error al actualizar item: " + error.message); return; }
      }

      // Remove items with 0 delivered
      const ceroItems = parcialItems.filter(it => it.cantidadEntregada === 0);
      for (const item of ceroItems) {
        await supabase.from("remito_items").delete().eq("id", item.id);
      }

      // Mark current remito as parcial
      const { error: statusErr } = await supabase.from("remitos").update({ estado: "parcial" }).eq("id", parcialRemito.id);
      if (statusErr) { alert("Error al actualizar estado: " + statusErr.message); return; }

      // If there are pending quantities, create a new remito for the remainder
      if (pendientes.length > 0) {
        const maxNum = remitos.reduce((max, r) => {
          const parts = r.numero?.split("-");
          const n = parts?.length === 3 ? parseInt(parts[2]) : 0;
          return n > max ? n : max;
        }, 0);
        const newNumero = `R-0001-${String(maxNum + 1).padStart(8, "0")}`;

        const { data: newRemito, error: newErr } = await (supabase.from("remitos") as any).insert({
          numero: newNumero,
          cliente_id: parcialRemito.cliente_id,
          fecha: todayAR(),
          observaciones: `Saldo pendiente de remito ${parcialRemito.numero}`,
          presupuesto_id: parcialRemito.presupuesto_id || null,
          estado: "pendiente",
          sociedad_id: sociedadActiva?.id || null,
          valor_declarado: null,
          created_by: profile?.id || null,
        }).select("id").single();

        if (newErr) {
          console.error("Error creating remainder remito:", newErr);
        } else if (newRemito) {
          const newItems = pendientes.map((it) => ({
            remito_id: newRemito.id,
            descripcion: it.descripcion,
            cantidad: it.cantidadRestante,
            unidad: it.unidad || "UN",
            orden: it.orden,
            presupuesto_item_id: it.presupuesto_item_id || null,
          }));
          const { error: itemsErr } = await (supabase.from("remito_items") as any).insert(newItems);
          if (itemsErr) console.error("Error inserting remainder items:", itemsErr);
        }
      }

      setParcialModalOpen(false);
      setParcialRemito(null);
      setParcialItems([]);
      if (detailRemito?.id === parcialRemito.id) {
        setDetailRemito({ ...parcialRemito, estado: "parcial" });
        // Refresh detail items
        handleRowClick({ ...parcialRemito, estado: "parcial" });
      }
      await fetchData();
    } catch (err) {
      console.error("Error in entrega parcial:", err);
    } finally {
      setSavingParcial(false);
    }
  }

  async function handleAutorizarAFIP() {
    if (!detailRemito) return;
    setAutorizandoAFIP(true);
    setAfipError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/remito", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          remito_id: detailRemito.id,
          sociedad_id: sociedadActiva?.id || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAfipError(data.error || "Error al autorizar remito");
        return;
      }
      // Update local state with CAE
      setDetailRemito({ ...detailRemito, cae: data.cae || data.car || "OK" });
      await fetchData();
    } catch (err: any) {
      setAfipError(err.message || "Error de conexión");
    } finally {
      setAutorizandoAFIP(false);
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
      fecha: todayAR(),
      observaciones: "",
      presupuesto_id: "",
      valor_declarado: "0",
    });
    setCreateItems([]);
    setCreateError("");
    setClienteSucursales([]);

    let clienteQ = supabase.from("clientes").select("id, razon_social").eq("activo", true).order("razon_social");
    if (sociedadActiva?.id) clienteQ = clienteQ.eq("sociedad_id" as any, sociedadActiva.id);

    const [clientesRes, presupuestosRes] = await Promise.all([
      clienteQ,
      (() => {
        let prQ = (supabase as any).from("presupuestos").select("id, numero, subtotal, total, cliente_id").in("estado", ["aprobado", "remitido"]);
        if (sociedadActiva?.id) prQ = prQ.eq("sociedad_id", sociedadActiva.id);
        return prQ.order("created_at", { ascending: false });
      })(),
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
      valor_declarado: prev.valor_declarado === "" || prev.valor_declarado === "0" || presupuestosAprobados.some((p) => (p.total || p.subtotal) && String(p.total || p.subtotal) === prev.valor_declarado)
        ? autoValor
        : prev.valor_declarado,
    }));

    if (!prId) {
      setCreateItems([]);
      return;
    }

    // Fetch items from presupuesto + PR sucursal
    setLoadingPRItems(true);
    try {
      const [itemsRes, prHeaderRes] = await Promise.all([
        supabase.from("presupuesto_items").select("id, descripcion, cantidad, unidad, orden").eq("presupuesto_id", prId).order("orden"),
        supabase.from("presupuestos").select("sucursal_id").eq("id", prId).single(),
      ]);
      const prSucursalId = (prHeaderRes.data as any)?.sucursal_id || "";

      // Fetch sucursales if client changed via PR and we don't have them
      const clienteId = pr?.cliente_id || createForm.cliente_id;
      if (clienteId && clienteSucursales.length === 0) {
        const { data: sucs } = await (supabase as any).from("cliente_sucursales")
          .select("id, nombre, direccion, localidad, provincia, cp")
          .eq("cliente_id", clienteId).eq("activo", true).order("principal", { ascending: false });
        if (sucs && sucs.length > 0) setClienteSucursales(sucs as Sucursal[]);
      }

      const items = itemsRes.data;
      if (items && items.length > 0) {
        setCreateItems(items.map((it: any, idx: number) => ({
          tempId: `pr-${idx}`,
          descripcion: it.descripcion || "",
          cantidad: Number(it.cantidad) || 1,
          unidad: it.unidad || "UN",
          sucursal_id: prSucursalId,
          presupuesto_item_id: it.id || null,
          orden: it.orden ?? idx,
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
      // Group items by sucursal_id for splitting
      const hasSucursales = clienteSucursales.length > 0 && validItems.some(it => it.sucursal_id);
      const groups = new Map<string, CreateItem[]>();

      if (hasSucursales) {
        for (const item of validItems) {
          const key = item.sucursal_id || "__none";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(item);
        }
      } else {
        groups.set("__none", validItems);
      }

      // Calculate next number
      let nextNum = remitos.reduce((max, r) => {
        const parts = r.numero?.split("-");
        const n = parts?.length === 3 ? parseInt(parts[2]) : 0;
        return n > max ? n : max;
      }, 0) + 1;

      const groupEntries = [...groups.entries()];
      for (let gi = 0; gi < groupEntries.length; gi++) {
        const [sucKey, groupItems] = groupEntries[gi];
        const sucursalId = sucKey === "__none" ? null : sucKey;
        const sucNombre = sucursalId ? clienteSucursales.find(s => s.id === sucursalId)?.nombre : null;
        const numero = gi === 0 ? createForm.numero : `R-0001-${String(nextNum).padStart(8, "0")}`;

        const obs = groupEntries.length > 1 && sucNombre
          ? [createForm.observaciones, `Sucursal: ${sucNombre}`].filter(Boolean).join(" — ")
          : createForm.observaciones;

        const { data: remitoData, error } = await (supabase.from("remitos") as any).insert({
          numero,
          cliente_id: createForm.cliente_id,
          fecha: createForm.fecha,
          observaciones: obs,
          presupuesto_id: createForm.presupuesto_id || null,
          estado: "pendiente",
          valor_declarado: createForm.valor_declarado ? Number(createForm.valor_declarado) : null,
          sociedad_id: sociedadActiva?.id || null,
          sucursal_id: sucursalId,
          created_by: profile?.id || null,
        }).select("id").single();

        if (error || !remitoData) {
          setCreateError("Error al crear remito: " + (error?.message || "sin datos"));
          return;
        }

        const remitoItems = groupItems.map((it, idx) => ({
          remito_id: remitoData.id,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          unidad: it.unidad || "UN",
          orden: it.orden ?? idx,
          presupuesto_item_id: it.presupuesto_item_id || null,
        }));
        const { error: itemsErr } = await (supabase as any).from("remito_items").insert(remitoItems);
        if (itemsErr) {
          console.error("Error inserting remito items:", itemsErr);
        }
        if (gi > 0) nextNum++;
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
    let iaQ = supabase
      .from("presupuestos")
      .select("id, numero, cliente_id, clientes(razon_social), presupuesto_items(id, descripcion, cantidad, unidad, orden)")
      .eq("estado", "aprobado");
    if (sociedadActiva?.id) iaQ = iaQ.eq("sociedad_id" as any, sociedadActiva.id);
    const { data } = await iaQ;
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
          fecha: todayAR(),
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
            unidad: item.unidad || "UN",
            orden: item.orden ?? idx,
            presupuesto_item_id: item.id || null,
          }));
          const { error: itemsErr } = await (supabase.from("remito_items") as any).insert(items);
          if (itemsErr) console.error("Error inserting remito items for PR", p.numero, itemsErr);
        }
        // Mark PR as remitido
        await supabase.from("presupuestos").update({ estado: "remitido" } as any).eq("id", p.id);
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


  async function openSplitModal() {
    if (!detailRemito) return;
    // Fetch sucursales for this client
    const { data: sucs } = await (supabase as any).from("cliente_sucursales")
      .select("id, nombre, direccion, localidad, provincia, cp")
      .eq("cliente_id", detailRemito.cliente_id)
      .eq("activo", true)
      .order("principal", { ascending: false });
    if (!sucs || sucs.length === 0) {
      alert("Este cliente no tiene sucursales cargadas. Cargá sucursales desde el módulo de Clientes.");
      return;
    }
    setSplitSucursales(sucs as Sucursal[]);
    setSplitItems(detailItems.map(it => ({ ...it, sucursal_id: "" })));
    // Crear asignación inicial: toda la cantidad en "Dir. principal"
    setSplitAssignments(detailItems.map(it => ({
      itemId: it.id,
      sucursal_id: "",
      cantidad: it.cantidad,
      descripcion: it.descripcion,
      unidad: it.unidad || "u",
      maxCantidad: it.cantidad,
      orden: it.orden,
      presupuesto_item_id: it.presupuesto_item_id || null,
    })));
    setSplitModalOpen(true);
  }

  async function handleSplitSave() {
    if (!detailRemito || splitAssignments.length === 0) return;

    // Validate: total assigned per item must not exceed original
    const itemTotals = new Map<string, number>();
    for (const a of splitAssignments) {
      itemTotals.set(a.itemId, (itemTotals.get(a.itemId) || 0) + a.cantidad);
    }
    for (const a of splitAssignments) {
      if ((itemTotals.get(a.itemId) || 0) > a.maxCantidad) {
        alert(`La suma de cantidades para "${a.descripcion}" supera el total original (${a.maxCantidad}).`);
        return;
      }
    }
    // Filter out zero-quantity assignments
    const validAssignments = splitAssignments.filter(a => a.cantidad > 0);

    // Group by sucursal
    const groups = new Map<string, typeof validAssignments>();
    for (const a of validAssignments) {
      const key = a.sucursal_id || "__none";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    }

    if (groups.size <= 1) {
      alert("Todos los items están asignados a la misma sucursal. Asigná al menos un item a una sucursal diferente.");
      return;
    }

    setSplittingSaving(true);
    try {
      const sortedKeys = [...groups.keys()].sort((a, b) => a === "__none" ? -1 : b === "__none" ? 1 : 0);
      const keepKey = sortedKeys[0];
      const keepAssignments = groups.get(keepKey)!;

      // Update original remito: set sucursal_id
      const keepSucursalId = keepKey === "__none" ? null : keepKey;
      await (supabase as any).from("remitos").update({ sucursal_id: keepSucursalId }).eq("id", detailRemito.id);

      // Delete ALL original items and re-insert the ones that stay (with possibly changed quantities)
      await supabase.from("remito_items").delete().eq("remito_id" as any, detailRemito.id);
      if (keepAssignments.length > 0) {
        const keepRows = keepAssignments.map((a) => ({
          remito_id: detailRemito.id,
          descripcion: a.descripcion,
          cantidad: a.cantidad,
          unidad: a.unidad || "UN",
          orden: a.orden,
          presupuesto_item_id: a.presupuesto_item_id || null,
        }));
        await (supabase as any).from("remito_items").insert(keepRows);
      }

      // Calculate next number
      let nextNum = remitos.reduce((max, r) => {
        const parts = r.numero?.split("-");
        const n = parts?.length === 3 ? parseInt(parts[2]) : 0;
        return n > max ? n : max;
      }, 0) + 1;

      // Create new remitos for remaining groups
      const createdRemitos: string[] = [];
      for (const [key, assignments] of groups) {
        if (key === keepKey) continue;
        const sucursalId = key === "__none" ? null : key;
        const sucNombre = splitSucursales.find(s => s.id === key)?.nombre || "";
        const numero = `R-0001-${String(nextNum).padStart(8, "0")}`;

        const { data: newRemito, error: rErr } = await (supabase.from("remitos") as any).insert({
          numero,
          cliente_id: detailRemito.cliente_id,
          fecha: detailRemito.fecha,
          observaciones: `Dividido de ${detailRemito.numero}${sucNombre ? ` — Suc: ${sucNombre}` : ""}`,
          presupuesto_id: detailRemito.presupuesto_id || null,
          estado: "pendiente",
          sociedad_id: sociedadActiva?.id || null,
          sucursal_id: sucursalId,
          valor_declarado: detailRemito.valor_declarado,
          created_by: profile?.id || null,
          remito_origen_id: detailRemito.id,
        }).select("id").single();

        if (rErr) { alert("Error al crear remito: " + rErr.message); return; }
        if (newRemito) {
          const newItems = assignments.map((a) => ({
            remito_id: newRemito.id,
            descripcion: a.descripcion,
            cantidad: a.cantidad,
            unidad: a.unidad || "UN",
            orden: a.orden,
            presupuesto_item_id: a.presupuesto_item_id || null,
          }));
          await (supabase as any).from("remito_items").insert(newItems);
          createdRemitos.push(numero);
        }
        nextNum++;
      }

      setSplitModalOpen(false);
      setDetailRemito(null);
      setPanelFullscreen(false);
      await fetchData();
      alert(`Remito dividido. Se crearon ${createdRemitos.length} remito(s) adicional(es): ${createdRemitos.join(", ")}`);
    } catch (err) {
      alert("Error al dividir remito: " + (err as Error).message);
    } finally {
      setSplittingSaving(false);
    }
  }

  async function handleRowClick(row: RemitoRow) {
    setDetailRemito(row);
    setDetailLoading(true);
    setDetailPRNumero(null);
    setDetailFacturas([]);
    setDetailTransportes([]);
    setDetailOC(null);
    setCreateTransporteOpen(false);
    try {
      const itemsPromise = (supabase as any)
        .from("remito_items")
        .select("id, descripcion, cantidad, unidad, orden, presupuesto_item_id")
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
      const ocPromise = row.presupuesto_id
        ? (supabase as any).from("ordenes_compra").select("id, numero").eq("presupuesto_origen_id", row.presupuesto_id).limit(1)
        : null;

      const [itemsRes, prRes, facturasRes, transportesRes, ocRes] = await Promise.all([
        itemsPromise,
        prPromise,
        facturasPromise,
        transportesPromise,
        ocPromise,
      ]);

      setDetailItems((itemsRes.data as unknown as RemitoDetailItem[]) || []);
      if (prRes?.data) {
        setDetailPRNumero((prRes.data as any).numero || null);
      }
      if (ocRes?.data && ocRes.data.length > 0) {
        setDetailOC({ id: ocRes.data[0].id, numero: ocRes.data[0].numero });
      }
      // Fetch sucursal from remito.sucursal_id (priority) or presupuesto.sucursal_id (legacy)
      const remitoSucId = (row as any).sucursal_id;
      const prSucId = prRes?.data ? (prRes.data as any).sucursal_id : null;
      const sucId = remitoSucId || prSucId;
      if (sucId) {
        const { data: sucData } = await (supabase as any).from("cliente_sucursales").select("nombre, direccion, localidad, provincia").eq("id", sucId).single();
        if (sucData) {
          const sucLabel = [sucData.nombre, sucData.direccion, sucData.localidad, sucData.provincia].filter(Boolean).join(", ");
          setDetailRemito((prev) => prev ? { ...prev, sucursal_nombre: sucData.nombre, sucursal_direccion: sucLabel } : prev);
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
      detailRemito.sucursal_nombre ? `Sucursal: ${detailRemito.sucursal_nombre}` : "",
      detailRemito.oc_cliente ? `OC Cliente: ${detailRemito.oc_cliente}` : "",
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

  function openPdfModal() {
    if (!detailRemito) return;
    setPdfValorDeclarado(String(detailRemito.valor_declarado ?? 0));
    setPdfModalOpen(true);
  }

  function handleDownloadPDF(overrideValorDeclarado?: number) {
    if (!detailRemito || !sociedadActiva) return;
    const r = detailRemito;
    const soc = getSociedadPDF(sociedadActiva);
    const html = generateRemitoPDF({
      numero: r.numero,
      fecha: r.fecha,
      cae: r.cae,
      oc_cliente: r.oc_cliente,
      valor_declarado: overrideValorDeclarado ?? r.valor_declarado,
      observaciones: r.observaciones,
      cliente: r.clientes ? {
        razon_social: r.clientes.razon_social,
        cuit: r.clientes.cuit,
        direccion: r.clientes.direccion,
      } : null,
      sucursal_nombre: r.sucursal_nombre,
      sucursal_direccion: r.sucursal_direccion,
      items: detailItems.map(it => ({
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidad,
      })),
      transportes: detailTransportes.map(t => ({
        transportista: t.transportista,
        destino: t.destino,
        costo: t.costo,
        moneda: t.moneda,
      })),
    }, soc);
    openPDFWindow(html);
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
              { key: "oc_cliente", label: "OC Cliente", sortable: false, render: (row) => row.oc_cliente ? <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{row.oc_cliente}</span> : <span className="text-zinc-400">{"\u2014"}</span> },
              { key: "presupuesto_id", label: "PR Origen", sortable: false, render: (row) => row.presupuesto_id ? <Badge variant="info">{row.presupuesto_numero || "Vinculado"}</Badge> : <span className="text-zinc-400">{"\u2014"}</span> },
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
                        <button onClick={() => openParcialModal(row)} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600" title="Entrega parcial">
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
        <>
          {panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setPanelFullscreen(false)} />
          )}
          {!panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => { setDetailRemito(null); setPanelFullscreen(false); }} />
          )}
          <div className={panelFullscreen
            ? "fixed inset-4 z-50 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl animate-slide-in-right"
            : "fixed right-0 top-0 z-50 h-full w-full overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right max-w-xl"
          }>
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
                <button onClick={openPdfModal} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title="Descargar PDF">
                  <Download className="h-3.5 w-3.5" /> PDF
                </button>
                <button onClick={() => setPanelFullscreen(!panelFullscreen)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Ampliar"}>
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button onClick={() => { setDetailRemito(null); setPanelFullscreen(false); }} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                {(detailRemito.estado === "pendiente" || detailRemito.estado === "parcial") && (
                  <button onClick={() => openParcialModal(detailRemito)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors">
                    <Package className="h-4 w-4" /> Entrega parcial
                  </button>
                )}
                {(detailRemito.estado === "pendiente" || detailRemito.estado === "parcial") && (
                  <button onClick={() => openSplitModal()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-500 text-white hover:bg-violet-600 transition-colors">
                    <GitBranch className="h-4 w-4" /> Dividir remito
                  </button>
                )}
                {(detailRemito.estado === "pendiente" || detailRemito.estado === "parcial") && (
                  <button onClick={() => { handleEstadoChange(detailRemito.id, "entregado"); setDetailRemito({ ...detailRemito, estado: "entregado" }); }} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                    <CheckCircle2 className="h-4 w-4" /> Marcar entregado
                  </button>
                )}
                {detailRemito.estado === "entregado" && (
                  <button onClick={() => { handleEstadoChange(detailRemito.id, "pendiente"); setDetailRemito({ ...detailRemito, estado: "pendiente" }); }} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                    <Package className="h-4 w-4" /> Desmarcar entregado
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
                {detailOC && (
                  <div>
                    <span className="text-zinc-400">OC vinculada</span>
                    <button
                      onClick={() => window.open(`/ordenes-compra`, "_self")}
                      className="flex items-center gap-1 mt-0.5"
                      title="Ir a órdenes de compra"
                    >
                      <Badge variant="purple">{detailOC.numero}</Badge>
                    </button>
                  </div>
                )}
                {detailRemito.sucursal_nombre && (
                  <div className="col-span-2">
                    <span className="text-zinc-400">Sucursal destino</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <MapPin className="h-3.5 w-3.5 text-violet-500" />
                      <p className="font-medium text-violet-600 dark:text-violet-400">{detailRemito.sucursal_nombre}</p>
                    </div>
                    {detailRemito.sucursal_direccion && (
                      <p className="text-xs text-zinc-500 mt-0.5">{detailRemito.sucursal_direccion}</p>
                    )}
                  </div>
                )}
                {detailRemito.oc_cliente && (
                  <div>
                    <span className="text-zinc-400">OC Cliente</span>
                    <p className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">{detailRemito.oc_cliente}</p>
                  </div>
                )}
                {detailRemito.cae ? (
                  <div>
                    <span className="text-zinc-400">CAE</span>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs dark:text-white">{detailRemito.cae}</p>
                      <CopyButton text={detailRemito.cae} />
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={handleAutorizarAFIP}
                      disabled={autorizandoAFIP}
                      className="flex items-center gap-2 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-xs font-medium disabled:opacity-50 transition-colors"
                    >
                      {autorizandoAFIP ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      {autorizandoAFIP ? "Autorizando..." : "Autorizar AFIP"}
                    </button>
                    {afipError && <p className="text-xs text-red-500 mt-1">{afipError}</p>}
                  </div>
                )}
                <div>
                  <span className="text-zinc-400">Valor declarado ($)</span>
                  <input
                    type="number"
                    value={detailRemito.valor_declarado ?? 0}
                    onChange={(e) => setDetailRemito({ ...detailRemito, valor_declarado: Number(e.target.value) })}
                    onBlur={async (e) => {
                      const val = Number(e.target.value) || 0;
                      await (supabase as any).from("remitos").update({ valor_declarado: val }).eq("id", detailRemito.id);
                    }}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-mono font-medium text-emerald-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-emerald-400"
                  />
                </div>
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
                          fecha: todayAR(),
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
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-400">{formatDate(t.fecha)}</span>
                              <button
                                onClick={async () => {
                                  if (!confirm("¿Eliminar este transporte?")) return;
                                  const { error } = await (supabase as any).from("transportes").delete().eq("id", t.id);
                                  if (error) { alert("Error al eliminar transporte"); return; }
                                  setDetailTransportes((prev) => prev.filter((tr) => tr.id !== t.id));
                                }}
                                className="p-1 rounded text-zinc-400 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/30 transition-colors"
                                title="Eliminar transporte"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
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

              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                <span className="text-xs text-zinc-400 block mb-1">Observaciones</span>
                <textarea
                  value={detailRemito.observaciones || ""}
                  onChange={(e) => setDetailRemito(prev => prev ? { ...prev, observaciones: e.target.value } : prev)}
                  onBlur={async (e) => {
                    const val = e.target.value;
                    const { error } = await supabase.from("remitos").update({ observaciones: val }).eq("id", detailRemito.id);
                    if (error) alert("Error al guardar observaciones: " + error.message);
                    else setRemitos(prev => prev.map(r => r.id === detailRemito.id ? { ...r, observaciones: val } : r));
                  }}
                  className="w-full bg-transparent text-sm dark:text-zinc-300 resize-none outline-none focus:ring-1 focus:ring-orange-400 rounded px-1 py-0.5 min-h-[2rem]"
                  rows={2}
                  placeholder="Agregar observaciones..."
                />
              </div>

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
        </>
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
                  onChange={async (e) => {
                    const clienteId = e.target.value;
                    setCreateForm((prev) => ({ ...prev, cliente_id: clienteId, presupuesto_id: "" }));
                    setCreateItems([]);
                    setClienteSucursales([]);
                    if (clienteId) {
                      const { data: sucs } = await (supabase as any).from("cliente_sucursales").select("id, nombre, direccion, localidad, provincia, cp").eq("cliente_id", clienteId).eq("activo", true).order("principal", { ascending: false });
                      if (sucs && sucs.length > 0) setClienteSucursales(sucs as Sucursal[]);
                    }
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
                          {clienteSucursales.length > 0 && <th className="text-left px-2 py-2 w-40">Sucursal</th>}
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
                            {clienteSucursales.length > 0 && (
                              <td className="px-2 py-1.5">
                                <select
                                  value={item.sucursal_id || ""}
                                  onChange={(e) => updateCreateItem(item.tempId, "sucursal_id" as any, e.target.value)}
                                  className="w-full rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                                >
                                  <option value="">Dir. principal</option>
                                  {clienteSucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                </select>
                              </td>
                            )}
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
                {creating ? "Creando..." : (() => {
                  const validCount = createItems.filter(i => i.descripcion.trim()).length;
                  if (clienteSucursales.length > 0) {
                    const sucGroups = new Set(createItems.filter(i => i.descripcion.trim()).map(i => i.sucursal_id || "__none"));
                    return sucGroups.size > 1 ? `Crear ${sucGroups.size} Remitos (${validCount} items)` : `Crear Remito (${validCount} items)`;
                  }
                  return `Crear Remito (${validCount} items)`;
                })()}
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

      {/* Split por Sucursal Modal */}
      {splitModalOpen && detailRemito && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold dark:text-white flex items-center gap-2">
                  <GitBranch className="h-5 w-5 text-violet-600" />
                  Dividir Remito
                </h2>
                <p className="text-sm text-zinc-400">
                  {detailRemito.numero} — {detailRemito.clientes?.razon_social || "—"}
                </p>
              </div>
              <button onClick={() => setSplitModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Asigná cantidades a cada sucursal. Podés dividir un mismo artículo en varias sucursales.
              Usá <strong>+ Agregar destino</strong> para enviar parte de un artículo a otra sucursal.
            </p>

            <div className="space-y-3">
              {detailItems.map((item) => {
                const itemAssignments = splitAssignments.filter(a => a.itemId === item.id);
                const totalAsignado = itemAssignments.reduce((s, a) => s + a.cantidad, 0);
                const excede = totalAsignado > item.cantidad;
                return (
                  <div key={item.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium dark:text-white">{item.descripcion}</span>
                        <span className="text-zinc-400 text-xs ml-2">({item.unidad || "u"})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono ${excede ? "text-red-500 font-bold" : "text-zinc-500"}`}>
                          {totalAsignado}/{item.cantidad}
                        </span>
                        <button
                          onClick={() => setSplitAssignments(prev => [...prev, {
                            itemId: item.id,
                            sucursal_id: splitSucursales[0]?.id || "",
                            cantidad: Math.max(0, item.cantidad - totalAsignado),
                            descripcion: item.descripcion,
                            unidad: item.unidad || "u",
                            maxCantidad: item.cantidad,
                            orden: item.orden,
                            presupuesto_item_id: item.presupuesto_item_id || null,
                          }])}
                          className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-0.5"
                        >
                          <Plus className="h-3 w-3" /> Agregar destino
                        </button>
                      </div>
                    </div>
                    {itemAssignments.map((assignment, aIdx) => {
                      const globalIdx = splitAssignments.findIndex(a => a === assignment);
                      return (
                        <div key={aIdx} className="flex items-center gap-2">
                          <select
                            value={assignment.sucursal_id}
                            onChange={(e) => setSplitAssignments(prev => prev.map((a, i) => i === globalIdx ? { ...a, sucursal_id: e.target.value } : a))}
                            className="flex-1 rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          >
                            <option value="">Dir. principal</option>
                            {splitSucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>
                          <input
                            type="number"
                            min={0}
                            max={item.cantidad}
                            value={assignment.cantidad}
                            onChange={(e) => setSplitAssignments(prev => prev.map((a, i) => i === globalIdx ? { ...a, cantidad: Number(e.target.value) } : a))}
                            className="w-24 rounded border border-zinc-200 px-2 py-1.5 text-sm font-mono text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          />
                          {itemAssignments.length > 1 && (
                            <button
                              onClick={() => setSplitAssignments(prev => prev.filter((_, i) => i !== globalIdx))}
                              className="text-zinc-400 hover:text-red-500 p-1"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {excede && (
                      <p className="text-xs text-red-500">La suma ({totalAsignado}) supera el total original ({item.cantidad})</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Preview of split result */}
            {(() => {
              const validA = splitAssignments.filter(a => a.cantidad > 0);
              const groups = new Map<string, { descripcion: string; cantidad: number; unidad: string }[]>();
              for (const a of validA) {
                const key = a.sucursal_id || "__none";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push({ descripcion: a.descripcion, cantidad: a.cantidad, unidad: a.unidad });
              }
              const entries = [...groups.entries()];
              return entries.length > 1 ? (
                <div className="rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 p-3 space-y-2">
                  <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
                    Se crearán {entries.length} remitos:
                  </p>
                  {entries.map(([key, items]) => {
                    const name = key === "__none" ? "Dir. principal" : splitSucursales.find(s => s.id === key)?.nombre || key;
                    return (
                      <div key={key} className="text-sm text-violet-600 dark:text-violet-400">
                        <div className="flex items-center gap-1.5 font-medium">
                          <MapPin className="h-3.5 w-3.5" />
                          {name}
                        </div>
                        <div className="ml-5 text-xs text-zinc-500 dark:text-zinc-400">
                          {items.map((it, i) => (
                            <span key={i}>{it.cantidad} {it.unidad} {it.descripcion}{i < items.length - 1 ? " · " : ""}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Asigná items a más de una sucursal para dividir el remito.
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setSplitModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleSplitSave}
                disabled={splittingSaving || new Set(splitAssignments.filter(a => a.cantidad > 0).map(a => a.sucursal_id || "__none")).size <= 1}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
              >
                {splittingSaving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Dividiendo...</>
                ) : (
                  <><GitBranch className="h-4 w-4" /> Confirmar división</>
                )}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Entrega Parcial Modal */}
      {parcialModalOpen && parcialRemito && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold dark:text-white">Entrega Parcial</h2>
                <p className="text-sm text-zinc-400">
                  Remito {parcialRemito.numero} — {parcialRemito.clientes?.razon_social || "—"}
                </p>
              </div>
              <button onClick={() => { setParcialModalOpen(false); setParcialRemito(null); }} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Ingresá la cantidad entregada de cada item. Se creará un nuevo remito con las cantidades pendientes.
            </p>

            {loadingParcial ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
              </div>
            ) : parcialItems.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-6">Este remito no tiene items cargados.</p>
            ) : (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500">
                      <th className="text-left px-3 py-2">Descripcion</th>
                      <th className="text-right px-3 py-2 w-24">Original</th>
                      <th className="text-center px-3 py-2 w-32">Entregada</th>
                      <th className="text-right px-3 py-2 w-24">Pendiente</th>
                      <th className="text-left px-3 py-2 w-16">Unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcialItems.map((item) => {
                      const pendiente = item.cantidad - item.cantidadEntregada;
                      return (
                        <tr key={item.id} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-3 py-2 dark:text-white">{item.descripcion}</td>
                          <td className="px-3 py-2 text-right text-zinc-500">{item.cantidad}</td>
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="number"
                              min="0"
                              max={item.cantidad}
                              step="1"
                              value={item.cantidadEntregada}
                              onChange={(e) => {
                                const val = Math.max(0, Math.min(item.cantidad, Number(e.target.value) || 0));
                                setParcialItems(prev => prev.map(it => it.id === item.id ? { ...it, cantidadEntregada: val } : it));
                              }}
                              className="w-full rounded border border-zinc-200 px-2 py-1 text-sm text-center dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                            />
                          </td>
                          <td className={`px-3 py-2 text-right font-medium ${pendiente > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {pendiente}
                          </td>
                          <td className="px-3 py-2 text-zinc-500">{item.unidad || "u"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {parcialItems.length > 0 && !loadingParcial && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 text-sm text-blue-700 dark:text-blue-300">
                {parcialItems.some(it => it.cantidadEntregada < it.cantidad) ? (
                  <p>Se actualizarán las cantidades del remito actual y se creará un nuevo remito con {parcialItems.filter(it => it.cantidadEntregada < it.cantidad).length} item(s) pendiente(s).</p>
                ) : (
                  <p>Todas las cantidades fueron entregadas. El remito se marcará como parcial sin crear saldo pendiente.</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setParcialModalOpen(false); setParcialRemito(null); }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveParcial}
                disabled={savingParcial || parcialItems.length === 0}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {savingParcial ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Guardando...
                  </>
                ) : (
                  <>
                    <Package className="h-4 w-4" /> Confirmar entrega parcial
                  </>
                )}
              </button>
            </div>
          </Card>
        </div>
      )}
      {/* PDF valor declarado modal */}
      {pdfModalOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setPdfModalOpen(false)} />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 space-y-4">
              <h3 className="text-lg font-semibold dark:text-white">Valor declarado para PDF</h3>
              <p className="text-sm text-zinc-500">Podés ajustar el valor declarado antes de generar el PDF.</p>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Valor declarado ($)</label>
                <input
                  type="number"
                  value={pdfValorDeclarado}
                  onChange={(e) => setPdfValorDeclarado(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPdfModalOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    setPdfModalOpen(false);
                    handleDownloadPDF(Number(pdfValorDeclarado) || 0);
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors"
                >
                  Generar PDF
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
