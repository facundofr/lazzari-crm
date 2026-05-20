"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { mockProducts } from "@/lib/mock-data";
import {
  Package, AlertTriangle, Search, Loader2, X, Pencil, Plus, Minus,
  Filter, ChevronDown,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface ProductRow {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  precio_costo: number;
  moneda_costo: string;
  unidad: string;
  iva: number;
  stock: number;
  stock_minimo: number;
  activo: boolean;
  proveedor_id: string | null;
  proveedores: { razon_social: string } | null;
}

const emptyForm = {
  codigo: "",
  nombre: "",
  categoria: "",
  precio_costo: 0,
  moneda_costo: "ARS",
  unidad: "un",
  iva: 21,
  stock: 0,
  stock_minimo: 0,
};

export default function StockPage() {
  const [search, setSearch] = useState("");
  const [productos, setProductos] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCategoria, setFilterCategoria] = useState("");
  const [filterStockBajo, setFilterStockBajo] = useState(false);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  // Stock adjustment modal
  const [adjustModal, setAdjustModal] = useState<ProductRow | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustMode, setAdjustMode] = useState<"add" | "set">("add");

  const fetchData = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("productos")
        .select(`*, proveedores(razon_social)`)
        .order("codigo");

      if (!error && data && data.length > 0) {
        setProductos(data as unknown as ProductRow[]);
      } else {
        setProductos(mockProducts.map((p) => ({
          id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria,
          precio_costo: p.precioCosto, moneda_costo: p.monedaCosto, unidad: p.unidad,
          iva: p.iva, stock: p.stock, stock_minimo: p.stockMinimo, activo: p.activo,
          proveedor_id: null, proveedores: { razon_social: p.proveedor },
        })));
      }
    } catch {
      setProductos(mockProducts.map((p) => ({
        id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria,
        precio_costo: p.precioCosto, moneda_costo: p.monedaCosto, unidad: p.unidad,
        iva: p.iva, stock: p.stock, stock_minimo: p.stockMinimo, activo: p.activo,
        proveedor_id: null, proveedores: { razon_social: p.proveedor },
      })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const categorias = [...new Set(productos.map((p) => p.categoria).filter(Boolean))] as string[];

  const filtered = productos.filter((p) => {
    const matchSearch =
      p.nombre.toLowerCase().includes(search.toLowerCase()) ||
      p.codigo.toLowerCase().includes(search.toLowerCase()) ||
      (p.categoria || "").toLowerCase().includes(search.toLowerCase());
    const matchCategoria = !filterCategoria || p.categoria === filterCategoria;
    const matchStockBajo = !filterStockBajo || p.stock < p.stock_minimo;
    return matchSearch && matchCategoria && matchStockBajo;
  });

  const stockBajo = productos.filter((p) => p.stock < p.stock_minimo);
  const valorStock = productos.reduce((acc, p) => acc + Number(p.precio_costo) * p.stock, 0);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(p: ProductRow) {
    setEditingId(p.id);
    setForm({
      codigo: p.codigo,
      nombre: p.nombre,
      categoria: p.categoria || "",
      precio_costo: Number(p.precio_costo),
      moneda_costo: p.moneda_costo,
      unidad: p.unidad,
      iva: p.iva,
      stock: p.stock,
      stock_minimo: p.stock_minimo,
    });
    setFormError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.codigo.trim() || !form.nombre.trim()) {
      setFormError("Codigo y nombre son obligatorios");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingId) {
        const { error } = await supabase.from("productos").update(form as any).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("productos").insert(form as any);
        if (error) throw error;
      }
      setModalOpen(false);
      await fetchData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleAdjust() {
    if (!adjustModal) return;
    setSaving(true);
    try {
      let newStock: number;
      if (adjustMode === "set") {
        newStock = adjustAmount;
      } else {
        newStock = Math.max(0, adjustModal.stock + adjustAmount);
      }
      const { error } = await supabase.from("productos").update({ stock: newStock }).eq("id", adjustModal.id);
      if (error) throw error;
      setAdjustModal(null);
      await fetchData();
    } catch (err) {
      console.error("Error adjusting stock:", err);
    } finally {
      setSaving(false);
    }
  }

  const hasFilters = filterCategoria || filterStockBajo;

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
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total articulos" value={String(productos.length)} icon={Package} iconColor="text-blue-600" />
          <StatCard title="Valor de stock" value={formatCurrency(valorStock)} icon={Package} iconColor="text-emerald-600" />
          <StatCard title="Stock bajo" value={String(stockBajo.length)} icon={AlertTriangle} iconColor="text-red-500" />
          <StatCard title="Categorias" value={String(categorias.length)} icon={Package} iconColor="text-violet-600" />
        </div>

        {stockBajo.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                {stockBajo.length} articulo(s) por debajo del stock minimo
              </span>
            </div>
            {stockBajo.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-white/60 p-2 text-sm dark:bg-zinc-900/60 mb-1">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{p.codigo} — {p.nombre}</span>
                <span className="text-red-600 font-mono">{p.stock}/{p.stock_minimo} {p.unidad}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por codigo, nombre o categoria..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium ${
                hasFilters ? "border-orange-300 bg-orange-50 text-orange-700" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <Filter className="h-4 w-4" /> Filtros <ChevronDown className="h-3 w-3" />
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Categoria</label>
                    <select value={filterCategoria} onChange={(e) => setFilterCategoria(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                      <option value="">Todas</option>
                      {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={filterStockBajo} onChange={(e) => setFilterStockBajo(e.target.checked)} className="rounded" />
                    Solo stock bajo
                  </label>
                  {hasFilters && (
                    <button onClick={() => { setFilterCategoria(""); setFilterStockBajo(false); }} className="w-full rounded-lg py-2 text-xs font-medium text-orange-500 hover:bg-orange-50">
                      Limpiar filtros
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <Card className="p-0 overflow-hidden">
          <DataTable<ProductRow>
            columns={[
              { key: "codigo", label: "Codigo", sortable: true, render: (row) => <span className="font-mono text-xs font-bold">{row.codigo}</span> },
              { key: "nombre", label: "Articulo", sortable: true, render: (row) => <span className="font-medium">{row.nombre}</span> },
              { key: "categoria", label: "Categoria", sortable: true, render: (row) => <Badge variant="outline">{row.categoria || "—"}</Badge> },
              { key: "proveedores", label: "Proveedor", sortable: false, render: (row) => <span className="text-zinc-500">{row.proveedores?.razon_social || "—"}</span> },
              { key: "precio_costo", label: "Costo", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(Number(row.precio_costo))} <span className="text-zinc-400 text-xs">{row.moneda_costo}</span></span> },
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
                    <button onClick={() => openEdit(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => { setAdjustModal(row); setAdjustAmount(0); setAdjustMode("add"); }} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600" title="Ajustar stock">
                      <Package className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              },
            ]}
            data={filtered}
          />
        </Card>
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
                <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Unidad</label>
                <select value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="un">Unidad</option>
                  <option value="kg">Kilogramo</option>
                  <option value="m">Metro</option>
                  <option value="m2">Metro²</option>
                  <option value="l">Litro</option>
                  <option value="rollo">Rollo</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Categoria</label>
                <input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} list="categorias-list" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                <datalist id="categorias-list">
                  {categorias.map((c) => <option key={c} value={c} />)}
                </datalist>
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
                <label className="text-xs font-medium text-zinc-500">Precio costo</label>
                <input type="number" value={form.precio_costo} onChange={(e) => setForm({ ...form, precio_costo: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Moneda</label>
                <select value={form.moneda_costo} onChange={(e) => setForm({ ...form, moneda_costo: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Stock actual</label>
                <input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Stock minimo</label>
                <input type="number" value={form.stock_minimo} onChange={(e) => setForm({ ...form, stock_minimo: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
            </div>
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
            <p className="text-sm text-zinc-500 mb-4">{adjustModal.codigo} — {adjustModal.nombre}</p>
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
    </>
  );
}
