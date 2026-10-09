"use client";

/**
 * Lista de costos dentro del presupuesto: buscar, tildar varios artículos y agregarlos de una vez.
 * Fuente: tabla catalogo_costos (se carga con scripts/importar-catalogo.cjs desde catalogo_crm.csv).
 * El precio de venta se toma TAL CUAL de la lista (es el de la web); el margen se calcula solo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Loader2, Check, Plus, Minus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

const db = supabase as any;

export interface CatalogoRow {
  id: string;
  proveedor: string;
  codigo: string;
  codigo_interno: string | null;
  descripcion: string;
  moneda: "ARS" | "USD" | "USD divisa";
  costo: number;
  precio_venta: number;
  marca?: string | null;
}

export interface CatalogoItemParaPR {
  codigo: string;
  descripcion: string;
  categoria: string;
  cantidad: number;
  unidad: string;
  precio_costo: number;
  markup_porcentaje: number;
  precio_venta: number;
  iva_porcentaje: number;
  proveedor_nombre: string;
  proveedor_id: string;
  stock_propio: boolean;
  lista_item_id: string;
  costo_moneda: "ARS" | "USD" | "USD Divisa";
}

interface Props {
  open: boolean;
  onClose: () => void;
  prMoneda: string;          // moneda del presupuesto (ARS / USD)
  tc: number;                // TC billetes del PR
  tcDivisas: number;         // TC divisas del PR
  onAgregar: (items: CatalogoItemParaPR[]) => void;
  /** Si falta el tipo de cambio, el presupuesto trae la cotización BNA del día (no traba al vendedor). */
  onPedirTc?: () => void;
  /** Proveedores del CRM de la sociedad activa (los mismos del selector de la fila). */
  proveedoresCRM?: Array<{ id: string; razon_social: string }>;
  sociedadId?: string;
}

interface Seleccion { row: CatalogoRow; cantidad: string; talles: string }

const fmt = (n: number, m: string) =>
  `${m === "ARS" ? "$" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Convierte un importe de la moneda de la lista a la del presupuesto (misma lógica que los costos del PR). */
export function convertirAMonedaPR(importe: number, monedaLista: string, prMoneda: string, tc: number, tcDivisas: number): number | null {
  const esUSD = monedaLista.toUpperCase().startsWith("USD");
  if (esUSD === (prMoneda === "USD")) return importe;
  // Lista en USD divisa → TC divisas primero; USD billete → TC billetes primero.
  const divisa = monedaLista.toLowerCase().includes("divisa");
  const t = divisa ? (tcDivisas > 0 ? tcDivisas : tc) : (tc > 0 ? tc : tcDivisas);
  if (!(t > 0)) return null;
  return esUSD ? importe * t : importe / t;
}

/** "40x3, 42 x5; 44*2" → [{talle:"40",cant:3},...] */
export function parseTalles(texto: string): Array<{ talle: string; cantidad: number }> {
  return String(texto || "")
    .split(/[,;\n]+/)
    .map(p => p.trim().match(/^(.+?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)$/i))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ talle: m[1].replace(/^talle\s*/i, "").trim().toUpperCase(), cantidad: Number(m[2].replace(",", ".")) }))
    .filter(t => t.talle && t.cantidad > 0);
}

// Un color fijo por proveedor (borde de la fila y punto del filtro) para distinguirlos de un vistazo.
const PALETA = [
  { borde: "border-l-orange-400", punto: "bg-orange-400", texto: "text-orange-700 dark:text-orange-300" },
  { borde: "border-l-sky-500", punto: "bg-sky-500", texto: "text-sky-700 dark:text-sky-300" },
  { borde: "border-l-emerald-500", punto: "bg-emerald-500", texto: "text-emerald-700 dark:text-emerald-300" },
  { borde: "border-l-violet-500", punto: "bg-violet-500", texto: "text-violet-700 dark:text-violet-300" },
  { borde: "border-l-rose-500", punto: "bg-rose-500", texto: "text-rose-700 dark:text-rose-300" },
  { borde: "border-l-amber-500", punto: "bg-amber-500", texto: "text-amber-700 dark:text-amber-300" },
  { borde: "border-l-teal-500", punto: "bg-teal-500", texto: "text-teal-700 dark:text-teal-300" },
  { borde: "border-l-fuchsia-500", punto: "bg-fuchsia-500", texto: "text-fuchsia-700 dark:text-fuchsia-300" },
  { borde: "border-l-lime-600", punto: "bg-lime-600", texto: "text-lime-700 dark:text-lime-300" },
  { borde: "border-l-indigo-500", punto: "bg-indigo-500", texto: "text-indigo-700 dark:text-indigo-300" },
];
function colorProveedor(nombre: string) {
  let h = 0;
  for (const ch of nombre) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
}

/** Normaliza nombres para comparar: sin acentos, sin puntuación y sin "S.A.", "SRL", etc. */
export function normalizarProveedor(nombre: string): string {
  return String(nombre || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(s ?a ?i ?c|s ?a ?c ?i|s ?r ?l|s ?a ?s|s ?a|s ?h|sociedad anonima|cia|y|de|la|el|argentina)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Busca el proveedor del CRM que corresponde al nombre de la lista. Devuelve "" si no hay uno claro. */
export function buscarProveedorCRM(nombreLista: string, opciones: Array<{ id: string; razon_social: string }>): string {
  const n = normalizarProveedor(nombreLista);
  if (!n) return "";
  const sinEspacios = (x: string) => x.replace(/ /g, "");
  const conNorm = opciones.map(o => ({ id: o.id, n: normalizarProveedor(o.razon_social) }));
  const exactos = conNorm.filter(o => o.n === n || sinEspacios(o.n) === sinEspacios(n));
  if (exactos.length) return exactos[0].id;
  const parecidos = conNorm.filter(o => o.n && (o.n.startsWith(n + " ") || n.startsWith(o.n + " ") || sinEspacios(o.n).includes(sinEspacios(n)) || ` ${o.n} `.includes(` ${n} `)));
  return parecidos.length === 1 ? parecidos[0].id : "";
}

export default function CatalogoPicker({ open, onClose, prMoneda, tc, tcDivisas, onAgregar, onPedirTc, proveedoresCRM, sociedadId }: Props) {
  const [q, setQ] = useState("");
  const [provSel, setProvSel] = useState<Set<string>>(new Set());
  const [marcaSel, setMarcaSel] = useState<Set<string>>(new Set());
  const [proveedores, setProveedores] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [rubros, setRubros] = useState<string[]>([]);
  const [rubroSel, setRubroSel] = useState<Set<string>>(new Set());
  const [verFiltros, setVerFiltros] = useState<"" | "prov" | "marca" | "rubro">("");
  const [rows, setRows] = useState<CatalogoRow[]>([]);
  const [orden, setOrden] = useState<{ col: "codigo" | "descripcion" | "proveedor" | "costo" | "venta"; dir: 1 | -1 } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Map<string, Seleccion>>(new Map());
  const [provIds, setProvIds] = useState<Array<{ id: string; razon_social: string; marcas?: string | null; nombre_fantasia?: string | null }>>([]);
  // Vínculos guardados: nombre de la lista (fantasía) → proveedor del CRM (razón social)
  const [vinculos, setVinculos] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Proveedores del catálogo (para el filtro) y proveedores del CRM (para vincular el id)
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);
    if (proveedores.length) return;
    (async () => {
      const set = new Set<string>(), setM = new Set<string>(), setR = new Set<string>();
      for (let desde = 0; desde < 60000; desde += 1000) {
        let { data, error: e } = await db.from("catalogo_costos").select("proveedor, marca, rubro").eq("activo", true).range(desde, desde + 999);
        if (e) ({ data } = await db.from("catalogo_costos").select("proveedor").eq("activo", true).range(desde, desde + 999));
        (data || []).forEach((r: any) => { set.add(r.proveedor); if (r.marca) setM.add(r.marca); if (r.rubro) setR.add(r.rubro); });
        if (!data || data.length < 1000) break;
      }
      setRubros([...setR].sort((a, b) => a.localeCompare(b, "es")));
      setProveedores([...set].sort((a, b) => a.localeCompare(b, "es")));
      setMarcas([...setM].sort((a, b) => a.localeCompare(b, "es")));
      const traer = (cols: string) => { let qp = db.from("proveedores").select(cols).eq("activo", true).order("razon_social"); if (sociedadId) qp = qp.eq("sociedad_id", sociedadId); return qp; };
      let { data: ps, error: ep } = await traer("id, razon_social, marcas, nombre_fantasia");
      if (ep) ({ data: ps } = await traer("id, razon_social, marcas"));
      setProvIds(ps || []);
      if (sociedadId) {
        const { data: vs } = await db.from("catalogo_proveedores").select("proveedor_lista, proveedor_id").eq("sociedad_id", sociedadId);
        setVinculos(Object.fromEntries((vs || []).map((v: any) => [v.proveedor_lista, v.proveedor_id])));
      }
    })();
  }, [open, proveedores.length]);

  // Búsqueda: todas las palabras tienen que aparecer (en código, descripción o proveedor)
  useEffect(() => {
    if (!open) return;
    const palabras = q.trim().split(/\s+/).map(w => w.replace(/[,()%*\\]/g, "")).filter(w => w.length >= 2);
    if (!palabras.length && !provSel.size && !marcaSel.size && !rubroSel.size) { setRows([]); return; }
    let cancelado = false;
    const t = setTimeout(async () => {
      setCargando(true); setError("");
      let query = db.from("catalogo_costos").select(marcas.length || rubros.length ? "id, proveedor, codigo, codigo_interno, descripcion, moneda, costo, precio_venta, marca, rubro" : "id, proveedor, codigo, codigo_interno, descripcion, moneda, costo, precio_venta").eq("activo", true);
      if (provSel.size) query = query.in("proveedor", [...provSel]);
      if (marcaSel.size) query = query.in("marca", [...marcaSel]);
      if (rubroSel.size) query = query.in("rubro", [...rubroSel]);
      for (const w of palabras) query = query.or(`descripcion.ilike.%${w}%,codigo.ilike.%${w}%,codigo_interno.ilike.%${w}%,proveedor.ilike.%${w}%`);
      const { data, error: e } = await query.order("proveedor").order("descripcion").limit(300);
      if (cancelado) return;
      setCargando(false);
      if (e) { setError(e.message.includes("catalogo_costos") ? "La lista de costos todavía no está cargada." : e.message); return; }
      setRows((data || []).map((r: any) => ({ ...r, costo: Number(r.costo), precio_venta: Number(r.precio_venta) })));
    }, 250);
    return () => { cancelado = true; clearTimeout(t); };
  }, [q, provSel, marcaSel, rubroSel, open, marcas.length, rubros.length]);

  // Orden: 1) vínculo guardado, 2) nombre parecido a la razón social, 3) el nombre figura en "marcas" del proveedor.
  const proveedorId = (nombre: string): string => {
    if (vinculos[nombre]) return vinculos[nombre];
    const nf = normalizarProveedor(nombre);
    const porFantasia = provIds.filter(p => p.nombre_fantasia && normalizarProveedor(p.nombre_fantasia) === nf);
    if (nf && porFantasia.length >= 1) return porFantasia[0].id;
    const lista = provIds.length ? provIds : (proveedoresCRM || []);
    const porNombre = buscarProveedorCRM(nombre, lista);
    if (porNombre) return porNombre;
    const n = normalizarProveedor(nombre);
    const porMarca = provIds.filter(p => p.marcas && normalizarProveedor(p.marcas).split(" ").join(" ").includes(n));
    return n && porMarca.length === 1 ? porMarca[0].id : "";
  };
  async function vincular(nombreLista: string, proveedorIdCRM: string) {
    if (!proveedorIdCRM) return;
    setVinculos(v => ({ ...v, [nombreLista]: proveedorIdCRM }));
    if (sociedadId) await db.from("catalogo_proveedores").upsert({ sociedad_id: sociedadId, proveedor_lista: nombreLista, proveedor_id: proveedorIdCRM }, { onConflict: "sociedad_id,proveedor_lista" });
    // Si el proveedor no tenía nombre de fantasía, se completa con el de la lista.
    await db.from("proveedores").update({ nombre_fantasia: nombreLista }).eq("id", proveedorIdCRM).is("nombre_fantasia", null);
    setProvIds(ps => ps.map(p => (p.id === proveedorIdCRM && !p.nombre_fantasia ? { ...p, nombre_fantasia: nombreLista } : p)));
  }

  function toggle(r: CatalogoRow) {
    setSel(prev => {
      const n = new Map(prev);
      if (n.has(r.id)) n.delete(r.id); else n.set(r.id, { row: r, cantidad: "1", talles: "" });
      return n;
    });
  }
  function cambiar(id: string, campo: "cantidad" | "talles", valor: string) {
    setSel(prev => { const n = new Map(prev); const s = n.get(id); if (s) n.set(id, { ...s, [campo]: valor }); return n; });
  }

  // Orden por columna (clic en el encabezado: ▲ ascendente, ▼ descendente, otro clic vuelve al orden normal).
  // Costo y venta se comparan convertidos a la moneda del presupuesto, para que USD y ARS se ordenen juntos.
  const rowsOrdenadas = useMemo(() => {
    if (!orden) return rows;
    const valor = (r: CatalogoRow): string | number => {
      if (orden.col === "codigo") return r.codigo_interno || r.codigo;
      if (orden.col === "descripcion") return r.descripcion;
      if (orden.col === "proveedor") return `${r.proveedor} ${r.descripcion}`;
      const imp = orden.col === "costo" ? r.costo : r.precio_venta;
      return convertirAMonedaPR(imp, r.moneda, prMoneda, tc, tcDivisas) ?? imp;
    };
    return [...rows].sort((a, b) => {
      const va = valor(a), vb = valor(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
      return c * orden.dir;
    });
  }, [rows, orden, prMoneda, tc, tcDivisas]);

  const sinTc = useMemo(() => [...sel.values()].some(s => convertirAMonedaPR(1, s.row.moneda, prMoneda, tc, tcDivisas) === null), [sel, prMoneda, tc, tcDivisas]);

  // Falta TC → se pide la cotización BNA una sola vez y se habilita solo al llegar.
  const tcPedido = useRef(false);
  useEffect(() => { if (!open) tcPedido.current = false; }, [open]);
  useEffect(() => {
    if (sinTc && onPedirTc && !tcPedido.current) { tcPedido.current = true; onPedirTc(); }
  }, [sinTc, onPedirTc]);

  function agregar() {
    const out: CatalogoItemParaPR[] = [];
    for (const { row, cantidad, talles } of sel.values()) {
      const costoPR = convertirAMonedaPR(row.costo, row.moneda, prMoneda, tc, tcDivisas);
      const ventaPR = convertirAMonedaPR(row.precio_venta, row.moneda, prMoneda, tc, tcDivisas);
      if (costoPR === null || ventaPR === null) continue;
      const markup = costoPR > 0 ? Math.round(((ventaPR / costoPR) - 1) * 10000) / 100 : 0;
      const base: CatalogoItemParaPR = {
        codigo: row.codigo_interno || row.codigo,
        descripcion: row.descripcion,
        categoria: "",
        cantidad: 1,
        unidad: "UN",
        precio_costo: row.costo,
        markup_porcentaje: markup,
        precio_venta: Math.round(ventaPR * 100) / 100,
        iva_porcentaje: 21,
        proveedor_nombre: row.proveedor,
        proveedor_id: proveedorId(row.proveedor),
        stock_propio: false,
        lista_item_id: "",
        costo_moneda: row.moneda === "ARS" ? "ARS" : row.moneda === "USD divisa" ? "USD Divisa" : "USD",
      };
      const porTalle = parseTalles(talles);
      if (porTalle.length) for (const t of porTalle) out.push({ ...base, descripcion: `${row.descripcion} - Talle ${t.talle}`, cantidad: t.cantidad });
      else out.push({ ...base, cantidad: Math.max(0, Number(String(cantidad).replace(",", "."))) || 1 });
    }
    onAgregar(out);
    setSel(new Map());
    onClose();
  }

  if (!open || typeof document === "undefined") return null;
  const seleccionados = [...sel.values()];

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-3" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-slate-100 dark:bg-zinc-900 w-full max-w-6xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-700 px-4 py-3">
          <Search className="h-5 w-5 text-zinc-400" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en la lista: «pantalon cargo beige», «P24», «guante nitrilo»…"
            className="flex-1 bg-transparent text-base outline-none" />
          <button onClick={() => setVerFiltros(v => v === "prov" ? "" : "prov")}
            className={`rounded-lg border px-3 py-1.5 text-sm ${provSel.size ? "border-orange-500 text-orange-600" : "border-zinc-300 dark:border-zinc-600"}`}>
            Proveedores{provSel.size ? ` (${provSel.size})` : ""} ▾
          </button>
          <button onClick={() => setVerFiltros(v => v === "marca" ? "" : "marca")} disabled={!marcas.length}
            title={marcas.length ? "" : "La lista todavía no trae la columna marca"}
            className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 ${marcaSel.size ? "border-orange-500 text-orange-600" : "border-zinc-300 dark:border-zinc-600"}`}>
            Marcas{marcaSel.size ? ` (${marcaSel.size})` : ""} ▾
          </button>
          <button onClick={() => setVerFiltros(v => v === "rubro" ? "" : "rubro")} disabled={!rubros.length}
            className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 ${rubroSel.size ? "border-orange-500 text-orange-600" : "border-zinc-300 dark:border-zinc-600"}`}>
            Rubros{rubroSel.size ? ` (${rubroSel.size})` : ""} ▾
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        {verFiltros && (
          <div className="border-b border-zinc-200 dark:border-zinc-700 px-4 py-2 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {(verFiltros === "prov" ? proveedores : verFiltros === "marca" ? marcas : rubros).map(x => {
              const set = verFiltros === "prov" ? provSel : verFiltros === "marca" ? marcaSel : rubroSel;
              const setSet = verFiltros === "prov" ? setProvSel : verFiltros === "marca" ? setMarcaSel : setRubroSel;
              const on = set.has(x);
              return (
                <button key={x} onClick={() => setSet(prev => { const n = new Set(prev); if (n.has(x)) n.delete(x); else n.add(x); return n; })}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${on ? "bg-orange-500 border-orange-500 text-white" : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                  {verFiltros === "prov" && <span className={`h-2 w-2 rounded-full ${colorProveedor(x).punto}`} />}{x}
                </button>
              );
            })}
            {(verFiltros === "prov" ? provSel : verFiltros === "marca" ? marcaSel : rubroSel).size > 0 && (
              <button onClick={() => (verFiltros === "prov" ? setProvSel : verFiltros === "marca" ? setMarcaSel : setRubroSel)(new Set())} className="text-xs underline text-zinc-500 ml-1">Quitar filtro</button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {error && <p className="p-4 text-sm text-red-600">{error}</p>}
          {!error && !rows.length && !cargando && (
            <p className="p-8 text-center text-sm text-zinc-500">{q.trim().length < 2 && !provSel.size && !marcaSel.size && !rubroSel.size ? "Escribí al menos 2 letras o elegí un proveedor." : "No se encontró nada con esa búsqueda."}</p>
          )}
          {cargando && <p className="p-4 flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando…</p>}
          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-300 dark:bg-zinc-700 text-xs font-semibold text-slate-700 dark:text-zinc-200">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  {([["codigo", "Código", "text-left"], ["descripcion", "Descripción", "text-left"], ["proveedor", "Proveedor", "text-left"], ["costo", "Costo", "text-right"], ["venta", "Venta", "text-right"]] as const).map(([col, label, align]) => (
                    <th key={col} className={`px-2 py-2 ${align} cursor-pointer select-none hover:text-orange-600 whitespace-nowrap`} title="Ordenar"
                      onClick={() => setOrden(o => !o || o.col !== col ? { col, dir: 1 } : o.dir === 1 ? { col, dir: -1 } : null)}>
                      {label} {orden?.col === col ? (orden.dir === 1 ? "▲" : "▼") : <span className="opacity-30">↕</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-zinc-800">
                {rowsOrdenadas.map((r, i) => {
                  const marcado = sel.has(r.id);
                  const c = colorProveedor(r.proveedor);
                  return (
                    <tr key={r.id} onClick={() => toggle(r)} className={`cursor-pointer border-l-4 ${c.borde} ${marcado ? "bg-orange-200 dark:bg-orange-900/50" : i % 2 ? "bg-slate-200/80 dark:bg-zinc-800 hover:bg-orange-100 dark:hover:bg-orange-950/40" : "bg-white dark:bg-zinc-900 hover:bg-orange-100 dark:hover:bg-orange-950/40"}`}>
                      <td className="px-2 py-1.5">
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${marcado ? "bg-orange-500 border-orange-500 text-white" : "border-zinc-400"}`}>{marcado && <Check className="h-3 w-3" />}</span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">{r.codigo_interno || r.codigo}</td>
                      <td className="px-2 py-1.5">{r.descripcion}</td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap"><span className={`font-medium ${c.texto}`}>{r.proveedor}</span>{r.marca ? <span className="block text-zinc-500">{r.marca}</span> : null}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap text-zinc-500">{fmt(r.costo, r.moneda)}{r.moneda === "USD divisa" ? " div." : ""}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap font-semibold">{fmt(r.precio_venta, r.moneda)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {rows.length === 300 && <p className="p-2 text-center text-xs text-zinc-500">Se muestran los primeros 300: agregá otra palabra para afinar.</p>}
        </div>

        {seleccionados.length > 0 && (
          <div className="border-t border-zinc-200 dark:border-zinc-700 p-3 space-y-2 max-h-[40%] overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Seleccionados ({seleccionados.length}) — cantidad, o talles como «40x3, 42x5» (crea una línea por talle)</p>
            {seleccionados.map(({ row, cantidad, talles }) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 text-sm">
                <button onClick={() => toggle(row)} className="text-zinc-400 hover:text-red-600"><X className="h-4 w-4" /></button>
                <span className="font-mono text-xs w-28 truncate">{row.codigo_interno || row.codigo}</span>
                <span className="flex-1 min-w-[200px] truncate">{row.descripcion}
                  {!proveedorId(row.proveedor) && (
                    <span className="flex flex-wrap items-center gap-1 text-[11px] text-amber-700">
                      ⚠ No sé qué proveedor del CRM es «{row.proveedor}». Vincularlo con:
                      <select defaultValue="" onChange={e => vincular(row.proveedor, e.target.value)}
                        className="rounded border border-amber-400 bg-white dark:bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-800 dark:text-zinc-200 max-w-[240px]">
                        <option value="">elegir…</option>
                        {provIds.map(p => <option key={p.id} value={p.id}>{p.razon_social}{p.nombre_fantasia ? ` (${p.nombre_fantasia})` : ""}</option>)}
                      </select>
                      <span className="text-zinc-500">(queda guardado para siempre)</span>
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => cambiar(row.id, "cantidad", String(Math.max(1, (Number(cantidad) || 1) - 1)))} className="p-1 rounded border border-zinc-300 dark:border-zinc-600"><Minus className="h-3 w-3" /></button>
                  <input value={cantidad} onChange={e => cambiar(row.id, "cantidad", e.target.value)} inputMode="decimal" disabled={!!talles.trim()}
                    className="w-14 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-right disabled:opacity-40" />
                  <button onClick={() => cambiar(row.id, "cantidad", String((Number(cantidad) || 0) + 1))} className="p-1 rounded border border-zinc-300 dark:border-zinc-600"><Plus className="h-3 w-3" /></button>
                </div>
                <input value={talles} onChange={e => cambiar(row.id, "talles", e.target.value)} placeholder="Talles: 40x3, 42x5"
                  className="w-44 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-0.5" />
              </div>
            ))}
            {sinTc && (
              <p className="flex items-center gap-2 text-xs text-amber-700">
                {onPedirTc ? <><Loader2 className="h-3 w-3 animate-spin" /> Trayendo la cotización BNA del día para convertir pesos y dólares…</> : "Hay artículos en otra moneda y el presupuesto no tiene tipo de cambio: cargá el TC antes de agregarlos."}
                {onPedirTc && <button onClick={() => onPedirTc()} className="underline">Reintentar</button>}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setSel(new Map())} className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm">Limpiar</button>
              <button onClick={agregar} disabled={sinTc} className="px-4 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-40">
                Agregar {seleccionados.length} artículo(s) al presupuesto
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
