"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { mockProducts } from "@/lib/mock-data";
import { Package, AlertTriangle, Search, Upload, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

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
  proveedores: { razon_social: string } | null;
}

export default function StockPage() {
  const [search, setSearch] = useState("");
  const [productos, setProductos] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
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
            proveedores: { razon_social: p.proveedor },
          })));
        }
      } catch {
        setProductos(mockProducts.map((p) => ({
          id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria,
          precio_costo: p.precioCosto, moneda_costo: p.monedaCosto, unidad: p.unidad,
          iva: p.iva, stock: p.stock, stock_minimo: p.stockMinimo, activo: p.activo,
          proveedores: { razon_social: p.proveedor },
        })));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const filtered = productos.filter(
    (p) =>
      p.nombre.toLowerCase().includes(search.toLowerCase()) ||
      p.codigo.toLowerCase().includes(search.toLowerCase()) ||
      (p.categoria || "").toLowerCase().includes(search.toLowerCase())
  );

  const stockBajo = productos.filter((p) => p.stock < p.stock_minimo);
  const valorStock = productos.reduce((acc, p) => acc + Number(p.precio_costo) * p.stock, 0);

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
        subtitle="Control de inventario y artículos"
        action={{ label: "Nuevo artículo", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total artículos" value={String(productos.length)} icon={Package} iconColor="text-blue-600" />
          <StatCard title="Valor de stock" value={formatCurrency(valorStock)} icon={Package} iconColor="text-emerald-600" />
          <StatCard title="Stock bajo" value={String(stockBajo.length)} icon={AlertTriangle} iconColor="text-red-500" />
          <StatCard title="Categorías" value={String(new Set(productos.map((p) => p.categoria)).size)} icon={Package} iconColor="text-violet-600" />
        </div>

        {stockBajo.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                {stockBajo.length} artículo(s) por debajo del stock mínimo
              </span>
            </div>
            {stockBajo.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-white/60 p-2 text-sm dark:bg-zinc-900/60">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{p.codigo} — {p.nombre}</span>
                <span className="text-red-600 font-mono">{p.stock}/{p.stock_minimo} un.</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por código, nombre o categoría..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <button className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
            <Upload className="h-4 w-4" /> Importar FC compra
          </button>
        </div>

        <Card className="p-0 overflow-hidden">
          <DataTable<ProductRow>
            columns={[
              {
                key: "codigo", label: "Código",
                render: (row) => <span className="font-mono text-xs font-bold">{row.codigo}</span>,
              },
              { key: "nombre", label: "Artículo", render: (row) => <span className="font-medium">{row.nombre}</span> },
              { key: "categoria", label: "Categoría", render: (row) => <Badge variant="outline">{row.categoria || "—"}</Badge> },
              { key: "proveedores", label: "Proveedor", render: (row) => <span className="text-zinc-500">{row.proveedores?.razon_social || "—"}</span> },
              { key: "precio_costo", label: "Costo", className: "text-right", render: (row) => <span className="font-mono block text-right">{formatCurrency(Number(row.precio_costo))}</span> },
              {
                key: "stock", label: "Stock", className: "text-right",
                render: (row) => {
                  const isLow = row.stock < row.stock_minimo;
                  return (
                    <div className="text-right">
                      <span className={`font-mono ${isLow ? "text-red-600 font-bold" : ""}`}>
                        {row.stock}
                      </span>
                      <span className="text-zinc-400"> / {row.stock_minimo}</span>
                    </div>
                  );
                },
              },
              { key: "unidad", label: "Un.", render: (row) => <span className="text-zinc-400">{row.unidad}</span> },
            ]}
            data={filtered}
          />
        </Card>
      </div>
    </>
  );
}
