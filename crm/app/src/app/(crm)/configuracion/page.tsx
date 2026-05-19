"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { mockUsers } from "@/lib/mock-data";
import { ROLE_LABELS, ROLE_PERMISSIONS } from "@/lib/types";
import type { User, Role } from "@/lib/types";
import { Users, Shield, Building2, Plug, Bell, Palette, Database, Key } from "lucide-react";
import { useState } from "react";

const roleBadgeVariant: Record<Role, "success" | "warning" | "danger" | "info" | "purple" | "outline"> = {
  super_admin: "danger",
  admin: "info",
  vendedor: "success",
  administrativo: "warning",
  viewer: "outline",
};

export default function ConfiguracionPage() {
  const [tab, setTab] = useState<"usuarios" | "roles" | "empresa" | "integraciones" | "notificaciones">("usuarios");

  const tabs = [
    { id: "usuarios" as const, label: "Usuarios", icon: Users },
    { id: "roles" as const, label: "Roles y permisos", icon: Shield },
    { id: "empresa" as const, label: "Empresa", icon: Building2 },
    { id: "integraciones" as const, label: "Integraciones", icon: Plug },
    { id: "notificaciones" as const, label: "Notificaciones", icon: Bell },
  ];

  return (
    <>
      <Header title="Configuración" subtitle="Administración del sistema" />
      <div className="p-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
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
                <p className="text-sm text-zinc-500">{mockUsers.length} usuarios registrados</p>
              </div>
              <button className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600">
                Invitar usuario
              </button>
            </div>

            <Card className="p-0 overflow-hidden">
              <DataTable<User>
                columns={[
                  {
                    key: "name", label: "Usuario",
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
                  {
                    key: "role", label: "Rol",
                    render: (row) => <Badge variant={roleBadgeVariant[row.role]}>{ROLE_LABELS[row.role]}</Badge>,
                  },
                  {
                    key: "active", label: "Estado",
                    render: (row) => <Badge variant={row.active ? "success" : "outline"}>{row.active ? "Activo" : "Inactivo"}</Badge>,
                  },
                  { key: "createdAt", label: "Registrado", render: (row) => <span className="text-zinc-400 text-xs">{row.createdAt}</span> },
                ]}
                data={mockUsers}
              />
            </Card>
          </div>
        )}

        {tab === "roles" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Roles y niveles de acceso</CardTitle>
              </CardHeader>
              <p className="text-sm text-zinc-500 mb-6">
                Cada usuario tiene un rol asignado que determina qué módulos puede ver y qué acciones puede realizar.
              </p>
              <div className="space-y-4">
                {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([role, label]) => {
                  const permissions = ROLE_PERMISSIONS[role];
                  const isWildcard = permissions.some((p) => p.module === "*");
                  return (
                    <div key={role} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <Badge variant={roleBadgeVariant[role]}>{label}</Badge>
                          <span className="text-xs text-zinc-400">
                            {mockUsers.filter((u) => u.role === role).length} usuario(s)
                          </span>
                        </div>
                        <button className="text-xs text-orange-500 hover:text-orange-600 font-medium">Editar permisos</button>
                      </div>
                      {isWildcard ? (
                        <p className="text-sm text-zinc-500">Acceso completo a todos los módulos y acciones.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {permissions.map((p) => (
                            <div key={p.module} className="rounded-md bg-zinc-50 px-2.5 py-1.5 text-xs dark:bg-zinc-800">
                              <span className="font-medium text-zinc-700 dark:text-zinc-300">{p.module}</span>
                              <span className="text-zinc-400 ml-1">
                                ({p.actions.join(", ")})
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Permissions matrix */}
            <Card>
              <CardHeader>
                <CardTitle>Matriz de permisos</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500">Módulo</th>
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
            <CardHeader>
              <CardTitle>Datos de la empresa</CardTitle>
            </CardHeader>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {[
                { label: "Razón social", value: "Lazzari Soluciones Industriales" },
                { label: "CUIT", value: "30-71XXXXXX-X" },
                { label: "Condición IVA", value: "Responsable Inscripto" },
                { label: "Dirección fiscal", value: "Buenos Aires, Argentina" },
                { label: "Punto de venta AFIP", value: "0001" },
                { label: "Inicio de actividades", value: "01/01/2019" },
              ].map((field) => (
                <div key={field.label}>
                  <label className="text-xs font-medium text-zinc-500">{field.label}</label>
                  <input
                    type="text"
                    defaultValue={field.value}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button className="rounded-lg bg-orange-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-orange-600">
                Guardar cambios
              </button>
            </div>
          </Card>
        )}

        {tab === "integraciones" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { name: "AFIP — Factura electrónica", desc: "WSFE para emisión de comprobantes y obtención de CAE", icon: Key, connected: true },
              { name: "AFIP — Remitos electrónicos", desc: "COT para remitos con código de autorización", icon: Key, connected: true },
              { name: "Banco — Cuenta corriente", desc: "Sincronización de movimientos bancarios", icon: Database, connected: false },
              { name: "Banco — E-cheques", desc: "Gestión de echeqs emitidos y recibidos", icon: Database, connected: false },
              { name: "Email — Envío de PR", desc: "SMTP para envío de presupuestos al cliente", icon: Plug, connected: true },
              { name: "IA — Asistente", desc: "Modelo de IA para asistencia en remitos y documentos", icon: Palette, connected: true },
            ].map((integration) => (
              <Card key={integration.name} className="flex items-start gap-4">
                <div className={`rounded-lg p-2.5 ${integration.connected ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-400"}`}>
                  <integration.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-zinc-900 dark:text-white">{integration.name}</h4>
                    <Badge variant={integration.connected ? "success" : "outline"}>
                      {integration.connected ? "Conectado" : "Desconectado"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">{integration.desc}</p>
                  <button className="mt-3 text-xs font-medium text-orange-500 hover:text-orange-600">
                    {integration.connected ? "Configurar" : "Conectar"}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "notificaciones" && (
          <Card>
            <CardHeader>
              <CardTitle>Preferencias de notificaciones</CardTitle>
            </CardHeader>
            <div className="space-y-4">
              {[
                { label: "PR próximo a vencer", desc: "Alerta cuando un presupuesto está cerca de su fecha de vencimiento", enabled: true },
                { label: "Stock bajo", desc: "Alerta cuando un artículo baja del stock mínimo", enabled: true },
                { label: "Cuenta corriente vencida", desc: "Alerta cuando un cliente supera los días de CC", enabled: true },
                { label: "E-cheque próximo a vencer", desc: "Recordatorio de cheques por depositar o con vencimiento cercano", enabled: true },
                { label: "Seguimiento comercial", desc: "Sugerencias de re-cotización tras rechazos", enabled: false },
                { label: "Resumen diario por email", desc: "Resumen de actividad del día enviado por email", enabled: false },
              ].map((pref) => (
                <div key={pref.label} className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                  <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{pref.label}</p>
                    <p className="text-xs text-zinc-500">{pref.desc}</p>
                  </div>
                  <button
                    className={`relative h-6 w-11 rounded-full transition-colors ${pref.enabled ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${pref.enabled ? "left-[22px]" : "left-0.5"}`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
