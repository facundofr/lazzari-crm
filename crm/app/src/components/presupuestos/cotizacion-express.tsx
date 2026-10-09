"use client";

/**
 * Cotización express: el vendedor tira un Excel, un PDF, una foto o pega el mensaje del cliente,
 * y se arma la lista de artículos buscando cada uno en la lista de costos (catalogo_costos).
 * La IA solo sugiere: todo se revisa en la tabla antes de agregarlo al presupuesto.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Sparkles, Search, FileUp, Check, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { convertirAMonedaPR, normalizarProveedor, buscarProveedorCRM, type CatalogoItemParaPR } from "@/components/presupuestos/catalogo-picker";

const db = supabase as any;

type Cand = { id: string; proveedor: string; codigo: string; codigo_interno: string | null; descripcion: string; moneda: string; costo: number; precio_venta: number; marca?: string | null };
type Confianza = "alta" | "media" | "baja" | "ninguna" | "manual";
type Linea = { id: string; descripcion: string; cantidad: number; talle: string; codigo: string; candidatos: Cand[]; elegido: number | null; confianza: Confianza; nota: string; incluir: boolean; buscar: string; buscando?: boolean };

interface Props {
  open: boolean;
  onClose: () => void;
  prMoneda: string;
  tc: number;
  tcDivisas: number;
  onAgregar: (items: CatalogoItemParaPR[]) => void;
  onPedirTc?: () => void;
  proveedoresCRM?: Array<{ id: string; razon_social: string }>;
  sociedadId?: string;
}

const STOP = new Set(["con", "para", "de", "del", "la", "el", "los", "las", "p", "y", "en", "x", "un", "una", "por", "tipo", "modelo", "mod", "color", "c", "s", "talle", "t"]);
const ABREV: Record<string, string> = { ant: "anteojo", g: "guante", gte: "guante", gtes: "guante", guantes: "guante", anteojos: "anteojo", barbijos: "barbijo", cascos: "casco", botines: "botin", endourales: "endoaural", endoaurales: "endoaural", endourale: "endoaural" };

function normalizar(t: string) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/([a-z]{4,})(\d)/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(t: string) {
  return normalizar(t).split(" ").map(w => ABREV[w] || w).filter(w => w.length >= 2 && !STOP.has(w));
}
const esCodigo = (w: string) => /\d/.test(w) && /[a-z]/.test(w) || /^\d{3,}$/.test(w);

function puntaje(c: Cand, toks: string[]) {
  const texto = ` ${normalizar(`${c.descripcion} ${c.codigo} ${c.codigo_interno || ""} ${c.marca || ""} ${c.proveedor}`)} `;
  let p = 0;
  for (const w of toks) {
    const raiz = w.length > 5 ? w.slice(0, w.length - 1) : w;
    if (texto.includes(` ${w} `)) p += esCodigo(w) ? 5 : 2;
    else if (texto.includes(raiz)) p += esCodigo(w) ? 3 : 1;
  }
  return p;
}

const COLS = "id, proveedor, codigo, codigo_interno, descripcion, moneda, costo, precio_venta, marca";

async function buscarCandidatos(texto: string, codigo = ""): Promise<Cand[]> {
  const toks = [...new Set(tokens(`${codigo} ${texto}`))];
  if (!toks.length) return [];
  const limpio = (w: string) => w.replace(/[,()%*\\]/g, "");
  const consultas: any[] = [];
  const codigos = toks.filter(esCodigo);
  const palabras = toks.filter(w => !esCodigo(w)).sort((a, b) => b.length - a.length);
  const y = (ws: string[], lim: number) => {
    let q = db.from("catalogo_costos").select(COLS).eq("activo", true);
    for (const w of ws) q = q.or(`descripcion.ilike.%${limpio(w)}%,codigo.ilike.%${limpio(w)}%,codigo_interno.ilike.%${limpio(w)}%,marca.ilike.%${limpio(w)}%`);
    return q.limit(lim);
  };
  if (codigo.trim()) consultas.push(db.from("catalogo_costos").select(COLS).eq("activo", true).or(`codigo.ilike.%${limpio(codigo.trim())}%,codigo_interno.ilike.%${limpio(codigo.trim())}%`).limit(20));
  if (codigos.length) consultas.push(y(codigos, 60));
  if (codigos.length && palabras.length) consultas.push(y([codigos[0], palabras[0]], 60));
  if (palabras.length >= 2) consultas.push(y(palabras.slice(0, 3), 80));
  if (palabras.length >= 2) consultas.push(y(palabras.slice(0, 2), 120));
  if (palabras.length) consultas.push(y([palabras[0]], 150));
  const res = await Promise.all(consultas.map(q => q.then((r: any) => r.data || [], () => [])));
  const porId = new Map<string, Cand>();
  for (const lista of res) for (const r of lista) porId.set(r.id, { ...r, costo: Number(r.costo), precio_venta: Number(r.precio_venta) });
  return [...porId.values()].map(c => ({ c, p: puntaje(c, toks) })).filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || a.c.costo - b.c.costo).slice(0, 10).map(x => x.c);
}

function separarTalle(desc: string): { descripcion: string; talle: string } {
  const m = String(desc).match(/^(.*?)[\s\-–,]*\btalle\s*:?\s*([A-Za-z0-9/]+)\s*$/i);
  return m ? { descripcion: m[1].trim(), talle: m[2].toUpperCase() } : { descripcion: String(desc).trim(), talle: "" };
}

async function leerExcel(file: File): Promise<{ lineas: Array<{ descripcion: string; cantidad: number; talle: string; codigo: string }>; texto: string }> {
  const XLSX: any = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const lineas: Array<{ descripcion: string; cantidad: number; talle: string; codigo: string }> = [];
  let texto = "";
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre];
    const filas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    let h = -1, cDesc = -1, cCant = -1, cCod = -1, cTalle = -1;
    for (let i = 0; i < Math.min(filas.length, 20) && h < 0; i++) {
      const f = filas[i].map((x: any) => normalizar(String(x)));
      const d = f.findIndex(x => /^(descrip|articulo|producto|detalle|item|material)/.test(x));
      if (d >= 0) {
        h = i; cDesc = d;
        cCant = f.findIndex(x => /^(cant|qty|unid)/.test(x));
        cCod = f.findIndex(x => /^(cod|sku|ref)/.test(x));
        cTalle = f.findIndex(x => /^talle/.test(x));
      }
    }
    if (h < 0) { texto += `\n${XLSX.utils.sheet_to_csv(ws)}`; continue; }
    for (const f of filas.slice(h + 1)) {
      const raw = String(f[cDesc] ?? "").trim();
      if (!raw || /^total/i.test(raw)) continue;
      const st = separarTalle(raw);
      const cant = cCant >= 0 ? Number(String(f[cCant]).replace(",", ".")) : 1;
      lineas.push({ descripcion: st.descripcion, talle: cTalle >= 0 && String(f[cTalle]).trim() ? String(f[cTalle]).trim().toUpperCase() : st.talle, codigo: cCod >= 0 ? String(f[cCod] ?? "").trim() : "", cantidad: cant > 0 ? cant : 1 });
    }
  }
  return { lineas, texto: texto.trim() };
}

const leerBase64 = (file: File) => new Promise<string>((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => mal(new Error("No se pudo leer el archivo"));
  r.readAsDataURL(file);
});

const fmt = (n: number, m: string) => `${m === "ARS" ? "$" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COLOR: Record<Confianza, string> = {
  alta: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  media: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  baja: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  ninguna: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  manual: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};
const ETIQUETA: Record<Confianza, string> = { alta: "Seguro", media: "Revisar", baja: "Alternativa", ninguna: "No está", manual: "Elegido" };

export default function CotizacionExpress({ open, onClose, prMoneda, tc, tcDivisas, onAgregar, onPedirTc, proveedoresCRM, sociedadId }: Props) {
  const [mensaje, setMensaje] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [imagen, setImagen] = useState<{ data: string; media_type: string; name: string } | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [fase, setFase] = useState<"entrada" | "revision">("entrada");
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");
  const [notas, setNotas] = useState("");
  const [provIds, setProvIds] = useState<Array<{ id: string; razon_social: string; nombre_fantasia?: string | null }>>([]);
  const [vinculos, setVinculos] = useState<Record<string, string>>({});
  const tcPedido = useRef(false);

  useEffect(() => {
    if (!open) { tcPedido.current = false; return; }
    (async () => {
      let qp = db.from("proveedores").select("id, razon_social, nombre_fantasia").eq("activo", true);
      if (sociedadId) qp = qp.eq("sociedad_id", sociedadId);
      const { data } = await qp;
      setProvIds(data || []);
      if (sociedadId) {
        const { data: vs } = await db.from("catalogo_proveedores").select("proveedor_lista, proveedor_id").eq("sociedad_id", sociedadId);
        setVinculos(Object.fromEntries((vs || []).map((v: any) => [v.proveedor_lista, v.proveedor_id])));
      }
    })();
  }, [open, sociedadId]);

  const proveedorId = (nombre: string) => {
    if (vinculos[nombre]) return vinculos[nombre];
    const nf = normalizarProveedor(nombre);
    const f = provIds.find(p => p.nombre_fantasia && normalizarProveedor(p.nombre_fantasia) === nf);
    if (nf && f) return f.id;
    return buscarProveedorCRM(nombre, provIds.length ? provIds : (proveedoresCRM || []));
  };

  const sinTc = useMemo(() => lineas.some(l => l.incluir && l.elegido !== null && convertirAMonedaPR(1, l.candidatos[l.elegido]?.moneda || prMoneda, prMoneda, tc, tcDivisas) === null), [lineas, prMoneda, tc, tcDivisas]);
  useEffect(() => { if (sinTc && onPedirTc && !tcPedido.current) { tcPedido.current = true; onPedirTc(); } }, [sinTc, onPedirTc]);

  function reset() { setMensaje(""); setArchivo(null); setImagen(null); setLineas([]); setFase("entrada"); setProgreso(""); setError(""); setNotas(""); }
  function cerrar() { reset(); onClose(); }

  async function tomarImagen(file: File) {
    if (file.size > 10 * 1024 * 1024) { setError("Imagen muy grande (máx 10MB)"); return; }
    setImagen({ data: await leerBase64(file), media_type: file.type || "image/png", name: file.name || "captura.png" });
  }

  async function armar() {
    setError(""); setNotas("");
    try {
      let pedidos: Array<{ descripcion: string; cantidad: number; talle: string; codigo: string }> = [];
      const esExcel = archivo && /\.(xlsx|xls|xlsm|csv|ods)$/i.test(archivo.name);
      const esPdf = archivo && /\.pdf$/i.test(archivo.name);
      let textoExtra = "";
      if (esExcel) {
        setProgreso("Leyendo la planilla…");
        const r = await leerExcel(archivo!);
        pedidos = r.lineas; textoExtra = r.texto;
      }
      if (!pedidos.length && (mensaje.trim() || imagen || esPdf || textoExtra)) {
        setProgreso("La IA está leyendo el pedido…");
        const res = await fetch("/api/cotizacion-express", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modo: "extraer",
            mensaje: [mensaje, textoExtra].filter(Boolean).join("\n\n"),
            imagen: imagen ? { data: imagen.data, media_type: imagen.media_type } : undefined,
            pdf: esPdf ? { data: await leerBase64(archivo!) } : undefined,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "La IA no pudo leer el pedido");
        if (d.notas) setNotas(d.notas);
        pedidos = (d.lineas || []).map((l: any) => {
          const st = separarTalle(l.descripcion || "");
          return { descripcion: st.descripcion, talle: String(l.talle || st.talle || "").toUpperCase(), codigo: String(l.codigo || ""), cantidad: Number(l.cantidad) > 0 ? Number(l.cantidad) : 1 };
        });
      }
      pedidos = pedidos.filter(p => p.descripcion);
      if (!pedidos.length) throw new Error("No encontré artículos. Probá pegando el texto o subiendo otro archivo.");

      // 1) candidatos de la lista de costos (de a 6 en paralelo)
      const base: Linea[] = pedidos.map((p, i) => ({ id: String(i), ...p, candidatos: [], elegido: null, confianza: "ninguna", nota: "", incluir: true, buscar: "" }));
      for (let i = 0; i < base.length; i += 6) {
        setProgreso(`Buscando en la lista de costos… ${Math.min(i + 6, base.length)} de ${base.length}`);
        await Promise.all(base.slice(i, i + 6).map(async l => { l.candidatos = await buscarCandidatos(`${l.descripcion}`, l.codigo); }));
      }

      // 2) la IA elige el candidato correcto en cada línea
      setProgreso("La IA está eligiendo el artículo de cada línea…");
      const res = await fetch("/api/cotizacion-express", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo: "elegir", pedidos: base.map(l => ({ id: l.id, descripcion: l.descripcion, talle: l.talle, codigo: l.codigo, candidatos: l.candidatos.map(c => ({ proveedor: c.proveedor, codigo: c.codigo_interno || c.codigo, descripcion: c.descripcion, marca: c.marca, moneda: c.moneda, costo: c.costo })) })) }),
      });
      const d = await res.json().catch(() => ({}));
      const porId = new Map<string, any>((d.elecciones || []).map((e: any) => [String(e.id), e]));
      for (const l of base) {
        const e = porId.get(l.id);
        const idx = e && e.indice !== null && e.indice !== undefined && l.candidatos[Number(e.indice)] ? Number(e.indice) : null;
        if (e) { l.elegido = idx; l.confianza = idx === null ? "ninguna" : (["alta", "media", "baja"].includes(e.confianza) ? e.confianza : "media"); l.nota = e.nota || ""; }
        else if (l.candidatos.length) { l.elegido = 0; l.confianza = "baja"; l.nota = "Sugerido por similitud (sin IA)"; }
      }
      setLineas(base); setFase("revision"); setProgreso("");
    } catch (e) {
      setProgreso(""); setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  async function rebuscar(id: string, texto: string) {
    if (!texto.trim()) return;
    setLineas(ls => ls.map(l => l.id === id ? { ...l, buscando: true } : l));
    const cands = await buscarCandidatos(texto);
    setLineas(ls => ls.map(l => l.id === id ? { ...l, buscando: false, candidatos: cands, elegido: cands.length ? 0 : null, confianza: cands.length ? "manual" : "ninguna", nota: cands.length ? "" : "Sin resultados" } : l));
  }

  const upd = (id: string, cambios: Partial<Linea>) => setLineas(ls => ls.map(l => l.id === id ? { ...l, ...cambios } : l));

  function agregar() {
    const out: CatalogoItemParaPR[] = [];
    for (const l of lineas) {
      if (!l.incluir) continue;
      const desc = (d: string) => l.talle && !normalizar(d).includes(`talle ${normalizar(l.talle)}`) ? `${d} - Talle ${l.talle}` : d;
      const c = l.elegido !== null ? l.candidatos[l.elegido] : null;
      if (!c) {
        out.push({ codigo: l.codigo || "", descripcion: desc(l.descripcion), categoria: "", cantidad: l.cantidad, unidad: "UN", precio_costo: 0, markup_porcentaje: 0, precio_venta: 0, iva_porcentaje: 21, proveedor_nombre: "", proveedor_id: "", stock_propio: false, lista_item_id: "", costo_moneda: prMoneda === "ARS" ? "ARS" : "USD" });
        continue;
      }
      const costoPR = convertirAMonedaPR(c.costo, c.moneda, prMoneda, tc, tcDivisas);
      const ventaPR = convertirAMonedaPR(c.precio_venta, c.moneda, prMoneda, tc, tcDivisas);
      if (costoPR === null || ventaPR === null) continue;
      out.push({
        codigo: c.codigo_interno || c.codigo, descripcion: desc(c.descripcion), categoria: "", cantidad: l.cantidad, unidad: "UN",
        precio_costo: c.costo, markup_porcentaje: costoPR > 0 ? Math.round(((ventaPR / costoPR) - 1) * 10000) / 100 : 0,
        precio_venta: Math.round(ventaPR * 100) / 100, iva_porcentaje: 21, proveedor_nombre: c.proveedor, proveedor_id: proveedorId(c.proveedor),
        stock_propio: false, lista_item_id: "", costo_moneda: c.moneda === "ARS" ? "ARS" : c.moneda === "USD divisa" ? "USD Divisa" : "USD",
      });
    }
    onAgregar(out);
    cerrar();
  }

  if (!open || typeof document === "undefined") return null;
  const incluidas = lineas.filter(l => l.incluir);
  const cuenta = (c: Confianza) => lineas.filter(l => l.confianza === c).length;
  const totalVenta = incluidas.reduce((s, l) => {
    const c = l.elegido !== null ? l.candidatos[l.elegido] : null;
    const v = c ? convertirAMonedaPR(c.precio_venta, c.moneda, prMoneda, tc, tcDivisas) : 0;
    return s + (v || 0) * l.cantidad;
  }, 0);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" onMouseDown={e => { if (e.target === e.currentTarget && fase === "entrada" && !progreso) cerrar(); }}>
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold dark:text-white"><Sparkles className="h-5 w-5 text-orange-500" /> Cotización express</h2>
            <p className="text-xs text-zinc-500">Tirá un Excel, PDF o foto, o pegá el mensaje del cliente. Se busca cada artículo en la lista de costos y vos revisás antes de agregar.</p>
          </div>
          <button onClick={cerrar} disabled={!!progreso}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>

        {fase === "entrada" && <div className="space-y-3 overflow-y-auto p-5">
          <label
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (!f) return; if (f.type.startsWith("image/")) { void tomarImagen(f); } else setArchivo(f); }}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-orange-300 bg-orange-50/50 p-6 text-sm text-orange-700 hover:border-orange-500 dark:border-orange-800 dark:bg-orange-950/20 dark:text-orange-300">
            <FileUp className="h-6 w-6" />
            <span className="font-medium">Arrastrá o elegí un Excel, CSV, PDF o imagen</span>
            {archivo && <span className="flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3 w-3" /> {archivo.name}</span>}
            {imagen && <span className="flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3 w-3" /> {imagen.name}</span>}
            <input type="file" className="hidden" accept=".xlsx,.xls,.xlsm,.csv,.ods,.pdf,image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (f.type.startsWith("image/")) { setArchivo(null); void tomarImagen(f); } else { setImagen(null); setArchivo(f); } }} />
          </label>
          <textarea
            value={mensaje}
            onChange={e => setMensaje(e.target.value)}
            onPaste={e => { const it = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/")); const f = it?.getAsFile(); if (f) { e.preventDefault(); void tomarImagen(f); } }}
            rows={6}
            placeholder="…o pegá acá el mensaje / mail / WhatsApp del cliente, o una captura (Ctrl+V)"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
          {(archivo || imagen) && <button onClick={() => { setArchivo(null); setImagen(null); }} className="text-xs text-zinc-500 hover:text-red-600">Quitar archivo</button>}
          {error && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {error}</p>}
          {progreso && <p className="flex items-center gap-2 text-sm text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> {progreso}</p>}
        </div>}

        {fase === "revision" && <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 px-5 py-2 text-xs">
            <span className="text-zinc-500">{lineas.length} líneas:</span>
            {(["alta", "media", "baja", "manual", "ninguna"] as Confianza[]).filter(c => cuenta(c)).map(c => <span key={c} className={`rounded-full px-2 py-0.5 font-medium ${COLOR[c]}`}>{cuenta(c)} {ETIQUETA[c]}</span>)}
            {sinTc && <span className="text-amber-600">Trayendo tipo de cambio BNA…</span>}
            {notas && <span className="text-zinc-500">· {notas}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  <th className="px-2 py-2"><input type="checkbox" checked={lineas.every(l => l.incluir)} onChange={e => setLineas(ls => ls.map(l => ({ ...l, incluir: e.target.checked })))} /></th>
                  <th className="px-2">Pedido del cliente</th><th className="px-2 w-16">Cant.</th><th className="px-2">Artículo de la lista</th>
                  <th className="px-2 text-right">Costo</th><th className="px-2 text-right">Venta ({prMoneda === "ARS" ? "$" : "US$"})</th><th className="px-2">Estado</th><th className="px-2">Buscar otro</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => {
                  const c = l.elegido !== null ? l.candidatos[l.elegido] : null;
                  const venta = c ? convertirAMonedaPR(c.precio_venta, c.moneda, prMoneda, tc, tcDivisas) : null;
                  return <tr key={l.id} className={`border-t border-zinc-100 align-top dark:border-zinc-800 dark:text-zinc-200 ${i % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""} ${l.incluir ? "" : "opacity-40"}`}>
                    <td className="px-2 py-2"><input type="checkbox" checked={l.incluir} onChange={e => upd(l.id, { incluir: e.target.checked })} /></td>
                    <td className="max-w-[220px] px-2 py-2">{l.descripcion}{l.talle && <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] dark:bg-zinc-700">T {l.talle}</span>}{l.codigo && <span className="block text-[10px] text-zinc-400">cód. {l.codigo}</span>}</td>
                    <td className="px-2 py-1.5"><input type="number" min={0} step="any" value={l.cantidad} onChange={e => upd(l.id, { cantidad: Number(e.target.value) || 0 })} className="w-16 rounded border border-zinc-200 px-1 py-0.5 text-right dark:border-zinc-700 dark:bg-zinc-800" /></td>
                    <td className="px-2 py-1.5">
                      <select value={l.elegido ?? ""} onChange={e => upd(l.id, { elegido: e.target.value === "" ? null : Number(e.target.value), confianza: e.target.value === "" ? "ninguna" : "manual", nota: "" })} className="w-full max-w-[420px] rounded border border-zinc-200 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-800">
                        <option value="">— Sin artículo (cargar precio a mano) —</option>
                        {l.candidatos.map((k, j) => <option key={k.id} value={j}>{k.proveedor} · {k.codigo_interno || k.codigo} · {k.descripcion} · {fmt(k.costo, k.moneda)}</option>)}
                      </select>
                      {l.nota && <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">{l.nota}</p>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{c ? fmt(c.costo, c.moneda) : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{venta !== null && c ? fmt(venta, prMoneda) : "—"}</td>
                    <td className="px-2 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${COLOR[l.confianza]}`}>{ETIQUETA[l.confianza]}</span></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <input value={l.buscar} onChange={e => upd(l.id, { buscar: e.target.value })} onKeyDown={e => { if (e.key === "Enter") void rebuscar(l.id, l.buscar); }} placeholder="palabras o código" className="w-28 rounded border border-zinc-200 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800" />
                        <button onClick={() => rebuscar(l.id, l.buscar)} className="text-zinc-500 hover:text-orange-600">{l.buscando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}</button>
                      </div>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>}

        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div className="text-xs text-zinc-500">
            {fase === "revision" && <>Total venta (lista, sin IVA): <b className="text-zinc-800 dark:text-white">{fmt(totalVenta, prMoneda)}</b> · Las líneas “Sin artículo” entran con precio 0 para completar a mano.</>}
          </div>
          <div className="flex gap-2">
            {fase === "revision" && <button onClick={() => { setFase("entrada"); setLineas([]); }} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Volver</button>}
            <button onClick={cerrar} disabled={!!progreso} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cancelar</button>
            {fase === "entrada"
              ? <button onClick={armar} disabled={!!progreso || (!mensaje.trim() && !archivo && !imagen)} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{progreso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Armar cotización</button>
              : <button onClick={agregar} disabled={!incluidas.length || sinTc} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Check className="h-4 w-4" /> Agregar {incluidas.length} al presupuesto</button>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
