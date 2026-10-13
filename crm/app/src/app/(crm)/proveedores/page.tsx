"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { traerTodo } from "@/lib/paginar";
import {
  calcularSaldosProveedores, ultimaCompraPorProveedor, linkWhatsApp, textoLocalidad,
  type FacturaCompraSaldo, type MovimientoPagoFC, type MovimientoNC, type OrdenCompraFecha, type SaldoProveedor,
} from "@/lib/saldo-proveedores";
import { mockProveedores, mockListasPrecios } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase/client";
import type { Proveedor, ListaPrecios, ListaPreciosItem, ListaPreciosRegla } from "@/lib/types";
import { calculateNetPrice } from "@/lib/price-list-rules";
import {
  Search, Download, ListOrdered,
  AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Loader2, X, Pencil, Tag,
  Sparkles, FileUp, Check, Trash2,
  Maximize2, Minimize2, Power, Copy, MessageCircle,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { mostrarWhatsApp } from "@/lib/whatsapp-ar";
import { WhatsAppInput } from "@/components/ui/whatsapp-input";
import { textoCondicionPago, type PlanPago } from "@/lib/condicion-pago";
import { ProveedorFormModal, CONCEPTOS_RG830, TAG_COLORS, type ProveedorForm } from "@/components/proveedor-form-modal";

function ClasificacionTag({ tag }: { tag: string }) {
  const color = TAG_COLORS[tag] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>{tag}</span>;
}

const estadoListaConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  vigente: { label: "Vigente", variant: "success" },
  vencida: { label: "Vencida", variant: "danger" },
  borrador: { label: "Borrador", variant: "warning" },
};

function mapSupabaseProveedor(row: Record<string, unknown>): Proveedor {
  return {
    id: row.id as string,
    razonSocial: row.razon_social as string,
    nombreFantasia: (row.nombre_fantasia as string) ?? "",
    cuit: row.cuit as string,
    condicionIva: (row.condicion_iva as Proveedor["condicionIva"]) ?? "RI",
    email: row.email as string,
    telefono: row.telefono as string,
    direccion: row.direccion as string,
    localidad: row.localidad as string,
    provincia: row.provincia as string,
    banco: (row.banco as string) ?? "",
    cbu: (row.cbu as string) ?? "",
    aliasBancario: (row.alias_bancario as string) ?? "",
    numeroCuenta: (row.numero_cuenta as string) ?? "",
    titularCuenta: (row.titular_cuenta as string) ?? "",
    cuitTitularCuenta: (row.cuit_titular_cuenta as string) ?? "",
    tipoCuenta: (row.tipo_cuenta as string) ?? "",
    contactos: (Array.isArray(row.contactos) ? row.contactos : []).map((c: Record<string, unknown>) => ({
      id: c.id as string, nombre: c.nombre as string, cargo: c.cargo as string,
      email: c.email as string, telefono: c.telefono as string, principal: c.principal as boolean,
    })),
    rubro: (row.rubro as string) ?? "",
    formaPago: (row.forma_pago as string) ?? "",
    diasCuentaCorriente: Number(row.dias_cuenta_corriente) || 0,
    limiteCredito: Number(row.limite_credito) || 0,
    saldoCuentaCorriente: Number(row.saldo_cuenta_corriente) || 0,
    listasDePrecios: (Array.isArray(row.listas_precios) ? row.listas_precios : []).map((lp: Record<string, unknown>) => lp.id as string),
    notas: (row.notas as string) ?? "",
    clasificacionTags: Array.isArray(row.clasificacion_tags) ? (row.clasificacion_tags as string[]) : [],
    marcas: (row.marcas as string) ?? "",
    clasificacionNota: (row.clasificacion_nota as string) ?? "",
    esTransportista: (row.es_transportista as boolean) ?? false,
    activo: (row.activo as boolean) ?? true,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    conceptoRetencionGanancias: (row.concepto_retencion_ganancias as string) ?? "",
    alicuotaGanancias: row.alicuota_ganancias != null ? Number(row.alicuota_ganancias) : null,
    exclusionRetencion: (row.exclusion_retencion as boolean) ?? false,
    exclusionRetencionDesde: (row.exclusion_retencion_desde as string) ?? null,
    exclusionRetencionHasta: (row.exclusion_retencion_hasta as string) ?? null,
    exclusionRetencionCert: (row.exclusion_retencion_cert as string) ?? null,
    tallesEspeciales: Array.isArray(row.talles_especiales) ? (row.talles_especiales as string[]) : [],
    toleranciaPrecioPct: row.tolerancia_precio_pct != null ? Number(row.tolerancia_precio_pct) : 1,
    esPersonalizador: (row.es_personalizador as boolean) ?? false,
    tipoPersonalizacion: (row.tipo_personalizacion as string) ?? "",
    administracionNombre: (row.administracion_nombre as string) ?? "",
    planPago: {
      condicion_pago: row.condicion_pago as string | null, dias_pago: row.dias_pago as number | null, dias_pago_hasta: row.dias_pago_hasta as number | null,
      medios_pago: (row.medios_pago as string[] | null) ?? [], medio_pago_preferido: row.medio_pago_preferido as string | null,
      plazo_cheque_dias: row.plazo_cheque_dias as number | null, descuento_pronto_pago: row.descuento_pronto_pago != null ? Number(row.descuento_pronto_pago) : null,
    } as PlanPago,
  } as Proveedor & { conceptoRetencionGanancias: string; alicuotaGanancias: number | null; exclusionRetencion: boolean; exclusionRetencionDesde: string | null; exclusionRetencionHasta: string | null; exclusionRetencionCert: string | null };
}

function mapSupabaseLista(row: Record<string, unknown>): ListaPrecios {
  const proveedores = row.proveedores as Record<string, unknown> | null;
  const items = Array.isArray(row.lista_precios_items) ? row.lista_precios_items : [];
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    proveedorId: row.proveedor_id as string,
    proveedorNombre: (proveedores?.razon_social as string) ?? "",
    moneda: row.moneda as "USD" | "ARS",
    vigenciaDesde: row.vigencia_desde as string,
    vigenciaHasta: row.vigencia_hasta as string,
    estado: row.estado as ListaPrecios["estado"],
    reglas: (Array.isArray(row.lista_precios_reglas) ? row.lista_precios_reglas : []).map((rule: Record<string, unknown>) => ({
      id: rule.id as string, lista_id: rule.lista_id as string,
      tipo: rule.tipo as ListaPreciosRegla["tipo"], nombre: rule.nombre as string,
      descuento: Number(rule.descuento), categoria: (rule.categoria as string) || null,
      cantidad_desde: rule.cantidad_desde == null ? null : Number(rule.cantidad_desde),
      cantidad_hasta: rule.cantidad_hasta == null ? null : Number(rule.cantidad_hasta),
      vigencia_desde: (rule.vigencia_desde as string) || null, vigencia_hasta: (rule.vigencia_hasta as string) || null,
      prioridad: Number(rule.prioridad) || 0, activa: rule.activa !== false,
    })),
    items: items.map((item: Record<string, unknown>) => ({
      id: item.id as string, codigo: item.codigo as string, descripcion: item.descripcion as string,
      variante: (item.variante as string) || undefined,
      categoria: item.categoria as string, unidad: item.unidad as string, precio: Number(item.precio),
      descuento: Number(item.descuento) || 0, precioNeto: Number(item.precio_neto),
    })),
    archivoOrigen: row.archivo_origen as string,
    notas: (row.notas as string) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}


function BotonCopiar({ valor, onCopiado }: { valor: string; onCopiado?: () => void }) {
  return (
    <button type="button" title="Copiar" aria-label={`Copiar ${valor}`}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(valor).then(() => onCopiado?.(), () => {}); }}
      className="rounded p-0.5 text-zinc-300 hover:text-zinc-600 focus:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300">
      <Copy className="h-3 w-3" />
    </button>
  );
}

type FiltroRapido = "todos" | "deuda" | "transportes" | "talleres" | "inactivos";
const emptyRuleForm = {
  tipo: "global" as ListaPreciosRegla["tipo"],
  nombre: "",
  descuento: 0,
  categoria: "",
  cantidad_desde: "",
  cantidad_hasta: "",
  vigencia_desde: "",
  vigencia_hasta: "",
  prioridad: 0,
};

export default function ProveedoresPage() {
  const { sociedadActiva, role } = useUser();
  const canManagePriceRules = role === "super_admin" || role === "admin" || role === "administrativo";
  const canDeletePriceRules = role === "super_admin" || role === "admin";
  const canManageProveedores = role === "super_admin" || role === "admin" || role === "administrativo";
  const canDeleteProveedores = role === "super_admin" || role === "admin";
  const [tab, setTab] = useState<"proveedores" | "listas">("proveedores");
  const [search, setSearch] = useState("");
  const [filtroRapido, setFiltroRapido] = useState<FiltroRapido>("todos");
  const [orden, setOrden] = useState<{ col: "proveedor" | "saldo" | "ultima"; dir: "asc" | "desc" }>({ col: "proveedor", dir: "asc" });
  // Saldo a pagar y última compra: se calculan de facturas de compra, pagos y OC (igual que la CC de Finanzas)
  const [saldos, setSaldos] = useState<Record<string, SaldoProveedor>>({});
  const [ultimaCompra, setUltimaCompra] = useState<Record<string, string>>({});
  const [saldosCargando, setSaldosCargando] = useState(false);
  const [saldosError, setSaldosError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterLista, setFilterLista] = useState<string>("todas");
  const [ruleListId, setRuleListId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [ruleSaving, setRuleSaving] = useState(false);

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [listas, setListas] = useState<ListaPrecios[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalInicial, setModalInicial] = useState<Partial<ProveedorForm> | undefined>(undefined);

  // Auto-open create modal from ?crear= query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const crearNombre = params.get("crear");
    if (params.has("crear")) {
      setEditingId(null);
      setModalInicial({ razon_social: crearNombre || "", es_transportista: params.get("tipo") === "transportista" });
      setModalOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Detail
  const [selectedProv, setSelectedProv] = useState<Proveedor | null>(null);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  type ProveedorContactoForm = { id?: string; nombre: string; cargo: string; email: string; telefono: string; whatsapp: string; principal: boolean; notas: string };
  const emptyProveedorContacto: ProveedorContactoForm = { nombre: "", cargo: "", email: "", telefono: "", whatsapp: "", principal: false, notas: "" };
  const [proveedorContactoForm, setProveedorContactoForm] = useState<ProveedorContactoForm>(emptyProveedorContacto);
  const [editingProveedorContacto, setEditingProveedorContacto] = useState(false);
  const [savingProveedorContacto, setSavingProveedorContacto] = useState(false);
  const [mutatingProveedorId, setMutatingProveedorId] = useState<string | null>(null);

  // AI Upload
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState<{
    nombre_lista: string;
    proveedor: string;
    moneda: string;
    vigencia_desde: string | null;
    vigencia_hasta: string | null;
    notas: string;
    items: Array<{
      codigo: string;
      descripcion: string;
      variante?: string;
      categoria: string;
      unidad: string;
      precio: number;
      descuento: number;
      precio_neto: number;
    }>;
  } | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiProveedorId, setAiProveedorId] = useState("");
  const [aiNewProvOpen, setAiNewProvOpen] = useState(false);
  const [aiNewProvForm, setAiNewProvForm] = useState({ razon_social: "", cuit: "", rubro: "" });
  const [aiNewProvSaving, setAiNewProvSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let provQuery = supabase.from("proveedores").select(`*, listas_precios(id, nombre, moneda, vigencia_hasta, estado)`).order("razon_social");
      let listasQuery = supabase.from("listas_precios").select(`*, proveedores(razon_social), lista_precios_items(*), lista_precios_reglas(*)`).order("created_at", { ascending: false });
      if (sociedadActiva?.id) {
        provQuery = provQuery.eq("sociedad_id" as any, sociedadActiva.id);
        listasQuery = listasQuery.eq("sociedad_id" as any, sociedadActiva.id);
      }
      const [provRes, listasRes] = await Promise.all([provQuery, listasQuery]);

      if (provRes.error) {
        setProveedores(mockProveedores);
      } else {
        setProveedores((provRes.data || []).map((r) => mapSupabaseProveedor(r as Record<string, unknown>)));
      }
      if (listasRes.error) {
        setListas(mockListasPrecios);
      } else {
        setListas((listasRes.data || []).map((r) => mapSupabaseLista(r as Record<string, unknown>)));
      }
    } catch (err) {
      console.error("Error fetching proveedores:", err);
      setProveedores(mockProveedores);
      setListas(mockListasPrecios);
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch contactos when a proveedor is selected (polymorphic table, no FK join)
  useEffect(() => {
    if (!selectedProv) return;
    async function fetchContactos() {
      try {
        const { data } = await supabase
          .from("contactos")
          .select("*")
          .eq("entity_type", "proveedor")
          .eq("entity_id", selectedProv!.id);
        if (data && data.length > 0) {
          const mapped = data.map((c: Record<string, unknown>) => ({
            id: c.id as string, nombre: (c.nombre as string) ?? "",
            cargo: (c.cargo as string) ?? "", email: (c.email as string) ?? "",
            telefono: (c.telefono as string) ?? "", whatsapp: (c.whatsapp as string) ?? "", notas: (c.notas as string) ?? "", principal: (c.principal as boolean) ?? false,
          }));
          setSelectedProv((prev) => prev ? { ...prev, contactos: mapped } : prev);
        }
      } catch (err) {
        console.error("Error fetching contactos:", err);
      }
    }
    fetchContactos();
  }, [selectedProv?.id]);

  // Saldo a pagar por proveedor + fecha de última compra (consultas en bloque, de a 1000 filas)
  useEffect(() => {
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) { setSaldos({}); setUltimaCompra({}); return; }
    let cancelado = false;
    setSaldosCargando(true);
    setSaldosError("");
    (async () => {
      try {
        const db = supabase as any;
        const [facturas, pagos, ordenes] = await Promise.all([
          traerTodo<FacturaCompraSaldo>(() => db.from("facturas_compra")
            .select("id, proveedor_id, total, total_acreditado, moneda, estado, tipo_comprobante, fecha, op_facturas_compra(monto, ordenes_pago(estado))")
            .eq("sociedad_id", sociedadId).order("id")),
          traerTodo<MovimientoPagoFC>(() => db.from("movimientos")
            .select("id, factura_compra_id, monto, retencion_ganancias_monto, anulado, nota_credito_compra_id")
            .eq("sociedad_id", sociedadId).eq("tipo", "pago").not("factura_compra_id", "is", null).order("id")),
          traerTodo<OrdenCompraFecha>(() => db.from("ordenes_compra")
            .select("id, proveedor_id, fecha, estado")
            .eq("sociedad_id", sociedadId).order("id")),
        ]);
        // Crédito ya aplicado de cada NC (igual que Finanzas: por id de NC)
        const ncIds = facturas
          .filter((f) => f.estado !== "anulada" && String(f.tipo_comprobante || "").toUpperCase().startsWith("NC"))
          .map((f) => f.id);
        const movNC: MovimientoNC[] = [];
        for (let i = 0; i < ncIds.length; i += 200) {
          const tramo = ncIds.slice(i, i + 200);
          movNC.push(...await traerTodo<MovimientoNC>(() => db.from("movimientos")
            .select("id, nota_credito_compra_id, monto, anulado").in("nota_credito_compra_id", tramo).order("id")));
        }
        if (cancelado) return;
        setSaldos(calcularSaldosProveedores(facturas, pagos, movNC));
        setUltimaCompra(ultimaCompraPorProveedor(facturas, ordenes));
      } catch (err) {
        console.error("Error calculando saldos de proveedores:", err);
        if (!cancelado) setSaldosError("No se pudieron calcular los saldos a pagar. Mirá la cuenta corriente en Finanzas.");
      } finally {
        if (!cancelado) setSaldosCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [sociedadActiva?.id]);

  function startProveedorContacto(contacto?: any) {
    setProveedorContactoForm(contacto ? { id: contacto.id, nombre: contacto.nombre ?? "", cargo: contacto.cargo ?? "", email: contacto.email ?? "", telefono: contacto.telefono ?? "", whatsapp: contacto.whatsapp ?? "", principal: !!contacto.principal, notas: contacto.notas ?? "" } : emptyProveedorContacto);
    setEditingProveedorContacto(true);
  }

  async function saveProveedorContacto() {
    if (!selectedProv || !proveedorContactoForm.nombre.trim()) return;
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de guardar el contacto");
      return;
    }
    setSavingProveedorContacto(true);
    try {
      const payload = { nombre: proveedorContactoForm.nombre.trim(), cargo: "Ventas", email: proveedorContactoForm.email.trim() || null, telefono: proveedorContactoForm.telefono.trim() || null, whatsapp: proveedorContactoForm.whatsapp.trim() || null, notas: proveedorContactoForm.notas.trim() || null, principal: proveedorContactoForm.principal };
      const q = (supabase as any).from("contactos");
      const result = proveedorContactoForm.id
        ? await q.update(payload).eq("id", proveedorContactoForm.id).eq("entity_id", selectedProv.id)
        : await q.insert({ ...payload, entity_type: "proveedor", entity_id: selectedProv.id });
      if (result.error) throw result.error;
      const { data } = await q.select("*").eq("entity_type", "proveedor").eq("entity_id", selectedProv.id).order("principal", { ascending: false });
      setSelectedProv((prev) => prev ? { ...prev, contactos: (data ?? []) as any } : prev);
      setProveedorContactoForm(emptyProveedorContacto); setEditingProveedorContacto(false); toast.success("Contacto guardado");
    } catch { toast.error("No se pudo guardar el contacto"); } finally { setSavingProveedorContacto(false); }
  }

  async function deleteProveedorContacto(id: string) {
    if (!selectedProv) return;
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de eliminar el contacto");
      return;
    }
    if (!confirm("¿Eliminar este contacto?")) return;
    const { error } = await (supabase as any).from("contactos").delete().eq("id", id).eq("entity_id", selectedProv.id);
    if (error) { toast.error("No se pudo eliminar el contacto"); return; }
    setSelectedProv((prev) => prev ? { ...prev, contactos: prev.contactos.filter((c) => c.id !== id) } : prev);
    toast.success("Contacto eliminado");
  }

  async function updateProveedorActivo(proveedor: Proveedor, activo: boolean) {
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) throw new Error("Seleccioná una sociedad antes de cambiar el estado");

    const { data, error } = await (supabase as any)
      .from("proveedores")
      .update({ activo })
      .eq("id", proveedor.id)
      .eq("sociedad_id", sociedadId)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("No se pudo actualizar el proveedor en la sociedad seleccionada");

    setProveedores((prev) => prev.map((p) => p.id === proveedor.id ? { ...p, activo } : p));
    setSelectedProv((prev) => prev?.id === proveedor.id ? { ...prev, activo } : prev);
    toast.info(activo ? "Proveedor reactivado" : "Proveedor desactivado");
  }

  async function handleToggleProveedorActivo(proveedor: Proveedor) {
    if (!canManageProveedores) {
      toast.error("No tenés permiso para cambiar el estado del proveedor");
      return;
    }
    if (proveedor.activo && !confirm(`¿Desactivar a “${proveedor.razonSocial}”? Dejará de estar disponible para nuevas operaciones.`)) return;

    setMutatingProveedorId(proveedor.id);
    try {
      await updateProveedorActivo(proveedor, !proveedor.activo);
    } catch (err) {
      console.error("Error toggling proveedor:", err);
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar el estado del proveedor");
    } finally {
      setMutatingProveedorId(null);
    }
  }

  async function handleDeleteProveedor(proveedor: Proveedor) {
    const sociedadId = sociedadActiva?.id;
    if (!canDeleteProveedores) {
      toast.error("No tenés permiso para eliminar proveedores");
      return;
    }
    if (!sociedadId) {
      toast.error("Seleccioná una sociedad antes de eliminar el proveedor");
      return;
    }

    setMutatingProveedorId(proveedor.id);
    try {
      const dependencyDefinitions = [
        { table: "productos", column: "proveedor_id", label: "artículo" },
        { table: "listas_precios", column: "proveedor_id", label: "lista de precios" },
        { table: "ordenes_compra", column: "proveedor_id", label: "orden de compra" },
        { table: "facturas_compra", column: "proveedor_id", label: "factura de compra" },
        { table: "ordenes_pago", column: "proveedor_id", label: "orden de pago" },
        { table: "movimientos", column: "proveedor_id", label: "movimiento financiero" },
        { table: "presupuesto_items", column: "proveedor_id", label: "ítem de presupuesto" },
        { table: "extracto_movimientos", column: "match_proveedor_id", label: "movimiento de extracto" },
        { table: "lineas_credito", column: "proveedor_id", label: "línea de crédito" },
        { table: "pago_solicitudes", column: "proveedor_id", label: "registro de pago" },
        { table: "saldos_favor_proveedor", column: "proveedor_id", label: "saldo a favor" },
      ];

      const dependencyResults = await Promise.all(dependencyDefinitions.map(async (definition) => {
        const { count, error } = await (supabase as any)
          .from(definition.table)
          .select("id", { count: "exact", head: true })
          .eq(definition.column, proveedor.id);
        if (error) throw new Error(`No se pudo verificar ${definition.label}: ${error.message}`);
        return { ...definition, count: count ?? 0 };
      }));

      const dependencies = dependencyResults.filter((result) => result.count > 0);
      if (dependencies.length > 0) {
        const detail = dependencies
          .map((result) => `${result.count} ${result.label}${result.count === 1 ? "" : "s"}`)
          .join(", ");
        if (!proveedor.activo) {
          alert(`No se puede eliminar este proveedor porque conserva historial asociado: ${detail}. Ya se encuentra desactivado.`);
          return;
        }
        if (confirm(`No se puede eliminar este proveedor porque conserva historial asociado: ${detail}.\n\n¿Querés desactivarlo para impedir nuevas operaciones?`)) {
          await updateProveedorActivo(proveedor, false);
        }
        return;
      }

      if (!confirm(`¿Eliminar definitivamente a “${proveedor.razonSocial}”? Esta acción no se puede deshacer.`)) return;

      const { data, error } = await (supabase as any)
        .from("proveedores")
        .delete()
        .eq("id", proveedor.id)
        .eq("sociedad_id", sociedadId)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("No se eliminó ningún proveedor");

      const { error: contactosError } = await (supabase as any)
        .from("contactos")
        .delete()
        .eq("entity_type", "proveedor")
        .eq("entity_id", proveedor.id);
      if (contactosError) console.error("No se pudieron limpiar los contactos del proveedor eliminado:", contactosError);

      setSelectedProv(null);
      setPanelFullscreen(false);
      toast.success("Proveedor eliminado definitivamente");
      await fetchData();
    } catch (err: any) {
      console.error("Error deleting proveedor:", err);
      if (err?.code === "23503" && proveedor.activo) {
        if (confirm("La base detectó historial relacionado y bloqueó la eliminación. ¿Querés desactivar el proveedor?")) {
          try {
            await updateProveedorActivo(proveedor, false);
            return;
          } catch (toggleError) {
            console.error("Error deactivating proveedor:", toggleError);
          }
        }
      }
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar el proveedor");
    } finally {
      setMutatingProveedorId(null);
    }
  }

  const saldoDe = (id: string): SaldoProveedor => saldos[id] || { ARS: 0, USD: 0 };
  const tieneDeuda = (id: string) => saldoDe(id).ARS > 0.005 || saldoDe(id).USD > 0.005;
  const pasaFiltroRapido = (p: Proveedor, f: FiltroRapido) => {
    if (f === "inactivos") return !p.activo;
    if (!p.activo) return false;
    if (f === "deuda") return tieneDeuda(p.id);
    if (f === "transportes") return Boolean(p.esTransportista);
    if (f === "talleres") return Boolean((p as any).esPersonalizador);
    return true;
  };
  const coincideBusqueda = (p: Proveedor) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    const qDigitos = q.replace(/\D/g, "");
    const textos = [p.razonSocial, (p as any).nombreFantasia, p.rubro, p.localidad, p.provincia, p.email];
    if (textos.some((t) => String(t || "").toLowerCase().includes(q))) return true;
    return qDigitos.length >= 3 && String(p.cuit || "").replace(/\D/g, "").includes(qDigitos);
  };
  const proveedoresBuscados = proveedores.filter(coincideBusqueda);
  const filteredProveedores = proveedoresBuscados
    .filter((p) => pasaFiltroRapido(p, filtroRapido))
    .sort((a, b) => {
      const signo = orden.dir === "asc" ? 1 : -1;
      if (orden.col === "saldo") return signo * (saldoDe(a.id).ARS - saldoDe(b.id).ARS || saldoDe(a.id).USD - saldoDe(b.id).USD);
      if (orden.col === "ultima") return signo * String(ultimaCompra[a.id] || "").localeCompare(String(ultimaCompra[b.id] || ""));
      return signo * a.razonSocial.localeCompare(b.razonSocial, "es");
    });
  const FILTROS_RAPIDOS: { id: FiltroRapido; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "deuda", label: "Con deuda" },
    { id: "transportes", label: "Transportes" },
    { id: "talleres", label: "Talleres" },
    { id: "inactivos", label: "Inactivos" },
  ];
  const totalVisible = filteredProveedores.reduce((acc, p) => ({ ARS: acc.ARS + saldoDe(p.id).ARS, USD: acc.USD + saldoDe(p.id).USD }), { ARS: 0, USD: 0 });
  function cambiarOrden(col: "proveedor" | "saldo" | "ultima") {
    setOrden((prev) => prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "proveedor" ? "asc" : "desc" });
  }

  const filteredListas = listas.filter((lp) => {
    if (filterLista !== "todas" && lp.estado !== filterLista) return false;
    if (search && !lp.nombre.toLowerCase().includes(search.toLowerCase()) && !lp.proveedorNombre.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const listasVencidas = listas.filter((l) => l.estado === "vencida").length;

  function openCreate() {
    setEditingId(null);
    setModalInicial(undefined);
    setModalOpen(true);
  }

  function openEdit(p: Proveedor) {
    setEditingId(p.id);
    setModalInicial(undefined);
    setModalOpen(true);
  }

  async function handleRuleSave(listaId: string) {
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) { toast.error("Seleccioná una sociedad antes de guardar la regla"); return; }
    if (!ruleForm.nombre.trim()) { toast.warning("Indicá un nombre para la regla"); return; }
    if (ruleForm.descuento < 0 || ruleForm.descuento > 100) { toast.warning("El descuento debe estar entre 0 y 100%"); return; }
    if (ruleForm.tipo === "categoria" && !ruleForm.categoria.trim()) { toast.warning("Indicá la categoría"); return; }
    if (ruleForm.tipo === "cantidad" && ruleForm.cantidad_desde === "" && ruleForm.cantidad_hasta === "") { toast.warning("Indicá al menos un límite de cantidad"); return; }
    setRuleSaving(true);
    try {
      const payload = {
        lista_id: listaId,
        sociedad_id: sociedadId,
        tipo: ruleForm.tipo,
        nombre: ruleForm.nombre.trim(),
        descuento: Number(ruleForm.descuento),
        categoria: ruleForm.tipo === "global" ? null : (ruleForm.categoria.trim() || null),
        cantidad_desde: ruleForm.tipo === "cantidad" && ruleForm.cantidad_desde !== "" ? Number(ruleForm.cantidad_desde) : null,
        cantidad_hasta: ruleForm.tipo === "cantidad" && ruleForm.cantidad_hasta !== "" ? Number(ruleForm.cantidad_hasta) : null,
        vigencia_desde: ruleForm.vigencia_desde || null,
        vigencia_hasta: ruleForm.vigencia_hasta || null,
        prioridad: Number(ruleForm.prioridad) || 0,
        activa: true,
      };
      const { error } = await (supabase as any).from("lista_precios_reglas").insert(payload);
      if (error) throw error;
      setRuleForm(emptyRuleForm);
      setRuleListId(null);
      await fetchData();
      toast.success("Regla de costo guardada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la regla");
    } finally {
      setRuleSaving(false);
    }
  }

  async function handleRuleDelete(rule: ListaPreciosRegla) {
    if (!sociedadActiva?.id || !confirm(`¿Eliminar la regla “${rule.nombre}”?`)) return;
    const { error } = await (supabase as any).from("lista_precios_reglas").delete()
      .eq("id", rule.id).eq("sociedad_id", sociedadActiva.id);
    if (error) { toast.error(error.message); return; }
    await fetchData();
    toast.success("Regla eliminada");
  }

  function openAiUpload() {
    setAiFile(null);
    setAiResult(null);
    setAiError("");
    setAiProveedorId("");
    setAiModalOpen(true);
  }

  async function handleAiParse() {
    if (!aiFile) return;
    setAiParsing(true);
    setAiError("");
    setAiResult(null);

    try {
      const formData = new FormData();
      formData.append("file", aiFile);

      const res = await fetch("/api/parse-lista-precios", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setAiError(data.error || "Error al procesar el archivo");
        return;
      }

      setAiResult(data.data);

      // Auto-select proveedor if name matches
      if (data.data.proveedor) {
        const match = proveedores.find(
          (p) => p.razonSocial.toLowerCase().includes(data.data.proveedor.toLowerCase())
        );
        if (match) setAiProveedorId(match.id);
      }
    } catch {
      setAiError("Error de conexion. Intenta de nuevo.");
    } finally {
      setAiParsing(false);
    }
  }

  async function handleAiCreateNewProv() {
    if (!aiNewProvForm.razon_social.trim()) return;
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      alert("Seleccioná una sociedad antes de crear el proveedor");
      return;
    }
    setAiNewProvSaving(true);
    try {
      const insertData: Record<string, unknown> = {
        razon_social: aiNewProvForm.razon_social.trim(),
        rubro: aiNewProvForm.rubro.trim() || "General",
        activo: true,
      };
      if (aiNewProvForm.cuit.trim()) insertData.cuit = aiNewProvForm.cuit.trim();
      insertData.sociedad_id = sociedadId;
      const { data, error } = await supabase.from("proveedores").insert(insertData as any).select("id").single();
      if (error) throw error;
      await fetchData();
      setAiProveedorId(data.id);
      setAiNewProvOpen(false);
      setAiNewProvForm({ razon_social: "", cuit: "", rubro: "" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: string }).message) : String(err);
      alert("Error creando proveedor: " + msg);
    } finally {
      setAiNewProvSaving(false);
    }
  }

  async function handleAiSave() {
    if (!aiResult || !aiProveedorId) return;
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      toast.error("Seleccioná una sociedad antes de guardar la lista");
      return;
    }
    setAiSaving(true);

    try {
      // Create the lista
      const listaInsert: Record<string, unknown> = {
          nombre: aiResult.nombre_lista || `Lista ${new Date().toLocaleDateString("es-AR")}`,
          proveedor_id: aiProveedorId,
          moneda: aiResult.moneda === "USD" ? "USD" : "ARS",
          vigencia_desde: aiResult.vigencia_desde || new Date().toISOString().slice(0, 10),
          vigencia_hasta: aiResult.vigencia_hasta || new Date(new Date().setMonth(new Date().getMonth() + 2)).toISOString().slice(0, 10),
          estado: "vigente",
          archivo_origen: aiFile?.name || null,
          notas: aiResult.notas || "",
      };
      listaInsert.sociedad_id = sociedadId;
      const { data: lista, error: listaError } = await supabase
        .from("listas_precios")
        .insert(listaInsert as any)
        .select("id")
        .single();

      if (listaError) throw listaError;

      // Insert items
      if (lista && aiResult.items.length > 0) {
        const items = aiResult.items.map((item) => ({
          lista_id: lista.id,
          codigo: item.codigo,
          descripcion: item.descripcion,
          variante: item.variante || null,
          categoria: item.categoria,
          unidad: item.unidad,
          precio: item.precio,
          descuento: item.descuento || 0,
          precio_neto: item.precio_neto,
          sociedad_id: sociedadId,
        }));

        const { error: itemsError } = await (supabase as any)
          .from("lista_precios_items")
          .insert(items);

        if (itemsError) throw itemsError;
      }

      toast.success(`Lista creada con ${aiResult.items.length} articulos`);
      setAiModalOpen(false);
      await fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: string }).message) : "Error al guardar";
      toast.error(msg);
    } finally {
      setAiSaving(false);
    }
  }

  function removeAiItem(index: number) {
    if (!aiResult) return;
    setAiResult({
      ...aiResult,
      items: aiResult.items.filter((_, i) => i !== index),
    });
  }

  function exportCSV() {
    const headers = ["Razon Social", "Nombre de fantasia", "CUIT", "Email", "Celular", "Localidad", "Provincia", "Saldo a pagar ARS", "Saldo a pagar USD", "Ultima compra"];
    const rows = filteredProveedores.map((p) => [
      p.razonSocial, (p as any).nombreFantasia, p.cuit, p.email, p.telefono, p.localidad, p.provincia,
      saldoDe(p.id).ARS.toFixed(2), saldoDe(p.id).USD.toFixed(2), ultimaCompra[p.id] || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proveedores_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <>
        <Header title="Proveedores" subtitle="Cargando datos..." action={{ label: "Nuevo proveedor", onClick: () => {} }} />
        <div className="flex items-center justify-center p-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Proveedores"
        subtitle={`${proveedores.length} proveedores — ${listas.length} listas de precios`}
        action={{ label: tab === "proveedores" ? "Nuevo proveedor" : "Cargar lista con IA", onClick: tab === "proveedores" ? openCreate : openAiUpload }}
      />
      <div className="p-3 sm:p-5 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          {(["proveedores", "listas"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setSearch(""); }}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700"}`}>
              {t === "proveedores" ? "Proveedores" : "Listas de precios"}
            </button>
          ))}
        </div>

        {/* -- TAB: Proveedores -- */}
        {tab === "proveedores" && (
          <>
            {/* Búsqueda, filtros rápidos y exportar en una sola línea */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input type="text" placeholder="Buscar por nombre, fantasía, CUIT o localidad..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900" />
              </div>
              <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800" role="group" aria-label="Filtros rápidos">
                {FILTROS_RAPIDOS.map((f) => {
                  const cantidad = proveedoresBuscados.filter((p) => pasaFiltroRapido(p, f.id)).length;
                  const activo = filtroRapido === f.id;
                  return (
                    <button key={f.id} type="button" aria-pressed={activo} onClick={() => setFiltroRapido(f.id)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${activo ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                      {f.label} <span className="text-zinc-400">{cantidad}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={exportCSV} className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"><Download className="h-4 w-4" /> Exportar</button>
            </div>
            {saldosError && <p className="text-xs text-amber-600">{saldosError}</p>}

            <Card className="p-0 overflow-hidden">
              <div className="max-h-[calc(100vh-14rem)] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900">
                    <tr className="border-b border-zinc-200 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      {([
                        { col: "proveedor", label: "Proveedor", cls: "" },
                        { col: null, label: "Contacto", cls: "" },
                        { col: null, label: "Localidad", cls: "" },
                        { col: "saldo", label: "Saldo a pagar", cls: "text-right" },
                        { col: "ultima", label: "Última compra", cls: "" },
                      ] as const).map((h) => (
                        <th key={h.label} className={`whitespace-nowrap px-3 py-2 ${h.cls}`} aria-sort={h.col && orden.col === h.col ? (orden.dir === "asc" ? "ascending" : "descending") : undefined}>
                          {h.col ? (
                            <button type="button" onClick={() => cambiarOrden(h.col!)} className="inline-flex items-center gap-0.5 uppercase hover:text-zinc-800 dark:hover:text-zinc-200">
                              {h.label}
                              {orden.col === h.col && (orden.dir === "asc" ? <ChevronUp className="h-3 w-3 text-orange-500" /> : <ChevronDown className="h-3 w-3 text-orange-500" />)}
                            </button>
                          ) : h.label}
                        </th>
                      ))}
                      <th className="px-3 py-2"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredProveedores.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-12 text-center text-sm text-zinc-400">No hay proveedores para mostrar</td></tr>
                    )}
                    {filteredProveedores.map((row) => {
                      const fantasia = String((row as any).nombreFantasia || "").trim();
                      const esTaller = Boolean((row as any).esPersonalizador);
                      const wa = linkWhatsApp(row.telefono);
                      const loc = textoLocalidad(row.localidad, row.provincia);
                      const saldo = saldoDe(row.id);
                      const ultima = ultimaCompra[row.id];
                      return (
                        <tr key={row.id} onClick={() => setSelectedProv(row)} className="group cursor-pointer transition-colors hover:bg-orange-50/50 dark:hover:bg-orange-950/20">
                          <td className="px-3 py-1.5 align-top">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-zinc-900 dark:text-white">{row.razonSocial}</span>
                              {row.esTransportista && <Badge variant="orange">Transporte</Badge>}
                              {esTaller && <Badge variant="purple">Taller</Badge>}
                              {!row.activo && <Badge variant="outline">Inactivo</Badge>}
                            </div>
                            <div className="text-xs text-zinc-400">{fantasia && <span className="text-zinc-500 dark:text-zinc-400">{fantasia} · </span>}{row.cuit || "Sin CUIT"}</div>
                          </td>
                          <td className="px-3 py-1.5 align-top text-xs text-zinc-600 dark:text-zinc-300">
                            {row.email && (
                              <div className="flex items-center gap-1">
                                <a href={`mailto:${row.email}`} onClick={(e) => e.stopPropagation()} className="max-w-[220px] truncate hover:text-orange-600">{row.email}</a>
                                <BotonCopiar valor={row.email} onCopiado={() => toast.success("Email copiado")} />
                              </div>
                            )}
                            {row.telefono && (
                              <div className="flex items-center gap-1">
                                <span className="text-zinc-400">Cel.</span><span>{row.telefono}</span>
                                <BotonCopiar valor={row.telefono} onCopiado={() => toast.success("Celular copiado")} />
                                {wa && <a href={wa} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Abrir WhatsApp" aria-label="Abrir WhatsApp" className="rounded p-0.5 text-emerald-600 hover:text-emerald-700"><MessageCircle className="h-3.5 w-3.5" /></a>}
                              </div>
                            )}
                            {!row.email && !row.telefono && <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-3 py-1.5 align-top text-xs text-zinc-500">{loc || <span className="text-zinc-300">—</span>}</td>
                          <td className="px-3 py-1.5 align-top text-right font-mono whitespace-nowrap">
                            {saldosCargando ? <span className="text-zinc-300">…</span> : (
                              <>
                                {saldo.ARS > 0.005 ? <span className="block text-red-600">{formatCurrency(saldo.ARS, "ARS")}</span>
                                  : saldo.ARS < -0.005 ? <span className="block text-emerald-600" title="Saldo a favor (notas de crédito sin usar)">{formatCurrency(saldo.ARS, "ARS")}</span>
                                  : saldo.USD === 0 ? <span className="text-zinc-300">—</span> : null}
                                {Math.abs(saldo.USD) > 0.005 && <span className={`block text-xs ${saldo.USD > 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(saldo.USD, "USD")}</span>}
                              </>
                            )}
                          </td>
                          <td className="px-3 py-1.5 align-top whitespace-nowrap text-xs text-zinc-500">{ultima ? formatDate(ultima) : <span className="text-zinc-300">—</span>}</td>
                          <td className="px-3 py-1.5 align-top">
                            <div className="flex justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                              {canManageProveedores && <button onClick={(e) => { e.stopPropagation(); handleToggleProveedorActivo(row); }} disabled={mutatingProveedorId === row.id} className={`rounded p-1 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800 ${row.activo ? "text-zinc-400 hover:text-amber-600" : "text-emerald-600 hover:text-emerald-700"}`} title={row.activo ? "Desactivar" : "Reactivar"} aria-label={row.activo ? "Desactivar" : "Reactivar"}>
                                <Power className="h-3.5 w-3.5" />
                              </button>}
                              {canManageProveedores && <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Editar" aria-label="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>}
                              {canDeleteProveedores && <button onClick={(e) => { e.stopPropagation(); handleDeleteProveedor(row); }} disabled={mutatingProveedorId === row.id} className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" title="Eliminar" aria-label="Eliminar">
                                {mutatingProveedorId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-zinc-50 dark:bg-zinc-900">
                    <tr className="border-t border-zinc-200 dark:border-zinc-700">
                      <td colSpan={3} className="px-3 py-2 text-xs text-zinc-500">{filteredProveedores.length} proveedor{filteredProveedores.length === 1 ? "" : "es"}</td>
                      <td className="px-3 py-2 text-right font-mono text-sm font-semibold whitespace-nowrap">
                        {saldosCargando ? <span className="text-zinc-300">…</span> : (
                          <>
                            <span className={`block ${totalVisible.ARS > 0.005 ? "text-red-600" : "text-zinc-500"}`}>{formatCurrency(totalVisible.ARS, "ARS")}</span>
                            {Math.abs(totalVisible.USD) > 0.005 && <span className="block text-xs text-red-600">{formatCurrency(totalVisible.USD, "USD")}</span>}
                          </>
                        )}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </>
        )}

        {/* -- TAB: Listas de precios -- */}
        {tab === "listas" && (
          <>
            {listasVencidas > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <div><p className="font-medium text-amber-800">{listasVencidas} lista(s) vencida(s)</p><p className="text-sm text-amber-600">Solicita la actualizacion a los proveedores correspondientes.</p></div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-2">
                {(["todas", "vigente", "vencida", "borrador"] as const).map((estado) => {
                  const count = estado === "todas" ? listas.length : listas.filter(l => l.estado === estado).length;
                  return (
                    <button key={estado} onClick={() => setFilterLista(estado)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${filterLista === estado ? "bg-orange-500 text-white" : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}>
                      {estado === "todas" ? "Todas" : estadoListaConfig[estado].label} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input type="text" placeholder="Buscar lista o proveedor..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm text-zinc-900 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
              </div>
            </div>
            <div className="space-y-4">
              {filteredListas.map((lista) => {
                const isExpanded = expandedId === lista.id;
                const cfg = estadoListaConfig[lista.estado] || { label: lista.estado, variant: "outline" as const };
                return (
                  <Card key={lista.id} className="p-0 overflow-hidden">
                    <button onClick={() => setExpandedId(isExpanded ? null : lista.id)}
                      className="flex w-full items-center justify-between p-5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><ListOrdered className="h-5 w-5" /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-zinc-900 dark:text-white">{lista.nombre}</h3>
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            <Badge variant="outline">{lista.moneda}</Badge>
                          </div>
                          <p className="text-sm text-zinc-500">{lista.proveedorNombre} — {lista.items.length} articulos</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-zinc-400">Vigencia</p>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">{lista.vigenciaDesde} — {lista.vigenciaHasta}</p>
                        </div>
                        {isExpanded ? <ChevronDown className="h-5 w-5 text-zinc-400" /> : <ChevronRight className="h-5 w-5 text-zinc-400" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-zinc-200 dark:border-zinc-700">
                        {lista.notas && <div className="bg-zinc-50 dark:bg-zinc-800 px-5 py-2.5 text-sm text-zinc-500">{lista.notas}</div>}
                        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Reglas de costo</h4>
                              <p className="text-xs text-zinc-500">Mayor prioridad gana; en empate: tramo, categoría y global. El neto manual se conserva como base.</p>
                            </div>
                            {canManagePriceRules && <button type="button" onClick={() => { setRuleListId(ruleListId === lista.id ? null : lista.id); setRuleForm(emptyRuleForm); }}
                              className="rounded-lg border border-orange-300 px-3 py-1.5 text-xs font-medium text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/20">
                              {ruleListId === lista.id ? "Cancelar" : "Agregar regla"}
                            </button>}
                          </div>
                          {(lista.reglas || []).length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {[...(lista.reglas || [])].sort((a, b) => b.prioridad - a.prioridad || a.nombre.localeCompare(b.nombre)).map(rule => (
                                <div key={rule.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                                  <Badge variant={rule.tipo === "cantidad" ? "purple" : rule.tipo === "categoria" ? "info" : "outline"}>{rule.tipo}</Badge>
                                  <span className="font-medium">{rule.nombre}</span>
                                  <span className="font-mono text-emerald-600">-{rule.descuento}%</span>
                                  {rule.categoria && <span className="text-zinc-500">{rule.categoria}</span>}
                                  {rule.tipo === "cantidad" && <span className="text-zinc-500">{rule.cantidad_desde ?? 0}–{rule.cantidad_hasta ?? "∞"} un.</span>}
                                  <span className="text-zinc-400">P{rule.prioridad}</span>
                                  {(rule.vigencia_desde || rule.vigencia_hasta) && <span className="text-zinc-400">{rule.vigencia_desde || "…"} → {rule.vigencia_hasta || "…"}</span>}
                                  {canDeletePriceRules && <button type="button" onClick={() => handleRuleDelete(rule)} className="rounded p-0.5 text-zinc-400 hover:text-red-500" title="Eliminar regla"><Trash2 className="h-3 w-3" /></button>}
                                </div>
                              ))}
                            </div>
                          ) : <p className="mt-2 text-xs italic text-zinc-400">Sin reglas: se usa el precio neto manual de cada ítem.</p>}

                          {ruleListId === lista.id && (
                            <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-orange-200 bg-orange-50/40 p-3 sm:grid-cols-4 dark:border-orange-900/50 dark:bg-orange-950/10">
                              <div className="col-span-2"><label className="text-xs text-zinc-500">Nombre *</label><input value={ruleForm.nombre} onChange={e => setRuleForm({ ...ruleForm, nombre: e.target.value })} placeholder="Ej. Mayorista septiembre" className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
                              <div><label className="text-xs text-zinc-500">Tipo</label><select value={ruleForm.tipo} onChange={e => setRuleForm({ ...ruleForm, tipo: e.target.value as ListaPreciosRegla["tipo"] })} className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"><option value="global">Global</option><option value="categoria">Categoría</option><option value="cantidad">Tramo cantidad</option></select></div>
                              <div><label className="text-xs text-zinc-500">Descuento %</label><input type="number" min="0" max="100" step="0.01" value={ruleForm.descuento} onChange={e => setRuleForm({ ...ruleForm, descuento: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
                              {ruleForm.tipo !== "global" && <div><label className="text-xs text-zinc-500">Categoría {ruleForm.tipo === "cantidad" && "(opcional)"}</label><input value={ruleForm.categoria} onChange={e => setRuleForm({ ...ruleForm, categoria: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>}
                              {ruleForm.tipo === "cantidad" && <><div><label className="text-xs text-zinc-500">Cantidad desde</label><input type="number" min="0" value={ruleForm.cantidad_desde} onChange={e => setRuleForm({ ...ruleForm, cantidad_desde: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div><div><label className="text-xs text-zinc-500">Cantidad hasta</label><input type="number" min="0" value={ruleForm.cantidad_hasta} onChange={e => setRuleForm({ ...ruleForm, cantidad_hasta: e.target.value })} placeholder="Sin límite" className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div></>}
                              <div><label className="text-xs text-zinc-500">Vigente desde</label><input type="date" value={ruleForm.vigencia_desde} onChange={e => setRuleForm({ ...ruleForm, vigencia_desde: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
                              <div><label className="text-xs text-zinc-500">Vigente hasta</label><input type="date" value={ruleForm.vigencia_hasta} onChange={e => setRuleForm({ ...ruleForm, vigencia_hasta: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
                              <div><label className="text-xs text-zinc-500">Prioridad</label><input type="number" value={ruleForm.prioridad} onChange={e => setRuleForm({ ...ruleForm, prioridad: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
                              <div className="flex items-end"><button type="button" disabled={ruleSaving} onClick={() => handleRuleSave(lista.id)} className="w-full rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">{ruleSaving ? "Guardando…" : "Guardar regla"}</button></div>
                            </div>
                          )}
                        </div>
                        <DataTable<ListaPreciosItem>
                          columns={[
                            { key: "codigo", label: "Codigo", render: (row) => <span className="font-mono text-xs font-bold">{row.codigo}</span> },
                            { key: "descripcion", label: "Articulo", render: (row) => <span className="font-medium">{row.descripcion}</span> },
                            { key: "variante", label: "Variante", render: (row) => <span className="text-zinc-500 text-xs">{row.variante || "—"}</span> },
                            { key: "categoria", label: "Categoria", render: (row) => <Badge variant="outline">{row.categoria}</Badge> },
                            { key: "unidad", label: "Un.", render: (row) => <span className="text-zinc-400">{row.unidad}</span> },
                            { key: "precio", label: "P. Lista", className: "text-right", render: (row) => <span className="font-mono block text-right text-zinc-400 line-through">{lista.moneda === "USD" ? `USD ${row.precio.toFixed(2)}` : formatCurrency(row.precio)}</span> },
                            { key: "descuento", label: "Desc.", className: "text-right", render: (row) => row.descuento ? <span className="text-emerald-600 font-medium">{row.descuento}%</span> : <span className="text-zinc-300">—</span> },
                            { key: "precioNeto", label: "P. Neto", className: "text-right", render: (row) => { const result = calculateNetPrice({ precio: row.precio, precio_neto: row.precioNeto, descuento: row.descuento, categoria: row.categoria, variante: row.variante }, lista.reglas || []); return <div className="text-right"><span className="font-mono font-semibold block">{lista.moneda === "USD" ? `USD ${result.netPrice.toFixed(2)}` : formatCurrency(result.netPrice)}</span>{result.rule && <span className="text-[10px] text-emerald-600" title={`Base manual: ${result.baseNet}`}>{result.rule.nombre} (-{result.ruleDiscount}%)</span>}</div>; } },
                          ]}
                          data={lista.items}
                        />
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Detail panel */}
      {selectedProv && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => { setSelectedProv(null); setPanelFullscreen(false); }} />
          <div className={panelFullscreen ? "fixed inset-4 z-50 overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-zinc-900" : "fixed right-0 top-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl dark:bg-zinc-900"}>
            <div className="flex items-center justify-between border-b border-zinc-200 p-6 dark:border-zinc-700">
              <div>
                <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-zinc-900 dark:text-white">{selectedProv.razonSocial}</h2>{selectedProv.esTransportista && <Badge variant="orange">Transportista</Badge>}{!selectedProv.activo && <Badge variant="outline">Inactivo</Badge>}</div>
                <p className="text-sm text-zinc-500">{selectedProv.cuit}</p>
              </div>
              <div className="flex items-center gap-2">
                {canManageProveedores && <button onClick={() => handleToggleProveedorActivo(selectedProv)} disabled={mutatingProveedorId === selectedProv.id} className={`rounded-lg p-2 hover:bg-zinc-100 disabled:opacity-50 ${selectedProv.activo ? "text-zinc-400 hover:text-amber-600" : "text-emerald-600 hover:text-emerald-700"}`} title={selectedProv.activo ? "Desactivar proveedor" : "Reactivar proveedor"}><Power className="h-4 w-4" /></button>}
                {canManageProveedores && <button onClick={() => { openEdit(selectedProv); setSelectedProv(null); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100" title="Editar"><Pencil className="h-4 w-4" /></button>}
                {canDeleteProveedores && <button onClick={() => handleDeleteProveedor(selectedProv)} disabled={mutatingProveedorId === selectedProv.id} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" title="Eliminar proveedor">{mutatingProveedorId === selectedProv.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}
                <button onClick={() => setPanelFullscreen((value) => !value)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Pantalla completa"}>{panelFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
                <button onClick={() => { setSelectedProv(null); setPanelFullscreen(false); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-zinc-500">Rubro</p><p className="text-sm font-medium">{selectedProv.rubro || "—"}</p></div>
                <div><p className="text-xs text-zinc-500">Condicion IVA</p><p className="text-sm font-medium">{selectedProv.condicionIva}</p></div>
                {(selectedProv as any).administracionNombre && <div className="col-span-2"><p className="text-xs text-zinc-500">Administración</p><p className="text-sm font-medium">{(selectedProv as any).administracionNombre}</p></div>}
                <div><p className="text-xs text-zinc-500">Mail de administración (facturas y cobros)</p><p className="text-sm font-medium">{selectedProv.email ? <a href={`mailto:${selectedProv.email}`} className="hover:text-orange-500">{selectedProv.email}</a> : "—"}</p></div>
                <div><p className="text-xs text-zinc-500">WhatsApp de administración</p><p className="text-sm font-medium">{selectedProv.telefono ? <a href={linkWhatsApp(selectedProv.telefono) || `tel:${selectedProv.telefono}`} target="_blank" rel="noopener noreferrer" className="hover:text-orange-500">{mostrarWhatsApp(selectedProv.telefono)}</a> : "—"}</p></div>
                <div className="col-span-2"><p className="text-xs text-zinc-500">Dirección</p><p className="text-sm font-medium">{[String(selectedProv.direccion || "").trim(), textoLocalidad(selectedProv.localidad, selectedProv.provincia)].filter(Boolean).join(", ") || "—"}</p></div>
              </div>
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold mb-3">Comercial</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2"><p className="text-xs text-zinc-500">Cómo se le paga</p><p className="text-sm font-medium">{textoCondicionPago((selectedProv as any).planPago) || <span className="text-amber-600">Sin indicar — editá el proveedor para cargarlo</span>}</p></div>
                  {!(selectedProv as any).planPago?.condicion_pago && <>
                  <div><p className="text-xs text-zinc-500">Forma de pago</p><p className="text-sm font-medium">{selectedProv.formaPago}</p></div>
                  <div><p className="text-xs text-zinc-500">Dias CC</p><p className="text-sm font-medium">{selectedProv.diasCuentaCorriente}</p></div>
                  </>}
                  <div><p className="text-xs text-zinc-500">Limite credito</p><p className="text-sm font-medium">{formatCurrency(selectedProv.limiteCredito, "ARS")}</p></div>
                  <div><p className="text-xs text-zinc-500">Saldo a pagar</p><p className={`text-sm font-medium ${saldoDe(selectedProv.id).ARS > 0.005 ? "text-red-600" : "text-zinc-500"}`}>{formatCurrency(saldoDe(selectedProv.id).ARS, "ARS")}{Math.abs(saldoDe(selectedProv.id).USD) > 0.005 && <span className="block text-xs">{formatCurrency(saldoDe(selectedProv.id).USD, "USD")}</span>}</p><a href={`/finanzas?tab=cc_proveedores&proveedor=${selectedProv.id}`} className="text-xs font-medium text-orange-500 hover:text-orange-600">Ver cuenta corriente →</a></div>
                  {((selectedProv as any).conceptoRetencionGanancias || (selectedProv as any).alicuotaGanancias != null) && (
                    <>
                      <div><p className="text-xs text-zinc-500">Ret. Ganancias</p><p className="text-sm font-medium">{CONCEPTOS_RG830[(selectedProv as any).conceptoRetencionGanancias] || "—"}</p></div>
                      <div><p className="text-xs text-zinc-500">Alícuota</p><p className="text-sm font-medium text-violet-600">{(selectedProv as any).alicuotaGanancias != null ? `${(selectedProv as any).alicuotaGanancias}%` : "—"}</p></div>
                    </>
                  )}
                </div>
              </div>
              {(selectedProv.cbu || selectedProv.aliasBancario || selectedProv.numeroCuenta || selectedProv.titularCuenta || selectedProv.cuitTitularCuenta || selectedProv.tipoCuenta || (selectedProv as any).banco) && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold mb-3">Datos bancarios</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div><p className="text-xs text-zinc-500">Banco</p><p className="text-sm font-medium">{(selectedProv as any).banco || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">Titular</p><p className="text-sm font-medium">{selectedProv.titularCuenta || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">CUIT del proveedor</p><p className="text-sm font-mono font-medium">{selectedProv.cuit || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">Tipo de cuenta</p><p className="text-sm font-medium">{selectedProv.tipoCuenta || "—"}</p></div>
                    <div className="col-span-2"><p className="text-xs text-zinc-500">CBU / CVU</p><p className="text-sm font-mono font-medium">{selectedProv.cbu || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">Alias</p><p className="text-sm font-medium">{selectedProv.aliasBancario || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">N° de cuenta</p><p className="text-sm font-medium">{selectedProv.numeroCuenta || "—"}</p></div>
                  </div>
                </div>
              )}
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <div className="flex items-center justify-between mb-3"><div><h3 className="text-sm font-semibold">Vendedores</h3><p className="text-[11px] text-zinc-400">A ellos se les mandan las OC. Administración va arriba, en los datos del proveedor.</p></div><button type="button" onClick={() => startProveedorContacto()} className="rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-600">Agregar vendedor</button></div>
                {editingProveedorContacto && <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50/50 p-3 space-y-2 dark:border-orange-900/40 dark:bg-orange-900/10">
                  <div className="grid grid-cols-2 gap-2"><input placeholder="Nombre del vendedor *" value={proveedorContactoForm.nombre} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, nombre: e.target.value }))} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /><input type="email" placeholder="Mail comercial (ventas)" value={proveedorContactoForm.email} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, email: e.target.value }))} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
                  <div><p className="mb-1 text-xs text-zinc-500">WhatsApp del vendedor</p><WhatsAppInput value={proveedorContactoForm.whatsapp || proveedorContactoForm.telefono} onChange={(v) => setProveedorContactoForm((p) => ({ ...p, whatsapp: v, telefono: "" }))} /></div>
                  <textarea placeholder="Notas" rows={2} value={proveedorContactoForm.notas} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, notas: e.target.value }))} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={proveedorContactoForm.principal} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, principal: e.target.checked }))} /> Contacto principal</label>
                  <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingProveedorContacto(false)} className="rounded border px-2 py-1 text-xs">Cancelar</button><button type="button" disabled={savingProveedorContacto || !proveedorContactoForm.nombre.trim()} onClick={saveProveedorContacto} className="rounded bg-orange-500 px-2 py-1 text-xs text-white disabled:opacity-50">Guardar</button></div>
                </div>}
                {selectedProv.contactos?.length ? <div className="space-y-2">{selectedProv.contactos.map((c: any) => <div key={c.id} className="flex items-start justify-between rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800"><div><p className="text-sm font-medium">{c.nombre} {c.principal && <span className="text-[10px] text-orange-600">Principal</span>}</p><p className="text-xs text-zinc-500">{[c.email, (c.whatsapp || c.telefono) ? `WhatsApp ${mostrarWhatsApp(c.whatsapp || c.telefono)}` : ""].filter(Boolean).join(" · ") || "Sin datos"}</p></div><div className="flex gap-1"><button type="button" onClick={() => startProveedorContacto(c)} className="rounded p-1 text-zinc-400 hover:text-orange-500"><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={() => deleteProveedorContacto(c.id)} className="rounded p-1 text-zinc-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></div></div>)}</div> : <p className="text-sm italic text-zinc-400">Sin contactos registrados</p>}
              </div>
              {(selectedProv.clasificacionTags?.length > 0 || selectedProv.marcas || selectedProv.clasificacionNota) && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Tag className="h-4 w-4" /> Clasificacion</h3>
                  {selectedProv.clasificacionTags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {selectedProv.clasificacionTags.map((t) => <ClasificacionTag key={t} tag={t} />)}
                    </div>
                  )}
                  {selectedProv.marcas && (
                    <div className="mb-3">
                      <p className="text-xs text-zinc-500 mb-1">Marcas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedProv.marcas.split(",").map((m) => m.trim()).filter(Boolean).map((m) => (
                          <span key={m} className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-400">{m}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedProv.clasificacionNota && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">Comentario</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{selectedProv.clasificacionNota}</p>
                    </div>
                  )}
                </div>
              )}
              {selectedProv.notas && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold mb-2">Notas</h3>
                  <p className="text-sm text-zinc-600 whitespace-pre-wrap">{selectedProv.notas}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Alta / edición (mismo formulario que "Nuevo proveedor" desde una factura) */}
      <ProveedorFormModal
        open={modalOpen}
        proveedorId={editingId}
        inicial={modalInicial}
        onClose={() => setModalOpen(false)}
        onSaved={async () => { setModalOpen(false); setSelectedProv(null); await fetchData(); }}
      />

      {/* AI Upload Modal */}
      <Modal
        open={aiModalOpen}
        onClose={() => { if (!aiParsing) setAiModalOpen(false); }}
        title="Cargar lista de precios con IA"
        description="Subi un PDF o imagen de una lista de precios y la IA extrae los articulos automaticamente."
        size="xl"
        footer={
          aiResult ? (
            <>
              <button
                onClick={() => { setAiResult(null); setAiFile(null); }}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Volver a subir
              </button>
              <button
                onClick={handleAiSave}
                disabled={aiSaving || !aiProveedorId || aiResult.items.length === 0}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {aiSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Guardar lista ({aiResult.items.length} articulos)
              </button>
            </>
          ) : undefined
        }
      >
        {!aiResult ? (
          <div className="space-y-6">
            {/* File upload zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-10 cursor-pointer hover:border-orange-400 hover:bg-orange-50/30 transition-colors dark:border-zinc-600 dark:bg-zinc-800/50 dark:hover:border-orange-500"
            >
              <div className="rounded-full bg-orange-100 p-3 dark:bg-orange-900/30">
                <FileUp className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {aiFile ? aiFile.name : "Click para seleccionar archivo"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  PDF, PNG, JPG o WEBP — maximo 20MB
                </p>
              </div>
              {aiFile && (
                <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 shadow-sm dark:bg-zinc-700">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{(aiFile.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setAiFile(file);
              }}
            />

            {aiError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                {aiError}
              </div>
            )}

            <button
              onClick={handleAiParse}
              disabled={!aiFile || aiParsing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {aiParsing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analizando con IA... puede tardar unos segundos
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Extraer articulos con IA
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* AI Result summary */}
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4 dark:bg-emerald-950/30 dark:border-emerald-800">
              <Sparkles className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  {aiResult.items.length} articulos extraidos
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {aiResult.nombre_lista} — {aiResult.moneda}
                  {aiResult.proveedor && ` — ${aiResult.proveedor}`}
                </p>
              </div>
            </div>

            {/* Proveedor selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Asignar a proveedor *
              </label>
              <select
                value={aiProveedorId}
                onChange={(e) => {
                  if (e.target.value === "__nuevo__") { setAiNewProvOpen(true); setAiNewProvForm({ razon_social: aiResult?.proveedor || "", cuit: "", rubro: "" }); }
                  else setAiProveedorId(e.target.value);
                }}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              >
                <option value="">Seleccionar proveedor...</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.razonSocial}</option>
                ))}
                <option value="__nuevo__">＋ Crear nuevo proveedor...</option>
              </select>
              {aiProveedorId && aiProveedorId !== "__nuevo__" && (
                <p className="text-xs text-emerald-600 mt-1">✓ {proveedores.find(p => p.id === aiProveedorId)?.razonSocial}</p>
              )}
              {/* Mini form para crear proveedor nuevo */}
              {aiNewProvOpen && (
                <div className="mt-3 rounded-xl border border-dashed border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-4 space-y-3">
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">Nuevo proveedor</p>
                  <input value={aiNewProvForm.razon_social} onChange={(e) => setAiNewProvForm({ ...aiNewProvForm, razon_social: e.target.value })}
                    placeholder="Razón social *" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={aiNewProvForm.cuit} onChange={(e) => setAiNewProvForm({ ...aiNewProvForm, cuit: e.target.value })}
                      placeholder="CUIT (opcional)" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                    <input value={aiNewProvForm.rubro} onChange={(e) => setAiNewProvForm({ ...aiNewProvForm, rubro: e.target.value })}
                      placeholder="Rubro (opcional)" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setAiNewProvOpen(false)} className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700">Cancelar</button>
                    <button onClick={handleAiCreateNewProv} disabled={aiNewProvSaving || !aiNewProvForm.razon_social.trim()}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                      {aiNewProvSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Crear proveedor
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">Moneda</p>
                <p className="text-sm font-semibold">{aiResult.moneda}</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">Desde</p>
                <p className="text-sm font-semibold">{aiResult.vigencia_desde || "—"}</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">Hasta</p>
                <p className="text-sm font-semibold">{aiResult.vigencia_hasta || "—"}</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">Articulos</p>
                <p className="text-sm font-semibold">{aiResult.items.length}</p>
              </div>
            </div>

            {aiResult.notas && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400">
                <strong>Notas de la IA:</strong> {aiResult.notas}
              </div>
            )}

            {/* Items table */}
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Codigo</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Descripcion</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500 hidden md:table-cell">Variante</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500 hidden sm:table-cell">Categoria</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Un.</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-zinc-500">Precio</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-zinc-500 hidden sm:table-cell">Desc.</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-zinc-500">Neto</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {aiResult.items.map((item, i) => (
                    <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-2 font-mono text-xs font-bold">{item.codigo || "—"}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{item.descripcion}</td>
                      <td className="px-3 py-2 text-zinc-500 hidden md:table-cell">{item.variante || "—"}</td>
                      <td className="px-3 py-2 text-zinc-500 hidden sm:table-cell">{item.categoria}</td>
                      <td className="px-3 py-2 text-zinc-400">{item.unidad}</td>
                      <td className="px-3 py-2 text-right font-mono">{item.precio.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600 hidden sm:table-cell">{item.descuento ? `${item.descuento}%` : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{item.precio_neto.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeAiItem(i)} className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500" title="Quitar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
