"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { mockProducts } from "@/lib/mock-data";
import {
  Package, AlertTriangle, Search, Loader2, X, Pencil, Plus, Minus,
  History, Trash2, Eye, ChevronRight,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";

interface ProveedorOption {
  id: string;
  razon_social: string;
}

interface ProductRow {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  marca: string | null;
  precio_costo: number;
  moneda_costo: string;
  unidad: string;
  iva: number;
  stock: number;
  stock_minimo: number;
  activo: boolean;
  proveedor_id: string | null;
  proveedores: { razon_social: string } | null;
  created_at: string | null;
  updated_at: string | null;
}

interface PrecioHistorialRow {
  id: string;
  entity_type: string;
  entity_id: string;
  precio_anterior: number | null;
  precio_nuevo: number;
  moneda: string | null;
  changed_by: string | null;
  created_at: string;
  profiles: { full_name: string } | null;
}

const CATEGORIAS = ["Valvulas", "Canos", "Accesorios", "Instrumentacion", "Bombas", "Otros"];
const UNIDADES = [
  { value: "un", label: "Unidad" },
  { value: "kg", label: "Kg" },
  { value: "m", label: "Metro" },
  { value: "l", label: "Litro" },
  { value: "juego", label: "Juego" },
  { value: "m2", label: "Metro\u00B2" },
  { value: "rollo", label: "Rollo" },
];

const emptyForm = {
  codigo: "",
  nombre: "",
  categoria: "",
  marca: "",
  proveedor_id: "",
  precio_costo: 0,
  moneda_costo: "ARS",
  unidad: "un",
  iva: 21,
  stock: 0,
  stock_minimo: 0,
};

export default function StockPage() {
  const { sociedadActiva } = useUser();
  const [search, setSearch] = useState("");
  const [productos, setProductos] = useState<ProductRow[]>([]);
  const [proveedoresList, setProveedoresList] = useState<ProveedorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters (legacy)
  const [filterStockBajo, setFilterStockBajo] = useState(false);

  // SmartFilters
  const [smartFilterValues, setSmartFilterValues] = useState<FilterValues>({
    fecha: { from: "", to: "" },
    moneda: "",
    precio: {},
    proveedor: "",
    categoria: "",
  });

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  // Detail panel
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<ProductRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Stock adjustment modal
  const [adjustModal, setAdjustModal] = useState<ProductRow | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustMode, setAdjustMode] = useState<"add" | "set">("add");

  // Proveedor search
  const [provSearchText, setProvSearchText] = useState("");
  const [showProvDropdown, setShowProvDropdown] = useState(false);

  // Price history
  const [precioHistorial, setPrecioHistorial] = useState<PrecioHistorialRow[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      let q = supabase
        .from("productos")
        .select(`*, proveedores(razon_social)`)
        .neq("activo" as any, false)
        .order("codigo");
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data, error } = await q;

      if (!error && data) {
        setProductos(data as unknown as ProductRow[]);
      } else if (error) {
        setProductos(mockProducts.map((p) => ({
          id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria,
          marca: null,
          precio_costo: p.precioCosto, moneda_costo: p.monedaCosto, unidad: p.unidad,
          iva: p.iva, stock: p.stock, stock_minimo: p.stockMinimo, activo: p.activo,
          proveedor_id: null, proveedores: { razon_social: p.proveedor },
          created_at: null, updated_at: null,
        })));
      }
    } catch {
      setProductos(mockProducts.map((p) => ({
        id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria,
        marca: null,
        precio_costo: p.precioCosto, moneda_costo: p.monedaCosto, unidad: p.unidad,
        iva: p.iva, stock: p.stock, stock_minimo: p.stockMinimo, activo: p.activo,
        proveedor_id: null, proveedores: { razon_social: p.proveedor },
        created_at: null, updated_at: null,
      })));
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva?.id]);

  const fetchProveedores = useCallback(async () => {
    try {
      let q = supabase
        .from("proveedores")
        .select("id, razon_social")
        .order("razon_social");
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data, error } = await q;
      if (!error && data) {
        setProveedoresList(data as ProveedorOption[]);
      }
    } catch {
      // silently ignore
    }
  }, [sociedadActiva?.id]);

  useEffect(() => { fetchData(); fetchProveedores(); }, [fetchData, fetchProveedores]);

  const categorias = useMemo(() => {
    const fromDb = productos.map((p) => p.categoria).filter(Boolean) as string[];
    const merged = [...new Set([...CATEGORIAS, ...fromDb])];
    return merged.sort();
  }, [productos]);

  const proveedorFilterOptions = useMemo(() => {
    return proveedoresList.map((p) => ({ value: p.razon_social, label: p.razon_social }));
  }, [proveedoresList]);

  const categoriaFilterOptions = useMemo(() => {
    return categorias.map((c) => ({ value: c, label: c }));
  }, [categorias]);

  const smartFilterConfigs: FilterConfig[] = useMemo(() => [
    { key: "fecha", label: "Fecha actualizacion", type: "date-range" },
    {
      key: "moneda", label: "Moneda", type: "select",
      options: [{ value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }],
    },
    { key: "precio", label: "Precio costo", type: "number-range" },
    { key: "proveedor", label: "Proveedor", type: "select", options: proveedorFilterOptions },
    { key: "categoria", label: "Categoria", type: "select", options: categoriaFilterOptions },
  ], [proveedorFilterOptions, categoriaFilterOptions]);

  const filtered = productos.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      p.nombre.toLowerCase().includes(q) ||
      p.codigo.toLowerCase().includes(q) ||
      (p.categoria || "").toLowerCase().includes(q) ||
      (p.marca || "").toLowerCase().includes(q) ||
      (p.proveedores?.razon_social || "").toLowerCase().includes(q);
    const matchStockBajo = !filterStockBajo || p.stock < p.stock_minimo;

    // SmartFilter: fecha (date-range on updated_at)
    const fechaFilter = smartFilterValues.fecha as { from?: string; to?: string } | undefined;
    let matchFecha = true;
    if (fechaFilter?.from && p.updated_at) {
      matchFecha = p.updated_at >= fechaFilter.from;
    }
    if (matchFecha && fechaFilter?.to && p.updated_at) {
      matchFecha = p.updated_at <= fechaFilter.to + "T23:59:59";
    }

    // SmartFilter: moneda
    const monedaFilter = smartFilterValues.moneda as string;
    const matchMoneda = !monedaFilter || p.moneda_costo === monedaFilter;

    // SmartFilter: precio (number-range on precio_costo)
    const precioFilter = smartFilterValues.precio as { min?: number; max?: number } | undefined;
    let matchPrecio = true;
    if (precioFilter?.min !== undefined) {
      matchPrecio = Number(p.precio_costo) >= precioFilter.min;
    }
    if (matchPrecio && precioFilter?.max !== undefined) {
      matchPrecio = Number(p.precio_costo) <= precioFilter.max;
    }

    // SmartFilter: proveedor
    const proveedorFilter = smartFilterValues.proveedor as string;
    const matchProveedor = !proveedorFilter || p.proveedores?.razon_social === proveedorFilter;

    // SmartFilter: categoria
    const categoriaFilter = smartFilterValues.categoria as string;
    const matchCategoria = !categoriaFilter || p.categoria === categoriaFilter;

    return matchSearch && matchStockBajo && matchFecha && matchMoneda && matchPrecio && matchProveedor && matchCategoria;
  });

  const stockBajo = productos.filter((p) => p.stock < p.stock_minimo);
  const valorStockByMoneda = productos.reduce((acc, p) => {
    const mon = p.moneda_costo || "ARS";
    acc[mon] = (acc[mon] || 0) + Number(p.precio_costo) * p.stock;
    return acc;
  }, {} as Record<string, number>);
  const monedas = Object.keys(valorStockByMoneda);
  const valorStockLabel = monedas.length <= 1
    ? formatCurrency(valorStockByMoneda[monedas[0] || "ARS"] || 0, (monedas[0] || "ARS") as "USD" | "ARS")
    : monedas.map(m => formatCurrency(valorStockByMoneda[m], m as "USD" | "ARS")).join(" + ");

  // Fetch price history when a product is selected for adjustment
  const fetchPrecioHistorial = useCallback(async (productId: string) => {
    setLoadingHistorial(true);
    setPrecioHistorial([]);
    try {
      const { data, error } = await (supabase as any)
        .from("precio_historial")
        .select("*, profiles:changed_by(full_name)")
        .eq("entity_type", "producto")
        .eq("entity_id", productId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!error && data) {
        setPrecioHistorial(data as unknown as PrecioHistorialRow[]);
      }
    } catch {
      // Table may not exist yet -- silently ignore
    } finally {
      setLoadingHistorial(false);
    }
  }, []);

  // Trigger fetch when adjustModal or editingId changes
  useEffect(() => {
    if (adjustModal) {
      fetchPrecioHistorial(adjustModal.id);
    } else {
      setPrecioHistorial([]);
    }
  }, [adjustModal, fetchPrecioHistorial]);

  useEffect(() => {
    if (editingId) {
      fetchPrecioHistorial(editingId);
    } else {
      setPrecioHistorial([]);
    }
  }, [editingId, fetchPrecioHistorial]);

  // Fetch price history for detail panel
  useEffect(() => {
    if (selectedProduct && !adjustModal && !editingId) {
      fetchPrecioHistorial(selectedProduct.id);
    }
  }, [selectedProduct?.id, adjustModal, editingId, fetchPrecioHistorial]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setProvSearchText("");
    setShowProvDropdown(false);
    setModalOpen(true);
    setSelectedProduct(null);
  }

  function openEdit(p: ProductRow) {
    setEditingId(p.id);
    setForm({
      codigo: p.codigo,
      nombre: p.nombre,
      categoria: p.categoria || "",
      marca: p.marca || "",
      proveedor_id: p.proveedor_id || "",
      precio_costo: Number(p.precio_costo),
      moneda_costo: p.moneda_costo,
      unidad: p.unidad,
      iva: p.iva,
      stock: p.stock,
      stock_minimo: p.stock_minimo,
    });
    setProvSearchText(p.proveedores?.razon_social || "");
    setShowProvDropdown(false);
    setFormError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.codigo.trim() || !form.nombre.trim()) {
      setFormError("Codigo y nombre son obligatorios");
      return;
    }
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      setFormError("Seleccioná una sociedad antes de guardar el artículo");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload: Record<string, unknown> = {
        codigo: form.codigo.trim(),
        nombre: form.nombre.trim(),
        categoria: form.categoria || null,
        marca: form.marca || null,
        proveedor_id: form.proveedor_id || null,
        precio_costo: form.precio_costo,
        moneda_costo: form.moneda_costo,
        unidad: form.unidad,
        iva: form.iva,
        stock: form.stock,
        stock_minimo: form.stock_minimo,
      };

      payload.sociedad_id = sociedadId;

      if (editingId) {
        let productUpdate = (supabase as any).from("productos").update(payload).eq("id", editingId);
        productUpdate = productUpdate.eq("sociedad_id", sociedadId);
        const { error } = await productUpdate;
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("productos").insert(payload);
        if (error) throw error;
      }
      setModalOpen(false);
      await fetchData();
      // If editing, update the detail panel too
      if (editingId && selectedProduct?.id === editingId) {
        const updated = productos.find((p) => p.id === editingId);
        if (updated) setSelectedProduct(updated);
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      alert("Seleccioná una sociedad antes de eliminar un artículo");
      return;
    }
    setDeleting(true);
    try {
      let productDelete = supabase.from("productos").delete().eq("id", deleteConfirm.id);
      productDelete = productDelete.eq("sociedad_id" as any, sociedadId);
      const { error } = await productDelete;
      if (error) throw error;
      setDeleteConfirm(null);
      if (selectedProduct?.id === deleteConfirm.id) setSelectedProduct(null);
      await fetchData();
    } catch (err) {
      console.error("Error deleting product:", err);
      alert("Error al eliminar producto: " + (err as any)?.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleAdjust() {
    if (!adjustModal) return;
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      alert("Seleccioná una sociedad antes de ajustar el stock");
      return;
    }
    setSaving(true);
    try {
      if (adjustMode === "set") {
        if (adjustAmount < 0) {
          alert("El stock no puede ser negativo.");
          setSaving(false);
          return;
        }
        let stockUpdate = supabase.from("productos").update({ stock: adjustAmount }).eq("id", adjustModal.id);
        stockUpdate = stockUpdate.eq("sociedad_id" as any, sociedadId);
        const { error } = await stockUpdate;
        if (error) throw error;
      } else {
        // Atomic increment via RPC — no read-then-write race condition
        const { error } = await supabase.rpc("increment_stock" as any, { producto_id: adjustModal.id, cantidad: adjustAmount });
        if (error) throw error;
      }
      setAdjustModal(null);
      await fetchData();
    } catch (err) {
      console.error("Error adjusting stock:", err);
      alert("Error al ajustar stock: " + (err as any)?.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <Header title="Stock" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Stock"
        subtitle="Control de inventario y articulos"
        action={{ label: "Nuevo articulo", onClick: openCreate }}
      />
      <div className="p-3 sm:p-4 space-y-2.5">
        {/* Números rápidos en una línea */}
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-zinc-500">Total articulos</span> <b className="font-mono">{productos.length}</b></span>
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-zinc-500">Valor de stock</span> <b className="font-mono">{valorStockLabel}</b></span>
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-zinc-500">Stock bajo</span> <b className={`font-mono ${stockBajo.length > 0 ? "text-red-600" : ""}`}>{stockBajo.length}</b></span>
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-zinc-500">Categorias</span> <b className="font-mono">{categorias.length}</b></span>
        </div>

        {stockBajo.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                {stockBajo.length} articulo(s) por debajo del stock minimo
              </span>
            </div>
            {stockBajo.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-white/60 px-2 py-1 text-sm dark:bg-zinc-900/60 mb-1">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{p.codigo} -- {p.nombre}</span>
                <span className="text-red-600 font-mono">{p.stock}/{p.stock_minimo} {p.unidad}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por codigo, nombre, marca o proveedor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={filterStockBajo} onChange={(e) => setFilterStockBajo(e.target.checked)} className="rounded" />
            Solo stock bajo
          </label>
        </div>

        <SmartFilters
          filters={smartFilterConfigs}
          values={smartFilterValues}
          onChange={setSmartFilterValues}
        />

        <div className="flex gap-3">
          <div className={`flex-1 min-w-0 transition-all ${selectedProduct ? "max-w-[calc(100%-400px)]" : ""}`}>
            <Card className="p-0 overflow-hidden">
              <DataTable<ProductRow>
                columns={[
                  { key: "codigo", label: "Codigo", sortable: true, render: (row) => <span className="font-mono text-xs font-bold">{row.codigo}</span> },
                  { key: "nombre", label: "Articulo", sortable: true, render: (row) => (
                    <div>
                      <span className="font-medium">{row.nombre}</span>
                      {row.marca && <span className="block text-xs text-zinc-400">{row.marca}</span>}
                    </div>
                  )},
                  { key: "categoria", label: "Categoria", sortable: true, render: (row) => <Badge variant="outline">{row.categoria || "\u2014"}</Badge> },
                  { key: "proveedores", label: "Proveedor", sortable: false, render: (row) => <span className="text-zinc-500">{row.proveedores?.razon_social || "\u2014"}</span> },
                  { key: "precio_costo", label: "Costo", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(Number(row.precio_costo), row.moneda_costo as "ARS" | "USD")}</span> },
                  {
                    key: "stock", label: "Stock", className: "text-right", sortable: true,
                    render: (row) => {
                      const isLow = row.stock < row.stock_minimo;
                      return (
                        <div className="text-right">
                          <span className={`font-mono ${isLow ? "text-red-600 font-bold" : ""}`}>{row.stock}</span>
                          <span className="text-zinc-400"> / {row.stock_minimo}</span>
                        </div>
                      );
                    },
                  },
                  { key: "unidad", label: "Un.", sortable: false, render: (row) => <span className="text-zinc-400">{row.unidad}</span> },
                  {
                    key: "actions", label: "", sortable: false,
                    render: (row) => (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setSelectedProduct(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Ver detalle">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => openEdit(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => { setAdjustModal(row); setAdjustAmount(0); setAdjustMode("add"); }} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30" title="Ajustar stock">
                          <Package className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setDeleteConfirm(row)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30" title="Eliminar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ),
                  },
                ]}
                data={filtered}
                onRowClick={(row) => setSelectedProduct(row)}
              />
            </Card>
          </div>

          {/* Detail Side Panel */}
          {selectedProduct && (
            <div className="w-[400px] flex-shrink-0">
              <Card className="sticky top-4 p-0 overflow-hidden">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 px-3 py-2">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Detalle del articulo</h3>
                  <button onClick={() => setSelectedProduct(null)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-3 space-y-3">
                  {/* Header info */}
                  <div>
                    <span className="font-mono text-xs text-zinc-400">{selectedProduct.codigo}</span>
                    <h4 className="text-lg font-bold text-zinc-900 dark:text-white mt-1">{selectedProduct.nombre}</h4>
                    {selectedProduct.marca && (
                      <span className="text-sm text-zinc-500">Marca: {selectedProduct.marca}</span>
                    )}
                  </div>

                  {/* Status badges */}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{selectedProduct.categoria || "Sin categoria"}</Badge>
                    {selectedProduct.stock < selectedProduct.stock_minimo && (
                      <Badge variant="danger">Stock bajo</Badge>
                    )}
                    {selectedProduct.activo ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="outline">Inactivo</Badge>
                    )}
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2">
                      <span className="text-xs text-zinc-500 block">Precio costo</span>
                      <span className="font-mono font-bold text-zinc-900 dark:text-white">
                        {formatCurrency(Number(selectedProduct.precio_costo), selectedProduct.moneda_costo as "ARS" | "USD")}
                      </span>
                    </div>
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2">
                      <span className="text-xs text-zinc-500 block">IVA</span>
                      <span className="font-mono font-bold text-zinc-900 dark:text-white">{selectedProduct.iva}%</span>
                    </div>
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2">
                      <span className="text-xs text-zinc-500 block">Stock actual</span>
                      <span className={`font-mono font-bold ${selectedProduct.stock < selectedProduct.stock_minimo ? "text-red-600" : "text-zinc-900 dark:text-white"}`}>
                        {selectedProduct.stock}
                      </span>
                      <span className="text-zinc-400 text-xs ml-1">{selectedProduct.unidad}</span>
                    </div>
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2">
                      <span className="text-xs text-zinc-500 block">Stock minimo</span>
                      <span className="font-mono font-bold text-zinc-900 dark:text-white">{selectedProduct.stock_minimo}</span>
                      <span className="text-zinc-400 text-xs ml-1">{selectedProduct.unidad}</span>
                    </div>
                  </div>

                  {/* Proveedor */}
                  <div className="text-sm">
                    <span className="text-xs text-zinc-500 block mb-1">Proveedor</span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {selectedProduct.proveedores?.razon_social || "Sin proveedor asignado"}
                    </span>
                  </div>

                  {/* Price history */}
                  {loadingHistorial && (
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> Cargando historial...
                    </div>
                  )}
                  {precioHistorial.length > 0 && (
                    <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
                      <div className="flex items-center gap-2 mb-2">
                        <History className="h-3.5 w-3.5 text-zinc-400" />
                        <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Historial de precios</h4>
                      </div>
                      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 max-h-40 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800">
                              <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Fecha</th>
                              <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Anterior</th>
                              <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Nuevo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {precioHistorial.map((h) => (
                              <tr key={h.id} className="border-t border-zinc-100 dark:border-zinc-800">
                                <td className="px-2 py-1 text-zinc-600 dark:text-zinc-400">
                                  {new Date(h.created_at).toLocaleDateString("es-AR")}
                                </td>
                                <td className="px-2 py-1 text-right font-mono text-zinc-500">
                                  {h.precio_anterior != null ? formatCurrency(h.precio_anterior) : "\u2014"}
                                </td>
                                <td className="px-2 py-1 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300">
                                  {formatCurrency(h.precio_nuevo)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                    <button
                      onClick={() => openEdit(selectedProduct)}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </button>
                    <button
                      onClick={() => { setAdjustModal(selectedProduct); setAdjustAmount(0); setAdjustMode("add"); }}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <Package className="h-3.5 w-3.5" /> Ajustar
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(selectedProduct)}
                      className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold dark:text-white">{editingId ? "Editar articulo" : "Nuevo articulo"}</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {formError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{formError}</div>}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-zinc-500">Codigo *</label>
                <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="Ej: VLV-001" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Unidad</label>
                <select value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  {UNIDADES.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Nombre / Descripcion *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Marca</label>
                <input value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Categoria</label>
                <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="">Seleccionar...</option>
                  {categorias.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 relative">
                <label className="text-xs font-medium text-zinc-500">Proveedor</label>
                <input
                  type="text"
                  value={provSearchText}
                  onChange={(e) => { setProvSearchText(e.target.value); setShowProvDropdown(true); }}
                  onFocus={() => setShowProvDropdown(true)}
                  onBlur={() => setTimeout(() => setShowProvDropdown(false), 150)}
                  placeholder="Buscar proveedor..."
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
                {form.proveedor_id && (
                  <button type="button" onClick={() => { setForm({ ...form, proveedor_id: "" }); setProvSearchText(""); }} className="absolute right-2 top-7 text-zinc-400 hover:text-zinc-600">
                    <X className="h-4 w-4" />
                  </button>
                )}
                {showProvDropdown && (
                  <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    {proveedoresList.filter(p => p.razon_social.toLowerCase().includes(provSearchText.toLowerCase())).slice(0, 20).map((prov) => (
                      <button key={prov.id} type="button" onClick={() => { setForm({ ...form, proveedor_id: prov.id }); setProvSearchText(prov.razon_social); setShowProvDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 dark:hover:bg-zinc-700">
                        {prov.razon_social}
                      </button>
                    ))}
                    {proveedoresList.filter(p => p.razon_social.toLowerCase().includes(provSearchText.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2 text-sm text-zinc-400">Sin resultados</div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Precio costo</label>
                <input type="number" step="0.01" min="0" value={form.precio_costo} onChange={(e) => setForm({ ...form, precio_costo: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Moneda</label>
                <select value={form.moneda_costo} onChange={(e) => setForm({ ...form, moneda_costo: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">IVA %</label>
                <select value={form.iva} onChange={(e) => setForm({ ...form, iva: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value={21}>21%</option>
                  <option value={10.5}>10.5%</option>
                  <option value={27}>27%</option>
                  <option value={0}>Exento</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Stock actual</label>
                <input type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Stock minimo (alerta de reposicion)</label>
                <input type="number" min="0" value={form.stock_minimo} onChange={(e) => setForm({ ...form, stock_minimo: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
            </div>
            {/* Historial de precios */}
            {editingId && precioHistorial.length > 0 && (
              <div className="mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-2 mb-3">
                  <History className="h-4 w-4 text-zinc-400" />
                  <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Historial de precios</h4>
                </div>
                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800">
                        <th className="px-3 py-2 text-left font-medium text-zinc-500">Fecha</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-500">Anterior</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-500">Nuevo</th>
                        <th className="px-3 py-2 text-left font-medium text-zinc-500">Quien</th>
                      </tr>
                    </thead>
                    <tbody>
                      {precioHistorial.map((h) => (
                        <tr key={h.id} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">
                            {new Date(h.created_at).toLocaleDateString("es-AR")}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-zinc-500">
                            {h.precio_anterior != null ? formatCurrency(h.precio_anterior) : "\u2014"}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300">
                            {formatCurrency(h.precio_nuevo)}
                          </td>
                          <td className="px-3 py-1.5 text-zinc-500 dark:text-zinc-400">
                            {h.profiles?.full_name || "\u2014"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {editingId && loadingHistorial && (
              <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Cargando historial...
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Stock Adjustment Modal */}
      {adjustModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setAdjustModal(null)} />
          <div className="fixed inset-4 z-50 m-auto h-fit w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <h3 className="text-lg font-bold mb-1 dark:text-white">Ajustar stock</h3>
            <p className="text-sm text-zinc-500 mb-4">{adjustModal.codigo} -- {adjustModal.nombre}</p>
            <p className="text-sm mb-4">Stock actual: <span className="font-mono font-bold">{adjustModal.stock} {adjustModal.unidad}</span></p>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setAdjustMode("add")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${adjustMode === "add" ? "bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
              >
                <Plus className="h-3 w-3 inline mr-1" /> Sumar/Restar
              </button>
              <button
                onClick={() => setAdjustMode("set")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${adjustMode === "set" ? "bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
              >
                Fijar cantidad
              </button>
            </div>

            <div className="flex items-center gap-3">
              {adjustMode === "add" && (
                <button onClick={() => setAdjustAmount((a) => a - 1)} className="rounded-lg border border-zinc-200 p-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  <Minus className="h-4 w-4" />
                </button>
              )}
              <input
                type="number"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(Number(e.target.value))}
                className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-center text-lg font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
              {adjustMode === "add" && (
                <button onClick={() => setAdjustAmount((a) => a + 1)} className="rounded-lg border border-zinc-200 p-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            {adjustMode === "add" && adjustAmount !== 0 && (
              <p className="text-center text-sm text-zinc-500 mt-2">
                Resultado: <span className="font-mono font-bold">{Math.max(0, adjustModal.stock + adjustAmount)}</span> {adjustModal.unidad}
              </p>
            )}

            {/* Historial de precios in adjust modal */}
            {precioHistorial.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-2 mb-2">
                  <History className="h-3.5 w-3.5 text-zinc-400" />
                  <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Historial de precios</h4>
                </div>
                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 max-h-40 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800">
                        <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Fecha</th>
                        <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Anterior</th>
                        <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Nuevo</th>
                        <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Quien</th>
                      </tr>
                    </thead>
                    <tbody>
                      {precioHistorial.map((h) => (
                        <tr key={h.id} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-2 py-1 text-zinc-600 dark:text-zinc-400">
                            {new Date(h.created_at).toLocaleDateString("es-AR")}
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-zinc-500">
                            {h.precio_anterior != null ? formatCurrency(h.precio_anterior) : "\u2014"}
                          </td>
                          <td className="px-2 py-1 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300">
                            {formatCurrency(h.precio_nuevo)}
                          </td>
                          <td className="px-2 py-1 text-zinc-500 dark:text-zinc-400">
                            {h.profiles?.full_name || "\u2014"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {loadingHistorial && (
              <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Cargando historial...
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200">
              <button onClick={() => setAdjustModal(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleAdjust} disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed inset-4 z-50 m-auto h-fit w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold dark:text-white">Eliminar articulo</h3>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
              Estas seguro que deseas eliminar el articulo?
            </p>
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3 mb-4">
              <p className="font-mono text-xs text-zinc-400">{deleteConfirm.codigo}</p>
              <p className="font-medium text-zinc-900 dark:text-white">{deleteConfirm.nombre}</p>
              {deleteConfirm.marca && <p className="text-xs text-zinc-500">{deleteConfirm.marca}</p>}
            </div>
            <p className="text-xs text-red-600 dark:text-red-400 mb-4">
              Esta accion no se puede deshacer. Se eliminara el articulo y todo su historial asociado.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={deleting} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
