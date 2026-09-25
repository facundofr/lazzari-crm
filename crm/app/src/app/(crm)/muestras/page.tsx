"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import {
  ArrowLeftRight, CheckCircle2, Clock3, Edit3, Eye, Loader2,
  MapPin, Package, Plus, RotateCcw, Search, Shirt, X,
  Maximize2, Minimize2, Trash2,
} from "lucide-react";

interface MuestraProducto {
  id: string;
  sociedad_id: string;
  codigo: string;
  descripcion: string;
  talle: string | null;
  color: string | null;
  stock_total: number;
  activo: boolean;
}

interface MuestraEnvio {
  id: string;
  sociedad_id: string;
  numero: string;
  fecha: string;
  fecha_devolucion: string | null;
  moneda: "ARS" | "USD";
  cliente_id: string;
  sucursal_id: string | null;
  estado: "en_cliente" | "parcial" | "devuelto";
  observaciones: string | null;
  created_by: string | null;
  created_by_profile?: { full_name: string } | null;
  created_at: string;
}

interface MuestraItem {
  id: string;
  envio_id: string;
  producto_id: string;
  cantidad: number;
  cantidad_devuelta: number;
  precio_unitario: number | null;
}

interface ClienteOption { id: string; razon_social: string }
interface SucursalOption { id: string; cliente_id: string; nombre: string; direccion: string | null; localidad: string | null }
interface DraftItem {
  producto_id: string;
  codigo: string;
  descripcion: string;
  talle: string;
  color: string;
  stock_total: number;
  cantidad: number;
  precio_unitario: number | null;
}

const emptyProducto = { codigo: "", descripcion: "", talle: "", color: "", stock_total: 0 };
const emptyDraftItem: DraftItem = { producto_id: "", codigo: "", descripcion: "", talle: "", color: "", stock_total: 1, cantidad: 1, precio_unitario: null };

const estadoConfig = {
  en_cliente: { label: "Entregado", variant: "warning" as const },
  parcial: { label: "Entregado · devolución parcial", variant: "info" as const },
  devuelto: { label: "Devuelto", variant: "success" as const },
};

export default function MuestrasPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;

  const [tab, setTab] = useState<"envios" | "inventario">("envios");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<"todos" | MuestraEnvio["estado"]>("todos");
  const [productos, setProductos] = useState<MuestraProducto[]>([]);
  const [envios, setEnvios] = useState<MuestraEnvio[]>([]);
  const [items, setItems] = useState<MuestraItem[]>([]);
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [selectedEnvio, setSelectedEnvio] = useState<MuestraEnvio | null>(null);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [activeItemSearch, setActiveItemSearch] = useState<number | null>(null);

  const [envioModal, setEnvioModal] = useState(false);
  const [envioForm, setEnvioForm] = useState({ fecha: todayAR(), cliente_id: "", sucursal_id: "", moneda: "ARS" as "ARS" | "USD", observaciones: "" });
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ ...emptyDraftItem }]);

  const [productoModal, setProductoModal] = useState(false);
  const [editingProductoId, setEditingProductoId] = useState<string | null>(null);
  const [productoForm, setProductoForm] = useState(emptyProducto);
  const [returnDraft, setReturnDraft] = useState<Record<string, number>>({});
  const [returnDateDraft, setReturnDateDraft] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    if (!sociedadId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [prodRes, envRes, itemRes, cliRes, sucRes] = await Promise.all([
        (supabase as any).from("muestra_productos").select("*").eq("sociedad_id", sociedadId).order("descripcion"),
        (supabase as any).from("muestra_envios").select("*, created_by_profile:created_by(full_name)").eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("created_at", { ascending: false }),
        (supabase as any).from("muestra_envio_items").select("*"),
        (supabase as any).from("clientes").select("id, razon_social").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"),
        (supabase as any).from("cliente_sucursales").select("id, cliente_id, nombre, direccion, localidad").eq("activo", true).order("principal", { ascending: false }),
      ]);
      const firstError = [prodRes.error, envRes.error, itemRes.error, cliRes.error, sucRes.error].find(Boolean);
      if (firstError) throw firstError;
      setProductos(prodRes.data || []);
      setEnvios(envRes.data || []);
      // Los items y sucursales no tienen sociedad_id propio: se restringen
      // por sus entidades padre para no mezclar sociedades.
      const envioIds = new Set((envRes.data || []).map((envio: any) => envio.id));
      const clienteIds = new Set((cliRes.data || []).map((cliente: any) => cliente.id));
      setItems((itemRes.data || []).filter((item: any) => envioIds.has(item.envio_id)));
      setClientes(cliRes.data || []);
      setSucursales((sucRes.data || []).filter((sucursal: any) => clienteIds.has(sucursal.cliente_id)));
    } catch (error: any) {
      console.error("Error cargando muestras:", error);
      toast.error(`No se pudieron cargar las muestras: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [sociedadId, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!selectedEnvio) return;
    const fresh = envios.find((envio) => envio.id === selectedEnvio.id);
    if (fresh) setSelectedEnvio(fresh);
  }, [envios, selectedEnvio?.id]);

  const clienteMap = useMemo(() => new Map(clientes.map((cliente) => [cliente.id, cliente.razon_social])), [clientes]);
  const sucursalMap = useMemo(() => new Map(sucursales.map((sucursal) => [sucursal.id, sucursal])), [sucursales]);
  const productoMap = useMemo(() => new Map(productos.map((producto) => [producto.id, producto])), [productos]);

  const asignadoPorProducto = useMemo(() => {
    const result = new Map<string, number>();
    items.forEach((item) => result.set(item.producto_id, (result.get(item.producto_id) || 0) + item.cantidad - item.cantidad_devuelta));
    return result;
  }, [items]);

  const disponibles = (producto: MuestraProducto) => producto.stock_total - (asignadoPorProducto.get(producto.id) || 0);
  const totalPrendas = productos.filter((p) => p.activo).reduce((sum, p) => sum + p.stock_total, 0);
  const totalEnClientes = items.reduce((sum, item) => sum + item.cantidad - item.cantidad_devuelta, 0);

  const envioItems = (envioId: string) => items.filter((item) => item.envio_id === envioId);
  const cantidadPendienteEnvio = (envioId: string) => envioItems(envioId).reduce((sum, item) => sum + item.cantidad - item.cantidad_devuelta, 0);
  const cantidadTotalEnvio = (envioId: string) => envioItems(envioId).reduce((sum, item) => sum + item.cantidad, 0);

  const filteredEnvios = envios.filter((envio) => {
    if (estadoFilter !== "todos" && envio.estado !== estadoFilter) return false;
    if (!search.trim()) return true;
    const needle = search.toLowerCase();
    const itemText = envioItems(envio.id).map((item) => productoMap.get(item.producto_id)?.descripcion || "").join(" ").toLowerCase();
    return envio.numero.toLowerCase().includes(needle)
      || (clienteMap.get(envio.cliente_id) || "").toLowerCase().includes(needle)
      || itemText.includes(needle);
  });

  const filteredProductos = productos.filter((producto) => {
    const needle = search.toLowerCase();
    return !needle || [producto.codigo, producto.descripcion, producto.talle || "", producto.color || ""].join(" ").toLowerCase().includes(needle);
  });

  function openNuevoEnvio() {
    setEnvioForm({ fecha: todayAR(), cliente_id: "", sucursal_id: "", moneda: "ARS", observaciones: "" });
    setDraftItems([{ ...emptyDraftItem }]);
    setClientSearch("");
    setActiveItemSearch(null);
    setEnvioModal(true);
  }

  function seleccionarProducto(index: number, producto: MuestraProducto) {
    setDraftItems((prev) => prev.map((item, itemIndex) => itemIndex === index ? {
      producto_id: producto.id,
      codigo: producto.codigo,
      descripcion: producto.descripcion,
      talle: producto.talle || "",
      color: producto.color || "",
      stock_total: producto.stock_total,
      cantidad: Math.max(1, Math.min(item.cantidad || 1, Math.max(disponibles(producto), 1))),
      precio_unitario: item.precio_unitario,
    } : item));
    setActiveItemSearch(null);
  }

  function updateDraftItem(index: number, patch: Partial<DraftItem>, detach = false) {
    setDraftItems((prev) => prev.map((item, itemIndex) => itemIndex === index
      ? { ...item, ...(detach ? { producto_id: "" } : {}), ...patch }
      : item));
  }

  async function eliminarEnvio(envio: MuestraEnvio) {
    if (!confirm(`¿Eliminar ${envio.numero}? Las prendas volverán a quedar disponibles.`)) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("muestra_envios").delete().eq("id", envio.id).eq("sociedad_id", sociedadId);
      if (error) throw error;
      setSelectedEnvio(null);
      setPanelFullscreen(false);
      toast.success("Registro de muestras eliminado");
      await fetchData();
    } catch (error: any) {
      toast.error(`No se pudo eliminar: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function openNuevoProducto(producto?: MuestraProducto) {
    if (producto) {
      setEditingProductoId(producto.id);
      setProductoForm({ codigo: producto.codigo, descripcion: producto.descripcion, talle: producto.talle || "", color: producto.color || "", stock_total: producto.stock_total });
    } else {
      setEditingProductoId(null);
      setProductoForm(emptyProducto);
    }
    setProductoModal(true);
  }

  async function handleSaveProducto() {
    if (!sociedadId) return;
    if (!productoForm.codigo.trim() || !productoForm.descripcion.trim()) { toast.error("Completá código y descripción"); return; }
    if (productoForm.stock_total < 0) { toast.error("La cantidad total no puede ser negativa"); return; }
    setSaving(true);
    try {
      const payload = {
        sociedad_id: sociedadId,
        codigo: productoForm.codigo.trim().toUpperCase(),
        descripcion: productoForm.descripcion.trim(),
        talle: productoForm.talle.trim() || null,
        color: productoForm.color.trim() || null,
        stock_total: Number(productoForm.stock_total),
        created_by: profile?.id || null,
      };
      const mutation = editingProductoId
        ? (supabase as any).from("muestra_productos").update({ ...payload, created_by: undefined }).eq("id", editingProductoId).eq("sociedad_id", sociedadId)
        : (supabase as any).from("muestra_productos").insert(payload);
      const { error } = await mutation;
      if (error) throw error;
      toast.success(editingProductoId ? "Muestra actualizada" : "Muestra agregada al inventario");
      setProductoModal(false);
      await fetchData();
    } catch (error: any) {
      toast.error(`No se pudo guardar: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateEnvio() {
    if (!sociedadId) return;
    if (!envioForm.cliente_id) { toast.error("Seleccioná un cliente"); return; }
    const cleanItems = draftItems.filter((item) => item.codigo.trim() && item.descripcion.trim() && item.cantidad > 0);
    if (cleanItems.length === 0) { toast.error("Agregá al menos una muestra"); return; }
    const itemKeys = cleanItems.map((item) => item.producto_id || item.codigo.trim().toLowerCase());
    if (new Set(itemKeys).size !== cleanItems.length) { toast.error("No repitas la misma muestra en el envío"); return; }
    const unavailable = cleanItems.find((item) => {
      if (!item.producto_id) return item.stock_total < item.cantidad;
      const producto = productoMap.get(item.producto_id);
      return !producto || item.cantidad > disponibles(producto);
    });
    if (unavailable) { toast.error("La cantidad a enviar no puede superar el stock disponible"); return; }

    setSaving(true);
    let envioId = "";
    try {
      const resolvedItems: { producto_id: string; cantidad: number; precio_unitario: number | null }[] = [];
      for (const item of cleanItems) {
        if (item.producto_id) {
          resolvedItems.push({ producto_id: item.producto_id, cantidad: item.cantidad, precio_unitario: item.precio_unitario });
          continue;
        }
        const existing = productos.find((producto) => producto.codigo.toLowerCase() === item.codigo.trim().toLowerCase());
        if (existing) {
          if (item.cantidad > disponibles(existing)) throw new Error(`Stock insuficiente para ${existing.codigo}`);
          resolvedItems.push({ producto_id: existing.id, cantidad: item.cantidad, precio_unitario: item.precio_unitario });
          continue;
        }
        const { data: created, error: createError } = await (supabase as any).from("muestra_productos").insert({
          sociedad_id: sociedadId,
          codigo: item.codigo.trim().toUpperCase(),
          descripcion: item.descripcion.trim(),
          talle: item.talle.trim() || null,
          color: item.color.trim() || null,
          stock_total: Math.max(Number(item.stock_total) || 0, Number(item.cantidad) || 0),
          created_by: profile?.id || null,
        }).select("id").single();
        if (createError || !created?.id) throw createError || new Error(`No se pudo crear ${item.codigo}`);
        resolvedItems.push({ producto_id: created.id, cantidad: item.cantidad, precio_unitario: item.precio_unitario });
      }

      const { data: envio, error: envioError } = await (supabase as any).from("muestra_envios").insert({
        sociedad_id: sociedadId,
        numero: "",
        fecha: envioForm.fecha,
        moneda: envioForm.moneda,
        cliente_id: envioForm.cliente_id,
        sucursal_id: envioForm.sucursal_id || null,
        estado: "en_cliente",
        observaciones: envioForm.observaciones.trim() || null,
        created_by: profile?.id || null,
      }).select("id").single();
      if (envioError || !envio?.id) throw envioError || new Error("No se pudo crear el envío");
      envioId = envio.id;
      const { error: itemError } = await (supabase as any).from("muestra_envio_items").insert(
        resolvedItems.map((item) => ({ envio_id: envioId, producto_id: item.producto_id, cantidad: item.cantidad, cantidad_devuelta: 0, precio_unitario: item.precio_unitario }))
      );
      if (itemError) throw itemError;
      toast.success("Muestras registradas en el cliente");
      setEnvioModal(false);
      await fetchData();
    } catch (error: any) {
      if (envioId) await (supabase as any).from("muestra_envios").delete().eq("id", envioId).eq("sociedad_id", sociedadId);
      toast.error(`No se pudo registrar el envío: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function registrarDevolucion(item: MuestraItem, cantidad: number, fechaDevolucion: string) {
    const pendiente = item.cantidad - item.cantidad_devuelta;
    if (cantidad <= 0 || cantidad > pendiente) { toast.error("Ingresá una cantidad válida para devolver"); return; }
    if (!fechaDevolucion) { toast.error("Indicá la fecha de devolución"); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("muestra_envio_items")
        .update({ cantidad_devuelta: item.cantidad_devuelta + cantidad }).eq("id", item.id).eq("envio_id", item.envio_id);
      if (error) throw error;

      const nextItems = envioItems(item.envio_id).map((current) => current.id === item.id
        ? { ...current, cantidad_devuelta: current.cantidad_devuelta + cantidad }
        : current);
      const total = nextItems.reduce((sum, current) => sum + current.cantidad, 0);
      const devuelto = nextItems.reduce((sum, current) => sum + current.cantidad_devuelta, 0);
      const estado = devuelto === total ? "devuelto" : devuelto > 0 ? "parcial" : "en_cliente";
      const { error: envioError } = await (supabase as any).from("muestra_envios").update({ estado, fecha_devolucion: fechaDevolucion }).eq("id", item.envio_id).eq("sociedad_id", sociedadId);
      if (envioError) throw envioError;

      setReturnDraft((prev) => ({ ...prev, [item.id]: 0 }));
      setReturnDateDraft((prev) => ({ ...prev, [item.id]: todayAR() }));
      toast.success(devuelto === total ? "Envío devuelto por completo" : "Devolución registrada");
      await fetchData();
    } catch (error: any) {
      toast.error(`No se pudo registrar la devolución: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";
  const labelClass = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header title="Muestras" subtitle={`${envios.length} registros de muestras`} action={{ label: "Registrar entrega", onClick: openNuevoEnvio }} />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2 overflow-x-auto">
            {(["todos", "en_cliente", "parcial", "devuelto"] as const).map((estado) => { const count = estado === "todos" ? envios.length : envios.filter((envio) => envio.estado === estado).length; const label = estado === "todos" ? "Todos" : estadoConfig[estado].label; return <button key={estado} onClick={() => { setTab("envios"); setEstadoFilter(estado); setSelectedEnvio(null); }} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-4 py-2 text-sm font-medium ${tab === "envios" && estadoFilter === estado ? "border-orange-500 bg-orange-500 text-white" : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900"}`}>{label}<span className={`rounded-full px-1.5 py-0.5 text-xs ${tab === "envios" && estadoFilter === estado ? "bg-white/20" : "bg-zinc-100 dark:bg-zinc-800"}`}>{count}</span></button>; })}
          </div>
          <div className="flex items-center gap-2"><span className="text-xs text-zinc-500">{totalEnClientes} en clientes · {totalPrendas - totalEnClientes} disponibles</span><button onClick={() => { setTab(tab === "inventario" ? "envios" : "inventario"); setSelectedEnvio(null); }} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${tab === "inventario" ? "border-orange-500 bg-orange-50 text-orange-600 dark:bg-orange-950/30" : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`}><Package size={15} /> Inventario</button>{tab === "inventario" && <button onClick={() => openNuevoProducto()} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white"><Plus size={15} /> Nueva prenda</button>}</div>
        </div>

        <div className="flex gap-5">
          <Card className={`overflow-hidden p-0 ${selectedEnvio && !panelFullscreen ? "w-3/5" : "w-full"}`}>
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "envios" ? "Buscar cliente, número o prenda..." : "Buscar prenda, código, talle o color..."} className={`${inputClass} pl-9`} /></div>
              {tab === "envios" && <select value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value as typeof estadoFilter)} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"><option value="todos">Todos los estados</option><option value="en_cliente">Entregado</option><option value="parcial">Entregado · devolución parcial</option><option value="devuelto">Devuelto</option></select>}
            </div>

            {loading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-orange-500" /></div> : tab === "envios" ? (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">N°</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Destino</th><th className="px-4 py-3">Prendas</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3"></th></tr></thead><tbody>
                {filteredEnvios.map((envio) => { const cfg = estadoConfig[envio.estado]; const sucursal = envio.sucursal_id ? sucursalMap.get(envio.sucursal_id) : null; return <tr key={envio.id} onClick={() => setSelectedEnvio(envio)} className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"><td className="px-4 py-3 text-zinc-500">{formatDate(envio.fecha)}</td><td className="px-4 py-3 font-mono text-xs">{envio.numero}</td><td className="px-4 py-3 font-medium">{clienteMap.get(envio.cliente_id) || "—"}</td><td className="px-4 py-3 text-zinc-500">{sucursal?.nombre || "Casa central"}</td><td className="px-4 py-3"><span className="font-semibold">{cantidadPendienteEnvio(envio.id)}</span><span className="text-zinc-400"> / {cantidadTotalEnvio(envio.id)}</span></td><td className="px-4 py-3"><Badge variant={cfg.variant}>{cfg.label}</Badge></td><td className="px-4 py-3"><Eye size={15} className="text-zinc-400" /></td></tr>; })}
                {filteredEnvios.length === 0 && <tr><td colSpan={7} className="px-4 py-16 text-center text-zinc-400">No hay envíos de muestras</td></tr>}
              </tbody></table></div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"><th className="px-4 py-3">Código</th><th className="px-4 py-3">Prenda</th><th className="px-4 py-3">Talle</th><th className="px-4 py-3">Color</th><th className="px-4 py-3 text-center">Total</th><th className="px-4 py-3 text-center">En clientes</th><th className="px-4 py-3 text-center">Disponible</th><th className="px-4 py-3"></th></tr></thead><tbody>
                {filteredProductos.map((producto) => { const asignado = asignadoPorProducto.get(producto.id) || 0; const disponible = disponibles(producto); return <tr key={producto.id} className="border-b border-zinc-100 dark:border-zinc-800"><td className="px-4 py-3 font-mono text-xs">{producto.codigo}</td><td className="px-4 py-3 font-medium">{producto.descripcion}</td><td className="px-4 py-3">{producto.talle || "—"}</td><td className="px-4 py-3">{producto.color || "—"}</td><td className="px-4 py-3 text-center font-semibold">{producto.stock_total}</td><td className="px-4 py-3 text-center text-orange-600">{asignado}</td><td className={`px-4 py-3 text-center font-bold ${disponible > 0 ? "text-emerald-600" : "text-red-500"}`}>{disponible}</td><td className="px-4 py-3"><button onClick={() => openNuevoProducto(producto)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><Edit3 size={15} /></button></td></tr>; })}
                {filteredProductos.length === 0 && <tr><td colSpan={8} className="px-4 py-16 text-center text-zinc-400">Todavía no hay prendas de muestra cargadas</td></tr>}
              </tbody></table></div>
            )}
          </Card>

          {selectedEnvio && (
            <Card className={`${panelFullscreen ? "fixed inset-4 z-50 overflow-y-auto" : "sticky top-5 h-fit w-2/5"} p-0`}>
              <div className="flex items-start justify-between border-b p-4 dark:border-zinc-800">
                <div><p className="font-mono text-xs text-zinc-500">{selectedEnvio.numero}</p><h2 className="mt-1 font-semibold">{clienteMap.get(selectedEnvio.cliente_id)}</h2></div>
                <div className="flex items-center gap-1"><button onClick={() => eliminarEnvio(selectedEnvio)} title="Eliminar" className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button><button onClick={() => setPanelFullscreen((value) => !value)} title={panelFullscreen ? "Reducir" : "Ampliar"} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100">{panelFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button><button onClick={() => { setSelectedEnvio(null); setPanelFullscreen(false); }} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100"><X size={18} /></button></div>
              </div>
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-zinc-400">Fecha de entrega</p><p>{formatDate(selectedEnvio.fecha)}</p></div>
                  <div><p className="text-xs text-zinc-400">Fecha de devolución</p><p>{selectedEnvio.fecha_devolucion ? formatDate(selectedEnvio.fecha_devolucion) : "Pendiente"}</p></div>
                  <div><p className="text-xs text-zinc-400">Sucursal / destino</p><p>{selectedEnvio.sucursal_id ? sucursalMap.get(selectedEnvio.sucursal_id)?.nombre : "Casa central"}</p></div>
                  <div><p className="text-xs text-zinc-400">Estado</p><Badge variant={estadoConfig[selectedEnvio.estado].variant}>{estadoConfig[selectedEnvio.estado].label}</Badge></div>
                </div>
                {selectedEnvio.observaciones && <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{selectedEnvio.observaciones}</p>}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Detalle de prendas entregadas</p>
                  <div className="space-y-2">
                    {envioItems(selectedEnvio.id).map((item) => {
                      const producto = productoMap.get(item.producto_id);
                      const pendiente = item.cantidad - item.cantidad_devuelta;
                      return <div key={item.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                        <div className="flex justify-between gap-3"><div><p className="text-sm font-medium">{producto?.descripcion || "Muestra"}</p><p className="text-xs text-zinc-400">{[producto?.codigo, producto?.talle && `Talle ${producto.talle}`, producto?.color].filter(Boolean).join(" · ")}</p>{item.precio_unitario != null && <p className="mt-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Precio informado: {formatCurrency(Number(item.precio_unitario), selectedEnvio.moneda)}</p>}</div><div className="text-right"><p className="text-sm font-bold">{pendiente} en cliente</p><p className="text-xs text-zinc-400">{item.cantidad_devuelta} de {item.cantidad} devueltas</p></div></div>
                        {pendiente > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-[100px_150px_1fr]"><input type="number" min="1" max={pendiente} value={returnDraft[item.id] || ""} onChange={(e) => setReturnDraft((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))} placeholder="Cantidad" className={`${inputClass} py-1.5`} /><input type="date" value={returnDateDraft[item.id] || todayAR()} onChange={(e) => setReturnDateDraft((prev) => ({ ...prev, [item.id]: e.target.value }))} className={`${inputClass} py-1.5`} /><button disabled={saving} onClick={() => registrarDevolucion(item, returnDraft[item.id] || 0, returnDateDraft[item.id] || todayAR())} className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><RotateCcw size={13} /> Registrar devolución</button></div>}
                      </div>;
                    })}
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </main>

      {envioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[96vh] w-full max-w-7xl overflow-y-auto rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b p-5 dark:border-zinc-800">
              <div>
                <h2 className="text-lg font-bold">Nueva muestra</h2>
                <p className="text-sm text-zinc-500">Completá los datos y las prendas igual que al cargar un presupuesto.</p>
              </div>
              <button onClick={() => setEnvioModal(false)} className="rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="text-zinc-400" />
              </button>
            </div>

            <div className="space-y-6 p-5">
              <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800/70">
                Creado por: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{profile?.full_name || "Usuario actual"}</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="relative">
                  <label className={labelClass}>Cliente *</label>
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      value={clientSearch}
                      onFocus={() => setClientDropdownOpen(true)}
                      onChange={(event) => {
                        setClientSearch(event.target.value);
                        setClientDropdownOpen(true);
                        if (envioForm.cliente_id) {
                          setEnvioForm((form) => ({ ...form, cliente_id: "", sucursal_id: "" }));
                        }
                      }}
                      placeholder="Buscar cliente..."
                      className={`${inputClass} pl-9`}
                    />
                  </div>
                  {clientDropdownOpen && (
                    <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
                      {clientes
                        .filter((cliente) => cliente.razon_social.toLowerCase().includes(clientSearch.toLowerCase()))
                        .slice(0, 25)
                        .map((cliente) => (
                          <button
                            type="button"
                            key={cliente.id}
                            onClick={() => {
                              setEnvioForm((form) => ({ ...form, cliente_id: cliente.id, sucursal_id: "" }));
                              setClientSearch(cliente.razon_social);
                              setClientDropdownOpen(false);
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                          >
                            {cliente.razon_social}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Vendedor / operador</label>
                  <input value={profile?.full_name || "Usuario actual"} readOnly className={`${inputClass} bg-zinc-50 dark:bg-zinc-800`} />
                </div>

                <div>
                  <label className={labelClass}>Sucursal / destino</label>
                  <select
                    value={envioForm.sucursal_id}
                    onChange={(event) => setEnvioForm((form) => ({ ...form, sucursal_id: event.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Casa central</option>
                    {sucursales
                      .filter((sucursal) => sucursal.cliente_id === envioForm.cliente_id)
                      .map((sucursal) => (
                        <option key={sucursal.id} value={sucursal.id}>
                          {sucursal.nombre}{sucursal.localidad ? ` — ${sucursal.localidad}` : ""}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Fecha de entrega</label>
                  <input
                    type="date"
                    value={envioForm.fecha}
                    onChange={(event) => setEnvioForm((form) => ({ ...form, fecha: event.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Moneda del precio opcional</label>
                  <select value={envioForm.moneda} onChange={(event) => setEnvioForm((form) => ({ ...form, moneda: event.target.value as "ARS" | "USD" }))} className={inputClass}>
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Ítems de la muestra</p>
                    <p className="text-xs text-zinc-500">Buscá una prenda existente o cargala directamente en esta grilla.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraftItems((previous) => [...previous, { ...emptyDraftItem }])}
                    className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-xs font-medium text-white"
                  >
                    <Plus size={14} /> Agregar ítem
                  </button>
                </div>

                <div className="overflow-visible rounded-lg border dark:border-zinc-700">
                  <div className="hidden grid-cols-[125px_minmax(200px,1fr)_90px_105px_90px_85px_100px_115px_40px] gap-2 border-b bg-zinc-50 px-3 py-2 text-xs font-semibold uppercase text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 lg:grid">
                    <span>Código</span>
                    <span>Descripción</span>
                    <span>Talle</span>
                    <span>Color</span>
                    <span>Stock total</span>
                    <span>Disponible</span>
                    <span>Cant. enviar</span>
                    <span>Precio opcional</span>
                    <span />
                  </div>

                  <div className="space-y-3 p-3">
                    {draftItems.map((draft, index) => {
                      const selected = productoMap.get(draft.producto_id);
                      const available = selected ? disponibles(selected) : Number(draft.stock_total) || 0;
                      const itemNeedle = `${draft.codigo} ${draft.descripcion}`.trim().toLowerCase();
                      const suggestions = productos.filter((producto) => {
                        if (!producto.activo || disponibles(producto) <= 0) return false;
                        if (!itemNeedle) return true;
                        return [producto.codigo, producto.descripcion, producto.talle || "", producto.color || ""]
                          .join(" ")
                          .toLowerCase()
                          .includes(itemNeedle);
                      }).slice(0, 12);

                      return (
                        <div key={index} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700 lg:border-0 lg:p-0">
                          <div className="grid gap-2 lg:grid-cols-[125px_minmax(200px,1fr)_90px_105px_90px_85px_100px_115px_40px] lg:items-start">
                            <div className="relative">
                              <label className={`${labelClass} lg:hidden`}>Código</label>
                              <div className="relative">
                                <input
                                  value={draft.codigo}
                                  onFocus={() => setActiveItemSearch(index)}
                                  onChange={(event) => {
                                    updateDraftItem(index, { codigo: event.target.value }, true);
                                    setActiveItemSearch(index);
                                  }}
                                  placeholder="Código"
                                  className={`${inputClass} pr-8`}
                                />
                                <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                              </div>
                              {activeItemSearch === index && suggestions.length > 0 && (
                                <div className="absolute z-40 mt-1 max-h-56 min-w-[430px] overflow-y-auto rounded-lg border bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
                                  {suggestions.map((producto) => (
                                    <button
                                      type="button"
                                      key={producto.id}
                                      onClick={() => seleccionarProducto(index, producto)}
                                      className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                    >
                                      <span>
                                        <span className="font-mono text-xs text-zinc-500">{producto.codigo}</span>
                                        <span className="ml-2 font-medium">{producto.descripcion}</span>
                                        <span className="ml-2 text-xs text-zinc-400">{[producto.talle, producto.color].filter(Boolean).join(" · ")}</span>
                                      </span>
                                      <span className="whitespace-nowrap text-xs text-emerald-600">{disponibles(producto)} disp.</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div>
                              <label className={`${labelClass} lg:hidden`}>Descripción</label>
                              <input
                                value={draft.descripcion}
                                onFocus={() => setActiveItemSearch(index)}
                                onChange={(event) => updateDraftItem(index, { descripcion: event.target.value }, true)}
                                placeholder="Descripción de la prenda"
                                readOnly={Boolean(selected)}
                                className={`${inputClass} ${selected ? "bg-zinc-50 dark:bg-zinc-800" : ""}`}
                              />
                            </div>
                            <div>
                              <label className={`${labelClass} lg:hidden`}>Talle</label>
                              <input value={draft.talle} onChange={(event) => updateDraftItem(index, { talle: event.target.value })} placeholder="Talle" readOnly={Boolean(selected)} className={`${inputClass} ${selected ? "bg-zinc-50 dark:bg-zinc-800" : ""}`} />
                            </div>
                            <div>
                              <label className={`${labelClass} lg:hidden`}>Color</label>
                              <input value={draft.color} onChange={(event) => updateDraftItem(index, { color: event.target.value })} placeholder="Color" readOnly={Boolean(selected)} className={`${inputClass} ${selected ? "bg-zinc-50 dark:bg-zinc-800" : ""}`} />
                            </div>
                            <div>
                              <label className={`${labelClass} lg:hidden`}>Stock total</label>
                              <input type="number" min="1" value={draft.stock_total} onChange={(event) => updateDraftItem(index, { stock_total: Number(event.target.value) })} readOnly={Boolean(selected)} className={`${inputClass} ${selected ? "bg-zinc-50 dark:bg-zinc-800" : ""}`} />
                            </div>
                            <div>
                              <label className={`${labelClass} lg:hidden`}>Disponible</label>
                              <div className="rounded-lg bg-zinc-50 px-3 py-2 text-center text-sm font-semibold text-emerald-600 dark:bg-zinc-800">{available}</div>
                            </div>
                            <div>
                              <label className={`${labelClass} lg:hidden`}>Cantidad a enviar</label>
                              <input type="number" min="1" max={available || undefined} value={draft.cantidad} onChange={(event) => updateDraftItem(index, { cantidad: Number(event.target.value) })} className={inputClass} />
                            </div>
                            <div>
                              <label className={`${labelClass} lg:hidden`}>Precio opcional</label>
                              <input type="number" min="0" step="0.01" value={draft.precio_unitario ?? ""} onChange={(event) => updateDraftItem(index, { precio_unitario: event.target.value === "" ? null : Number(event.target.value) })} placeholder="Sin precio" className={inputClass} />
                            </div>
                            <button type="button" disabled={draftItems.length === 1} onClick={() => setDraftItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} className="rounded p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30" title="Quitar ítem">
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-zinc-400">
                            {selected ? "Inventario de muestras existente" : "La prenda se agregará al inventario al guardar"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button type="button" onClick={() => setDraftItems((previous) => [...previous, { ...emptyDraftItem }])} className="mt-3 flex items-center gap-1 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500 hover:border-orange-400 hover:text-orange-600 dark:border-zinc-700">
                  <Plus size={14} /> Agregar ítem
                </button>
              </div>

              <div>
                <label className={labelClass}>Observaciones</label>
                <textarea value={envioForm.observaciones} onChange={(event) => setEnvioForm((form) => ({ ...form, observaciones: event.target.value }))} placeholder="Persona que recibió, motivo del envío, indicaciones internas..." rows={3} className={inputClass} />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t p-5 dark:border-zinc-800">
              <button onClick={() => setEnvioModal(false)} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
              <button onClick={handleCreateEnvio} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Guardar muestra
              </button>
            </div>
          </div>
        </div>
      )}

      {productoModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-zinc-900"><div className="flex items-center justify-between border-b p-5 dark:border-zinc-800"><div><h2 className="text-lg font-bold">{editingProductoId ? "Editar muestra" : "Nueva muestra"}</h2><p className="text-sm text-zinc-500">Inventario separado del stock comercial</p></div><button onClick={() => setProductoModal(false)}><X className="text-zinc-400" /></button></div><div className="grid grid-cols-2 gap-4 p-5"><div><label className={labelClass}>Código *</label><input value={productoForm.codigo} onChange={(e) => setProductoForm((form) => ({ ...form, codigo: e.target.value }))} placeholder="M-001" className={inputClass} /></div><div><label className={labelClass}>Cantidad total *</label><input type="number" min="0" value={productoForm.stock_total} onChange={(e) => setProductoForm((form) => ({ ...form, stock_total: Number(e.target.value) }))} className={inputClass} /></div><div className="col-span-2"><label className={labelClass}>Prenda / descripción *</label><input value={productoForm.descripcion} onChange={(e) => setProductoForm((form) => ({ ...form, descripcion: e.target.value }))} placeholder="Ej: Remera corporativa manga corta" className={inputClass} /></div><div><label className={labelClass}>Talle</label><input value={productoForm.talle} onChange={(e) => setProductoForm((form) => ({ ...form, talle: e.target.value }))} placeholder="S, M, L, XL..." className={inputClass} /></div><div><label className={labelClass}>Color</label><input value={productoForm.color} onChange={(e) => setProductoForm((form) => ({ ...form, color: e.target.value }))} placeholder="Negro" className={inputClass} /></div></div><div className="flex justify-end gap-2 border-t p-5 dark:border-zinc-800"><button onClick={() => setProductoModal(false)} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button><button onClick={handleSaveProducto} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />} Guardar</button></div></div></div>}
    </div>
  );
}
