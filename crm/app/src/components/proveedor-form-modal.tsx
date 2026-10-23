"use client";

// Alta / edición de proveedor: el MISMO formulario completo desde Proveedores y desde "Nuevo proveedor" al cargar una factura
// (individual o masiva). Administración (nombre, mail y WhatsApp), vendedores, cómo se le paga, datos bancarios y RG 830.
import { useEffect, useState } from "react";
import { Loader2, Maximize2, Minimize2, Plus, Search, Tag, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { canonicalCondicionIva } from "@/lib/fiscal-condition";
import { mostrarWhatsApp } from "@/lib/whatsapp-ar";
import { WhatsAppInput } from "@/components/ui/whatsapp-input";
import { LeerDocumentoImpositivo } from "@/components/leer-documento-impositivo";
import { bancoDeLista, type DatosImpositivos } from "@/lib/documento-impositivo";
import { CondicionPagoEditor } from "@/components/condicion-pago-editor";
import { legacyDesdePlan } from "@/lib/condicion-pago";

export const CLASIFICACION_TAGS = [
  "Buen precio", "Precio alto", "Entrega rapida", "Entrega lenta",
  "Buena calidad", "Stock permanente", "Importador", "Nacional",
] as const;

const PROVINCIAS_ARGENTINA = [
  "Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba",
  "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan",
  "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero",
  "Tierra del Fuego", "Tucumán",
];

export const TAG_COLORS: Record<string, string> = {
  "Buen precio": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-400",
  "Entrega rapida": "bg-green-50 text-green-700 ring-1 ring-green-200 dark:bg-green-950 dark:text-green-400",
  "Buena calidad": "bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-950 dark:text-teal-400",
  "Stock permanente": "bg-lime-50 text-lime-700 ring-1 ring-lime-200 dark:bg-lime-950 dark:text-lime-400",
  "Precio alto": "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-400",
  "Entrega lenta": "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-400",
  "Importador": "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-400",
  "Nacional": "bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950 dark:text-sky-400",
};

export const CONCEPTOS_RG830: Record<string, string> = {
  compraventa_bienes: "Compraventa de bienes",
  servicios: "Servicios y locaciones",
  honorarios: "Honorarios profesionales",
  alquileres_inmuebles: "Alquileres de inmuebles",
  alquileres_muebles: "Alquileres de muebles",
  intereses_financieros: "Intereses (financieras)",
  intereses_otros: "Intereses (otros)",
  transporte: "Transporte de carga",
  fletes: "Fletes",
  comisiones: "Comisiones",
  publicidad: "Publicidad y propaganda",
  seguros: "Seguros",
};

// Estilos comunes del alta/edición: mismo alto y mismo espacio en todos los campos
const INPUT_CLS = "mt-0.5 h-8 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800";
const LABEL_CLS = "text-xs font-medium text-zinc-500";
const BANCOS_FORM = ["Banco Nación","Banco Provincia","Banco Ciudad","Banco Galicia","Banco Santander","Banco BBVA","Banco Macro","Banco HSBC","Banco ICBC","Banco Patagonia","Banco Credicoop","Banco Comafi","Banco Itaú","Banco Supervielle","Banco Columbia","Brubank","Mercado Pago","Ualá","Naranja X","Otro"];

function SeccionModal({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-3 border-b border-zinc-100 pb-1 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{titulo}</h3>
        {extra}
      </div>
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function normalizarProvincia(p: string): string {
  const base = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const b = base(p);
  if (/ciudad autonoma|capital federal|^caba$/.test(b)) return "CABA";
  return PROVINCIAS_ARGENTINA.find((x) => base(x) === b) || p;
}

const CONDICION_IVA_LABEL: Record<string, string> = { RI: "Responsable Inscripto", Monotributo: "Monotributo", Exento: "Exento", CF: "Consumidor Final" };

// Vendedor cargado en el alta/edición del proveedor (va a contactos con cargo "Ventas").
type ContactoExtra = { nombre: string; email: string; whatsapp: string };
type ContactoExistente = { id: string; nombre: string; cargo: string; email: string; telefono: string; whatsapp: string };

export const emptyProveedorForm = {
  razon_social: "",
  nombre_fantasia: "",
  cuit: "",
  condicion_iva: "RI",
  email: "",
  telefono: "",
  administracion_nombre: "",
  direccion: "",
  localidad: "",
  provincia: "",
  banco: "",
  cbu: "",
  alias_bancario: "",
  numero_cuenta: "",
  titular_cuenta: "",
  cuit_titular_cuenta: "",
  tipo_cuenta: "",
  rubro: "",
  forma_pago: "Transferencia",
  dias_cuenta_corriente: 30,
  limite_credito: 0,
  // Cómo se le paga (ver lib/condicion-pago.ts)
  condicion_pago: null as string | null,
  dias_pago: null as number | null,
  dias_pago_hasta: null as number | null,
  medios_pago: [] as string[],
  medio_pago_preferido: null as string | null,
  plazo_cheque_dias: null as number | null,
  descuento_pronto_pago: null as number | null,
  notas: "",
  clasificacion_tags: [] as string[],
  marcas: "",
  clasificacion_nota: "",
  es_transportista: false,
  concepto_retencion_ganancias: "" as string,
  alicuota_ganancias: null as number | null,
  exclusion_retencion: false,
  exclusion_retencion_desde: null as string | null,
  exclusion_retencion_hasta: null as string | null,
  exclusion_retencion_cert: null as string | null,
  // Talles especiales y tolerancia de precio NO van acá: se editan en Compras → Limpieza de OC
  // (reglas del proveedor). Así el alta/edición nunca pisa esos valores.
  // Personalización (bordados / estampados)
  es_personalizador: false,
  tipo_personalizacion: "" as "" | "bordado" | "estampado" | "ambos",
};
export type ProveedorForm = typeof emptyProveedorForm;

/** Fila de la base → formulario (solo las columnas que edita el formulario; null → valor vacío). */
function filaAForm(row: Record<string, unknown>): ProveedorForm {
  const f = { ...emptyProveedorForm } as Record<string, unknown>;
  for (const k of Object.keys(emptyProveedorForm)) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    f[k] = v;
  }
  const out = f as ProveedorForm;
  out.cuit_titular_cuenta = out.cuit;
  out.medios_pago = Array.isArray(row.medios_pago) ? (row.medios_pago as string[]) : [];
  out.dias_cuenta_corriente = Number(row.dias_cuenta_corriente) || 0;
  out.limite_credito = Number(row.limite_credito) || 0;
  out.descuento_pronto_pago = row.descuento_pronto_pago != null ? Number(row.descuento_pronto_pago) : null;
  out.alicuota_ganancias = row.alicuota_ganancias != null ? Number(row.alicuota_ganancias) : null;
  out.tipo_personalizacion = (row.tipo_personalizacion as ProveedorForm["tipo_personalizacion"]) || "";
  return out;
}

export function ProveedorFormModal({
  open,
  proveedorId,
  inicial,
  subtitulo,
  consultarArcaAlAbrir = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = proveedor nuevo. */
  proveedorId: string | null;
  /** Datos para arrancar un alta (ej. CUIT y razón social leídos de la factura). */
  inicial?: Partial<ProveedorForm>;
  /** Texto chico bajo el título (ej. "Se guarda y queda seleccionado en esta factura"). */
  subtitulo?: string;
  /** Si el alta trae un CUIT de 11 dígitos, completa solo los datos de ARCA (razón social, IVA, domicilio). */
  consultarArcaAlAbrir?: boolean;
  onClose: () => void;
  /** Se llama con la fila guardada (select *) para que quien abrió el formulario la use. */
  onSaved: (proveedor: Record<string, unknown>) => void;
}) {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const [modalFullscreen, setModalFullscreen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(proveedorId);
  const [form, setForm] = useState<ProveedorForm>(emptyProveedorForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [cuitLoading, setCuitLoading] = useState(false);
  // Proveedor persona sin CUIT: se carga con DNI (va en la misma columna). Solo cambia el formulario, no se guarda aparte.
  const [tipoDoc, setTipoDoc] = useState<"cuit" | "dni">("cuit");
  const esDni = tipoDoc === "dni";
  const [contactosExtra, setContactosExtra] = useState<ContactoExtra[]>([]);
  const [contactosExistentes, setContactosExistentes] = useState<ContactoExistente[]>([]);
  // Si al abrir el proveedor era transporte Y taller a la vez, se ofrece "Los dos" para no perder ninguna marca.
  const [ambosTiposAlCargar, setAmbosTiposAlCargar] = useState(false);

  // Al abrir uno que ya existe: si el número no tiene 11 dígitos, se muestra como DNI.
  useEffect(() => {
    if (!open || cargando) return;
    const n = form.cuit.replace(/\D/g, "").length;
    setTipoDoc(n > 0 && n !== 11 ? "dni" : "cuit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proveedorId, cargando]);

  // Cada vez que se abre: alta (vacío + datos iniciales) o edición (se lee la fila completa y sus vendedores).
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setEditingId(proveedorId);
    setFormError("");
    setContactosExtra([]);
    setContactosExistentes([]);
    setModalFullscreen(false);
    if (!proveedorId) {
      setAmbosTiposAlCargar(false);
      setTipoDoc("cuit");
      setForm({ ...emptyProveedorForm, ...(inicial || {}) });
      const cuitInicial = String(inicial?.cuit || "").replace(/\D/g, "");
      if (consultarArcaAlAbrir && cuitInicial.length === 11) void handleCuitLookup(cuitInicial);
      return;
    }
    setCargando(true);
    (async () => {
      const [{ data, error }, { data: contactos }] = await Promise.all([
        supabase.from("proveedores").select("*").eq("id", proveedorId).single(),
        (supabase as any).from("contactos").select("id, nombre, cargo, email, telefono, whatsapp")
          .eq("entity_type", "proveedor").eq("entity_id", proveedorId).order("principal", { ascending: false }),
      ]);
      if (cancelado) return;
      setCargando(false);
      if (error || !data) { setFormError(`No se pudo leer el proveedor: ${error?.message || "no encontrado"}`); return; }
      const row = data as Record<string, unknown>;
      setAmbosTiposAlCargar(Boolean(row.es_transportista) && Boolean(row.es_personalizador));
      setForm(filaAForm(row));
      setContactosExistentes(((contactos || []) as Record<string, unknown>[]).map((c) => ({
        id: c.id as string, nombre: String(c.nombre ?? ""), cargo: String(c.cargo ?? ""),
        email: String(c.email ?? ""), telefono: String(c.telefono ?? ""), whatsapp: String(c.whatsapp ?? ""),
      })));
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proveedorId]);

  async function handleCuitLookup(cuitDirecto?: string) {
    const cuit = (cuitDirecto ?? form.cuit).replace(/\D/g, "");
    if (cuit.length !== 11) { toast.warning("CUIT debe tener 11 digitos"); return; }
    setCuitLoading(true);
    try {
      const res = await fetch(`/api/cuit-lookup?cuit=${cuit}`);
      if (!res.ok) { toast.error("No se pudo consultar el CUIT"); return; }
      const data = await res.json();
      if (data.error) { toast.error(data.error); return; }
      setForm((prev) => ({
        ...prev,
        razon_social: data.razon_social || prev.razon_social,
        condicion_iva: data.condicion_iva || prev.condicion_iva,
        direccion: data.direccion || prev.direccion,
        localidad: data.localidad || prev.localidad,
        // Conservar la provincia histórica/comercial si ya estaba cargada;
        // la consulta de ARCA puede corresponder a otra sede fiscal.
        provincia: prev.provincia || data.provincia || "",
        concepto_retencion_ganancias: data.retencion_ganancias?.concepto || prev.concepto_retencion_ganancias,
        alicuota_ganancias: data.retencion_ganancias?.alicuota_inscripto ?? prev.alicuota_ganancias,
      }));
      if (!data.condicion_iva) {
        toast.warning("ARCA no pudo determinar la condicion IVA. Verificalo manualmente.");
      } else {
        const retInfo = data.retencion_ganancias ? ` | Ret. Gan.: ${data.retencion_ganancias.alicuota_inscripto}% (${data.retencion_ganancias.concepto_label})` : "";
        toast.success(`Datos cargados desde AFIP — ${data.condicion_iva === "RI" ? "Resp. Inscripto" : data.condicion_iva}${retInfo}`);
      }
    } catch { toast.error("Error al consultar CUIT"); }
    finally { setCuitLoading(false); }
  }

  // Datos leídos con IA de un papel impositivo: completa lo vacío y pisa condición IVA / exclusión
  function aplicarDocumentoImpositivo(d: DatosImpositivos) {
    const next = { ...form };
    const cambios: string[] = [];
    const vacio = (v: unknown) => !String(v ?? "").trim();
    if (d.cuit && vacio(next.cuit)) { next.cuit = d.cuit; cambios.push("CUIT"); }
    if (d.razon_social && vacio(next.razon_social)) { next.razon_social = d.razon_social; cambios.push("razón social"); }
    if (d.condicion_iva && d.condicion_iva !== next.condicion_iva) {
      next.condicion_iva = d.condicion_iva;
      cambios.push(`condición IVA: ${CONDICION_IVA_LABEL[d.condicion_iva] || d.condicion_iva}`);
    }
    if (d.direccion && vacio(next.direccion)) { next.direccion = d.direccion; cambios.push("dirección"); }
    if (d.localidad && vacio(next.localidad)) { next.localidad = d.localidad; cambios.push("localidad"); }
    if (d.provincia && vacio(next.provincia)) { next.provincia = normalizarProvincia(d.provincia); cambios.push("provincia"); }
    if (d.tipo_documento === "exclusion_ganancias") {
      next.exclusion_retencion = true;
      if (d.exclusion_desde) next.exclusion_retencion_desde = d.exclusion_desde;
      if (d.exclusion_hasta) next.exclusion_retencion_hasta = d.exclusion_hasta;
      if (d.numero_certificado) next.exclusion_retencion_cert = d.numero_certificado;
      cambios.push(`exclusión de retención de Ganancias${d.exclusion_hasta ? ` hasta ${formatDate(d.exclusion_hasta)}` : ""}`);
    }
    // Datos bancarios: solo completa lo vacío (nunca pisa lo que ya estaba cargado).
    const banco = bancoDeLista(d.banco, BANCOS_FORM);
    if (banco && vacio(next.banco)) { next.banco = banco; cambios.push("banco"); }
    if (d.tipo_cuenta && vacio(next.tipo_cuenta)) { next.tipo_cuenta = d.tipo_cuenta; cambios.push("tipo de cuenta"); }
    if (d.numero_cuenta && vacio(next.numero_cuenta)) { next.numero_cuenta = d.numero_cuenta; cambios.push("N° de cuenta"); }
    if (d.cbu && vacio(next.cbu)) { next.cbu = d.cbu; cambios.push("CBU"); }
    if (d.alias && vacio(next.alias_bancario)) { next.alias_bancario = d.alias; cambios.push("alias"); }
    if (d.titular_cuenta && vacio(next.titular_cuenta)) { next.titular_cuenta = d.titular_cuenta; cambios.push("titular"); }
    setForm(next);
    toast.info(cambios.length ? `Del documento se cargó: ${cambios.join(", ")}. Revisalo y guardá.` : "El documento no trajo datos nuevos para este proveedor.");
  }

  function cerrar() { setModalFullscreen(false); onClose(); }

  async function handleSave() {
    if (!form.razon_social.trim() || !form.cuit.trim()) {
      setFormError("Razon social y CUIT son obligatorios");
      return;
    }
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      setFormError("Seleccioná una sociedad antes de guardar el proveedor");
      return;
    }
    const condicionIva = canonicalCondicionIva(form.condicion_iva);
    if (!condicionIva) {
      setFormError("La condición IVA no es válida");
      return;
    }
    // Para pagos y eCheq la identidad fiscal siempre es la del proveedor.
    // Conservamos la columna histórica por compatibilidad, pero nunca pedimos
    // ni guardamos un CUIT bancario distinto.
    const proveedorPayload = {
      ...form,
      // La forma de pago y los días viejos (los usan Finanzas y la OP) se mantienen al día con "Cómo se le paga".
      ...legacyDesdePlan(form, { forma_pago: form.forma_pago, dias_cuenta_corriente: form.dias_cuenta_corriente }),
      administracion_nombre: form.administracion_nombre.trim() || null,
      condicion_iva: condicionIva,
      cuit_titular_cuenta: form.cuit.trim(),
      tipo_personalizacion: form.es_personalizador ? (form.tipo_personalizacion || "ambos") : null,
    };
    setSaving(true);
    setFormError("");
    try {
      let guardado: Record<string, unknown> | null = null;
      if (editingId) {
        // talles_especiales y tolerancia_precio_pct no viajan: se conservan tal cual están
        const { data, error } = await supabase.from("proveedores").update(proveedorPayload as any)
          .eq("id", editingId).eq("sociedad_id" as any, sociedadId).select("*").single();
        if (error) throw error;
        guardado = data as Record<string, unknown>;
      } else {
        const insertData = { ...proveedorPayload, talles_especiales: [], tolerancia_precio_pct: 1, sociedad_id: sociedadId } as any;
        const { data, error } = await supabase.from("proveedores").insert(insertData).select("*").single();
        if (error) throw error;
        guardado = data as Record<string, unknown>;
      }
      const proveedorIdGuardado = guardado?.id as string | undefined;
      // Vendedores (contactos comerciales) → tabla contactos, siempre con cargo "Ventas"
      const extras = contactosExtra.filter((c) => c.nombre.trim() || c.email.trim() || c.whatsapp.trim());
      if (extras.length > 0 && proveedorIdGuardado) {
        const { error: contactosError } = await (supabase as any).from("contactos").insert(extras.map((c) => ({
          entity_type: "proveedor",
          entity_id: proveedorIdGuardado,
          nombre: c.nombre.trim() || "Ventas",
          cargo: "Ventas",
          email: c.email.trim() || null,
          whatsapp: c.whatsapp.trim() || null,
          principal: false,
        })));
        if (contactosError) {
          // El proveedor ya quedó guardado: seguimos en modo edición para no duplicarlo al reintentar
          setEditingId(proveedorIdGuardado);
          setFormError(`El proveedor se guardó, pero no se pudieron guardar los vendedores: ${contactosError.message}`);
          toast.error("No se pudieron guardar los vendedores");
          return;
        }
      }
      setContactosExtra([]);
      setModalFullscreen(false);
      if (guardado) onSaved(guardado);
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: string }).message)
          : "Error al guardar";
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/40" onClick={cerrar} />
      <div className={`fixed z-[80] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl transition-all dark:bg-zinc-900 ${modalFullscreen ? "inset-2" : "inset-4 m-auto h-fit max-h-[92vh] w-full max-w-4xl"}`}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
          <div>
            <h2 className="text-base font-bold">{editingId ? "Editar proveedor" : "Nuevo proveedor"}</h2>
            {subtitulo && <p className="text-xs text-zinc-500">{subtitulo}</p>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setModalFullscreen((value) => !value)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" title={modalFullscreen ? "Reducir" : "Pantalla completa"}>{modalFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
            <button onClick={cerrar} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100" title="Cerrar"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {formError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
          {cargando && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando el proveedor…</p>}

          {/* Datos fiscales */}
          <SeccionModal titulo="Datos fiscales" extra={<LeerDocumentoImpositivo compacto conBancarios cuitEsperado={form.cuit} onDatos={aplicarDocumentoImpositivo} />}>
            <div>
              <label className={LABEL_CLS}>
                <span className="inline-flex overflow-hidden rounded border border-zinc-200 align-middle dark:border-zinc-700">
                  {(["cuit", "dni"] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setTipoDoc(t)} className={`px-1.5 py-px text-[10px] font-semibold ${tipoDoc === t ? "bg-orange-500 text-white" : "bg-white text-zinc-500 dark:bg-zinc-800"}`}>{t.toUpperCase()}</button>
                  ))}
                </span>{" "}{esDni ? "DNI" : "CUIT"} *
              </label>
              <div className="mt-0.5 flex gap-1">
                <input value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} onBlur={() => { if (!esDni && form.cuit.replace(/\D/g, "").length === 11 && !form.razon_social) handleCuitLookup(); }} className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800" placeholder={esDni ? "Solo números" : "XX-XXXXXXXX-X"} />
                {!esDni && <button type="button" onClick={() => handleCuitLookup()} disabled={cuitLoading} className="h-8 rounded-lg bg-blue-500 px-2.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap" title="Buscar en ARCA" aria-label="Buscar en ARCA">
                  {cuitLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </button>}
              </div>
            </div>
            <div className="lg:col-span-2">
              <label className={LABEL_CLS}>Razón social *</label>
              <input value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} className={INPUT_CLS} />
            </div>
            <div className="sm:col-span-2" title="Es el nombre con el que figura en las listas de costos. Si no lo sabés, dejalo vacío: el sistema lo aprende de la primera factura.">
              <label className={LABEL_CLS}>Nombre de fantasía <span className="font-normal text-zinc-400">(como figura en las listas)</span></label>
              <input value={form.nombre_fantasia || ""} onChange={(e) => setForm({ ...form, nombre_fantasia: e.target.value })} placeholder="Ej.: Conoflex — si no lo sabés, dejalo vacío" className={INPUT_CLS} />
            </div>
            <div><label className={LABEL_CLS}>Condición IVA</label>
              <select value={form.condicion_iva} onChange={(e) => setForm({ ...form, condicion_iva: e.target.value })} className={INPUT_CLS}>
                <option value="RI">Responsable Inscripto</option>
                <option value="Monotributo">Monotributo</option>
                <option value="Exento">Exento</option>
                <option value="CF">Consumidor Final</option>
              </select>
            </div>
            <div><label className={LABEL_CLS}>Rubro</label><input value={form.rubro} onChange={(e) => setForm({ ...form, rubro: e.target.value })} className={INPUT_CLS} /></div>
            <div><label className={LABEL_CLS}>Dirección</label><input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className={INPUT_CLS} /></div>
            <div><label className={LABEL_CLS}>Localidad</label><input value={form.localidad} onChange={(e) => setForm({ ...form, localidad: e.target.value })} className={INPUT_CLS} /></div>
            <div><label className={LABEL_CLS}>Provincia</label>
              <select value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value })} className={INPUT_CLS}>
                <option value="">Seleccionar...</option>
                {form.provincia && !PROVINCIAS_ARGENTINA.includes(form.provincia) && <option value={form.provincia}>{form.provincia}</option>}
                {PROVINCIAS_ARGENTINA.map((provincia) => <option key={provincia} value={provincia}>{provincia}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
              <span className={LABEL_CLS}>¿Es transporte o taller?</span>
              <div role="radiogroup" aria-label="Tipo de proveedor" className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
                {([
                  { id: "no", label: "No" },
                  { id: "transporte", label: "Transporte" },
                  { id: "taller", label: "Taller" },
                  ...(ambosTiposAlCargar ? [{ id: "ambos", label: "Los dos" }] : []),
                ] as Array<{ id: "no" | "transporte" | "taller" | "ambos"; label: string }>).map((op) => {
                  const actual = form.es_personalizador && form.es_transportista && ambosTiposAlCargar ? "ambos" : form.es_personalizador ? "taller" : form.es_transportista ? "transporte" : "no";
                  const elegido = actual === op.id;
                  return (
                    <button key={op.id} type="button" role="radio" aria-checked={elegido}
                      onClick={() => setForm({
                        ...form,
                        es_transportista: op.id === "transporte" || op.id === "ambos",
                        es_personalizador: op.id === "taller" || op.id === "ambos",
                        tipo_personalizacion: op.id === "taller" || op.id === "ambos" ? (form.tipo_personalizacion || "ambos") : form.tipo_personalizacion,
                      })}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${elegido ? "bg-orange-500 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                      {op.label}
                    </button>
                  );
                })}
              </div>
              {form.es_personalizador && (
                <select value={form.tipo_personalizacion || "ambos"} onChange={(e) => setForm({ ...form, tipo_personalizacion: e.target.value as typeof form.tipo_personalizacion })}
                  aria-label="Tipo de taller" className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                  <option value="bordado">Bordador</option>
                  <option value="estampado">Estampador</option>
                  <option value="ambos">Ambos</option>
                </select>
              )}
              <span className="text-[11px] text-zinc-400">
                {form.es_personalizador && form.es_transportista ? "Aparece en Personalización y en el catálogo de Transportes." : form.es_personalizador ? "Aparece en Personalización." : form.es_transportista ? "Aparece en el catálogo de Transportes." : ""}
              </span>
            </div>
          </SeccionModal>

          {/* Contacto */}
          <SeccionModal titulo="Administración (facturas, cobros y pagos)">
            <div>
              <label className={LABEL_CLS}>Nombre</label>
              <input value={form.administracion_nombre} onChange={(e) => setForm({ ...form, administracion_nombre: e.target.value })} placeholder="Quién atiende administración" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Mail de administración</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="administracion@proveedor.com" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>WhatsApp de administración</label>
              <WhatsAppInput value={form.telefono} onChange={(v) => setForm({ ...form, telefono: v })} className="mt-0.5" />
            </div>
          </SeccionModal>

          <SeccionModal titulo="Vendedores (a ellos se les mandan las OC)">
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              {contactosExtra.map((c, i) => (
                <div key={i} className="grid items-start gap-2 sm:grid-cols-[1fr_1fr_1.3fr_auto]">
                  <input value={c.nombre} onChange={(e) => setContactosExtra((prev) => prev.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))}
                    placeholder="Nombre del vendedor" aria-label="Nombre del vendedor"
                    className="h-8 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
                  <input type="email" value={c.email} onChange={(e) => setContactosExtra((prev) => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))}
                    placeholder="Mail comercial (ventas)" aria-label="Mail comercial"
                    className="h-8 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
                  <WhatsAppInput value={c.whatsapp} onChange={(v) => setContactosExtra((prev) => prev.map((x, j) => j === i ? { ...x, whatsapp: v } : x))} />
                  <button type="button" onClick={() => setContactosExtra((prev) => prev.filter((_, j) => j !== i))} className="rounded p-1.5 text-zinc-400 hover:text-red-500" title="Quitar" aria-label="Quitar"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setContactosExtra((prev) => [...prev, { nombre: "", email: "", whatsapp: "" }])} className="inline-flex items-center gap-0.5 text-xs font-medium text-orange-600 hover:text-orange-700"><Plus className="h-3 w-3" /> Agregar vendedor</button>
            </div>
            {contactosExistentes.length > 0 && (
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="mb-1 text-[11px] text-zinc-400">Vendedores ya cargados (se editan o borran desde la ficha del proveedor):</p>
                <div className="flex flex-wrap gap-1.5">
                  {contactosExistentes.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      <span className="font-medium">{c.nombre}</span>
                      {[c.email, c.whatsapp || c.telefono ? mostrarWhatsApp(c.whatsapp || c.telefono) : ""].filter(Boolean).join(" · ")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </SeccionModal>

          {/* Cómo se le paga */}
          <section>
            <div className="mb-1.5 flex items-center justify-between gap-3 border-b border-zinc-100 pb-1 dark:border-zinc-800">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cómo se le paga</h3>
              <span className="text-[11px] text-zinc-400">Los días se cuentan desde la fecha de factura</span>
            </div>
            <CondicionPagoEditor value={form} onChange={(v) => setForm({ ...form, ...v, medios_pago: v.medios_pago || [] })}
              extra={<div className="w-36"><label className={LABEL_CLS}>Límite de crédito</label><input type="number" value={form.limite_credito} onChange={(e) => setForm({ ...form, limite_credito: Number(e.target.value) })} className={INPUT_CLS} /></div>} />
          </section>

          {/* Datos bancarios */}
          <SeccionModal titulo="Datos bancarios" extra={<span className="text-[11px] text-zinc-400">Opcionales · CUIT para pagos y eCheq: <span className="font-mono font-medium text-zinc-600 dark:text-zinc-300">{form.cuit || "completá el CUIT"}</span> (siempre el fiscal)</span>}>
            <div><label className={LABEL_CLS}>Banco</label><select value={(form as any).banco} onChange={(e) => setForm({ ...form, banco: e.target.value } as any)} className={INPUT_CLS}><option value="">Seleccionar...</option>{BANCOS_FORM.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
            <div><label className={LABEL_CLS}>CBU / CVU</label><input value={form.cbu} onChange={(e) => setForm({ ...form, cbu: e.target.value.replace(/\s/g, "") })} placeholder="22 dígitos" className={`${INPUT_CLS} font-mono`} /></div>
            <div><label className={LABEL_CLS}>Alias</label><input value={form.alias_bancario} onChange={(e) => setForm({ ...form, alias_bancario: e.target.value })} placeholder="alias.del.proveedor" className={INPUT_CLS} /></div>
            <div><label className={LABEL_CLS}>Titular</label><input value={(form as any).titular_cuenta} onChange={(e) => setForm({ ...form, titular_cuenta: e.target.value } as any)} className={INPUT_CLS} /></div>
            <div><label className={LABEL_CLS}>Tipo de cuenta</label><select value={(form as any).tipo_cuenta} onChange={(e) => setForm({ ...form, tipo_cuenta: e.target.value } as any)} className={INPUT_CLS}><option value="">Seleccionar...</option><option value="CC">Cuenta corriente (CC)</option><option value="CA">Caja de ahorro (CA)</option><option value="CVU">CVU</option></select></div>
            <div><label className={LABEL_CLS}>N° de cuenta</label><input value={form.numero_cuenta} onChange={(e) => setForm({ ...form, numero_cuenta: e.target.value })} className={INPUT_CLS} /></div>
          </SeccionModal>

          {/* Retención de Ganancias RG 830 */}
          <SeccionModal titulo="Retención de Ganancias (RG 830)">
            <div>
              <label className={LABEL_CLS}>Concepto de retención</label>
              <select value={form.concepto_retencion_ganancias} onChange={(e) => {
                const concepto = e.target.value;
                const alicuotas: Record<string, number> = { compraventa_bienes: 2, servicios: 2, honorarios: 2, alquileres_inmuebles: 6, alquileres_muebles: 2, intereses_financieros: 3, intereses_otros: 6, transporte: 0.25, fletes: 0.25, comisiones: 2, publicidad: 2, seguros: 2 };
                setForm({ ...form, concepto_retencion_ganancias: concepto, alicuota_ganancias: concepto ? (alicuotas[concepto] ?? 2) : null });
              }} className={INPUT_CLS}>
                <option value="">Sin definir (usa tasa global)</option>
                {Object.entries(CONCEPTOS_RG830).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Alícuota inscripto (%)</label>
              <input type="number" step="0.25" value={form.alicuota_ganancias ?? ""} onChange={(e) => setForm({ ...form, alicuota_ganancias: e.target.value ? Number(e.target.value) : null })}
                placeholder="Ej: 2 (se completa con ARCA)" title="Se autocompleta al consultar el CUIT en ARCA" className={INPUT_CLS} />
            </div>
            <div className="flex items-center gap-2 pt-4">
              <button type="button" role="switch" aria-checked={form.exclusion_retencion} aria-label="Excluido de retención" onClick={() => setForm({ ...form, exclusion_retencion: !form.exclusion_retencion })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ${form.exclusion_retencion ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${form.exclusion_retencion ? "translate-x-4.5" : "translate-x-0.5"}`} />
              </button>
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Excluido de retención</span>
            </div>
            {form.exclusion_retencion && (
              <>
                <div>
                  <label className={LABEL_CLS}>Exclusión desde</label>
                  <input type="date" value={form.exclusion_retencion_desde || ""} onChange={(e) => setForm({ ...form, exclusion_retencion_desde: e.target.value || null })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Exclusión hasta</label>
                  <input type="date" value={form.exclusion_retencion_hasta || ""} onChange={(e) => setForm({ ...form, exclusion_retencion_hasta: e.target.value || null })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>N° de certificado</label>
                  <input value={form.exclusion_retencion_cert || ""} onChange={(e) => setForm({ ...form, exclusion_retencion_cert: e.target.value || null })} placeholder="N° cert." className={INPUT_CLS} />
                </div>
              </>
            )}
          </SeccionModal>

          {/* Notas y clasificación */}
          <SeccionModal titulo="Notas y clasificación">
            <div className="sm:col-span-2 lg:col-span-4"><label className={LABEL_CLS}>Notas</label><textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={1} className="mt-0.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className={`${LABEL_CLS} flex items-center gap-1`}><Tag className="h-3.5 w-3.5" /> Clasificación del proveedor</label>
              <div className="mt-0.5 flex flex-wrap gap-1.5">
                {CLASIFICACION_TAGS.map((tag) => {
                  const selected = form.clasificacion_tags.includes(tag);
                  const color = selected ? TAG_COLORS[tag] : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500";
                  return (
                    <button key={tag} type="button" aria-pressed={selected} onClick={() => {
                      setForm({ ...form, clasificacion_tags: selected ? form.clasificacion_tags.filter((t) => t !== tag) : [...form.clasificacion_tags, tag] });
                    }} className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-all cursor-pointer border ${selected ? "border-transparent ring-1" : "border-zinc-200 dark:border-zinc-700"} ${color}`}>
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS}>Marcas <span className="font-normal text-zinc-400">(separadas por coma)</span></label>
              <input value={form.marcas} onChange={(e) => setForm({ ...form, marcas: e.target.value })} placeholder="Ej: 3M, Funcional, Pampero" className={INPUT_CLS} />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS}>Comentario de clasificación</label>
              <textarea value={form.clasificacion_nota} onChange={(e) => setForm({ ...form, clasificacion_nota: e.target.value })} rows={1} placeholder="Notas sobre precio, entrega, calidad..." className="mt-0.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            </div>
          </SeccionModal>
          <p className="text-[11px] text-zinc-400">Los talles especiales y la tolerancia de precio de este proveedor se editan en Compras → Limpieza de OC (reglas del proveedor).</p>
        </div>
        <div className="flex justify-end gap-3 border-t border-zinc-200 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          <button onClick={cerrar} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editingId ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>
    </>
  );
}
