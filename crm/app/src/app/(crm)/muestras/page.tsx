"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { formatDate, todayAR } from "@/lib/utils";
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
  cliente_id: string;
  sucursal_id: string | null;
  estado: "en_cliente" | "parcial" | "devuelto";
  observaciones: string | null;
  created_at: string;
}

interface MuestraItem {
  id: string;
  envio_id: string;
  producto_id: string;
  cantidad: number;
  cantidad_devuelta: number;
}

interface ClienteOption { id: string; razon_social: string }
interface SucursalOption { id: string; cliente_id: string; nombre: string; direccion: string | null; localidad: string | null }
interface DraftItem { producto_id: string; cantidad: number }

const emptyProducto = { codigo: "", descripcion: "", talle: "", color: "", stock_total: 0 };

const estadoConfig = {
  en_cliente: { label: "En cliente", variant: "warning" as const },
  parcial: { label: "Devolución parcial", variant: "info" as const },
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

  const [envioModal, setEnvioModal] = useState(false);
  const [envioForm, setEnvioForm] = useState({ fecha: todayAR(), cliente_id: "", sucursal_id: "", observaciones: "" });
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ producto_id: "", cantidad: 1 }]);

  const [productoModal, setProductoModal] = useState(false);
  const [editingProductoId, setEditingProductoId] = useState<string | null>(null);
  const [productoForm, setProductoForm] = useState(emptyProducto);
  const [returnDraft, setReturnDraft] = useState<Record<string, number>>({});

  const fetchData = useCallback(async () => {
    if (!sociedadId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [prodRes, envRes, itemRes, cliRes, sucRes] = await Promise.all([
        (supabase as any).from("muestra_productos").select("*").eq("sociedad_id", sociedadId).order("descripcion"),
        (supabase as any).from("muestra_envios").select("*").eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("created_at", { ascending: false }),
        (supabase as any).from("muestra_envio_items").select("*"),
        (supabase as any).from("clientes").select("id, razon_social").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"),
        (supabase as any).from("cliente_sucursales").select("id, cliente_id, nombre, direccion, localidad").eq("activo", true).order("principal", { ascending: false }),
      ]);
      const firstError = [prodRes.error, envRes.error, itemRes.error, cliRes.error, sucRes.error].find(Boolean);
      if (firstError) throw firstError;
      setProductos(prodRes.data || []);
      setEnvios(envRes.data || []);
      setItems(itemRes.data || []);
      setClientes(cliRes.data || []);
      setSucursales(sucRes.data || []);
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
    setEnvioForm({ fecha: todayAR(), cliente_id: "", sucursal_id: "", observaciones: "" });
    setDraftItems([{ producto_id: "", cantidad: 1 }]);
    setClientSearch("");
    setEnvioModal(true);
  }

  async function eliminarEnvio(envio: MuestraEnvio) {
    if (!confirm(`¿Eliminar ${envio.numero}? Las prendas volverán a quedar disponibles.`)) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("muestra_envios").delete().eq("id", envio.id);
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
        ? (supabase as any).from("muestra_productos").update({ ...payload, created_by: undefined }).eq("id", editingProductoId)
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
    const cleanItems = draftItems.filter((item) => item.producto_id && item.cantidad > 0);
    if (cleanItems.length === 0) { toast.error("Agregá al menos una muestra"); return; }
    if (new Set(cleanItems.map((item) => item.producto_id)).size !== cleanItems.length) { toast.error("No repitas la misma muestra en el envío"); return; }
    const unavailable = cleanItems.find((item) => {
      const producto = productoMap.get(item.producto_id);
      return !producto || item.cantidad > disponibles(producto);
    });
    if (unavailable) { toast.error("Una de las cantidades supera el stock disponible"); return; }

    setSaving(true);
    let envioId = "";
    try {
      const { data: envio, error: envioError } = await (supabase as any).from("muestra_envios").insert({
        sociedad_id: sociedadId,
        numero: "",
        fecha: envioForm.fecha,
        cliente_id: envioForm.cliente_id,
        sucursal_id: envioForm.sucursal_id || null,
        estado: "en_cliente",
        observaciones: envioForm.observaciones.trim() || null,
        created_by: profile?.id || null,
      }).select("id").single();
      if (envioError || !envio?.id) throw envioError || new Error("No se pudo crear el envío");
      envioId = envio.id;
      const { error: itemError } = await (supabase as any).from("muestra_envio_items").insert(
        cleanItems.map((item) => ({ envio_id: envioId, producto_id: item.producto_id, cantidad: item.cantidad, cantidad_devuelta: 0 }))
      );
      if (itemError) throw itemError;
      toast.success("Muestras registradas en el cliente");
      setEnvioModal(false);
      await fetchData();
    } catch (error: any) {
      if (envioId) await (supabase as any).from("muestra_envios").delete().eq("id", envioId);
      toast.error(`No se pudo registrar el envío: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function registrarDevolucion(item: MuestraItem, cantidad: number) {
    const pendiente = item.cantidad - item.cantidad_devuelta;
    if (cantidad <= 0 || cantidad > pendiente) { toast.error("Ingresá una cantidad válida para devolver"); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("muestra_envio_items")
        .update({ cantidad_devuelta: item.cantidad_devuelta + cantidad }).eq("id", item.id);
      if (error) throw error;

      const nextItems = envioItems(item.envio_id).map((current) => current.id === item.id
        ? { ...current, cantidad_devuelta: current.cantidad_devuelta + cantidad }
        : current);
      const total = nextItems.reduce((sum, current) => sum + current.cantidad, 0);
      const devuelto = nextItems.reduce((sum, current) => sum + current.cantidad_devuelta, 0);
      const estado = devuelto === total ? "devuelto" : devuelto > 0 ? "parcial" : "en_cliente";
      const { error: envioError } = await (supabase as any).from("muestra_envios").update({ estado }).eq("id", item.envio_id);
      if (envioError) throw envioError;

      setReturnDraft((prev) => ({ ...prev, [item.id]: 0 }));
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
      <Header title="Muestras" subtitle={`${envios.length} registros de muestras`} action={{ label: "Nueva muestra", onClick: openNuevoEnvio }} />
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
              {tab === "envios" && <select value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value as typeof estadoFilter)} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"><option value="todos">Todos los estados</option><option value="en_cliente">En cliente</option><option value="parcial">Devolución parcial</option><option value="devuelto">Devuelto</option></select>}
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

          {selectedEnvio && <Card className={`${panelFullscreen ? "fixed inset-4 z-50 overflow-y-auto" : "sticky top-5 h-fit w-2/5"} p-0`}><div className="flex items-start justify-between border-b p-4 dark:border-zinc-800"><div><p className="font-mono text-xs text-zinc-500">{selectedEnvio.numero}</p><h2 className="mt-1 font-semibold">{clienteMap.get(selectedEnvio.cliente_id)}</h2></div><div className="flex items-center gap-1"><button onClick={() => eliminarEnvio(selectedEnvio)} title="Eliminar" className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button><button onClick={() => setPanelFullscreen((value) => !value)} title={panelFullscreen ? "Reducir" : "Ampliar"} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100">{panelFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button><button onClick={() => { setSelectedEnvio(null); setPanelFullscreen(false); }} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100"><X size={18} /></button></div></div><div className="space-y-4 p-4"><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-zinc-400">Fecha</p><p>{formatDate(selectedEnvio.fecha)}</p></div><div><p className="text-xs text-zinc-400">Sucursal / destino</p><p>{selectedEnvio.sucursal_id ? sucursalMap.get(selectedEnvio.sucursal_id)?.nombre : "Casa central"}</p></div></div>{selectedEnvio.observaciones && <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{selectedEnvio.observaciones}</p>}<div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Detalle de prendas enviadas</p><div className="space-y-2">{envioItems(selectedEnvio.id).map((item) => { const producto = productoMap.get(item.producto_id); const pendiente = item.cantidad - item.cantidad_devuelta; return <div key={item.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><div className="flex justify-between gap-3"><div><p className="text-sm font-medium">{producto?.descripcion || "Muestra"}</p><p className="text-xs text-zinc-400">{[producto?.codigo, producto?.talle && `Talle ${producto.talle}`, producto?.color].filter(Boolean).join(" · ")}</p></div><div className="text-right"><p className="text-sm font-bold">{pendiente} en cliente</p><p className="text-xs text-zinc-400">{item.cantidad_devuelta} de {item.cantidad} devueltas</p></div></div>{pendiente > 0 && <div className="mt-3 flex gap-2"><input type="number" min="1" max={pendiente} value={returnDraft[item.id] || ""} onChange={(e) => setReturnDraft((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))} placeholder="Cantidad" className={`${inputClass} py-1.5`} /><button disabled={saving} onClick={() => registrarDevolucion(item, returnDraft[item.id] || 0)} className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><RotateCcw size={13} /> Registrar devolución</button></div>}</div>; })}</div></div></div></Card>}
        </div>
      </main>

      {envioModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl dark:bg-zinc-900"><div className="flex items-center justify-between border-b p-5 dark:border-zinc-800"><div><h2 className="text-lg font-bold">Nueva muestra</h2><p className="text-sm text-zinc-500">Mismo flujo de un PR: cliente, sucursal, detalle y cantidades.</p></div><button onClick={() => setEnvioModal(false)}><X className="text-zinc-400" /></button></div><div className="space-y-5 p-5"><div className="grid grid-cols-2 gap-4"><div className="relative"><label className={labelClass}>Cliente *</label><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" /><input value={clientSearch} onFocus={() => setClientDropdownOpen(true)} onChange={(e) => { setClientSearch(e.target.value); setClientDropdownOpen(true); if (envioForm.cliente_id) setEnvioForm((form) => ({ ...form, cliente_id: "", sucursal_id: "" })); }} placeholder="Buscar cliente..." className={`${inputClass} pl-9`} /></div>{clientDropdownOpen && <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-800">{clientes.filter((cliente) => cliente.razon_social.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 25).map((cliente) => <button type="button" key={cliente.id} onClick={() => { setEnvioForm((form) => ({ ...form, cliente_id: cliente.id, sucursal_id: "" })); setClientSearch(cliente.razon_social); setClientDropdownOpen(false); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">{cliente.razon_social}</button>)}</div>}</div><div><label className={labelClass}>Sucursal / destino</label><select value={envioForm.sucursal_id} onChange={(e) => setEnvioForm((form) => ({ ...form, sucursal_id: e.target.value }))} className={inputClass}><option value="">Casa central</option>{sucursales.filter((s) => s.cliente_id === envioForm.cliente_id).map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.localidad ? ` — ${s.localidad}` : ""}</option>)}</select></div><div><label className={labelClass}>Fecha</label><input type="date" value={envioForm.fecha} onChange={(e) => setEnvioForm((form) => ({ ...form, fecha: e.target.value }))} className={inputClass} /></div><div><label className={labelClass}>Observaciones</label><input value={envioForm.observaciones} onChange={(e) => setEnvioForm((form) => ({ ...form, observaciones: e.target.value }))} placeholder="Persona que recibió, motivo..." className={inputClass} /></div></div><div><div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">Detalle de muestras</p><button onClick={() => setDraftItems((prev) => [...prev, { producto_id: "", cantidad: 1 }])} className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-xs font-medium text-white"><Plus size={14} /> Agregar prenda</button></div><div className="rounded-lg border dark:border-zinc-700"><div className="grid grid-cols-[1fr_120px_40px] gap-2 border-b bg-zinc-50 px-3 py-2 text-xs font-semibold uppercase text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"><span>Prenda / talle / color</span><span>Cantidad</span><span></span></div><div className="space-y-2 p-3">{draftItems.map((draft, index) => { const selected = productoMap.get(draft.producto_id); return <div key={index} className="grid grid-cols-[1fr_120px_40px] items-center gap-2"><select value={draft.producto_id} onChange={(e) => setDraftItems((prev) => prev.map((item, i) => i === index ? { ...item, producto_id: e.target.value } : item))} className={inputClass}><option value="">Seleccionar muestra...</option>{productos.filter((p) => p.activo && (disponibles(p) > 0 || p.id === draft.producto_id)).map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.descripcion}{p.talle ? ` · ${p.talle}` : ""}{p.color ? ` · ${p.color}` : ""} ({disponibles(p)} disp.)</option>)}</select><input type="number" min="1" max={selected ? disponibles(selected) : undefined} value={draft.cantidad} onChange={(e) => setDraftItems((prev) => prev.map((item, i) => i === index ? { ...item, cantidad: Number(e.target.value) } : item))} className={inputClass} /><button disabled={draftItems.length === 1} onClick={() => setDraftItems((prev) => prev.filter((_, i) => i !== index))} className="rounded p-2 text-zinc-400 hover:text-red-500 disabled:opacity-30"><Trash2 size={16} /></button></div>; })}</div></div></div></div><div className="flex justify-end gap-2 border-t p-5 dark:border-zinc-800"><button onClick={() => setEnvioModal(false)} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button><button onClick={handleCreateEnvio} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Guardar muestra</button></div></div></div>}

      {productoModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-zinc-900"><div className="flex items-center justify-between border-b p-5 dark:border-zinc-800"><div><h2 className="text-lg font-bold">{editingProductoId ? "Editar muestra" : "Nueva muestra"}</h2><p className="text-sm text-zinc-500">Inventario separado del stock comercial</p></div><button onClick={() => setProductoModal(false)}><X className="text-zinc-400" /></button></div><div className="grid grid-cols-2 gap-4 p-5"><div><label className={labelClass}>Código *</label><input value={productoForm.codigo} onChange={(e) => setProductoForm((form) => ({ ...form, codigo: e.target.value }))} placeholder="M-001" className={inputClass} /></div><div><label className={labelClass}>Cantidad total *</label><input type="number" min="0" value={productoForm.stock_total} onChange={(e) => setProductoForm((form) => ({ ...form, stock_total: Number(e.target.value) }))} className={inputClass} /></div><div className="col-span-2"><label className={labelClass}>Prenda / descripción *</label><input value={productoForm.descripcion} onChange={(e) => setProductoForm((form) => ({ ...form, descripcion: e.target.value }))} placeholder="Ej: Remera corporativa manga corta" className={inputClass} /></div><div><label className={labelClass}>Talle</label><input value={productoForm.talle} onChange={(e) => setProductoForm((form) => ({ ...form, talle: e.target.value }))} placeholder="S, M, L, XL..." className={inputClass} /></div><div><label className={labelClass}>Color</label><input value={productoForm.color} onChange={(e) => setProductoForm((form) => ({ ...form, color: e.target.value }))} placeholder="Negro" className={inputClass} /></div></div><div className="flex justify-end gap-2 border-t p-5 dark:border-zinc-800"><button onClick={() => setProductoModal(false)} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button><button onClick={handleSaveProducto} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />} Guardar</button></div></div></div>}
    </div>
  );
}
