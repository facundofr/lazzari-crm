"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import {
  ClipboardList, Plus, Loader2, Phone, Mail, MessageCircle,
  MapPin, Users, Trash2, Eye, Search, Calendar,
} from "lucide-react";

interface FichaRow {
  id: string;
  cliente_id: string | null;
  vendedor_id: string | null;
  fecha: string;
  tipo: "visita" | "llamada" | "email" | "whatsapp" | "reunion";
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  motivo: string | null;
  descripcion: string;
  productos_interes: string | null;
  competencia: string | null;
  proxima_accion: string | null;
  fecha_proxima_accion: string | null;
  resultado: "positivo" | "neutro" | "negativo" | null;
  presupuesto_id: string | null;
  created_at: string;
  cliente_nombre?: string;
  vendedor_nombre?: string;
}

interface ClienteOption { id: string; razon_social: string }

const tipoConfig: Record<string, { label: string; icon: typeof MapPin; variant: "info" | "success" | "warning" | "outline" | "purple" }> = {
  visita: { label: "Visita", icon: MapPin, variant: "info" },
  llamada: { label: "Llamada", icon: Phone, variant: "success" },
  email: { label: "Email", icon: Mail, variant: "warning" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, variant: "purple" },
  reunion: { label: "Reunión", icon: Users, variant: "outline" },
};

const resultadoConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  positivo: { label: "Positivo", variant: "success" },
  neutro: { label: "Neutro", variant: "warning" },
  negativo: { label: "Negativo", variant: "danger" },
};

const emptyForm = {
  cliente_id: "",
  fecha: new Date().toISOString().split("T")[0],
  tipo: "visita" as const,
  contacto_nombre: "",
  contacto_cargo: "",
  motivo: "",
  descripcion: "",
  productos_interes: "",
  competencia: "",
  proxima_accion: "",
  fecha_proxima_accion: "",
  resultado: "" as string,
};

export function FichasRelevamiento() {
  const { profile, sociedadActiva } = useUser();
  const [fichas, setFichas] = useState<FichaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [selectedFicha, setSelectedFicha] = useState<FichaRow | null>(null);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");

  const fetchFichas = useCallback(async () => {
    setLoading(true);
    try {
      let q = (supabase as any)
        .from("fichas_relevamiento")
        .select("*, clientes:cliente_id(razon_social), profiles:vendedor_id(full_name)")
        .order("fecha", { ascending: false })
        .limit(100);
      if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
      const { data } = await q;
      if (data) {
        setFichas(data.map((f: any) => ({
          ...f,
          cliente_nombre: f.clientes?.razon_social || "",
          vendedor_nombre: f.profiles?.full_name || "",
        })));
      }
    } catch (err) {
      console.error("Error fetching fichas:", err);
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => { fetchFichas(); }, [fetchFichas]);

  useEffect(() => {
    async function fetchClientes() {
      let q = supabase.from("clientes").select("id, razon_social").eq("activo", true).order("razon_social");
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data } = await q;
      if (data) setClientes(data as ClienteOption[]);
    }
    fetchClientes();
  }, [sociedadActiva]);

  async function handleSave() {
    if (!form.descripcion.trim()) return;
    setSaving(true);
    try {
      const row: Record<string, any> = {
        descripcion: form.descripcion.trim(),
        fecha: form.fecha,
        tipo: form.tipo,
        vendedor_id: profile?.id || null,
      };
      if (form.cliente_id) row.cliente_id = form.cliente_id;
      if (form.contacto_nombre) row.contacto_nombre = form.contacto_nombre;
      if (form.contacto_cargo) row.contacto_cargo = form.contacto_cargo;
      if (form.motivo) row.motivo = form.motivo;
      if (form.productos_interes) row.productos_interes = form.productos_interes;
      if (form.competencia) row.competencia = form.competencia;
      if (form.proxima_accion) row.proxima_accion = form.proxima_accion;
      if (form.fecha_proxima_accion) row.fecha_proxima_accion = form.fecha_proxima_accion;
      if (form.resultado) row.resultado = form.resultado;
      if (sociedadActiva?.id) row.sociedad_id = sociedadActiva.id;

      await (supabase as any).from("fichas_relevamiento").insert(row);
      setModalOpen(false);
      setForm({ ...emptyForm, fecha: new Date().toISOString().split("T")[0] });
      await fetchFichas();
    } catch (err) {
      console.error("Error saving ficha:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar esta ficha?")) return;
    await (supabase as any).from("fichas_relevamiento").delete().eq("id", id);
    setSelectedFicha(null);
    await fetchFichas();
  }

  const filtered = fichas.filter((f) => {
    if (search) {
      const s = search.toLowerCase();
      if (!f.cliente_nombre?.toLowerCase().includes(s) && !f.descripcion.toLowerCase().includes(s) && !f.contacto_nombre?.toLowerCase().includes(s)) return false;
    }
    if (filterTipo && f.tipo !== filterTipo) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-semibold dark:text-white">Fichas de relevamiento</h2>
          <Badge variant="outline">{fichas.length}</Badge>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
        >
          <Plus className="h-4 w-4" /> Nueva ficha
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Buscar por cliente, descripcion..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-100"
          />
        </div>
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(tipoConfig).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-zinc-400">
          No hay fichas de relevamiento
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => {
            const tipoCfg = tipoConfig[f.tipo] || { label: f.tipo, variant: "outline" as const, icon: ClipboardList };
            const resCfg = f.resultado ? resultadoConfig[f.resultado] : null;
            return (
              <button
                key={f.id}
                onClick={() => setSelectedFicha(f)}
                className="w-full text-left rounded-xl border border-zinc-200 bg-white p-4 hover:border-orange-300 hover:shadow-sm transition-all dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={tipoCfg.variant}>{tipoCfg.label}</Badge>
                      {resCfg && <Badge variant={resCfg.variant}>{resCfg.label}</Badge>}
                      <span className="text-xs text-zinc-400">{formatDate(f.fecha)}</span>
                    </div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                      {f.cliente_nombre || "Sin cliente"}{f.contacto_nombre ? ` — ${f.contacto_nombre}` : ""}
                    </p>
                    <p className="text-sm text-zinc-500 truncate mt-0.5">{f.descripcion}</p>
                  </div>
                  {f.vendedor_nombre && (
                    <span className="text-xs text-zinc-400 whitespace-nowrap">{f.vendedor_nombre}</span>
                  )}
                </div>
                {f.proxima_accion && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400">
                    <Calendar className="h-3 w-3" />
                    Prox: {f.proxima_accion}
                    {f.fecha_proxima_accion && ` (${formatDate(f.fecha_proxima_accion)})`}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      <Modal
        open={!!selectedFicha}
        onClose={() => setSelectedFicha(null)}
        title="Ficha de relevamiento"
        size="md"
        footer={
          <div className="flex justify-between w-full">
            <button
              onClick={() => selectedFicha && handleDelete(selectedFicha.id)}
              className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" /> Eliminar
            </button>
            <button
              onClick={() => setSelectedFicha(null)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cerrar
            </button>
          </div>
        }
      >
        {selectedFicha && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={tipoConfig[selectedFicha.tipo]?.variant || "outline"}>
                {tipoConfig[selectedFicha.tipo]?.label || selectedFicha.tipo}
              </Badge>
              {selectedFicha.resultado && (
                <Badge variant={resultadoConfig[selectedFicha.resultado]?.variant || "outline"}>
                  {resultadoConfig[selectedFicha.resultado]?.label || selectedFicha.resultado}
                </Badge>
              )}
              <span className="text-sm text-zinc-400">{formatDate(selectedFicha.fecha)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-zinc-500">Cliente:</span> <span className="font-medium dark:text-white">{selectedFicha.cliente_nombre || "—"}</span></div>
              <div><span className="text-zinc-500">Vendedor:</span> <span className="font-medium dark:text-white">{selectedFicha.vendedor_nombre || "—"}</span></div>
              {selectedFicha.contacto_nombre && <div><span className="text-zinc-500">Contacto:</span> <span className="font-medium dark:text-white">{selectedFicha.contacto_nombre}</span></div>}
              {selectedFicha.contacto_cargo && <div><span className="text-zinc-500">Cargo:</span> <span className="font-medium dark:text-white">{selectedFicha.contacto_cargo}</span></div>}
            </div>

            {selectedFicha.motivo && (
              <div><span className="text-sm text-zinc-500">Motivo:</span><p className="text-sm mt-1 dark:text-zinc-300">{selectedFicha.motivo}</p></div>
            )}

            <div>
              <span className="text-sm text-zinc-500">Descripcion:</span>
              <p className="text-sm mt-1 whitespace-pre-wrap dark:text-zinc-300">{selectedFicha.descripcion}</p>
            </div>

            {selectedFicha.productos_interes && (
              <div><span className="text-sm text-zinc-500">Productos de interes:</span><p className="text-sm mt-1 dark:text-zinc-300">{selectedFicha.productos_interes}</p></div>
            )}

            {selectedFicha.competencia && (
              <div><span className="text-sm text-zinc-500">Competencia:</span><p className="text-sm mt-1 dark:text-zinc-300">{selectedFicha.competencia}</p></div>
            )}

            {selectedFicha.proxima_accion && (
              <div className="rounded-lg bg-orange-50 dark:bg-orange-950/20 p-3">
                <span className="text-sm font-medium text-orange-700 dark:text-orange-400">Proxima accion:</span>
                <p className="text-sm mt-1 text-orange-800 dark:text-orange-300">{selectedFicha.proxima_accion}</p>
                {selectedFicha.fecha_proxima_accion && (
                  <p className="text-xs mt-1 text-orange-600 dark:text-orange-400">Fecha: {formatDate(selectedFicha.fecha_proxima_accion)}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* New ficha modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nueva ficha de relevamiento"
        description="Registra una visita, llamada o contacto comercial"
        size="lg"
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!form.descripcion.trim() || saving}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar ficha"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Cliente"
              value={form.cliente_id}
              onChange={(e) => setForm((p) => ({ ...p, cliente_id: e.target.value }))}
              placeholder="Seleccionar cliente..."
              options={clientes.map((c) => ({ value: c.id, label: c.razon_social }))}
            />
            <Select
              label="Tipo de contacto"
              value={form.tipo}
              onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value as any }))}
              options={Object.entries(tipoConfig).map(([k, v]) => ({ value: k, label: v.label }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Fecha"
              type="date"
              value={form.fecha}
              onChange={(e) => setForm((p) => ({ ...p, fecha: e.target.value }))}
            />
            <Select
              label="Resultado"
              value={form.resultado}
              onChange={(e) => setForm((p) => ({ ...p, resultado: e.target.value }))}
              placeholder="Sin definir"
              options={[
                { value: "positivo", label: "Positivo" },
                { value: "neutro", label: "Neutro" },
                { value: "negativo", label: "Negativo" },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Contacto (nombre)"
              value={form.contacto_nombre}
              onChange={(e) => setForm((p) => ({ ...p, contacto_nombre: e.target.value }))}
              placeholder="Nombre del contacto..."
            />
            <Input
              label="Cargo"
              value={form.contacto_cargo}
              onChange={(e) => setForm((p) => ({ ...p, contacto_cargo: e.target.value }))}
              placeholder="Gerente, compras, etc..."
            />
          </div>

          <Input
            label="Motivo"
            value={form.motivo}
            onChange={(e) => setForm((p) => ({ ...p, motivo: e.target.value }))}
            placeholder="Motivo de la visita/contacto..."
          />

          <Textarea
            label="Descripcion *"
            value={form.descripcion}
            onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))}
            placeholder="Detalle de lo conversado, acuerdos, observaciones..."
            rows={4}
          />

          <Input
            label="Productos de interes"
            value={form.productos_interes}
            onChange={(e) => setForm((p) => ({ ...p, productos_interes: e.target.value }))}
            placeholder="Valvulas, bombas, instrumentacion..."
          />

          <Input
            label="Competencia detectada"
            value={form.competencia}
            onChange={(e) => setForm((p) => ({ ...p, competencia: e.target.value }))}
            placeholder="Otros proveedores mencionados..."
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Proxima accion"
              value={form.proxima_accion}
              onChange={(e) => setForm((p) => ({ ...p, proxima_accion: e.target.value }))}
              placeholder="Enviar cotizacion, visitar planta..."
            />
            <Input
              label="Fecha proxima accion"
              type="date"
              value={form.fecha_proxima_accion}
              onChange={(e) => setForm((p) => ({ ...p, fecha_proxima_accion: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
