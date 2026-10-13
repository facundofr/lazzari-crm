"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { mockUsers } from "@/lib/mock-data";
import { ROLE_LABELS, ROLE_PERMISSIONS } from "@/lib/types";
import type { User, Role } from "@/lib/types";
import { Users, Shield, Building2, Plug, Bell, Palette, Database, Key, Loader2, CheckCircle2, Mail, Save, RotateCcw, Percent, Plus, Trash2, X, ShieldCheck, CalendarDays } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { normalizeEmail } from "@/lib/email";
import { useUser } from "@/lib/auth-context";
import { ArcaStatusCard } from "@/components/arca-status-card";
import { FechasChequeConfig } from "@/components/fechas-cheque-config";

type ComisionTipo = "porcentaje_venta" | "porcentaje_margen" | "monto_fijo";
type ComisionAplicaA = "todos" | "vendedor_especifico";

interface ComisionRegla {
  id: string;
  sociedad_id: string;
  nombre: string;
  tipo: ComisionTipo;
  valor: number;
  aplica_a: ComisionAplicaA;
  vendedor_id: string | null;
  activo: boolean;
  created_at: string;
}

interface VendedorOption {
  id: string;
  full_name: string;
}

const COMISION_TIPO_LABELS: Record<ComisionTipo, string> = {
  porcentaje_venta: "% sobre venta",
  porcentaje_margen: "% sobre margen",
  monto_fijo: "Monto fijo",
};

const COMISION_TIPO_BADGE: Record<ComisionTipo, "info" | "purple" | "warning"> = {
  porcentaje_venta: "info",
  porcentaje_margen: "purple",
  monto_fijo: "warning",
};

type TemplateTipo = "presupuesto" | "factura" | "remito" | "orden_compra" | "orden_pago" | "cuenta_corriente";

interface EmailTemplate {
  tipo: TemplateTipo;
  asunto: string;
  cuerpo: string;
}

const DEFAULT_TEMPLATES: Record<TemplateTipo, EmailTemplate> = {
  presupuesto: {
    tipo: "presupuesto",
    asunto: "Presupuesto {{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos el presupuesto {{numero}} por un total de {{total}}.\n\nQuedamos a disposición para cualquier consulta.\n\nSaludos,\n{{sociedad}}",
  },
  factura: {
    tipo: "factura",
    asunto: "Factura {{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos la factura {{numero}} por un total de {{total}}.\n\nDatos bancarios:\nBanco: [completar]\nCBU: [completar]\nAlias: [completar]\n\nSaludos,\n{{sociedad}}",
  },
  remito: {
    tipo: "remito",
    asunto: "Remito {{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos el remito {{numero}}.\n\nSaludos,\n{{sociedad}}",
  },
  orden_compra: {
    tipo: "orden_compra",
    asunto: "{{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos la Orden de Compra N° {{numero}} por un total de {{total}}.\n\nQuedamos a disposición ante cualquier consulta.\n\nSaludos,\n{{sociedad}}",
  },
  orden_pago: {
    tipo: "orden_pago",
    asunto: "Orden de Pago {{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos la Orden de Pago {{numero}} por un total de {{total}}.\n\nSaludos,\n{{sociedad}}",
  },
  cuenta_corriente: {
    tipo: "cuenta_corriente",
    asunto: "Estado de cuenta — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos el estado de su cuenta corriente al {{fecha}}.\n\nSaldo actual: {{saldo}}\n\nAnte cualquier consulta, no dude en contactarnos.\n\nSaludos,\n{{sociedad}}",
  },
};

const roleBadgeVariant: Record<Role, "success" | "warning" | "danger" | "info" | "purple" | "outline"> = {
  super_admin: "danger",
  admin: "info",
  vendedor: "success",
  administrativo: "warning",
  viewer: "outline",
};

export default function ConfiguracionPage() {
  const { sociedadActiva, profile } = useUser();
  // Solo el super_admin (Augusto) invita, cambia roles y da de baja usuarios.
  const canManageUsers = profile?.role === "super_admin";
  const [tab, setTab] = useState<"usuarios" | "roles" | "empresa" | "integraciones" | "notificaciones" | "plantillas" | "comisiones" | "retenciones" | "cheques">("usuarios");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dbUsers, setDbUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [editingNameUserId, setEditingNameUserId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // Email templates state
  const [templates, setTemplates] = useState<Record<TemplateTipo, EmailTemplate>>({ ...DEFAULT_TEMPLATES });
  const [changingRoleUserId, setChangingRoleUserId] = useState<string | null>(null);

  // Invite user state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", nombre: "", role: "vendedor" as Role });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [sociedades, setSociedades] = useState<{ id: string; nombre: string }[]>([]);
  const [inviteSociedadIds, setInviteSociedadIds] = useState<string[]>([]);

  const [templateSaving, setTemplateSaving] = useState<TemplateTipo | null>(null);
  const [templateSaved, setTemplateSaved] = useState<TemplateTipo | null>(null);

  // Comisiones state
  const [comisionReglas, setComisionReglas] = useState<ComisionRegla[]>([]);
  const [comisionesLoading, setComisionesLoading] = useState(false);
  const [vendedores, setVendedores] = useState<VendedorOption[]>([]);
  const [showComisionForm, setShowComisionForm] = useState(false);
  const [editingComision, setEditingComision] = useState<ComisionRegla | null>(null);
  const [comisionForm, setComisionForm] = useState({
    nombre: "",
    tipo: "porcentaje_venta" as ComisionTipo,
    valor: "",
    aplica_a: "todos" as ComisionAplicaA,
    vendedor_id: "",
    activo: true,
  });
  const [comisionSaving, setComisionSaving] = useState(false);

  // Retenciones config state
  const [retencionCfg, setRetencionCfg] = useState({
    aplica_iva: true,
    minimo_iva: 130000,
    tasa_iva_ri: 10.5,
    aplica_ganancias: true,
    minimo_ganancias: 224000,
    tasa_ganancias_ri: 3.5,
    tasa_ganancias_no_inscripto: 28,
    minimo_retencion_ganancias: 240,
  });
  const [retencionCfgSaving, setRetencionCfgSaving] = useState(false);
  const [retencionCfgSaved, setRetencionCfgSaved] = useState(false);

  // Empresa form — controlled inputs
  const [empresa, setEmpresa] = useState({
    razon_social: "",
    cuit: "",
    condicion_iva: "",
    direccion: "",
    punto_venta: "",
    inicio_actividades: "",
  });

  useEffect(() => {
    async function fetchUsers() {
      // Fetch real users from profiles
      try {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email, role, active, created_at")
          .eq("active", true)
          .order("created_at", { ascending: false });
        if (profiles) {
          setDbUsers(profiles.map((p: any) => ({
            id: p.id,
            name: p.full_name || p.email || "—",
            email: p.email || "",
            role: p.role || "viewer",
            active: p.active ?? true,
            createdAt: p.created_at ? new Date(p.created_at).toLocaleDateString("es-AR") : "—",
          })));
        } else {
          setDbUsers(mockUsers);
        }
      } catch {
        setDbUsers(mockUsers);
      }
      setUsersLoading(false);
    }
    fetchUsers();

    // Fetch sociedades for invite modal
    (supabase as any).from("sociedades").select("id, nombre").order("nombre").then(({ data }: any) => {
      if (data) setSociedades(data);
    });
  }, []);

  async function handleInviteUser() {
    const normalizedEmail = normalizeEmail(inviteForm.email);
    if (!normalizedEmail) return;
    if (!inviteForm.nombre.trim()) return;
    setInviteSaving(true);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          nombre: inviteForm.nombre.trim(),
          role: inviteForm.role,
          sociedad_ids: inviteSociedadIds,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al invitar");
      setShowInviteModal(false);
      setInviteForm({ email: "", nombre: "", role: "vendedor" });
      setInviteSociedadIds([]);
      // Refresh users list
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, active, created_at")
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (profiles) {
        setDbUsers(profiles.map((p: any) => ({
          id: p.id, name: p.full_name || p.email || "—", email: p.email || "",
          role: p.role || "viewer", active: p.active ?? true,
          createdAt: p.created_at ? new Date(p.created_at).toLocaleDateString("es-AR") : "—",
        })));
      }
      alert(json.invite_sent
        ? (json.recovered ? "Acceso recuperado e invitación reenviada correctamente." : "Usuario invitado correctamente. Recibirá un email para definir su contraseña.")
        : (json.warning || "El acceso quedó creado, pero no se pudo enviar la invitación."));
    } catch (e: any) {
      alert(e.message || "Error al invitar usuario");
    } finally {
      setInviteSaving(false);
    }
  }

  async function updateSystemUser(id: string, changes: { full_name?: string; role?: Role }) {
    const response = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...changes }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "No se pudo actualizar el usuario");
  }

  async function deleteSystemUser(row: User) {
    if (!confirm(`¿Eliminar el acceso de ${row.name}? La trazabilidad de sus operaciones se conservará.`)) return;
    setDeletingUserId(row.id);
    try {
      const response = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudo eliminar el usuario");
      setDbUsers((current) => current.filter((user) => user.id !== row.id));
      alert(json.mode === "disabled" ? "Acceso eliminado. Se conservó el usuario inactivo por su historial contable." : "Usuario eliminado.");
    } catch (deleteError) {
      alert(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el usuario");
    } finally {
      setDeletingUserId(null);
    }
  }

  // Fetch empresa config scoped to sociedadActiva
  useEffect(() => {
    async function fetchEmpresaConfig() {
      if (!sociedadActiva) return;
      // Reset to defaults when switching sociedad
      setEmpresa({ razon_social: "", cuit: "", condicion_iva: "", direccion: "", punto_venta: "", inicio_actividades: "" });
      try {
        const { data: config } = await (supabase as any)
          .from("configuracion")
          .select("key, value")
          .eq("key", "empresa")
          .eq("sociedad_id", sociedadActiva.id);
        if (config) {
          const empresaConfig = config.find((c: any) => c.key === "empresa");
          if (empresaConfig) {
            const val = empresaConfig.value || {};
            setEmpresa({
              razon_social: val.razon_social || "",
              cuit: val.cuit || "",
              condicion_iva: val.condicion_iva || "",
              direccion: val.direccion || "",
              punto_venta: val.punto_venta || "",
              inicio_actividades: val.inicio_actividades || "",
            });
          }
        }
      } catch {
        // Config table may not exist yet — leave defaults
      }
    }
    fetchEmpresaConfig();
  }, [sociedadActiva]);

  // Fetch email templates when sociedadActiva changes
  useEffect(() => {
    async function fetchTemplates() {
      if (!sociedadActiva) return;
      try {
        const { data } = await (supabase as any)
          .from("email_templates")
          .select("tipo, asunto, cuerpo")
          .eq("sociedad_id", sociedadActiva.id);
        if (data) {
          const loaded = { ...DEFAULT_TEMPLATES };
          for (const row of data) {
            if (row.tipo in loaded) {
              loaded[row.tipo as TemplateTipo] = {
                tipo: row.tipo,
                asunto: row.asunto || DEFAULT_TEMPLATES[row.tipo as TemplateTipo].asunto,
                cuerpo: row.cuerpo || DEFAULT_TEMPLATES[row.tipo as TemplateTipo].cuerpo,
              };
            }
          }
          setTemplates(loaded);
        } else {
          setTemplates({ ...DEFAULT_TEMPLATES });
        }
      } catch {
        setTemplates({ ...DEFAULT_TEMPLATES });
      }
    }
    fetchTemplates();
  }, [sociedadActiva]);

  function handleTemplateChange(tipo: TemplateTipo, field: "asunto" | "cuerpo", value: string) {
    setTemplates((prev) => ({
      ...prev,
      [tipo]: { ...prev[tipo], [field]: value },
    }));
    setTemplateSaved(null);
  }

  async function handleSaveTemplate(tipo: TemplateTipo) {
    if (!sociedadActiva) return;
    setTemplateSaving(tipo);
    try {
      const { error } = await (supabase as any).from("email_templates").upsert(
        {
          sociedad_id: sociedadActiva.id,
          tipo,
          asunto: templates[tipo].asunto,
          cuerpo: templates[tipo].cuerpo,
        },
        { onConflict: "sociedad_id,tipo" }
      );
      if (error) {
        alert("Error al guardar plantilla de email: " + error.message);
        return;
      }
      setTemplateSaved(tipo);
      setTimeout(() => setTemplateSaved(null), 3000);
    } catch (err) {
      console.error("Error saving email template:", err);
      alert("Error al guardar plantilla de email.");
    } finally {
      setTemplateSaving(null);
    }
  }

  function handleRestoreTemplate(tipo: TemplateTipo) {
    setTemplates((prev) => ({
      ...prev,
      [tipo]: { ...DEFAULT_TEMPLATES[tipo] },
    }));
    setTemplateSaved(null);
  }

  // Fetch comisiones + vendedores when sociedadActiva changes or tab switches
  useEffect(() => {
    async function fetchComisiones() {
      if (!sociedadActiva) return;
      setComisionesLoading(true);
      try {
        const { data } = await (supabase as any)
          .from("comision_reglas")
          .select("*")
          .eq("sociedad_id", sociedadActiva.id)
          .order("created_at", { ascending: false });
        if (data) setComisionReglas(data);
      } catch {
        setComisionReglas([]);
      }
      // Fetch vendedores for selector
      try {
        const { data: vData } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("role", "vendedor");
        if (vData) setVendedores(vData.map((v: any) => ({ id: v.id, full_name: v.full_name || "Sin nombre" })));
      } catch {
        setVendedores([]);
      }
      setComisionesLoading(false);
    }
    if (tab === "comisiones") fetchComisiones();

    if (tab === "retenciones" && sociedadActiva?.id) {
      (async () => {
        try {
          const { data } = await (supabase as any).from("retencion_config").select("*").eq("sociedad_id", sociedadActiva.id).single();
          if (data) setRetencionCfg({
            aplica_iva: data.aplica_iva ?? true,
            minimo_iva: data.minimo_iva ?? 130000,
            tasa_iva_ri: data.tasa_iva_ri ?? 10.5,
            aplica_ganancias: data.aplica_ganancias ?? true,
            minimo_ganancias: data.minimo_ganancias ?? 400000,
            tasa_ganancias_ri: data.tasa_ganancias_ri ?? 3.5,
            tasa_ganancias_no_inscripto: data.tasa_ganancias_no_inscripto ?? 28,
            minimo_retencion_ganancias: data.minimo_retencion_ganancias ?? 240,
          });
        } catch { /* use defaults */ }
      })();
    }
  }, [sociedadActiva, tab]);

  function resetComisionForm() {
    setComisionForm({ nombre: "", tipo: "porcentaje_venta", valor: "", aplica_a: "todos", vendedor_id: "", activo: true });
    setEditingComision(null);
    setShowComisionForm(false);
  }

  function handleEditComision(regla: ComisionRegla) {
    setComisionForm({
      nombre: regla.nombre,
      tipo: regla.tipo,
      valor: String(regla.valor),
      aplica_a: regla.aplica_a as ComisionAplicaA,
      vendedor_id: regla.vendedor_id || "",
      activo: regla.activo,
    });
    setEditingComision(regla);
    setShowComisionForm(true);
  }

  async function handleSaveComision() {
    if (!sociedadActiva || !comisionForm.nombre || !comisionForm.valor) return;
    setComisionSaving(true);
    try {
      const payload = {
        sociedad_id: sociedadActiva.id,
        nombre: comisionForm.nombre,
        tipo: comisionForm.tipo,
        valor: parseFloat(comisionForm.valor),
        aplica_a: comisionForm.aplica_a,
        vendedor_id: comisionForm.aplica_a === "vendedor_especifico" ? comisionForm.vendedor_id || null : null,
        activo: comisionForm.activo,
      };
      if (editingComision) {
        const { error } = await (supabase as any).from("comision_reglas").update(payload).eq("id", editingComision.id).eq("sociedad_id", sociedadActiva.id);
        if (error) {
          alert("Error al actualizar regla de comisión: " + error.message);
          return;
        }
      } else {
        const { error } = await (supabase as any).from("comision_reglas").insert(payload);
        if (error) {
          alert("Error al crear regla de comisión: " + error.message);
          return;
        }
      }
      // Re-fetch
      const { data } = await (supabase as any)
        .from("comision_reglas")
        .select("*")
        .eq("sociedad_id", sociedadActiva.id)
        .order("created_at", { ascending: false });
      if (data) setComisionReglas(data);
      resetComisionForm();
    } catch (err) {
      console.error("Error saving comision regla:", err);
      alert("Error al guardar regla de comisión.");
    } finally {
      setComisionSaving(false);
    }
  }

  async function handleDeleteComision(id: string) {
    if (!sociedadActiva) return;
    try {
      const { error } = await (supabase as any).from("comision_reglas").delete().eq("id", id).eq("sociedad_id", sociedadActiva.id);
      if (error) {
        alert("Error al eliminar regla de comisión: " + error.message);
        return;
      }
      setComisionReglas((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Error deleting comision regla:", err);
      alert("Error al eliminar regla de comisión.");
    }
  }

  async function handleToggleComisionActivo(regla: ComisionRegla) {
    if (!sociedadActiva?.id) return;
    try {
      const { error } = await (supabase as any).from("comision_reglas").update({ activo: !regla.activo }).eq("id", regla.id).eq("sociedad_id", sociedadActiva.id);
      if (error) {
        alert("Error al cambiar estado de comisión: " + error.message);
        return;
      }
      setComisionReglas((prev) => prev.map((r) => r.id === regla.id ? { ...r, activo: !r.activo } : r));
    } catch (err) {
      console.error("Error toggling comision:", err);
      alert("Error al cambiar estado de comisión.");
    }
  }

  async function handleSaveRetencionCfg() {
    if (!sociedadActiva?.id) return;
    setRetencionCfgSaving(true);
    try {
      const { error } = await (supabase as any).from("retencion_config").upsert(
        { sociedad_id: sociedadActiva.id, ...retencionCfg, updated_at: new Date().toISOString() },
        { onConflict: "sociedad_id" }
      );
      if (error) throw error;
      setRetencionCfgSaved(true);
      setTimeout(() => setRetencionCfgSaved(false), 2500);
    } catch (err: any) {
      alert("Error al guardar configuración de retenciones: " + err.message);
    } finally {
      setRetencionCfgSaving(false);
    }
  }

  // Notification toggles
  const [notifs, setNotifs] = useState({
    pr_vencer: true,
    stock_bajo: true,
    cc_vencida: true,
    cheque_vencer: true,
    seguimiento: false,
    resumen_diario: false,
  });
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaved, setNotifSaved] = useState<string | null>(null);

  // Fetch notification preferences on mount
  useEffect(() => {
    async function fetchNotifPrefs() {
      if (!profile?.id) return;
      try {
        const { data } = await (supabase as any)
          .from("notification_preferences")
          .select("pr_vencer, stock_bajo, cc_vencida, cheque_vencer, seguimiento, resumen_diario")
          .eq("user_id", profile.id)
          .single();
        if (data) {
          setNotifs({
            pr_vencer: data.pr_vencer ?? true,
            stock_bajo: data.stock_bajo ?? true,
            cc_vencida: data.cc_vencida ?? true,
            cheque_vencer: data.cheque_vencer ?? true,
            seguimiento: data.seguimiento ?? false,
            resumen_diario: data.resumen_diario ?? false,
          });
        }
      } catch {
        // No row yet — use defaults
      }
    }
    fetchNotifPrefs();
  }, [profile?.id]);

  function handleEmpresaChange(key: string, value: string) {
    setEmpresa((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSaveEmpresa() {
    if (!sociedadActiva) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("configuracion").upsert(
        { key: "empresa", value: empresa, sociedad_id: sociedadActiva.id },
        { onConflict: "sociedad_id,key" }
      );
      if (error) {
        alert("Error al guardar configuración de empresa: " + error.message);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Error saving empresa config:", err);
      alert("Error al guardar configuración de empresa.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleNotif(key: keyof typeof notifs) {
    if (!profile?.id) return;
    const newValue = !notifs[key];
    setNotifs((prev) => ({ ...prev, [key]: newValue }));
    setNotifSaved(null);
    try {
      const { error } = await (supabase as any).from("notification_preferences").upsert(
        {
          user_id: profile.id,
          [key]: newValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) {
        setNotifs((prev) => ({ ...prev, [key]: !newValue }));
        alert("Error al guardar preferencia de notificación: " + error.message);
        return;
      }
      setNotifSaved(key);
      setTimeout(() => setNotifSaved(null), 2000);
    } catch (err) {
      // Revert on error
      setNotifs((prev) => ({ ...prev, [key]: !newValue }));
      console.error("Error saving notification preference:", err);
      alert("Error al guardar preferencia de notificación.");
    }
  }

  const tabs = [
    { id: "usuarios" as const, label: "Usuarios", icon: Users },
    { id: "roles" as const, label: "Roles y permisos", icon: Shield },
    { id: "empresa" as const, label: "Empresa", icon: Building2 },
    { id: "integraciones" as const, label: "Integraciones", icon: Plug },
    { id: "notificaciones" as const, label: "Notificaciones", icon: Bell },
    { id: "plantillas" as const, label: "Plantillas de Email", icon: Mail },
    // Comisiones: solo super_admin y admin (el rol administrativo no las ve).
    ...(profile?.role === "super_admin" || profile?.role === "admin" ? [{ id: "comisiones" as const, label: "Comisiones", icon: Percent }] : []),
    { id: "retenciones" as const, label: "Retenciones", icon: ShieldCheck },
    { id: "cheques" as const, label: "Fechas de cheque", icon: CalendarDays },
  ];

  return (
    <>
      <Header title="Configuracion" subtitle="Administracion del sistema" />
      <div className="p-3 sm:p-5 space-y-4">
        <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                tab === t.id ? "border-orange-500 text-orange-600" : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}>
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "cheques" && <FechasChequeConfig />}

        {tab === "usuarios" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-white">Usuarios del sistema</h3>
                <p className="text-sm text-zinc-500">{dbUsers.length} usuarios registrados</p>
              </div>
              {canManageUsers ? (
                <button onClick={() => setShowInviteModal(true)} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600">
                  <Plus className="h-4 w-4" /> Invitar usuario
                </button>
              ) : (
                <button disabled className="rounded-lg bg-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 cursor-not-allowed dark:bg-zinc-700 dark:text-zinc-400" title="Solo admins">
                  Invitar usuario
                </button>
              )}
            </div>
            <Card className="p-0 overflow-hidden">
              <DataTable<User>
                columns={[
                  {
                    key: "name", label: "Usuario", sortable: true,
                    render: (row) => editingNameUserId === row.id && canManageUsers && (row.role !== "super_admin" || profile?.role === "super_admin") ? (
                      <div className="flex min-w-[250px] items-center gap-2">
                        <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
                        <button onClick={async () => {
                          try {
                            await updateSystemUser(row.id, { full_name: editingName });
                            setDbUsers((current) => current.map((user) => user.id === row.id ? { ...user, name: editingName.trim() } : user));
                            setEditingNameUserId(null);
                          } catch (updateError) { alert(updateError instanceof Error ? updateError.message : "No se pudo cambiar el nombre"); }
                        }} className="rounded bg-orange-500 px-2 py-1.5 text-xs font-semibold text-white">Guardar</button>
                        <button onClick={() => setEditingNameUserId(null)} className="text-xs text-zinc-500">Cancelar</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                          {row.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </div>
                        <div>
                          {canManageUsers && (row.role !== "super_admin" || profile?.role === "super_admin") ? (
                            <button onClick={() => { setEditingNameUserId(row.id); setEditingName(row.name); }} className="font-medium text-zinc-900 hover:text-orange-600 dark:text-white dark:hover:text-orange-400" title="Editar nombre">{row.name} <span className="text-xs text-zinc-400">✎</span></button>
                          ) : (
                            <span className="font-medium text-zinc-900 dark:text-white">{row.name}</span>
                          )}
                          <p className="text-xs text-zinc-400">{row.email}</p>
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "role", label: "Rol", sortable: true,
                    render: (row) => changingRoleUserId === row.id && canManageUsers && (row.role !== "super_admin" || profile?.role === "super_admin") ? (
                      <select
                        defaultValue={row.role}
                        autoFocus
                        onBlur={() => setChangingRoleUserId(null)}
                        onChange={async (e) => {
                          const newRole = e.target.value as Role;
                          try {
                            await updateSystemUser(row.id, { role: newRole });
                            setDbUsers(prev => prev.map(u => u.id === row.id ? { ...u, role: newRole } : u));
                          } catch (updateError) { alert(updateError instanceof Error ? updateError.message : "Error al cambiar rol"); }
                          setChangingRoleUserId(null);
                        }}
                        className="rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1 text-xs"
                      >
                        {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([r, l]) => <option key={r} value={r}>{l}</option>)}
                      </select>
                    ) : (
                      canManageUsers && (row.role !== "super_admin" || profile?.role === "super_admin") ? (
                        <button onClick={() => setChangingRoleUserId(row.id)} className="flex items-center gap-1.5 group" title="Click para cambiar rol">
                          <Badge variant={roleBadgeVariant[row.role]}>{ROLE_LABELS[row.role]}</Badge>
                          <span className="text-xs text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                        </button>
                      ) : <Badge variant={roleBadgeVariant[row.role]}>{ROLE_LABELS[row.role]}</Badge>
                    ),
                  },
                  { key: "active", label: "Estado", sortable: true, render: (row) => <Badge variant={row.active ? "success" : "outline"}>{row.active ? "Activo" : "Inactivo"}</Badge> },
                  { key: "createdAt", label: "Registrado", sortable: true, render: (row) => <span className="text-zinc-400 text-xs">{row.createdAt}</span> },
                  {
                    key: "actions", label: "", sortable: false,
                    render: (row) => canManageUsers && row.id !== profile?.id && (row.role !== "super_admin" || profile?.role === "super_admin") ? (
                      <button onClick={() => void deleteSystemUser(row)} disabled={deletingUserId === row.id} className="rounded-md p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30" title="Eliminar acceso">
                        {deletingUserId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    ) : null,
                  },
                ]}
                data={dbUsers}
                loading={usersLoading}
              />
            </Card>
          </div>
        )}

        {tab === "roles" && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Roles y niveles de acceso</CardTitle></CardHeader>
              <p className="text-sm text-zinc-500 mb-6">Cada usuario tiene un rol asignado que determina que modulos puede ver y que acciones puede realizar.</p>
              <div className="space-y-4">
                {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([role, label]) => {
                  const permissions = ROLE_PERMISSIONS[role];
                  const isWildcard = permissions.some((p) => p.module === "*");
                  return (
                    <div key={role} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <Badge variant={roleBadgeVariant[role]}>{label}</Badge>
                          <span className="text-xs text-zinc-400">{dbUsers.filter((u) => u.role === role).length} usuario(s)</span>
                        </div>
                      </div>
                      {isWildcard ? (
                        <p className="text-sm text-zinc-500">Acceso completo a todos los modulos y acciones.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {permissions.map((p) => (
                            <div key={p.module} className="rounded-md bg-zinc-50 px-2.5 py-1.5 text-xs dark:bg-zinc-800">
                              <span className="font-medium text-zinc-700 dark:text-zinc-300">{p.module}</span>
                              <span className="text-zinc-400 ml-1">({p.actions.join(", ")})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardHeader><CardTitle>Matriz de permisos</CardTitle></CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500">Modulo</th>
                      {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([role, label]) => (
                        <th key={role} className="px-3 py-2 text-center text-xs font-semibold text-zinc-500">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {["dashboard", "clientes", "presupuestos", "facturacion", "remitos", "stock", "finanzas", "reportes", "configuracion"].map((mod) => (
                      <tr key={mod} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="px-3 py-2 font-medium capitalize text-zinc-700 dark:text-zinc-300">{mod}</td>
                        {(Object.keys(ROLE_LABELS) as Role[]).map((role) => {
                          const perms = ROLE_PERMISSIONS[role];
                          const hasAccess = perms.some((p) => p.module === "*" || p.module === mod);
                          const actions = perms.find((p) => p.module === "*" || p.module === mod)?.actions || [];
                          return (
                            <td key={role} className="px-3 py-2 text-center">
                              {hasAccess ? (
                                <span className="text-xs text-emerald-600 font-medium">
                                  {perms.some((p) => p.module === "*") ? "FULL" : actions.length > 3 ? "CRUD" : actions.map((a) => a[0].toUpperCase()).join("")}
                                </span>
                              ) : (
                                <span className="text-xs text-zinc-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {tab === "empresa" && (
          <Card>
            <CardHeader><CardTitle>Datos de la empresa</CardTitle></CardHeader>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {[
                { key: "razon_social", label: "Razon social" },
                { key: "cuit", label: "CUIT" },
                { key: "condicion_iva", label: "Condicion IVA" },
                { key: "direccion", label: "Direccion fiscal" },
                { key: "punto_venta", label: "Punto de venta AFIP" },
                { key: "inicio_actividades", label: "Inicio de actividades" },
              ].map((field) => (
                <div key={field.key}>
                  <label className="text-xs font-medium text-zinc-500">{field.label}</label>
                  <input
                    type="text"
                    value={empresa[field.key as keyof typeof empresa]}
                    onChange={(e) => handleEmpresaChange(field.key, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              {saved && (
                <span className="flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Guardado
                </span>
              )}
              <button onClick={handleSaveEmpresa} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar cambios
              </button>
            </div>
          </Card>
        )}

        {tab === "integraciones" && (
          <div className="space-y-4">
          <ArcaStatusCard />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { name: "AFIP — Remitos electronicos", desc: "COT para remitos con codigo de autorizacion", icon: Key, connected: false, note: "Requiere certificado digital" },
              { name: "Banco — Cuenta corriente", desc: "Sincronizacion de movimientos bancarios", icon: Database, connected: false, note: "API bancaria pendiente" },
              { name: "Banco — E-cheques", desc: "Gestion de echeqs emitidos y recibidos", icon: Database, connected: false, note: "API bancaria pendiente" },
              { name: "Email — Envio de PR", desc: "SMTP para envio de presupuestos al cliente", icon: Plug, connected: false, note: "Configurar servidor SMTP" },
              { name: "IA — Asistente", desc: "Claude AI para asistencia en remitos y documentos", icon: Palette, connected: true, note: "" },
            ].map((integration) => (
              <Card key={integration.name} className="flex items-start gap-4">
                <div className={`rounded-lg p-2.5 ${integration.connected ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"}`}>
                  <integration.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-zinc-900 dark:text-white">{integration.name}</h4>
                    <Badge variant={integration.connected ? "success" : "outline"}>
                      {integration.connected ? "Conectado" : "No configurado"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">{integration.desc}</p>
                  {integration.note && <p className="mt-1 text-xs text-zinc-400">{integration.note}</p>}
                  {integration.connected ? (
                    <span className="mt-3 inline-block text-xs font-medium text-emerald-500">Activo</span>
                  ) : (
                    <span className="mt-3 inline-block text-xs text-zinc-400">Próximamente</span>
                  )}
                </div>
              </Card>
            ))}
          </div>
          </div>
        )}

        {tab === "notificaciones" && (
          <Card>
            <CardHeader><CardTitle>Preferencias de notificaciones</CardTitle></CardHeader>
            <p className="text-sm text-zinc-500 mb-4">Elegí qué alertas querés recibir. Los cambios se guardan automáticamente.</p>
            <div className="space-y-4">
              {([
                { key: "pr_vencer" as const, label: "PR próximo a vencer", desc: "Alerta cuando un presupuesto está cerca de su fecha de vencimiento" },
                { key: "stock_bajo" as const, label: "Stock bajo", desc: "Alerta cuando un artículo baja del stock mínimo" },
                { key: "cc_vencida" as const, label: "Cuenta corriente vencida", desc: "Alerta cuando un cliente supera los días de CC" },
                { key: "cheque_vencer" as const, label: "E-cheque próximo a vencer", desc: "Recordatorio de cheques por depositar o con vencimiento cercano" },
                { key: "seguimiento" as const, label: "Seguimiento comercial", desc: "Sugerencias de re-cotización tras rechazos" },
                { key: "resumen_diario" as const, label: "Resumen diario por email", desc: "Resumen de actividad del día enviado por email" },
              ]).map((pref) => (
                <div key={pref.key} className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                  <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{pref.label}</p>
                    <p className="text-xs text-zinc-500">{pref.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {notifSaved === pref.key && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Guardado
                      </span>
                    )}
                    <button
                      onClick={() => toggleNotif(pref.key)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${notifs[pref.key] ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${notifs[pref.key] ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === "comisiones" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-white">Reglas de Comisiones</h3>
                <p className="text-sm text-zinc-500">
                  Configurá las reglas de comisión para los vendedores.
                  {sociedadActiva && <span className="ml-1 font-medium text-zinc-700 dark:text-zinc-300">Sociedad: {sociedadActiva.nombre}</span>}
                </p>
              </div>
              <button
                onClick={() => { resetComisionForm(); setShowComisionForm(true); }}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Nueva regla
              </button>
            </div>

            {/* Form inline */}
            {showComisionForm && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{editingComision ? "Editar regla" : "Nueva regla de comisión"}</CardTitle>
                    <button onClick={resetComisionForm} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </CardHeader>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-zinc-500">Nombre de la regla</label>
                    <input
                      type="text"
                      value={comisionForm.nombre}
                      onChange={(e) => setComisionForm((f) => ({ ...f, nombre: e.target.value }))}
                      placeholder="Ej: Comisión venta 3%"
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Tipo</label>
                    <select
                      value={comisionForm.tipo}
                      onChange={(e) => setComisionForm((f) => ({ ...f, tipo: e.target.value as ComisionTipo }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    >
                      {(Object.entries(COMISION_TIPO_LABELS) as [ComisionTipo, string][]).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      Valor {comisionForm.tipo === "monto_fijo" ? "($)" : "(%)"}
                    </label>
                    <div className="relative mt-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={comisionForm.valor}
                        onChange={(e) => setComisionForm((f) => ({ ...f, valor: e.target.value }))}
                        placeholder={comisionForm.tipo === "monto_fijo" ? "1500.00" : "3"}
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 pr-8 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                        {comisionForm.tipo === "monto_fijo" ? "$" : "%"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Aplica a</label>
                    <select
                      value={comisionForm.aplica_a}
                      onChange={(e) => setComisionForm((f) => ({ ...f, aplica_a: e.target.value as ComisionAplicaA }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="todos">Todos los vendedores</option>
                      <option value="vendedor_especifico">Vendedor específico</option>
                    </select>
                  </div>
                  {comisionForm.aplica_a === "vendedor_especifico" && (
                    <div>
                      <label className="text-xs font-medium text-zinc-500">Vendedor</label>
                      <select
                        value={comisionForm.vendedor_id}
                        onChange={(e) => setComisionForm((f) => ({ ...f, vendedor_id: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                      >
                        <option value="">Seleccionar vendedor...</option>
                        {vendedores.map((v) => (
                          <option key={v.id} value={v.id}>{v.full_name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-3 sm:col-span-2">
                    <button
                      onClick={() => setComisionForm((f) => ({ ...f, activo: !f.activo }))}
                      className={`relative h-6 w-11 rounded-full transition-colors ${comisionForm.activo ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${comisionForm.activo ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">{comisionForm.activo ? "Activa" : "Inactiva"}</span>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    onClick={resetComisionForm}
                    className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveComision}
                    disabled={comisionSaving || !comisionForm.nombre || !comisionForm.valor}
                    className="flex items-center gap-2 rounded-lg bg-orange-500 px-6 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                  >
                    {comisionSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {editingComision ? "Actualizar" : "Guardar"}
                  </button>
                </div>
              </Card>
            )}

            {/* List */}
            {comisionesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
              </div>
            ) : comisionReglas.length === 0 ? (
              <Card className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-zinc-100 p-3 dark:bg-zinc-800">
                  <Percent className="h-6 w-6 text-zinc-400" />
                </div>
                <p className="mt-3 font-medium text-zinc-700 dark:text-zinc-300">No hay reglas de comisión</p>
                <p className="text-sm text-zinc-500">Creá una regla para empezar a calcular comisiones.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {comisionReglas.map((regla) => {
                  const vendedorName = regla.vendedor_id
                    ? vendedores.find((v) => v.id === regla.vendedor_id)?.full_name || "Vendedor"
                    : null;
                  return (
                    <Card key={regla.id} className={`transition-opacity ${!regla.activo ? "opacity-60" : ""}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="rounded-lg bg-orange-50 p-2.5 text-orange-600 dark:bg-orange-900/30">
                            <Percent className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-zinc-900 dark:text-white">{regla.nombre}</p>
                              <Badge variant={COMISION_TIPO_BADGE[regla.tipo]}>{COMISION_TIPO_LABELS[regla.tipo]}</Badge>
                              {!regla.activo && <Badge variant="outline">Inactiva</Badge>}
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-sm text-zinc-500">
                              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                                {regla.tipo === "monto_fijo" ? `$ ${regla.valor}` : `${regla.valor}%`}
                              </span>
                              <span>·</span>
                              <span>
                                {regla.aplica_a === "todos"
                                  ? "Todos los vendedores"
                                  : vendedorName || "Vendedor específico"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleToggleComisionActivo(regla)}
                            className={`relative h-6 w-11 rounded-full transition-colors ${regla.activo ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                            title={regla.activo ? "Desactivar" : "Activar"}
                          >
                            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${regla.activo ? "left-[22px]" : "left-0.5"}`} />
                          </button>
                          <button
                            onClick={() => handleEditComision(regla)}
                            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
                            title="Editar"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteComision(regla.id)}
                            className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "retenciones" && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-white">Configuración de Retenciones</h3>
              <p className="text-sm text-zinc-500 mt-1">
                Definí los montos mínimos y tasas para el cálculo automático de retenciones en Órdenes de Pago.
                {sociedadActiva && <span className="ml-1 font-medium text-zinc-700 dark:text-zinc-300">Sociedad: {sociedadActiva.nombre}</span>}
              </p>
            </div>

            {/* IVA */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-900/30">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle>Retención IVA</CardTitle>
                      <p className="text-xs text-zinc-400 mt-0.5">RG 2854 — aplica a Responsables Inscriptos</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRetencionCfg(prev => ({ ...prev, aplica_iva: !prev.aplica_iva }))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${retencionCfg.aplica_iva ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${retencionCfg.aplica_iva ? "translate-x-4.5" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </CardHeader>
              {retencionCfg.aplica_iva && (
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Mínimo no imponible (ARS)</label>
                    <input
                      type="number"
                      value={retencionCfg.minimo_iva}
                      onChange={(e) => setRetencionCfg(prev => ({ ...prev, minimo_iva: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                    <p className="text-xs text-zinc-400 mt-1">Si el pago es mayor a este monto, se aplica retención</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Tasa RI (%)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={retencionCfg.tasa_iva_ri}
                      onChange={(e) => setRetencionCfg(prev => ({ ...prev, tasa_iva_ri: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                </div>
              )}
            </Card>

            {/* Ganancias */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-violet-50 p-2 text-violet-600 dark:bg-violet-900/30">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle>Retención Ganancias</CardTitle>
                      <p className="text-xs text-zinc-400 mt-0.5">RG 830 — aplica a proveedores inscriptos</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRetencionCfg(prev => ({ ...prev, aplica_ganancias: !prev.aplica_ganancias }))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${retencionCfg.aplica_ganancias ? "bg-violet-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${retencionCfg.aplica_ganancias ? "translate-x-4.5" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </CardHeader>
              {retencionCfg.aplica_ganancias && (
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Mínimo no imponible (ARS)</label>
                    <input
                      type="number"
                      value={retencionCfg.minimo_ganancias}
                      onChange={(e) => setRetencionCfg(prev => ({ ...prev, minimo_ganancias: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Tasa RI (%)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={retencionCfg.tasa_ganancias_ri}
                      onChange={(e) => setRetencionCfg(prev => ({ ...prev, tasa_ganancias_ri: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Tasa no inscripto (%)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={retencionCfg.tasa_ganancias_no_inscripto}
                      onChange={(e) => setRetencionCfg(prev => ({ ...prev, tasa_ganancias_no_inscripto: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Mínimo de retención (Art. 29)</label>
                    <input
                      type="number"
                      value={retencionCfg.minimo_retencion_ganancias}
                      onChange={(e) => setRetencionCfg(prev => ({ ...prev, minimo_retencion_ganancias: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                    <p className="text-xs text-zinc-400 mt-1">Si la retención calculada es menor a este monto, no se retiene</p>
                  </div>
                </div>
              )}
            </Card>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveRetencionCfg}
                disabled={retencionCfgSaving}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {retencionCfgSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar configuración
              </button>
              {retencionCfgSaved && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Guardado
                </span>
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 text-sm text-zinc-500 space-y-1">
              <p className="font-medium text-zinc-700 dark:text-zinc-300">¿Cómo funciona?</p>
              <p>Al crear una Orden de Pago y seleccionar el proveedor, el sistema consulta automáticamente el padrón de AFIP para determinar su condición (RI, Monotributo, etc.) y pre-completa las retenciones según esta configuración.</p>
              <p className="mt-1">El usuario puede editar los valores antes de confirmar.</p>
            </div>
          </div>
        )}

        {tab === "plantillas" && (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-white">Plantillas de Email</h3>
              <p className="text-sm text-zinc-500">
                Editá las leyendas que se usan al enviar documentos por email.
                {sociedadActiva && <span className="ml-1 font-medium text-zinc-700 dark:text-zinc-300">Sociedad: {sociedadActiva.nombre}</span>}
              </p>
            </div>

            {(["presupuesto", "factura", "remito", "orden_compra", "orden_pago", "cuenta_corriente"] as TemplateTipo[]).map((tipo) => {
              const template = templates[tipo];
              const label = tipo === "presupuesto" ? "Presupuesto" : tipo === "factura" ? "Factura" : tipo === "remito" ? "Remito" : tipo === "orden_compra" ? "Orden de Compra" : tipo === "orden_pago" ? "Orden de Pago" : "Cuenta corriente";
              const isSaving = templateSaving === tipo;
              const isSaved = templateSaved === tipo;

              return (
                <Card key={tipo}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-orange-50 p-2 text-orange-600 dark:bg-orange-900/30">
                        <Mail className="h-5 w-5" />
                      </div>
                      <CardTitle>{label}</CardTitle>
                    </div>
                  </CardHeader>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-zinc-500">Asunto</label>
                      <input
                        type="text"
                        value={template.asunto}
                        onChange={(e) => handleTemplateChange(tipo, "asunto", e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500">Cuerpo</label>
                      <textarea
                        rows={6}
                        value={template.cuerpo}
                        onChange={(e) => handleTemplateChange(tipo, "cuerpo", e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white resize-y"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs text-zinc-400">Variables disponibles:</span>
                      {["{{numero}}", "{{cliente}}", "{{sociedad}}", "{{total}}", "{{fecha}}"].map((v) => (
                        <Badge key={v} variant="outline">{v}</Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800">
                      <button
                        onClick={() => handleRestoreTemplate(tipo)}
                        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restaurar predeterminado
                      </button>
                      <div className="flex items-center gap-3">
                        {isSaved && (
                          <span className="flex items-center gap-1 text-sm text-emerald-600">
                            <CheckCircle2 className="h-4 w-4" /> Guardado
                          </span>
                        )}
                        <button
                          onClick={() => handleSaveTemplate(tipo)}
                          disabled={isSaving}
                          className="flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                        >
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Guardar
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal: Invitar usuario ── */}
      {showInviteModal && canManageUsers && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowInviteModal(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold dark:text-white">Invitar usuario</h2>
              <button onClick={() => setShowInviteModal(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-500">Nombre completo *</label>
                <input value={inviteForm.nombre} onChange={(e) => setInviteForm({ ...inviteForm, nombre: e.target.value })}
                  placeholder="Ej: Juan Pérez"
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Email *</label>
                <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  onBlur={() => setInviteForm((current) => ({ ...current, email: normalizeEmail(current.email) }))}
                  placeholder="usuario@empresa.com"
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Rol</label>
                <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as Role })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([r, l]) => <option key={r} value={r}>{l}</option>)}
                </select>
              </div>
              {sociedades.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-zinc-500">Sociedades</label>
                  <div className="mt-1 space-y-1.5">
                    {sociedades.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <input type="checkbox" checked={inviteSociedadIds.includes(s.id)}
                          onChange={(e) => setInviteSociedadIds(e.target.checked ? [...inviteSociedadIds, s.id] : inviteSociedadIds.filter(id => id !== s.id))}
                          className="rounded border-zinc-300 text-orange-500 focus:ring-orange-500" />
                        {s.nombre}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">Si no seleccionás ninguna, tendrá acceso a todas.</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setShowInviteModal(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
              <button onClick={handleInviteUser} disabled={inviteSaving || !inviteForm.email.trim() || !inviteForm.nombre.trim()}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {inviteSaving && <Loader2 className="h-4 w-4 animate-spin" />} Invitar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
