"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { supabase } from "@/lib/supabase/client";
import {
  Calendar as CalendarIcon,
  Plus,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Eye,
  Users,
  FileText,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/utils";

// ── Tipo config ─────────────────────────────────────────────────
const tipoConfig: Record<string, { label: string; color: string; variant: "info" | "warning" | "success" | "danger" }> = {
  visita: { label: "Visita", color: "#3B82F6", variant: "info" },
  seguimiento: { label: "Seguimiento", color: "#F97316", variant: "warning" },
  entrega: { label: "Entrega", color: "#22C55E", variant: "success" },
  reunion: { label: "Reunion", color: "#8B5CF6", variant: "info" },
  otro: { label: "Otro", color: "#71717A", variant: "danger" },
};

const PRESET_COLORS = [
  { value: "#3B82F6", label: "Azul" },
  { value: "#F97316", label: "Naranja" },
  { value: "#22C55E", label: "Verde" },
  { value: "#8B5CF6", label: "Violeta" },
  { value: "#71717A", label: "Gris" },
];

// ── Types ───────────────────────────────────────────────────────
interface EventoRow {
  id: string;
  titulo: string;
  descripcion: string | null;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  todo_el_dia: boolean;
  cliente_id: string | null;
  presupuesto_id: string | null;
  user_id: string | null;
  sociedad_id: string | null;
  color: string;
  completado: boolean;
  created_at: string;
  clientes: { razon_social: string } | null;
  profiles: { full_name: string; email: string } | null;
}

// ── Helpers ─────────────────────────────────────────────────────
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  // 0=Sunday, adjust so Monday=0
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const DAY_NAMES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr);
}

// ── Page ────────────────────────────────────────────────────────
export default function CalendarioPage() {
  const { sociedadActiva, profile } = useUser();
  const [eventos, setEventos] = useState<EventoRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Calendar navigation
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  // Selected day
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Detail panel
  const [detailEvento, setDetailEvento] = useState<EventoRow | null>(null);

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    titulo: "",
    tipo: "visita",
    fecha_inicio: "",
    fecha_fin: "",
    todo_el_dia: false,
    cliente_id: "",
    descripcion: "",
    color: "#3B82F6",
  });

  // Filters
  const [filterTipo, setFilterTipo] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);

  // ── Fetch data ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      let q = (supabase as any)
        .from("eventos")
        .select(`*, clientes(razon_social), profiles(full_name, email)`)
        .order("fecha_inicio", { ascending: true });

      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);

      const { data, error } = await q;

      if (!error && data) {
        setEventos(data as unknown as EventoRow[]);
      } else {
        setEventos([]);
      }
    } catch {
      setEventos([]);
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch users for filter
  useEffect(() => {
    async function fetchUsers() {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name");
      if (data) setUsers(data as { id: string; full_name: string }[]);
    }
    fetchUsers();
  }, []);

  // ── Filtered events ──────────────────────────────────────────
  const filteredEventos = useMemo(() => {
    return eventos.filter((e) => {
      if (filterTipo && e.tipo !== filterTipo) return false;
      if (filterUserId && e.user_id !== filterUserId) return false;
      return true;
    });
  }, [eventos, filterTipo, filterUserId]);

  // ── Events grouped by date key ───────────────────────────────
  const eventsByDate = useMemo(() => {
    const map: Record<string, EventoRow[]> = {};
    for (const ev of filteredEventos) {
      const d = parseLocalDate(ev.fecha_inicio);
      const key = toDateKey(d);
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    return map;
  }, [filteredEventos]);

  // ── Stats ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);
    const thisMonth = filteredEventos.filter((e) => {
      const d = parseLocalDate(e.fecha_inicio);
      return d >= monthStart && d <= monthEnd;
    });
    const visitasPendientes = thisMonth.filter((e) => e.tipo === "visita" && !e.completado).length;
    const seguimientosPendientes = thisMonth.filter((e) => e.tipo === "seguimiento" && !e.completado).length;
    return {
      total: thisMonth.length,
      visitasPendientes,
      seguimientosPendientes,
    };
  }, [filteredEventos, currentYear, currentMonth]);

  // ── Calendar grid ────────────────────────────────────────────
  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    const days: { day: number; isCurrentMonth: boolean; dateKey: string }[] = [];

    // Previous month padding
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      days.push({
        day: d,
        isCurrentMonth: false,
        dateKey: `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({
        day: d,
        isCurrentMonth: true,
        dateKey: `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }

    // Next month padding to fill 6 rows
    const remaining = 42 - days.length;
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    for (let d = 1; d <= remaining; d++) {
      days.push({
        day: d,
        isCurrentMonth: false,
        dateKey: `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }

    return days;
  }, [currentYear, currentMonth]);

  // ── Navigation ───────────────────────────────────────────────
  function goToPrevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  }

  function goToNextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  }

  function goToToday() {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  }

  // ── Create modal ─────────────────────────────────────────────
  async function openCreateModal(presetDate?: string) {
    const defaultDate = presetDate || new Date().toISOString().slice(0, 16);
    setCreateForm({
      titulo: "",
      tipo: "visita",
      fecha_inicio: presetDate ? `${presetDate}T09:00` : defaultDate,
      fecha_fin: presetDate ? `${presetDate}T10:00` : "",
      todo_el_dia: false,
      cliente_id: "",
      descripcion: "",
      color: "#3B82F6",
    });
    let cq = supabase
      .from("clientes")
      .select("id, razon_social")
      .eq("activo", true)
      .order("razon_social");
    if (sociedadActiva?.id) cq = cq.eq("sociedad_id" as any, sociedadActiva.id);
    const { data } = await cq;
    if (data) setClientes(data as { id: string; razon_social: string }[]);
    setCreateModalOpen(true);
  }

  async function handleCreateEvento() {
    if (!createForm.titulo || !createForm.fecha_inicio) return;
    setCreating(true);
    try {
      const { error } = await (supabase as any).from("eventos").insert({
        titulo: createForm.titulo,
        tipo: createForm.tipo,
        fecha_inicio: new Date(createForm.fecha_inicio).toISOString(),
        fecha_fin: createForm.fecha_fin ? new Date(createForm.fecha_fin).toISOString() : null,
        todo_el_dia: createForm.todo_el_dia,
        cliente_id: createForm.cliente_id || null,
        descripcion: createForm.descripcion || null,
        color: createForm.color,
        user_id: profile?.id || null,
        sociedad_id: sociedadActiva?.id || null,
        completado: false,
      });
      if (error) { alert(error.message); return; }
      setCreateModalOpen(false);
      setSelectedDate(null);
      await fetchData();
    } catch (err) {
      console.error("Error creating evento:", err);
    } finally {
      setCreating(false);
    }
  }

  // ── Toggle completado ────────────────────────────────────────
  async function toggleCompletado(id: string, current: boolean) {
    try {
      const { error } = await (supabase as any).from("eventos").update({ completado: !current }).eq("id", id);
      if (error) { alert(error.message); return; }
      await fetchData();
      if (detailEvento?.id === id) {
        setDetailEvento((prev) => prev ? { ...prev, completado: !current } : null);
      }
    } catch (err) {
      console.error("Error updating evento:", err);
    }
  }

  // ── Delete evento ────────────────────────────────────────────
  async function handleDeleteEvento(id: string) {
    if (!confirm("Eliminar este evento?")) return;
    try {
      const { error } = await (supabase as any).from("eventos").delete().eq("id", id);
      if (error) { alert(error.message); return; }
      setDetailEvento(null);
      await fetchData();
    } catch (err) {
      console.error("Error deleting evento:", err);
    }
  }

  // ── Today key ────────────────────────────────────────────────
  const todayKey = toDateKey(today);

  // ── Events for selected date ─────────────────────────────────
  const selectedDateEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];

  // ── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Header title="Calendario" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Calendario"
        subtitle="Agenda de eventos y seguimientos"
        action={{ label: "Nuevo evento", onClick: () => openCreateModal() }}
      />
      <div className="p-4 sm:p-8 space-y-6">
        {/* ── Stats ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Eventos este mes"
            value={String(stats.total)}
            icon={CalendarIcon}
            iconColor="text-blue-600"
          />
          <StatCard
            title="Visitas pendientes"
            value={String(stats.visitasPendientes)}
            icon={MapPin}
            iconColor="text-orange-500"
          />
          <StatCard
            title="Seguimientos pendientes"
            value={String(stats.seguimientosPendientes)}
            icon={Clock}
            iconColor="text-violet-600"
          />
        </div>

        {/* ── Filters ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">Todos los tipos</option>
            {Object.entries(tipoConfig).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <select
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">Todos los usuarios</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.id}</option>
            ))}
          </select>
        </div>

        {/* ── Calendar ────────────────────────────────────────────── */}
        <Card className="p-0 overflow-hidden">
          {/* Month header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <button
                onClick={goToPrevMonth}
                className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <ChevronLeft className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
              </button>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white min-w-[180px] text-center">
                {MONTH_NAMES[currentMonth]} {currentYear}
              </h2>
              <button
                onClick={goToNextMonth}
                className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <ChevronRight className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
              </button>
            </div>
            <button
              onClick={goToToday}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
            >
              Hoy
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-zinc-200 dark:border-zinc-700">
            {DAY_NAMES.map((name) => (
              <div
                key={name}
                className="px-1 sm:px-2 py-2 text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase"
              >
                {name}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {calendarDays.map((cell, idx) => {
              const dayEvents = eventsByDate[cell.dateKey] || [];
              const isToday = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedDate;

              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDate(cell.dateKey === selectedDate ? null : cell.dateKey)}
                  className={`
                    relative min-h-[80px] sm:min-h-[100px] p-1 sm:p-2 border-b border-r border-zinc-100 dark:border-zinc-800 text-left transition-colors
                    ${!cell.isCurrentMonth ? "bg-zinc-50 dark:bg-zinc-950/50" : "bg-white dark:bg-zinc-900"}
                    ${isSelected ? "ring-2 ring-inset ring-orange-500" : ""}
                    hover:bg-zinc-50 dark:hover:bg-zinc-800/50
                  `}
                >
                  <span
                    className={`
                      inline-flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full text-xs sm:text-sm font-medium
                      ${isToday ? "bg-orange-500 text-white" : ""}
                      ${!cell.isCurrentMonth ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-700 dark:text-zinc-300"}
                    `}
                  >
                    {cell.day}
                  </span>

                  {/* Event dots/badges */}
                  <div className="mt-0.5 space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        className={`
                          flex items-center gap-1 rounded px-1 py-0.5 text-[10px] sm:text-xs leading-tight truncate cursor-pointer
                          ${ev.completado ? "opacity-50 line-through" : ""}
                        `}
                        style={{ backgroundColor: ev.color + "20", color: ev.color }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailEvento(ev);
                        }}
                        title={ev.titulo}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: ev.color }}
                        />
                        <span className="truncate">{ev.titulo}</span>
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px] text-zinc-400 pl-1">
                        +{dayEvents.length - 3} mas
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* ── Selected Date Events List ───────────────────────────── */}
        {selectedDate && (
          <Card className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
                {formatDate(selectedDate)} — {selectedDateEvents.length} evento{selectedDateEvents.length !== 1 ? "s" : ""}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openCreateModal(selectedDate)}
                  className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 transition-colors"
                >
                  <Plus className="h-4 w-4" /> Agregar
                </button>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {selectedDateEvents.length === 0 ? (
              <p className="text-sm text-zinc-400 py-4 text-center">No hay eventos para este dia.</p>
            ) : (
              <div className="space-y-2">
                {selectedDateEvents.map((ev) => {
                  const cfg = tipoConfig[ev.tipo] || tipoConfig.otro;
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setDetailEvento(ev)}
                      className={`
                        flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 cursor-pointer
                        hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors
                        ${ev.completado ? "opacity-60" : ""}
                      `}
                    >
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: ev.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium dark:text-white ${ev.completado ? "line-through" : ""}`}>
                          {ev.titulo}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant={cfg.variant}>{cfg.label}</Badge>
                          {!ev.todo_el_dia && (
                            <span className="text-xs text-zinc-400">
                              {new Date(ev.fecha_inicio).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                              {ev.fecha_fin && ` - ${new Date(ev.fecha_fin).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}
                            </span>
                          )}
                          {ev.todo_el_dia && (
                            <span className="text-xs text-zinc-400">Todo el dia</span>
                          )}
                        </div>
                      </div>
                      {ev.clientes?.razon_social && (
                        <span className="text-xs text-zinc-400 truncate max-w-[120px]">
                          {ev.clientes.razon_social}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCompletado(ev.id, ev.completado);
                        }}
                        className={`rounded p-1.5 transition-colors ${
                          ev.completado
                            ? "text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                            : "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                        title={ev.completado ? "Marcar pendiente" : "Marcar completado"}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ── Detail Side Panel ──────────────────────────────────────── */}
      {detailEvento && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailEvento(null)} />
          <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: detailEvento.color }}
                  />
                  <h2 className="text-lg font-semibold dark:text-white">{detailEvento.titulo}</h2>
                  {detailEvento.completado && (
                    <Badge variant="success">Completado</Badge>
                  )}
                </div>
                <p className="text-sm text-zinc-400 mt-0.5">
                  {(tipoConfig[detailEvento.tipo] || tipoConfig.otro).label}
                </p>
              </div>
              <button onClick={() => setDetailEvento(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => toggleCompletado(detailEvento.id, detailEvento.completado)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    detailEvento.completado
                      ? "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
                      : "bg-emerald-500 text-white hover:bg-emerald-600"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {detailEvento.completado ? "Reabrir" : "Completar"}
                </button>
                <button
                  onClick={() => handleDeleteEvento(detailEvento.id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-400">Fecha inicio</span>
                  <p className="font-medium dark:text-white">
                    {detailEvento.todo_el_dia
                      ? formatDate(detailEvento.fecha_inicio)
                      : formatDateTime(detailEvento.fecha_inicio)}
                  </p>
                </div>
                {detailEvento.fecha_fin && (
                  <div>
                    <span className="text-zinc-400">Fecha fin</span>
                    <p className="font-medium dark:text-white">
                      {detailEvento.todo_el_dia
                        ? formatDate(detailEvento.fecha_fin)
                        : formatDateTime(detailEvento.fecha_fin)}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-zinc-400">Tipo</span>
                  <div className="mt-1">
                    <Badge variant={(tipoConfig[detailEvento.tipo] || tipoConfig.otro).variant}>
                      {(tipoConfig[detailEvento.tipo] || tipoConfig.otro).label}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-zinc-400">Todo el dia</span>
                  <p className="font-medium dark:text-white">{detailEvento.todo_el_dia ? "Si" : "No"}</p>
                </div>
                {detailEvento.clientes?.razon_social && (
                  <div>
                    <span className="text-zinc-400">Cliente</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Users className="h-3.5 w-3.5 text-zinc-400" />
                      <p className="font-medium dark:text-white">{detailEvento.clientes.razon_social}</p>
                    </div>
                  </div>
                )}
                {detailEvento.profiles && (
                  <div>
                    <span className="text-zinc-400">Asignado a</span>
                    <p className="font-medium dark:text-white">
                      {detailEvento.profiles.full_name || detailEvento.profiles.email}
                    </p>
                  </div>
                )}
              </div>

              {/* Description */}
              {detailEvento.descripcion && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <span className="text-xs text-zinc-400 block mb-1">Descripcion</span>
                  <p className="text-sm dark:text-zinc-300">{detailEvento.descripcion}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Create Modal ────────────────────────────────────────────── */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold dark:text-white">Nuevo Evento</h2>
              <button onClick={() => setCreateModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Titulo *</label>
                <input
                  type="text"
                  value={createForm.titulo}
                  onChange={(e) => setCreateForm({ ...createForm, titulo: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  placeholder="Titulo del evento"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo</label>
                <select
                  value={createForm.tipo}
                  onChange={(e) => {
                    const tipo = e.target.value;
                    const color = tipoConfig[tipo]?.color || "#3B82F6";
                    setCreateForm({ ...createForm, tipo, color });
                  }}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  {Object.entries(tipoConfig).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha inicio *</label>
                  <input
                    type={createForm.todo_el_dia ? "date" : "datetime-local"}
                    value={createForm.todo_el_dia ? createForm.fecha_inicio.split("T")[0] : createForm.fecha_inicio}
                    onChange={(e) => setCreateForm({ ...createForm, fecha_inicio: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha fin</label>
                  <input
                    type={createForm.todo_el_dia ? "date" : "datetime-local"}
                    value={createForm.todo_el_dia ? createForm.fecha_fin.split("T")[0] : createForm.fecha_fin}
                    onChange={(e) => setCreateForm({ ...createForm, fecha_fin: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="todo_el_dia"
                  checked={createForm.todo_el_dia}
                  onChange={(e) => setCreateForm({ ...createForm, todo_el_dia: e.target.checked })}
                  className="rounded border-zinc-300 text-orange-500 focus:ring-orange-500"
                />
                <label htmlFor="todo_el_dia" className="text-sm text-zinc-700 dark:text-zinc-300">
                  Todo el dia
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cliente</label>
                <select
                  value={createForm.cliente_id}
                  onChange={(e) => setCreateForm({ ...createForm, cliente_id: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.razon_social}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Descripcion</label>
                <textarea
                  value={createForm.descripcion}
                  onChange={(e) => setCreateForm({ ...createForm, descripcion: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  rows={3}
                  placeholder="Detalles del evento..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Color</label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((pc) => (
                    <button
                      key={pc.value}
                      type="button"
                      onClick={() => setCreateForm({ ...createForm, color: pc.value })}
                      className={`h-8 w-8 rounded-full border-2 transition-transform ${
                        createForm.color === pc.value
                          ? "border-zinc-900 dark:border-white scale-110"
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: pc.value }}
                      title={pc.label}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setCreateModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateEvento}
                disabled={creating || !createForm.titulo || !createForm.fecha_inicio}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear Evento"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
