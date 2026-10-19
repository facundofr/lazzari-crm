"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { mockRemitos } from "@/lib/mock-data";
import { Truck, Loader2, CheckCircle2, X, Download, Copy, Check, ClipboardCopy, Mail, Plus, Link2, Trash2, Minus, ShieldCheck, GitBranch, MapPin, Maximize2, Search, Camera, Pencil } from "lucide-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { RemitoVentana } from "@/components/remito-ventana";
import { useToast } from "@/components/ui/toast";
import { abrirRemitoPDF, remitoPDFBase64, htmlRemito } from "@/lib/remito-pdf";
import { filaVigente, entregaGuardada, guardarEntrega, textoTransporte, type Entrega, type ModoEntrega, type FilaTransporte } from "@/lib/remito-entrega";
import { Select } from "@/components/ui/input";
import { numeroCAI, descripcionCorta, numeroRemito, nombrePDFRemito } from "@/lib/remitos-crear";
import { prepararArchivo } from "@/lib/preparar-foto";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatCurrency, todayAR } from "@/lib/utils";
import { generateRemitoPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64 } from "@/lib/pdf-templates";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-orange-500 transition-colors" title={label || "Copiar"}>
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {label && <span>{copied ? "Copiado" : label}</span>}
    </button>
  );
}
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";

const transporteEstadoConfig: Record<string, { label: string; variant: "success" | "warning" | "info" | "danger" }> = {
  solicitado: { label: "Solicitado", variant: "warning" },
  en_transito: { label: "En tránsito", variant: "info" },
  entregado: { label: "Entregado", variant: "success" },
  cancelado: { label: "Cancelado", variant: "danger" },
};

/** Tipo de remito según lo que realmente tiene: muestra, electrónico (ARCA), Remito R con CAI, manual (PR sin ARCA) o interno sin CAI. */
type TipoRemitoClave = "muestra" | "arca" | "cai" | "manual" | "interno";
function tipoRemitoClave(r: { tipo_remito?: string | null; cae?: string | null; cai_numero?: string | null; presupuesto_modalidad?: string | null }): TipoRemitoClave {
  // Los remitos de muestra salen como MANUAL (internos, sin CAI ni ARCA), pedido de Augusto 16/10/2026.
  if (r.tipo_remito === "muestra") return "manual";
  if (r.tipo_remito === "electronico" || r.cae) return "arca";
  if (r.cai_numero) return "cai";
  if (r.presupuesto_modalidad === "manual") return "manual";
  return "interno";
}
const TIPO_REMITO_TEXTO: Record<TipoRemitoClave, string> = { muestra: "Muestra", arca: "Electrónico (ARCA)", cai: "Remito R (CAI)", manual: "Manual (sin ARCA)", interno: "Interno sin CAI" };
const tipoRemitoTexto = (r: Parameters<typeof tipoRemitoClave>[0]) => (r.tipo_remito === "muestra" ? "Manual (muestra)" : TIPO_REMITO_TEXTO[tipoRemitoClave(r)]);

function remitoRequiereARCA(remito: Pick<RemitoRow, "observaciones" | "cae" | "tipo_remito">) {
  // Los remitos de muestras y los internos son constancias manuales. Solo se
  // ofrece autorización electrónica cuando el usuario eligió expresamente ARCA.
  return !remito.cae && (remito.tipo_remito === "electronico" || /Emisión:\s*ARCA/i.test(remito.observaciones || ""));
}

interface RemitoRow {
  id: string;
  sociedad_id?: string | null;
  numero: string;
  cliente_id: string;
  presupuesto_id: string | null;
  fecha: string;
  cae: string | null;
  car_vencimiento: string | null;
  nro_remito_afip: string | null;
  tipo_remito?: "interno" | "muestra" | "electronico" | null;
  estado: string;
  observaciones: string;
  valor_declarado: number | null;
  clientes: { razon_social: string; email?: string; cuit?: string; direccion?: string } | null;
  sucursal_nombre?: string;
  sucursal_direccion?: string;
  sucursal_id?: string;
  clienteNombre: string;
  oc_cliente?: string | null;
  presupuesto_numero?: string | null;
  presupuesto_modalidad?: string | null;
  ocs_numeros?: string[];
  remito_items: { id: string; descripcion?: string | null; orden?: number | null }[];
  transportistas?: string[];
  /** Valor del desplegable de la columna Transporte: "t:<id>", "propio", "retira" o "nose". */
  transporte_valor?: string;
  direccion_entrega_snapshot?: string | null;
  localidad_entrega_snapshot?: string | null;
  presupuesto_vendedor?: string | null;
  // Entrega (Remitos nueva): foto del remito firmado y quién recibió
  foto_url?: string | null;
  recibio?: string | null;
  entregado_at?: string | null;
  foto_ia?: { anotaciones?: string | null } | null;
  // CAI fields
  cai_numero?: string | null;
  punto_venta_cai?: number | null;
  nro_comprobante_cai?: number | null;
}

/** Texto y valor de la columna Transporte a partir de los viajes del remito. */
function columnaTransporte(r: { direccion_entrega_snapshot?: string | null }, filas: FilaTransporte[]) {
  const texto = textoTransporte(r, filas);
  const v = filaVigente(filas);
  const valor = v ? (v.tipo === "interno" ? "propio" : v.transportista_id ? `t:${v.transportista_id}` : "nose") : texto ? "retira" : "nose";
  return { transportistas: texto ? [texto] : [], transporte_valor: valor };
}

interface RemitoDetailItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  orden: number;
  presupuesto_item_id?: string | null;
}

interface TransporteLinked {
  id: string;
  transportista: string;
  estado: string;
  fecha: string;
  destino: string | null;
  costo: number | null;
  moneda: string;
}

interface CreateItem {
  tempId: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  sucursal_id?: string;
  presupuesto_item_id?: string | null;
  orden?: number;
}

interface Sucursal {
  id: string;
  nombre: string;
  direccion: string;
  localidad: string;
  provincia: string;
  cp: string;
}


export default function RemitosPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const [remitos, setRemitos] = useState<RemitoRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Ventana única de remitos (crear desde PR / independiente, y editar): components/remito-ventana
  const [ventana, setVentana] = useState<{ remitoId: string | null } | null>(null);
  // Foto del remito firmado subiéndose (id del remito)
  const [subiendoFoto, setSubiendoFoto] = useState<string | null>(null);
  const fotoInput = useRef<HTMLInputElement>(null);
  const fotoPara = useRef<RemitoRow | null>(null);
  // Detail panel
  const [detailRemito, setDetailRemito] = useState<RemitoRow | null>(null);
  const [detailItems, setDetailItems] = useState<RemitoDetailItem[]>([]);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [detailPRNumero, setDetailPRNumero] = useState<string | null>(null);
  // Por renglón del PR: cuánto pide el PR y cuánto se remitó en total (todos los remitos del PR).
  const [detailPRItems, setDetailPRItems] = useState<Record<string, { total: number; remitido: number }>>({});
  const [detailFacturas, setDetailFacturas] = useState<{ id: string; numero: string; tipo: string; total: number; estado: string }[]>([]);
  const [detailTransportes, setDetailTransportes] = useState<TransporteLinked[]>([]);
  const [detailOC, setDetailOC] = useState<{ id: string; numero: string } | null>(null);

  // PDF valor declarado modal
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfValorDeclarado, setPdfValorDeclarado] = useState("0");

  // Create transporte from remito
  const [createTransporteOpen, setCreateTransporteOpen] = useState(false);
  const [transporteForm, setTransporteForm] = useState({
    transportista_id: "",
    transportista: "",
    destino: "",
    origen: "",
    fecha: todayAR(),
    costo: "",
    moneda: "ARS" as "ARS" | "USD",
    bultos: "",
    tipo_vehiculo: "",
    notas: "",
  });
  const [creatingTransporte, setCreatingTransporte] = useState(false);
  const [catalogTransportistas, setCatalogTransportistas] = useState<{ id: string; nombre: string }[]>([]);


  // AFIP authorization
  const [autorizandoAFIP, setAutorizandoAFIP] = useState(false);
  const [afipError, setAfipError] = useState("");

  // Email compose modal
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailModalData, setEmailModalData] = useState<{ to: string; subject: string; body: string; filename: string; id: string }>({ to: "", subject: "", body: "", filename: "", id: "" });

  // Split existing remito modal
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitItems, setSplitItems] = useState<(RemitoDetailItem & { sucursal_id: string })[]>([]);
  const [splitSucursales, setSplitSucursales] = useState<Sucursal[]>([]);
  const [splittingSaving, setSplittingSaving] = useState(false);
  // Split por cantidad: cada item puede tener múltiples asignaciones de cantidad por sucursal
  const [splitAssignments, setSplitAssignments] = useState<{ itemId: string; sucursal_id: string; cantidad: number; descripcion: string; unidad: string; maxCantidad: number; orden: number; presupuesto_item_id?: string | null }[]>([]);

  // SmartFilters state
  const [smartFilterValues, setSmartFilterValues] = useState<FilterValues>({
    fecha: { from: "", to: "" },
    cliente: "",
    vinculado: "",
    tipo: "",
  });
  // Buscador de texto: N° de remito (también el de CAI), cliente, PR de origen y OC del cliente.
  const [busqueda, setBusqueda] = useState("");

  // Build unique client options from loaded remitos
  const clienteOptions = Array.from(new Set(remitos.map(r => r.clientes?.razon_social).filter(Boolean)))
    .sort()
    .map(name => ({ value: name!, label: name! }));

  const smartFilterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    {
      key: "tipo",
      label: "Tipo",
      type: "select",
      options: [
        { value: "cai", label: "Remito R (CAI)" },
        { value: "manual", label: "Manual (PR sin ARCA o muestra)" },
        { value: "interno", label: "Interno sin CAI" },
        { value: "arca", label: "Electrónico (ARCA)" },
      ],
    },
    {
      key: "cliente",
      label: "Cliente",
      type: "search-select",
      options: clienteOptions,
      placeholder: "Buscar cliente...",
    },
    {
      key: "vinculado",
      label: "Vinculado a PR",
      type: "select",
      options: [
        { value: "si", label: "Sí" },
        { value: "no", label: "No" },
      ],
    },
  ];

  const fetchData = useCallback(async () => {
      try {
        let q = (supabase as any)
          .from("remitos")
          .select(`*, clientes(razon_social, email, cuit, direccion), presupuestos(numero, modalidad_emision, vendedor_id, created_by), remito_items(id, descripcion, orden)`)
          .order("fecha", { ascending: false });

        if (!sociedadActiva?.id) { setRemitos([]); return; }
        q = q.eq("sociedad_id" as any, sociedadActiva.id);

        const { data, error } = await q;

        if (!error && data) {
          // N° de las OC (nuestras) de cada PR: una consulta por tandas.
          const ocsPorPR = new Map<string, string[]>();
          try {
            const prIds = [...new Set((data as any[]).map(r => r.presupuesto_id).filter(Boolean))] as string[];
            for (let i = 0; i < prIds.length; i += 150) {
              const { data: ocs } = await (supabase as any).from("ordenes_compra").select("numero, presupuesto_origen_id").in("presupuesto_origen_id", prIds.slice(i, i + 150)).eq("sociedad_id", sociedadActiva.id).neq("estado", "cancelada").order("numero");
              for (const o of ocs || []) ocsPorPR.set(o.presupuesto_origen_id, [...(ocsPorPR.get(o.presupuesto_origen_id) || []), o.numero]);
            }
          } catch { /* sin OC: la columna queda vacía */ }
          // Nombre de la sucursal y transportista de cada remito (para la lista y el buscador).
          const sucNombre = new Map<string, string>();
          const transPorRemito = new Map<string, any[]>();
          try {
            const sucIds = [...new Set((data as any[]).map(r => r.sucursal_id).filter(Boolean))] as string[];
            const remIds = (data as any[]).map(r => r.id) as string[];
            for (let i = 0; i < sucIds.length; i += 150) {
              const { data: sucs } = await (supabase as any).from("cliente_sucursales").select("id, nombre").in("id", sucIds.slice(i, i + 150));
              for (const s of sucs || []) sucNombre.set(s.id, s.nombre);
            }
            for (let i = 0; i < remIds.length; i += 150) {
              const { data: ts } = await (supabase as any).from("transportes").select("id, remito_id, transportista, transportista_id, tipo, estado, destino, costo, created_at").in("remito_id", remIds.slice(i, i + 150));
              for (const t of ts || []) transPorRemito.set(t.remito_id, [...(transPorRemito.get(t.remito_id) || []), t]);
            }
          } catch { /* sin sucursal ni transporte: quedan vacíos */ }
          setRemitos((data as any[]).map(r => ({ ...r, clienteNombre: r.clientes?.razon_social || "", presupuesto_numero: r.presupuestos?.numero || null, presupuesto_modalidad: r.presupuestos?.modalidad_emision || null, presupuesto_vendedor: r.presupuestos?.vendedor_id || r.presupuestos?.created_by || null, ocs_numeros: ocsPorPR.get(r.presupuesto_id) || [], sucursal_nombre: r.sucursal_id ? sucNombre.get(r.sucursal_id) : undefined, ...columnaTransporte(r, transPorRemito.get(r.id) || []) })) as RemitoRow[]);
        } else if (error) {
          setRemitos(mockRemitos.map((r) => ({
            id: r.id, numero: r.numero, cliente_id: r.clienteId,
            presupuesto_id: r.presupuestoId || null, fecha: r.fecha,
            cae: r.cae || null, car_vencimiento: null, nro_remito_afip: null, estado: r.estado, observaciones: r.observaciones,
            tipo_remito: null, valor_declarado: null,
            clientes: { razon_social: r.clienteNombre },
            clienteNombre: r.clienteNombre,
            remito_items: r.items.map((i) => ({ id: i.id })),
          })));
        }
      } catch {
        setRemitos(mockRemitos.map((r) => ({
          id: r.id, numero: r.numero, cliente_id: r.clienteId,
          presupuesto_id: r.presupuestoId || null, fecha: r.fecha,
          cae: r.cae || null, car_vencimiento: null, nro_remito_afip: null, estado: r.estado, observaciones: r.observaciones,
          tipo_remito: null, valor_declarado: null,
          clientes: { razon_social: r.clienteNombre },
          clienteNombre: r.clienteNombre,
          remito_items: r.items.map((i) => ({ id: i.id })),
        })));
      } finally {
        setLoading(false);
      }
  }, [sociedadActiva?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Columna Transporte: se cambia con un clic (mismo guardado que la ventana del remito).
  const [listaTransp, setListaTransp] = useState<{ id: string; nombre: string }[]>([]);
  const [editTransp, setEditTransp] = useState<string | null>(null);
  useEffect(() => {
    if (!sociedadActiva?.id) return;
    (supabase as any).from("transportistas").select("id, nombre").eq("activo", true).or(`sociedad_id.eq.${sociedadActiva.id},sociedad_id.is.null`).order("nombre")
      .then(({ data }: any) => setListaTransp(data || []));
  }, [sociedadActiva?.id]);
  const opcionesTransp = useMemo(() => [{ value: "nose", label: "Todavía no sé" }, { value: "retira", label: "Lo retira el cliente" }, { value: "propio", label: "Lo llevamos nosotros" }, ...listaTransp.map((t) => ({ value: `t:${t.id}`, label: t.nombre }))], [listaTransp]);
  async function cambiarTransporte(row: RemitoRow, v: string) {
    setEditTransp(null);
    if (!sociedadActiva?.id || v === row.transporte_valor) return;
    const { data: filas } = await (supabase as any).from("transportes").select("id, transportista, transportista_id, tipo, estado, destino, costo, created_at").eq("remito_id", row.id).eq("sociedad_id", sociedadActiva.id);
    const vigente = filaVigente(filas || []);
    const base = entregaGuardada({ direccion_entrega_snapshot: row.direccion_entrega_snapshot ?? null, localidad_entrega_snapshot: row.localidad_entrega_snapshot ?? null, transportista_id: null }, vigente, { modo: "nose", transportista_id: null, domicilio: "", localidad: "", costo: "" });
    // Sin domicilio guardado (remito viejo, o venía de "Retira el cliente"): el de la sucursal.
    if (!base.domicilio && !base.localidad && row.sucursal_id) {
      const { data: s } = await (supabase as any).from("cliente_sucursales").select("direccion, localidad").eq("id", row.sucursal_id).maybeSingle();
      if (s) { base.domicilio = s.direccion || ""; base.localidad = s.localidad || ""; }
    }
    const e: Entrega = v.startsWith("t:") ? { ...base, modo: "transporte", transportista_id: v.slice(2) } : { ...base, modo: v as ModoEntrega, transportista_id: null };
    // "Retira" pisa el domicilio solo en el remito; si después se elige un transporte y no había domicilio, el PDF usa el de la sucursal.
    const aviso = await guardarEntrega(supabase, e, { sociedad_id: sociedadActiva.id, cliente_id: row.cliente_id, remito_id: row.id, fecha: row.fecha, created_by: profile?.id || null, sucursal_id: row.sucursal_id || null }, (id) => listaTransp.find((t) => t.id === id)?.nombre || null, null);
    if (aviso) toast.warning(aviso);
    const [{ data: r2 }, { data: f2 }] = await Promise.all([
      (supabase as any).from("remitos").select("direccion_entrega_snapshot, localidad_entrega_snapshot").eq("id", row.id).single(),
      (supabase as any).from("transportes").select("id, transportista, transportista_id, tipo, estado, destino, costo, created_at").eq("remito_id", row.id),
    ]);
    setRemitos((prev) => prev.map((x) => (x.id === row.id ? { ...x, ...(r2 || {}), ...columnaTransporte({ ...x, ...(r2 || {}) }, f2 || []) } : x)));
  }

  /** PDF del remito desde la lista (el mismo que el del detalle). */
  async function pdfDeFila(row: RemitoRow) {
    if (!sociedadActiva) return;
    try { await abrirRemitoPDF(row.id, sociedadActiva); } catch (err) { toast.error(`No se pudo armar el PDF: ${err instanceof Error ? err.message : "error"}`); }
  }

  /**
   * Foto del remito firmado (no es obligatoria): se achica y se guarda en comprobantes/remitos/... (sin lectura de la IA).
   * Es solo comprobante: no cambia el estado (el remito se hace para entregar).
   * La primera foto le avisa al vendedor del PR.
   */
  async function subirFoto(r: RemitoRow, file: File) {
    if (!sociedadActiva?.id) return;
    setSubiendoFoto(r.id);
    try {
      const prep = await prepararArchivo(file);
      const ruta = `remitos/${sociedadActiva.id}/${r.id}-${Date.now()}.${prep.ext}`;
      const { error: eS } = await supabase.storage.from("comprobantes").upload(ruta, prep.blob, { contentType: prep.mediaType, upsert: false });
      if (eS) throw eS;
      const url = supabase.storage.from("comprobantes").getPublicUrl(ruta).data.publicUrl;
      const cambios: Record<string, unknown> = { foto_url: url };
      const primera = !r.foto_url;
      const { error } = await (supabase as any).from("remitos").update(cambios).eq("id", r.id).eq("sociedad_id", sociedadActiva.id);
      if (error) throw error;
      if (primera && r.presupuesto_vendedor && r.presupuesto_vendedor !== profile?.id) {
        await (supabase as any).from("alertas").insert({
          tipo: "seguimiento", title: `Remito firmado: ${r.presupuesto_numero || r.numero}`,
          description: `${profile?.full_name || "Alguien"} subió el remito firmado ${r.numero} de ${r.clienteNombre}`,
          entity_id: r.id, entity_type: "remito", module: "remitos", user_id: r.presupuesto_vendedor, sociedad_id: sociedadActiva.id,
        }).then(() => {}, () => {});
      }
      toast.success(`Foto guardada en ${r.numero}`);
      await fetchData();
    } catch (err) {
      toast.error(`No se pudo subir la foto: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setSubiendoFoto(null);
    }
  }

  async function handleDeleteRemito(id: string) {
    if (!confirm("¿Seguro que querés eliminar este remito? Esta acción no se puede deshacer.")) return;
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de eliminar el remito"); return; }
    const selectedRemito = remitos.find((remito) => remito.id === id);
    if (selectedRemito && selectedRemito.sociedad_id && selectedRemito.sociedad_id !== sociedadActiva.id) {
      alert("El remito no pertenece a la sociedad activa"); return;
    }
    try {
      const { error: itemsErr } = await (supabase as any).from("remito_items").delete().eq("remito_id", id);
      if (itemsErr) throw itemsErr;
      let remitoDelete = supabase.from("remitos").delete().eq("id", id);
      remitoDelete = remitoDelete.eq("sociedad_id" as any, sociedadActiva.id);
      const { error: remErr } = await remitoDelete;
      if (remErr) throw remErr;
      setDetailRemito(null);
      setPanelFullscreen(false);
      alert("Remito eliminado");
      await fetchData();
    } catch (err) {
      alert("Error al eliminar remito: " + (err instanceof Error ? err.message : "Error desconocido"));
    }
  }

  async function handleAutorizarAFIP() {
    if (!detailRemito) return;
    setAutorizandoAFIP(true);
    setAfipError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/remito", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          remito_id: detailRemito.id,
          sociedad_id: sociedadActiva?.id || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAfipError(data.error || "Error al autorizar remito");
        return;
      }
      // Update local state with CAE + vencimiento + nro ARCA
      setDetailRemito({
        ...detailRemito,
        cae: data.cae || "OK",
        car_vencimiento: data.cae_vencimiento || null,
        nro_remito_afip: data.nro_remito_afip || null,
      });
      await fetchData();
    } catch (err: any) {
      setAfipError(err.message || "Error de conexión");
    } finally {
      setAutorizandoAFIP(false);
    }
  }

  async function openSplitModal() {
    if (!detailRemito) return;
    // Fetch sucursales for this client
    const { data: sucs } = await (supabase as any).from("cliente_sucursales")
      .select("id, nombre, direccion, localidad, provincia, cp")
      .eq("cliente_id", detailRemito.cliente_id)
      .eq("activo", true)
      .order("principal", { ascending: false });
    if (!sucs || sucs.length === 0) {
      alert("Este cliente no tiene sucursales cargadas. Cargá sucursales desde el módulo de Clientes.");
      return;
    }
    setSplitSucursales(sucs as Sucursal[]);
    setSplitItems(detailItems.map(it => ({ ...it, sucursal_id: "" })));
    // Crear asignación inicial: toda la cantidad en "Dir. principal"
    setSplitAssignments(detailItems.map(it => ({
      itemId: it.id,
      sucursal_id: "",
      cantidad: it.cantidad,
      descripcion: it.descripcion,
      unidad: it.unidad || "u",
      maxCantidad: it.cantidad,
      orden: it.orden,
      presupuesto_item_id: it.presupuesto_item_id || null,
    })));
    setSplitModalOpen(true);
  }

  async function handleSplitSave() {
    if (!detailRemito || splitAssignments.length === 0) return;
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de dividir el remito"); return; }
    if (detailRemito.sociedad_id && detailRemito.sociedad_id !== sociedadActiva.id) {
      alert("El remito no pertenece a la sociedad activa"); return;
    }

    // Validate: total assigned per item must not exceed original
    const itemTotals = new Map<string, number>();
    for (const a of splitAssignments) {
      itemTotals.set(a.itemId, (itemTotals.get(a.itemId) || 0) + a.cantidad);
    }
    for (const a of splitAssignments) {
      if ((itemTotals.get(a.itemId) || 0) > a.maxCantidad) {
        alert(`La suma de cantidades para "${a.descripcion}" supera el total original (${a.maxCantidad}).`);
        return;
      }
    }
    // Filter out zero-quantity assignments
    const validAssignments = splitAssignments.filter(a => a.cantidad > 0);

    // Group by sucursal
    const groups = new Map<string, typeof validAssignments>();
    for (const a of validAssignments) {
      const key = a.sucursal_id || "__none";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    }

    if (groups.size <= 1) {
      alert("Todos los items están asignados a la misma sucursal. Asigná al menos un item a una sucursal diferente.");
      return;
    }

    setSplittingSaving(true);
    try {
      const sortedKeys = [...groups.keys()].sort((a, b) => a === "__none" ? -1 : b === "__none" ? 1 : 0);
      const keepKey = sortedKeys[0];
      const keepAssignments = groups.get(keepKey)!;

      // Update original remito: set sucursal_id
      const keepSucursalId = keepKey === "__none" ? null : keepKey;
      await (supabase as any).from("remitos").update({ sucursal_id: keepSucursalId }).eq("id", detailRemito.id).eq("sociedad_id", sociedadActiva.id);

      // Delete ALL original items and re-insert the ones that stay (with possibly changed quantities)
      await supabase.from("remito_items").delete().eq("remito_id" as any, detailRemito.id);
      if (keepAssignments.length > 0) {
        const keepRows = keepAssignments.map((a) => ({
          remito_id: detailRemito.id,
          descripcion: a.descripcion,
          cantidad: a.cantidad,
          unidad: a.unidad || "UN",
          orden: a.orden,
          presupuesto_item_id: a.presupuesto_item_id || null,
        }));
        await (supabase as any).from("remito_items").insert(keepRows);
      }

      // Create new remitos for remaining groups
      const createdRemitos: string[] = [];
      for (const [key, assignments] of groups) {
        if (key === keepKey) continue;
        const sucursalId = key === "__none" ? null : key;
        const sucNombre = splitSucursales.find(s => s.id === key)?.nombre || "";

        // Get next CAI number for split remito (only if original had CAI)
        let caiSplit: { cai_numero: string; punto_venta: number; nro_comprobante: number } | null = null;
        if (detailRemito?.cai_numero) {
          const { data: caiSplitRows } = await (supabase as any).rpc("next_cai_number", {
            p_sociedad_id: sociedadActiva.id,
            p_tipo: "remito_r",
          });
          if (caiSplitRows && caiSplitRows.length > 0) caiSplit = caiSplitRows[0];
        }

        const splitInsert: Record<string, unknown> = {
          numero: null,
          cliente_id: detailRemito.cliente_id,
          fecha: detailRemito.fecha,
          observaciones: `Dividido de ${detailRemito.numero}${sucNombre ? ` — Suc: ${sucNombre}` : ""}`,
          presupuesto_id: detailRemito.presupuesto_id || null,
          estado: "pendiente",
          sociedad_id: sociedadActiva.id,
          sucursal_id: sucursalId,
          valor_declarado: detailRemito.valor_declarado,
          created_by: profile?.id || null,
          remito_origen_id: detailRemito.id,
        };
        if (caiSplit) {
          splitInsert.cai_numero = caiSplit.cai_numero;
          splitInsert.punto_venta_cai = caiSplit.punto_venta;
          splitInsert.nro_comprobante_cai = caiSplit.nro_comprobante;
        }
        const { data: newRemito, error: rErr } = await (supabase.from("remitos") as any).insert(splitInsert).select("id").single();

        if (rErr) { alert("Error al crear remito: " + rErr.message); return; }
        if (newRemito) {
          const newItems = assignments.map((a) => ({
            remito_id: newRemito.id,
            descripcion: a.descripcion,
            cantidad: a.cantidad,
            unidad: a.unidad || "UN",
            orden: a.orden,
            presupuesto_item_id: a.presupuesto_item_id || null,
          }));
          await (supabase as any).from("remito_items").insert(newItems);
          // Fetch the auto-generated numero
          const { data: created } = await (supabase as any).from("remitos").select("numero").eq("id", newRemito.id).single();
          createdRemitos.push(created?.numero || newRemito.id);
        }
      }

      setSplitModalOpen(false);
      setDetailRemito(null);
      setPanelFullscreen(false);
      await fetchData();
      alert(`Remito dividido. Se crearon ${createdRemitos.length} remito(s) adicional(es): ${createdRemitos.join(", ")}`);
    } catch (err) {
      alert("Error al dividir remito: " + (err as Error).message);
    } finally {
      setSplittingSaving(false);
    }
  }

  async function handleRowClick(row: RemitoRow) {
    setDetailRemito(row);
    setDetailLoading(true);
    setDetailPRNumero(null);
    setDetailPRItems({});
    setDetailFacturas([]);
    setDetailTransportes([]);
    setDetailOC(null);
    setCreateTransporteOpen(false);
    try {
      const itemsPromise = (supabase as any)
        .from("remito_items")
        .select("id, descripcion, cantidad, unidad, orden, presupuesto_item_id")
        .eq("remito_id", row.id)
        .order("orden", { ascending: true });

      const prPromise = row.presupuesto_id
        ? supabase.from("presupuestos").select("numero, sucursal_id").eq("id", row.presupuesto_id).single()
        : null;
      const facturasPromise = row.presupuesto_id
        ? supabase.from("facturas").select("id, numero, tipo, total, estado").eq("presupuesto_id" as any, row.presupuesto_id)
        : null;
      const transportesPromise = (supabase as any)
        .from("transportes")
        .select("id, transportista, estado, fecha, destino, costo, moneda")
        .eq("remito_id", row.id);
      const ocPromise = row.presupuesto_id
        ? (supabase as any).from("ordenes_compra").select("id, numero").eq("presupuesto_origen_id", row.presupuesto_id).limit(1)
        : null;

      const [itemsRes, prRes, facturasRes, transportesRes, ocRes] = await Promise.all([
        itemsPromise,
        prPromise,
        facturasPromise,
        transportesPromise,
        ocPromise,
      ]);

      setDetailItems((itemsRes.data as unknown as RemitoDetailItem[]) || []);
      // Lo que lleva el PR y lo que ya se remitó, para ver el pendiente de cada renglón.
      if (row.presupuesto_id) {
        try {
          const [{ data: pis }, { data: rems }] = await Promise.all([
            (supabase as any).from("presupuesto_items").select("id, cantidad").eq("presupuesto_id", row.presupuesto_id),
            (supabase as any).from("remitos").select("id").eq("presupuesto_id", row.presupuesto_id),
          ]);
          const remitidos: Record<string, number> = {};
          if (rems?.length) {
            const { data: ris } = await (supabase as any).from("remito_items").select("presupuesto_item_id, cantidad").in("remito_id", rems.map((r: any) => r.id));
            for (const ri of ris || []) if (ri.presupuesto_item_id) remitidos[ri.presupuesto_item_id] = (remitidos[ri.presupuesto_item_id] || 0) + Number(ri.cantidad);
          }
          setDetailPRItems(Object.fromEntries((pis || []).map((p: any) => [p.id, { total: Number(p.cantidad), remitido: remitidos[p.id] || 0 }])));
        } catch { /* el detalle sigue sin la columna del PR */ }
      }
      if (prRes?.data) {
        setDetailPRNumero((prRes.data as any).numero || null);
      }
      if (ocRes?.data && ocRes.data.length > 0) {
        setDetailOC({ id: ocRes.data[0].id, numero: ocRes.data[0].numero });
      }
      // Fetch sucursal from remito.sucursal_id (priority) or presupuesto.sucursal_id (legacy)
      const remitoSucId = (row as any).sucursal_id;
      const prSucId = prRes?.data ? (prRes.data as any).sucursal_id : null;
      const sucId = remitoSucId || prSucId;
      if (sucId) {
        const { data: sucData } = await (supabase as any).from("cliente_sucursales").select("nombre, direccion, localidad, provincia").eq("id", sucId).single();
        if (sucData) {
          const sucLabel = [sucData.nombre, sucData.direccion, sucData.localidad, sucData.provincia].filter(Boolean).join(", ");
          setDetailRemito((prev) => prev ? { ...prev, sucursal_nombre: sucData.nombre, sucursal_direccion: sucLabel } : prev);
        }
      }
      if (facturasRes?.data) setDetailFacturas((facturasRes.data as any[]) || []);
      if (transportesRes?.data) setDetailTransportes((transportesRes.data as TransporteLinked[]) || []);
    } catch {
      setDetailItems([]);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleCopySummary() {
    if (!detailRemito) return;
    navigator.clipboard.writeText(buildRemitoSummaryText());
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  }

  function buildRemitoSummaryText() {
    if (!detailRemito) return "";
    const lines = [
      `REMITO ${detailRemito.numero}`,
      `Cliente: ${detailRemito.clientes?.razon_social || "\u2014"}`,
      `Fecha: ${formatDate(detailRemito.fecha)}`,
      detailRemito.sucursal_nombre ? `Sucursal: ${detailRemito.sucursal_nombre}` : "",
      detailRemito.oc_cliente ? `OC Cliente: ${detailRemito.oc_cliente}` : "",
      detailRemito.valor_declarado ? `VALOR DECLARADO: $ ${Number(detailRemito.valor_declarado).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` : "",
      detailRemito.observaciones ? `Obs: ${detailRemito.observaciones}` : "",
      "",
      "ITEMS:",
      ...detailItems.map((it, i) => `${i + 1}. ${it.descripcion} — ${it.cantidad} ${it.unidad || "u"}`),
    ].filter(Boolean).join("\n");
    return lines;
  }

  async function handleEmailRemito(fila?: RemitoRow) {
    const r = fila || detailRemito;
    if (!r) return;
    const template = await loadEmailTemplate("remito", sociedadActiva?.id || "");
    const vars = {
      numero: numeroRemito(r),
      sociedad: sociedadActiva?.razonSocial || "Lazzari",
      fecha: formatDate(r.fecha),
      cliente: r.clientes?.razon_social || "",
    };
    setEmailModalData({
      to: r.clientes?.email || "",
      subject: applyTemplateVars(template.asunto, vars),
      body: applyTemplateVars(template.cuerpo, vars),
      filename: nombrePDFRemito(numeroRemito(r), r.clientes?.razon_social),
      id: r.id,
    });
    setEmailModalOpen(true);
  }

  function openPdfModal() {
    if (!detailRemito) return;
    setPdfValorDeclarado(String(detailRemito.valor_declarado ?? 0));
    setPdfModalOpen(true);
  }

  async function handleDownloadPDF(overrideValorDeclarado?: number) {
    if (!detailRemito || !sociedadActiva) return;
    // Mismo PDF que la lista y la ventana (domicilio y transporte cargados en el remito).
    try {
      const { html, filename } = await htmlRemito(detailRemito.id, sociedadActiva, overrideValorDeclarado);
      openPDFWindow(html, filename);
    } catch (err) { toast.error(`No se pudo armar el PDF: ${err instanceof Error ? err.message : "error"}`); }
  }

  async function handleCreateTransporteFromRemito() {
    const nombreTransportista = transporteForm.transportista_id && transporteForm.transportista_id !== "__manual"
      ? (catalogTransportistas.find(t => t.id === transporteForm.transportista_id)?.nombre || transporteForm.transportista)
      : transporteForm.transportista;
    if (!detailRemito || !nombreTransportista) return;
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de crear el transporte"); return; }
    setCreatingTransporte(true);
    try {
      const { error } = await (supabase as any).from("transportes").insert({
        sociedad_id: sociedadActiva.id,
        transportista: nombreTransportista,
        transportista_id: (transporteForm.transportista_id && transporteForm.transportista_id !== "__manual") ? transporteForm.transportista_id : null,
        destino: transporteForm.destino || null,
        origen: transporteForm.origen || null,
        cliente_id: detailRemito.cliente_id,
        remito_id: detailRemito.id,
        fecha: transporteForm.fecha,
        costo: transporteForm.costo ? Number(transporteForm.costo) : null,
        moneda: transporteForm.moneda,
        bultos: transporteForm.bultos ? Number(transporteForm.bultos) : null,
        tipo_vehiculo: transporteForm.tipo_vehiculo || null,
        notas: transporteForm.notas || null,
        estado: "solicitado",
      });
      if (error) {
        alert("Error al crear transporte: " + error.message);
        return;
      }
      setCreateTransporteOpen(false);
      const { data: tData } = await (supabase as any)
        .from("transportes")
        .select("id, transportista, estado, fecha, destino, costo, moneda")
        .eq("remito_id", detailRemito.id);
      if (tData) setDetailTransportes(tData as TransporteLinked[]);
    } catch (err) {
      console.error("Error creating transporte:", err);
    } finally {
      setCreatingTransporte(false);
    }
  }

  if (loading) {
    return (
      <>
        <Header title="Remitos" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Remitos"
        subtitle="Remitos de entrega"
        action={{ label: "Nuevo remito", onClick: () => setVentana({ remitoId: null }) }}
      />
      <div className="p-3 sm:p-5 space-y-4">
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar lo que quieras: cliente, artículo, N° de remito o CAI, PR, OC, sucursal, transporte, observaciones…"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
        <SmartFilters
          filters={smartFilterConfigs}
          values={smartFilterValues}
          onChange={setSmartFilterValues}
        />

        <Card className="p-0 overflow-hidden">
          <DataTable<RemitoRow>
            columns={[
              { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="whitespace-nowrap text-zinc-500">{formatDate(row.fecha)}</span> },
              { key: "numero", label: "N° remito", sortable: true, sortValue: (row) => numeroRemito(row), render: (row) => <span className="whitespace-nowrap font-mono text-xs font-bold" title={row.numero}>{numeroRemito(row)}</span> },
              { key: "presupuesto_id", label: "N° PR", sortable: true, sortValue: (row) => row.presupuesto_numero || "", render: (row) => row.presupuesto_id ? <span className="whitespace-nowrap font-mono text-xs text-blue-700 dark:text-blue-300">{row.presupuesto_numero || "Vinculado"}</span> : <span className="text-zinc-400">{"—"}</span> },
              { key: "oc_cliente", label: "N° OC", sortable: true, sortValue: (row) => row.oc_cliente || "", render: (row) => row.oc_cliente ? <span className="font-mono text-xs">{row.oc_cliente}</span> : <span className="text-zinc-400">{"—"}</span> },
              { key: "clientes", label: "Cliente", sortable: true, sortKey: "clienteNombre", render: (row) => (
                <div className="leading-tight">
                  <span className="font-medium">{row.clientes?.razon_social}</span>
                  {row.sucursal_nombre && <span className="block text-[11px] text-zinc-400">{row.sucursal_nombre}</span>}
                </div>
              ) },
              { key: "descripcion", label: "Descripción", sortable: true, sortValue: (row) => descripcionCorta(row.remito_items).corta, render: (row) => {
                const d = descripcionCorta(row.remito_items);
                return d.corta ? <span className="line-clamp-1 max-w-[260px] text-xs text-zinc-600 dark:text-zinc-300" title={d.todas}>{d.corta}</span> : <span className="text-xs font-medium text-red-400">Sin items</span>;
              } },
              { key: "tipo_remito", label: "Tipo remito", sortable: true, sortValue: (row) => `${tipoRemitoTexto(row)} ${numeroCAI(row.punto_venta_cai, row.nro_comprobante_cai) || ""}`, render: (row) => {
                const k = tipoRemitoClave(row);
                const cai = numeroCAI(row.punto_venta_cai, row.nro_comprobante_cai);
                if (k === "cai" && cai) return <span className="whitespace-nowrap text-xs font-medium text-emerald-700 dark:text-emerald-400" title={`CAI ${row.cai_numero}`}>Remito R</span>;
                return <Badge variant={k === "arca" ? "info" : k === "muestra" ? "purple" : k === "manual" ? "orange" : "default"}>{tipoRemitoTexto(row)}</Badge>;
              } },
              { key: "transportistas", label: "Transporte", sortable: true, sortValue: (row) => (row.transportistas || []).join(" "), render: (row) => (
                <div onClick={(e) => e.stopPropagation()}>
                  {editTransp === row.id ? (
                    <Select autoFocus className="w-[170px] !py-1 !text-xs" value={row.transporte_valor || "nose"} onChange={(e) => cambiarTransporte(row, e.target.value)} onBlur={() => setEditTransp(null)} options={opcionesTransp} />
                  ) : (
                    <button onClick={() => setEditTransp(row.id)} title="Cambiar quién lo lleva" className="rounded px-1 py-0.5 text-left text-xs hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-orange-950/30">
                      {(row.transportistas || []).length ? (row.transportistas || []).join(", ") : <span className="text-zinc-400">{"—"}</span>}
                    </button>
                  )}
                </div>
              ) },
              { key: "foto_url", label: "Foto", sortable: true, sortValue: (row) => (row.foto_url ? 1 : 0), render: (row) => (
                <div onClick={(e) => e.stopPropagation()}>
                  {row.foto_url ? (
                    <a href={row.foto_url} target="_blank" rel="noreferrer" title={`Remito firmado${row.recibio ? ` · recibió ${row.recibio}` : ""}`} className="inline-flex items-center gap-1 text-xs text-sky-600 hover:text-sky-800"><Camera className="h-4 w-4" />{row.recibio ? <span className="max-w-[90px] truncate">{row.recibio}</span> : null}</a>
                  ) : subiendoFoto === row.id ? <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> : (
                    <button onClick={() => { fotoPara.current = row; fotoInput.current?.click(); }} title="Subir la foto del remito firmado (no es obligatoria)" className="rounded p-1 text-zinc-300 hover:bg-sky-50 hover:text-sky-600"><Camera className="h-4 w-4" /></button>
                  )}
                </div>
              ) },
              {
                key: "actions", label: "", sortable: false,
                render: (row) => (
                  <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setVentana({ remitoId: row.id })} className="rounded p-1.5 text-zinc-400 hover:bg-orange-50 hover:text-orange-600" title="Editar remito"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => pdfDeFila(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="Descargar PDF"><Download className="h-3.5 w-3.5" /></button>
                    <button onClick={() => handleEmailRemito(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="Enviar por mail"><Mail className="h-3.5 w-3.5" /></button>
                  </div>
                ),
              },
            ]}
            data={remitos.filter((r) => {
              const fechaFilter = smartFilterValues.fecha as { from?: string; to?: string } | undefined;
              if (fechaFilter?.from && r.fecha < fechaFilter.from) return false;
              if (fechaFilter?.to && r.fecha > fechaFilter.to) return false;
              const clienteFilter = smartFilterValues.cliente as string;
              if (clienteFilter && r.clientes?.razon_social !== clienteFilter) return false;
              const vinculadoFilter = smartFilterValues.vinculado as string;
              if (vinculadoFilter === "si" && !r.presupuesto_id) return false;
              if (vinculadoFilter === "no" && r.presupuesto_id) return false;
              const tipoFilter = smartFilterValues.tipo as string;
              if (tipoFilter && tipoRemitoClave(r) !== tipoFilter) return false;
              const q = busqueda.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
              if (q) {
                const cai = r.cai_numero ? `r ${String(r.punto_venta_cai || "").padStart(4, "0")}-${String(r.nro_comprobante_cai || "").padStart(8, "0")}` : "";
                const cai2 = numeroCAI(r.punto_venta_cai, r.nro_comprobante_cai) || "";
                const articulos = (r.remito_items || []).map((it) => it.descripcion || "").join(" ");
                const texto = `${r.numero} ${cai} ${cai2} ${r.clientes?.razon_social || ""} ${r.presupuesto_numero || ""} ${r.oc_cliente || ""} ${r.sucursal_nombre || ""} ${articulos} ${r.observaciones || ""} ${(r.transportistas || []).join(" ")} ${r.recibio || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                if (!q.split(/\s+/).every((w) => texto.includes(w))) return false;
              }
              return true;
            })}
            onRowClick={handleRowClick}
          />
        </Card>
      </div>

      {/* Detail Side Panel */}
      {detailRemito && (
        <>
          {panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setPanelFullscreen(false)} />
          )}
          {!panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => { setDetailRemito(null); setPanelFullscreen(false); }} />
          )}
          <div className={panelFullscreen
            ? "fixed inset-4 z-50 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl animate-slide-in-right"
            : "fixed right-0 top-0 z-50 h-full w-full overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right max-w-3xl"
          }>
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold font-mono dark:text-white">{numeroRemito(detailRemito)}</h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleEmailRemito()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title="Enviar por correo">
                  <Mail className="h-3.5 w-3.5" /> Email
                </button>
                <button onClick={handleCopySummary} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title="Copiar resumen">
                  {copiedSummary ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  {copiedSummary ? "Copiado" : "Copiar"}
                </button>
                <button onClick={openPdfModal} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title="Descargar PDF">
                  <Download className="h-3.5 w-3.5" /> PDF
                </button>
                <button onClick={() => handleDeleteRemito(detailRemito.id)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40" title="Eliminar remito">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button onClick={() => setPanelFullscreen(!panelFullscreen)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Ampliar"}>
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button onClick={() => { setDetailRemito(null); setPanelFullscreen(false); }} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setVentana({ remitoId: detailRemito.id })} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                  <Pencil className="h-4 w-4" /> Editar
                </button>
                <button onClick={() => openSplitModal()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-500 text-white hover:bg-violet-600 transition-colors">
                  <GitBranch className="h-4 w-4" /> Dividir remito
                </button>
              </div>

              {/* Resumen: tipo, items, unidades y cuánto del PR está remitido */}
              {(() => {
                const unidades = detailItems.reduce((s, i) => s + Number(i.cantidad || 0), 0);
                const pr = Object.values(detailPRItems);
                const totalPR = pr.reduce((s, x) => s + x.total, 0), remitidoPR = pr.reduce((s, x) => s + Math.min(x.remitido, x.total), 0);
                const k = tipoRemitoClave(detailRemito);
                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
                    <Badge variant={k === "arca" ? "info" : k === "muestra" ? "purple" : k === "cai" ? "success" : k === "manual" ? "orange" : "default"}>{tipoRemitoTexto(detailRemito)}</Badge>
                    <span className="dark:text-zinc-200"><b>{detailItems.length}</b> renglones · <b>{unidades.toLocaleString("es-AR")}</b> unidades</span>
                    {totalPR > 0 && <span className={`font-medium ${remitidoPR >= totalPR ? "text-emerald-600" : "text-amber-600"}`}>PR remitido {remitidoPR.toLocaleString("es-AR")} de {totalPR.toLocaleString("es-AR")}{remitidoPR >= totalPR ? " · completo" : ` · faltan ${(totalPR - remitidoPR).toLocaleString("es-AR")}`}</span>}
                    {detailRemito.valor_declarado ? <span className="ml-auto text-zinc-500">Valor declarado ${Number(detailRemito.valor_declarado).toLocaleString("es-AR")}</span> : null}
                  </div>
                );
              })()}

              {/* Items: lo que lleva este remito (arriba, para verlo de entrada) */}
              <div>
                <h3 className="text-sm font-semibold mb-1.5 dark:text-white">Detalle del remito ({detailItems.length})</h3>
                {detailLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>
                ) : detailItems.length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-4 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700">Sin items cargados en este remito</p>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500">
                          <th className="text-left px-2.5 py-1.5 w-10">#</th>
                          <th className="text-left px-2.5 py-1.5">Descripción</th>
                          <th className="text-right px-2.5 py-1.5 w-20">Este remito</th><th className="text-right px-2.5 py-1.5 w-16">Del PR</th><th className="text-right px-2.5 py-1.5 w-20">Ya remitido</th><th className="text-right px-2.5 py-1.5 w-20">Pendiente</th>
                          <th className="text-left px-2.5 py-1.5 w-16">Unidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((item, i) => (
                          <tr key={item.id} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-2.5 py-1.5 text-zinc-400">{i + 1}</td>
                            <td className="px-2.5 py-1.5 dark:text-white">{item.descripcion}</td>
                            <td className="px-2.5 py-1.5 text-right font-medium dark:text-white">{item.cantidad}</td>
                            {(() => { const x = item.presupuesto_item_id ? detailPRItems[item.presupuesto_item_id] : undefined; const pend = x ? Math.max(0, x.total - x.remitido) : null; return <><td className="px-2.5 py-1.5 text-right text-zinc-500">{x ? x.total : "—"}</td><td className="px-2.5 py-1.5 text-right text-zinc-500">{x ? x.remitido : "—"}</td><td className={`px-2.5 py-1.5 text-right font-medium ${pend ? "text-amber-600" : "text-emerald-600"}`}>{pend === null ? "—" : pend}</td></>; })()}
                            <td className="px-2.5 py-1.5 text-zinc-500">{item.unidad || "u"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-zinc-400">Cliente</span>
                  <p className="font-medium dark:text-white">{detailRemito.clientes?.razon_social || "\u2014"}</p>
                </div>
                <div>
                  <span className="text-zinc-400">Fecha</span>
                  <p className="font-medium dark:text-white">{formatDate(detailRemito.fecha)}</p>
                </div>
                {detailRemito.clientes?.cuit && (
                  <div>
                    <span className="text-zinc-400">CUIT</span>
                    <p className="font-medium dark:text-white">{detailRemito.clientes.cuit}</p>
                  </div>
                )}
                {detailRemito.presupuesto_id && detailPRNumero && (
                  <div>
                    <span className="text-zinc-400">Presupuesto origen</span>
                    <button
                      onClick={() => window.open(`/presupuestos?selected=${detailRemito.presupuesto_id}`, "_self")}
                      className="flex items-center gap-1 mt-0.5"
                      title="Ir a presupuestos"
                    >
                      <Badge variant="info">{detailPRNumero}</Badge>
                    </button>
                  </div>
                )}
                {detailOC && (
                  <div>
                    <span className="text-zinc-400">OC vinculada</span>
                    <button
                      onClick={() => window.open(`/ordenes-compra`, "_self")}
                      className="flex items-center gap-1 mt-0.5"
                      title="Ir a órdenes de compra"
                    >
                      <Badge variant="purple">{detailOC.numero}</Badge>
                    </button>
                  </div>
                )}
                {detailRemito.sucursal_nombre && (
                  <div className="col-span-2">
                    <span className="text-zinc-400">Sucursal destino</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <MapPin className="h-3.5 w-3.5 text-violet-500" />
                      <p className="font-medium text-violet-600 dark:text-violet-400">{detailRemito.sucursal_nombre}</p>
                    </div>
                    {detailRemito.sucursal_direccion && (
                      <p className="text-xs text-zinc-500 mt-0.5">{detailRemito.sucursal_direccion}</p>
                    )}
                  </div>
                )}
                {detailRemito.oc_cliente && (
                  <div>
                    <span className="text-zinc-400">OC Cliente</span>
                    <p className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">{detailRemito.oc_cliente}</p>
                  </div>
                )}
                {detailRemito.cai_numero ? (
                  <div className="col-span-2">
                    <span className="text-zinc-400">Remito R — CAI</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      <p className="font-mono text-xs dark:text-white">
                        PV {String(detailRemito.punto_venta_cai).padStart(4, "0")} — Nro {String(detailRemito.nro_comprobante_cai).padStart(8, "0")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="font-mono text-xs text-zinc-500">CAI: {detailRemito.cai_numero}</p>
                      <CopyButton text={detailRemito.cai_numero} />
                    </div>
                  </div>
                ) : detailRemito.cae ? (
                  <div className="col-span-2">
                    <span className="text-zinc-400">Autorización ARCA</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      <p className="font-mono text-xs dark:text-white">{detailRemito.cae}</p>
                      <CopyButton text={detailRemito.cae} />
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-zinc-500">
                      {detailRemito.car_vencimiento && <span>Vto: {detailRemito.car_vencimiento}</span>}
                      {detailRemito.nro_remito_afip && <span>Comp: {detailRemito.nro_remito_afip}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                      <CheckCircle2 className="h-3.5 w-3.5 text-zinc-400" /> Remito interno (sin CAI)
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-zinc-400">Valor declarado ($)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={detailRemito.valor_declarado ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.replace(",", ".");
                      if (v === "" || v === "." || /^\d*\.?\d*$/.test(v)) {
                        setDetailRemito({ ...detailRemito, valor_declarado: v === "" ? null : Number(v) || 0 });
                      }
                    }}
                    onBlur={async (e) => {
                      const val = Number(e.target.value.replace(",", ".")) || 0;
                      setDetailRemito({ ...detailRemito, valor_declarado: val || null });
                      if (sociedadActiva?.id) {
                        const { error: vdErr } = await (supabase as any).from("remitos").update({ valor_declarado: val || null }).eq("id", detailRemito.id).eq("sociedad_id", sociedadActiva.id);
                        if (vdErr) console.error("Error actualizando valor declarado:", vdErr.message);
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-mono font-medium text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  />
                </div>
              </div>

              {/* Linked transportes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-400 font-medium">Transporte</span>
                  {!createTransporteOpen && (
                    <button
                      onClick={async () => {
                        setTransporteForm({
                          transportista_id: "", transportista: "", destino: "", origen: "",
                          fecha: todayAR(),
                          costo: "", moneda: "ARS", bultos: "", tipo_vehiculo: "", notas: "",
                        });
                        setCreateTransporteOpen(true);
                        try {
                          const { data } = await (supabase as any).from("transportistas").select("id, nombre").eq("activo", true).order("nombre");
                          if (data) setCatalogTransportistas(data as { id: string; nombre: string }[]);
                        } catch { /* ignore */ }
                      }}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      <Plus className="h-3 w-3" /> Agregar transporte
                    </button>
                  )}
                </div>

                {detailTransportes.length > 0 ? (
                  <div className="space-y-2">
                    {detailTransportes.map(t => {
                      const cfg = transporteEstadoConfig[t.estado] || { label: t.estado, variant: "info" as const };
                      return (
                        <div key={t.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Truck className="h-4 w-4 text-zinc-400" />
                              <span className="font-medium text-sm dark:text-white">{t.transportista}</span>
                              <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-400">{formatDate(t.fecha)}</span>
                              <button
                                onClick={async () => {
                                  if (!confirm("¿Eliminar este transporte?")) return;
                                  const { error } = await (supabase as any).from("transportes").delete().eq("id", t.id).eq("sociedad_id", sociedadActiva?.id || "");
                                  if (error) { alert("Error al eliminar transporte"); return; }
                                  setDetailTransportes((prev) => prev.filter((tr) => tr.id !== t.id));
                                }}
                                className="p-1 rounded text-zinc-400 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/30 transition-colors"
                                title="Eliminar transporte"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 mt-1.5 text-xs text-zinc-500">
                            {t.destino && <span>Destino: {t.destino}</span>}
                            {t.costo != null && (
                              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(t.costo, t.moneda as "USD" | "ARS")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : !createTransporteOpen ? (
                  <p className="text-sm text-zinc-400 text-center py-3 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700">
                    Sin transporte asignado
                  </p>
                ) : null}

                {/* Inline create transporte form */}
                {createTransporteOpen && (
                  <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 p-3 space-y-2 mt-2">
                    <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-2">Nuevo transporte para este remito</p>
                    <div>
                      {catalogTransportistas.length > 0 ? (
                        <select
                          value={transporteForm.transportista_id}
                          onChange={e => {
                            const id = e.target.value;
                            const found = catalogTransportistas.find(t => t.id === id);
                            setTransporteForm({ ...transporteForm, transportista_id: id, transportista: found?.nombre || (id === "__manual" ? transporteForm.transportista : "") });
                          }}
                          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                        >
                          <option value="">Seleccionar transportista *</option>
                          {catalogTransportistas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                          <option value="__manual">Otro (ingresar manualmente)</option>
                        </select>
                      ) : (
                        <input type="text" value={transporteForm.transportista} onChange={e => setTransporteForm({ ...transporteForm, transportista: e.target.value })}
                          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          placeholder="Transportista *" autoFocus />
                      )}
                      {transporteForm.transportista_id === "__manual" && (
                        <input type="text" value={transporteForm.transportista} onChange={e => setTransporteForm({ ...transporteForm, transportista: e.target.value })}
                          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white mt-1"
                          placeholder="Nombre del transportista *" autoFocus />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={transporteForm.origen} onChange={e => setTransporteForm({ ...transporteForm, origen: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Origen" />
                      <input type="text" value={transporteForm.destino} onChange={e => setTransporteForm({ ...transporteForm, destino: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Destino" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input type="date" value={transporteForm.fecha} onChange={e => setTransporteForm({ ...transporteForm, fecha: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                      <input type="number" step="0.01" value={transporteForm.costo} onChange={e => setTransporteForm({ ...transporteForm, costo: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Monto (opc.)" />
                      <select value={transporteForm.moneda} onChange={e => setTransporteForm({ ...transporteForm, moneda: e.target.value as "ARS" | "USD" })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                        <option value="ARS">ARS</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" min="0" value={transporteForm.bultos} onChange={e => setTransporteForm({ ...transporteForm, bultos: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Bultos" />
                      <input type="text" value={transporteForm.tipo_vehiculo} onChange={e => setTransporteForm({ ...transporteForm, tipo_vehiculo: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Tipo vehículo" />
                    </div>
                    <textarea value={transporteForm.notas} onChange={e => setTransporteForm({ ...transporteForm, notas: e.target.value })}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" rows={1} placeholder="Notas..." />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setCreateTransporteOpen(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300">
                        Cancelar
                      </button>
                      <button onClick={handleCreateTransporteFromRemito}
                        disabled={creatingTransporte || (!transporteForm.transportista && !transporteForm.transportista_id) || (transporteForm.transportista_id === "__manual" && !transporteForm.transportista)}
                        className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1">
                        {creatingTransporte && <Loader2 className="h-3 w-3 animate-spin" />}
                        Crear transporte
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Linked facturas */}
              {detailFacturas.length > 0 && (
                <div>
                  <span className="text-xs text-zinc-400 block mb-2">Facturas vinculadas</span>
                  <div className="flex flex-wrap gap-2">
                    {detailFacturas.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => window.open(`/facturacion?factura=${f.id}`, "_self")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                        title="Ir a facturacion"
                      >
                        <Badge variant={f.estado === "pagada" ? "success" : f.estado === "anulada" ? "warning" : "info"}>
                          {f.tipo} {f.numero}
                        </Badge>
                        <span className="text-zinc-500 font-mono">
                          ${Number(f.total).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {detailRemito.foto_url && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm">
                  <span className="text-xs text-zinc-400 block mb-1">Remito firmado</span>
                  <a href={detailRemito.foto_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-600 hover:underline"><Camera className="h-3.5 w-3.5" /> Ver foto</a>
                  {detailRemito.recibio && <span className="ml-2 text-zinc-600 dark:text-zinc-300">· recibió {detailRemito.recibio}</span>}
                  {detailRemito.entregado_at && <span className="ml-2 text-zinc-400">· {formatDate(detailRemito.entregado_at)}</span>}
                  {detailRemito.foto_ia?.anotaciones && <p className="mt-1 text-xs text-zinc-500">Anotado en el remito: {detailRemito.foto_ia.anotaciones}</p>}
                </div>
              )}

              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                <span className="text-xs text-zinc-400 block mb-1">Observaciones</span>
                <textarea
                  value={detailRemito.observaciones || ""}
                  onChange={(e) => setDetailRemito(prev => prev ? { ...prev, observaciones: e.target.value } : prev)}
                  onBlur={async (e) => {
                    const val = e.target.value;
                    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de guardar observaciones"); return; }
                    const { error } = await (supabase as any).from("remitos").update({ observaciones: val }).eq("id", detailRemito.id).eq("sociedad_id", sociedadActiva.id);
                    if (error) alert("Error al guardar observaciones: " + error.message);
                    else setRemitos(prev => prev.map(r => r.id === detailRemito.id ? { ...r, observaciones: val } : r));
                  }}
                  className="w-full bg-transparent text-sm dark:text-zinc-300 resize-none outline-none focus:ring-1 focus:ring-orange-400 rounded px-1 py-0.5 min-h-[2rem]"
                  rows={2}
                  placeholder="Agregar observaciones..."
                />
              </div>

            </div>
          </div>
        </>
      )}

      {/* Ventana única: Nuevo remito / Editar */}
      <RemitoVentana open={!!ventana} remitoId={ventana?.remitoId || null} onClose={() => setVentana(null)}
        onGuardado={() => { void fetchData(); if (detailRemito) setDetailRemito(null); }} />
      <input ref={fotoInput} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; const r = fotoPara.current; e.target.value = ""; if (f && r) void subirFoto(r, f); }} />

      {/* Split por Sucursal Modal */}
      {splitModalOpen && detailRemito && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold dark:text-white flex items-center gap-2">
                  <GitBranch className="h-5 w-5 text-violet-600" />
                  Dividir Remito
                </h2>
                <p className="text-sm text-zinc-400">
                  {detailRemito.numero} — {detailRemito.clientes?.razon_social || "—"}
                </p>
              </div>
              <button onClick={() => setSplitModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Asigná cantidades a cada sucursal. Podés dividir un mismo artículo en varias sucursales.
              Usá <strong>+ Agregar destino</strong> para enviar parte de un artículo a otra sucursal.
            </p>

            <div className="space-y-3">
              {detailItems.map((item) => {
                const itemAssignments = splitAssignments.filter(a => a.itemId === item.id);
                const totalAsignado = itemAssignments.reduce((s, a) => s + a.cantidad, 0);
                const excede = totalAsignado > item.cantidad;
                return (
                  <div key={item.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium dark:text-white">{item.descripcion}</span>
                        <span className="text-zinc-400 text-xs ml-2">({item.unidad || "u"})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono ${excede ? "text-red-500 font-bold" : "text-zinc-500"}`}>
                          {totalAsignado}/{item.cantidad}
                        </span>
                        <button
                          onClick={() => setSplitAssignments(prev => [...prev, {
                            itemId: item.id,
                            sucursal_id: splitSucursales[0]?.id || "",
                            cantidad: Math.max(0, item.cantidad - totalAsignado),
                            descripcion: item.descripcion,
                            unidad: item.unidad || "u",
                            maxCantidad: item.cantidad,
                            orden: item.orden,
                            presupuesto_item_id: item.presupuesto_item_id || null,
                          }])}
                          className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-0.5"
                        >
                          <Plus className="h-3 w-3" /> Agregar destino
                        </button>
                      </div>
                    </div>
                    {itemAssignments.map((assignment, aIdx) => {
                      const globalIdx = splitAssignments.findIndex(a => a === assignment);
                      return (
                        <div key={aIdx} className="flex items-center gap-2">
                          <select
                            value={assignment.sucursal_id}
                            onChange={(e) => setSplitAssignments(prev => prev.map((a, i) => i === globalIdx ? { ...a, sucursal_id: e.target.value } : a))}
                            className="flex-1 rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          >
                            <option value="">Dir. principal</option>
                            {splitSucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>
                          <input
                            type="number"
                            min={0}
                            max={item.cantidad}
                            value={assignment.cantidad}
                            onChange={(e) => setSplitAssignments(prev => prev.map((a, i) => i === globalIdx ? { ...a, cantidad: Number(e.target.value) } : a))}
                            className="w-24 rounded border border-zinc-200 px-2 py-1.5 text-sm font-mono text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          />
                          {itemAssignments.length > 1 && (
                            <button
                              onClick={() => setSplitAssignments(prev => prev.filter((_, i) => i !== globalIdx))}
                              className="text-zinc-400 hover:text-red-500 p-1"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {excede && (
                      <p className="text-xs text-red-500">La suma ({totalAsignado}) supera el total original ({item.cantidad})</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Preview of split result */}
            {(() => {
              const validA = splitAssignments.filter(a => a.cantidad > 0);
              const groups = new Map<string, { descripcion: string; cantidad: number; unidad: string }[]>();
              for (const a of validA) {
                const key = a.sucursal_id || "__none";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push({ descripcion: a.descripcion, cantidad: a.cantidad, unidad: a.unidad });
              }
              const entries = [...groups.entries()];
              return entries.length > 1 ? (
                <div className="rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 p-3 space-y-2">
                  <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
                    Se crearán {entries.length} remitos:
                  </p>
                  {entries.map(([key, items]) => {
                    const name = key === "__none" ? "Dir. principal" : splitSucursales.find(s => s.id === key)?.nombre || key;
                    return (
                      <div key={key} className="text-sm text-violet-600 dark:text-violet-400">
                        <div className="flex items-center gap-1.5 font-medium">
                          <MapPin className="h-3.5 w-3.5" />
                          {name}
                        </div>
                        <div className="ml-5 text-xs text-zinc-500 dark:text-zinc-400">
                          {items.map((it, i) => (
                            <span key={i}>{it.cantidad} {it.unidad} {it.descripcion}{i < items.length - 1 ? " · " : ""}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Asigná items a más de una sucursal para dividir el remito.
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setSplitModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleSplitSave}
                disabled={splittingSaving || new Set(splitAssignments.filter(a => a.cantidad > 0).map(a => a.sucursal_id || "__none")).size <= 1}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
              >
                {splittingSaving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Dividiendo...</>
                ) : (
                  <><GitBranch className="h-4 w-4" /> Confirmar división</>
                )}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* PDF valor declarado modal */}
      {pdfModalOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setPdfModalOpen(false)} />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 space-y-4">
              <h3 className="text-lg font-semibold dark:text-white">Valor declarado para PDF</h3>
              <p className="text-sm text-zinc-500">Podés ajustar el valor declarado antes de generar el PDF.</p>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Valor declarado ($)</label>
                <input
                  type="number"
                  value={pdfValorDeclarado}
                  onChange={(e) => setPdfValorDeclarado(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPdfModalOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    setPdfModalOpen(false);
                    handleDownloadPDF(Number(pdfValorDeclarado) || 0);
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors"
                >
                  Generar PDF
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <EmailComposeModal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        documentType="remito"
        sociedadId={sociedadActiva?.id}
        userEmail={profile?.email ? `${profile.full_name || "Lazzari"} <${profile.email}>` : undefined}
        defaultTo={emailModalData.to}
        defaultSubject={emailModalData.subject}
        defaultBody={emailModalData.body}
        pdfFilename={emailModalData.filename}
        generatePdf={async () => {
          if (!emailModalData.id || !sociedadActiva) throw new Error("No se encontró el remito");
          return remitoPDFBase64(emailModalData.id, sociedadActiva);
        }}
      />
    </>
  );
}
