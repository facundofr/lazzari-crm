"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import {
  Truck, Plus, X, Loader2, CheckCircle2, Building2,
  MapPin, FileText, Link2, Phone, Mail, User, Pencil,
  ToggleLeft, ToggleRight, Package,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatCurrency } from "@/lib/utils";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";
import { useToast } from "@/components/ui/toast";

// ── Tipos ─────────────────────────────────────────────────────────────
interface TransportistaRow {
  id: string;
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  contacto_principal: string | null;
  observaciones: string | null;
  activo: boolean;
  created_at: string;
}

const envioEstadoConfig: Record<string, { label: string; variant: "success" | "warning" | "info" | "danger" }> = {
  solicitado: { label: "Solicitado", variant: "warning" },
  en_transito: { label: "En tránsito", variant: "info" },
  entregado: { label: "Entregado", variant: "success" },
  cancelado: { label: "Cancelado", variant: "danger" },
};

interface EnvioRow {
  id: string;
  sociedad_id: string;
  fecha: string;
  cliente_id: string | null;
  remito_id: string | null;
  transportista: string;
  transportista_id: string | null;
  tipo_vehiculo: string | null;
  origen: string | null;
  destino: string | null;
  descripcion_carga: string | null;
  peso_kg: number | null;
  bultos: number | null;
  costo: number | null;
  moneda: string;
  estado: string;
  notas: string | null;
  created_at: string;
  clientes: { razon_social: string } | null;
  remitos: { numero: string; estado: string } | null;
}

type ActiveTab = "catalogo" | "envios";

// ── Helpers ────────────────────────────────────────────────────────────
const emptyTransportistaForm = {
  nombre: "",
  razon_social: "",
  cuit: "",
  telefono: "",
  email: "",
  direccion: "",
  localidad: "",
  provincia: "",
  contacto_principal: "",
  observaciones: "",
};

export default function TransportesPage() {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<ActiveTab>("catalogo");

  // ── Catálogo state ────────────────────────────────────────────────
  const [transportistas, setTransportistas] = useState<TransportistaRow[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [selectedTransportista, setSelectedTransportista] = useState<TransportistaRow | null>(null);

  // Create/Edit transportista modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catEditingId, setCatEditingId] = useState<string | null>(null);
  const [catForm, setCatForm] = useState(emptyTransportistaForm);
  const [catSaving, setCatSaving] = useState(false);
  const [catFormErrors, setCatFormErrors] = useState<Record<string, string>>({});

  // ── Envíos state ──────────────────────────────────────────────────
  const [envios, setEnvios] = useState<EnvioRow[]>([]);
  const [enviosLoading, setEnviosLoading] = useState(true);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string }[]>([]);
  const [remitosDisponibles, setRemitosDisponibles] = useState<{ id: string; numero: string; cliente_id: string; clienteNombre: string }[]>([]);
  const [createEnvioOpen, setCreateEnvioOpen] = useState(false);
  const [creatingEnvio, setCreatingEnvio] = useState(false);
  const [envioForm, setEnvioForm] = useState({
    transportista_id: "",
    transportista_nombre: "",  // fallback texto libre
    destino: "",
    origen: "",
    cliente_id: "",
    remito_id: "",
    fecha: new Date().toISOString().split("T")[0],
    costo: "",
    moneda: "ARS" as "ARS" | "USD",
    bultos: "",
    descripcion_carga: "",
    tipo_vehiculo: "",
    notas: "",
  });
  const [detailEnvio, setDetailEnvio] = useState<EnvioRow | null>(null);
  const [editingEnvio, setEditingEnvio] = useState(false);
  const [editEnvioForm, setEditEnvioForm] = useState({
    destino: "", origen: "", costo: "", moneda: "ARS" as "ARS" | "USD",
    bultos: "", tipo_vehiculo: "", descripcion_carga: "", notas: "",
  });
  const [savingEnvio, setSavingEnvio] = useState(false);

  const [envioFilterValues, setEnvioFilterValues] = useState<FilterValues>({ fecha: { from: "", to: "" }, estado: "" });
  const envioFilterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    { key: "estado", label: "Estado", type: "select", options: [
      { value: "solicitado", label: "Solicitado" }, { value: "en_transito", label: "En tránsito" },
      { value: "entregado", label: "Entregado" }, { value: "cancelado", label: "Cancelado" },
    ]},
  ];

  // ── Fetch catálogo ────────────────────────────────────────────────
  const fetchTransportistas = useCallback(async () => {
    setCatLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("transportistas")
        .select("*")
        .order("nombre");
      if (!error && data) setTransportistas(data as TransportistaRow[]);
      else setTransportistas([]);
    } catch { setTransportistas([]); }
    finally { setCatLoading(false); }
  }, []);

  // ── Fetch envíos ──────────────────────────────────────────────────
  const fetchEnvios = useCallback(async () => {
    setEnviosLoading(true);
    try {
      let q = (supabase as any)
        .from("transportes")
        .select(`*, clientes(razon_social), remitos(numero, estado)`)
        .order("fecha", { ascending: false });
      if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
      const { data, error } = await q;
      if (!error && data) setEnvios(data as EnvioRow[]);
      else setEnvios([]);
    } catch { setEnvios([]); }
    finally { setEnviosLoading(false); }
  }, [sociedadActiva?.id]);

  useEffect(() => { fetchTransportistas(); }, [fetchTransportistas]);
  useEffect(() => { fetchEnvios(); }, [fetchEnvios]);

  // ── Catálogo CRUD ─────────────────────────────────────────────────
  function openCatCreate() {
    setCatEditingId(null);
    setCatForm(emptyTransportistaForm);
    setCatFormErrors({});
    setCatModalOpen(true);
  }

  function openCatEdit(t: TransportistaRow) {
    setCatEditingId(t.id);
    setCatForm({
      nombre: t.nombre,
      razon_social: t.razon_social ?? "",
      cuit: t.cuit ?? "",
      telefono: t.telefono ?? "",
      email: t.email ?? "",
      direccion: t.direccion ?? "",
      localidad: t.localidad ?? "",
      provincia: t.provincia ?? "",
      contacto_principal: t.contacto_principal ?? "",
      observaciones: t.observaciones ?? "",
    });
    setCatFormErrors({});
    setCatModalOpen(true);
  }

  function validateCatForm() {
    const errs: Record<string, string> = {};
    if (!catForm.nombre.trim()) errs.nombre = "El nombre es obligatorio";
    return errs;
  }

  async function handleSaveTransportista() {
    const errs = validateCatForm();
    if (Object.keys(errs).length > 0) { setCatFormErrors(errs); return; }
    setCatSaving(true);
    try {
      const payload = {
        nombre: catForm.nombre.trim(),
        razon_social: catForm.razon_social.trim() || null,
        cuit: catForm.cuit.trim() || null,
        telefono: catForm.telefono.trim() || null,
        email: catForm.email.trim() || null,
        direccion: catForm.direccion.trim() || null,
        localidad: catForm.localidad.trim() || null,
        provincia: catForm.provincia.trim() || null,
        contacto_principal: catForm.contacto_principal.trim() || null,
        observaciones: catForm.observaciones.trim() || null,
      };
      if (catEditingId) {
        const { error } = await (supabase as any).from("transportistas").update(payload).eq("id", catEditingId);
        if (error) throw error;
        toast.success("Transportista actualizado");
      } else {
        const { error } = await (supabase as any).from("transportistas").insert(payload);
        if (error) throw error;
        toast.success("Transportista creado");
      }
      setCatModalOpen(false);
      await fetchTransportistas();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar");
    } finally { setCatSaving(false); }
  }

  async function handleToggleActivo(t: TransportistaRow) {
    try {
      const { error } = await (supabase as any).from("transportistas").update({ activo: !t.activo }).eq("id", t.id);
      if (error) throw error;
      toast.success(t.activo ? "Transportista desactivado" : "Transportista activado");
      await fetchTransportistas();
      if (selectedTransportista?.id === t.id) setSelectedTransportista({ ...t, activo: !t.activo });
    } catch { toast.error("Error al cambiar estado"); }
  }

  // ── Envíos CRUD ───────────────────────────────────────────────────
  async function openCreateEnvio() {
    setEnvioForm({
      transportista_id: "", transportista_nombre: "",
      destino: "", origen: "", cliente_id: "", remito_id: "",
      fecha: new Date().toISOString().split("T")[0],
      costo: "", moneda: "ARS", bultos: "", descripcion_carga: "", tipo_vehiculo: "", notas: "",
    });

    let cliQ = supabase.from("clientes").select("id, razon_social").eq("activo", true).order("razon_social");
    if (sociedadActiva?.id) cliQ = cliQ.eq("sociedad_id" as any, sociedadActiva.id);
    let remQ = (supabase as any).from("remitos").select("id, numero, cliente_id, clientes(razon_social), estado").in("estado", ["pendiente", "parcial"]).order("fecha", { ascending: false });
    if (sociedadActiva?.id) remQ = remQ.eq("sociedad_id", sociedadActiva.id);

    const [cliRes, remRes] = await Promise.all([cliQ, remQ]);
    if (cliRes.data) setClientes(cliRes.data as any[]);
    if (remRes.data) setRemitosDisponibles((remRes.data as any[]).map((r: any) => ({ id: r.id, numero: r.numero, cliente_id: r.cliente_id, clienteNombre: r.clientes?.razon_social || "" })));
    setCreateEnvioOpen(true);
  }

  async function handleCreateEnvio() {
    if (!envioForm.fecha) return;
    const transportistaName = transportistas.find(t => t.id === envioForm.transportista_id)?.nombre || envioForm.transportista_nombre;
    if (!transportistaName) { toast.error("Seleccioná o ingresá un transportista"); return; }
    setCreatingEnvio(true);
    try {
      const { error } = await (supabase as any).from("transportes").insert({
        sociedad_id: sociedadActiva?.id,
        transportista: transportistaName,
        transportista_id: envioForm.transportista_id || null,
        destino: envioForm.destino || null,
        origen: envioForm.origen || null,
        cliente_id: envioForm.cliente_id || null,
        remito_id: envioForm.remito_id || null,
        fecha: envioForm.fecha,
        costo: envioForm.costo ? Number(envioForm.costo) : null,
        moneda: envioForm.moneda,
        bultos: envioForm.bultos ? Number(envioForm.bultos) : null,
        descripcion_carga: envioForm.descripcion_carga || null,
        tipo_vehiculo: envioForm.tipo_vehiculo || null,
        notas: envioForm.notas || null,
        estado: "solicitado",
      });
      if (error) throw error;
      setCreateEnvioOpen(false);
      toast.success("Envío registrado");
      await fetchEnvios();
    } catch (err: any) { toast.error(err.message || "Error al crear envío"); }
    finally { setCreatingEnvio(false); }
  }

  async function handleEnvioEstado(id: string, estado: string) {
    const { error } = await (supabase as any).from("transportes").update({ estado }).eq("id", id);
    if (error) { toast.error("Error al actualizar estado"); return; }
    await fetchEnvios();
    if (detailEnvio?.id === id) setDetailEnvio(prev => prev ? { ...prev, estado } : null);
  }

  async function handleSaveEnvio() {
    if (!detailEnvio) return;
    setSavingEnvio(true);
    try {
      const { error } = await (supabase as any).from("transportes").update({
        destino: editEnvioForm.destino || null, origen: editEnvioForm.origen || null,
        costo: editEnvioForm.costo ? Number(editEnvioForm.costo) : null,
        moneda: editEnvioForm.moneda, bultos: editEnvioForm.bultos ? Number(editEnvioForm.bultos) : null,
        tipo_vehiculo: editEnvioForm.tipo_vehiculo || null,
        descripcion_carga: editEnvioForm.descripcion_carga || null,
        notas: editEnvioForm.notas || null,
      }).eq("id", detailEnvio.id);
      if (error) throw error;
      setEditingEnvio(false);
      toast.success("Envío actualizado");
      await fetchEnvios();
      const { data } = await (supabase as any).from("transportes").select("*, clientes(razon_social), remitos(numero, estado)").eq("id", detailEnvio.id).single();
      if (data) setDetailEnvio(data as EnvioRow);
    } catch (err: any) { toast.error(err.message || "Error al guardar"); }
    finally { setSavingEnvio(false); }
  }

  // ── Filtros envíos ────────────────────────────────────────────────
  const filteredEnvios = envios.filter(e => {
    const f = envioFilterValues.fecha as { from?: string; to?: string };
    if (f?.from && e.fecha < f.from) return false;
    if (f?.to && e.fecha > f.to) return false;
    const est = envioFilterValues.estado as string;
    if (est && e.estado !== est) return false;
    return true;
  });

  const activeTransportistas = transportistas.filter(t => t.activo);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <>
      <Header
        title="Transportes"
        subtitle={activeTab === "catalogo" ? `${activeTransportistas.length} transportistas activos` : `${envios.length} envíos registrados`}
        action={activeTab === "catalogo"
          ? { label: "Nuevo transportista", onClick: openCatCreate }
          : { label: "Registrar envío", onClick: openCreateEnvio }
        }
      />

      <div className="p-4 sm:p-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-1 w-fit">
          {([
            { key: "catalogo" as const, label: "Catálogo de transportistas", icon: <Building2 className="h-3.5 w-3.5" /> },
            { key: "envios" as const, label: "Historial de envíos", icon: <Truck className="h-3.5 w-3.5" /> },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── TAB: CATÁLOGO ─────────────────────────────────────────── */}
        {activeTab === "catalogo" && (
          <>
            {catLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              </div>
            ) : (
              <Card className="p-0 overflow-hidden">
                <DataTable<TransportistaRow>
                  columns={[
                    {
                      key: "nombre", label: "Transportista", sortable: true,
                      render: (row) => (
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                            <Truck className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium dark:text-white">{row.nombre}</p>
                            {row.razon_social && row.razon_social !== row.nombre && (
                              <p className="text-xs text-zinc-400">{row.razon_social}</p>
                            )}
                          </div>
                        </div>
                      ),
                    },
                    { key: "cuit", label: "CUIT", sortable: false, render: (row) => <span className="font-mono text-sm dark:text-zinc-300">{row.cuit || "—"}</span> },
                    { key: "telefono", label: "Teléfono", sortable: false, render: (row) => <span className="text-sm dark:text-zinc-300">{row.telefono || "—"}</span> },
                    { key: "localidad", label: "Ubicación", sortable: true, render: (row) => (
                      <span className="text-xs text-zinc-500">{[row.localidad, row.provincia].filter(Boolean).join(", ") || "—"}</span>
                    )},
                    { key: "contacto_principal", label: "Contacto", sortable: false, render: (row) => <span className="text-sm dark:text-zinc-300">{row.contacto_principal || "—"}</span> },
                    { key: "activo", label: "Estado", sortable: true, render: (row) => (
                      <Badge variant={row.activo ? "success" : "danger"}>{row.activo ? "Activo" : "Inactivo"}</Badge>
                    )},
                    {
                      key: "actions", label: "", sortable: false,
                      render: (row) => (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openCatEdit(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleToggleActivo(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={row.activo ? "Desactivar" : "Activar"}>
                            {row.activo ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      ),
                    },
                  ]}
                  data={transportistas}
                  onRowClick={setSelectedTransportista}
                  emptyMessage="Sin transportistas. Creá el primero con el botón de arriba."
                />
              </Card>
            )}
          </>
        )}

        {/* ── TAB: ENVÍOS ──────────────────────────────────────────── */}
        {activeTab === "envios" && (
          <>
            <SmartFilters filters={envioFilterConfigs} values={envioFilterValues} onChange={setEnvioFilterValues} />
            {enviosLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              </div>
            ) : (
              <Card className="p-0 overflow-hidden">
                <DataTable<EnvioRow>
                  columns={[
                    { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500 dark:text-zinc-400">{formatDate(row.fecha)}</span> },
                    { key: "transportista", label: "Transportista", sortable: true, render: (row) => (
                      <div className="flex items-center gap-2"><Truck className="h-4 w-4 text-zinc-400" /><span className="font-medium dark:text-white">{row.transportista}</span></div>
                    )},
                    { key: "clientes", label: "Cliente", sortable: false, render: (row) => <span className="text-sm dark:text-zinc-300">{row.clientes?.razon_social || "—"}</span> },
                    { key: "destino", label: "Destino", sortable: false, render: (row) => <span className="text-sm dark:text-zinc-300">{row.destino || "—"}</span> },
                    { key: "remito_id", label: "Remito", sortable: false, render: (row) => row.remitos ? (
                      <div className="flex items-center gap-1">
                        <FileText className="h-3 w-3 text-blue-500" />
                        <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{row.remitos.numero}</span>
                      </div>
                    ) : <span className="text-zinc-400">—</span> },
                    { key: "costo", label: "Costo", sortable: true, render: (row) => (
                      <span className="font-mono text-sm dark:text-white">
                        {row.costo != null ? formatCurrency(row.costo, row.moneda as "USD" | "ARS") : <span className="text-zinc-400">—</span>}
                      </span>
                    )},
                    { key: "estado", label: "Estado", sortable: true, render: (row) => {
                      const cfg = envioEstadoConfig[row.estado] || { label: row.estado, variant: "info" as const };
                      return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                    }},
                    { key: "actions", label: "", sortable: false, render: (row) => (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {row.estado === "solicitado" && (
                          <button onClick={() => handleEnvioEstado(row.id, "en_transito")} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30" title="En tránsito">
                            <Truck className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {(row.estado === "solicitado" || row.estado === "en_transito") && (
                          <button onClick={() => handleEnvioEstado(row.id, "entregado")} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900/30" title="Entregado">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {row.estado === "solicitado" && (
                          <button onClick={() => handleEnvioEstado(row.id, "cancelado")} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30" title="Cancelar">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )},
                  ]}
                  data={filteredEnvios}
                  onRowClick={(row) => { setDetailEnvio(row); setEditingEnvio(false); }}
                  emptyMessage="Sin envíos registrados para los filtros actuales."
                />
              </Card>
            )}
          </>
        )}
      </div>

      {/* ── PANEL DETALLE: TRANSPORTISTA ───────────────────────────── */}
      {selectedTransportista && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedTransportista(null)} />
          <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-semibold dark:text-white">{selectedTransportista.nombre}</h2>
                <Badge variant={selectedTransportista.activo ? "success" : "danger"} className="mt-1">
                  {selectedTransportista.activo ? "Activo" : "Inactivo"}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { openCatEdit(selectedTransportista); setSelectedTransportista(null); }} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  Editar
                </button>
                <button onClick={() => setSelectedTransportista(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm">
              {selectedTransportista.razon_social && (
                <div><span className="text-zinc-400">Razón social</span><p className="font-medium dark:text-white mt-0.5">{selectedTransportista.razon_social}</p></div>
              )}
              {selectedTransportista.cuit && (
                <div><span className="text-zinc-400">CUIT</span><p className="font-mono font-medium dark:text-white mt-0.5">{selectedTransportista.cuit}</p></div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {selectedTransportista.telefono && (
                  <div>
                    <span className="text-zinc-400">Teléfono</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Phone className="h-3.5 w-3.5 text-zinc-400" />
                      <a href={`tel:${selectedTransportista.telefono}`} className="font-medium dark:text-white hover:text-orange-500">{selectedTransportista.telefono}</a>
                    </div>
                  </div>
                )}
                {selectedTransportista.email && (
                  <div>
                    <span className="text-zinc-400">Email</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Mail className="h-3.5 w-3.5 text-zinc-400" />
                      <a href={`mailto:${selectedTransportista.email}`} className="font-medium dark:text-white hover:text-orange-500 truncate">{selectedTransportista.email}</a>
                    </div>
                  </div>
                )}
              </div>
              {(selectedTransportista.localidad || selectedTransportista.provincia) && (
                <div>
                  <span className="text-zinc-400">Ubicación</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <MapPin className="h-3.5 w-3.5 text-zinc-400" />
                    <p className="font-medium dark:text-white">{[selectedTransportista.direccion, selectedTransportista.localidad, selectedTransportista.provincia].filter(Boolean).join(", ")}</p>
                  </div>
                </div>
              )}
              {selectedTransportista.contacto_principal && (
                <div>
                  <span className="text-zinc-400">Contacto principal</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <User className="h-3.5 w-3.5 text-zinc-400" />
                    <p className="font-medium dark:text-white">{selectedTransportista.contacto_principal}</p>
                  </div>
                </div>
              )}
              {selectedTransportista.observaciones && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <span className="text-xs text-zinc-400 block mb-1">Observaciones</span>
                  <p className="dark:text-zinc-300">{selectedTransportista.observaciones}</p>
                </div>
              )}
              <div className="pt-2">
                <button
                  onClick={() => handleToggleActivo(selectedTransportista)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    selectedTransportista.activo
                      ? "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                      : "border-green-200 text-green-600 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-900/20"
                  }`}
                >
                  {selectedTransportista.activo ? <><ToggleLeft className="h-4 w-4" /> Desactivar</> : <><ToggleRight className="h-4 w-4" /> Activar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PANEL DETALLE: ENVÍO ────────────────────────────────────── */}
      {detailEnvio && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setDetailEnvio(null); setEditingEnvio(false); }} />
          <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-semibold dark:text-white">{detailEnvio.transportista}</h2>
                <Badge variant={(envioEstadoConfig[detailEnvio.estado] || { variant: "info" as const }).variant} className="mt-1">
                  {(envioEstadoConfig[detailEnvio.estado] || { label: detailEnvio.estado }).label}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {!editingEnvio && !["entregado", "cancelado"].includes(detailEnvio.estado) && (
                  <button
                    onClick={() => { setEditingEnvio(true); setEditEnvioForm({ destino: detailEnvio.destino || "", origen: detailEnvio.origen || "", costo: detailEnvio.costo != null ? String(detailEnvio.costo) : "", moneda: detailEnvio.moneda as "ARS" | "USD", bultos: detailEnvio.bultos != null ? String(detailEnvio.bultos) : "", tipo_vehiculo: detailEnvio.tipo_vehiculo || "", descripcion_carga: detailEnvio.descripcion_carga || "", notas: detailEnvio.notas || "" }); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >Editar</button>
                )}
                <button onClick={() => { setDetailEnvio(null); setEditingEnvio(false); }} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm">
              {/* Acciones estado */}
              {!editingEnvio && !["entregado", "cancelado"].includes(detailEnvio.estado) && (
                <div className="flex flex-wrap gap-2">
                  {detailEnvio.estado === "solicitado" && (
                    <button onClick={() => handleEnvioEstado(detailEnvio.id, "en_transito")} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600">
                      <Truck className="h-4 w-4" /> En tránsito
                    </button>
                  )}
                  <button onClick={() => handleEnvioEstado(detailEnvio.id, "entregado")} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> Marcar entregado
                  </button>
                  {detailEnvio.estado === "solicitado" && (
                    <button onClick={() => handleEnvioEstado(detailEnvio.id, "cancelado")} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20">
                      <X className="h-4 w-4" /> Cancelar
                    </button>
                  )}
                </div>
              )}

              {editingEnvio ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Origen</label>
                      <input type="text" value={editEnvioForm.origen} onChange={e => setEditEnvioForm({ ...editEnvioForm, origen: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Destino</label>
                      <input type="text" value={editEnvioForm.destino} onChange={e => setEditEnvioForm({ ...editEnvioForm, destino: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Costo (interno)</label>
                      <input type="number" step="0.01" value={editEnvioForm.costo} onChange={e => setEditEnvioForm({ ...editEnvioForm, costo: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Sin costo" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Moneda</label>
                      <select value={editEnvioForm.moneda} onChange={e => setEditEnvioForm({ ...editEnvioForm, moneda: e.target.value as "ARS" | "USD" })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                        <option value="ARS">ARS</option><option value="USD">USD</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Bultos</label>
                      <input type="number" min="0" value={editEnvioForm.bultos} onChange={e => setEditEnvioForm({ ...editEnvioForm, bultos: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo vehículo</label>
                      <input type="text" value={editEnvioForm.tipo_vehiculo} onChange={e => setEditEnvioForm({ ...editEnvioForm, tipo_vehiculo: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Descripción de carga</label>
                    <textarea value={editEnvioForm.descripcion_carga} onChange={e => setEditEnvioForm({ ...editEnvioForm, descripcion_carga: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" rows={2} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notas</label>
                    <textarea value={editEnvioForm.notas} onChange={e => setEditEnvioForm({ ...editEnvioForm, notas: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" rows={2} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingEnvio(false)} className="px-4 py-2 rounded-lg border border-zinc-300 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300">Cancelar</button>
                    <button onClick={handleSaveEnvio} disabled={savingEnvio} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white text-sm hover:bg-orange-700 disabled:opacity-50">
                      {savingEnvio && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div><span className="text-zinc-400">Cliente</span><p className="font-medium dark:text-white mt-0.5">{detailEnvio.clientes?.razon_social || "—"}</p></div>
                    <div><span className="text-zinc-400">Fecha</span><p className="font-medium dark:text-white mt-0.5">{formatDate(detailEnvio.fecha)}</p></div>
                    <div><span className="text-zinc-400">Origen</span><p className="font-medium dark:text-white mt-0.5">{detailEnvio.origen || "—"}</p></div>
                    <div><span className="text-zinc-400">Destino</span><p className="font-medium dark:text-white mt-0.5">{detailEnvio.destino || "—"}</p></div>
                    <div>
                      <span className="text-zinc-400">Costo flete <span className="text-xs">(interno)</span></span>
                      <p className="font-mono font-medium text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {detailEnvio.costo != null ? formatCurrency(detailEnvio.costo, detailEnvio.moneda as "USD" | "ARS") : "—"}
                      </p>
                    </div>
                    <div><span className="text-zinc-400">Bultos</span><p className="font-medium dark:text-white mt-0.5">{detailEnvio.bultos ?? "—"}</p></div>
                    {detailEnvio.tipo_vehiculo && <div><span className="text-zinc-400">Vehículo</span><p className="font-medium dark:text-white mt-0.5">{detailEnvio.tipo_vehiculo}</p></div>}
                  </div>
                  {detailEnvio.remitos && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3">
                      <span className="text-xs text-blue-500 block mb-1">Remito vinculado</span>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-500" />
                        <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">{detailEnvio.remitos.numero}</span>
                        <Badge variant={detailEnvio.remitos.estado === "entregado" ? "success" : detailEnvio.remitos.estado === "parcial" ? "info" : "warning"}>
                          {detailEnvio.remitos.estado}
                        </Badge>
                      </div>
                    </div>
                  )}
                  {detailEnvio.descripcion_carga && (
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                      <span className="text-xs text-zinc-400 block mb-1">Descripción de carga</span>
                      <p className="dark:text-zinc-300">{detailEnvio.descripcion_carga}</p>
                    </div>
                  )}
                  {detailEnvio.notas && (
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                      <span className="text-xs text-zinc-400 block mb-1">Notas</span>
                      <p className="dark:text-zinc-300">{detailEnvio.notas}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL CREAR/EDITAR TRANSPORTISTA ───────────────────────── */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-xl shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-lg font-semibold dark:text-white">{catEditingId ? "Editar transportista" : "Nuevo transportista"}</h2>
              <button onClick={() => setCatModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Nombre comercial *</label>
                <input type="text" value={catForm.nombre} onChange={e => setCatForm({ ...catForm, nombre: e.target.value })} className={`w-full rounded-lg border px-3 py-2 text-sm dark:bg-zinc-800 dark:text-white ${catFormErrors.nombre ? "border-red-400 dark:border-red-500" : "border-zinc-300 dark:border-zinc-700"}`} placeholder="Ej: Andreani, OCA, Transporte ABC" />
                {catFormErrors.nombre && <p className="mt-1 text-xs text-red-500">{catFormErrors.nombre}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Razón social</label>
                <input type="text" value={catForm.razon_social} onChange={e => setCatForm({ ...catForm, razon_social: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">CUIT</label>
                  <input type="text" value={catForm.cuit} onChange={e => setCatForm({ ...catForm, cuit: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="20-12345678-9" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Teléfono</label>
                  <input type="text" value={catForm.telefono} onChange={e => setCatForm({ ...catForm, telefono: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
                <input type="email" value={catForm.email} onChange={e => setCatForm({ ...catForm, email: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Dirección</label>
                <input type="text" value={catForm.direccion} onChange={e => setCatForm({ ...catForm, direccion: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Localidad</label>
                  <input type="text" value={catForm.localidad} onChange={e => setCatForm({ ...catForm, localidad: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Provincia</label>
                  <input type="text" value={catForm.provincia} onChange={e => setCatForm({ ...catForm, provincia: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Contacto principal</label>
                <input type="text" value={catForm.contacto_principal} onChange={e => setCatForm({ ...catForm, contacto_principal: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Nombre y apellido" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Observaciones</label>
                <textarea value={catForm.observaciones} onChange={e => setCatForm({ ...catForm, observaciones: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5">
              <button onClick={() => setCatModalOpen(false)} className="px-4 py-2 rounded-lg border border-zinc-300 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300">Cancelar</button>
              <button onClick={handleSaveTransportista} disabled={catSaving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white text-sm hover:bg-orange-700 disabled:opacity-50">
                {catSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {catEditingId ? "Guardar cambios" : "Crear transportista"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL CREAR ENVÍO ───────────────────────────────────────── */}
      {createEnvioOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-xl shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-lg font-semibold dark:text-white">Registrar envío</h2>
              <button onClick={() => setCreateEnvioOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {/* Transportista desde catálogo */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Transportista *</label>
                <select value={envioForm.transportista_id} onChange={e => setEnvioForm({ ...envioForm, transportista_id: e.target.value, transportista_nombre: "" })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="">Seleccionar del catálogo...</option>
                  {activeTransportistas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
                {!envioForm.transportista_id && (
                  <div className="mt-2">
                    <input type="text" value={envioForm.transportista_nombre} onChange={e => setEnvioForm({ ...envioForm, transportista_nombre: e.target.value })} placeholder="O ingresá nombre manualmente..." className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                    <p className="text-xs text-zinc-400 mt-0.5">El transportista no quedará en el catálogo si lo ingresás manualmente.</p>
                  </div>
                )}
              </div>
              {/* Vincular a remito */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  <span className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Vincular a remito (opcional)</span>
                </label>
                <select value={envioForm.remito_id} onChange={e => { const rem = remitosDisponibles.find(r => r.id === e.target.value); setEnvioForm({ ...envioForm, remito_id: e.target.value, cliente_id: rem?.cliente_id || envioForm.cliente_id }); }} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="">Sin remito</option>
                  {remitosDisponibles.map(r => <option key={r.id} value={r.id}>{r.numero} — {r.clienteNombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cliente</label>
                <select value={envioForm.cliente_id} onChange={e => setEnvioForm({ ...envioForm, cliente_id: e.target.value })} disabled={!!envioForm.remito_id} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white disabled:opacity-60">
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Origen</label>
                  <input type="text" value={envioForm.origen} onChange={e => setEnvioForm({ ...envioForm, origen: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" placeholder="Ciudad de origen" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Destino</label>
                  <input type="text" value={envioForm.destino} onChange={e => setEnvioForm({ ...envioForm, destino: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" placeholder="Ciudad de destino" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha *</label>
                <input type="date" value={envioForm.fecha} onChange={e => setEnvioForm({ ...envioForm, fecha: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Costo flete <span className="text-xs text-zinc-400">(interno)</span></label>
                  <input type="number" step="0.01" value={envioForm.costo} onChange={e => setEnvioForm({ ...envioForm, costo: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" placeholder="Sin costo" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Moneda</label>
                  <select value={envioForm.moneda} onChange={e => setEnvioForm({ ...envioForm, moneda: e.target.value as "ARS" | "USD" })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                    <option value="ARS">ARS</option><option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Bultos</label>
                  <input type="number" min="0" value={envioForm.bultos} onChange={e => setEnvioForm({ ...envioForm, bultos: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo vehículo</label>
                  <input type="text" value={envioForm.tipo_vehiculo} onChange={e => setEnvioForm({ ...envioForm, tipo_vehiculo: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" placeholder="Semi, chasis..." />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Descripción de carga</label>
                <textarea value={envioForm.descripcion_carga} onChange={e => setEnvioForm({ ...envioForm, descripcion_carga: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" rows={2} />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notas</label>
                <textarea value={envioForm.notas} onChange={e => setEnvioForm({ ...envioForm, notas: e.target.value })} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5">
              <button onClick={() => setCreateEnvioOpen(false)} className="px-4 py-2 rounded-lg border border-zinc-300 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300">Cancelar</button>
              <button onClick={handleCreateEnvio} disabled={creatingEnvio} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white text-sm hover:bg-orange-700 disabled:opacity-50">
                {creatingEnvio && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Registrar envío
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
