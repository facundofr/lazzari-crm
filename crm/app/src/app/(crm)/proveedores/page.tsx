"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { formatCurrency } from "@/lib/utils";
import { mockProveedores, mockListasPrecios } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase/client";
import type { Proveedor, ListaPrecios, ListaPreciosItem } from "@/lib/types";
import {
  Search, Filter, Download, MapPin, Phone, Mail, ListOrdered, Upload,
  AlertTriangle, ChevronDown, ChevronRight, Loader2, X, Pencil, Tag,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

const CLASIFICACION_TAGS = [
  "Buen precio", "Precio alto", "Entrega rapida", "Entrega lenta",
  "Buena calidad", "Stock permanente", "Importador", "Nacional",
] as const;

const TAG_COLORS: Record<string, string> = {
  "Buen precio": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-400",
  "Entrega rapida": "bg-green-50 text-green-700 ring-1 ring-green-200 dark:bg-green-950 dark:text-green-400",
  "Buena calidad": "bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-950 dark:text-teal-400",
  "Stock permanente": "bg-lime-50 text-lime-700 ring-1 ring-lime-200 dark:bg-lime-950 dark:text-lime-400",
  "Precio alto": "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-400",
  "Entrega lenta": "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-400",
  "Importador": "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-400",
  "Nacional": "bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950 dark:text-sky-400",
};

function ClasificacionTag({ tag }: { tag: string }) {
  const color = TAG_COLORS[tag] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>{tag}</span>;
}

const estadoListaConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  vigente: { label: "Vigente", variant: "success" },
  vencida: { label: "Vencida", variant: "danger" },
  borrador: { label: "Borrador", variant: "warning" },
};

function mapSupabaseProveedor(row: Record<string, unknown>): Proveedor {
  return {
    id: row.id as string,
    razonSocial: row.razon_social as string,
    cuit: row.cuit as string,
    condicionIva: (row.condicion_iva as Proveedor["condicionIva"]) ?? "RI",
    email: row.email as string,
    telefono: row.telefono as string,
    direccion: row.direccion as string,
    localidad: row.localidad as string,
    provincia: row.provincia as string,
    contactos: (Array.isArray(row.contactos) ? row.contactos : []).map((c: Record<string, unknown>) => ({
      id: c.id as string, nombre: c.nombre as string, cargo: c.cargo as string,
      email: c.email as string, telefono: c.telefono as string, principal: c.principal as boolean,
    })),
    rubro: (row.rubro as string) ?? "",
    formaPago: (row.forma_pago as string) ?? "",
    diasCuentaCorriente: Number(row.dias_cuenta_corriente) || 0,
    limiteCredito: Number(row.limite_credito) || 0,
    saldoCuentaCorriente: Number(row.saldo_cuenta_corriente) || 0,
    listasDePrecios: (Array.isArray(row.listas_precios) ? row.listas_precios : []).map((lp: Record<string, unknown>) => lp.id as string),
    notas: (row.notas as string) ?? "",
    clasificacionTags: Array.isArray(row.clasificacion_tags) ? (row.clasificacion_tags as string[]) : [],
    marcas: (row.marcas as string) ?? "",
    clasificacionNota: (row.clasificacion_nota as string) ?? "",
    activo: (row.activo as boolean) ?? true,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapSupabaseLista(row: Record<string, unknown>): ListaPrecios {
  const proveedores = row.proveedores as Record<string, unknown> | null;
  const items = Array.isArray(row.lista_precios_items) ? row.lista_precios_items : [];
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    proveedorId: row.proveedor_id as string,
    proveedorNombre: (proveedores?.razon_social as string) ?? "",
    moneda: row.moneda as "USD" | "ARS",
    vigenciaDesde: row.vigencia_desde as string,
    vigenciaHasta: row.vigencia_hasta as string,
    estado: row.estado as ListaPrecios["estado"],
    items: items.map((item: Record<string, unknown>) => ({
      id: item.id as string, codigo: item.codigo as string, descripcion: item.descripcion as string,
      categoria: item.categoria as string, unidad: item.unidad as string, precio: Number(item.precio),
      descuento: Number(item.descuento) || 0, precioNeto: Number(item.precio_neto),
    })),
    archivoOrigen: row.archivo_origen as string,
    notas: (row.notas as string) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const emptyForm = {
  razon_social: "",
  cuit: "",
  condicion_iva: "RI",
  email: "",
  telefono: "",
  direccion: "",
  localidad: "",
  provincia: "",
  rubro: "",
  forma_pago: "Transferencia",
  dias_cuenta_corriente: 30,
  limite_credito: 0,
  notas: "",
  clasificacion_tags: [] as string[],
  marcas: "",
  clasificacion_nota: "",
};

export default function ProveedoresPage() {
  const [tab, setTab] = useState<"proveedores" | "listas">("proveedores");
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<FilterValues>({
    rubro: "",
    provincia: "",
    saldo: {},
    formaPago: "",
  });
  const [view, setView] = useState<"table" | "cards">("table");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterLista, setFilterLista] = useState<string>("todas");

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [listas, setListas] = useState<ListaPrecios[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Detail
  const [selectedProv, setSelectedProv] = useState<Proveedor | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [provRes, listasRes] = await Promise.all([
        supabase.from("proveedores").select(`*, listas_precios(id, nombre, moneda, vigencia_hasta, estado)`).order("razon_social"),
        supabase.from("listas_precios").select(`*, proveedores(razon_social), lista_precios_items(*)`).order("created_at", { ascending: false }),
      ]);

      if (provRes.data && provRes.data.length > 0) {
        setProveedores(provRes.data.map((r) => mapSupabaseProveedor(r as Record<string, unknown>)));
      } else {
        setProveedores(mockProveedores);
      }
      if (listasRes.data && listasRes.data.length > 0) {
        setListas(listasRes.data.map((r) => mapSupabaseLista(r as Record<string, unknown>)));
      } else {
        setListas(mockListasPrecios);
      }
    } catch (err) {
      console.error("Error fetching proveedores:", err);
      setProveedores(mockProveedores);
      setListas(mockListasPrecios);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch contactos when a proveedor is selected (polymorphic table, no FK join)
  useEffect(() => {
    if (!selectedProv) return;
    async function fetchContactos() {
      try {
        const { data } = await supabase
          .from("contactos")
          .select("*")
          .eq("entity_type", "proveedor")
          .eq("entity_id", selectedProv!.id);
        if (data && data.length > 0) {
          const mapped = data.map((c: Record<string, unknown>) => ({
            id: c.id as string, nombre: (c.nombre as string) ?? "",
            cargo: (c.cargo as string) ?? "", email: (c.email as string) ?? "",
            telefono: (c.telefono as string) ?? "", principal: (c.principal as boolean) ?? false,
          }));
          setSelectedProv((prev) => prev ? { ...prev, contactos: mapped } : prev);
        }
      } catch (err) {
        console.error("Error fetching contactos:", err);
      }
    }
    fetchContactos();
  }, [selectedProv?.id]);

  // Build filter configs dynamically from current data
  const filterConfigs: FilterConfig[] = [
    {
      key: "rubro",
      label: "Rubro",
      type: "select",
      options: Array.from(new Set(proveedores.map((p) => p.rubro).filter(Boolean)))
        .sort()
        .map((r) => ({ value: r, label: r })),
    },
    {
      key: "provincia",
      label: "Provincia",
      type: "select",
      options: Array.from(new Set(proveedores.map((p) => p.provincia).filter(Boolean)))
        .sort()
        .map((p) => ({ value: p, label: p })),
    },
    {
      key: "saldo",
      label: "Saldo CC",
      type: "number-range",
    },
    {
      key: "formaPago",
      label: "Forma de pago",
      type: "select",
      options: [
        { value: "Contado", label: "Contado" },
        { value: "Cuenta corriente", label: "Cuenta corriente" },
        { value: "Cheque", label: "Cheque" },
        { value: "Transferencia", label: "Transferencia" },
      ],
    },
  ];

  const filteredProveedores = proveedores.filter((p) => {
    // Text search
    if (search) {
      const q = search.toLowerCase();
      if (!p.razonSocial.toLowerCase().includes(q) && !p.cuit.includes(search) && !p.rubro.toLowerCase().includes(q)) return false;
    }
    // Smart filters
    if (filterValues.rubro && (filterValues.rubro as string) !== "" && p.rubro !== filterValues.rubro) return false;
    if (filterValues.provincia && (filterValues.provincia as string) !== "" && p.provincia !== filterValues.provincia) return false;
    if (filterValues.formaPago && (filterValues.formaPago as string) !== "" && p.formaPago !== filterValues.formaPago) return false;
    const saldoRange = filterValues.saldo as { min?: number; max?: number } | undefined;
    if (saldoRange) {
      if (saldoRange.min !== undefined && p.saldoCuentaCorriente < saldoRange.min) return false;
      if (saldoRange.max !== undefined && p.saldoCuentaCorriente > saldoRange.max) return false;
    }
    return true;
  });

  const filteredListas = listas.filter((lp) => {
    if (filterLista !== "todas" && lp.estado !== filterLista) return false;
    if (search && !lp.nombre.toLowerCase().includes(search.toLowerCase()) && !lp.proveedorNombre.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalDeuda = proveedores.reduce((a, p) => a + p.saldoCuentaCorriente, 0);
  const totalCredito = proveedores.reduce((a, p) => a + p.limiteCredito, 0);
  const listasVigentes = listas.filter((l) => l.estado === "vigente").length;
  const listasVencidas = listas.filter((l) => l.estado === "vencida").length;

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(p: Proveedor) {
    setEditingId(p.id);
    setForm({
      razon_social: p.razonSocial, cuit: p.cuit, condicion_iva: p.condicionIva,
      email: p.email, telefono: p.telefono, direccion: p.direccion,
      localidad: p.localidad, provincia: p.provincia, rubro: p.rubro,
      forma_pago: p.formaPago, dias_cuenta_corriente: p.diasCuentaCorriente,
      limite_credito: p.limiteCredito, notas: p.notas,
      clasificacion_tags: p.clasificacionTags ?? [], marcas: p.marcas ?? "",
      clasificacion_nota: p.clasificacionNota ?? "",
    });
    setFormError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.razon_social.trim() || !form.cuit.trim()) {
      setFormError("Razon social y CUIT son obligatorios");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingId) {
        const { error } = await supabase.from("proveedores").update(form as any).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("proveedores").insert(form as any);
        if (error) throw error;
      }
      setModalOpen(false);
      setSelectedProv(null);
      await fetchData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  function exportCSV() {
    const headers = ["Razon Social", "CUIT", "Rubro", "Email", "Telefono", "Localidad", "Provincia", "Forma Pago", "Saldo CC", "Limite Credito"];
    const rows = filteredProveedores.map((p) => [
      p.razonSocial, p.cuit, p.rubro, p.email, p.telefono, p.localidad, p.provincia, p.formaPago, p.saldoCuentaCorriente, p.limiteCredito,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proveedores_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <>
        <Header title="Proveedores" subtitle="Cargando datos..." action={{ label: "Nuevo proveedor", onClick: () => {} }} />
        <div className="flex items-center justify-center p-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Proveedores"
        subtitle={`${proveedores.length} proveedores — ${listas.length} listas de precios`}
        action={{ label: tab === "proveedores" ? "Nuevo proveedor" : "Cargar lista", onClick: tab === "proveedores" ? openCreate : () => {} }}
      />
      <div className="p-4 sm:p-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Proveedores</p><p className="mt-1 text-2xl font-bold">{proveedores.length}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Deuda CC</p><p className="mt-1 text-2xl font-bold">{formatCurrency(totalDeuda)}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Credito total</p><p className="mt-1 text-2xl font-bold">{formatCurrency(totalCredito)}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Listas vigentes</p><p className="mt-1 text-2xl font-bold text-emerald-600">{listasVigentes}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Listas vencidas</p><p className="mt-1 text-2xl font-bold text-red-600">{listasVencidas}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          {(["proveedores", "listas"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setSearch(""); }}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700"}`}>
              {t === "proveedores" ? "Proveedores" : "Listas de precios"}
            </button>
          ))}
        </div>

        {/* -- TAB: Proveedores -- */}
        {tab === "proveedores" && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input type="text" placeholder="Buscar por razon social, CUIT o rubro..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900" />
              </div>
              <button onClick={exportCSV} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"><Download className="h-4 w-4" /> Exportar</button>
              <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <button onClick={() => setView("table")} className={`px-3 py-2 text-xs font-medium ${view === "table" ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-white" : "bg-white text-zinc-400 dark:bg-zinc-900"}`}>Tabla</button>
                <button onClick={() => setView("cards")} className={`px-3 py-2 text-xs font-medium ${view === "cards" ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-white" : "bg-white text-zinc-400 dark:bg-zinc-900"}`}>Tarjetas</button>
              </div>
            </div>

            <SmartFilters filters={filterConfigs} values={filterValues} onChange={setFilterValues} />

            {view === "table" ? (
              <Card className="p-0 overflow-hidden">
                <DataTable<Proveedor>
                  columns={[
                    { key: "razonSocial", label: "Proveedor", sortable: true, render: (row) => (
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold text-xs">{row.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
                        <div><p className="font-medium text-zinc-900 dark:text-white">{row.razonSocial}</p><p className="text-xs text-zinc-400">{row.cuit}</p></div>
                      </div>
                    )},
                    { key: "rubro", label: "Rubro", sortable: true, render: (row) => <Badge variant="info">{row.rubro}</Badge> },
                    { key: "clasificacionTags" as keyof Proveedor, label: "Clasificacion", sortable: false, render: (row) => (
                      <div className="flex flex-wrap gap-1">
                        {row.clasificacionTags?.map((t) => <ClasificacionTag key={t} tag={t} />)}
                        {row.marcas && <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-400">{row.marcas}</span>}
                      </div>
                    )},
                    { key: "localidad", label: "Ubicacion", sortable: true, render: (row) => <span className="text-zinc-500">{row.localidad}, {row.provincia}</span> },
                    { key: "formaPago", label: "Forma pago", sortable: true, render: (row) => <Badge variant="outline">{row.formaPago}</Badge> },
                    { key: "saldoCuentaCorriente", label: "Saldo CC", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right text-red-600">{formatCurrency(row.saldoCuentaCorriente)}</span> },
                    { key: "limiteCredito", label: "Limite", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limiteCredito)}</span> },
                    { key: "actions", label: "", sortable: false, render: (row) => (
                      <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )},
                  ]}
                  data={filteredProveedores}
                  onRowClick={(row) => setSelectedProv(row)}
                />
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProveedores.map((prov) => {
                  const provListas = listas.filter((l) => l.proveedorId === prov.id);
                  return (
                    <Card key={prov.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedProv(prov)}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold text-sm">{prov.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
                          <div><p className="font-semibold text-zinc-900 dark:text-white">{prov.razonSocial}</p><p className="text-xs text-zinc-400">{prov.cuit}</p></div>
                        </div>
                        <Badge variant="info">{prov.rubro.split(" ")[0]}</Badge>
                      </div>
                      <div className="mt-4 space-y-2 text-sm text-zinc-500">
                        <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {prov.localidad}, {prov.provincia}</div>
                        <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {prov.telefono || "—"}</div>
                        <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {prov.email || "—"}</div>
                        <div className="flex items-center gap-2"><ListOrdered className="h-3.5 w-3.5" /> {provListas.length} lista(s) — {provListas.filter(l => l.estado === "vigente").length} vigente(s)</div>
                      </div>
                      {(prov.clasificacionTags?.length > 0 || prov.marcas) && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {prov.clasificacionTags?.map((t) => <ClasificacionTag key={t} tag={t} />)}
                          {prov.marcas && <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-400">{prov.marcas}</span>}
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <div><p className="text-xs text-zinc-400">Saldo CC</p><p className="font-mono font-semibold text-red-600">{formatCurrency(prov.saldoCuentaCorriente)}</p></div>
                        <div className="text-right"><p className="text-xs text-zinc-400">Forma pago</p><Badge variant="outline">{prov.formaPago}</Badge></div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* -- TAB: Listas de precios -- */}
        {tab === "listas" && (
          <>
            {listasVencidas > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <div><p className="font-medium text-amber-800">{listasVencidas} lista(s) vencida(s)</p><p className="text-sm text-amber-600">Solicita la actualizacion a los proveedores correspondientes.</p></div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-2">
                {(["todas", "vigente", "vencida", "borrador"] as const).map((estado) => {
                  const count = estado === "todas" ? listas.length : listas.filter(l => l.estado === estado).length;
                  return (
                    <button key={estado} onClick={() => setFilterLista(estado)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${filterLista === estado ? "bg-orange-500 text-white" : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}>
                      {estado === "todas" ? "Todas" : estadoListaConfig[estado].label} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input type="text" placeholder="Buscar lista o proveedor..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm text-zinc-900 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
              </div>
            </div>
            <div className="space-y-4">
              {filteredListas.map((lista) => {
                const isExpanded = expandedId === lista.id;
                const cfg = estadoListaConfig[lista.estado];
                return (
                  <Card key={lista.id} className="p-0 overflow-hidden">
                    <button onClick={() => setExpandedId(isExpanded ? null : lista.id)}
                      className="flex w-full items-center justify-between p-5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><ListOrdered className="h-5 w-5" /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-zinc-900 dark:text-white">{lista.nombre}</h3>
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            <Badge variant="outline">{lista.moneda}</Badge>
                          </div>
                          <p className="text-sm text-zinc-500">{lista.proveedorNombre} — {lista.items.length} articulos</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-zinc-400">Vigencia</p>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">{lista.vigenciaDesde} — {lista.vigenciaHasta}</p>
                        </div>
                        {isExpanded ? <ChevronDown className="h-5 w-5 text-zinc-400" /> : <ChevronRight className="h-5 w-5 text-zinc-400" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-zinc-200 dark:border-zinc-700">
                        {lista.notas && <div className="bg-zinc-50 dark:bg-zinc-800 px-5 py-2.5 text-sm text-zinc-500">{lista.notas}</div>}
                        <DataTable<ListaPreciosItem>
                          columns={[
                            { key: "codigo", label: "Codigo", render: (row) => <span className="font-mono text-xs font-bold">{row.codigo}</span> },
                            { key: "descripcion", label: "Articulo", render: (row) => <span className="font-medium">{row.descripcion}</span> },
                            { key: "categoria", label: "Categoria", render: (row) => <Badge variant="outline">{row.categoria}</Badge> },
                            { key: "unidad", label: "Un.", render: (row) => <span className="text-zinc-400">{row.unidad}</span> },
                            { key: "precio", label: "P. Lista", className: "text-right", render: (row) => <span className="font-mono block text-right text-zinc-400 line-through">{lista.moneda === "USD" ? `USD ${row.precio.toFixed(2)}` : formatCurrency(row.precio)}</span> },
                            { key: "descuento", label: "Desc.", className: "text-right", render: (row) => row.descuento ? <span className="text-emerald-600 font-medium">{row.descuento}%</span> : <span className="text-zinc-300">—</span> },
                            { key: "precioNeto", label: "P. Neto", className: "text-right", render: (row) => <span className="font-mono font-semibold block text-right">{lista.moneda === "USD" ? `USD ${row.precioNeto.toFixed(2)}` : formatCurrency(row.precioNeto)}</span> },
                          ]}
                          data={lista.items}
                        />
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Detail panel */}
      {selectedProv && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedProv(null)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 p-6 dark:border-zinc-700">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{selectedProv.razonSocial}</h2>
                <p className="text-sm text-zinc-500">{selectedProv.cuit}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { openEdit(selectedProv); setSelectedProv(null); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => setSelectedProv(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-zinc-500">Rubro</p><p className="text-sm font-medium">{selectedProv.rubro || "—"}</p></div>
                <div><p className="text-xs text-zinc-500">Condicion IVA</p><p className="text-sm font-medium">{selectedProv.condicionIva}</p></div>
                <div><p className="text-xs text-zinc-500">Email</p><p className="text-sm font-medium">{selectedProv.email || "—"}</p></div>
                <div><p className="text-xs text-zinc-500">Telefono</p><p className="text-sm font-medium">{selectedProv.telefono || "—"}</p></div>
                <div className="col-span-2"><p className="text-xs text-zinc-500">Direccion</p><p className="text-sm font-medium">{selectedProv.direccion || "—"}, {selectedProv.localidad}, {selectedProv.provincia}</p></div>
              </div>
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold mb-3">Comercial</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><p className="text-xs text-zinc-500">Forma de pago</p><p className="text-sm font-medium">{selectedProv.formaPago}</p></div>
                  <div><p className="text-xs text-zinc-500">Dias CC</p><p className="text-sm font-medium">{selectedProv.diasCuentaCorriente}</p></div>
                  <div><p className="text-xs text-zinc-500">Limite credito</p><p className="text-sm font-medium">{formatCurrency(selectedProv.limiteCredito)}</p></div>
                  <div><p className="text-xs text-zinc-500">Saldo CC</p><p className="text-sm font-medium text-red-600">{formatCurrency(selectedProv.saldoCuentaCorriente)}</p></div>
                </div>
              </div>
              {(selectedProv.clasificacionTags?.length > 0 || selectedProv.marcas || selectedProv.clasificacionNota) && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Tag className="h-4 w-4" /> Clasificacion</h3>
                  {selectedProv.clasificacionTags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {selectedProv.clasificacionTags.map((t) => <ClasificacionTag key={t} tag={t} />)}
                    </div>
                  )}
                  {selectedProv.marcas && (
                    <div className="mb-3">
                      <p className="text-xs text-zinc-500 mb-1">Marcas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedProv.marcas.split(",").map((m) => m.trim()).filter(Boolean).map((m) => (
                          <span key={m} className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-400">{m}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedProv.clasificacionNota && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">Comentario</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{selectedProv.clasificacionNota}</p>
                    </div>
                  )}
                </div>
              )}
              {selectedProv.notas && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold mb-2">Notas</h3>
                  <p className="text-sm text-zinc-600 whitespace-pre-wrap">{selectedProv.notas}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold">{editingId ? "Editar proveedor" : "Nuevo proveedor"}</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
            </div>
            {formError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{formError}</div>}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Razon social *</label>
                <input value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
              </div>
              <div><label className="text-xs font-medium text-zinc-500">CUIT *</label><input value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Rubro</label><input value={form.rubro} onChange={(e) => setForm({ ...form, rubro: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Telefono</label><input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Direccion</label><input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Localidad</label><input value={form.localidad} onChange={(e) => setForm({ ...form, localidad: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Provincia</label><input value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Forma de pago</label>
                <select value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                  <option value="Transferencia">Transferencia</option><option value="Cheque">Cheque</option><option value="Efectivo">Efectivo</option><option value="Cuenta corriente">Cuenta corriente</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-zinc-500">Dias CC</label><input type="number" value={form.dias_cuenta_corriente} onChange={(e) => setForm({ ...form, dias_cuenta_corriente: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Limite credito</label><input type="number" value={form.limite_credito} onChange={(e) => setForm({ ...form, limite_credito: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div className="col-span-2"><label className="text-xs font-medium text-zinc-500">Notas</label><textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              {/* Clasificacion */}
              <div className="col-span-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Tag className="h-4 w-4" /> Clasificacion del proveedor</h3>
                <div className="flex flex-wrap gap-2">
                  {CLASIFICACION_TAGS.map((tag) => {
                    const selected = form.clasificacion_tags.includes(tag);
                    const color = selected ? TAG_COLORS[tag] : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500";
                    return (
                      <button key={tag} type="button" onClick={() => {
                        setForm({ ...form, clasificacion_tags: selected ? form.clasificacion_tags.filter((t) => t !== tag) : [...form.clasificacion_tags, tag] });
                      }} className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer border ${selected ? "border-transparent ring-1" : "border-zinc-200 dark:border-zinc-700"} ${color}`}>
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Marcas <span className="text-zinc-400 font-normal">(separadas por coma)</span></label>
                <input value={form.marcas} onChange={(e) => setForm({ ...form, marcas: e.target.value })} placeholder="Ej: Spirax Sarco, Valvitalia, FMC" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Comentario de clasificacion</label>
                <textarea value={form.clasificacion_nota} onChange={(e) => setForm({ ...form, clasificacion_nota: e.target.value })} rows={2} placeholder="Notas sobre precio, entrega, calidad..." className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200">
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
