"use client";

/**
 * Compras nueva › OC: todas las OC en una lista con el formato de Presupuestos (Augusto 16/10).
 * Columnas: Fecha · OC · PR / Cliente · Proveedor · Descripción · Persona · Estado · Llegó · Factura · Pago · Copiar.
 * "En curso" = falta llegar, facturar o pagar algo. "Terminadas" = llegó todo + facturada + pagada.
 * Copiar: texto para el proveedor sin precios (no abre la OC). Solo lectura: no guarda nada.
 * Con `lazza` (pantalla Compras Lazza): botón "Llegó" en cada OC, marca 👁 Observar y filtro "Observar".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatDate, todayAR } from "@/lib/utils";
import { coincideTodas, normalizarTexto, palabrasBusqueda } from "@/lib/buscar-texto";
import {
  estadoOC, ejeFactura, ejePago, ocTerminada, ocAtrasada, llego, descripcionCorta, textoCopiarOC,
  ESTADO_OC_LABEL, type EstadoOC, type Eje, type FacturaOC, type ItemOC,
} from "@/lib/oc-lista";
import { Check, ClipboardCopy, Loader2, RefreshCw, Search, X } from "lucide-react";

const db = supabase as any;

type Fila = {
  id: string; numero: string; fecha: string; fecha_entrega_estimada: string | null; estado: string; pedido: boolean | null; pedido_at: string | null;
  saldo_cerrado: boolean | null; estado_facturacion: string | null; estado_pago: string | null; medio_pago: string | null; total: number | null;
  proveedor_id: string | null; created_by: string | null; observar?: boolean | null; observar_nota?: string | null;
  proveedores: { razon_social: string; nombre_fantasia: string | null } | null;
  presupuesto_origen: { id: string; numero: string; cliente_id: string | null; vendedor_id: string | null; clientes: { razon_social: string } | null } | null;
  orden_compra_items: (ItemOC & { orden: number | null })[];
};
type Vista = Fila & {
  items: ItemOC[]; facturas: FacturaOC[];
  proveedorNombre: string; clienteNombre: string; prNumero: string; personaId: string; personaNombre: string;
  estadoVista: EstadoOC; factura: Eje; pago: Eje; terminada: boolean; atrasada: boolean; recibido: number; pedidoCant: number; textoBusqueda: string;
};

const SEL = "id, numero, fecha, fecha_entrega_estimada, estado, pedido, pedido_at, saldo_cerrado, estado_facturacion, estado_pago, medio_pago, total, proveedor_id, created_by, "
  + "proveedores(razon_social, nombre_fantasia), presupuesto_origen:presupuesto_origen_id(id, numero, cliente_id, vendedor_id, clientes(razon_social)), "
  + "orden_compra_items(codigo, descripcion, cantidad, cantidad_recibida, orden)";

async function enTandas<T>(ids: string[], armar: (tanda: string[]) => any): Promise<T[]> {
  const out: T[] = [];
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 100) {
    const { data, error } = await armar(unicos.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data || []) as T[]));
  }
  return out;
}

const iniciales = (nombre: string) => nombre.split(/\s+/).filter(Boolean).map(w => w[0]!.toUpperCase()).join("").slice(0, 3);
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100).replace(".", ","));
const ESTILO_ESTADO: Record<EstadoOC, string> = {
  por_enviar: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  enviada: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  parcial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  completo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};
function IconoEje({ eje, titulo }: { eje: Eje; titulo: string }) {
  const c = eje === "ok" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
    : eje === "parcial" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" : "text-zinc-400";
  return <span title={titulo} className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${c}`}>{eje === "ok" ? "✔" : eje === "parcial" ? "½" : "—"}</span>;
}
const selectCls = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white";

export type OcLazza = { id: string; numero: string; observar_nota?: string | null };

export default function ComprasListaOC({ sociedadId, lazza }: {
  sociedadId: string | undefined;
  /** Compras Lazza: "Llegó" en cada OC y la marca "Observar" (con su nota). */
  lazza?: { onLlego: (oc: OcLazza) => void; onObservar: (oc: OcLazza) => void };
}) {
  const { toast } = useToast();
  const [filas, setFilas] = useState<Vista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [vista, setVista] = useState<"curso" | "terminadas">("curso");
  const [busca, setBusca] = useState("");
  const [persona, setPersona] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [cliente, setCliente] = useState("");
  const [estado, setEstado] = useState<"" | EstadoOC>("");
  const [soloAtrasadas, setSoloAtrasadas] = useState(false);
  const [periodo, setPeriodo] = useState<"" | "mes" | "mes_pasado" | "90">("");
  const [copiada, setCopiada] = useState<string | null>(null);
  const [soloObservar, setSoloObservar] = useState(false);
  const conLazza = !!lazza;

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setCargando(true);
    setError("");
    try {
      const traer = (sel: string) => traerTodo<Fila>(() => db.from("ordenes_compra").select(sel).eq("sociedad_id", sociedadId).neq("estado", "cancelada").order("id"));
      // "Observar" existe recién cuando se corre la migración 20261016200000: si falta, la lista anda igual sin la marca.
      const ocs = conLazza ? await traer(`${SEL}, observar, observar_nota`).catch(() => traer(SEL)) : await traer(SEL);
      const ids = ocs.map(o => o.id);
      const [links, viejas, perfiles] = await Promise.all([
        enTandas<{ orden_compra_id: string; facturas_compra: FacturaOC | FacturaOC[] | null }>(ids, t => db.from("factura_compra_ocs").select("orden_compra_id, facturas_compra(id, estado, tipo_comprobante, total)").in("orden_compra_id", t)),
        enTandas<FacturaOC & { id: string; orden_compra_id: string }>(ids, t => db.from("facturas_compra").select("id, estado, tipo_comprobante, total, orden_compra_id").eq("sociedad_id", sociedadId).in("orden_compra_id", t)),
        db.from("profiles").select("id, full_name"),
      ]);
      const fcs = new Map<string, Map<string, FacturaOC>>();
      const sumar = (ocId: string, f: any) => { if (!f?.id) return; const m = fcs.get(ocId) || new Map(); m.set(f.id, f); fcs.set(ocId, m); };
      for (const l of links) for (const f of Array.isArray(l.facturas_compra) ? l.facturas_compra : [l.facturas_compra]) sumar(l.orden_compra_id, f);
      for (const f of viejas) sumar(f.orden_compra_id, f);
      const nombres = new Map(((perfiles.data || []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name || ""]));
      const hoy = todayAR();
      setFilas(ocs.map(o => {
        const items = [...(o.orden_compra_items || [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
        const base = { ...o, items, facturas: [...(fcs.get(o.id)?.values() || [])] };
        const personaId = o.presupuesto_origen?.vendedor_id || o.created_by || "";
        const proveedorNombre = (o.proveedores?.nombre_fantasia || o.proveedores?.razon_social || "Sin proveedor").trim();
        const clienteNombre = o.presupuesto_origen?.clientes?.razon_social || "";
        const { recibido, pedido } = llego(base);
        return {
          ...base, proveedorNombre, clienteNombre, prNumero: o.presupuesto_origen?.numero || "", personaId, personaNombre: nombres.get(personaId) || "",
          estadoVista: estadoOC(base), factura: ejeFactura(base), pago: ejePago(base), terminada: ocTerminada(base), atrasada: ocAtrasada(base, hoy),
          recibido, pedidoCant: pedido,
          textoBusqueda: normalizarTexto([o.numero, o.presupuesto_origen?.numero, clienteNombre, o.proveedores?.razon_social, o.proveedores?.nombre_fantasia,
            ...items.map(i => `${i.codigo || ""} ${i.descripcion || ""}`)].filter(Boolean).join(" ")),
        };
      }).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || b.numero.localeCompare(a.numero)));
    } catch (e: any) {
      setError(e?.message || "No se pudieron traer las OC");
    } finally {
      setCargando(false);
    }
  }, [sociedadId, conLazza]);
  useEffect(() => { void cargar(); }, [cargar]);
  // Al guardar una factura (Cargar factura) se refresca la lista.
  useEffect(() => {
    const refrescar = () => { void cargar(); };
    window.addEventListener(EVENTO_FACTURAS_COMPRA, refrescar);
    return () => window.removeEventListener(EVENTO_FACTURAS_COMPRA, refrescar);
  }, [cargar]);

  const opciones = useMemo(() => {
    const uniq = (pares: [string, string][]) => [...new Map(pares.filter(([id, t]) => id && t)).entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
    return {
      personas: uniq(filas.map(f => [f.personaId, f.personaNombre])),
      proveedores: uniq(filas.map(f => [f.proveedor_id || "", f.proveedorNombre])),
      clientes: uniq(filas.map(f => [f.presupuesto_origen?.cliente_id || "", f.clienteNombre])),
    };
  }, [filas]);

  const palabras = useMemo(() => palabrasBusqueda(busca), [busca]);
  const desde = useMemo(() => {
    const hoy = todayAR();
    if (periodo === "mes") return { d: `${hoy.slice(0, 7)}-01`, h: "9999" };
    if (periodo === "mes_pasado") {
      const [y, m] = hoy.split("-").map(Number);
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      const ini = `${py}-${String(pm).padStart(2, "0")}-01`;
      return { d: ini, h: `${hoy.slice(0, 7)}-01` };
    }
    if (periodo === "90") return { d: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10), h: "9999" };
    return null;
  }, [periodo]);

  const filtradas = useMemo(() => filas.filter(f => {
    if ((vista === "terminadas") !== f.terminada) return false;
    if (palabras.length && !coincideTodas(f.textoBusqueda, palabras)) return false;
    if (persona && f.personaId !== persona) return false;
    if (proveedor && f.proveedor_id !== proveedor) return false;
    if (cliente && f.presupuesto_origen?.cliente_id !== cliente) return false;
    if (estado && f.estadoVista !== estado) return false;
    if (soloAtrasadas && !f.atrasada) return false;
    if (desde && !((f.fecha || "") >= desde.d && (f.fecha || "") < desde.h)) return false;
    if (soloObservar && !f.observar) return false;
    return true;
  }), [filas, vista, palabras, persona, proveedor, cliente, estado, soloAtrasadas, desde, soloObservar]);

  const enCurso = useMemo(() => filas.filter(f => !f.terminada).length, [filas]);
  const atrasadas = useMemo(() => filas.filter(f => !f.terminada && f.atrasada).length, [filas]);
  const observadas = useMemo(() => filas.filter(f => f.observar).length, [filas]);
  const hayFiltros = !!(busca || persona || proveedor || cliente || estado || soloAtrasadas || periodo || soloObservar);

  async function copiar(f: Vista) {
    const texto = textoCopiarOC(f, f.proveedores?.razon_social || f.proveedorNombre);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiada(f.id);
      setTimeout(() => setCopiada(c => (c === f.id ? null : c)), 2000);
      toast.success(`${f.numero} copiada: pegala en el WhatsApp o mail del proveedor`);
    } catch {
      window.prompt("Copiá el texto (Ctrl+C):", texto);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-700">
        {([["curso", "En curso", enCurso], ["terminadas", "Terminadas", filas.length - enCurso]] as const).map(([k, t, c]) => (
          <button key={k} onClick={() => setVista(k)} className={`-mb-px border-b-2 px-3 py-1 text-sm font-medium ${vista === k ? "border-orange-500 text-orange-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
            {t} <span className="ml-1 rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{c}</span>
          </button>
        ))}
        <button onClick={() => void cargar()} className="ml-auto rounded p-1 text-zinc-400 hover:text-zinc-700" title="Actualizar"><RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /></button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar OC, PR, cliente, proveedor o artículo…"
            className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-7 pr-7 text-sm focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          {busca && <button onClick={() => setBusca("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700" title="Borrar búsqueda"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <select value={persona} onChange={e => setPersona(e.target.value)} className={selectCls}>
          <option value="">Todas las personas</option>
          {opciones.personas.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <select value={proveedor} onChange={e => setProveedor(e.target.value)} className={`${selectCls} max-w-[200px]`}>
          <option value="">Todos los proveedores</option>
          {opciones.proveedores.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <select value={cliente} onChange={e => setCliente(e.target.value)} className={`${selectCls} max-w-[200px]`}>
          <option value="">Todos los clientes</option>
          {opciones.clientes.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <select value={estado} onChange={e => setEstado(e.target.value as "" | EstadoOC)} className={selectCls}>
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_OC_LABEL) as EstadoOC[]).map(k => <option key={k} value={k}>{ESTADO_OC_LABEL[k]}</option>)}
        </select>
        <select value={periodo} onChange={e => setPeriodo(e.target.value as typeof periodo)} className={selectCls}>
          <option value="">Cualquier fecha</option>
          <option value="mes">Este mes</option>
          <option value="mes_pasado">Mes pasado</option>
          <option value="90">Últimos 90 días</option>
        </select>
        <button onClick={() => setSoloAtrasadas(v => !v)} className={`h-8 rounded-lg border px-2 text-sm ${soloAtrasadas ? "border-red-400 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
          Atrasadas <span className="text-xs opacity-70">{atrasadas}</span>
        </button>
        {conLazza && (
          <button onClick={() => setSoloObservar(v => !v)} className={`h-8 rounded-lg border px-2 text-sm ${soloObservar ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
            Observar <span className="text-xs opacity-70">{observadas}</span>
          </button>
        )}
        {hayFiltros && <button onClick={() => { setBusca(""); setPersona(""); setProveedor(""); setCliente(""); setEstado(""); setSoloAtrasadas(false); setPeriodo(""); setSoloObservar(false); }} className="text-xs text-zinc-500 underline">Limpiar filtros</button>}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      {cargando && !filas.length && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo las OC…</p>}

      <Card className="overflow-hidden p-0">
        <DataTable<Vista>
          data={filtradas}
          loading={cargando && !filas.length}
          emptyMessage={vista === "terminadas" ? "No hay OC terminadas con estos filtros." : "No hay OC en curso con estos filtros."}
          columns={[
            { key: "fecha", label: "Fecha", render: f => <span className={`whitespace-nowrap text-xs ${f.atrasada ? "font-semibold text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-300"}`} title={f.atrasada ? `Atrasada${f.fecha_entrega_estimada ? `: entrega estimada ${formatDate(f.fecha_entrega_estimada)}` : ""}` : undefined}>{formatDate(f.fecha)}</span> },
            { key: "numero", label: "OC", render: f => <span className="whitespace-nowrap font-mono text-xs font-bold">{f.numero}</span> },
            { key: "prNumero", label: "PR / Cliente", sortValue: f => `${f.prNumero} ${f.clienteNombre}`, render: f => f.prNumero || f.clienteNombre
              ? <span className="block max-w-[200px] truncate text-xs" title={`${f.prNumero} · ${f.clienteNombre}`}><span className="font-mono text-zinc-500">{f.prNumero}</span>{f.clienteNombre ? ` · ${f.clienteNombre}` : ""}</span>
              : <span className="text-xs text-zinc-400">—</span> },
            { key: "proveedorNombre", label: "Proveedor", render: f => <span className={`block max-w-[170px] truncate text-xs font-medium ${f.proveedor_id ? "" : "text-amber-600"}`} title={f.proveedores?.razon_social || ""}>{f.proveedorNombre}</span> },
            { key: "descripcion", label: "Descripción", sortable: false, render: f => { const d = descripcionCorta(f.items); return <span className="block max-w-[280px] truncate text-xs text-zinc-600 dark:text-zinc-400" title={d}>{d || "—"}</span>; } },
            { key: "personaNombre", label: "Persona", render: f => f.personaNombre
              ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" title={f.personaNombre}>{iniciales(f.personaNombre)}</span>
              : <span className="text-xs text-zinc-400">—</span> },
            { key: "estadoVista", label: "Estado", sortValue: f => ["por_enviar", "enviada", "parcial", "completo"].indexOf(f.estadoVista), render: f => (
              <span className="inline-flex items-center gap-1">
                <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ESTILO_ESTADO[f.estadoVista]}`}>{ESTADO_OC_LABEL[f.estadoVista]}</span>
                {lazza && f.observar && (
                  <button onClick={e => { e.stopPropagation(); lazza.onObservar(f); }} title={f.observar_nota || "Observar"}
                    className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300">👁 Observar</button>
                )}
              </span>
            ) },
            { key: "recibido", label: "Llegó", className: "text-right", sortValue: f => (f.pedidoCant ? f.recibido / f.pedidoCant : 0), render: f => lazza
              ? <button onClick={e => { e.stopPropagation(); lazza.onLlego(f); }} title="Marcar lo que llegó (Completo o Parcial)"
                  className="whitespace-nowrap rounded-md border border-zinc-200 px-1.5 py-0.5 font-mono text-xs hover:border-orange-400 hover:bg-orange-50 dark:border-zinc-700 dark:hover:bg-orange-950/30">{fmt(f.recibido)} / {fmt(f.pedidoCant)} <span className="font-sans text-orange-600">Llegó</span></button>
              : <span className="whitespace-nowrap font-mono text-xs">{fmt(f.recibido)} / {fmt(f.pedidoCant)}</span> },
            { key: "factura", label: "Factura", className: "text-center", render: f => <IconoEje eje={f.factura} titulo={f.factura === "ok" ? "Facturada" : f.factura === "parcial" ? "Facturada en parte" : "Falta la factura"} /> },
            { key: "pago", label: "Pago", className: "text-center", render: f => <IconoEje eje={f.pago} titulo={f.pago === "ok" ? (f.medio_pago === "tarjeta" ? "Pagada con tarjeta" : "Pagada") : f.pago === "parcial" ? "Pagada en parte" : "Falta pagar"} /> },
            { key: "copiar", label: "", sortable: false, render: f => (
              <button onClick={e => { e.stopPropagation(); void copiar(f); }} title="Copiar los artículos y cantidades (sin precios) con el mensaje para el proveedor"
                className="rounded p-1 text-zinc-400 hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-950/30">
                {copiada === f.id ? <Check className="h-4 w-4 text-emerald-600" /> : <ClipboardCopy className="h-4 w-4" />}
              </button>
            ) },
          ]}
        />
      </Card>
    </div>
  );
}
