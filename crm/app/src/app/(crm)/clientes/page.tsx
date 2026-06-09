"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { formatCurrency } from "@/lib/utils";
import { mockClients, mockPresupuestos, mockFacturas } from "@/lib/mock-data";
import type { Client } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import {
  Search, Download, MapPin, Phone, Mail, Loader2, Building2,
  Plus, X, Pencil, Trash2, ToggleLeft, ToggleRight,
  BarChart3, ShoppingBag, CalendarDays, TrendingUp, Cake,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

const condicionLabels: Record<string, string> = {
  RI: "Resp. Inscripto",
  Monotributo: "Monotributo",
  Exento: "Exento",
  CF: "Cons. Final",
};

const provincias = [
  "Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba",
  "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan",
  "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero",
  "Tierra del Fuego", "Tucumán",
];

interface ClienteRow {
  id: string;
  type: string;
  razon_social: string;
  cuit: string;
  condicion_iva: string;
  email: string;
  telefono: string;
  direccion: string;
  localidad: string;
  provincia: string;
  cp: string;
  lista_precio: string;
  dias_cuenta_corriente: number;
  forma_pago: string;
  limite_credito: number;
  saldo_cuenta_corriente: number;
  notas: string;
  activo: boolean;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  assigned_profile: { full_name: string } | null;
  contactos: unknown[];
  cliente_sucursales: unknown[];
}

function mapRow(row: ClienteRow): Client & { vendedorNombre: string } {
  return {
    id: row.id,
    type: (row.type as Client["type"]) ?? "empresa",
    razonSocial: row.razon_social ?? "",
    cuit: row.cuit ?? "",
    condicionIva: (row.condicion_iva as Client["condicionIva"]) ?? "RI",
    email: row.email ?? "",
    telefono: row.telefono ?? "",
    direccion: row.direccion ?? "",
    localidad: row.localidad ?? "",
    provincia: row.provincia ?? "",
    cp: row.cp ?? "",
    listaPrecio: row.lista_precio ?? "",
    diasCuentaCorriente: Number(row.dias_cuenta_corriente) || 0,
    formaPago: row.forma_pago ?? "",
    limiteCredito: Number(row.limite_credito) || 0,
    saldoCuentaCorriente: Number(row.saldo_cuenta_corriente) || 0,
    notas: row.notas ?? "",
    activo: row.activo ?? true,
    assignedTo: row.assigned_to ?? undefined,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    contactos: Array.isArray(row.contactos) ? (row.contactos as Array<Record<string, unknown>>).map((c) => ({
      id: c.id as string,
      nombre: (c.nombre as string) ?? "",
      cargo: (c.cargo as string) ?? "",
      email: (c.email as string) ?? "",
      telefono: (c.telefono as string) ?? "",
      principal: (c.principal as boolean) ?? false,
      fechaCumpleanos: (c.fecha_cumpleanos as string) ?? null,
      notas: (c.notas as string) ?? null,
      sucursalId: (c.sucursal_id as string) ?? null,
    })) : [],
    sucursales: Array.isArray(row.cliente_sucursales) ? (row.cliente_sucursales as Array<Record<string, unknown>>).map((s) => ({
      id: (s.id as string) ?? "",
      nombre: (s.nombre as string) ?? "",
      direccion: (s.direccion as string) ?? "",
      localidad: (s.localidad as string) ?? "",
      provincia: (s.provincia as string) ?? "",
      telefono: (s.telefono as string) ?? "",
      email: (s.email as string) ?? "",
      cp: (s.cp as string) ?? "",
    })) : [],
    vendedorNombre: row.assigned_profile?.full_name ?? "—",
  };
}

type ClienteExt = Client & { vendedorNombre: string };

interface ConsumoCategory {
  categoria: string;
  cantidad: number;
  total: number;
}

interface ConsumoData {
  categorias: ConsumoCategory[];
  totalFacturado: number;
  cantidadPresupuestos: number;
  ultimaCompra: string | null;
  loading: boolean;
}

const emptyForm = {
  razon_social: "",
  cuit: "",
  type: "empresa" as string,
  condicion_iva: "RI" as string,
  email: "",
  telefono: "",
  direccion: "",
  localidad: "",
  provincia: "",
  cp: "",
  lista_precio: "A",
  dias_cuenta_corriente: 30,
  forma_pago: "Transferencia",
  limite_credito: 0,
  notas: "",
};

export default function ClientesPage() {
  const [view, setView] = useState<"table" | "cards">("table");
  const [search, setSearch] = useState("");
  const [clientes, setClientes] = useState<ClienteExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters
  const filterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha alta", type: "date-range" },
    { key: "provincia", label: "Provincia", type: "select", options: provincias.map(p => ({ value: p, label: p })) },
    { key: "condicionIva", label: "Condición IVA", type: "select", options: [
      { value: "RI", label: "Resp. Inscripto" }, { value: "Monotributo", label: "Monotributo" },
      { value: "Exento", label: "Exento" }, { value: "CF", label: "Cons. Final" }
    ]},
    { key: "formaPago", label: "Forma de pago", type: "select", options: [
      { value: "Contado", label: "Contado" }, { value: "Cuenta corriente", label: "Cuenta corriente" },
      { value: "Cheque", label: "Cheque" }, { value: "Transferencia", label: "Transferencia" }
    ]},
    { key: "saldo", label: "Saldo CC", type: "number-range" },
    { key: "estado", label: "Estado", type: "select", options: [
      { value: "activo", label: "Activo" }, { value: "inactivo", label: "Inactivo" }
    ]},
  ];
  const [filterValues, setFilterValues] = useState<FilterValues>({ fecha: { from: "", to: "" }, provincia: "", condicionIva: "", formaPago: "", saldo: {}, estado: "" });

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  // Detail
  const [selectedCliente, setSelectedCliente] = useState<ClienteExt | null>(null);

  // Consumo analysis
  const [consumoData, setConsumoData] = useState<ConsumoData>({
    categorias: [],
    totalFacturado: 0,
    cantidadPresupuestos: 0,
    ultimaCompra: null,
    loading: false,
  });

  useEffect(() => {
    if (!selectedCliente) return;
    const clienteId = selectedCliente.id;

    async function fetchConsumo() {
      setConsumoData((prev) => ({ ...prev, loading: true }));

      try {
        // Fetch approved presupuestos with items for this client
        const { data: presupuestos, error: presError } = await supabase
          .from("presupuestos")
          .select("id, fecha, total, presupuesto_items(categoria, cantidad, total)")
          .eq("cliente_id", clienteId)
          .eq("estado", "aprobado")
          .order("fecha", { ascending: false });

        // Fetch facturas total for this client
        const { data: facturas, error: facError } = await supabase
          .from("facturas")
          .select("total")
          .eq("cliente_id", clienteId);

        const useMock = presError || facError || !presupuestos || presupuestos.length === 0;

        if (useMock) {
          // Fallback to mock data
          const mockPres = mockPresupuestos.filter(
            (p) => p.clienteId === clienteId && p.estado === "aprobado"
          );
          const catMap = new Map<string, { cantidad: number; total: number }>();
          for (const p of mockPres) {
            for (const item of p.items) {
              const cat = item.categoria || "Sin categoría";
              const existing = catMap.get(cat) || { cantidad: 0, total: 0 };
              catMap.set(cat, {
                cantidad: existing.cantidad + item.cantidad,
                total: existing.total + (item.total || item.subtotal || 0),
              });
            }
          }
          const categorias = Array.from(catMap.entries())
            .map(([categoria, data]) => ({ categoria, ...data }))
            .sort((a, b) => b.total - a.total);

          const mockFact = mockFacturas.filter((f) => f.clienteId === clienteId);
          const totalFact = mockFact.reduce((sum, f) => sum + f.total, 0);
          const ultimaFecha = mockPres.length > 0 ? mockPres[0].fecha : null;

          setConsumoData({
            categorias,
            totalFacturado: totalFact,
            cantidadPresupuestos: mockPres.length,
            ultimaCompra: ultimaFecha,
            loading: false,
          });
          return;
        }

        // Process real Supabase data
        const catMap = new Map<string, { cantidad: number; total: number }>();
        for (const p of presupuestos) {
          const items = (p as any).presupuesto_items || [];
          for (const item of items) {
            const cat = item.categoria || "Sin categoría";
            const existing = catMap.get(cat) || { cantidad: 0, total: 0 };
            catMap.set(cat, {
              cantidad: existing.cantidad + (item.cantidad || 0),
              total: existing.total + (item.total || 0),
            });
          }
        }
        const categorias = Array.from(catMap.entries())
          .map(([categoria, data]) => ({ categoria, ...data }))
          .sort((a, b) => b.total - a.total);

        const totalFact = facturas
          ? facturas.reduce((sum, f) => sum + (f.total || 0), 0)
          : 0;

        const ultimaFecha = presupuestos.length > 0 ? presupuestos[0].fecha : null;

        setConsumoData({
          categorias,
          totalFacturado: totalFact,
          cantidadPresupuestos: presupuestos.length,
          ultimaCompra: ultimaFecha,
          loading: false,
        });
      } catch (err) {
        console.error("Error fetching consumo:", err);
        setConsumoData({
          categorias: [],
          totalFacturado: 0,
          cantidadPresupuestos: 0,
          ultimaCompra: null,
          loading: false,
        });
      }
    }

    fetchConsumo();
  }, [selectedCliente]);

  // Fetch contactos when a client is selected (polymorphic table, no FK join)
  useEffect(() => {
    if (!selectedCliente) return;
    async function fetchContactos() {
      try {
        const { data } = await supabase
          .from("contactos")
          .select("*")
          .eq("entity_type", "cliente")
          .eq("entity_id", selectedCliente!.id);
        if (data && data.length > 0) {
          const mapped = data.map((c: Record<string, unknown>) => ({
            id: c.id as string,
            nombre: (c.nombre as string) ?? "",
            cargo: (c.cargo as string) ?? "",
            email: (c.email as string) ?? "",
            telefono: (c.telefono as string) ?? "",
            principal: (c.principal as boolean) ?? false,
            fechaCumpleanos: (c.fecha_cumpleanos as string) ?? null,
            notas: (c.notas as string) ?? null,
            sucursalId: (c.sucursal_id as string) ?? null,
          }));
          setSelectedCliente((prev) => prev ? { ...prev, contactos: mapped } : prev);
        }
      } catch (err) {
        console.error("Error fetching contactos:", err);
      }
    }
    fetchContactos();
  }, [selectedCliente?.id]);

  const fetchClientes = useCallback(async () => {
    try {
      // contactos is polymorphic (no FK to clientes), so we fetch it separately
      const { data, error } = await supabase
        .from("clientes")
        .select(`*, assigned_profile:assigned_to(full_name), cliente_sucursales(*)`)
        .order("razon_social");

      if (error) {
        console.error("Error fetching clientes:", error);
        setClientes(mockClients.map((c) => ({ ...c, vendedorNombre: "—" })));
      } else if (data && data.length > 0) {
        setClientes(data.map((row) => mapRow({ ...row, contactos: [] } as unknown as ClienteRow)));
      } else {
        setClientes(mockClients.map((c) => ({ ...c, vendedorNombre: "—" })));
      }
    } catch (err) {
      console.error("Error fetching clientes:", err);
      setClientes(mockClients.map((c) => ({ ...c, vendedorNombre: "—" })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClientes();
  }, [fetchClientes]);

  const filtered = clientes.filter((c) => {
    const matchSearch =
      c.razonSocial.toLowerCase().includes(search.toLowerCase()) ||
      c.cuit.includes(search) ||
      c.email.toLowerCase().includes(search.toLowerCase());
    const fProvincia = filterValues.provincia as string;
    const matchProvincia = !fProvincia || c.provincia === fProvincia;
    const fCondicion = filterValues.condicionIva as string;
    const matchCondicion = !fCondicion || c.condicionIva === fCondicion;
    const fFormaPago = filterValues.formaPago as string;
    const matchFormaPago = !fFormaPago || c.formaPago === fFormaPago;
    const fEstado = filterValues.estado as string;
    const matchEstado =
      !fEstado ||
      (fEstado === "activo" && c.activo) ||
      (fEstado === "inactivo" && !c.activo);
    const fFecha = filterValues.fecha as { from?: string; to?: string };
    const matchFechaFrom = !fFecha?.from || c.createdAt >= fFecha.from;
    const matchFechaTo = !fFecha?.to || c.createdAt.slice(0, 10) <= fFecha.to;
    const fSaldo = filterValues.saldo as { min?: number; max?: number };
    const matchSaldoMin = fSaldo?.min === undefined || c.saldoCuentaCorriente >= fSaldo.min;
    const matchSaldoMax = fSaldo?.max === undefined || c.saldoCuentaCorriente <= fSaldo.max;
    return matchSearch && matchProvincia && matchCondicion && matchFormaPago && matchEstado && matchFechaFrom && matchFechaTo && matchSaldoMin && matchSaldoMax;
  });

  const activos = clientes.filter((c) => c.activo).length;

  // CSV Export
  function exportCSV() {
    const headers = ["Razon Social", "CUIT", "Condicion IVA", "Email", "Telefono", "Localidad", "Provincia", "Lista Precio", "Saldo CC", "Limite Credito", "Estado"];
    const rows = filtered.map((c) => [
      c.razonSocial, c.cuit, condicionLabels[c.condicionIva] || c.condicionIva,
      c.email, c.telefono, c.localidad, c.provincia, c.listaPrecio,
      c.saldoCuentaCorriente, c.limiteCredito, c.activo ? "Activo" : "Inactivo",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Modal handlers
  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(c: ClienteExt) {
    setEditingId(c.id);
    setForm({
      razon_social: c.razonSocial,
      cuit: c.cuit,
      type: c.type,
      condicion_iva: c.condicionIva,
      email: c.email,
      telefono: c.telefono,
      direccion: c.direccion,
      localidad: c.localidad,
      provincia: c.provincia,
      cp: c.cp,
      lista_precio: c.listaPrecio,
      dias_cuenta_corriente: c.diasCuentaCorriente,
      forma_pago: c.formaPago,
      limite_credito: c.limiteCredito,
      notas: c.notas,
    });
    setFormError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.razon_social.trim()) {
      setFormError("La razon social es obligatoria");
      return;
    }
    if (!form.cuit.trim()) {
      setFormError("El CUIT es obligatorio");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingId) {
        const { error } = await supabase
          .from("clientes")
          .update(form as any)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("clientes")
          .insert(form as any);
        if (error) throw error;
      }
      setModalOpen(false);
      await fetchClientes();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al guardar";
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActivo(c: ClienteExt) {
    try {
      await supabase.from("clientes").update({ activo: !c.activo }).eq("id", c.id);
      await fetchClientes();
    } catch (err) {
      console.error("Error toggling activo:", err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Seguro que queres eliminar este cliente? Esta accion no se puede deshacer.")) return;
    try {
      await supabase.from("clientes").delete().eq("id", id);
      setSelectedCliente(null);
      await fetchClientes();
    } catch (err) {
      console.error("Error deleting cliente:", err);
    }
  }


  if (loading) {
    return (
      <>
        <Header title="Clientes" subtitle="Cargando..." action={{ label: "Nuevo cliente", onClick: () => {} }} />
        <div className="flex items-center justify-center p-24">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          <span className="ml-3 text-sm text-zinc-500">Cargando clientes...</span>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Clientes"
        subtitle={`${activos} clientes activos`}
        action={{ label: "Nuevo cliente", onClick: openCreate }}
      />
      <div className="p-8 space-y-6">
        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por razon social, CUIT o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </div>
          <button onClick={exportCSV} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <Download className="h-4 w-4" /> Exportar
          </button>
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <button onClick={() => setView("table")} className={`px-3 py-2 text-xs font-medium ${view === "table" ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-white" : "bg-white text-zinc-400 dark:bg-zinc-900"}`}>Tabla</button>
            <button onClick={() => setView("cards")} className={`px-3 py-2 text-xs font-medium ${view === "cards" ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-white" : "bg-white text-zinc-400 dark:bg-zinc-900"}`}>Tarjetas</button>
          </div>
        </div>

        <SmartFilters filters={filterConfigs} values={filterValues} onChange={setFilterValues} />

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Total clientes</p>
            <p className="mt-1 text-2xl font-bold">{clientes.length}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Saldo total CC</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(clientes.reduce((a, c) => a + c.saldoCuentaCorriente, 0))}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Credito otorgado</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(clientes.reduce((a, c) => a + c.limiteCredito, 0))}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Provincias</p>
            <p className="mt-1 text-2xl font-bold">{new Set(clientes.map((c) => c.provincia)).size}</p>
          </div>
        </div>

        {view === "table" ? (
          <Card className="p-0 overflow-hidden">
            <DataTable<ClienteExt>
              columns={[
                {
                  key: "razonSocial", label: "Razon social", sortable: true,
                  render: (row) => (
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600 font-bold text-xs">
                        {row.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-white">{row.razonSocial}</p>
                        <p className="text-xs text-zinc-400">{row.cuit}</p>
                      </div>
                    </div>
                  ),
                },
                { key: "condicionIva", label: "IVA", sortable: true, render: (row) => <Badge variant="outline">{condicionLabels[row.condicionIva]}</Badge> },
                { key: "localidad", label: "Ubicacion", sortable: true, render: (row) => <span className="text-zinc-500">{row.localidad}{row.provincia ? `, ${row.provincia}` : ""}</span> },
                { key: "sucursales", label: "Sucursales", sortable: false, render: (row) => {
                  const n = row.sucursales?.length || 0;
                  return n > 0 ? (
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      <Building2 className="h-3 w-3" /> {n}
                    </div>
                  ) : <span className="text-zinc-300">—</span>;
                }},
                { key: "listaPrecio", label: "Lista", sortable: true, render: (row) => <Badge variant="info">{row.listaPrecio || "—"}</Badge> },
                { key: "saldoCuentaCorriente", label: "Saldo CC", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.saldoCuentaCorriente)}</span> },
                { key: "vendedorNombre", label: "Vendedor", sortable: true, render: (row) => <span className="text-zinc-500 text-xs">{row.vendedorNombre}</span> },
                { key: "activo", label: "Estado", sortable: true, render: (row) => <Badge variant={row.activo ? "success" : "danger"}>{row.activo ? "Activo" : "Inactivo"}</Badge> },
                {
                  key: "actions", label: "", sortable: false,
                  render: (row) => (
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleToggleActivo(row); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title={row.activo ? "Desactivar" : "Activar"}>
                        {row.activo ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ),
                },
              ]}
              data={filtered}
              onRowClick={(row) => setSelectedCliente(row)}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((client) => (
              <Card key={client.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedCliente(client)}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600 font-bold text-sm">
                      {client.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}
                    </div>
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-white">{client.razonSocial}</p>
                      <p className="text-xs text-zinc-400">{client.cuit}</p>
                    </div>
                  </div>
                  <Badge variant={client.activo ? "success" : "danger"}>
                    {client.activo ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <div className="mt-4 space-y-2 text-sm text-zinc-500">
                  <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {client.localidad}, {client.provincia}</div>
                  <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {client.telefono || "—"}</div>
                  <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {client.email || "—"}</div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  <div>
                    <p className="text-xs text-zinc-400">Saldo CC</p>
                    <p className="font-mono font-semibold">{formatCurrency(client.saldoCuentaCorriente)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-400">Lista</p>
                    <Badge variant="info">{client.listaPrecio || "—"}</Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Detail side panel */}
      {selectedCliente && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedCliente(null)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 p-6 dark:border-zinc-700">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{selectedCliente.razonSocial}</h2>
                <p className="text-sm text-zinc-500">{selectedCliente.cuit}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { openEdit(selectedCliente); setSelectedCliente(null); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(selectedCliente.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button onClick={() => setSelectedCliente(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-zinc-500">Condicion IVA</p>
                  <p className="text-sm font-medium">{condicionLabels[selectedCliente.condicionIva]}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Tipo</p>
                  <p className="text-sm font-medium capitalize">{selectedCliente.type}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Email</p>
                  <p className="text-sm font-medium">{selectedCliente.email || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Telefono</p>
                  <p className="text-sm font-medium">{selectedCliente.telefono || "—"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-zinc-500">Direccion</p>
                  <p className="text-sm font-medium">{selectedCliente.direccion || "—"}, {selectedCliente.localidad}, {selectedCliente.provincia} {selectedCliente.cp}</p>
                </div>
              </div>
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Comercial</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-zinc-500">Lista de precios</p>
                    <p className="text-sm font-medium">{selectedCliente.listaPrecio || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Forma de pago</p>
                    <p className="text-sm font-medium">{selectedCliente.formaPago || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Dias CC</p>
                    <p className="text-sm font-medium">{selectedCliente.diasCuentaCorriente}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Limite credito</p>
                    <p className="text-sm font-medium">{formatCurrency(selectedCliente.limiteCredito)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Saldo CC</p>
                    <p className="text-sm font-medium">{formatCurrency(selectedCliente.saldoCuentaCorriente)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Vendedor</p>
                    <p className="text-sm font-medium">{selectedCliente.vendedorNombre}</p>
                  </div>
                </div>
              </div>
              {selectedCliente.notas && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">Notas</h3>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{selectedCliente.notas}</p>
                </div>
              )}

              {/* Sucursales */}
              {selectedCliente.sucursales && selectedCliente.sucursales.length > 0 && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-orange-500" />
                    Sucursales ({selectedCliente.sucursales.length})
                  </h3>
                  <div className="grid gap-2">
                    {selectedCliente.sucursales.map((s) => (
                      <div key={s.id} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <p className="text-sm font-medium text-zinc-900 dark:text-white">{s.nombre}</p>
                        {(s.direccion || s.localidad || s.provincia) && (
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-500">
                            <MapPin className="h-3 w-3" />
                            {[s.direccion, s.localidad, s.provincia].filter(Boolean).join(", ")}
                          </div>
                        )}
                        {s.telefono && (
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-500">
                            <Phone className="h-3 w-3" /> {s.telefono}
                          </div>
                        )}
                        {s.email && (
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-500">
                            <Mail className="h-3 w-3" /> {s.email}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Contactos */}
              {selectedCliente.contactos && selectedCliente.contactos.length > 0 && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Contactos</h3>
                  <div className="space-y-3">
                    {selectedCliente.contactos.map((c) => (
                      <div key={c.id} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-zinc-900 dark:text-white">{c.nombre}</p>
                          {c.principal && <Badge variant="info">Principal</Badge>}
                        </div>
                        {c.cargo && <p className="text-xs text-zinc-500 mt-0.5">{c.cargo}</p>}
                        <div className="mt-2 space-y-1">
                          {c.email && (
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                              <Mail className="h-3 w-3" /> {c.email}
                            </div>
                          )}
                          {c.telefono && (
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                              <Phone className="h-3 w-3" /> {c.telefono}
                            </div>
                          )}
                          {c.fechaCumpleanos && (
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                              <Cake className="h-3 w-3" /> Cumpleaños: {(() => {
                                const d = new Date(c.fechaCumpleanos + "T00:00:00");
                                return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
                              })()}
                            </div>
                          )}
                        </div>
                        {c.notas && (
                          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">{c.notas}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Relevamiento de consumo */}
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-orange-500" />
                  Relevamiento de consumo
                </h3>

                {consumoData.loading ? (
                  <div className="flex items-center gap-2 py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                    <span className="text-xs text-zinc-500">Analizando consumo...</span>
                  </div>
                ) : consumoData.categorias.length === 0 && consumoData.cantidadPresupuestos === 0 ? (
                  <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800/50">
                    <ShoppingBag className="mx-auto h-6 w-6 text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-2 text-xs text-zinc-400">Sin presupuestos aprobados para este cliente</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Summary stats */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-orange-50 p-3 dark:bg-orange-900/20">
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="h-3.5 w-3.5 text-orange-500" />
                          <p className="text-xs text-orange-600 dark:text-orange-400">Total facturado</p>
                        </div>
                        <p className="mt-1 text-sm font-bold text-orange-700 dark:text-orange-300">
                          {formatCurrency(consumoData.totalFacturado)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5 text-zinc-400" />
                          <p className="text-xs text-zinc-500">Frecuencia</p>
                        </div>
                        <p className="mt-1 text-sm font-bold text-zinc-700 dark:text-zinc-200">
                          {consumoData.cantidadPresupuestos} presupuesto{consumoData.cantidadPresupuestos !== 1 ? "s" : ""} aprobado{consumoData.cantidadPresupuestos !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {consumoData.ultimaCompra && (
                      <div>
                        <p className="text-xs text-zinc-500">Ultima compra aprobada</p>
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {new Date(consumoData.ultimaCompra + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
                        </p>
                      </div>
                    )}

                    {/* Category breakdown with bars */}
                    {consumoData.categorias.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-zinc-500 mb-2">Categorias compradas</p>
                        <div className="space-y-2.5">
                          {consumoData.categorias.map((cat) => {
                            const maxTotal = consumoData.categorias[0].total;
                            const pct = maxTotal > 0 ? (cat.total / maxTotal) * 100 : 0;
                            return (
                              <div key={cat.categoria}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                    {cat.categoria}
                                  </span>
                                  <span className="text-xs text-zinc-500">
                                    {cat.cantidad} u. &middot; {formatCurrency(cat.total)}
                                  </span>
                                </div>
                                <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-500"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <Badge variant={selectedCliente.activo ? "success" : "danger"}>
                  {selectedCliente.activo ? "Activo" : "Inactivo"}
                </Badge>
              </div>
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
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                {editingId ? "Editar cliente" : "Nuevo cliente"}
              </h2>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Razon social *</label>
                <input value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">CUIT *</label>
                <input value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} placeholder="XX-XXXXXXXX-X" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Tipo</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="empresa">Empresa</option>
                  <option value="persona">Persona</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Condicion IVA</label>
                <select value={form.condicion_iva} onChange={(e) => setForm({ ...form, condicion_iva: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  {Object.entries(condicionLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Telefono</label>
                <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Direccion</label>
                <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Localidad</label>
                <input value={form.localidad} onChange={(e) => setForm({ ...form, localidad: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Provincia</label>
                <select value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="">Seleccionar...</option>
                  {provincias.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Codigo Postal</label>
                <input value={form.cp} onChange={(e) => setForm({ ...form, cp: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Lista de precios</label>
                <select value={form.lista_precio} onChange={(e) => setForm({ ...form, lista_precio: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="A">Lista A</option>
                  <option value="B">Lista B</option>
                  <option value="C">Lista C</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Forma de pago</label>
                <select value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="Transferencia">Transferencia</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Cuenta corriente">Cuenta corriente</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Dias cuenta corriente</label>
                <input type="number" value={form.dias_cuenta_corriente} onChange={(e) => setForm({ ...form, dias_cuenta_corriente: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Limite de credito</label>
                <input type="number" value={form.limite_credito} onChange={(e) => setForm({ ...form, limite_credito: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Notas</label>
                <textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "Guardar cambios" : "Crear cliente"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
