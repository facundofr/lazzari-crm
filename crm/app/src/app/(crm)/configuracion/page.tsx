"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { mockUsers } from "@/lib/mock-data";
import { ROLE_LABELS, ROLE_PERMISSIONS } from "@/lib/types";
import type { User, Role } from "@/lib/types";
import { Users, Shield, Building2, Plug, Bell, Palette, Database, Key, Loader2, CheckCircle2, Mail, Save, RotateCcw } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";

type TemplateTipo = "presupuesto" | "factura" | "remito";

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
};

const roleBadgeVariant: Record<Role, "success" | "warning" | "danger" | "info" | "purple" | "outline"> = {
  super_admin: "danger",
  admin: "info",
  vendedor: "success",
  administrativo: "warning",
  viewer: "outline",
};

export default function ConfiguracionPage() {
  const { sociedadActiva } = useUser();
  const [tab, setTab] = useState<"usuarios" | "roles" | "empresa" | "integraciones" | "notificaciones" | "plantillas">("usuarios");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dbUsers, setDbUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  // Email templates state
  const [templates, setTemplates] = useState<Record<TemplateTipo, EmailTemplate>>({ ...DEFAULT_TEMPLATES });
  const [templateSaving, setTemplateSaving] = useState<TemplateTipo | null>(null);
  const [templateSaved, setTemplateSaved] = useState<TemplateTipo | null>(null);

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
    async function fetchData() {
      // Fetch real users from profiles
      try {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email, role, active, created_at")
          .order("created_at", { ascending: false });
        if (profiles && profiles.length > 0) {
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

      // Fetch empresa config (key/value jsonb table)
      try {
        const { data: config } = await supabase
          .from("configuracion")
          .select("key, value")
          .in("key", ["empresa"]);
        if (config && config.length > 0) {
          const empresaConfig = config.find((c: any) => c.key === "empresa");
          if (empresaConfig) {
            const val = (empresaConfig as any).value || {};
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
    fetchData();
  }, []);

  // Fetch email templates when sociedadActiva changes
  useEffect(() => {
    async function fetchTemplates() {
      if (!sociedadActiva) return;
      try {
        const { data } = await (supabase as any)
          .from("email_templates")
          .select("tipo, asunto, cuerpo")
          .eq("sociedad_id", sociedadActiva.id);
        if (data && data.length > 0) {
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
      await (supabase as any).from("email_templates").upsert(
        {
          sociedad_id: sociedadActiva.id,
          tipo,
          asunto: templates[tipo].asunto,
          cuerpo: templates[tipo].cuerpo,
        },
        { onConflict: "sociedad_id,tipo" }
      );
      setTemplateSaved(tipo);
      setTimeout(() => setTemplateSaved(null), 3000);
    } catch (err) {
      console.error("Error saving email template:", err);
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

  // Notification toggles
  const [notifs, setNotifs] = useState({
    pr_vencer: true,
    stock_bajo: true,
    cc_vencida: true,
    cheque_vencer: true,
    seguimiento: false,
    resumen_diario: false,
  });

  function handleEmpresaChange(key: string, value: string) {
    setEmpresa((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSaveEmpresa() {
    setSaving(true);
    try {
      await supabase.from("configuracion").upsert(
        { key: "empresa", value: empresa } as any,
        { onConflict: "key" }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Error saving empresa config:", err);
    } finally {
      setSaving(false);
    }
  }

  function toggleNotif(key: keyof typeof notifs) {
    setNotifs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const tabs = [
    { id: "usuarios" as const, label: "Usuarios", icon: Users },
    { id: "roles" as const, label: "Roles y permisos", icon: Shield },
    { id: "empresa" as const, label: "Empresa", icon: Building2 },
    { id: "integraciones" as const, label: "Integraciones", icon: Plug },
    { id: "notificaciones" as const, label: "Notificaciones", icon: Bell },
    { id: "plantillas" as const, label: "Plantillas de Email", icon: Mail },
  ];

  return (
    <>
      <Header title="Configuracion" subtitle="Administracion del sistema" />
      <div className="p-4 sm:p-8 space-y-6">
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                tab === t.id ? "border-orange-500 text-orange-600" : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}>
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "usuarios" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-white">Usuarios del sistema</h3>
                <p className="text-sm text-zinc-500">{dbUsers.length} usuarios registrados</p>
              </div>
              <button disabled className="rounded-lg bg-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 cursor-not-allowed dark:bg-zinc-700 dark:text-zinc-400" title="Próximamente">
                Invitar usuario
              </button>
            </div>
            <Card className="p-0 overflow-hidden">
              <DataTable<User>
                columns={[
                  {
                    key: "name", label: "Usuario", sortable: true,
                    render: (row) => (
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                          {row.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-medium text-zinc-900 dark:text-white">{row.name}</p>
                          <p className="text-xs text-zinc-400">{row.email}</p>
                        </div>
                      </div>
                    ),
                  },
                  { key: "role", label: "Rol", sortable: true, render: (row) => <Badge variant={roleBadgeVariant[row.role]}>{ROLE_LABELS[row.role]}</Badge> },
                  { key: "active", label: "Estado", sortable: true, render: (row) => <Badge variant={row.active ? "success" : "outline"}>{row.active ? "Activo" : "Inactivo"}</Badge> },
                  { key: "createdAt", label: "Registrado", sortable: true, render: (row) => <span className="text-zinc-400 text-xs">{row.createdAt}</span> },
                ]}
                data={dbUsers}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { name: "AFIP — Factura electronica", desc: "WSFE para emision de comprobantes y obtencion de CAE", icon: Key, connected: false, note: "Requiere certificado digital" },
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
        )}

        {tab === "notificaciones" && (
          <Card>
            <CardHeader><CardTitle>Preferencias de notificaciones</CardTitle></CardHeader>
            <div className="space-y-4">
              {([
                { key: "pr_vencer" as const, label: "PR proximo a vencer", desc: "Alerta cuando un presupuesto esta cerca de su fecha de vencimiento" },
                { key: "stock_bajo" as const, label: "Stock bajo", desc: "Alerta cuando un articulo baja del stock minimo" },
                { key: "cc_vencida" as const, label: "Cuenta corriente vencida", desc: "Alerta cuando un cliente supera los dias de CC" },
                { key: "cheque_vencer" as const, label: "E-cheque proximo a vencer", desc: "Recordatorio de cheques por depositar o con vencimiento cercano" },
                { key: "seguimiento" as const, label: "Seguimiento comercial", desc: "Sugerencias de re-cotizacion tras rechazos" },
                { key: "resumen_diario" as const, label: "Resumen diario por email", desc: "Resumen de actividad del dia enviado por email" },
              ]).map((pref) => (
                <div key={pref.key} className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                  <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{pref.label}</p>
                    <p className="text-xs text-zinc-500">{pref.desc}</p>
                  </div>
                  <button
                    onClick={() => toggleNotif(pref.key)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${notifs[pref.key] ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${notifs[pref.key] ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
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

            {(["presupuesto", "factura", "remito"] as TemplateTipo[]).map((tipo) => {
              const template = templates[tipo];
              const label = tipo === "presupuesto" ? "Presupuesto" : tipo === "factura" ? "Factura" : "Remito";
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
    </>
  );
}
