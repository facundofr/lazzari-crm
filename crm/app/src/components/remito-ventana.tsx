"use client";

/**
 * Ventana única de remitos (pedido de Augusto 16/10/2026): la misma desde el PR ("Remitar"), desde Remitos ("Nuevo remito")
 * y para editar un remito ya hecho.
 * - Desde Remitos deja elegir "Desde un PR" (buscador) o "Remito independiente" (cliente + renglones libres o del catálogo).
 * - Sucursal (una para todo el remito; "repartir en varias sucursales" = un remito por sucursal).
 * - OC del cliente a la vista, editable; si cambia, pregunta si es solo para el remito o también corrige el PR.
 *   Si el remito anterior del PR usó otra OC, avisa con un clic para usarla.
 * - Cantidad por artículo: arranca con lo que falta entregar y muestra cuánto llegó del proveedor. Pasarse = aviso, nunca bloquea.
 * - Tipo: Remito R (con CAI) / Sin CAI / Muestra. Valor declarado en 0 con sugerencia (precio de venta sin IVA de lo remitido).
 * - Al terminar: Descargar PDF / Enviar por mail.
 * Lógica pura en lib/remitos-crear.ts y lib/remitos-armado.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { Autocompletar } from "@/components/ui/autocompletar";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { renglonesParaEntregar } from "@/lib/remitos-armado";
import { valorSugerido, excesos, agruparPorSucursal, ocAnteriorDistinta, numeroCAI, nombrePDFRemito, type RenglonVentana } from "@/lib/remitos-crear";
import { buscarCandidatos, type CatalogoCandidato } from "@/lib/catalogo-busqueda";
import { abrirRemitoPDF, remitoPDFBase64 } from "@/lib/remito-pdf";
import { AlertTriangle, Download, FileText, Loader2, Mail, Plus, Sparkles, Trash2, Truck, X } from "lucide-react";

const db = supabase as any;
// "remitido" no existe en la base (enum pr_status): pedirlo hace fallar la consulta.
const ESTADOS_PR_REMITO = ["aprobado", "facturar", "facturado"];
const inputCls = "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";
const esUSD = (m: string | null | undefined) => String(m || "").toUpperCase().startsWith("USD");

type Tipo = "cai" | "sincai" | "muestra";
type Renglon = RenglonVentana & { pedido: number | null; remitido: number | null; disponible: number | null };
type PRCab = { id: string; numero: string; cliente_id: string; cliente: string; sucursal_id: string | null; modalidad_emision: string | null; oc_cliente: string | null; moneda: string | null; estado: string };
type Sucursal = { id: string; nombre: string; direccion: string | null; localidad: string | null };
type RemitoEdit = { id: string; numero: string; presupuesto_id: string | null; tipo_remito: string | null; cai_numero: string | null; punto_venta_cai: number | null; nro_comprobante_cai: number | null; cae: string | null };
type Hecho = { id: string; numero: string; cai: string | null };

export interface RemitoVentanaProps {
  open: boolean;
  onClose: () => void;
  /** PR fijo: "Remitar" desde Presupuestos. */
  prId?: string | null;
  /** Remito a editar. */
  remitoId?: string | null;
  /** Se llama después de guardar (para recargar la lista). */
  onGuardado?: (remitoIds: string[]) => void;
}

let claveN = 0;
const nuevaClave = () => `r${++claveN}`;

/** Campo de artículo del remito independiente: busca en la lista de costos; si no está, queda el texto libre. */
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
      try { setResultados(await buscarCandidatos(q, "", 10)); } catch { setResultados([]); }
      setBuscando(false);
    }, 350);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div className="relative w-full">
      <input value={value} onChange={(e) => { onTexto(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 180)}
        placeholder="Artículo (se busca en la lista) o texto libre" className={`${inputCls} w-full`} />
      {buscando && <Loader2 className="absolute right-2 top-1.5 h-4 w-4 animate-spin text-orange-500" />}
      {abierto && resultados.length > 0 && value.trim().length >= 3 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {resultados.map((c) => (
            <button key={c.id} type="button" onMouseDown={(e) => { e.preventDefault(); onElegir(c); setAbierto(false); }} className="block w-full border-b border-zinc-100 px-2 py-1 text-left text-xs hover:bg-orange-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-orange-900/20">
              <span className="font-medium">{c.descripcion}</span>
              <span className="block text-[10px] text-zinc-500">{c.codigo_interno || c.codigo} · venta {formatCurrency(c.precio_venta, esUSD(c.moneda) ? "USD" : "ARS")} + IVA</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RemitoVentana({ open, onClose, prId, remitoId, onGuardado }: RemitoVentanaProps) {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id || null;
  const editando = !!remitoId;

  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [modo, setModo] = useState<"pr" | "libre">("pr");
  const [prsBuscables, setPrsBuscables] = useState<{ id: string; numero: string; cliente: string; oc: string | null; estado: string }[]>([]);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string; cuit: string | null }[]>([]);

  const [pr, setPr] = useState<PRCab | null>(null);
  const [clienteId, setClienteId] = useState<string>("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursal, setSucursal] = useState<string>("");
  const [repartir, setRepartir] = useState(false);
  const [oc, setOc] = useState("");
  const [ocAnterior, setOcAnterior] = useState<string | null>(null);
  const [ocDonde, setOcDonde] = useState<"remito" | "pr" | null>(null);
  /** OC con la que se abrió la ventana (la del PR, o la del remito al editar): solo se pregunta si se cambia. */
  const [ocInicial, setOcInicial] = useState("");
  const [fecha, setFecha] = useState(todayAR());
  const [tipo, setTipo] = useState<Tipo>("cai");
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [valor, setValor] = useState("0");
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [original, setOriginal] = useState<RemitoEdit | null>(null);
  const [hechos, setHechos] = useState<Hecho[] | null>(null);
  const [mail, setMail] = useState<{ remitoId: string; to: string; subject: string; body: string; filename: string } | null>(null);

  // ── Carga al abrir ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setError(""); setHechos(null); setPr(null); setClienteId(""); setClienteNombre(""); setSucursales([]); setSucursal(""); setRepartir(false);
    setOc(""); setOcInicial(""); setOcAnterior(null); setOcDonde(null); setFecha(todayAR()); setTipo("cai"); setRenglones([]); setObservaciones(""); setValor("0");
    setMoneda("ARS"); setOriginal(null); setModo("pr");
    if (!sociedadId) return;
    (async () => {
      setCargando(true);
      try {
        if (remitoId) await cargarRemito(remitoId);
        else if (prId) await cargarPR(prId, null);
        else await cargarListas();
      } catch (e: any) {
        setError(e?.message || "No se pudo cargar");
      } finally {
        setCargando(false);
      }
    })();
  }, [open, prId, remitoId, sociedadId]);

  async function cargarListas() {
    const [{ data: prs }, { data: cls }] = await Promise.all([
      db.from("presupuestos").select("id, numero, estado, oc_cliente, clientes(razon_social)").eq("sociedad_id", sociedadId).in("estado", ESTADOS_PR_REMITO).order("created_at", { ascending: false }).limit(1000),
      db.from("clientes").select("id, razon_social, cuit, activo").eq("sociedad_id", sociedadId).order("razon_social"),
    ]);
    setPrsBuscables((prs || []).map((p: any) => ({ id: p.id, numero: p.numero, cliente: p.clientes?.razon_social || "", oc: p.oc_cliente, estado: p.estado })));
    setClientes((cls || []).filter((c: any) => c.activo !== false).map((c: any) => ({ id: c.id, razon_social: c.razon_social, cuit: c.cuit })));
  }

  async function cargarSucursales(cid: string) {
    const { data } = await db.from("cliente_sucursales").select("id, nombre, direccion, localidad").eq("cliente_id", cid).eq("activo", true).order("principal", { ascending: false });
    setSucursales((data || []) as Sucursal[]);
    return (data || []) as Sucursal[];
  }

  /** Carga el PR con lo que falta entregar. Si se edita un remito, sus cantidades no cuentan como ya remitidas. */
  async function cargarPR(id: string, excluirRemito: string | null): Promise<{ cab: PRCab; renglones: Renglon[] }> {
    const [{ data: p, error: e1 }, { data: items }, { data: rems }, { data: ocs }] = await Promise.all([
      db.from("presupuestos").select("id, numero, cliente_id, sucursal_id, modalidad_emision, oc_cliente, moneda, estado, clientes(razon_social)").eq("id", id).eq("sociedad_id", sociedadId).single(),
      db.from("presupuesto_items").select("id, descripcion, cantidad, unidad, orden, precio_venta").eq("presupuesto_id", id).order("orden"),
      db.from("remitos").select("id, fecha, created_at, oc_cliente").eq("presupuesto_id", id),
      db.from("ordenes_compra").select("id, estado").eq("presupuesto_origen_id", id).eq("sociedad_id", sociedadId),
    ]);
    if (e1 || !p) throw e1 || new Error("No se encontró el PR");
    const otros = (rems || []).filter((r: any) => r.id !== excluirRemito);
    const [{ data: rItems }, { data: ocItems }] = await Promise.all([
      otros.length ? db.from("remito_items").select("presupuesto_item_id, descripcion, orden, cantidad").in("remito_id", otros.map((r: any) => r.id)) : Promise.resolve({ data: [] }),
      (ocs || []).length ? db.from("orden_compra_items").select("orden_id, presupuesto_item_id, cantidad, cantidad_recibida").in("orden_id", ocs.map((o: any) => o.id)) : Promise.resolve({ data: [] }),
    ]);
    const estadoOC: Record<string, string> = Object.fromEntries((ocs || []).map((o: any) => [o.id, o.estado]));
    const base = renglonesParaEntregar(items || [], rItems || [], (ocItems || []).map((o: any) => ({ ...o, estado_oc: estadoOC[o.orden_id] })), ocs || []);
    const precioDe: Record<string, number | null> = Object.fromEntries((items || []).map((it: any) => [it.id, it.precio_venta != null ? Number(it.precio_venta) : null]));
    const cab: PRCab = { id: p.id, numero: p.numero, cliente_id: p.cliente_id, cliente: p.clientes?.razon_social || "", sucursal_id: p.sucursal_id, modalidad_emision: p.modalidad_emision, oc_cliente: p.oc_cliente, moneda: p.moneda, estado: p.estado };
    const rs: Renglon[] = base.map((b) => ({
      key: nuevaClave(), presupuesto_item_id: b.presupuesto_item_id, descripcion: b.descripcion, unidad: b.unidad, orden: b.orden,
      cantidad: b.pendiente, pendiente: b.pendiente, precio: precioDe[b.presupuesto_item_id] ?? null, sucursal_id: p.sucursal_id || null,
      pedido: b.pedido, remitido: b.remitido, disponible: b.disponible,
    }));
    setPr(cab);
    setModo("pr");
    setClienteId(p.cliente_id); setClienteNombre(cab.cliente);
    setMoneda(esUSD(p.moneda) ? "USD" : "ARS");
    setOc(p.oc_cliente || "");
    setOcInicial(p.oc_cliente || "");
    setOcAnterior(ocAnteriorDistinta(p.oc_cliente, otros));
    setOcDonde(null);
    setTipo(p.modalidad_emision === "manual" ? "sincai" : "cai");
    const sucs = p.cliente_id ? await cargarSucursales(p.cliente_id) : [];
    setSucursal(p.sucursal_id && sucs.some((s) => s.id === p.sucursal_id) ? p.sucursal_id : (sucs[0]?.id || ""));
    setRenglones(rs);
    if (!rs.some((r) => (r.pendiente || 0) > 0) && !excluirRemito) setError("Este PR ya está todo remitido. Si igual tenés que mandar algo, cargá las cantidades.");
    else setError("");
    return { cab, renglones: rs };
  }

  async function cargarRemito(id: string) {
    const [{ data: r, error: e1 }, { data: its }] = await Promise.all([
      db.from("remitos").select("id, numero, cliente_id, presupuesto_id, fecha, observaciones, valor_declarado, sucursal_id, oc_cliente, tipo_remito, cai_numero, punto_venta_cai, nro_comprobante_cai, cae, clientes(razon_social)").eq("id", id).eq("sociedad_id", sociedadId).single(),
      db.from("remito_items").select("descripcion, cantidad, unidad, orden, presupuesto_item_id").eq("remito_id", id).order("orden"),
    ]);
    if (e1 || !r) throw e1 || new Error("No se encontró el remito");
    setOriginal({ id: r.id, numero: r.numero, presupuesto_id: r.presupuesto_id, tipo_remito: r.tipo_remito, cai_numero: r.cai_numero, punto_venta_cai: r.punto_venta_cai, nro_comprobante_cai: r.nro_comprobante_cai, cae: r.cae });
    let rs: Renglon[] = [];
    if (r.presupuesto_id) {
      const cargado = await cargarPR(r.presupuesto_id, r.id);
      const enRemito: Record<string, number> = {};
      for (const it of its || []) if (it.presupuesto_item_id) enRemito[it.presupuesto_item_id] = (enRemito[it.presupuesto_item_id] || 0) + Number(it.cantidad);
      rs = cargado.renglones.map((x) => ({ ...x, cantidad: enRemito[x.presupuesto_item_id || ""] || 0 }));
    } else {
      setModo("libre");
      setClienteId(r.cliente_id); setClienteNombre(r.clientes?.razon_social || "");
      if (r.cliente_id) await cargarSucursales(r.cliente_id);
    }
    // Renglones libres del remito (sin renglón del PR).
    for (const it of its || []) {
      if (it.presupuesto_item_id && rs.some((x) => x.presupuesto_item_id === it.presupuesto_item_id)) continue;
      rs.push({ key: nuevaClave(), presupuesto_item_id: null, descripcion: it.descripcion, unidad: it.unidad || "UN", orden: it.orden ?? rs.length, cantidad: Number(it.cantidad), pendiente: null, precio: null, sucursal_id: null, pedido: null, remitido: null, disponible: null });
    }
    setRenglones(rs);
    setFecha(r.fecha || todayAR());
    setObservaciones(r.observaciones || "");
    setValor(String(r.valor_declarado ?? 0));
    setOc(r.oc_cliente || "");
    setOcInicial(r.oc_cliente || "");
    setSucursal(r.sucursal_id || "");
    setTipo(r.tipo_remito === "muestra" ? "muestra" : r.cai_numero ? "cai" : "sincai");
    setError("");
  }

  async function elegirCliente(cid: string) {
    const c = clientes.find((x) => x.id === cid);
    setClienteId(cid); setClienteNombre(c?.razon_social || "");
    const sucs = await cargarSucursales(cid);
    setSucursal(sucs[0]?.id || "");
    if (!renglones.length) agregarRenglon();
  }

  function agregarRenglon() {
    setRenglones((prev) => [...prev, { key: nuevaClave(), presupuesto_item_id: null, descripcion: "", unidad: "UN", orden: prev.length, cantidad: 1, pendiente: null, precio: null, sucursal_id: sucursal || null, pedido: null, remitido: null, disponible: null }]);
  }
  const cambiar = (key: string, cambios: Partial<Renglon>) => setRenglones((prev) => prev.map((r) => (r.key === key ? { ...r, ...cambios } : r)));

  function cantidadesRapidas(modoCant: "falta" | "llego") {
    setRenglones((prev) => prev.map((r) => (r.pendiente == null ? r : { ...r, cantidad: modoCant === "falta" ? r.pendiente : Math.min(r.pendiente, r.disponible ?? 0) })));
  }

  // ── Cuentas (lib/remitos-crear) ──────────────────────────────────
  const conCantidad = useMemo(() => renglones.filter((r) => Number(r.cantidad) > 0 && r.descripcion.trim()), [renglones]);
  const sugerido = useMemo(() => valorSugerido(conCantidad), [conCantidad]);
  const sinPrecio = conCantidad.some((r) => r.precio == null);
  const avisosExceso = useMemo(() => excesos(renglones), [renglones]);
  const avisoExceso = new Set(avisosExceso.map((e) => e.key));
  const hayLlegada = renglones.some((r) => r.disponible != null);
  const ocCambiada = !!pr && oc.trim() !== (pr.oc_cliente || "").trim() && oc.trim() !== ocInicial.trim();
  const sucNombre = (id: string | null) => sucursales.find((s) => s.id === id)?.nombre || "";
  const cantidadRemitos = repartir && sucursales.length > 1 ? agruparPorSucursal(conCantidad, true, null).length : 1;

  // ── Guardar ──────────────────────────────────────────────────────
  async function guardar() {
    if (!sociedadId) { setError("Elegí una sociedad"); return; }
    if (!clienteId) { setError("Elegí el cliente"); return; }
    if (!conCantidad.length) { setError("Poné al menos una cantidad (y la descripción en los renglones libres)"); return; }
    if (ocCambiada && !ocDonde) { setError("Contestá dónde va la OC: solo en este remito o también en el PR"); return; }
    setError("");
    setGuardando(true);
    try {
      const ids = editando ? await guardarEdicion() : await crearRemitos();
      if (!ids) return;
      if (ocCambiada && ocDonde === "pr" && pr) {
        const { error: eOc } = await db.from("presupuestos").update({ oc_cliente: oc.trim() || null }).eq("id", pr.id).eq("sociedad_id", sociedadId);
        if (eOc) toast.warning(`El remito quedó, pero la OC del PR no se pudo corregir (${eOc.message})`);
      }
      onGuardado?.(ids.map((h) => h.id));
      setHechos(ids);
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const itemsDe = (rs: Renglon[], remito: string) => rs.map((r, i) => ({
    remito_id: remito, descripcion: r.descripcion.trim(), cantidad: Number(r.cantidad), unidad: r.unidad || "UN", orden: r.orden ?? i, presupuesto_item_id: r.presupuesto_item_id,
  }));

  async function crearRemitos(): Promise<Hecho[] | null> {
    const grupos = agruparPorSucursal(conCantidad, repartir && sucursales.length > 1, sucursal || null);
    const valorTotal = Number(valor) || 0;
    const hechosAhora: Hecho[] = [];
    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      // Valor declarado repartido según lo que vale cada parte (si no hay precios, todo en el primero).
      const sugGrupo = valorSugerido(g.renglones);
      const valorGrupo = grupos.length === 1 ? valorTotal : sugerido > 0 ? Math.round((valorTotal * sugGrupo / sugerido) * 100) / 100 : gi === 0 ? valorTotal : 0;
      let cai: { cai_numero: string; punto_venta: number; nro_comprobante: number } | null = null;
      if (tipo === "cai") {
        const { data: caiRows, error: eCai } = await db.rpc("next_cai_number", { p_sociedad_id: sociedadId, p_tipo: "remito_r" });
        if (!eCai && caiRows?.length) cai = caiRows[0];
        else toast.warning("No hay números de CAI disponibles: el remito sale sin CAI");
      }
      const insert: Record<string, unknown> = {
        numero: null, cliente_id: clienteId, fecha, observaciones: observaciones.trim() || null,
        tipo_remito: tipo === "muestra" ? "muestra" : "interno", presupuesto_id: pr?.id || null, estado: "pendiente",
        valor_declarado: valorGrupo, sociedad_id: sociedadId, sucursal_id: g.sucursal_id, created_by: profile?.id || null, oc_cliente: oc.trim() || null,
      };
      if (cai) { insert.cai_numero = cai.cai_numero; insert.punto_venta_cai = cai.punto_venta; insert.nro_comprobante_cai = cai.nro_comprobante; }
      const { data: rem, error: e1 } = await db.from("remitos").insert(insert).select("id, numero").single();
      if (e1 || !rem) { setError(`No se pudo crear el remito: ${e1?.message || "sin datos"}`); break; }
      const { error: e2 } = await db.from("remito_items").insert(itemsDe(g.renglones, rem.id));
      if (e2) {
        await db.from("remitos").delete().eq("id", rem.id).eq("sociedad_id", sociedadId);
        setError(`No se pudieron guardar los renglones (${e2.message}); no quedó el remito${cai ? `. El número de CAI ${cai.nro_comprobante} quedó usado` : ""}`);
        break;
      }
      hechosAhora.push({ id: rem.id, numero: rem.numero || "", cai: cai ? numeroCAI(cai.punto_venta, cai.nro_comprobante) : null });
    }
    if (!hechosAhora.length) return null;
    return hechosAhora;
  }

  async function guardarEdicion(): Promise<Hecho[] | null> {
    if (!original) return null;
    const { error: e1 } = await db.from("remitos").update({
      fecha, observaciones: observaciones.trim() || null, valor_declarado: Number(valor) || 0, sucursal_id: sucursal || null, oc_cliente: oc.trim() || null,
      cliente_id: clienteId,
    }).eq("id", original.id).eq("sociedad_id", sociedadId);
    if (e1) { setError(`No se pudo guardar: ${e1.message}`); return null; }
    // Renglones: se reemplazan por los de la ventana (los nuevos se cargan antes de sacar los viejos, así nunca queda vacío).
    const { data: viejos } = await db.from("remito_items").select("id").eq("remito_id", original.id);
    const { error: e2 } = await db.from("remito_items").insert(itemsDe(conCantidad, original.id));
    if (e2) { setError(`No se pudieron guardar los renglones: ${e2.message}`); return null; }
    if (viejos?.length) {
      const { error: e3 } = await db.from("remito_items").delete().in("id", viejos.map((v: any) => v.id));
      if (e3) { setError(`Quedaron renglones repetidos (${e3.message}): avisá a sistemas`); return null; }
    }
    return [{ id: original.id, numero: original.numero, cai: numeroCAI(original.punto_venta_cai, original.nro_comprobante_cai) }];
  }

  // ── PDF y mail del remito hecho ──────────────────────────────────
  async function pdf(id: string) {
    if (!sociedadActiva) return;
    try { await abrirRemitoPDF(id, sociedadActiva); } catch (e: any) { toast.error(`No se pudo armar el PDF: ${e?.message || "error"}`); }
  }
  async function abrirMail(h: Hecho) {
    if (!sociedadActiva) return;
    const template = await loadEmailTemplate("remito", sociedadActiva.id);
    const { data: cli } = clienteId ? await db.from("clientes").select("email").eq("id", clienteId).maybeSingle() : { data: null };
    const vars = { numero: h.cai || h.numero, sociedad: sociedadActiva.razonSocial || "Lazzari", fecha: formatDate(fecha), cliente: clienteNombre };
    setMail({ remitoId: h.id, to: cli?.email || "", subject: applyTemplateVars(template.asunto, vars), body: applyTemplateVars(template.cuerpo, vars), filename: nombrePDFRemito(h.cai || h.numero, clienteNombre) });
  }

  if (!open) return null;

  const titulo = editando ? `Editar remito ${numeroCAI(original?.punto_venta_cai, original?.nro_comprobante_cai) || original?.numero || ""}` : pr ? `Remitar — ${pr.numero}` : "Nuevo remito";
  const desdeRemitos = !prId && !remitoId;
  const tieneNumeroImpreso = editando && !!(original?.cai_numero || original?.cae);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={() => !guardando && onClose()} />
      <div className="fixed inset-x-2 top-4 bottom-4 z-50 mx-auto flex max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900 sm:inset-x-6">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
          <h3 className="flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-white"><Truck className="h-4 w-4 text-orange-500" />{titulo}</h3>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
        </div>

        {hechos ? (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="mb-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">{editando ? "Remito guardado" : hechos.length > 1 ? `Se hicieron ${hechos.length} remitos (uno por sucursal)` : "Remito hecho"}</p>
            {tieneNumeroImpreso && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">⚠️ Si ya lo habías impreso, el papel quedó distinto: volvé a descargar el PDF.</p>}
            <div className="space-y-2">
              {hechos.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                  <span className="font-mono text-sm font-bold dark:text-white">{h.cai || h.numero}</span>
                  <span className="text-xs text-zinc-500">{h.cai ? "Remito R (con CAI)" : "Sin CAI"}</span>
                  <span className="ml-auto flex gap-2">
                    <button onClick={() => pdf(h.id)} className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"><Download className="h-3.5 w-3.5" /> Descargar PDF</button>
                    <button onClick={() => abrirMail(h)} className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"><Mail className="h-3.5 w-3.5" /> Enviar por mail</button>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end"><button onClick={onClose} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600">Listo</button></div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
              {cargando && <div className="flex items-center gap-2 text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>}

              {tieneNumeroImpreso && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">⚠️ Este remito ya tiene número {original?.cae ? "de ARCA" : "de CAI"}. Podés cambiarlo, pero si ya lo imprimiste o lo mandaste, el papel va a quedar distinto al sistema. El número no cambia.</p>
              )}

              {/* Desde Remitos: elegir PR o remito independiente */}
              {desdeRemitos && !pr && modo === "pr" && !clienteId && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <span className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-medium text-white">Desde un PR</span>
                    <button onClick={() => setModo("libre")} className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">Remito independiente</button>
                  </div>
                  <Autocompletar className="w-full" mostrarSinEscribir placeholder="Buscá el PR por número, cliente u OC…"
                    opciones={prsBuscables.map((p) => ({ valor: p.id, texto: `${p.numero} · ${p.cliente}`, detalle: p.oc ? `OC ${p.oc}` : undefined }))}
                    onElegir={(id) => { setCargando(true); cargarPR(id, null).catch((e) => setError(e?.message || "No se pudo cargar el PR")).finally(() => setCargando(false)); }} />
                </div>
              )}
              {desdeRemitos && !pr && modo === "libre" && !clienteId && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button onClick={() => setModo("pr")} className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">Desde un PR</button>
                    <span className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-medium text-white">Remito independiente</span>
                  </div>
                  <Autocompletar className="w-full" placeholder="Cliente…" opciones={clientes.map((c) => ({ valor: c.id, texto: c.razon_social, detalle: c.cuit || undefined }))} onElegir={elegirCliente} />
                </div>
              )}

              {(pr || clienteId) && (
                <>
                  {/* Cabecera */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                    <label className="col-span-2 flex flex-col gap-0.5 text-[11px] text-zinc-500">Cliente
                      <span className="flex items-center gap-1 text-sm font-medium text-zinc-900 dark:text-white">
                        {clienteNombre}{pr && <span className="text-xs text-zinc-400">· {pr.numero}</span>}
                        {desdeRemitos && <button onClick={() => { setPr(null); setClienteId(""); setRenglones([]); setError(""); }} className="ml-1 text-[11px] text-orange-600 hover:underline">cambiar</button>}
                      </span>
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Fecha
                      <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Tipo
                      {editando ? (
                        <span className="py-1 text-sm text-zinc-800 dark:text-zinc-200">{tipo === "muestra" ? "Muestra" : original?.cai_numero ? `Remito R ${numeroCAI(original.punto_venta_cai, original.nro_comprobante_cai) || ""}` : "Sin CAI"}</span>
                      ) : (
                        <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={inputCls}>
                          <option value="cai">Remito R (con CAI)</option>
                          <option value="sincai">Sin CAI (interno)</option>
                          <option value="muestra">Muestra</option>
                        </select>
                      )}
                    </label>

                    <label className="col-span-2 flex flex-col gap-0.5 text-[11px] text-zinc-500">Sucursal
                      {sucursales.length === 0 ? <span className="py-1 text-sm text-zinc-400">Dirección principal (el cliente no tiene sucursales)</span> : repartir ? (
                        <span className="py-1 text-xs text-zinc-600 dark:text-zinc-300">Elegí la sucursal en cada renglón · salen {cantidadRemitos} remito(s) <button onClick={() => setRepartir(false)} className="text-orange-600 hover:underline">una sola</button></span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className={`${inputCls} flex-1`}>
                            <option value="">Dirección principal</option>
                            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.localidad ? ` · ${s.localidad}` : ""}</option>)}
                          </select>
                          {!editando && sucursales.length > 1 && <button onClick={() => { setRepartir(true); setRenglones((prev) => prev.map((r) => ({ ...r, sucursal_id: r.sucursal_id || sucursal || null }))); }} className="whitespace-nowrap text-[11px] text-orange-600 hover:underline">repartir en varias</button>}
                        </span>
                      )}
                    </label>
                    <label className="col-span-2 flex flex-col gap-0.5 text-[11px] text-zinc-500">OC del cliente
                      <span className="flex items-center gap-1">
                        <input value={oc} onChange={(e) => { setOc(e.target.value); setOcDonde(null); }} placeholder="Sin OC" className={`${inputCls} flex-1`} />
                        {oc && <button onClick={() => { setOc(""); setOcDonde(null); }} title="Sacar la OC" className="rounded p-1 text-zinc-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>}
                      </span>
                      {ocAnterior && ocAnterior !== oc.trim() && <span className="text-[11px] text-amber-700 dark:text-amber-400">En el remito anterior usaste <b>{ocAnterior}</b> · <button onClick={() => { setOc(ocAnterior); setOcDonde(null); }} className="text-orange-600 hover:underline">usar esa</button></span>}
                    </label>
                  </div>

                  {ocCambiada && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md bg-sky-50 px-3 py-1.5 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                      La OC es distinta a la del PR ({pr?.oc_cliente || "sin OC"}). ¿Dónde va?
                      <label className="flex items-center gap-1"><input type="radio" checked={ocDonde === "remito"} onChange={() => setOcDonde("remito")} /> Solo en este remito</label>
                      <label className="flex items-center gap-1"><input type="radio" checked={ocDonde === "pr"} onChange={() => setOcDonde("pr")} /> También corregir el PR</label>
                    </div>
                  )}

                  {/* Renglones */}
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Artículos</span>
                      {pr && <button onClick={() => cantidadesRapidas("falta")} className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Todo lo que falta</button>}
                      {pr && hayLlegada && <button onClick={() => cantidadesRapidas("llego")} className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Solo lo que llegó</button>}
                      {pr && <button onClick={() => setRenglones((prev) => prev.map((r) => ({ ...r, cantidad: 0 })))} className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Todo en 0</button>}
                      <button onClick={agregarRenglon} className="ml-auto flex items-center gap-1 text-[11px] text-orange-600 hover:underline"><Plus className="h-3 w-3" /> renglón libre</button>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase text-zinc-400">
                        <tr>
                          <th className="px-2 py-1 text-left">Artículo</th>
                          {pr && <th className="px-1 py-1 text-right" title="Lo que pidió el PR / lo que ya se remitió">Pedido</th>}
                          {pr && hayLlegada && <th className="px-1 py-1 text-right" title="Lo que llegó del proveedor y todavía no se remitió">Llegó</th>}
                          {pr && <th className="px-1 py-1 text-right">Falta</th>}
                          <th className="px-1 py-1 text-right">Remitar</th>
                          {repartir && <th className="px-1 py-1 text-left">Sucursal</th>}
                          <th className="w-6" />
                        </tr>
                      </thead>
                      <tbody>
                        {renglones.map((r) => (
                          <tr key={r.key} className={`border-t border-zinc-100 dark:border-zinc-800 ${Number(r.cantidad) > 0 ? "" : "opacity-50"}`}>
                            <td className="px-2 py-1">
                              {r.presupuesto_item_id ? <span className="text-zinc-800 dark:text-zinc-200">{r.descripcion}</span> : (
                                <ArticuloInput value={r.descripcion} onTexto={(t) => cambiar(r.key, { descripcion: t, precio: null })}
                                  onElegir={(c) => cambiar(r.key, { descripcion: c.descripcion, precio: !esUSD(c.moneda) === (moneda === "ARS") ? Number(c.precio_venta) : null })} />
                              )}
                              {avisoExceso.has(r.key) && <span className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> Más de lo que falta entregar ({r.pendiente})</span>}
                            </td>
                            {pr && <td className="px-1 py-1 text-right text-zinc-500">{r.pedido != null ? <>{r.pedido}{r.remitido ? <span className="text-zinc-400"> / {r.remitido}</span> : null}</> : "—"}</td>}
                            {pr && hayLlegada && <td className="px-1 py-1 text-right">{r.disponible == null ? <span className="text-zinc-300">—</span> : <span className={r.disponible >= (r.pendiente || 0) ? "text-emerald-600" : "text-amber-600"}>{r.disponible}</span>}</td>}
                            {pr && <td className="px-1 py-1 text-right text-zinc-500">{r.pendiente ?? "—"}</td>}
                            <td className="px-1 py-1 text-right">
                              <input type="number" min={0} step="any" value={r.cantidad === 0 ? "" : r.cantidad} placeholder="0" onChange={(e) => cambiar(r.key, { cantidad: Math.max(0, Number(e.target.value) || 0) })}
                                className={`${inputCls} w-20 text-right ${avisoExceso.has(r.key) ? "border-amber-400" : ""}`} />
                            </td>
                            {repartir && (
                              <td className="px-1 py-1">
                                <select value={r.sucursal_id || ""} onChange={(e) => cambiar(r.key, { sucursal_id: e.target.value || null })} className={`${inputCls} max-w-[150px] text-xs`}>
                                  <option value="">Dir. principal</option>
                                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                </select>
                              </td>
                            )}
                            <td className="px-1 py-1">{!r.presupuesto_item_id && <button onClick={() => setRenglones((prev) => prev.filter((x) => x.key !== r.key))} className="text-zinc-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                          </tr>
                        ))}
                        {!renglones.length && <tr><td colSpan={7} className="px-2 py-3 text-center text-zinc-400">Sin renglones: agregá uno con "renglón libre"</td></tr>}
                      </tbody>
                    </table>
                  </div>

                  {/* Pie: observaciones y valor declarado */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500 sm:col-span-2">Observaciones
                      <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} placeholder="Sale impreso en el remito" className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Valor declarado ({moneda === "USD" ? "US$" : "$"})
                      <input type="number" min={0} step="any" value={valor} onChange={(e) => setValor(e.target.value)} className={`${inputCls} text-right`} />
                      {sugerido > 0 && Number(valor) !== sugerido && (
                        <button onClick={() => setValor(String(sugerido))} className="flex items-center gap-1 self-end text-[11px] text-orange-600 hover:underline" title="Precio de venta sin IVA de lo que se remite">
                          <Sparkles className="h-3 w-3" /> Sugerido {formatCurrency(sugerido, moneda)} sin IVA{sinPrecio ? " (algún renglón sin precio)" : ""}
                        </button>
                      )}
                    </label>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
              {error && <span className="mr-auto text-xs text-red-600">{error}</span>}
              {!error && avisosExceso.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-400">⚠️ {avisosExceso.length} renglón(es) con más de lo que falta entregar (solo aviso)</span>}
              <button onClick={onClose} disabled={guardando} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
              <button onClick={guardar} disabled={guardando || cargando || !(pr || clienteId)} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {editando ? "Guardar cambios" : cantidadRemitos > 1 ? `Hacer ${cantidadRemitos} remitos` : "Hacer remito"}
              </button>
            </div>
          </>
        )}
      </div>

      {mail && (
        <EmailComposeModal
          open={!!mail}
          onClose={() => setMail(null)}
          documentType="remito"
          sociedadId={sociedadId || undefined}
          userEmail={profile?.email ? `${profile.full_name || "Lazzari"} <${profile.email}>` : undefined}
          defaultTo={mail.to}
          defaultSubject={mail.subject}
          defaultBody={mail.body}
          pdfFilename={mail.filename}
          generatePdf={async () => { if (!sociedadActiva) throw new Error("Elegí una sociedad"); return remitoPDFBase64(mail.remitoId, sociedadActiva); }}
        />
      )}
    </>
  );
}
