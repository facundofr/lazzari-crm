"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { mockClients, mockPresupuestos, mockFacturas } from "@/lib/mock-data";
import type { Client } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import {
  Search, Download, MapPin, Phone, Mail, Loader2, Building2,
  Plus, X, Pencil, Trash2, ToggleLeft, ToggleRight,
  BarChart3, ShoppingBag, CalendarDays, TrendingUp, Cake,
  User, FileText, CreditCard, StickyNote, Clock, Receipt, Truck, Wallet,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/lib/auth-context";

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
      id: s.id as string,
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

type DetailTab = "datos" | "contactos" | "sucursales" | "historial" | "actividad";

interface TimelineEvent {
  id: string;
  tipo: "presupuesto" | "factura" | "remito" | "movimiento";
  fecha: string;
  titulo: string;
  detalle: string;
  estado?: string;
}

export default function ClientesPage() {
  const { sociedadActiva } = useUser();
  const [view, setView] = useState<"table" | "cards">("table");
  const [search, setSearch] = useState("");
  const [clientes, setClientes] = useState<ClienteExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Filters
  const filterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha alta", type: "date-range" },
    { key: "provincia", label: "Provincia", type: "select", options: provincias.map(p => ({ value: p, label: p })) },
    { key: "condicionIva", label: "Condición IVA", type: "select", options: [
      { value: "RI", label: "Resp. Inscripto" }, { value: "Monotributo", label: "Monotributo" },
      { value: "Exento", label: "Exento" }, { value: "CF", label: "Cons. Final" }
    ]},
    { key: "formaPago", label: "Forma de pago", type: "select", options: [
      { value: "Efectivo", label: "Efectivo" }, { value: "Cuenta corriente", label: "Cuenta corriente" },
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
  const [detailTab, setDetailTab] = useState<DetailTab>("datos");

  // Timeline / Activity
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

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
        const { data: facturas, error: factError } = await supabase
          .from("facturas")
          .select("total")
          .eq("cliente_id", clienteId);

        if (presError || factError) {
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

        const totalFacturado = facturas
          ? facturas.reduce((sum, f) => sum + (f.total || 0), 0)
          : 0;

        setConsumoData({
          categorias,
          totalFacturado,
          cantidadPresupuestos: presupuestos.length,
          ultimaCompra: presupuestos.length > 0 ? (presupuestos[0] as any).fecha : null,
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

  // Fetch timeline when actividad tab is selected
  useEffect(() => {
    if (!selectedCliente || detailTab !== "actividad") return;
    const clienteId = selectedCliente.id;
    setTimelineLoading(true);

    async function fetchTimeline() {
      const events: TimelineEvent[] = [];
      try {
        // Presupuestos
        const { data: prs } = await supabase
          .from("presupuestos")
          .select("id, numero, fecha, total, estado, moneda")
          .eq("cliente_id", clienteId)
          .order("fecha", { ascending: false })
          .limit(20);
        if (prs) {
          for (const p of prs) {
            events.push({
              id: `pr-${p.id}`,
              tipo: "presupuesto",
              fecha: p.fecha,
              titulo: `Presupuesto ${p.numero || ""}`,
              detalle: `${formatCurrency(Number(p.total), (p.moneda as "ARS" | "USD") || "ARS")}`,
              estado: p.estado,
            });
          }
        }

        // Facturas
        const { data: facts } = await supabase
          .from("facturas")
          .select("id, tipo, numero, punto_venta, fecha, total, estado, moneda")
          .eq("cliente_id", clienteId)
          .order("fecha", { ascending: false })
          .limit(20) as { data: any[] | null };
        if (facts) {
          for (const f of facts) {
            const comprobante = `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
            events.push({
              id: `fact-${f.id}`,
              tipo: "factura",
              fecha: f.fecha,
              titulo: `Factura ${comprobante}`,
              detalle: `${formatCurrency(Number(f.total), (f.moneda as "ARS" | "USD") || "ARS")}`,
              estado: f.estado,
            });
          }
        }

        // Remitos
        const { data: rems } = await supabase
          .from("remitos")
          .select("id, numero, fecha, estado")
          .eq("cliente_id", clienteId)
          .order("fecha", { ascending: false })
          .limit(20);
        if (rems) {
          for (const r of rems) {
            events.push({
              id: `rem-${r.id}`,
              tipo: "remito",
              fecha: r.fecha,
              titulo: `Remito ${r.numero || ""}`,
              detalle: r.estado === "entregado" ? "Entregado" : r.estado === "parcial" ? "Entrega parcial" : "Pendiente",
              estado: r.estado,
            });
          }
        }

        // Movimientos (cobros)
        const { data: movs } = await supabase
          .from("movimientos")
          .select("id, tipo, fecha, monto, descripcion, moneda")
          .eq("cliente_id", clienteId)
          .order("fecha", { ascending: false })
          .limit(20);
        if (movs) {
          for (const m of movs) {
            events.push({
              id: `mov-${m.id}`,
              tipo: "movimiento",
              fecha: m.fecha,
              titulo: m.tipo === "cobro" ? "Cobro recibido" : m.tipo === "pago" ? "Pago" : (m.tipo || "Movimiento"),
              detalle: `${formatCurrency(Number(m.monto), (m.moneda as "ARS" | "USD") || "ARS")}${m.descripcion ? ` — ${m.descripcion}` : ""}`,
            });
          }
        }

        // Sort all events by date descending
        events.sort((a, b) => b.fecha.localeCompare(a.fecha));
        setTimeline(events);
      } catch (err) {
        console.error("Error fetching timeline:", err);
        setTimeline([]);
      } finally {
        setTimelineLoading(false);
      }
    }

    fetchTimeline();
  }, [selectedCliente, detailTab]);

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
      let query = supabase
        .from("clientes")
        .select(`*, assigned_profile:assigned_to(full_name), cliente_sucursales(*)`);

      if (sociedadActiva?.id) {
        query = query.eq("sociedad_id" as any, sociedadActiva.id);
      }

      const { data, error } = await query.order("razon_social");

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
  }, [sociedadActiva]);

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
        toast.success("Cliente actualizado correctamente");
      } else {
        const { error } = await supabase
          .from("clientes")
          .insert(form as any);
        if (error) throw error;
        toast.success("Cliente creado correctamente");
      }
      setModalOpen(false);
      await fetchClientes();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al guardar";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActivo(c: ClienteExt) {
    try {
      await supabase.from("clientes").update({ activo: !c.activo }).eq("id", c.id);
      toast.info(c.activo ? "Cliente desactivado" : "Cliente activado");
      await fetchClientes();
    } catch (err) {
      console.error("Error toggling activo:", err);
      toast.error("Error al cambiar estado del cliente");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Seguro que queres eliminar este cliente? Esta accion no se puede deshacer.")) return;
    try {
      await supabase.from("clientes").delete().eq("id", id);
      setSelectedCliente(null);
      toast.success("Cliente eliminado");
      await fetchClientes();
    } catch (err) {
      console.error("Error deleting cliente:", err);
      toast.error("Error al eliminar cliente");
    }
  }

  // Helpers
  function getInitials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
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

  // Detail panel tab configs
  const detailTabs: { key: DetailTab; label: string; icon: React.ReactNode }[] = [
    { key: "datos", label: "Datos", icon: <FileText className="h-3.5 w-3.5" /> },
    { key: "contactos", label: "Contactos", icon: <User className="h-3.5 w-3.5" /> },
    { key: "sucursales", label: "Sucursales", icon: <Building2 className="h-3.5 w-3.5" /> },
    { key: "historial", label: "Historial", icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { key: "actividad", label: "Actividad", icon: <Clock className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <Header
        title="Clientes"
        subtitle={`${activos} clientes activos`}
        action={{ label: "Nuevo cliente", onClick: openCreate }}
      />
      <div className="p-4 sm:p-8 space-y-6">
        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
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
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Total clientes</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold">{clientes.length}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Saldo total CC</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold">{formatCurrency(clientes.reduce((a, c) => a + c.saldoCuentaCorriente, 0))}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Credito otorgado</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold">{formatCurrency(clientes.reduce((a, c) => a + c.limiteCredito, 0))}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Provincias</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold">{new Set(clientes.map((c) => c.provincia)).size}</p>
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
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 font-bold text-xs dark:bg-orange-900/30 dark:text-orange-400">
                        {getInitials(row.razonSocial)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-900 dark:text-white truncate">{row.razonSocial}</p>
                        <p className="text-xs text-zinc-400">{row.cuit}</p>
                      </div>
                    </div>
                  ),
                },
                { key: "localidad", label: "Ubicación", sortable: true, render: (row) => (
                  <span className="text-xs text-zinc-500">{row.localidad}{row.provincia ? `, ${row.provincia}` : ""}</span>
                )},
                { key: "sucursales", label: "Suc.", sortable: false, render: (row) => {
                  const n = row.sucursales?.length || 0;
                  return n > 0 ? (
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      <Building2 className="h-3 w-3" /> {n}
                    </div>
                  ) : <span className="text-zinc-300 dark:text-zinc-600">—</span>;
                }},
                { key: "saldoCuentaCorriente", label: "Saldo CC", className: "text-right", sortable: true, render: (row) => <span className="font-mono text-xs block text-right">{formatCurrency(row.saldoCuentaCorriente)}</span> },
                { key: "activo", label: "Estado", sortable: true, render: (row) => <Badge variant={row.activo ? "success" : "danger"}>{row.activo ? "Activo" : "Inactivo"}</Badge> },
                {
                  key: "actions", label: "", sortable: false,
                  render: (row) => (
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleToggleActivo(row); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" title={row.activo ? "Desactivar" : "Activar"}>
                        {row.activo ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ),
                },
              ]}
              data={filtered}
              onRowClick={(row) => { setSelectedCliente(row); setDetailTab("datos"); }}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((client) => (
              <Card key={client.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setSelectedCliente(client); setDetailTab("datos"); }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 font-bold text-sm dark:bg-orange-900/30 dark:text-orange-400">
                      {getInitials(client.razonSocial)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-900 dark:text-white truncate">{client.razonSocial}</p>
                      <p className="text-xs text-zinc-400">{client.cuit}</p>
                    </div>
                  </div>
                  <Badge variant={client.activo ? "success" : "danger"}>
                    {client.activo ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <div className="mt-4 space-y-2 text-sm text-zinc-500">
                  <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{client.localidad}, {client.provincia}</span></div>
                  <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" /> {client.telefono ? <a href={`tel:${client.telefono}`} className="hover:text-orange-500">{client.telefono}</a> : "—"}</div>
                  <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0" /> {client.email ? <a href={`mailto:${client.email}`} className="hover:text-orange-500 truncate">{client.email}</a> : <span className="truncate">—</span>}</div>
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

      {/* ===================== DETAIL SIDE PANEL ===================== */}
      {selectedCliente && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 animate-fade-in" onClick={() => setSelectedCliente(null)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right">
            {/* Panel header with avatar */}
            <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-4 p-4 sm:p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 text-white font-bold text-lg shadow-md">
                  {getInitials(selectedCliente.razonSocial)}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white truncate">{selectedCliente.razonSocial}</h2>
                  <p className="text-sm text-zinc-500">{selectedCliente.cuit}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { openEdit(selectedCliente); setSelectedCliente(null); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(selectedCliente.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors" title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => setSelectedCliente(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors" title="Cerrar">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-0 px-4 sm:px-6">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setDetailTab(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                      detailTab === tab.key
                        ? "border-orange-500 text-orange-600 dark:text-orange-400"
                        : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    }`}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="p-4 sm:p-6 space-y-6">

              {/* ---- TAB: DATOS ---- */}
              {detailTab === "datos" && (
                <>
                  {/* Status + Type badges */}
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedCliente.activo ? "success" : "danger"}>
                      {selectedCliente.activo ? "Activo" : "Inactivo"}
                    </Badge>
                    <Badge variant="info">{selectedCliente.type === "empresa" ? "Empresa" : "Persona"}</Badge>
                  </div>

                  {/* General info */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Informacion general</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <InfoField label="Condicion IVA" value={condicionLabels[selectedCliente.condicionIva]} />
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Email</p>
                        <p className="text-sm font-medium mt-0.5">{selectedCliente.email ? <a href={`mailto:${selectedCliente.email}`} className="text-orange-600 hover:underline">{selectedCliente.email}</a> : "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Telefono</p>
                        <p className="text-sm font-medium mt-0.5">{selectedCliente.telefono ? <a href={`tel:${selectedCliente.telefono}`} className="text-orange-600 hover:underline">{selectedCliente.telefono}</a> : "—"}</p>
                      </div>
                      <InfoField label="Vendedor" value={selectedCliente.vendedorNombre} />
                      <div className="sm:col-span-2">
                        <InfoField
                          label="Direccion"
                          value={[selectedCliente.direccion, selectedCliente.localidad, selectedCliente.provincia, selectedCliente.cp].filter(Boolean).join(", ") || "—"}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Commercial info */}
                  <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Datos comerciales</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <InfoField label="Lista de precios" value={selectedCliente.listaPrecio || "—"} />
                      <InfoField label="Forma de pago" value={selectedCliente.formaPago || "—"} />
                      <InfoField label="Dias CC" value={String(selectedCliente.diasCuentaCorriente)} />
                      <InfoField label="Limite credito" value={formatCurrency(selectedCliente.limiteCredito)} />
                      <InfoField label="Saldo CC" value={formatCurrency(selectedCliente.saldoCuentaCorriente)} highlight />
                    </div>
                  </div>

                  {/* Notes */}
                  {selectedCliente.notas && (
                    <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
                        <StickyNote className="h-3.5 w-3.5" /> Notas
                      </h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3">{selectedCliente.notas}</p>
                    </div>
                  )}
                </>
              )}

              {/* ---- TAB: CONTACTOS ---- */}
              {detailTab === "contactos" && (
                <>
                  {(!selectedCliente.contactos || selectedCliente.contactos.length === 0) ? (
                    <EmptyState icon={<User className="h-6 w-6" />} text="Sin contactos registrados" />
                  ) : (
                    <div className="space-y-3">
                      {/* Group by sucursal */}
                      {(() => {
                        const sucursalMap = new Map<string, string>();
                        for (const s of selectedCliente.sucursales ?? []) {
                          sucursalMap.set(s.id, s.nombre);
                        }

                        const grouped: Record<string, typeof selectedCliente.contactos> = {};
                        for (const c of selectedCliente.contactos ?? []) {
                          const key = c.sucursalId && sucursalMap.has(c.sucursalId) ? c.sucursalId : "__general__";
                          if (!grouped[key]) grouped[key] = [];
                          grouped[key].push(c);
                        }

                        return Object.entries(grouped).map(([key, contacts]) => (
                          <div key={key}>
                            {key !== "__general__" && (
                              <p className="text-xs font-semibold text-zinc-500 mb-2 flex items-center gap-1.5">
                                <Building2 className="h-3 w-3 text-orange-500" />
                                {sucursalMap.get(key)}
                              </p>
                            )}
                            {key === "__general__" && Object.keys(grouped).length > 1 && (
                              <p className="text-xs font-semibold text-zinc-500 mb-2">Contactos generales</p>
                            )}
                            <div className="space-y-2">
                              {contacts.map((c) => (
                                <div key={c.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 bg-white dark:bg-zinc-800/50">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 font-medium text-xs dark:bg-zinc-700 dark:text-zinc-300">
                                        {getInitials(c.nombre)}
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium text-zinc-900 dark:text-white">{c.nombre}</p>
                                        {c.cargo && <p className="text-xs text-zinc-500">{c.cargo}</p>}
                                      </div>
                                    </div>
                                    {c.principal && <Badge variant="info">Principal</Badge>}
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-10">
                                    {c.email && (
                                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                        <Mail className="h-3 w-3" /> {c.email}
                                      </div>
                                    )}
                                    {c.telefono && (
                                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                        <Phone className="h-3 w-3" /> {c.telefono}
                                      </div>
                                    )}
                                    {c.fechaCumpleanos && (
                                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                        <Cake className="h-3 w-3" /> {(() => {
                                          const d = new Date(c.fechaCumpleanos + "T00:00:00");
                                          return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  {c.notas && <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500 pl-10">{c.notas}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </>
              )}

              {/* ---- TAB: SUCURSALES ---- */}
              {detailTab === "sucursales" && (
                <>
                  {(!selectedCliente.sucursales || selectedCliente.sucursales.length === 0) ? (
                    <EmptyState icon={<Building2 className="h-6 w-6" />} text="Sin sucursales registradas" />
                  ) : (
                    <div className="space-y-3">
                      {selectedCliente.sucursales.map((s) => {
                        const contactosSuc = (selectedCliente.contactos ?? []).filter((c) => c.sucursalId === s.id);
                        return (
                          <div key={s.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                            <div className="bg-zinc-50 p-3 dark:bg-zinc-800/50">
                              <p className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                                <Building2 className="h-3.5 w-3.5 text-orange-500" />
                                {s.nombre}
                              </p>
                              {(s.direccion || s.localidad || s.provincia) && (
                                <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-500">
                                  <MapPin className="h-3 w-3" />
                                  {[s.direccion, s.localidad, s.provincia].filter(Boolean).join(", ")}
                                </div>
                              )}
                              <div className="flex gap-4 mt-1">
                                {s.telefono && (
                                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                    <Phone className="h-3 w-3" /> {s.telefono}
                                  </div>
                                )}
                                {s.email && (
                                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                    <Mail className="h-3 w-3" /> {s.email}
                                  </div>
                                )}
                              </div>
                            </div>
                            {contactosSuc.length > 0 && (
                              <div className="border-t border-zinc-100 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
                                {contactosSuc.map((c) => (
                                  <div key={c.id} className="px-3 py-2.5 bg-white dark:bg-zinc-900">
                                    <div className="flex items-center justify-between">
                                      <p className="text-sm font-medium text-zinc-900 dark:text-white">{c.nombre}</p>
                                      {c.principal && <Badge variant="info">Principal</Badge>}
                                    </div>
                                    {c.cargo && <p className="text-xs text-zinc-500 mt-0.5">{c.cargo}</p>}
                                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                                      {c.email && (
                                        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                          <Mail className="h-3 w-3" /> {c.email}
                                        </div>
                                      )}
                                      {c.telefono && (
                                        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                          <Phone className="h-3 w-3" /> {c.telefono}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {contactosSuc.length === 0 && (
                              <div className="px-3 py-2 bg-white dark:bg-zinc-900 text-xs text-zinc-400 italic">Sin contactos asignados</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ---- TAB: HISTORIAL (Consumo) ---- */}
              {detailTab === "historial" && (
                <>
                  {consumoData.loading ? (
                    <div className="flex items-center gap-2 py-8 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                      <span className="text-xs text-zinc-500">Analizando consumo...</span>
                    </div>
                  ) : consumoData.categorias.length === 0 && consumoData.cantidadPresupuestos === 0 ? (
                    <EmptyState icon={<ShoppingBag className="h-6 w-6" />} text="Sin presupuestos aprobados para este cliente" />
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
                </>
              )}

              {detailTab === "actividad" && (
                <>
                  {timelineLoading ? (
                    <div className="flex items-center gap-2 py-8 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                      <span className="text-xs text-zinc-500">Cargando actividad...</span>
                    </div>
                  ) : timeline.length === 0 ? (
                    <EmptyState icon={<Clock className="h-6 w-6" />} text="Sin actividad registrada para este cliente" />
                  ) : (
                    <div className="relative">
                      {/* Vertical line */}
                      <div className="absolute left-4 top-2 bottom-2 w-px bg-zinc-200 dark:bg-zinc-700" />
                      <div className="space-y-0">
                        {timeline.map((ev, idx) => {
                          const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
                            presupuesto: { icon: <FileText className="h-3.5 w-3.5" />, color: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400" },
                            factura: { icon: <Receipt className="h-3.5 w-3.5" />, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400" },
                            remito: { icon: <Truck className="h-3.5 w-3.5" />, color: "bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-400" },
                            movimiento: { icon: <Wallet className="h-3.5 w-3.5" />, color: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400" },
                          };
                          const cfg = iconMap[ev.tipo] || iconMap.presupuesto;
                          // Group by month
                          const evDate = new Date(ev.fecha + "T00:00:00");
                          const monthLabel = evDate.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
                          const prevDate = idx > 0 ? new Date(timeline[idx - 1].fecha + "T00:00:00") : null;
                          const prevMonth = prevDate ? prevDate.toLocaleDateString("es-AR", { month: "long", year: "numeric" }) : null;
                          const showMonth = monthLabel !== prevMonth;

                          return (
                            <div key={ev.id}>
                              {showMonth && (
                                <p className="ml-10 text-xs font-semibold uppercase tracking-wider text-zinc-400 pt-4 pb-1 first:pt-0">
                                  {monthLabel}
                                </p>
                              )}
                              <div className="flex items-start gap-3 py-2 pl-1">
                                <div className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${cfg.color}`}>
                                  {cfg.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium dark:text-white truncate">{ev.titulo}</p>
                                    {ev.estado && (
                                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                        ev.estado === "aprobado" || ev.estado === "emitida" || ev.estado === "entregado" || ev.estado === "pagada"
                                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                          : ev.estado === "rechazado" || ev.estado === "cancelada"
                                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                      }`}>
                                        {ev.estado}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-zinc-500 mt-0.5">{ev.detalle}</p>
                                  <p className="text-[10px] text-zinc-400 mt-0.5">{formatDate(ev.fecha)}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ===================== CREATE / EDIT MODAL ===================== */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Editar cliente" : "Nuevo cliente"}
        description={editingId ? "Modifica los datos del cliente" : "Completa los datos para crear un nuevo cliente"}
        size="lg"
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId ? "Guardar cambios" : "Crear cliente"}
            </button>
          </>
        }
      >
        {formError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
            {formError}
          </div>
        )}

        <div className="space-y-5">
          {/* Section: Identificacion */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Identificacion</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Input
                  label="Razon social *"
                  value={form.razon_social}
                  onChange={(e) => setForm({ ...form, razon_social: e.target.value })}
                  placeholder="Nombre o razon social"
                />
              </div>
              <Input
                label="CUIT *"
                value={form.cuit}
                onChange={(e) => setForm({ ...form, cuit: e.target.value })}
                placeholder="XX-XXXXXXXX-X"
              />
              <Select
                label="Tipo"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                options={[
                  { value: "empresa", label: "Empresa" },
                  { value: "persona", label: "Persona" },
                ]}
              />
              <Select
                label="Condicion IVA"
                value={form.condicion_iva}
                onChange={(e) => setForm({ ...form, condicion_iva: e.target.value })}
                options={Object.entries(condicionLabels).map(([k, v]) => ({ value: k, label: v }))}
              />
            </div>
          </div>

          {/* Section: Contacto */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Contacto</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <Input
                label="Telefono"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              />
            </div>
          </div>

          {/* Section: Ubicacion */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Ubicacion</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Direccion"
                value={form.direccion}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              />
              <Input
                label="Localidad"
                value={form.localidad}
                onChange={(e) => setForm({ ...form, localidad: e.target.value })}
              />
              <Select
                label="Provincia"
                value={form.provincia}
                onChange={(e) => setForm({ ...form, provincia: e.target.value })}
                options={provincias.map((p) => ({ value: p, label: p }))}
                placeholder="Seleccionar..."
              />
              <Input
                label="Codigo Postal"
                value={form.cp}
                onChange={(e) => setForm({ ...form, cp: e.target.value })}
              />
            </div>
          </div>

          {/* Section: Comercial */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Datos comerciales</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Lista de precios"
                value={form.lista_precio}
                onChange={(e) => setForm({ ...form, lista_precio: e.target.value })}
                options={[
                  { value: "A", label: "Lista A" },
                  { value: "B", label: "Lista B" },
                  { value: "C", label: "Lista C" },
                ]}
              />
              <Select
                label="Forma de pago"
                value={form.forma_pago}
                onChange={(e) => setForm({ ...form, forma_pago: e.target.value })}
                options={[
                  { value: "Transferencia", label: "Transferencia" },
                  { value: "Cheque", label: "Cheque" },
                  { value: "Efectivo", label: "Efectivo" },
                  { value: "Cuenta corriente", label: "Cuenta corriente" },
                ]}
              />
              <Input
                label="Dias cuenta corriente"
                type="number"
                value={String(form.dias_cuenta_corriente)}
                onChange={(e) => setForm({ ...form, dias_cuenta_corriente: Number(e.target.value) })}
              />
              <Input
                label="Limite de credito"
                type="number"
                value={String(form.limite_credito)}
                onChange={(e) => setForm({ ...form, limite_credito: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Notas */}
          <Textarea
            label="Notas"
            value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })}
            rows={3}
          />
        </div>
      </Modal>
    </>
  );
}

/* ===================== HELPER COMPONENTS ===================== */

function InfoField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${highlight ? "text-orange-600 dark:text-orange-400 font-semibold" : "text-zinc-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="mx-auto text-zinc-300 dark:text-zinc-600">{icon}</div>
      <p className="mt-2 text-sm text-zinc-400">{text}</p>
    </div>
  );
}
