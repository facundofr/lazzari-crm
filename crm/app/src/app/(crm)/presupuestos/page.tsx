"use client";

/**
 * Presupuestos (ex "Presupuestos nuevo", tandas A y B). Desde el 20/10/2026 es LA pantalla de presupuestos, para todos:
 * pestañas "Presupuestos" (la lista de siempre, components/presupuestos/presupuestos-lista.tsx) y "Armar presupuesto".
 * /presupuestos-nuevo solo redirige acá. El sistema abre acá.
 * El vendedor pega el pedido del cliente (mail, WhatsApp, foto, PDF, Excel o texto) y la IA (Opus 5.5):
 *   1) lee los artículos y quién pide (CUIT / empresa / mail → cliente del CRM),
 *   2) elige el artículo en la lista de costos y el proveedor (menor costo comparable, preferencias, lo que ya le vendimos),
 *   3) propone el precio (último precio vendido a ese cliente si deja margen; si no, el de la lista),
 *   4) muestra todo con semáforo, avisa sin frenar (margen < 15 %, sin precio, decimales, dólar del cliente),
 *   5) con un clic crea el PR (queda en Presupuestos, listo para mandar).
 * "Decile a la IA" cambia cosas en palabras y se puede deshacer. Todo es sugerencia: nada frena.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, FileUp, Loader2, Search, Sparkles, Undo2, X } from "lucide-react";
import { Header } from "@/components/layout/header";
import SeguimientoIA from "@/components/presupuestos/seguimiento-ia";
import PresupuestosLista from "@/components/presupuestos/presupuestos-lista";
import { useToast } from "@/components/ui/toast";
import { Autocompletar } from "@/components/ui/autocompletar";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { todayAR } from "@/lib/utils";
import { traerTodo } from "@/lib/paginar";
import { convertirAMonedaPR, normalizarProveedor, buscarProveedorCRM, traerListaCompleta } from "@/components/presupuestos/catalogo-picker";
import { leerExcel, leerBase64, separarTalle } from "@/components/presupuestos/cotizacion-express";
import { buscarCandidatos, normalizar, tokens, type CatalogoCandidato as Cand } from "@/lib/catalogo-busqueda";
import { leerDolaresGuardados, etiquetaDolar, type DolaresGuardados } from "@/lib/dolar-presupuesto";
import {
  proponerPrecio, semaforoLinea, buscarClientes, clienteSeguro, ultimoPrecioCliente, avisosPresupuesto, margenSobreCosto, redondear2,
  MARGEN_MINIMO_IA, type Confianza, type Semaforo, type ClienteBasico, type ClienteCandidato, type RenglonHistorico,
} from "@/lib/presupuesto-ia";

const db = supabase as any;

type ClienteRow = ClienteBasico & { moneda_predeterminada?: string | null };
type Linea = {
  id: string; descripcion: string; cantidad: number; talle: string; codigo: string;
  candidatos: Cand[]; elegido: number | null; confianza: Confianza; nota: string; incluir: boolean;
  provPref?: string;
  /** null = precio automático (el que propone la IA); número = lo escribió el vendedor. */
  precioManual: number | null;
};
type Pedido = { descripcion: string; cantidad: number; talle: string; codigo: string };
type Pregunta = { linea?: string; pregunta: string };
type Fase = "entrada" | "preguntas" | "revision";

const COLOR_SEMAFORO: Record<Semaforo, string> = {
  verde: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  amarillo: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  rojo: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};
const TEXTO_SEMAFORO: Record<Semaforo, string> = { verde: "Listo", amarillo: "Revisar", rojo: "Falta" };
const TEXTO_CONFIANZA: Record<Confianza, string> = { alta: "Seguro", media: "Probable", baja: "Alternativa", ninguna: "No está", manual: "Elegido" };

const fmt = (n: number, m: string) => `${m === "ARS" ? "$" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const costoMonedaPR = (m: string) => (m === "ARS" ? "ARS" : m.toLowerCase().includes("divisa") ? "USD Divisa" : "USD");
const monedaDeCliente = (c: ClienteRow | undefined | null): { moneda: "ARS" | "USD"; modalidad: "divisas" | "billetes" } => {
  const p = c?.moneda_predeterminada;
  if (p === "ARS") return { moneda: "ARS", modalidad: "divisas" };
  if (p === "USD") return { moneda: "USD", modalidad: "billetes" };
  return { moneda: "USD", modalidad: "divisas" };
};

export default function PresupuestosPage() {
  const { profile, sociedadActiva } = useUser();
  const { toast } = useToast();

  // ── entrada ──
  const [pestana, setPestana] = useState<"armar" | "lista" | "seguimiento">("lista");
  // El buscador de arriba abre un PR acá mismo: pasar a la pestaña lista (que lo abre con ?selected).
  useEffect(() => {
    const irALista = () => setPestana("lista");
    window.addEventListener("lz-abrir-pr", irALista);
    return () => window.removeEventListener("lz-abrir-pr", irALista);
  }, []);
  const [fase, setFase] = useState<Fase>("entrada");
  const [mensaje, setMensaje] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [imagen, setImagen] = useState<{ data: string; media_type: string; name: string } | null>(null);
  const [indicaciones, setIndicaciones] = useState("");
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");

  // ── datos base ──
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clienteIA, setClienteIA] = useState(false);
  const [sugeridos, setSugeridos] = useState<ClienteCandidato[]>([]);
  const [moneda, setMoneda] = useState<"ARS" | "USD">("USD");
  const [modalidad, setModalidad] = useState<"divisas" | "billetes">("divisas");
  const [dolares, setDolares] = useState<DolaresGuardados | null>(null);
  const [provIds, setProvIds] = useState<Array<{ id: string; razon_social: string; nombre_fantasia?: string | null }>>([]);
  const [vinculos, setVinculos] = useState<Record<string, string>>({});
  const [historial, setHistorial] = useState<RenglonHistorico[]>([]);

  // ── armado ──
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [deshacer, setDeshacer] = useState<Linea[][]>([]);
  const [resumenIA, setResumenIA] = useState("");
  const [notas, setNotas] = useState("");
  const [origen, setOrigen] = useState<"texto" | "foto" | "archivo">("texto");
  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);
  const [respuestas, setRespuestas] = useState<string[]>([]);
  const [respuestasPrevias, setRespuestasPrevias] = useState("");
  const [pedidosPend, setPedidosPend] = useState<Pedido[]>([]);
  const [instruccion, setInstruccion] = useState("");
  const [ultimaInstruccion, setUltimaInstruccion] = useState("");
  const [preguntasAj, setPreguntasAj] = useState<Pregunta[]>([]);
  const [respuestasAj, setRespuestasAj] = useState<string[]>([]);
  const [resumenAj, setResumenAj] = useState("");
  const [soloRevisar, setSoloRevisar] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const tc = dolares?.billete?.valor || 0;
  const tcDivisas = dolares?.divisa?.valor || 0;
  const cliente = useMemo(() => clientes.find(c => c.id === clienteId) || null, [clientes, clienteId]);

  // Clientes, proveedores y dólar (una vez por sociedad).
  useEffect(() => {
    if (!sociedadActiva?.id) return;
    let vivo = true;
    (async () => {
      try {
        const cs = await traerTodo<ClienteRow>(() => db.from("clientes").select("id, razon_social, cuit, email, email_facturacion, moneda_predeterminada").eq("activo", true).eq("sociedad_id", sociedadActiva.id).order("razon_social"));
        if (vivo) setClientes(cs);
      } catch { /* sin clientes no se puede sugerir: se elige a mano */ }
      try {
        const { data } = await db.from("proveedores").select("id, razon_social, nombre_fantasia").eq("activo", true).eq("sociedad_id", sociedadActiva.id);
        if (vivo) setProvIds(data || []);
        const { data: vs } = await db.from("catalogo_proveedores").select("proveedor_lista, proveedor_id").eq("sociedad_id", sociedadActiva.id);
        if (vivo) setVinculos(Object.fromEntries((vs || []).map((v: any) => [v.proveedor_lista, v.proveedor_id])));
      } catch { /* se vincula a mano */ }
      try { const g = await leerDolaresGuardados(supabase); if (vivo) setDolares(g); } catch { if (vivo) setDolares({ billete: null, divisa: null, fechaBuscada: "" }); /* sin cotización: se avisa en pantalla */ }
    })();
    return () => { vivo = false; };
  }, [sociedadActiva?.id]);

  const proveedorId = useCallback((nombre: string) => {
    if (vinculos[nombre]) return vinculos[nombre];
    const nf = normalizarProveedor(nombre);
    const f = provIds.find(p => p.nombre_fantasia && normalizarProveedor(p.nombre_fantasia) === nf);
    if (nf && f) return f.id;
    return buscarProveedorCRM(nombre, provIds);
  }, [vinculos, provIds]);

  /** Vincula el proveedor de la lista de costos con el del CRM (se recuerda para todos los pedidos futuros). */
  async function vincular(nombreLista: string, idCRM: string) {
    if (!idCRM || !sociedadActiva?.id) return;
    setVinculos(v => ({ ...v, [nombreLista]: idCRM }));
    const { error: e1 } = await db.from("catalogo_proveedores").upsert({ sociedad_id: sociedadActiva.id, proveedor_lista: nombreLista, proveedor_id: idCRM }, { onConflict: "sociedad_id,proveedor_lista" });
    if (e1) { toast.error(`No se pudo guardar el vínculo: ${e1.message}`); return; }
    await db.from("proveedores").update({ nombre_fantasia: nombreLista }).eq("id", idCRM).is("nombre_fantasia", null);
    toast.success(`“${nombreLista}” quedó vinculado`);
  }

  // Historial de lo que ya se le vendió a un cliente (para precio y para elegir el mismo artículo).
  const cargarHistorial = useCallback(async (id: string): Promise<RenglonHistorico[]> => {
    if (!id) { setHistorial([]); return []; }
    try {
      const { data } = await db.from("presupuestos")
        .select("numero, fecha, moneda, estado, presupuesto_items(codigo, descripcion, precio_venta)")
        .eq("cliente_id", id).in("estado", ["aprobado", "facturar", "facturado"])
        .order("fecha", { ascending: false }).limit(80);
      const h: RenglonHistorico[] = [];
      for (const p of data || []) for (const it of p.presupuesto_items || []) {
        h.push({ codigo: it.codigo || null, descripcion: it.descripcion || "", precio_venta: Number(it.precio_venta) || 0, moneda: p.moneda || "ARS", fecha: String(p.fecha || ""), numero: p.numero || "" });
      }
      setHistorial(h);
      return h;
    } catch { setHistorial([]); return []; }
  }, []);

  function elegirCliente(id: string, porIA = false) {
    setClienteId(id); setClienteIA(porIA);
    const c = clientes.find(x => x.id === id);
    if (c) { const m = monedaDeCliente(c); setMoneda(m.moneda); setModalidad(m.modalidad); }
    void cargarHistorial(id);
  }

  // ── cálculo por renglón ──
  type Calc = {
    cand: Cand | null; costo: number | null; ventaLista: number | null; precio: number; margen: number | null; nota: string;
    bajoMinimo: boolean; sinTc: boolean; semaforo: Semaforo; origenPrecio: string;
  };
  const calcular = useCallback((l: Linea): Calc => {
    const cand = l.elegido !== null ? l.candidatos[l.elegido] || null : null;
    if (!cand) {
      const precio = l.precioManual ?? 0;
      return { cand: null, costo: null, ventaLista: null, precio, margen: null, nota: "", bajoMinimo: false, sinTc: false, origenPrecio: "manual",
        semaforo: semaforoLinea({ confianza: l.confianza, tieneArticulo: false, precio, cantidad: l.cantidad, bajoMinimo: false }) };
    }
    const costo = convertirAMonedaPR(cand.costo, cand.moneda, moneda, tc, tcDivisas);
    const ventaLista = convertirAMonedaPR(cand.precio_venta, cand.moneda, moneda, tc, tcDivisas);
    const sinTc = costo === null || ventaLista === null;
    const ultimo = ultimoPrecioCliente(historial, [cand.codigo_interno || "", cand.codigo], cand.descripcion, moneda);
    const prop = proponerPrecio({ costo, ventaLista, ultimo });
    const precio = l.precioManual ?? prop.precio;
    const margen = costo !== null && costo > 0 && precio > 0 ? margenSobreCosto(precio, costo) : null;
    const bajoMinimo = margen !== null && margen < MARGEN_MINIMO_IA;
    const nota = l.precioManual !== null ? (bajoMinimo ? `Margen ${margen}% (mínimo ${MARGEN_MINIMO_IA}%)` : "") : prop.nota;
    return { cand, costo, ventaLista, precio, margen, nota, bajoMinimo, sinTc, origenPrecio: l.precioManual !== null ? "manual" : prop.origen,
      semaforo: semaforoLinea({ confianza: l.confianza, tieneArticulo: true, precio, cantidad: l.cantidad, bajoMinimo, sinCosto: !(costo && costo > 0), avisoExtra: sinTc }) };
  }, [historial, moneda, tc, tcDivisas]);

  const filas = useMemo(() => lineas.map(l => ({ l, c: calcular(l) })), [lineas, calcular]);
  const incluidas = filas.filter(f => f.l.incluir);
  const cuenta = (s: Semaforo) => incluidas.filter(f => f.c.semaforo === s).length;
  const totales = useMemo(() => {
    let venta = 0, costo = 0;
    for (const f of incluidas) {
      venta += f.c.precio * f.l.cantidad;
      if (f.c.costo && f.c.costo > 0 && f.c.precio > 0) costo += f.c.costo * f.l.cantidad;
    }
    const ventaConCosto = incluidas.reduce((s, f) => s + (f.c.costo && f.c.costo > 0 && f.c.precio > 0 ? f.c.precio * f.l.cantidad : 0), 0);
    return { venta, costo, margen: costo > 0 ? margenSobreCosto(ventaConCosto, costo) : null };
  }, [incluidas]);
  const avisos = useMemo(() => avisosPresupuesto({
    moneda, cotizacionModalidad: modalidad, clienteMonedaPredeterminada: cliente?.moneda_predeterminada,
    lineas: incluidas.map(f => ({ incluir: true, precio: f.c.precio, costo: f.c.costo, cantidad: f.l.cantidad, margenPct: f.c.margen, descripcion: f.l.descripcion })),
  }), [incluidas, moneda, modalidad, cliente]);
  const sinCotizacion = lineas.some(l => l.incluir && l.elegido !== null && calcular(l).sinTc);

  // ── IA: leer el pedido ──
  async function tomarImagen(file: File) {
    if (file.size > 10 * 1024 * 1024) { setError("Imagen muy grande (máx 10MB)"); return; }
    setImagen({ data: await leerBase64(file), media_type: file.type || "image/png", name: file.name || "captura.png" });
  }
  const textoRespuestas = (ps: Pregunta[], rs: string[]) => ps.map((p, i) => `${p.linea ? `[${p.linea}] ` : ""}${p.pregunta} → ${String(rs[i] || "").trim() || "(sin respuesta)"}`).join("\n");

  async function buscarYElegir(base: Linea[], ctx: { moneda: "ARS" | "USD"; hist: RenglonHistorico[] }): Promise<Linea[]> {
    // Proveedor preferido ("cambiá los anteojos a Segufer"): se traduce al nombre exacto que tiene en la lista de costos.
    let nombresLista: string[] = [];
    if (base.some(l => l.provPref)) {
      try { nombresLista = [...new Set((await traerListaCompleta()).map(r => r.proveedor))]; } catch { /* sin preferencia */ }
    }
    const provDeLista = (pref: string) => {
      const pp = normalizar(pref);
      return nombresLista.find(p => normalizar(p) === pp) || nombresLista.find(p => normalizar(p).includes(pp) || pp.includes(normalizar(p)));
    };
    for (let i = 0; i < base.length; i += 6) {
      setProgreso(`Buscando en la lista de costos… ${Math.min(i + 6, base.length)} de ${base.length}`);
      await Promise.all(base.slice(i, i + 6).map(async (l) => {
        const pv = l.provPref ? provDeLista(l.provPref) : undefined;
        l.candidatos = await buscarCandidatos(l.descripcion, l.codigo, 15, pv ? { provs: [pv], soloProvs: false, marcas: [], soloMarcas: false } : undefined);
      }));
    }
    setProgreso("La IA (Opus 5.5) está eligiendo el artículo de cada línea…");
    const yaVendido = (l: Linea) => {
      const tk = new Set(tokens(`${l.descripcion} ${l.codigo}`));
      const vistos = new Set<string>(); const out: string[] = [];
      for (const h of ctx.hist) {
        const ht = tokens(`${h.descripcion} ${h.codigo || ""}`);
        const comunes = ht.filter(w => tk.has(w)).length;
        if (comunes >= 2 || (comunes >= 1 && tk.size <= 2)) {
          const k = normalizar(h.descripcion);
          if (!vistos.has(k)) { vistos.add(k); out.push(`${h.codigo ? h.codigo + " · " : ""}${h.descripcion}`); }
        }
        if (out.length >= 5) break;
      }
      return out;
    };
    const res = await fetch("/api/cotizacion-express", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modo: "elegir", moneda_comparable: ctx.moneda === "ARS" ? "ARS" : "USD",
        pedidos: base.map(l => ({
          id: l.id, descripcion: l.descripcion, talle: l.talle, codigo: l.codigo, proveedor_preferido: l.provPref || "", ya_vendido: yaVendido(l),
          candidatos: l.candidatos.map(c => { const cp = convertirAMonedaPR(c.costo, c.moneda, ctx.moneda, tc, tcDivisas); return { proveedor: c.proveedor, codigo: c.codigo_interno || c.codigo, descripcion: c.descripcion, marca: c.marca, moneda: c.moneda, costo: c.costo, costo_comparable: cp === null ? null : Math.round(cp * 100) / 100 }; }),
        })),
        preferencias: { indicaciones: indicaciones.trim() },
      }),
    });
    const d = await res.json().catch(() => ({}));
    const porId = new Map<string, any>((d.elecciones || []).map((e: any) => [String(e.id), e]));
    for (const l of base) {
      const e = porId.get(l.id);
      const idx = e && e.indice !== null && e.indice !== undefined && l.candidatos[Number(e.indice)] ? Number(e.indice) : null;
      if (e) { l.elegido = idx; l.confianza = idx === null ? "ninguna" : (["alta", "media", "baja"].includes(e.confianza) ? e.confianza : "media"); l.nota = e.nota || ""; }
      else if (l.candidatos.length) { l.elegido = 0; l.confianza = "baja"; l.nota = "Sugerido por parecido (la IA no contestó)"; }
      else { l.elegido = null; l.confianza = "ninguna"; }
    }
    return base;
  }

  async function armarDesdePedidos(pedidos: Pedido[], ctx: { moneda: "ARS" | "USD"; hist: RenglonHistorico[] }) {
    pedidos = pedidos.filter(p => p.descripcion);
    if (!pedidos.length) throw new Error("No encontré artículos. Probá pegando el texto o subiendo otro archivo.");
    const base: Linea[] = pedidos.map((p, i) => ({ id: String(i), ...p, candidatos: [], elegido: null, confianza: "ninguna", nota: "", incluir: true, precioManual: null }));
    await buscarYElegir(base, ctx);
    setLineas(base); setDeshacer([]); setFase("revision"); setProgreso("");
  }

  /** Cliente y moneda para este pedido (lo ya elegido por el vendedor manda; si no, lo que leyó la IA). */
  async function resolverCliente(ex: { empresa?: string; cuit?: string; email?: string }, monedaPedida: string): Promise<{ moneda: "ARS" | "USD"; hist: RenglonHistorico[] }> {
    let cli: ClienteRow | null = cliente;
    if (!cli) {
      const cand = buscarClientes(clientes, ex);
      setSugeridos(cand.slice(0, 4));
      if (clienteSeguro(cand)) { cli = cand[0].cliente as ClienteRow; elegirCliente(cli.id, true); }
    }
    let m = moneda;
    if (cli && !cliente) m = monedaDeCliente(cli).moneda;
    else if (!cli && (monedaPedida === "USD" || monedaPedida === "ARS")) { m = monedaPedida; setMoneda(monedaPedida); }
    const hist = cli ? (cli.id === clienteId ? historial : await cargarHistorial(cli.id)) : [];
    return { moneda: m, hist };
  }

  async function armar(respuestasNuevas = "") {
    setError(""); setNotas("");
    try {
      const esExcel = !!archivo && /\.(xlsx|xls|xlsm|csv|ods)$/i.test(archivo.name);
      const esPdf = !!archivo && /\.pdf$/i.test(archivo.name);
      setOrigen(imagen ? "foto" : archivo ? "archivo" : "texto");
      let pedidos: Pedido[] = []; let textoExtra = "";
      if (esExcel) { setProgreso("Leyendo la planilla…"); const r = await leerExcel(archivo!); pedidos = r.lineas; textoExtra = r.texto; }
      let ex: { empresa?: string; cuit?: string; email?: string } = {}; let monedaPedida = "";
      if (!pedidos.length && (mensaje.trim() || imagen || esPdf || textoExtra)) {
        setProgreso("La IA (Opus 5.5) está leyendo el pedido…");
        const todas = [respuestasPrevias, respuestasNuevas].filter(Boolean).join("\n");
        const res = await fetch("/api/cotizacion-express", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modo: "extraer", mensaje: [mensaje, textoExtra].filter(Boolean).join("\n\n"),
            imagen: imagen ? { data: imagen.data, media_type: imagen.media_type } : undefined,
            pdf: esPdf ? { data: await leerBase64(archivo!) } : undefined, respuestas: todas || undefined,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "La IA no pudo leer el pedido");
        setNotas(d.notas || ""); setResumenIA(d.resumen || ""); setRespuestasPrevias(todas);
        ex = d.cliente || {}; monedaPedida = d.moneda_pedida || "";
        pedidos = (d.lineas || []).map((l: any) => {
          const st = separarTalle(l.descripcion || "");
          return { descripcion: st.descripcion, talle: String(l.talle || st.talle || "").toUpperCase(), codigo: String(l.codigo || ""), cantidad: Number(l.cantidad) > 0 ? Number(l.cantidad) : 1 };
        });
        const ps: Pregunta[] = Array.isArray(d.preguntas) ? d.preguntas.filter((p: any) => p?.pregunta) : [];
        const ctx = await resolverCliente(ex, monedaPedida);
        if (ps.length) { setPedidosPend(pedidos); setPreguntas(ps); setRespuestas(ps.map(() => "")); setFase("preguntas"); setProgreso(""); return; }
        await armarDesdePedidos(pedidos, ctx);
        return;
      }
      const ctx = await resolverCliente(ex, monedaPedida);
      await armarDesdePedidos(pedidos, ctx);
    } catch (e) {
      setProgreso(""); setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  async function seguirSinResponder() {
    setError("");
    try { await armarDesdePedidos(pedidosPend, { moneda, hist: historial }); } catch (e) { setProgreso(""); setError(e instanceof Error ? e.message : "Error inesperado"); }
  }

  // ── Decile a la IA (con Deshacer) ──
  async function ajustar(respuestasTxt = "") {
    const base = respuestasTxt ? ultimaInstruccion : instruccion.trim();
    if (!base) return;
    const instr = respuestasTxt ? `${base}\nRespuestas a tus preguntas:\n${respuestasTxt}` : base;
    setError(""); setResumenAj(""); setProgreso("La IA está ajustando el presupuesto…");
    try {
      const res = await fetch("/api/cotizacion-express", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modo: "ajustar", instruccion: instr,
          lineas: lineas.map(l => { const c = l.elegido !== null ? l.candidatos[l.elegido] : null; return { id: l.id, descripcion: l.descripcion, cantidad: l.cantidad, talle: l.talle, incluida: l.incluir, articulo: c ? `${c.proveedor} · ${c.descripcion}${c.marca ? ` · ${c.marca}` : ""}` : "" }; }),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "La IA no pudo ajustar el presupuesto");
      const anterior = lineas.map(l => ({ ...l }));
      const quitar = new Set<string>((d.quitar || []).map(String));
      let nuevas = lineas.filter(l => !quitar.has(l.id)).map(l => ({ ...l }));
      const aBuscar: Linea[] = [];
      for (const c of d.cambiar || []) {
        const l = nuevas.find(x => x.id === String(c.id)); if (!l) continue;
        let rebuscar = false;
        if (Number(c.cantidad) > 0) l.cantidad = Number(c.cantidad);
        if (c.talle != null && String(c.talle).toUpperCase() !== l.talle) { l.talle = String(c.talle).toUpperCase(); rebuscar = true; }
        if (c.descripcion && String(c.descripcion) !== l.descripcion) { l.descripcion = String(c.descripcion); rebuscar = true; }
        if (c.proveedor_preferido) { l.provPref = String(c.proveedor_preferido); rebuscar = true; }
        if (rebuscar) { l.candidatos = []; l.precioManual = null; aBuscar.push(l); }
      }
      let max = Math.max(-1, ...lineas.map(l => Number(l.id)).filter(Number.isFinite));
      for (const a of d.agregar || []) {
        if (!a?.descripcion) continue;
        const st = separarTalle(String(a.descripcion));
        const n: Linea = { id: String(++max), descripcion: st.descripcion, talle: String(a.talle || st.talle || "").toUpperCase(), codigo: String(a.codigo || ""), cantidad: Number(a.cantidad) > 0 ? Number(a.cantidad) : 1, candidatos: [], elegido: null, confianza: "ninguna", nota: "", incluir: true, precioManual: null, provPref: a.proveedor_preferido ? String(a.proveedor_preferido) : "" };
        nuevas.push(n); aBuscar.push(n);
      }
      if (aBuscar.length) await buscarYElegir(aBuscar, { moneda, hist: historial });
      const hayCambios = aBuscar.length > 0 || quitar.size > 0 || (d.cambiar || []).length > 0;
      if (hayCambios) setDeshacer(p => [...p.slice(-9), anterior]);
      setLineas(nuevas);
      const ps: Pregunta[] = Array.isArray(d.preguntas) ? d.preguntas.filter((p: any) => p?.pregunta) : [];
      setPreguntasAj(ps); setRespuestasAj(ps.map(() => ""));
      setUltimaInstruccion(base);
      setResumenAj(d.resumen || `${d.agregar?.length || 0} agregadas · ${d.cambiar?.length || 0} cambiadas · ${quitar.size} quitadas`);
      if (!respuestasTxt) setInstruccion("");
    } catch (e) { setError(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setProgreso(""); }
  }
  function deshacerUltimo() {
    if (!deshacer.length) return;
    setLineas(deshacer[deshacer.length - 1]); setDeshacer(deshacer.slice(0, -1)); setResumenAj("Se deshizo el último cambio.");
  }

  // ── buscador manual por renglón ──
  const [abierto, setAbierto] = useState<string | null>(null);
  const [busq, setBusq] = useState("");
  const [resultados, setResultados] = useState<Cand[]>([]);
  const [cargandoBusq, setCargandoBusq] = useState(false);
  useEffect(() => {
    if (!abierto || busq.trim().length < 2) { setResultados([]); return; }
    let cancelado = false;
    const t = setTimeout(async () => {
      setCargandoBusq(true);
      const r = await buscarCandidatos(busq, "", 60);
      if (!cancelado) { setResultados(r); setCargandoBusq(false); }
    }, 300);
    return () => { cancelado = true; clearTimeout(t); };
  }, [abierto, busq]);
  const upd = (id: string, cambios: Partial<Linea>) => setLineas(ls => ls.map(l => (l.id === id ? { ...l, ...cambios } : l)));
  function elegirResultado(id: string, c: Cand) {
    setLineas(ls => ls.map(l => l.id === id ? { ...l, candidatos: [c, ...l.candidatos.filter(k => k.id !== c.id)], elegido: 0, confianza: "manual", nota: "", precioManual: null } : l));
    setAbierto(null);
  }

  // ── crear el PR ──
  async function crear() {
    if (guardando) return;
    if (!sociedadActiva?.id || !profile?.id) { toast.error("No se pudo identificar tu usuario o la sociedad"); return; }
    if (!clienteId) { toast.error("Elegí el cliente para crear el presupuesto"); return; }
    const activas = filas.filter(f => f.l.incluir && f.l.cantidad > 0);
    if (!activas.length) { toast.error("No hay renglones para crear"); return; }
    const rojos = activas.filter(f => f.c.semaforo === "rojo").length;
    const lista = [...avisos, ...(rojos ? [`${rojos} renglón(es) con datos que faltan (quedan para completar en el presupuesto)`] : []), ...(sinCotizacion ? ["Falta la cotización del dólar: esos renglones quedan sin precio"] : [])];
    if (lista.length && !window.confirm(`Atención:\n\n• ${lista.join("\n• ")}\n\n¿Crear el presupuesto igual?`)) return;

    setGuardando(true);
    try {
      const tcU = tc > 0 ? tc : null, tcD = tcDivisas > 0 ? tcDivisas : null;
      const items = activas.map((f, idx) => {
        const l = f.l, c = f.c.cand;
        const desc = l.talle && !normalizar(c?.descripcion || l.descripcion).includes(`talle ${normalizar(l.talle)}`) ? `${c?.descripcion || l.descripcion} - Talle ${l.talle}` : (c?.descripcion || l.descripcion);
        const markup = f.c.costo && f.c.costo > 0 && f.c.precio > 0 ? Math.max(0, redondear2((f.c.precio / f.c.costo - 1) * 100)) : 0;
        return {
          codigo: c ? (c.codigo_interno || c.codigo) : (l.codigo || ""), descripcion: desc, categoria: null, cantidad: l.cantidad, unidad: "UN",
          precio_costo: c ? c.costo : 0, markup_porcentaje: markup, precio_venta: redondear2(f.c.precio), iva_porcentaje: 21, orden: idx + 1,
          proveedor_id: c ? (proveedorId(c.proveedor) || null) : null, stock_propio: false, lista_item_id: null,
          proveedor_nombre: c ? c.proveedor : null, costo_moneda: c ? costoMonedaPR(c.moneda === "ARS" ? "ARS" : c.moneda) : (moneda === "ARS" ? "ARS" : "USD"),
        };
      });
      const subtotal = redondear2(items.reduce((s, it) => s + it.precio_venta * it.cantidad, 0));
      const iva = redondear2(subtotal * 0.21);
      const payload = {
        cliente_id: clienteId, vendedor_id: profile.id, sucursal_id: null, contacto_id: null, created_by: profile.id, sociedad_id: sociedadActiva.id,
        fecha: todayAR(), vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], estado: "pendiente", enviado_at: new Date().toISOString(),
        markup_general: 30, subtotal, iva, total: redondear2(subtotal + iva), moneda, tipo_cambio: tcU, tipo_cambio_divisas: tcD,
        cotizacion_modalidad: moneda === "USD" ? modalidad : null, observaciones: "", notas_internas: `Armado con IA (Presupuestos nuevo)${resumenIA ? `: ${resumenIA}` : ""}`,
        tipo_comprobante: null, modalidad_emision: "sin_definir",
      };
      const { data: nuevoId, error: e1 } = await db.rpc("crear_presupuesto_atomico", { p_sociedad_id: sociedadActiva.id, p_presupuesto: payload, p_items: items });
      if (e1) throw new Error(e1.message);
      if (!nuevoId) throw new Error("La base no devolvió el presupuesto creado");

      // Datos de la IA (no críticos: si fallan, el presupuesto ya está creado).
      try {
        await db.from("presupuestos").update({ origen_pedido: origen, ia_armado_at: new Date().toISOString(), ia_resumen: resumenIA || null }).eq("id", nuevoId);
        await Promise.all(activas.map((f, idx) => db.from("presupuesto_items").update({
          pedido_texto: f.l.descripcion + (f.l.talle ? ` talle ${f.l.talle}` : ""), catalogo_id: f.c.cand?.id || null,
          proveedor_sugerido_id: f.c.cand ? (proveedorId(f.c.cand.proveedor) || null) : null, ia_confianza: f.l.confianza, ia_nota: [f.l.nota, f.c.nota].filter(Boolean).join(" · ") || null,
        }).eq("presupuesto_id", nuevoId).eq("orden", idx + 1)));
      } catch { /* solo informativo */ }

      toast.success("Presupuesto creado: lo abro para que lo mandes");
      // Misma página: se pone ?selected en la URL y se pasa a la pestaña lista, que al montarse lo abre.
      window.history.replaceState({}, "", `/presupuestos?selected=${nuevoId}`);
      setPestana("lista");
    } catch (e) {
      toast.error(`No se pudo crear el presupuesto: ${e instanceof Error ? e.message : "error"}`);
    } finally { setGuardando(false); }
  }

  function reiniciar() {
    setFase("entrada"); setLineas([]); setDeshacer([]); setPreguntas([]); setPreguntasAj([]); setResumenAj(""); setResumenIA(""); setNotas(""); setError(""); setRespuestasPrevias("");
  }

  const clientesOpc = useMemo(() => clientes.map(c => ({ valor: c.id, texto: c.razon_social, detalle: c.cuit || undefined })), [clientes]);
  const visibles = soloRevisar ? filas.filter(f => f.c.semaforo !== "verde") : filas;
  const ocupado = !!progreso;

  const pestanas = (
    <div className="flex gap-1 border-b border-zinc-200 bg-white px-4 dark:border-zinc-700 dark:bg-zinc-950 md:px-6">
      {([["lista", "Presupuestos"], ["armar", "Armar presupuesto"]] /* Augusto 20/10: sin la pestaña Seguimiento (queda en el código) */ as const).map(([k, t]) => (
        <button key={k} onClick={() => setPestana(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${pestana === k ? "border-orange-500 text-orange-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>{t}</button>
      ))}
    </div>
  );

  // "Presupuestos": la pantalla de siempre (lista, filtros, detalle), adentro de esta, con las pestañas arriba.
  if (pestana === "lista") return <div>{pestanas}<PresupuestosLista /></div>;

  return (
    <div>
      <Header title="Presupuestos" subtitle="Pegá el pedido del cliente y la IA arma el presupuesto: artículo, proveedor y precio. Vos revisás y lo creás con un clic." />
      <div className="mx-auto max-w-7xl space-y-3 p-4 md:p-6">
        {pestanas}
        {pestana === "seguimiento" && <SeguimientoIA />}
        {pestana === "armar" && <>

        {fase !== "revision" && <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          {/* Cliente y moneda */}
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <div>
              <label className="text-[11px] text-zinc-500">Cliente (si no lo elegís, la IA lo busca en el pedido)</label>
              {cliente ? (
                <div className="mt-1 flex items-center gap-2 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700">
                  <span className="font-medium dark:text-white">{cliente.razon_social}</span>
                  {clienteIA && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">elegido por la IA</span>}
                  <button onClick={() => { setClienteId(""); setClienteIA(false); setHistorial([]); }} className="ml-auto text-zinc-400 hover:text-red-600"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <Autocompletar opciones={clientesOpc} placeholder="Escribí el nombre o CUIT del cliente…" onElegir={(v) => elegirCliente(v)} className="mt-1 w-full border-zinc-200 dark:border-zinc-700" />
              )}
            </div>
            <div>
              <label className="text-[11px] text-zinc-500">Moneda</label>
              <select value={moneda} onChange={e => setMoneda(e.target.value as "ARS" | "USD")} className="mt-1 block rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                <option value="USD">USD</option><option value="ARS">Pesos</option>
              </select>
            </div>
            {moneda === "USD" && <div>
              <label className="text-[11px] text-zinc-500">Dólar</label>
              <select value={modalidad} onChange={e => setModalidad(e.target.value as "divisas" | "billetes")} className="mt-1 block rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                <option value="divisas">Divisa</option><option value="billetes">Billete</option>
              </select>
            </div>}
          </div>
          <p className="text-[11px] text-zinc-400">Cotización: {dolares ? `${etiquetaDolar("billete", dolares.billete)} · ${etiquetaDolar("divisa", dolares.divisa)}` : "leyendo…"}</p>
        </div>}

        {fase === "entrada" && <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <label
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (!f) return; if (f.type.startsWith("image/")) { setArchivo(null); void tomarImagen(f); } else { setImagen(null); setArchivo(f); } }}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-orange-300 bg-orange-50/50 p-5 text-sm text-orange-700 hover:border-orange-500 dark:border-orange-800 dark:bg-orange-950/20 dark:text-orange-300">
            <FileUp className="h-6 w-6" />
            <span className="font-medium">Arrastrá o elegí una foto, PDF, Excel o CSV del pedido</span>
            {archivo && <span className="flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3 w-3" /> {archivo.name}</span>}
            {imagen && <span className="flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3 w-3" /> {imagen.name}</span>}
            <input type="file" className="hidden" accept=".xlsx,.xls,.xlsm,.csv,.ods,.pdf,image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (f.type.startsWith("image/")) { setArchivo(null); void tomarImagen(f); } else { setImagen(null); setArchivo(f); } }} />
          </label>
          <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={7}
            onPaste={e => { const it = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/")); const f = it?.getAsFile(); if (f) { e.preventDefault(); setArchivo(null); void tomarImagen(f); } }}
            placeholder="…o pegá acá el mail o WhatsApp del cliente (con la firma, así la IA encuentra quién es), o una captura con Ctrl+V"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
          {(archivo || imagen) && <button onClick={() => { setArchivo(null); setImagen(null); }} className="text-xs text-zinc-500 hover:text-red-600">Quitar archivo</button>}
          <div>
            <label className="text-[11px] text-zinc-500">Indicaciones para la IA (opcional)</label>
            <input value={indicaciones} onChange={e => setIndicaciones(e.target.value)} placeholder="Ej: lo más económico · todo Segufer · calzado con puntera de composite"
              className="mt-1 w-full rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
          </div>
          {error && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {error}</p>}
          {progreso && <p className="flex items-center gap-2 text-sm text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> {progreso}</p>}
          <div className="flex justify-end">
            <button onClick={() => void armar()} disabled={ocupado || !dolares || (!mensaje.trim() && !archivo && !imagen)} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Armar presupuesto con IA
            </button>
          </div>
        </div>}

        {fase === "preguntas" && <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          <p className="font-semibold">La IA necesita estos datos para no inventar ({pedidosPend.length} artículos leídos):</p>
          {preguntas.map((p, i) => (
            <label key={i} className="block text-xs">
              <span className="font-medium">{p.linea ? <span className="opacity-70">{p.linea}: </span> : null}{p.pregunta}</span>
              <input value={respuestas[i] || ""} onChange={e => setRespuestas(rs => rs.map((r, j) => (j === i ? e.target.value : r)))}
                onKeyDown={e => { if (e.key === "Enter" && !ocupado) void armar(textoRespuestas(preguntas, respuestas)); }}
                placeholder="Tu respuesta (podés dejarla vacía)" className="mt-0.5 w-full rounded border border-sky-200 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-sky-800 dark:bg-zinc-800 dark:text-white" />
            </label>
          ))}
          {error && <p className="text-red-600">⚠️ {error}</p>}
          {progreso && <p className="flex items-center gap-2 text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> {progreso}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={reiniciar} disabled={ocupado} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700">Volver</button>
            <button onClick={() => void seguirSinResponder()} disabled={ocupado} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700">Seguir sin responder</button>
            <button onClick={() => void armar(textoRespuestas(preguntas, respuestas))} disabled={ocupado} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Seguir con mis respuestas
            </button>
          </div>
        </div>}

        {fase === "revision" && <>
          {/* Resumen, cliente sugerido y semáforo */}
          <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
            {resumenIA && <p className="text-sm dark:text-zinc-200"><Sparkles className="mr-1 inline h-4 w-4 text-orange-500" />{resumenIA}</p>}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-500">Cliente:</span>
              {cliente ? (
                <span className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-zinc-800 dark:text-white">
                  {cliente.razon_social}{clienteIA && <span className="text-[10px] text-violet-600">(IA)</span>}
                  <button onClick={() => { setClienteId(""); setClienteIA(false); setHistorial([]); }} className="text-zinc-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                </span>
              ) : (
                <>
                  <span className="text-red-600">sin elegir</span>
                  {sugeridos.map(s => <button key={s.cliente.id} onClick={() => elegirCliente(s.cliente.id)} className="rounded-full border border-violet-300 px-2 py-0.5 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300" title={s.motivo}>{s.cliente.razon_social}</button>)}
                  <div className="w-64"><Autocompletar chico opciones={clientesOpc} placeholder="Buscar cliente…" onElegir={(v) => elegirCliente(v)} className="border-zinc-200 dark:border-zinc-700" /></div>
                </>
              )}
              <select value={moneda} onChange={e => setMoneda(e.target.value as "ARS" | "USD")} className="rounded border border-zinc-200 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"><option value="USD">USD</option><option value="ARS">Pesos</option></select>
              {moneda === "USD" && <select value={modalidad} onChange={e => setModalidad(e.target.value as "divisas" | "billetes")} className="rounded border border-zinc-200 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"><option value="divisas">Divisa</option><option value="billetes">Billete</option></select>}
              <span className="ml-auto flex items-center gap-1.5">
                {(["verde", "amarillo", "rojo"] as Semaforo[]).filter(s => cuenta(s)).map(s => <span key={s} className={`rounded-full px-2 py-0.5 font-medium ${COLOR_SEMAFORO[s]}`}>{cuenta(s)} {TEXTO_SEMAFORO[s].toLowerCase()}</span>)}
                <label className="flex items-center gap-1 text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={soloRevisar} onChange={e => setSoloRevisar(e.target.checked)} /> Solo lo que hay que revisar</label>
              </span>
            </div>
            {notas && <p className="text-xs text-zinc-500">{notas}</p>}
            {sinCotizacion && <p className="text-xs text-amber-700">⚠️ Falta la cotización del dólar: los renglones en otra moneda no se pueden convertir. Elegí la moneda de la lista o cargá el dólar.</p>}
            {avisos.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Para mirar (no frena nada):</p>
              <ul className="list-disc pl-4">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>}
            {/* Decile a la IA */}
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-orange-500" />
              <input value={instruccion} onChange={e => setInstruccion(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !ocupado) void ajustar(); }}
                placeholder="Decile a la IA qué cambiar: agregame 20 guantes nitrilo T9 · cambiá los anteojos a Segufer · sacá los cascos"
                className="min-w-[260px] flex-1 rounded border border-orange-200 px-2 py-1 text-xs dark:border-orange-800 dark:bg-zinc-800 dark:text-white" />
              <button onClick={() => void ajustar()} disabled={ocupado || !instruccion.trim()} className="flex items-center gap-1 rounded bg-orange-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">{ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Aplicar</button>
              <button onClick={deshacerUltimo} disabled={ocupado || !deshacer.length} className="flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200"><Undo2 className="h-3.5 w-3.5" /> Deshacer</button>
            </div>
            {progreso && <p className="flex items-center gap-1 text-xs text-orange-600"><Loader2 className="h-3 w-3 animate-spin" /> {progreso}</p>}
            {error && <p className="text-xs text-red-600">⚠️ {error}</p>}
            {resumenAj && !progreso && <p className="text-xs text-emerald-700 dark:text-emerald-400">✓ {resumenAj}</p>}
            {preguntasAj.length > 0 && (
              <div className="space-y-1 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                <p className="font-semibold">La IA pregunta antes de cambiar (no inventa):</p>
                {preguntasAj.map((p, i) => (
                  <label key={i} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">{p.linea ? <span className="opacity-70">{p.linea}: </span> : null}{p.pregunta}</span>
                    <input value={respuestasAj[i] || ""} onChange={e => setRespuestasAj(rs => rs.map((r, j) => (j === i ? e.target.value : r)))} className="w-48 rounded border border-sky-200 bg-white px-1.5 py-0.5 text-zinc-800 dark:border-sky-800 dark:bg-zinc-800 dark:text-white" />
                  </label>
                ))}
                <div className="flex gap-2">
                  <button onClick={() => void ajustar(textoRespuestas(preguntasAj, respuestasAj))} disabled={ocupado} className="rounded bg-sky-600 px-2.5 py-0.5 font-medium text-white disabled:opacity-50">Responder y aplicar</button>
                  <button onClick={() => setPreguntasAj([])} className="rounded border border-sky-300 px-2.5 py-0.5">Dejar así</button>
                </div>
              </div>
            )}
          </div>

          {/* Renglones */}
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <table className="w-full min-w-[980px] text-xs">
              <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  <th className="px-2 py-2"><input type="checkbox" checked={lineas.every(l => l.incluir)} onChange={e => setLineas(ls => ls.map(l => ({ ...l, incluir: e.target.checked })))} /></th>
                  <th className="px-2">Pedido del cliente</th><th className="w-16 px-2">Cant.</th><th className="px-2">Artículo y proveedor</th>
                  <th className="px-2 text-right">Costo</th><th className="w-28 px-2 text-right">Precio ({moneda === "ARS" ? "$" : "US$"})</th><th className="px-2 text-right">Margen</th><th className="px-2">Estado</th><th className="px-2" />
                </tr>
              </thead>
              <tbody>
                {visibles.map(({ l, c }, i) => (
                  <Fragment key={l.id}>
                    <tr className={`border-t border-zinc-100 align-top dark:border-zinc-800 dark:text-zinc-200 ${i % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""} ${l.incluir ? "" : "opacity-40"}`}>
                      <td className="px-2 py-2"><input type="checkbox" checked={l.incluir} onChange={e => upd(l.id, { incluir: e.target.checked })} /></td>
                      <td className="max-w-[220px] px-2 py-2">{l.descripcion}{l.talle && <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] dark:bg-zinc-700">T {l.talle}</span>}{l.codigo && <span className="block text-[10px] text-zinc-400">cód. {l.codigo}</span>}</td>
                      <td className="px-2 py-1.5"><input type="number" min={0} step="any" value={l.cantidad} onChange={e => upd(l.id, { cantidad: Number(e.target.value) || 0 })} className="w-16 rounded border border-zinc-200 px-1 py-0.5 text-right dark:border-zinc-700 dark:bg-zinc-800" /></td>
                      <td className="px-2 py-1.5">
                        <select value={l.elegido ?? ""} onChange={e => upd(l.id, { elegido: e.target.value === "" ? null : Number(e.target.value), confianza: e.target.value === "" ? "ninguna" : "manual", nota: "", precioManual: null })}
                          className="w-full max-w-[430px] rounded border border-zinc-200 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-800">
                          <option value="">— Sin artículo (precio a mano) —</option>
                          {l.candidatos.map((k, j) => { const cp = convertirAMonedaPR(k.costo, k.moneda, moneda, tc, tcDivisas); return <option key={k.id} value={j}>{k.proveedor} · {k.codigo_interno || k.codigo} · {k.descripcion} · {fmt(k.costo, k.moneda)}{cp !== null && (k.moneda.toUpperCase().startsWith("USD") !== (moneda === "USD")) ? ` (≈ ${fmt(cp, moneda)})` : ""}</option>; })}
                        </select>
                        {(l.nota || c.nota) && <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">{[l.nota, c.nota].filter(Boolean).join(" · ")}</p>}
                        {c.cand && !proveedorId(c.cand.proveedor) && (() => { const nombre = c.cand.proveedor; return <div className="mt-1 flex items-center gap-1 text-[10px] text-red-600">
                          <span className="whitespace-nowrap">⚠ “{nombre}” de la lista = </span>
                          <Autocompletar chico mostrarSinEscribir
                            opciones={[...provIds].sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es")).map(p => ({ valor: p.id, texto: p.razon_social }))}
                            placeholder="Elegí el proveedor del CRM…" onElegir={v => void vincular(nombre, v)} className="w-[200px] border-red-200 dark:border-red-800" />
                        </div>; })()}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">{c.cand && c.costo !== null ? fmt(c.costo, moneda) : "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        <input type="number" min={0} step="0.01" value={c.precio || ""} placeholder="0"
                          onChange={e => upd(l.id, { precioManual: e.target.value === "" ? 0 : Number(e.target.value) })}
                          className={`w-28 rounded border px-1 py-0.5 text-right font-semibold dark:bg-zinc-800 ${c.origenPrecio === "manual" ? "border-sky-300 dark:border-sky-700" : "border-zinc-200 dark:border-zinc-700"}`} />
                        {l.precioManual !== null && c.cand && <button onClick={() => upd(l.id, { precioManual: null })} className="block w-full text-right text-[10px] text-zinc-400 hover:text-orange-600">volver al de la IA</button>}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2 text-right ${c.bajoMinimo ? "font-semibold text-red-600" : ""}`}>{c.margen !== null ? `${c.margen.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%` : "—"}</td>
                      <td className="px-2 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${COLOR_SEMAFORO[c.semaforo]}`}>{TEXTO_SEMAFORO[c.semaforo]}</span><span className="mt-0.5 block text-[10px] text-zinc-400">{TEXTO_CONFIANZA[l.confianza]}</span></td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => { if (abierto === l.id) setAbierto(null); else { setAbierto(l.id); setBusq(l.descripcion); } }} className={`flex items-center gap-1 whitespace-nowrap rounded border px-2 py-1 ${abierto === l.id ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30" : "border-zinc-200 text-zinc-600 hover:border-orange-400 dark:border-zinc-700 dark:text-zinc-300"}`}>
                          <Search className="h-3.5 w-3.5" /> {abierto === l.id ? "Cerrar" : "Buscar"}
                        </button>
                      </td>
                    </tr>
                    {abierto === l.id && <tr className="bg-orange-50/60 dark:bg-orange-950/20"><td colSpan={9} className="px-3 py-2">
                      <div className="mb-2 flex items-center gap-2">
                        <Search className="h-4 w-4 text-orange-500" />
                        <input autoFocus value={busq} onChange={e => setBusq(e.target.value)} placeholder="Palabras, código o proveedor" className="min-w-[260px] flex-1 rounded border border-orange-300 px-2 py-1 text-xs dark:border-orange-800 dark:bg-zinc-800 dark:text-white" />
                        {cargandoBusq && <Loader2 className="h-4 w-4 animate-spin text-orange-500" />}
                        <span className="text-[10px] text-zinc-500">{resultados.length} resultados · clic para elegir</span>
                      </div>
                      <div className="max-h-64 overflow-auto rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                        {resultados.map((r, j) => {
                          const cp = convertirAMonedaPR(r.costo, r.moneda, moneda, tc, tcDivisas);
                          return <button key={r.id} onClick={() => elegirResultado(l.id, r)} className={`grid w-full grid-cols-[150px_110px_1fr_110px] gap-2 border-b border-zinc-100 px-2 py-1.5 text-left text-xs hover:bg-orange-100 dark:border-zinc-800 dark:hover:bg-orange-900/30 ${j % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""}`}>
                            <span className="truncate font-medium">{r.proveedor}</span><span className="truncate text-zinc-500">{r.codigo_interno || r.codigo}</span>
                            <span className="truncate" title={r.descripcion}>{r.descripcion}</span>
                            <span className="text-right">{fmt(r.costo, r.moneda)}{cp !== null && r.moneda.toUpperCase().startsWith("USD") !== (moneda === "USD") ? <span className="block text-[10px] text-zinc-400">≈ {fmt(cp, moneda)}</span> : null}</span>
                          </button>;
                        })}
                        {!cargandoBusq && busq.trim().length >= 2 && !resultados.length && <p className="p-3 text-center text-xs text-zinc-400">Sin resultados. Probá con menos palabras o con el código.</p>}
                      </div>
                    </td></tr>}
                  </Fragment>
                ))}
                {!visibles.length && <tr><td colSpan={9} className="p-6 text-center text-xs text-zinc-400">Todo está listo: no hay renglones para revisar.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Pie */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">
              {incluidas.length} renglones · Total sin IVA: <b className="text-zinc-800 dark:text-white">{fmt(totales.venta, moneda)}</b>
              {totales.margen !== null && <> · Margen sobre costo: <b className={totales.margen < MARGEN_MINIMO_IA ? "text-red-600" : "text-zinc-800 dark:text-white"}>{totales.margen.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</b></>}
            </div>
            <div className="flex gap-2">
              <button onClick={reiniciar} disabled={guardando || ocupado} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Empezar de nuevo</button>
              <button onClick={() => void crear()} disabled={guardando || ocupado || !incluidas.length} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Crear presupuesto
              </button>
            </div>
          </div>
        </>}
        </>}
      </div>
    </div>
  );
}
