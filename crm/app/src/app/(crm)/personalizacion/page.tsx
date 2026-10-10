"use client";

/**
 * Personalización: bordados y estampados.
 *
 *  · Talleres: proveedores marcados como bordador / estampador (se dan de alta acá o en Proveedores),
 *    con su lista de precios por técnica.
 *  · Trabajos: lo que les llevamos (prendas por cliente) y el personalizado de cada prenda,
 *    con su costo. Estados simples: En el taller → Listo (parcial/total) → Retirado.
 *  · Logos: memoria por cliente (técnica, ubicación, último costo y archivo).
 *  · Liquidaciones: a fin de mes se junta todo lo del taller. Si factura, se vincula su factura;
 *    si no, se genera una liquidación interna que queda como deuda para pagarle.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { Autocompletar } from "@/components/ui/autocompletar";
import { Loader2, Plus, X, Trash2, Printer, Check, Scissors, Image as ImageIcon, FileText, Eye, Sparkles } from "lucide-react";

const db = supabase as any;

type Estado = "en_taller" | "listo_parcial" | "listo" | "retirado" | "anulado";
const ESTADOS: Record<Estado, { label: string; variant: "warning" | "info" | "success" | "default" | "danger" }> = {
  en_taller: { label: "En el taller", variant: "warning" },
  listo_parcial: { label: "Listo parcial", variant: "info" },
  listo: { label: "Listo", variant: "success" },
  retirado: { label: "Retirado", variant: "default" },
  anulado: { label: "Anulado", variant: "danger" },
};
const TECNICAS = ["Bordado", "Estampa", "DTF", "Vinilo", "Sublimado", "Otro"];
const UBICACIONES = ["Pecho izquierdo", "Pecho derecho", "Espalda", "Espalda alta", "Manga izquierda", "Manga derecha", "Gorra frente", "Bolsillo", "Pierna"];

interface Taller { id: string; razon_social: string; cuit: string | null; tipo_personalizacion: string | null; telefono?: string | null }
interface Cliente { id: string; razon_social: string; cuit?: string | null }
interface Precio { id: string; proveedor_id: string; tecnica: string; detalle: string; precio: number; moneda: string; activo: boolean }
interface Logo { id: string; cliente_id: string; nombre: string; tecnica: string | null; ubicacion: string | null; proveedor_id: string | null; ultimo_costo: number | null; archivo_url: string | null; archivo_nombre: string | null; activo: boolean }
interface Item {
  id?: string; prenda: string; talle: string; color: string; cantidad: number; cantidad_lista: number; cantidad_falla: number;
  tecnica: string; ubicacion: string; logo_id: string; costo_unitario: number; presupuesto_item_id: string | null; notas: string;
}
interface Trabajo {
  id: string; numero: string; fecha: string; proveedor_id: string; cliente_id: string | null; presupuesto_id: string | null;
  estado: Estado; fecha_estimada: string | null; fecha_retiro: string | null; moneda: string; liquidacion_id: string | null;
  observaciones: string | null; items: Item[];
}
interface Liquidacion { id: string; numero: string; fecha: string; proveedor_id: string; periodo_desde: string | null; periodo_hasta: string | null; tipo: "factura" | "interna"; total: number; descuento_fallas: number; moneda: string; factura_compra_id: string | null; estado: string }

const inp = "w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";
const itemVacio = (): Item => ({ prenda: "", talle: "", color: "", cantidad: 1, cantidad_lista: 0, cantidad_falla: 0, tecnica: "Bordado", ubicacion: "Pecho izquierdo", logo_id: "", costo_unitario: 0, presupuesto_item_id: null, notas: "" });
const totalItems = (items: Item[]) => items.reduce((s, it) => s + it.cantidad * it.costo_unitario, 0);
const totalLiquidable = (items: Item[]) => items.reduce((s, it) => s + Math.max(0, it.cantidad - it.cantidad_falla) * it.costo_unitario, 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const fc = (n: number, m: string) => formatCurrency(n, m === "USD" ? "USD" : "ARS");

export default function PersonalizacionPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;
  const puedeLiquidar = ["super_admin", "admin", "administrativo"].includes(String(profile?.role || ""));

  const [tab, setTab] = useState<"trabajos" | "talleres" | "logos" | "liquidaciones">("trabajos");
  const [cargando, setCargando] = useState(true);
  const [talleres, setTalleres] = useState<Taller[]>([]);
  const [todosProveedores, setTodosProveedores] = useState<Taller[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [precios, setPrecios] = useState<Precio[]>([]);
  const [logos, setLogos] = useState<Logo[]>([]);
  const [trabajos, setTrabajos] = useState<Trabajo[]>([]);
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<"activos" | Estado | "todos">("activos");
  const [filtroTaller, setFiltroTaller] = useState("");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Trabajo | null>(null);
  const [nuevoTallerOpen, setNuevoTallerOpen] = useState(false);

  const tallerMap = useMemo(() => new Map(talleres.map(t => [t.id, t])), [talleres]);
  const clienteMap = useMemo(() => new Map(clientes.map(c => [c.id, c])), [clientes]);
  const liqMap = useMemo(() => new Map(liquidaciones.map(l => [l.id, l])), [liquidaciones]);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setCargando(true);
    try {
      const [provRes, cliRes, precRes, logoRes, trabRes, liqRes] = await Promise.all([
        db.from("proveedores").select("id, razon_social, cuit, telefono, es_personalizador, tipo_personalizacion").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"),
        db.from("clientes").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"),
        db.from("personalizacion_precios").select("*").eq("sociedad_id", sociedadId).order("tecnica"),
        db.from("personalizacion_logos").select("*").eq("sociedad_id", sociedadId).eq("activo", true).order("nombre"),
        db.from("personalizacion_trabajos").select("*, personalizacion_items(*)").eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(500),
        db.from("personalizacion_liquidaciones").select("*").eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).limit(200),
      ]);
      const err = [provRes, cliRes, precRes, logoRes, trabRes, liqRes].find(r => r.error)?.error;
      if (err) throw err;
      const provs = (provRes.data || []) as Array<Taller & { es_personalizador: boolean }>;
      setTodosProveedores(provs);
      setTalleres(provs.filter(p => p.es_personalizador));
      setClientes(cliRes.data || []);
      setPrecios((precRes.data || []).map((p: any) => ({ ...p, precio: Number(p.precio) })));
      setLogos((logoRes.data || []).map((l: any) => ({ ...l, ultimo_costo: l.ultimo_costo != null ? Number(l.ultimo_costo) : null })));
      setTrabajos((trabRes.data || []).map((t: any) => ({
        ...t,
        items: (t.personalizacion_items || []).sort((a: any, b: any) => a.orden - b.orden).map((it: any) => ({
          ...it, talle: it.talle || "", color: it.color || "", tecnica: it.tecnica || "", ubicacion: it.ubicacion || "", logo_id: it.logo_id || "", notas: it.notas || "",
          costo_unitario: Number(it.costo_unitario) || 0,
        })),
      })));
      setLiquidaciones((liqRes.data || []).map((l: any) => ({ ...l, total: Number(l.total), descuento_fallas: Number(l.descuento_fallas) })));
    } catch (e: any) {
      toast.error(e?.message?.includes("personalizacion") ? "Falta correr la actualización de la base (Personalización)." : `No se pudo cargar: ${e?.message}`);
    } finally {
      setCargando(false);
    }
  }, [sociedadId, toast]);
  useEffect(() => { void cargar(); }, [cargar]);

  const trabajosFiltrados = trabajos.filter(t => {
    if (filtroEstado === "activos" && !["en_taller", "listo_parcial", "listo"].includes(t.estado)) return false;
    if (filtroEstado !== "activos" && filtroEstado !== "todos" && t.estado !== filtroEstado) return false;
    if (filtroTaller && t.proveedor_id !== filtroTaller) return false;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      const txt = `${t.numero} ${clienteMap.get(t.cliente_id || "")?.razon_social || ""} ${tallerMap.get(t.proveedor_id)?.razon_social || ""} ${t.items.map(i => i.prenda).join(" ")}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  });
  const enTaller = trabajos.filter(t => ["en_taller", "listo_parcial"].includes(t.estado));
  const prendasEnTaller = enTaller.reduce((s, t) => s + t.items.reduce((a, i) => a + i.cantidad - i.cantidad_lista - i.cantidad_falla, 0), 0);

  function nuevoTrabajo() {
    setEditando({ id: "", numero: "", fecha: todayAR(), proveedor_id: talleres.length === 1 ? talleres[0].id : "", cliente_id: null, presupuesto_id: null, estado: "en_taller", fecha_estimada: null, fecha_retiro: null, moneda: "ARS", liquidacion_id: null, observaciones: "", items: [itemVacio()] });
  }

  return (
    <div>
      <Header title="Personalización" subtitle="Bordados y estampados: lo que llevamos a cada taller, sus costos y la liquidación del mes" action={{ label: "Nuevo trabajo", onClick: nuevoTrabajo }} />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {([["trabajos", "Trabajos"], ["talleres", "Talleres y precios"], ["logos", "Logos por cliente"], ["liquidaciones", "Liquidaciones"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === k ? "bg-orange-500 text-white" : "border border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>{l}</button>
          ))}
          <span className="ml-auto text-xs text-zinc-500">{enTaller.length} trabajo(s) en talleres · {prendasEnTaller} prenda(s) afuera</span>
        </div>

        {cargando ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div> : (
          <>
            {tab === "trabajos" && (
              <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
                  {(["activos", "en_taller", "listo", "retirado", "todos"] as const).map(e => (
                    <button key={e} onClick={() => setFiltroEstado(e)} className={`rounded-full px-3 py-1 text-xs font-medium ${filtroEstado === e ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      {e === "activos" ? "Activos" : e === "todos" ? "Todos" : ESTADOS[e].label}
                    </button>
                  ))}
                  <select value={filtroTaller} onChange={e => setFiltroTaller(e.target.value)} className="rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="">Todos los talleres</option>
                    {talleres.map(t => <option key={t.id} value={t.id}>{t.razon_social}</option>)}
                  </select>
                  <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente, número o prenda…" className="ml-auto w-64 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/50">
                    <tr><th className="px-3 py-2">Número</th><th className="px-3">Fecha</th><th className="px-3">Taller</th><th className="px-3">Cliente</th><th className="px-3 text-right">Prendas</th><th className="px-3 text-right">Costo</th><th className="px-3">Estado</th><th className="px-3">Liquidación</th><th></th></tr>
                  </thead>
                  <tbody>
                    {trabajosFiltrados.map(t => {
                      const cant = t.items.reduce((s, i) => s + i.cantidad, 0);
                      return (
                        <tr key={t.id} onClick={() => setEditando(JSON.parse(JSON.stringify(t)))} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800/40">
                          <td className="px-3 py-2 font-mono text-xs">{t.numero}</td>
                          <td className="px-3 text-zinc-500">{formatDate(t.fecha)}</td>
                          <td className="px-3">{tallerMap.get(t.proveedor_id)?.razon_social || "—"}</td>
                          <td className="px-3">{clienteMap.get(t.cliente_id || "")?.razon_social || "—"}</td>
                          <td className="px-3 text-right">{cant}</td>
                          <td className="px-3 text-right">{fc(totalItems(t.items), t.moneda)}</td>
                          <td className="px-3"><Badge variant={ESTADOS[t.estado].variant}>{ESTADOS[t.estado].label}</Badge></td>
                          <td className="px-3 font-mono text-xs">{t.liquidacion_id ? liqMap.get(t.liquidacion_id)?.numero || "Sí" : "—"}</td>
                          <td className="px-3"><Eye className="h-4 w-4 text-zinc-400" /></td>
                        </tr>
                      );
                    })}
                    {!trabajosFiltrados.length && <tr><td colSpan={9} className="py-10 text-center text-sm text-zinc-400">{talleres.length ? "No hay trabajos con este filtro." : "Primero cargá un taller en la pestaña “Talleres y precios”."}</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "talleres" && (
              <TalleresTab sociedadId={sociedadId!} talleres={talleres} todos={todosProveedores} precios={precios} trabajos={trabajos}
                onNuevo={() => setNuevoTallerOpen(true)} onCambio={cargar} toast={toast} />
            )}

            {tab === "logos" && (
              <LogosTab sociedadId={sociedadId!} clientes={clientes} talleres={talleres} logos={logos} onCambio={cargar} toast={toast} />
            )}

            {tab === "liquidaciones" && (
              <LiquidacionesTab sociedadId={sociedadId!} talleres={talleres} trabajos={trabajos} liquidaciones={liquidaciones} clienteMap={clienteMap}
                puedeLiquidar={puedeLiquidar} profileId={profile?.id || null} sociedadNombre={sociedadActiva?.razonSocial || "Lazzari"} onCambio={cargar} toast={toast} />
            )}
          </>
        )}
      </main>

      {editando && (
        <TrabajoModal sociedadId={sociedadId!} trabajo={editando} talleres={talleres} clientes={clientes} precios={precios} logos={logos}
          onNuevoTaller={() => setNuevoTallerOpen(true)}
          onClose={() => setEditando(null)} onGuardado={() => { setEditando(null); void cargar(); }} toast={toast} />
      )}
      {nuevoTallerOpen && (
        <NuevoTallerModal sociedadId={sociedadId!} todos={todosProveedores} onClose={() => setNuevoTallerOpen(false)} onCreado={() => { setNuevoTallerOpen(false); void cargar(); }} toast={toast} />
      )}
    </div>
  );
}

type ToastApi = ReturnType<typeof useToast>["toast"];

// ─────────────────────────────────────────────────────────────────────────────
// Trabajo: alta y edición
// ─────────────────────────────────────────────────────────────────────────────
function TrabajoModal({ sociedadId, trabajo, talleres, clientes, precios, logos, onNuevoTaller, onClose, onGuardado, toast }: {
  sociedadId: string; trabajo: Trabajo; talleres: Taller[]; clientes: Cliente[]; precios: Precio[]; logos: Logo[];
  onNuevoTaller: () => void; onClose: () => void; onGuardado: () => void; toast: ToastApi;
}) {
  const [t, setT] = useState<Trabajo>(trabajo);
  const [guardando, setGuardando] = useState(false);
  const [presupuestos, setPresupuestos] = useState<Array<{ id: string; numero: string; estado: string; fecha: string; moneda: string; subtotal: number; tipo_cambio: number | null; tipo_cambio_divisas: number | null }>>([]);
  const [prItems, setPrItems] = useState<Array<{ id: string; descripcion: string; cantidad: number; precio_costo: number; costo_moneda: string; precio_venta: number }>>([]);
  const esNuevo = !t.id;
  const liquidado = !!t.liquidacion_id;
  const set = (c: Partial<Trabajo>) => setT(prev => ({ ...prev, ...c }));
  const setItem = (i: number, c: Partial<Item>) => setT(prev => ({ ...prev, items: prev.items.map((it, j) => j === i ? { ...it, ...c } : it) }));
  const logosCliente = logos.filter(l => l.cliente_id === t.cliente_id);

  // Presupuestos del cliente (para traer las prendas y ver el margen)
  useEffect(() => {
    if (!t.cliente_id) { setPresupuestos([]); return; }
    db.from("presupuestos").select("id, numero, estado, fecha, moneda, subtotal, tipo_cambio, tipo_cambio_divisas").eq("cliente_id", t.cliente_id).eq("sociedad_id", sociedadId)
      .order("fecha", { ascending: false }).limit(40)
      .then(({ data }: any) => setPresupuestos((data || []).map((p: any) => ({ ...p, subtotal: Number(p.subtotal) || 0 }))));
  }, [t.cliente_id, sociedadId]);
  useEffect(() => {
    if (!t.presupuesto_id) { setPrItems([]); return; }
    db.from("presupuesto_items").select("id, descripcion, cantidad, precio_costo, costo_moneda, precio_venta").eq("presupuesto_id", t.presupuesto_id).order("orden")
      .then(({ data }: any) => setPrItems((data || []).map((x: any) => ({ ...x, cantidad: Number(x.cantidad) || 0, precio_costo: Number(x.precio_costo) || 0, precio_venta: Number(x.precio_venta) || 0 }))));
  }, [t.presupuesto_id]);

  /** Costo sugerido: último costo del logo con este taller, o el precio del taller para la técnica. */
  function costoSugerido(it: Item): number | null {
    const logo = logos.find(l => l.id === it.logo_id);
    if (logo && logo.ultimo_costo != null && (!logo.proveedor_id || logo.proveedor_id === t.proveedor_id)) return logo.ultimo_costo;
    const lista = precios.filter(p => p.proveedor_id === t.proveedor_id && p.activo && p.tecnica.toLowerCase() === (it.tecnica || "").toLowerCase());
    const conUbic = lista.find(p => it.ubicacion && p.detalle.toLowerCase().includes(it.ubicacion.toLowerCase().split(" ")[0]));
    return (conUbic || lista[0])?.precio ?? null;
  }

  function traerDelPresupuesto() {
    if (!prItems.length) return;
    const nuevos: Item[] = prItems.map(p => {
      const base = { ...itemVacio(), prenda: p.descripcion, cantidad: Math.max(1, Math.round(p.cantidad)), presupuesto_item_id: p.id };
      const logo = logosCliente[0];
      if (logo) Object.assign(base, { logo_id: logo.id, tecnica: logo.tecnica || base.tecnica, ubicacion: logo.ubicacion || base.ubicacion });
      const sug = costoSugerido(base);
      return { ...base, costo_unitario: sug ?? 0 };
    });
    set({ items: [...t.items.filter(i => i.prenda.trim()), ...nuevos] });
  }

  // Margen del presupuesto incluyendo la personalización (solo informativo)
  const margen = useMemo(() => {
    const pr = presupuestos.find(p => p.id === t.presupuesto_id);
    if (!pr || !prItems.length) return null;
    const conv = (monto: number, moneda: string) => {
      const usd = moneda.toUpperCase().startsWith("USD");
      if (usd === (pr.moneda === "USD")) return monto;
      const tc = moneda.toLowerCase().includes("divisa") ? (pr.tipo_cambio_divisas || pr.tipo_cambio) : (pr.tipo_cambio || pr.tipo_cambio_divisas);
      if (!tc) return null;
      return usd ? monto * tc : monto / tc;
    };
    let costo = 0;
    for (const p of prItems) { const c = conv(p.precio_costo, p.costo_moneda || pr.moneda); if (c === null) return null; costo += c * p.cantidad; }
    const pers = conv(totalItems(t.items), t.moneda);
    if (pers === null) return null;
    const venta = prItems.reduce((s, p) => s + p.precio_venta * p.cantidad, 0);
    if (!(venta > 0)) return null;
    return { venta, sin: ((venta - costo) / venta) * 100, con: ((venta - costo - pers) / venta) * 100, moneda: pr.moneda };
  }, [presupuestos, prItems, t.presupuesto_id, t.items, t.moneda]);

  async function guardar() {
    if (!t.proveedor_id) { toast.error("Elegí el taller"); return; }
    const items = t.items.filter(i => i.prenda.trim() && i.cantidad > 0);
    if (!items.length) { toast.error("Cargá al menos una prenda"); return; }
    if (items.some(i => i.cantidad_lista + i.cantidad_falla > i.cantidad)) { toast.error("Listas + fallas no pueden superar la cantidad"); return; }
    setGuardando(true);
    try {
      // Estado automático según lo que volvió (si no se eligió retirado/anulado a mano)
      let estado = t.estado;
      if (!["retirado", "anulado"].includes(estado)) {
        const total = items.reduce((s, i) => s + i.cantidad, 0), vuelto = items.reduce((s, i) => s + i.cantidad_lista + i.cantidad_falla, 0);
        estado = vuelto <= 0 ? "en_taller" : vuelto >= total ? "listo" : "listo_parcial";
      }
      const cabecera = {
        sociedad_id: sociedadId, fecha: t.fecha, proveedor_id: t.proveedor_id, cliente_id: t.cliente_id, presupuesto_id: t.presupuesto_id,
        estado, fecha_estimada: t.fecha_estimada || null, fecha_retiro: estado === "retirado" ? (t.fecha_retiro || todayAR()) : t.fecha_retiro, moneda: t.moneda, observaciones: t.observaciones || null,
      };
      let id = t.id;
      if (esNuevo) {
        const { data, error } = await db.from("personalizacion_trabajos").insert(cabecera).select("id").single();
        if (error) throw error;
        id = data.id;
      } else {
        const { error } = await db.from("personalizacion_trabajos").update(cabecera).eq("id", id).eq("sociedad_id", sociedadId);
        if (error) throw error;
        const { error: e2 } = await db.from("personalizacion_items").delete().eq("trabajo_id", id);
        if (e2) throw e2;
      }
      const filas = items.map((i, n) => ({
        trabajo_id: id, prenda: i.prenda.trim(), talle: i.talle || null, color: i.color || null, cantidad: Math.round(i.cantidad),
        cantidad_lista: Math.round(i.cantidad_lista), cantidad_falla: Math.round(i.cantidad_falla), tecnica: i.tecnica || null, ubicacion: i.ubicacion || null,
        logo_id: i.logo_id || null, costo_unitario: r2(i.costo_unitario), presupuesto_item_id: i.presupuesto_item_id, notas: i.notas || null, orden: n,
      }));
      const { error: e3 } = await db.from("personalizacion_items").insert(filas);
      if (e3) {
        if (esNuevo) await db.from("personalizacion_trabajos").delete().eq("id", id);
        throw e3;
      }
      // Memoria: último costo de cada logo con este taller
      for (const i of items) if (i.logo_id && i.costo_unitario > 0) {
        await db.from("personalizacion_logos").update({ ultimo_costo: r2(i.costo_unitario), proveedor_id: t.proveedor_id, tecnica: i.tecnica || null, ubicacion: i.ubicacion || null }).eq("id", i.logo_id);
      }
      toast.success(esNuevo ? "Trabajo registrado" : "Trabajo actualizado");
      onGuardado();
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${e?.message}`);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!t.id || liquidado) return;
    if (!window.confirm(`¿Eliminar ${t.numero}?`)) return;
    const { error } = await db.from("personalizacion_trabajos").delete().eq("id", t.id).eq("sociedad_id", sociedadId);
    if (error) { toast.error(error.message); return; }
    onGuardado();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <h2 className="flex items-center gap-2 text-lg font-bold dark:text-white"><Scissors className="h-5 w-5 text-orange-500" /> {esNuevo ? "Nuevo trabajo de personalización" : `Trabajo ${t.numero}`}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {liquidado && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Este trabajo ya está liquidado: podés actualizar estados y cantidades, pero el costo quedó cerrado en la liquidación.</p>}
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="text-xs text-zinc-500">Taller</label>
              <select value={t.proveedor_id} onChange={e => e.target.value === "__nuevo" ? onNuevoTaller() : set({ proveedor_id: e.target.value })} className={inp}>
                <option value="">Elegí…</option>
                {talleres.map(x => <option key={x.id} value={x.id}>{x.razon_social}</option>)}
                <option value="__nuevo">+ Nuevo taller…</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">Cliente</label>
              <Autocompletar opciones={clientes.map(c => ({ valor: c.id, texto: c.razon_social, detalle: c.cuit || undefined }))} placeholder={clientes.find(c => c.id === t.cliente_id)?.razon_social || "Escribí el cliente…"}
                onElegir={v => set({ cliente_id: v, presupuesto_id: null })} className={`${inp} ${t.cliente_id ? "placeholder:text-zinc-800 dark:placeholder:text-zinc-200" : ""}`} />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Presupuesto (opcional)</label>
              <select value={t.presupuesto_id || ""} onChange={e => set({ presupuesto_id: e.target.value || null })} className={inp} disabled={!t.cliente_id}>
                <option value="">—</option>
                {presupuestos.map(p => <option key={p.id} value={p.id}>{p.numero} · {formatDate(p.fecha)} · {p.estado}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-zinc-500">Fecha</label><input type="date" value={t.fecha} onChange={e => set({ fecha: e.target.value })} className={inp} /></div>
              <div><label className="text-xs text-zinc-500">Moneda</label><select value={t.moneda} onChange={e => set({ moneda: e.target.value })} className={inp} disabled={liquidado}><option value="ARS">$</option><option value="USD">US$</option></select></div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div><label className="text-xs text-zinc-500">Estado</label>
              <select value={t.estado} onChange={e => set({ estado: e.target.value as Estado })} className={inp}>
                {(Object.keys(ESTADOS) as Estado[]).map(k => <option key={k} value={k}>{ESTADOS[k].label}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-zinc-500">Lo prometen para</label><input type="date" value={t.fecha_estimada || ""} onChange={e => set({ fecha_estimada: e.target.value || null })} className={inp} /></div>
            <div><label className="text-xs text-zinc-500">Retirado el</label><input type="date" value={t.fecha_retiro || ""} onChange={e => set({ fecha_retiro: e.target.value || null })} className={inp} /></div>
            <div><label className="text-xs text-zinc-500">Observaciones</label><input value={t.observaciones || ""} onChange={e => set({ observaciones: e.target.value })} className={inp} /></div>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Prendas y personalizados</h3>
            <div className="flex gap-2">
              {t.presupuesto_id && prItems.length > 0 && <button onClick={traerDelPresupuesto} className="inline-flex items-center gap-1 rounded-lg border border-orange-400 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-300"><Sparkles className="h-3.5 w-3.5" /> Traer prendas del presupuesto</button>}
              <button onClick={() => set({ items: [...t.items, itemVacio()] })} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs dark:border-zinc-700 dark:text-zinc-200"><Plus className="h-3.5 w-3.5" /> Prenda</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr><th className="px-2 py-2">Prenda</th><th className="px-1">Talle</th><th className="px-1">Color</th><th className="px-1 text-right">Cant.</th><th className="px-1">Técnica</th><th className="px-1">Ubicación</th><th className="px-1">Logo</th><th className="px-1 text-right">Costo unit.</th><th className="px-1 text-right">Listas</th><th className="px-1 text-right">Fallas</th><th className="px-1 text-right">Subtotal</th><th></th></tr>
              </thead>
              <tbody>
                {t.items.map((it, i) => {
                  const sug = costoSugerido(it);
                  return (
                    <tr key={i} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                      <td className="px-1 py-1"><input value={it.prenda} onChange={e => setItem(i, { prenda: e.target.value })} placeholder="Ej: Camisa grafa azul" className={`${inp} min-w-[200px]`} /></td>
                      <td className="px-1 py-1"><input value={it.talle} onChange={e => setItem(i, { talle: e.target.value.toUpperCase() })} className={`${inp} w-14`} /></td>
                      <td className="px-1 py-1"><input value={it.color} onChange={e => setItem(i, { color: e.target.value })} className={`${inp} w-20`} /></td>
                      <td className="px-1 py-1"><input type="number" min={1} value={it.cantidad} onChange={e => setItem(i, { cantidad: Number(e.target.value) || 0 })} className={`${inp} w-16 text-right`} /></td>
                      <td className="px-1 py-1"><select value={it.tecnica} onChange={e => setItem(i, { tecnica: e.target.value })} className={`${inp} w-24`}>{TECNICAS.map(x => <option key={x}>{x}</option>)}</select></td>
                      <td className="px-1 py-1"><input list="ubicaciones-pers" value={it.ubicacion} onChange={e => setItem(i, { ubicacion: e.target.value })} className={`${inp} w-32`} /></td>
                      <td className="px-1 py-1">
                        <select value={it.logo_id} onChange={e => { const l = logos.find(x => x.id === e.target.value); setItem(i, { logo_id: e.target.value, ...(l ? { tecnica: l.tecnica || it.tecnica, ubicacion: l.ubicacion || it.ubicacion } : {}) }); }} className={`${inp} w-32`} disabled={!t.cliente_id}>
                          <option value="">—</option>
                          {logosCliente.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1 text-right">
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} step="0.01" disabled={liquidado} value={it.costo_unitario || ""} onChange={e => setItem(i, { costo_unitario: Number(e.target.value) || 0 })} className={`${inp} w-24 text-right`} />
                          {sug !== null && !liquidado && <button type="button" title={`Usar ${fc(sug, t.moneda)} (lista del taller / último costo del logo)`} onClick={() => setItem(i, { costo_unitario: sug })} className="rounded p-0.5 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40"><Sparkles className="h-3.5 w-3.5" /></button>}
                        </div>
                      </td>
                      <td className="px-1 py-1"><input type="number" min={0} value={it.cantidad_lista} onChange={e => setItem(i, { cantidad_lista: Number(e.target.value) || 0 })} className={`${inp} w-14 text-right`} /></td>
                      <td className="px-1 py-1"><input type="number" min={0} value={it.cantidad_falla} onChange={e => setItem(i, { cantidad_falla: Number(e.target.value) || 0 })} className={`${inp} w-14 text-right`} /></td>
                      <td className="px-1 py-2 text-right font-medium">{fc(it.cantidad * it.costo_unitario, t.moneda)}</td>
                      <td className="px-1 py-1"><button onClick={() => set({ items: t.items.filter((_, j) => j !== i) })} className="text-zinc-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="ubicaciones-pers">{UBICACIONES.map(u => <option key={u} value={u} />)}</datalist>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4 text-sm">
            {margen && <span className="text-xs text-zinc-500">Margen del presupuesto: {margen.sin.toFixed(1)} % → <b className={margen.con < 15 ? "text-red-600" : "text-emerald-700"}>{margen.con.toFixed(1)} % con la personalización</b></span>}
            <span>Total: <b>{fc(totalItems(t.items), t.moneda)}</b></span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div>{!esNuevo && !liquidado && <button onClick={eliminar} className="inline-flex items-center gap-1 text-xs text-red-600"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button>}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cancelar</button>
            <button onClick={guardar} disabled={guardando} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Talleres y precios
// ─────────────────────────────────────────────────────────────────────────────
function TalleresTab({ sociedadId, talleres, todos, precios, trabajos, onNuevo, onCambio, toast }: {
  sociedadId: string; talleres: Taller[]; todos: Taller[]; precios: Precio[]; trabajos: Trabajo[]; onNuevo: () => void; onCambio: () => void; toast: ToastApi;
}) {
  const [sel, setSel] = useState(talleres[0]?.id || "");
  const [nuevo, setNuevo] = useState({ tecnica: "Bordado", detalle: "", precio: "", moneda: "ARS" });
  const lista = precios.filter(p => p.proveedor_id === sel);

  async function agregarPrecio() {
    const precio = Number(String(nuevo.precio).replace(",", "."));
    if (!sel || !(precio >= 0) || !nuevo.precio) { toast.error("Completá técnica y precio"); return; }
    const { error } = await db.from("personalizacion_precios").insert({ sociedad_id: sociedadId, proveedor_id: sel, tecnica: nuevo.tecnica, detalle: nuevo.detalle.trim(), precio, moneda: nuevo.moneda });
    if (error) { toast.error(error.message); return; }
    setNuevo({ ...nuevo, detalle: "", precio: "" });
    onCambio();
  }
  async function actualizarPrecio(p: Precio, precio: number) {
    const { error } = await db.from("personalizacion_precios").update({ precio }).eq("id", p.id);
    if (error) toast.error(error.message); else onCambio();
  }
  async function borrarPrecio(p: Precio) {
    const { error } = await db.from("personalizacion_precios").delete().eq("id", p.id);
    if (error) toast.error(error.message); else onCambio();
  }
  async function marcarExistente(id: string) {
    const { error } = await db.from("proveedores").update({ es_personalizador: true, tipo_personalizacion: "ambos" }).eq("id", id).eq("sociedad_id", sociedadId);
    if (error) toast.error(error.message); else { toast.success("Proveedor marcado como taller"); onCambio(); }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr]">
      <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold dark:text-white">Talleres</h3>
          <button onClick={onNuevo} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-2 py-1 text-xs font-medium text-white"><Plus className="h-3.5 w-3.5" /> Nuevo</button>
        </div>
        <div className="space-y-1">
          {talleres.map(tl => {
            const activos = trabajos.filter(t => t.proveedor_id === tl.id && ["en_taller", "listo_parcial"].includes(t.estado)).length;
            return (
              <button key={tl.id} onClick={() => setSel(tl.id)} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${sel === tl.id ? "bg-orange-50 ring-1 ring-orange-300 dark:bg-orange-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"} dark:text-zinc-200`}>
                <span className="font-medium">{tl.razon_social}</span>
                <span className="block text-[11px] text-zinc-500">{tl.tipo_personalizacion === "bordado" ? "Bordador" : tl.tipo_personalizacion === "estampado" ? "Estampador" : "Bordado y estampado"}{tl.cuit ? ` · CUIT ${tl.cuit}` : " · sin CUIT"}{activos ? ` · ${activos} trabajo(s) en curso` : ""}</span>
              </button>
            );
          })}
          {!talleres.length && <p className="py-4 text-center text-xs text-zinc-400">Todavía no hay talleres.</p>}
        </div>
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <label className="text-[11px] text-zinc-500">¿Ya está cargado como proveedor? Marcalo como taller:</label>
          <Autocompletar chico opciones={todos.filter(p => !talleres.some(t => t.id === p.id)).map(p => ({ valor: p.id, texto: p.razon_social, detalle: p.cuit || undefined }))} placeholder="Escribí el proveedor…" onElegir={marcarExistente} className="mt-1 w-full border-zinc-200 dark:border-zinc-700" />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-2 text-sm font-semibold dark:text-white">Lista de precios {sel ? `· ${talleres.find(t => t.id === sel)?.razon_social || ""}` : ""}</h3>
        {!sel ? <p className="text-xs text-zinc-400">Elegí un taller.</p> : (
          <>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1">Técnica</th><th>Detalle (tamaño / ubicación / puntadas)</th><th className="text-right">Precio</th><th></th></tr></thead>
              <tbody>
                {lista.map(p => (
                  <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                    <td className="py-1.5">{p.tecnica}</td>
                    <td>{p.detalle || "—"}</td>
                    <td className="text-right"><input type="number" defaultValue={p.precio} onBlur={e => { const v = Number(e.target.value); if (v !== p.precio && v >= 0) void actualizarPrecio(p, v); }} className="w-28 rounded border border-zinc-200 px-2 py-0.5 text-right text-sm dark:border-zinc-700 dark:bg-zinc-800" /> <span className="text-xs text-zinc-500">{p.moneda === "USD" ? "US$" : "$"}</span></td>
                    <td className="text-right"><button onClick={() => borrarPrecio(p)} className="text-zinc-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="py-2 pr-2"><select value={nuevo.tecnica} onChange={e => setNuevo({ ...nuevo, tecnica: e.target.value })} className={inp}>{TECNICAS.map(x => <option key={x}>{x}</option>)}</select></td>
                  <td className="pr-2"><input value={nuevo.detalle} onChange={e => setNuevo({ ...nuevo, detalle: e.target.value })} placeholder="Ej: pecho hasta 10 cm" className={inp} /></td>
                  <td className="pr-2"><div className="flex gap-1"><input value={nuevo.precio} onChange={e => setNuevo({ ...nuevo, precio: e.target.value })} inputMode="decimal" placeholder="0" className={`${inp} text-right`} /><select value={nuevo.moneda} onChange={e => setNuevo({ ...nuevo, moneda: e.target.value })} className={`${inp} w-16`}><option value="ARS">$</option><option value="USD">US$</option></select></div></td>
                  <td><button onClick={agregarPrecio} className="rounded-lg bg-orange-500 px-2 py-1.5 text-xs font-medium text-white"><Plus className="h-3.5 w-3.5" /></button></td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-zinc-500">Al cargar un trabajo, la ✨ completa el costo con esta lista (o con el último costo del logo del cliente).</p>
          </>
        )}
      </div>
    </div>
  );
}

function NuevoTallerModal({ sociedadId, todos, onClose, onCreado, toast }: { sociedadId: string; todos: Taller[]; onClose: () => void; onCreado: () => void; toast: ToastApi }) {
  const [f, setF] = useState({ razon_social: "", tipo: "ambos", cuit: "", telefono: "", condicion_iva: "CF" });
  const [guardando, setGuardando] = useState(false);
  async function crear() {
    if (!f.razon_social.trim()) { toast.error("Poné un nombre"); return; }
    const cuit = f.cuit.replace(/\D/g, "");
    if (cuit && todos.some(p => (p.cuit || "").replace(/\D/g, "") === cuit)) { toast.error("Ya hay un proveedor con ese CUIT: marcalo como taller desde la lista."); return; }
    setGuardando(true);
    const { error } = await db.from("proveedores").insert({
      sociedad_id: sociedadId, razon_social: f.razon_social.trim(), cuit: cuit || null, telefono: f.telefono || null,
      condicion_iva: cuit ? f.condicion_iva : "CF", rubro: "Personalización", forma_pago: "Transferencia", activo: true,
      es_personalizador: true, tipo_personalizacion: f.tipo,
    });
    setGuardando(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Taller creado");
    onCreado();
  }
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold dark:text-white">Nuevo taller</h3><button onClick={onClose}><X className="h-5 w-5 text-zinc-400" /></button></div>
        <div className="space-y-2">
          <div><label className="text-xs text-zinc-500">Nombre (como lo conocen)</label><input value={f.razon_social} onChange={e => setF({ ...f, razon_social: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-zinc-500">Tipo</label><select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })} className={inp}><option value="bordado">Bordador</option><option value="estampado">Estampador</option><option value="ambos">Ambos</option></select></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-zinc-500">CUIT (si factura)</label><input value={f.cuit} onChange={e => setF({ ...f, cuit: e.target.value })} className={inp} /></div>
            <div><label className="text-xs text-zinc-500">Condición IVA</label><select value={f.condicion_iva} onChange={e => setF({ ...f, condicion_iva: e.target.value })} className={inp} disabled={!f.cuit}><option value="RI">Resp. Inscripto</option><option value="Monotributo">Monotributo</option><option value="Exento">Exento</option><option value="CF">Sin factura</option></select></div>
          </div>
          <div><label className="text-xs text-zinc-500">Teléfono</label><input value={f.telefono} onChange={e => setF({ ...f, telefono: e.target.value })} className={inp} /></div>
          <p className="text-[11px] text-zinc-500">Queda también en Proveedores (marcado como taller). Los datos bancarios se completan ahí.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cancelar</button>
          <button onClick={crear} disabled={guardando} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{guardando ? "Guardando…" : "Crear taller"}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Logos por cliente
// ─────────────────────────────────────────────────────────────────────────────
function LogosTab({ sociedadId, clientes, talleres, logos, onCambio, toast }: { sociedadId: string; clientes: Cliente[]; talleres: Taller[]; logos: Logo[]; onCambio: () => void; toast: ToastApi }) {
  const [clienteId, setClienteId] = useState("");
  const [f, setF] = useState({ nombre: "", tecnica: "Bordado", ubicacion: "Pecho izquierdo", proveedor_id: "", ultimo_costo: "" });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const delCliente = logos.filter(l => l.cliente_id === clienteId);
  const conLogos = [...new Set(logos.map(l => l.cliente_id))];

  async function agregar() {
    if (!clienteId || !f.nombre.trim()) { toast.error("Elegí el cliente y poné un nombre al logo"); return; }
    setGuardando(true);
    try {
      const { data, error } = await db.from("personalizacion_logos").insert({
        sociedad_id: sociedadId, cliente_id: clienteId, nombre: f.nombre.trim(), tecnica: f.tecnica, ubicacion: f.ubicacion,
        proveedor_id: f.proveedor_id || null, ultimo_costo: f.ultimo_costo ? Number(String(f.ultimo_costo).replace(",", ".")) : null,
      }).select("id").single();
      if (error) throw error;
      if (archivo) {
        const ext = archivo.name.split(".").pop() || "png";
        const path = `${sociedadId}/personalizacion/logos/${data.id}.${ext}`;
        const { error: up } = await supabase.storage.from("comprobantes").upload(path, archivo, { upsert: true });
        if (!up) {
          const url = supabase.storage.from("comprobantes").getPublicUrl(path).data.publicUrl;
          await db.from("personalizacion_logos").update({ archivo_url: url, archivo_nombre: archivo.name }).eq("id", data.id);
        } else toast.error(`El logo se guardó, pero no el archivo: ${up.message}`);
      }
      setF({ ...f, nombre: "", ultimo_costo: "" }); setArchivo(null);
      onCambio();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }
  async function quitar(l: Logo) {
    const { error } = await db.from("personalizacion_logos").update({ activo: false }).eq("id", l.id);
    if (error) toast.error(error.message); else onCambio();
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-80"><Autocompletar opciones={clientes.map(c => ({ valor: c.id, texto: `${c.razon_social}${conLogos.includes(c.id) ? " · tiene logos" : ""}`, detalle: c.cuit || undefined }))} placeholder={clientes.find(c => c.id === clienteId)?.razon_social || "Escribí el cliente…"} onElegir={setClienteId} className={`${inp} ${clienteId ? "placeholder:text-zinc-800 dark:placeholder:text-zinc-200" : ""}`} /></div>
        <span className="text-xs text-zinc-500">Cada logo guarda técnica, ubicación, taller y último costo: al cargar un trabajo se completa solo.</span>
      </div>
      {clienteId && (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1">Logo</th><th>Técnica</th><th>Ubicación</th><th>Taller</th><th className="text-right">Último costo</th><th>Archivo</th><th></th></tr></thead>
            <tbody>
              {delCliente.map(l => (
                <tr key={l.id} className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                  <td className="py-1.5 font-medium">{l.nombre}</td><td>{l.tecnica || "—"}</td><td>{l.ubicacion || "—"}</td>
                  <td>{talleres.find(t => t.id === l.proveedor_id)?.razon_social || "—"}</td>
                  <td className="text-right">{l.ultimo_costo != null ? formatCurrency(l.ultimo_costo) : "—"}</td>
                  <td>{l.archivo_url ? <a href={l.archivo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-600 underline"><ImageIcon className="h-3.5 w-3.5" /> ver</a> : "—"}</td>
                  <td className="text-right"><button onClick={() => quitar(l)} className="text-zinc-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
              <tr className="border-t border-zinc-200 dark:border-zinc-700">
                <td className="py-2 pr-1"><input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Logo frente" className={inp} /></td>
                <td className="pr-1"><select value={f.tecnica} onChange={e => setF({ ...f, tecnica: e.target.value })} className={inp}>{TECNICAS.map(x => <option key={x}>{x}</option>)}</select></td>
                <td className="pr-1"><input list="ubicaciones-logos" value={f.ubicacion} onChange={e => setF({ ...f, ubicacion: e.target.value })} className={inp} /><datalist id="ubicaciones-logos">{UBICACIONES.map(u => <option key={u} value={u} />)}</datalist></td>
                <td className="pr-1"><select value={f.proveedor_id} onChange={e => setF({ ...f, proveedor_id: e.target.value })} className={inp}><option value="">—</option>{talleres.map(t => <option key={t.id} value={t.id}>{t.razon_social}</option>)}</select></td>
                <td className="pr-1"><input value={f.ultimo_costo} onChange={e => setF({ ...f, ultimo_costo: e.target.value })} inputMode="decimal" placeholder="0" className={`${inp} text-right`} /></td>
                <td className="pr-1"><label className="inline-flex cursor-pointer items-center gap-1 text-xs text-orange-600"><ImageIcon className="h-3.5 w-3.5" />{archivo ? archivo.name.slice(0, 14) : "Adjuntar"}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setArchivo(e.target.files?.[0] || null)} /></label></td>
                <td><button onClick={agregar} disabled={guardando} className="rounded-lg bg-orange-500 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50"><Plus className="h-3.5 w-3.5" /></button></td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidaciones mensuales
// ─────────────────────────────────────────────────────────────────────────────
function LiquidacionesTab({ sociedadId, talleres, trabajos, liquidaciones, clienteMap, puedeLiquidar, profileId, sociedadNombre, onCambio, toast }: {
  sociedadId: string; talleres: Taller[]; trabajos: Trabajo[]; liquidaciones: Liquidacion[]; clienteMap: Map<string, Cliente>;
  puedeLiquidar: boolean; profileId: string | null; sociedadNombre: string; onCambio: () => void; toast: ToastApi;
}) {
  const hoy = todayAR();
  const [tallerId, setTallerId] = useState(talleres[0]?.id || "");
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [moneda, setMoneda] = useState("ARS");
  const [tipo, setTipo] = useState<"interna" | "factura">("interna");
  const [facturas, setFacturas] = useState<Array<{ id: string; numero_factura: string; total: number; fecha: string }>>([]);
  const [facturaId, setFacturaId] = useState("");
  const [guardando, setGuardando] = useState(false);
  const taller = talleres.find(t => t.id === tallerId);

  const pendientes = trabajos.filter(t => t.proveedor_id === tallerId && !t.liquidacion_id && t.estado !== "anulado" && t.moneda === moneda && t.fecha >= desde && t.fecha <= hasta);
  const totalBruto = r2(pendientes.reduce((s, t) => s + totalItems(t.items), 0));
  const totalNeto = r2(pendientes.reduce((s, t) => s + totalLiquidable(t.items), 0));
  const fallas = r2(totalBruto - totalNeto);

  useEffect(() => {
    if (!tallerId || tipo !== "factura") { setFacturas([]); return; }
    db.from("facturas_compra").select("id, numero_factura, total, fecha").eq("sociedad_id", sociedadId).eq("proveedor_id", tallerId)
      .neq("estado", "anulada").not("tipo_comprobante", "ilike", "NC%").order("fecha", { ascending: false }).limit(30)
      .then(({ data }: any) => setFacturas((data || []).map((f: any) => ({ ...f, total: Number(f.total) }))));
  }, [tallerId, tipo, sociedadId]);

  function imprimir(liq: { numero: string; fecha: string; tipo: string }, ts: Trabajo[], total: number, descuento: number) {
    const filas = ts.flatMap(t => t.items.map(i => `<tr><td>${t.numero}</td><td>${formatDate(t.fecha)}</td><td>${clienteMap.get(t.cliente_id || "")?.razon_social || ""}</td><td>${i.prenda}${i.talle ? ` T ${i.talle}` : ""}</td><td>${i.tecnica} · ${i.ubicacion}</td><td style="text-align:right">${i.cantidad}</td><td style="text-align:right">${i.cantidad_falla || ""}</td><td style="text-align:right">${fc(i.costo_unitario, moneda)}</td><td style="text-align:right">${fc(Math.max(0, i.cantidad - i.cantidad_falla) * i.costo_unitario, moneda)}</td></tr>`)).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${liq.numero}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}th{background:#f4f4f5}.tot{text-align:right;font-size:14px;margin-top:10px}.firma{margin-top:60px;display:flex;gap:80px}.firma div{border-top:1px solid #333;padding-top:4px;width:220px;text-align:center}</style></head><body>
      <h1>${liq.tipo === "interna" ? "Liquidación interna de personalización" : "Detalle de personalización"} · ${liq.numero}</h1>
      <p>${sociedadNombre} · Taller: <b>${taller?.razon_social || ""}</b>${taller?.cuit ? ` (CUIT ${taller.cuit})` : ""} · Período ${formatDate(desde)} al ${formatDate(hasta)} · Emitida ${formatDate(liq.fecha)}</p>
      <table><thead><tr><th>Trabajo</th><th>Fecha</th><th>Cliente</th><th>Prenda</th><th>Personalizado</th><th style="text-align:right">Cant.</th><th style="text-align:right">Fallas</th><th style="text-align:right">Unit.</th><th style="text-align:right">Importe</th></tr></thead><tbody>${filas}</tbody></table>
      ${descuento > 0 ? `<p class="tot">Descuento por fallas: −${fc(descuento, moneda)}</p>` : ""}
      <p class="tot">Total a pagar: <b>${fc(total, moneda)}</b></p>
      ${liq.tipo === "interna" ? `<p style="font-size:10px;color:#555">Comprobante interno sin validez fiscal. Recibí conforme el importe indicado.</p><div class="firma"><div>Firma del taller</div><div>Aclaración</div></div>` : ""}
      <script>window.onload=()=>window.print()</script></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  async function liquidar() {
    if (!puedeLiquidar) { toast.error("Solo administración puede liquidar"); return; }
    if (!pendientes.length) { toast.error("No hay trabajos sin liquidar en ese período"); return; }
    if (tipo === "factura" && !facturaId) { toast.error("Elegí la factura del taller (cargala antes en Finanzas → Cargar facturas)"); return; }
    if (!window.confirm(`Liquidar ${pendientes.length} trabajo(s) de ${taller?.razon_social} por ${fc(totalNeto, moneda)}?`)) return;
    setGuardando(true);
    let liqId = "", facturaCreada = "";
    try {
      const { data: liq, error } = await db.from("personalizacion_liquidaciones").insert({
        sociedad_id: sociedadId, proveedor_id: tallerId, periodo_desde: desde, periodo_hasta: hasta, tipo, moneda,
        total: totalNeto, descuento_fallas: fallas, factura_compra_id: tipo === "factura" ? facturaId : null, created_by: profileId,
      }).select("id, numero, fecha").single();
      if (error) throw error;
      liqId = liq.id;
      if (tipo === "interna") {
        // Comprobante interno: queda como deuda con el taller y aparece en pagos.
        const { data: fcRow, error: e2 } = await db.from("facturas_compra").insert({
          numero_factura: liq.numero, tipo_comprobante: "FC Manual", proveedor_id: tallerId, fecha: liq.fecha, fecha_vencimiento: null,
          subtotal: totalNeto, iva_porcentaje: 0, iva: 0, percepciones: 0, total: totalNeto, moneda,
          notas: `Liquidación interna de personalización ${formatDate(desde)} a ${formatDate(hasta)} — ${pendientes.length} trabajo(s) — sin factura fiscal`,
          estado: "pendiente", solo_iva: false, tipo: "mercaderia", sociedad_id: sociedadId, created_by: profileId,
        }).select("id").single();
        if (e2) throw e2;
        facturaCreada = fcRow.id;
        await db.from("personalizacion_liquidaciones").update({ factura_compra_id: fcRow.id }).eq("id", liq.id);
      }
      const { error: e3 } = await db.from("personalizacion_trabajos").update({ liquidacion_id: liq.id }).in("id", pendientes.map(t => t.id)).eq("sociedad_id", sociedadId);
      if (e3) throw e3;
      toast.success(tipo === "interna" ? `Liquidación ${liq.numero} creada: ya figura para pagar en Finanzas` : `Liquidación ${liq.numero} vinculada a la factura`);
      imprimir(liq, pendientes, totalNeto, fallas);
      onCambio();
    } catch (e: any) {
      if (facturaCreada) await db.from("facturas_compra").delete().eq("id", facturaCreada);
      if (liqId) await db.from("personalizacion_liquidaciones").delete().eq("id", liqId);
      toast.error(`No se pudo liquidar: ${e?.message}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="block text-xs text-zinc-500">Taller</label><select value={tallerId} onChange={e => setTallerId(e.target.value)} className={inp}><option value="">Elegí…</option>{talleres.map(t => <option key={t.id} value={t.id}>{t.razon_social}</option>)}</select></div>
          <div><label className="block text-xs text-zinc-500">Desde</label><input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-zinc-500">Hasta</label><input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-zinc-500">Moneda</label><select value={moneda} onChange={e => setMoneda(e.target.value)} className={inp}><option value="ARS">$</option><option value="USD">US$</option></select></div>
          <div><label className="block text-xs text-zinc-500">¿El taller factura?</label>
            <select value={tipo} onChange={e => setTipo(e.target.value as "interna" | "factura")} className={inp}><option value="interna">No → liquidación interna</option><option value="factura">Sí → vincular su factura</option></select>
          </div>
          {tipo === "factura" && <div><label className="block text-xs text-zinc-500">Factura del taller</label><select value={facturaId} onChange={e => setFacturaId(e.target.value)} className={inp}><option value="">Elegí…</option>{facturas.map(f => <option key={f.id} value={f.id}>{f.numero_factura} · {formatDate(f.fecha)} · {formatCurrency(f.total)}</option>)}</select></div>}
        </div>
        {tallerId && (
          <div className="mt-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1">Trabajo</th><th>Fecha</th><th>Cliente</th><th className="text-right">Prendas</th><th className="text-right">Fallas</th><th className="text-right">Importe</th></tr></thead>
              <tbody>
                {pendientes.map(t => (
                  <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                    <td className="py-1.5 font-mono text-xs">{t.numero}</td><td>{formatDate(t.fecha)}</td><td>{clienteMap.get(t.cliente_id || "")?.razon_social || "—"}</td>
                    <td className="text-right">{t.items.reduce((s, i) => s + i.cantidad, 0)}</td>
                    <td className="text-right">{t.items.reduce((s, i) => s + i.cantidad_falla, 0) || "—"}</td>
                    <td className="text-right">{fc(totalLiquidable(t.items), moneda)}</td>
                  </tr>
                ))}
                {!pendientes.length && <tr><td colSpan={6} className="py-6 text-center text-xs text-zinc-400">No hay trabajos sin liquidar de este taller en el período.</td></tr>}
              </tbody>
            </table>
            {pendientes.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-4 text-sm">
                {fallas > 0 && <span className="text-xs text-zinc-500">Descuento por fallas: −{fc(fallas, moneda)}</span>}
                <span>Total a pagar: <b>{fc(totalNeto, moneda)}</b></span>
                <button onClick={liquidar} disabled={guardando || !puedeLiquidar} title={puedeLiquidar ? "" : "Solo administración"} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} {tipo === "interna" ? "Generar liquidación interna" : "Liquidar con su factura"}
                </button>
              </div>
            )}
            {tipo === "interna" && <p className="mt-2 text-right text-[11px] text-zinc-500">La liquidación interna queda como deuda con el taller (aparece en Finanzas para pagar). Sin factura no da crédito de IVA ni se deduce en Ganancias.</p>}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-2 text-sm font-semibold dark:text-white">Liquidaciones emitidas</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1">Número</th><th>Fecha</th><th>Taller</th><th>Período</th><th>Tipo</th><th className="text-right">Total</th><th></th></tr></thead>
          <tbody>
            {liquidaciones.map(l => {
              const ts = trabajos.filter(t => t.liquidacion_id === l.id);
              return (
                <Fragment key={l.id}>
                  <tr className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                    <td className="py-1.5 font-mono text-xs">{l.numero}</td><td>{formatDate(l.fecha)}</td><td>{talleres.find(t => t.id === l.proveedor_id)?.razon_social || "—"}</td>
                    <td className="text-xs">{l.periodo_desde ? `${formatDate(l.periodo_desde)} – ${formatDate(l.periodo_hasta || l.periodo_desde)}` : "—"}</td>
                    <td>{l.tipo === "interna" ? "Interna" : "Con factura"}</td>
                    <td className="text-right">{fc(l.total, l.moneda)}</td>
                    <td className="text-right"><button onClick={() => { setTallerId(l.proveedor_id); setDesde(l.periodo_desde || desde); setHasta(l.periodo_hasta || hasta); setMoneda(l.moneda); imprimir(l, ts, l.total, l.descuento_fallas); }} className="text-zinc-500 hover:text-orange-600" title="Imprimir"><Printer className="h-4 w-4" /></button></td>
                  </tr>
                </Fragment>
              );
            })}
            {!liquidaciones.length && <tr><td colSpan={7} className="py-6 text-center text-xs text-zinc-400">Todavía no hay liquidaciones.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
