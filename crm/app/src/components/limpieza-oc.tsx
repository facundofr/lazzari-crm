"use client";

/**
 * Ordenar OC abiertas (limpieza por proveedor).
 *
 * Las OC viejas se escribieron a mano y no coinciden con cómo factura el proveedor. Acá, por cada
 * renglón pendiente, la IA busca el artículo en la lista de costos DEL PROVEEDOR y propone
 * "esto es [código] descripción oficial". Al aprobar se guarda en el renglón el código, la
 * descripción del proveedor y el talle: NO cambia lo pedido ni los precios, solo agrega cómo
 * lo llama el proveedor para que las facturas coincidan solas.
 *
 * También se configuran los talles especiales y la tolerancia de precio del proveedor, y se
 * pueden cerrar los saldos de OC que no van a llegar.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Sparkles, Search, Check, AlertTriangle, Lock, Unlock, Save } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Autocompletar } from "@/components/ui/autocompletar";
import { buscarCandidatos, type CatalogoCandidato } from "@/lib/catalogo-busqueda";
import { normalizarProveedor } from "@/components/presupuestos/catalogo-picker";
import { parseVariant } from "@/lib/purchase-matching";

const db = supabase as any;

interface Props {
  sociedadId: string;
  onClose: () => void;
  /** Para abrir directo en un proveedor. */
  proveedorInicial?: string;
}

interface Proveedor { id: string; razon_social: string; nombre_fantasia?: string | null; talles_especiales?: string[] | null; tolerancia_precio_pct?: number | null }
interface OcAbierta { id: string; numero: string; fecha: string; total: number; moneda: string; saldo_cerrado: boolean }
type Confianza = "alta" | "media" | "baja" | "ninguna" | "manual" | "guardado";
interface Renglon {
  id: string;
  ocId: string;
  ocNumero: string;
  codigo: string;
  descripcion: string;
  pendiente: number;
  precio: number;
  candidatos: CatalogoCandidato[];
  elegido: number | null;
  talle: string;
  confianza: Confianza;
  nota: string;
  aprobado: boolean;
  yaNormalizado: boolean;
  buscar: string;
  buscando?: boolean;
}

const COLOR: Record<Confianza, string> = {
  alta: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  media: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  baja: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  ninguna: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  manual: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  guardado: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};
const ETIQUETA: Record<Confianza, string> = { alta: "Seguro", media: "Revisar", baja: "Dudoso", ninguna: "No está", manual: "Elegido", guardado: "Ya ordenado" };

const DIAS_VIEJA = 60;
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function LimpiezaOC({ sociedadId, onClose, proveedorInicial }: Props) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [pendientesPorProv, setPendientesPorProv] = useState<Record<string, number>>({});
  const [proveedorId, setProveedorId] = useState(proveedorInicial || "");
  const [nombresLista, setNombresLista] = useState<string[]>([]);          // todos los proveedores de la lista de costos
  const [nombresDelProv, setNombresDelProv] = useState<string[]>([]);      // los que corresponden a este proveedor
  const [ocs, setOcs] = useState<OcAbierta[]>([]);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [verOrdenados, setVerOrdenados] = useState(false);
  const [tallesTexto, setTallesTexto] = useState("");
  const [tolerancia, setTolerancia] = useState("1");

  const proveedor = proveedores.find(p => p.id === proveedorId) || null;

  // ── Proveedores con OC abiertas (y cuántos renglones sin ordenar tienen) ──
  useEffect(() => {
    if (!sociedadId) return;
    (async () => {
      let { data: provs, error: e } = await db.from("proveedores").select("id, razon_social, nombre_fantasia, talles_especiales, tolerancia_precio_pct")
        .eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social");
      if (e) ({ data: provs } = await db.from("proveedores").select("id, razon_social").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"));
      setProveedores(provs || []);
      const { data: abiertas } = await db.from("ordenes_compra").select("id, proveedor_id, saldo_cerrado")
        .eq("sociedad_id", sociedadId).neq("estado", "cancelada");
      const vivas = (abiertas || []).filter((o: any) => !o.saldo_cerrado && o.proveedor_id);
      const provDeOc = new Map<string, string>(vivas.map((o: any) => [o.id, o.proveedor_id]));
      const cuenta: Record<string, number> = {};
      const ids = [...provDeOc.keys()];
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await db.from("orden_compra_items_pendientes").select("orden_id, descripcion_proveedor, cantidad_pendiente")
          .in("orden_id", ids.slice(i, i + 150)).gt("cantidad_pendiente", 0);
        for (const r of data || []) if (!r.descripcion_proveedor) {
          const p = provDeOc.get(r.orden_id)!;
          cuenta[p] = (cuenta[p] || 0) + 1;
        }
      }
      setPendientesPorProv(cuenta);
    })();
  }, [sociedadId]);

  // ── Nombres de proveedores de la lista de costos (una vez) ──
  useEffect(() => {
    (async () => {
      const set = new Set<string>();
      for (let desde = 0; desde < 80000; desde += 1000) {
        const { data } = await db.from("catalogo_costos").select("proveedor").eq("activo", true).range(desde, desde + 999);
        (data || []).forEach((r: any) => r.proveedor && set.add(r.proveedor));
        if (!data || data.length < 1000) break;
      }
      setNombresLista([...set].sort((a, b) => a.localeCompare(b, "es")));
    })();
  }, []);

  // ── Al elegir proveedor: reglas, vínculo con la lista y renglones pendientes ──
  useEffect(() => {
    if (!proveedorId || !sociedadId) { setRenglones([]); setOcs([]); return; }
    setTallesTexto((proveedor?.talles_especiales || []).join(", "));
    setTolerancia(String(proveedor?.tolerancia_precio_pct ?? 1));
    void cargarProveedor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorId, sociedadId, nombresLista.length]);

  async function cargarProveedor() {
    setCargando(true); setError(""); setAviso("");
    try {
      // Nombres de la lista que corresponden a este proveedor: vínculos guardados + mismo nombre.
      const { data: vs } = await db.from("catalogo_proveedores").select("proveedor_lista").eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId);
      const propios = new Set<string>((vs || []).map((v: any) => v.proveedor_lista));
      const nRs = normalizarProveedor(proveedor?.razon_social || ""), nNf = normalizarProveedor(proveedor?.nombre_fantasia || "");
      for (const n of nombresLista) {
        const nn = normalizarProveedor(n);
        if (nn && (nn === nRs || nn === nNf)) propios.add(n);
      }
      setNombresDelProv([...propios]);

      const { data: ocRows, error: e1 } = await db.from("ordenes_compra").select("id, numero, fecha, total, moneda, saldo_cerrado")
        .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId).neq("estado", "cancelada").order("fecha");
      if (e1) throw e1;
      const lista: OcAbierta[] = (ocRows || []).map((o: any) => ({ ...o, total: Number(o.total) || 0, saldo_cerrado: !!o.saldo_cerrado }));
      const vivas = lista.filter(o => !o.saldo_cerrado);
      const numero = new Map(lista.map(o => [o.id, o.numero]));
      const out: Renglon[] = [];
      for (let i = 0; i < vivas.length; i += 150) {
        const { data, error: e2 } = await db.from("orden_compra_items_pendientes")
          .select("id, orden_id, codigo, descripcion, cantidad_pendiente, precio_unitario, codigo_proveedor, descripcion_proveedor, talle")
          .in("orden_id", vivas.slice(i, i + 150).map(o => o.id)).gt("cantidad_pendiente", 0);
        if (e2) throw e2;
        for (const r of data || []) {
          const v = parseVariant(r.descripcion || "");
          const ya = !!r.descripcion_proveedor;
          out.push({
            id: r.id, ocId: r.orden_id, ocNumero: numero.get(r.orden_id) || "OC", codigo: r.codigo || "", descripcion: r.descripcion || "",
            pendiente: Number(r.cantidad_pendiente) || 0, precio: Number(r.precio_unitario) || 0,
            candidatos: ya ? [{ id: "guardado", proveedor: "", codigo: r.codigo_proveedor || "", codigo_interno: null, descripcion: r.descripcion_proveedor, moneda: "", costo: 0, precio_venta: 0 }] : [],
            elegido: ya ? 0 : null, talle: r.talle || v.talle || "", confianza: ya ? "guardado" : "ninguna", nota: "",
            aprobado: false, yaNormalizado: ya, buscar: "",
          });
        }
      }
      setOcs(lista);
      setRenglones(out);
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar las OC");
    } finally {
      setCargando(false);
    }
  }

  // ── Vincular un nombre de la lista con este proveedor (si no se reconoció solo) ──
  async function vincularNombre(nombre: string) {
    if (!nombre) return;
    await db.from("catalogo_proveedores").upsert({ sociedad_id: sociedadId, proveedor_lista: nombre, proveedor_id: proveedorId }, { onConflict: "sociedad_id,proveedor_lista" });
    await db.from("proveedores").update({ nombre_fantasia: nombre }).eq("id", proveedorId).is("nombre_fantasia", null);
    setNombresDelProv(prev => [...new Set([...prev, nombre])]);
  }

  // ── Reglas del proveedor ──
  async function guardarReglas() {
    const talles = [...new Set(tallesTexto.split(/[,;\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean))];
    const tol = Math.max(0, Math.min(50, Number(String(tolerancia).replace(",", ".")) || 0));
    const { error: e } = await db.from("proveedores").update({ talles_especiales: talles, tolerancia_precio_pct: tol }).eq("id", proveedorId).eq("sociedad_id", sociedadId);
    if (e) { setError(`No se pudieron guardar las reglas: ${e.message}`); return; }
    setProveedores(prev => prev.map(p => p.id === proveedorId ? { ...p, talles_especiales: talles, tolerancia_precio_pct: tol } : p));
    setTallesTexto(talles.join(", "));
    setAviso("Reglas del proveedor guardadas. Se usan al conciliar sus facturas.");
  }

  // ── IA: proponer el artículo de la lista para cada renglón sin ordenar ──
  async function ordenarConIA() {
    if (!nombresDelProv.length) { setError("Primero indicá cómo figura este proveedor en la lista de costos."); return; }
    setError(""); setAviso("");
    const prefs = { provs: nombresDelProv, soloProvs: true, marcas: [], soloMarcas: false };
    const objetivo = renglones.filter(r => !r.yaNormalizado && !r.aprobado);
    const base = renglones.map(r => ({ ...r }));
    const porId = new Map(base.map(r => [r.id, r]));
    for (let i = 0; i < objetivo.length; i += 6) {
      setProgreso(`Buscando en la lista del proveedor… ${Math.min(i + 6, objetivo.length)} de ${objetivo.length}`);
      await Promise.all(objetivo.slice(i, i + 6).map(async r => {
        const v = parseVariant(r.descripcion);
        const texto = v.producto || r.descripcion;
        porId.get(r.id)!.candidatos = await buscarCandidatos(texto, r.codigo, 8, prefs);
      }));
    }
    setProgreso("La IA está eligiendo el artículo de cada renglón…");
    try {
      const res = await fetch("/api/normalizar-oc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor: proveedor?.razon_social || "",
          renglones: objetivo.map(r => ({ id: r.id, descripcion: r.descripcion, codigo: r.codigo, candidatos: porId.get(r.id)!.candidatos.map(c => ({ codigo: c.codigo_interno || c.codigo, descripcion: c.descripcion, marca: c.marca })) })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "La IA no respondió");
      const elecciones = new Map<string, any>((j.elecciones || []).map((e: any) => [String(e.id), e]));
      for (const r of objetivo) {
        const fila = porId.get(r.id)!;
        const e = elecciones.get(r.id);
        const idx = e && e.indice != null && fila.candidatos[Number(e.indice)] ? Number(e.indice) : null;
        if (e) {
          fila.elegido = idx;
          fila.confianza = idx === null ? "ninguna" : (["alta", "media", "baja"].includes(e.confianza) ? e.confianza : "media");
          fila.nota = e.nota || "";
          if (e.talle && !fila.talle) fila.talle = String(e.talle).toUpperCase();
        } else if (fila.candidatos.length) {
          fila.elegido = 0; fila.confianza = "baja"; fila.nota = "Sugerido por similitud (sin IA)";
        }
        fila.aprobado = fila.confianza === "alta";
      }
      setRenglones(base);
      const seguros = objetivo.filter(r => porId.get(r.id)!.confianza === "alta").length;
      setAviso(`Listo: ${seguros} seguros (ya tildados), ${objetivo.length - seguros} para revisar.`);
    } catch (e: any) {
      setRenglones(base);
      setError(e?.message || "Error al consultar la IA");
    } finally {
      setProgreso("");
    }
  }

  async function rebuscar(id: string, texto: string) {
    if (!texto.trim()) return;
    setRenglones(rs => rs.map(r => r.id === id ? { ...r, buscando: true } : r));
    const cands = await buscarCandidatos(texto, "", 15, { provs: nombresDelProv, soloProvs: nombresDelProv.length > 0, marcas: [], soloMarcas: false });
    setRenglones(rs => rs.map(r => r.id === id ? { ...r, buscando: false, candidatos: cands, elegido: cands.length ? 0 : null, confianza: cands.length ? "manual" : "ninguna", nota: cands.length ? "" : "Sin resultados", aprobado: cands.length > 0, yaNormalizado: false } : r));
  }

  const upd = (id: string, c: Partial<Renglon>) => setRenglones(rs => rs.map(r => r.id === id ? { ...r, ...c } : r));

  async function guardarAprobados() {
    const elegidos = renglones.filter(r => r.aprobado && (r.elegido !== null || r.talle));
    if (!elegidos.length) { setError("No hay renglones tildados para guardar."); return; }
    setGuardando(true); setError("");
    try {
      const payload = elegidos.map(r => {
        const c = r.elegido !== null ? r.candidatos[r.elegido] : null;
        return {
          id: r.id,
          codigo_proveedor: c ? (c.codigo || c.codigo_interno || "") : "",
          descripcion_proveedor: c ? c.descripcion : "",
          talle: r.talle,
          catalogo_id: c && c.id !== "guardado" ? c.id : "",
        };
      });
      for (let i = 0; i < payload.length; i += 500) {
        const { error: e } = await db.rpc("normalizar_items_oc", { p_sociedad_id: sociedadId, p_items: payload.slice(i, i + 500) });
        if (e) throw e;
      }
      setAviso(`Guardado: ${payload.length} renglón(es) ordenados. Las próximas facturas de este proveedor van a coincidir por código.`);
      await cargarProveedor();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  // ── Cerrar / reabrir saldo ──
  async function cerrarSaldo(oc: OcAbierta, cerrar: boolean) {
    let motivo: string | null = null;
    if (cerrar) {
      motivo = window.prompt(`Cerrar el saldo de ${oc.numero}: lo que falta deja de figurar como pendiente.\n\nMotivo (opcional):`, "El proveedor no va a entregar el resto");
      if (motivo === null) return;
    }
    const { error: e } = await db.rpc("cerrar_saldo_oc", { p_sociedad_id: sociedadId, p_oc_id: oc.id, p_cerrar: cerrar, p_motivo: motivo });
    if (e) { setError(e.message); return; }
    await cargarProveedor();
  }

  // ── Datos derivados ──
  const visibles = renglones.filter(r => verOrdenados || !r.yaNormalizado);
  const sinOrdenar = renglones.filter(r => !r.yaNormalizado).length;
  const tildados = renglones.filter(r => r.aprobado).length;
  const saldoPorOc = useMemo(() => {
    const m = new Map<string, { renglones: number; monto: number }>();
    for (const r of renglones) {
      const x = m.get(r.ocId) || { renglones: 0, monto: 0 };
      x.renglones += 1; x.monto = round2(x.monto + r.pendiente * r.precio);
      m.set(r.ocId, x);
    }
    return m;
  }, [renglones]);
  const hoy = Date.now();
  const ocsConSaldo = ocs.filter(o => saldoPorOc.has(o.id) || o.saldo_cerrado).map(o => {
    const s = saldoPorOc.get(o.id) || { renglones: 0, monto: 0 };
    const dias = Math.floor((hoy - new Date(`${o.fecha}T12:00:00`).getTime()) / 86400000);
    const sugerida = !o.saldo_cerrado && (dias > DIAS_VIEJA || (o.total > 0 && s.monto / o.total < 0.15));
    return { ...o, ...s, dias, sugerida };
  });

  const opcionesProv = proveedores
    .map(p => ({ valor: p.id, texto: `${p.razon_social}${pendientesPorProv[p.id] ? ` · ${pendientesPorProv[p.id]} renglones sin ordenar` : ""}` }))
    .sort((a, b) => (pendientesPorProv[b.valor] || 0) - (pendientesPorProv[a.valor] || 0));

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3">
      <div className="flex h-[94vh] w-full max-w-7xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold dark:text-white"><Sparkles className="h-5 w-5 text-orange-500" /> Ordenar OC abiertas</h2>
            <p className="text-xs text-zinc-500">Por proveedor: cada renglón escrito a mano se traduce al artículo de su lista de costos. No cambia lo pedido ni los precios.</p>
          </div>
          <button onClick={onClose} disabled={guardando}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>

        <div className="space-y-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-96 max-w-full">
              <Autocompletar opciones={opcionesProv} placeholder={proveedor ? proveedor.razon_social : "Escribí el proveedor…"} onElegir={setProveedorId}
                className={`w-full ${proveedor ? "border-orange-300 placeholder:text-zinc-800 dark:placeholder:text-zinc-200" : "border-zinc-300"} dark:border-zinc-700`} />
            </div>
            {proveedor && <>
              <div className="flex items-center gap-1 text-xs">
                <label className="text-zinc-500">Talles especiales</label>
                <input value={tallesTexto} onChange={e => setTallesTexto(e.target.value)} placeholder="ej: 3XL, 4XL, 5XL, 52, 54" className="w-44 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div className="flex items-center gap-1 text-xs">
                <label className="text-zinc-500">Tolerancia de precio</label>
                <input value={tolerancia} onChange={e => setTolerancia(e.target.value)} className="w-14 rounded border border-zinc-200 px-2 py-1 text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                <span className="text-zinc-500">%</span>
              </div>
              <button onClick={guardarReglas} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:border-orange-400 dark:border-zinc-700 dark:text-zinc-200"><Save className="h-3.5 w-3.5" /> Guardar reglas</button>
            </>}
          </div>
          {proveedor && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-500">En la lista de costos figura como:</span>
              {nombresDelProv.map(n => <span key={n} className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">{n}</span>)}
              {!nombresDelProv.length && <span className="font-medium text-red-600">⚠ no lo encontré solo.</span>}
              <div className="w-64">
                <Autocompletar chico opciones={nombresLista.filter(n => !nombresDelProv.includes(n)).map(n => ({ valor: n, texto: n }))}
                  placeholder={nombresDelProv.length ? "Agregar otro nombre de la lista…" : "Escribí cómo figura en la lista…"} onElegir={vincularNombre}
                  className="w-full border-zinc-200 dark:border-zinc-700" />
              </div>
            </div>
          )}
          {error && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {error}</p>}
          {aviso && <p className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> {aviso}</p>}
          {progreso && <p className="flex items-center gap-2 text-sm text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> {progreso}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {!proveedor ? (
            <p className="py-16 text-center text-sm text-zinc-500">Elegí un proveedor. Arriba de la lista aparecen los que tienen más renglones sin ordenar.</p>
          ) : cargando ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
                <span className="text-zinc-600 dark:text-zinc-300">{renglones.length} renglones pendientes · <b>{sinOrdenar}</b> sin ordenar</span>
                <label className="flex items-center gap-1 text-zinc-500"><input type="checkbox" checked={verOrdenados} onChange={e => setVerOrdenados(e.target.checked)} /> Ver también los ya ordenados</label>
                <button onClick={ordenarConIA} disabled={!!progreso || !sinOrdenar} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  {progreso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Ordenar con IA
                </button>
              </div>

              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <tr>
                    <th className="px-2 py-2"><input type="checkbox" checked={visibles.length > 0 && visibles.every(r => r.aprobado)} onChange={e => setRenglones(rs => rs.map(r => visibles.some(v => v.id === r.id) && (r.elegido !== null || r.talle) ? { ...r, aprobado: e.target.checked } : r))} /></th>
                    <th className="px-2">OC</th><th className="px-2">Renglón como está en la OC</th><th className="px-2 text-right">Pend.</th><th className="px-2 text-right">Precio</th>
                    <th className="px-2">Artículo del proveedor</th><th className="px-2 w-16">Talle</th><th className="px-2">Estado</th><th className="px-2">Buscar otro</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((r, i) => (
                    <tr key={r.id} className={`border-t border-zinc-100 align-top dark:border-zinc-800 dark:text-zinc-200 ${i % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""}`}>
                      <td className="px-2 py-2"><input type="checkbox" checked={r.aprobado} disabled={r.elegido === null && !r.talle} onChange={e => upd(r.id, { aprobado: e.target.checked })} /></td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono">{r.ocNumero}</td>
                      <td className="max-w-[260px] px-2 py-2">{r.descripcion}{r.codigo && <span className="block text-[10px] text-zinc-400">cód. {r.codigo}</span>}</td>
                      <td className="px-2 py-2 text-right">{r.pendiente}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">{formatCurrency(r.precio)}</td>
                      <td className="px-2 py-1.5">
                        <select value={r.elegido ?? ""} onChange={e => upd(r.id, { elegido: e.target.value === "" ? null : Number(e.target.value), confianza: e.target.value === "" ? "ninguna" : "manual", aprobado: e.target.value !== "", yaNormalizado: false })}
                          className="w-full max-w-[380px] rounded border border-zinc-200 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-800">
                          <option value="">— Sin artículo —</option>
                          {r.candidatos.map((c, j) => <option key={`${c.id}-${j}`} value={j}>{c.codigo_interno || c.codigo} · {c.descripcion}</option>)}
                        </select>
                        {r.nota && <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">{r.nota}</p>}
                      </td>
                      <td className="px-2 py-1.5"><input value={r.talle} onChange={e => upd(r.id, { talle: e.target.value.toUpperCase(), aprobado: true })} className="w-16 rounded border border-zinc-200 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800" /></td>
                      <td className="px-2 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${COLOR[r.confianza]}`}>{ETIQUETA[r.confianza]}</span></td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <input value={r.buscar} onChange={e => upd(r.id, { buscar: e.target.value })} onKeyDown={e => { if (e.key === "Enter") void rebuscar(r.id, r.buscar); }} placeholder="palabras o código" className="w-28 rounded border border-zinc-200 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800" />
                          <button onClick={() => rebuscar(r.id, r.buscar)} className="text-zinc-500 hover:text-orange-600">{r.buscando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!visibles.length && <tr><td colSpan={9} className="py-8 text-center text-zinc-400">{renglones.length ? "Todos los renglones de este proveedor ya están ordenados." : "Este proveedor no tiene renglones pendientes en OC abiertas."}</td></tr>}
                </tbody>
              </table>

              {ocsConSaldo.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Saldos de OC</h3>
                  <p className="mb-2 text-[11px] text-zinc-500">Si el proveedor no va a entregar lo que falta, cerrá el saldo: la OC deja de esperar facturas. Se marcan las de más de {DIAS_VIEJA} días o con menos del 15 % pendiente. Se puede reabrir.</p>
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      <tr><th className="px-2 py-1.5">OC</th><th className="px-2">Fecha</th><th className="px-2 text-right">Días</th><th className="px-2 text-right">Renglones pendientes</th><th className="px-2 text-right">Monto pendiente</th><th className="px-2"></th></tr>
                    </thead>
                    <tbody>
                      {ocsConSaldo.map(o => (
                        <tr key={o.id} className={`border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200 ${o.sugerida ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                          <td className="px-2 py-1.5 font-mono">{o.numero}{o.sugerida && <span className="ml-2 rounded bg-amber-200 px-1 text-[10px] text-amber-900">sugerida</span>}</td>
                          <td className="px-2">{formatDate(o.fecha)}</td>
                          <td className="px-2 text-right">{o.dias}</td>
                          <td className="px-2 text-right">{o.saldo_cerrado ? "—" : o.renglones}</td>
                          <td className="px-2 text-right">{o.saldo_cerrado ? "Cerrado" : formatCurrency(o.monto, o.moneda === "USD" ? "USD" : "ARS")}</td>
                          <td className="px-2 text-right">
                            {o.saldo_cerrado
                              ? <button onClick={() => cerrarSaldo(o, false)} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 dark:border-zinc-700"><Unlock className="h-3 w-3" /> Reabrir</button>
                              : <button onClick={() => cerrarSaldo(o, true)} className="inline-flex items-center gap-1 rounded border border-amber-400 px-2 py-0.5 text-amber-800 dark:text-amber-300"><Lock className="h-3 w-3" /> Cerrar saldo</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-500">Lo tildado se guarda en los renglones de la OC (código y descripción del proveedor + talle). Lo pedido y los precios no cambian.</p>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={guardando} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cerrar</button>
            <button onClick={guardarAprobados} disabled={guardando || !tildados} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar {tildados} renglón(es)
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
