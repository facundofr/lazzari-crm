"use client";

/**
 * Muestras: prendas que le dejamos a un cliente para que las vea.
 *
 * Sin inventario previo: cada renglón es un artículo de la lista de costos (se busca escribiendo)
 * o un texto libre. Cada renglón termina en uno de tres destinos:
 *   · Devolvió  · Se la quedó (para cobrar)  · Baja / regalo
 * El envío queda "En el cliente", "Devolución parcial", "Devuelto" o "Cerrado" (todo resuelto).
 * Aviso cuando una muestra lleva más de 30 días en el cliente.
 * Los envíos viejos (con inventario) se siguen viendo: toman la descripción del producto.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { Autocompletar } from "@/components/ui/autocompletar";
import { traerTodo } from "@/lib/paginar";
import { buscarCandidatos, type CatalogoCandidato } from "@/lib/catalogo-busqueda";
import { AlertTriangle, Check, Eye, Gift, Loader2, Plus, RotateCcw, Search, ShoppingBag, Trash2, X } from "lucide-react";

const db = supabase as any;
const DIAS_ALERTA = 30;

type EstadoEnvio = "en_cliente" | "parcial" | "devuelto" | "cerrado";
const ESTADO: Record<EstadoEnvio, { label: string; variant: "warning" | "info" | "success" | "default" }> = {
  en_cliente: { label: "En el cliente", variant: "warning" },
  parcial: { label: "Devolución parcial", variant: "info" },
  devuelto: { label: "Devuelto", variant: "success" },
  cerrado: { label: "Cerrado", variant: "default" },
};

interface Envio {
  id: string; numero: string; fecha: string; fecha_devolucion: string | null; moneda: "ARS" | "USD"; cliente_id: string; sucursal_id: string | null;
  estado: EstadoEnvio; observaciones: string | null; created_by_profile?: { full_name: string } | null;
}
interface Item {
  id: string; envio_id: string; producto_id: string | null; codigo: string | null; descripcion: string | null; talle: string | null; color: string | null;
  cantidad: number; cantidad_devuelta: number; cantidad_vendida: number; cantidad_baja: number; precio_unitario: number | null; nota: string | null;
}
interface Draft { codigo: string; descripcion: string; talle: string; color: string; cantidad: number; precio: string; catalogo_id: string | null }
const draftVacio = (): Draft => ({ codigo: "", descripcion: "", talle: "", color: "", cantidad: 1, precio: "", catalogo_id: null });

const pendienteDe = (i: Item) => Math.max(0, i.cantidad - i.cantidad_devuelta - (i.cantidad_vendida || 0) - (i.cantidad_baja || 0));
const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";
const diasDesde = (fecha: string) => Math.floor((Date.now() - new Date(`${fecha}T12:00:00`).getTime()) / 86400000);
const esUSD = (moneda: string) => String(moneda || "").toUpperCase().startsWith("USD");

/** Campo de artículo: escribís y busca en la lista de costos; si no está, queda el texto libre. */
function ArticuloInput({ value, onTexto, onElegir }: { value: string; onTexto: (t: string) => void; onElegir: (c: CatalogoCandidato) => void }) {
  const [resultados, setResultados] = useState<CatalogoCandidato[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const ultimo = useRef("");
  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || q === ultimo.current) return;
    const t = setTimeout(async () => {
      ultimo.current = q;
      setBuscando(true);
      try { setResultados(await buscarCandidatos(q, "", 12)); } catch { setResultados([]); }
      setBuscando(false);
    }, 350);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div className="relative">
      <input value={value} onChange={e => { onTexto(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 180)}
        placeholder="Escribí el artículo (se busca en la lista) o texto libre" className={inputClass} />
      {buscando && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-orange-500" />}
      {abierto && resultados.length > 0 && value.trim().length >= 3 && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {resultados.map(c => (
            <button key={c.id} type="button" onMouseDown={e => { e.preventDefault(); onElegir(c); setAbierto(false); }} className="block w-full border-b border-zinc-100 px-3 py-1.5 text-left text-xs hover:bg-orange-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-orange-900/20">
              <span className="font-medium">{c.descripcion}</span>
              <span className="block text-[10px] text-zinc-500">{c.proveedor} · {c.codigo_interno || c.codigo} · venta {formatCurrency(c.precio_venta, esUSD(c.moneda) ? "USD" : "ARS")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MuestrasPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [productos, setProductos] = useState<Map<string, { descripcion: string; codigo: string; talle: string | null; color: string | null }>>(new Map());
  const [clientes, setClientes] = useState<Array<{ id: string; razon_social: string }>>([]);
  const [sucursales, setSucursales] = useState<Array<{ id: string; cliente_id: string; nombre: string }>>([]);
  const [filtro, setFiltro] = useState<"abiertos" | "viejos" | EstadoEnvio | "todos">("abiertos");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ fecha: todayAR(), cliente_id: "", sucursal_id: "", moneda: "ARS" as "ARS" | "USD", observaciones: "" });
  const [drafts, setDrafts] = useState<Draft[]>([draftVacio()]);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [fechas, setFechas] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    if (!sociedadId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [envRes, cliRes, sucRes, prodRes] = await Promise.all([
        db.from("muestra_envios").select("*, created_by_profile:created_by(full_name)").eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("created_at", { ascending: false }),
        db.from("clientes").select("id, razon_social").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"),
        db.from("cliente_sucursales").select("id, cliente_id, nombre").eq("activo", true).order("principal", { ascending: false }),
        db.from("muestra_productos").select("id, codigo, descripcion, talle, color").eq("sociedad_id", sociedadId),
      ]);
      const err = [envRes, cliRes, sucRes, prodRes].find(r => r.error)?.error;
      if (err) throw err;
      const lista: Envio[] = envRes.data || [];
      const ids = lista.map(e => e.id);
      const todos: Item[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const lote = ids.slice(i, i + 150);
        const data = await traerTodo(() => db.from("muestra_envio_items").select("*").in("envio_id", lote).order("id"));
        todos.push(...data.map((x: any) => ({
          ...x, cantidad_devuelta: x.cantidad_devuelta || 0, cantidad_vendida: x.cantidad_vendida || 0, cantidad_baja: x.cantidad_baja || 0,
          precio_unitario: x.precio_unitario != null ? Number(x.precio_unitario) : null,
        })));
      }
      setEnvios(lista);
      setItems(todos);
      setProductos(new Map((prodRes.data || []).map((p: any) => [p.id, p])));
      const cli = cliRes.data || [];
      const cliIds = new Set(cli.map((c: any) => c.id));
      setClientes(cli);
      setSucursales((sucRes.data || []).filter((s: any) => cliIds.has(s.cliente_id)));
    } catch (e: any) {
      toast.error(`No se pudieron cargar las muestras: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [sociedadId, toast]);
  useEffect(() => { void fetchData(); }, [fetchData]);

  const clienteMap = useMemo(() => new Map(clientes.map(c => [c.id, c.razon_social])), [clientes]);
  const itemsPorEnvio = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) { const l = m.get(i.envio_id) || []; l.push(i); m.set(i.envio_id, l); }
    return m;
  }, [items]);
  const itemsDe = useCallback((envioId: string) => itemsPorEnvio.get(envioId) || [], [itemsPorEnvio]);
  const nombreItem = (i: Item) => i.descripcion || productos.get(i.producto_id || "")?.descripcion || "Muestra";
  const talleItem = (i: Item) => i.talle || productos.get(i.producto_id || "")?.talle || "";
  const pendienteEnvio = (id: string) => itemsDe(id).reduce((s, i) => s + pendienteDe(i), 0);
  const valorPendiente = (id: string) => itemsDe(id).reduce((s, i) => s + pendienteDe(i) * (i.precio_unitario || 0), 0);
  const esViejo = (e: Envio) => pendienteEnvio(e.id) > 0 && diasDesde(e.fecha) > DIAS_ALERTA;

  const abiertos = envios.filter(e => pendienteEnvio(e.id) > 0);
  const viejos = envios.filter(esViejo);
  const prendasAfuera = abiertos.reduce((s, e) => s + pendienteEnvio(e.id), 0);
  const valorAfuera = { ARS: 0, USD: 0 };
  for (const e of abiertos) valorAfuera[e.moneda === "USD" ? "USD" : "ARS"] += valorPendiente(e.id);
  const vendidas = items.reduce((s, i) => s + (i.cantidad_vendida || 0), 0);

  const filtrados = envios.filter(e => {
    if (filtro === "abiertos" && pendienteEnvio(e.id) <= 0) return false;
    if (filtro === "viejos" && !esViejo(e)) return false;
    if ((["en_cliente", "parcial", "devuelto", "cerrado"] as string[]).includes(filtro) && e.estado !== filtro) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return `${e.numero} ${clienteMap.get(e.cliente_id) || ""} ${itemsDe(e.id).map(nombreItem).join(" ")}`.toLowerCase().includes(q);
  });
  const sel = envios.find(e => e.id === selectedId) || null;

  // ── Alta ──
  function abrirNuevo() {
    setForm({ fecha: todayAR(), cliente_id: "", sucursal_id: "", moneda: "ARS", observaciones: "" });
    setDrafts([draftVacio()]);
    setModal(true);
  }
  const setDraft = (i: number, c: Partial<Draft>) => setDrafts(prev => prev.map((d, j) => j === i ? { ...d, ...c } : d));
  function elegirDelCatalogo(i: number, c: CatalogoCandidato) {
    const usd = esUSD(c.moneda);
    const mismaMoneda = usd === (form.moneda === "USD");
    // Si todavía no hay precios cargados, la moneda del envío sigue a la de la lista.
    const primero = !drafts.some((d, j) => j !== i && d.precio);
    if (primero && !mismaMoneda) setForm(f => ({ ...f, moneda: usd ? "USD" : "ARS" }));
    setDraft(i, { descripcion: c.descripcion, codigo: c.codigo_interno || c.codigo, catalogo_id: c.id, precio: mismaMoneda || primero ? String(c.precio_venta || "") : "" });
  }

  async function crearEnvio() {
    if (!sociedadId) return;
    if (!form.cliente_id) { toast.error("Elegí el cliente"); return; }
    const renglones = drafts.filter(d => d.descripcion.trim() && d.cantidad > 0);
    if (!renglones.length) { toast.error("Agregá al menos una prenda"); return; }
    setSaving(true);
    let envioId = "";
    try {
      const { data: envio, error } = await db.from("muestra_envios").insert({
        sociedad_id: sociedadId, numero: "", fecha: form.fecha, moneda: form.moneda, cliente_id: form.cliente_id,
        sucursal_id: form.sucursal_id || null, estado: "en_cliente", observaciones: form.observaciones.trim() || null, created_by: profile?.id || null,
      }).select("id").single();
      if (error || !envio?.id) throw error || new Error("No se pudo crear el envío");
      envioId = envio.id;
      const { error: e2 } = await db.from("muestra_envio_items").insert(renglones.map(d => ({
        envio_id: envioId, producto_id: null, codigo: d.codigo.trim() || null, descripcion: d.descripcion.trim(), talle: d.talle.trim().toUpperCase() || null,
        color: d.color.trim() || null, catalogo_id: d.catalogo_id, cantidad: Math.round(d.cantidad), cantidad_devuelta: 0,
        precio_unitario: d.precio ? Number(String(d.precio).replace(",", ".")) || null : null,
      })));
      if (e2) throw e2;
      toast.success("Muestras registradas en el cliente");
      setModal(false);
      setSelectedId(envioId);
      await fetchData();
    } catch (e: any) {
      if (envioId) await db.from("muestra_envios").delete().eq("id", envioId).eq("sociedad_id", sociedadId);
      const msg = String(e?.message || "");
      toast.error(/producto_id|descripcion|column/i.test(msg) ? "Falta correr la actualización de la base de datos (Muestras)." : `No se pudo registrar: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Resolver renglones ──
  async function resolver(item: Item, destino: "devuelta" | "vendida" | "baja") {
    const pend = pendienteDe(item);
    const cant = Math.min(pend, Math.max(1, Math.round(cantidades[item.id] || pend)));
    if (!cant || !sociedadId) return;
    setSaving(true);
    try {
      const cambios = destino === "devuelta" ? { cantidad_devuelta: item.cantidad_devuelta + cant }
        : destino === "vendida" ? { cantidad_vendida: (item.cantidad_vendida || 0) + cant }
        : { cantidad_baja: (item.cantidad_baja || 0) + cant };
      const { error } = await db.from("muestra_envio_items").update(cambios).eq("id", item.id).eq("envio_id", item.envio_id);
      if (error) throw error;
      const nuevos = itemsDe(item.envio_id).map(i => i.id === item.id ? { ...i, ...cambios } : i);
      const total = nuevos.reduce((s, i) => s + i.cantidad, 0);
      const pendiente = nuevos.reduce((s, i) => s + pendienteDe(i), 0);
      const devuelto = nuevos.reduce((s, i) => s + i.cantidad_devuelta, 0);
      const estado: EstadoEnvio = pendiente === 0 ? (devuelto === total ? "devuelto" : "cerrado") : pendiente < total ? "parcial" : "en_cliente";
      const fecha = fechas[item.id] || todayAR();
      const { error: e2 } = await db.from("muestra_envios").update({ estado, ...(destino === "devuelta" || pendiente === 0 ? { fecha_devolucion: fecha } : {}) }).eq("id", item.envio_id).eq("sociedad_id", sociedadId);
      if (e2) throw e2;
      toast.success(destino === "devuelta" ? "Devolución registrada" : destino === "vendida" ? "Anotada para cobrar: armale el presupuesto o la factura" : "Anotada como baja / regalo");
      setCantidades(prev => { const n = { ...prev }; delete n[item.id]; return n; });
      await fetchData();
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function eliminar(envio: Envio) {
    if (!sociedadId || !confirm(`¿Eliminar ${envio.numero}?`)) return;
    const { error } = await db.from("muestra_envios").delete().eq("id", envio.id).eq("sociedad_id", sociedadId);
    if (error) { toast.error(`No se pudo eliminar: ${error.message}`); return; }
    toast.success("Registro eliminado");
    setSelectedId(null);
    await fetchData();
  }

  const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header title="Muestras" subtitle="Prendas que dejamos a clientes para que las vean" action={{ label: "Registrar entrega", onClick: abrirNuevo }} />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className={card}><p className="text-xs text-zinc-500">Envíos abiertos</p><p className="text-2xl font-bold dark:text-white">{abiertos.length}</p></div>
          <div className={card}><p className="text-xs text-zinc-500">Prendas en la calle</p><p className="text-2xl font-bold dark:text-white">{prendasAfuera}</p></div>
          <div className={card}><p className="text-xs text-zinc-500">Valor en la calle</p><p className="text-lg font-bold dark:text-white">{formatCurrency(valorAfuera.ARS)}{valorAfuera.USD ? <span className="block text-sm">{formatCurrency(valorAfuera.USD, "USD")}</span> : null}</p></div>
          <button onClick={() => setFiltro("viejos")} className={`rounded-xl border p-4 text-left ${viejos.length ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
            <p className="text-xs text-zinc-500">Más de {DIAS_ALERTA} días en el cliente</p>
            <p className={`text-2xl font-bold ${viejos.length ? "text-amber-700 dark:text-amber-400" : "dark:text-white"}`}>{viejos.length}</p>
          </button>
        </div>
        {vendidas > 0 && (
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:bg-orange-950/30 dark:text-orange-300">
            <ShoppingBag className="mr-1 inline h-3.5 w-3.5" /> Los clientes se quedaron {vendidas} muestra(s): acordate de presupuestarlas o facturarlas.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {([["abiertos", "Abiertos"], ["viejos", `+${DIAS_ALERTA} días`], ["en_cliente", "En el cliente"], ["parcial", "Devolución parcial"], ["cerrado", "Cerrados"], ["devuelto", "Devueltos"], ["todos", "Todos"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${filtro === k ? "border-orange-500 bg-orange-500 text-white" : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>{l}</button>
          ))}
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, número o prenda…" className={`${inputClass} pl-9`} />
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <div className={`overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${sel ? "lg:w-3/5" : "w-full"}`}>
            {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-orange-500" /></div> : (
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/50">
                  <tr><th className="px-3 py-2">Fecha</th><th className="px-3">Número</th><th className="px-3">Cliente</th><th className="px-3 text-right">En el cliente</th><th className="px-3 text-right">Valor</th><th className="px-3">Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {filtrados.map(e => {
                    const pend = pendienteEnvio(e.id), tot = itemsDe(e.id).reduce((s, i) => s + i.cantidad, 0), viejo = esViejo(e), est = ESTADO[e.estado] || ESTADO.en_cliente;
                    return (
                      <tr key={e.id} onClick={() => setSelectedId(e.id)} className={`cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800/40 ${selectedId === e.id ? "bg-orange-50 dark:bg-orange-950/20" : ""}`}>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-500">
                          {formatDate(e.fecha)}
                          {viejo && <span className="ml-1 text-[10px] font-semibold text-amber-600" title={`${diasDesde(e.fecha)} días en el cliente`}><AlertTriangle className="inline h-3 w-3" /> {diasDesde(e.fecha)}d</span>}
                        </td>
                        <td className="px-3 font-mono text-xs">{e.numero}</td>
                        <td className="px-3">{clienteMap.get(e.cliente_id) || "—"}</td>
                        <td className="px-3 text-right"><b>{pend}</b><span className="text-zinc-400"> / {tot}</span></td>
                        <td className="px-3 text-right">{valorPendiente(e.id) ? formatCurrency(valorPendiente(e.id), e.moneda) : "—"}</td>
                        <td className="px-3"><Badge variant={est.variant}>{est.label}</Badge></td>
                        <td className="px-3"><Eye size={15} className="text-zinc-400" /></td>
                      </tr>
                    );
                  })}
                  {!filtrados.length && <tr><td colSpan={7} className="py-10 text-center text-sm text-zinc-400">No hay muestras con este filtro.</td></tr>}
                </tbody>
              </table>
            )}
          </div>

          {sel && (
            <div className="h-fit rounded-xl border border-zinc-200 bg-white lg:sticky lg:top-5 lg:w-2/5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-start justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
                <div>
                  <p className="font-mono text-xs text-zinc-500">{sel.numero}</p>
                  <h3 className="font-semibold dark:text-white">{clienteMap.get(sel.cliente_id) || "—"}</h3>
                  <p className="text-xs text-zinc-500">
                    Entregadas el {formatDate(sel.fecha)} · hace {diasDesde(sel.fecha)} días
                    {sel.sucursal_id ? ` · ${sucursales.find(s => s.id === sel.sucursal_id)?.nombre || ""}` : ""}
                    {sel.created_by_profile?.full_name ? ` · ${sel.created_by_profile.full_name}` : ""}
                    {sel.fecha_devolucion ? ` · última devolución/cierre: ${formatDate(sel.fecha_devolucion)}` : ""}
                  </p>
                  {sel.observaciones && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{sel.observaciones}</p>}
                </div>
                <button onClick={() => setSelectedId(null)}><X className="h-5 w-5 text-zinc-400" /></button>
              </div>
              <div className="space-y-3 p-4">
                {itemsDe(sel.id).map(i => {
                  const pend = pendienteDe(i);
                  return (
                    <div key={i.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium dark:text-white">
                            {nombreItem(i)}
                            {talleItem(i) && <span className="ml-1 rounded bg-zinc-100 px-1 text-[10px] dark:bg-zinc-800">T {talleItem(i)}</span>}
                            {i.color && <span className="ml-1 text-[10px] text-zinc-500">{i.color}</span>}
                          </p>
                          <p className="text-[11px] text-zinc-500">
                            {i.cantidad} entregada(s)
                            {i.cantidad_devuelta ? ` · ${i.cantidad_devuelta} devuelta(s)` : ""}
                            {i.cantidad_vendida ? ` · ${i.cantidad_vendida} se la quedó` : ""}
                            {i.cantidad_baja ? ` · ${i.cantidad_baja} baja/regalo` : ""}
                            {i.precio_unitario ? ` · ${formatCurrency(i.precio_unitario, sel.moneda)} c/u` : ""}
                          </p>
                        </div>
                        {pend > 0 ? <Badge variant="warning">{pend} en el cliente</Badge> : <Badge variant="success">Resuelto</Badge>}
                      </div>
                      {pend > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <input type="number" min={1} max={pend} value={cantidades[i.id] || pend} onChange={e => setCantidades(prev => ({ ...prev, [i.id]: Number(e.target.value) }))}
                            title="Cantidad" className="w-16 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          <input type="date" value={fechas[i.id] || todayAR()} max={todayAR()} onChange={e => setFechas(prev => ({ ...prev, [i.id]: e.target.value }))}
                            title="Fecha" className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          <button disabled={saving} onClick={() => resolver(i, "devuelta")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400 px-2 py-1 text-xs font-medium text-emerald-700 disabled:opacity-50 dark:text-emerald-400"><RotateCcw className="h-3 w-3" /> Devolvió</button>
                          <button disabled={saving} onClick={() => resolver(i, "vendida")} className="inline-flex items-center gap-1 rounded-lg border border-orange-400 px-2 py-1 text-xs font-medium text-orange-700 disabled:opacity-50 dark:text-orange-300"><ShoppingBag className="h-3 w-3" /> Se la quedó</button>
                          <button disabled={saving} onClick={() => resolver(i, "baja")} className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"><Gift className="h-3 w-3" /> Baja / regalo</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-1">
                  <button onClick={() => eliminar(sel)} className="inline-flex items-center gap-1 text-xs text-red-600"><Trash2 className="h-3.5 w-3.5" /> Eliminar registro</button>
                  {valorPendiente(sel.id) > 0 && <span className="text-xs text-zinc-500">Valor en el cliente: <b>{formatCurrency(valorPendiente(sel.id), sel.moneda)}</b></span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {modal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
              <h2 className="text-lg font-bold dark:text-white">Registrar entrega de muestras</h2>
              <button onClick={() => setModal(false)}><X className="h-5 w-5 text-zinc-400" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="text-xs text-zinc-500">Cliente {form.cliente_id && <b className="text-zinc-800 dark:text-zinc-100">· {clienteMap.get(form.cliente_id)}</b>}</label>
                  <Autocompletar opciones={clientes.map(c => ({ valor: c.id, texto: c.razon_social }))} placeholder={form.cliente_id ? "Cambiar cliente…" : "Escribí el cliente…"}
                    onElegir={v => setForm(f => ({ ...f, cliente_id: v, sucursal_id: "" }))} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Sucursal</label>
                  <select value={form.sucursal_id} onChange={e => setForm(f => ({ ...f, sucursal_id: e.target.value }))} className={inputClass} disabled={!form.cliente_id}>
                    <option value="">Casa central</option>
                    {sucursales.filter(s => s.cliente_id === form.cliente_id).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs text-zinc-500">Fecha</label><input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} className={inputClass} /></div>
                  <div><label className="text-xs text-zinc-500">Moneda</label><select value={form.moneda} onChange={e => setForm(f => ({ ...f, moneda: e.target.value as "ARS" | "USD" }))} className={inputClass}><option value="ARS">$</option><option value="USD">US$</option></select></div>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead className="text-left text-zinc-500"><tr><th className="py-1">Artículo</th><th className="w-16">Talle</th><th className="w-24">Color</th><th className="w-16 text-right">Cant.</th><th className="w-28 text-right">Valor c/u (opcional)</th><th className="w-6"></th></tr></thead>
                <tbody>
                  {drafts.map((d, i) => (
                    <tr key={i} className="align-top">
                      <td className="py-1 pr-1">
                        <ArticuloInput value={d.descripcion} onTexto={t => setDraft(i, { descripcion: t, catalogo_id: null, codigo: "" })} onElegir={c => elegirDelCatalogo(i, c)} />
                        {d.catalogo_id && <span className="text-[10px] text-emerald-600">De la lista · {d.codigo}</span>}
                      </td>
                      <td className="py-1 pr-1"><input value={d.talle} onChange={e => setDraft(i, { talle: e.target.value })} className={inputClass} /></td>
                      <td className="py-1 pr-1"><input value={d.color} onChange={e => setDraft(i, { color: e.target.value })} className={inputClass} /></td>
                      <td className="py-1 pr-1"><input type="number" min={1} value={d.cantidad} onChange={e => setDraft(i, { cantidad: Number(e.target.value) || 0 })} className={`${inputClass} text-right`} /></td>
                      <td className="py-1 pr-1"><input value={d.precio} onChange={e => setDraft(i, { precio: e.target.value })} inputMode="decimal" placeholder="0" className={`${inputClass} text-right`} /></td>
                      <td className="py-2"><button onClick={() => setDrafts(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : [draftVacio()])} className="text-zinc-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => setDrafts(prev => [...prev, draftVacio()])} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs dark:border-zinc-700 dark:text-zinc-200"><Plus className="h-3.5 w-3.5" /> Otra prenda</button>
              <div><label className="text-xs text-zinc-500">Observaciones</label><textarea value={form.observaciones} onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} rows={2} className={inputClass} /></div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
              <button onClick={() => setModal(false)} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cancelar</button>
              <button onClick={crearEnvio} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Registrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
