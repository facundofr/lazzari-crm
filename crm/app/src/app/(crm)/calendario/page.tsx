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
  Lock,
  Users,
  FileText,
  CheckCircle2,
  Trash2,
  Pencil,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  created_by: string | null;
  sociedad_id: string | null;
  color: string;
  completado: boolean;
  visibilidad: "publico" | "privado";
  created_at: string;
  clientes: { razon_social: string } | null;
  asignado: { full_name: string; email: string } | null;
  creador: { full_name: string; email: string } | null;
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

const AR_TZ = "America/Argentina/Buenos_Aires";

function toDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: AR_TZ });
}

function parseLocalDate(dateStr: string): Date {
  // Date-only strings ("2026-07-28") and UTC midnight are parsed as UTC midnight,
  // which in AR (UTC-3) shifts to the previous day. Fix by using local noon.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + "T12:00:00");
  }
  // Midnight UTC with timezone marker → same issue
  if (/T00:00:00(\.0+)?(Z|\+00:?00)/.test(dateStr)) {
    return new Date(dateStr.split("T")[0] + "T12:00:00");
  }
  return new Date(dateStr);
}

function toDateTimeInput(dateStr: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(dateStr));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

// ── Page ────────────────────────────────────────────────────────
export default function CalendarioPage() {
  const { sociedadActiva, profile } = useUser();
  const [eventos, setEventos] = useState<EventoRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Calendar navigation
  const today = new Date();
  const todayAR = new Date(today.toLocaleString("en-US", { timeZone: AR_TZ }));
  const [currentYear, setCurrentYear] = useState(todayAR.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(todayAR.getMonth());

  // Selected day
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Detail panel
  const [detailEvento, setDetailEvento] = useState<EventoRow | null>(null);

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingEventoId, setEditingEventoId] = useState<string | null>(null);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string }[]>([]);
  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteDropdownOpen, setClienteDropdownOpen] = useState(false);
  const clienteSearchRef = useRef<HTMLDivElement>(null);
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
    asignado_a: "", // user_id del responsable
    visibilidad: "privado" as "publico" | "privado",
  });

  // Filters
  const [filterTipo, setFilterTipo] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterVisibilidad, setFilterVisibilidad] = useState("");
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);

  // ── Fetch data ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      let q = (supabase as any)
        .from("eventos")
        .select(`*, clientes(razon_social), asignado:profiles!user_id(full_name, email), creador:profiles!created_by(full_name, email)`)
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

  // Close cliente dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (clienteSearchRef.current && !clienteSearchRef.current.contains(e.target as Node)) {
        setClienteDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredClientes = useMemo(() => {
    if (!clienteSearch) return clientes;
    return clientes.filter((c) => c.razon_social.toLowerCase().includes(clienteSearch.toLowerCase()));
  }, [clientes, clienteSearch]);

  // ── Filtered events ──────────────────────────────────────────
  const filteredEventos = useMemo(() => {
    return eventos.filter((e) => {
      if (filterTipo && e.tipo !== filterTipo) return false;
      if (filterUserId && e.user_id !== filterUserId) return false;
      if (filterVisibilidad && e.visibilidad !== filterVisibilidad) return false;
      return true;
    });
  }, [eventos, filterTipo, filterUserId, filterVisibilidad]);

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
    setCurrentYear(todayAR.getFullYear());
    setCurrentMonth(todayAR.getMonth());
  }

  // ── Create modal ─────────────────────────────────────────────
  async function openCreateModal(presetDate?: string) {
    const nowAR = new Date(new Date().toLocaleString("en-US", { timeZone: AR_TZ }));
    const defaultDate = presetDate || `${nowAR.getFullYear()}-${String(nowAR.getMonth() + 1).padStart(2, "0")}-${String(nowAR.getDate()).padStart(2, "0")}T${String(nowAR.getHours()).padStart(2, "0")}:${String(nowAR.getMinutes()).padStart(2, "0")}`;
    setClienteSearch("");
    setClienteDropdownOpen(false);
    setEditingEventoId(null);
    setCreateForm({
      titulo: "",
      tipo: "visita",
      fecha_inicio: presetDate ? `${presetDate}T09:00` : defaultDate,
      fecha_fin: presetDate ? `${presetDate}T10:00` : "",
      todo_el_dia: false,
      cliente_id: "",
      descripcion: "",
      color: "#3B82F6",
      asignado_a: profile?.id || "",
      visibilidad: "privado",
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

  async function openEditModal(evento: EventoRow) {
    setClienteSearch("");
    setClienteDropdownOpen(false);
    setEditingEventoId(evento.id);
    setCreateForm({
      titulo: evento.titulo,
      tipo: evento.tipo,
      fecha_inicio: evento.todo_el_dia ? toDateKey(parseLocalDate(evento.fecha_inicio)) : toDateTimeInput(evento.fecha_inicio),
      fecha_fin: evento.fecha_fin
        ? (evento.todo_el_dia ? toDateKey(parseLocalDate(evento.fecha_fin)) : toDateTimeInput(evento.fecha_fin))
        : "",
      todo_el_dia: evento.todo_el_dia,
      cliente_id: evento.cliente_id || "",
      descripcion: evento.descripcion || "",
      color: evento.color || tipoConfig[evento.tipo]?.color || "#3B82F6",
      asignado_a: evento.user_id || "",
      visibilidad: evento.visibilidad || "publico",
    });

    let cq = supabase
      .from("clientes")
      .select("id, razon_social")
      .eq("activo", true)
      .order("razon_social");
    if (sociedadActiva?.id) cq = cq.eq("sociedad_id" as any, sociedadActiva.id);
    const { data } = await cq;
    if (data) setClientes(data as { id: string; razon_social: string }[]);

    setDetailEvento(null);
    setCreateModalOpen(true);
  }

  async function handleCreateEvento() {
    if (!createForm.titulo || !createForm.fecha_inicio) return;
    setCreating(true);
    try {
      // For todo_el_dia events, store noon local to avoid UTC midnight → AR previous day issue
      const fechaInicioStr = createForm.todo_el_dia && !createForm.fecha_inicio.includes("T")
        ? createForm.fecha_inicio + "T12:00:00"
        : createForm.fecha_inicio;
      const fechaFinStr = createForm.fecha_fin
        ? (createForm.todo_el_dia && !createForm.fecha_fin.includes("T")
          ? createForm.fecha_fin + "T12:00:00"
          : createForm.fecha_fin)
        : null;

      const eventValues = {
        titulo: createForm.titulo,
        tipo: createForm.tipo,
        fecha_inicio: new Date(fechaInicioStr).toISOString(),
        fecha_fin: fechaFinStr ? new Date(fechaFinStr).toISOString() : null,
        todo_el_dia: createForm.todo_el_dia,
        cliente_id: createForm.cliente_id || null,
        descripcion: createForm.descripcion || null,
        color: createForm.color,
        user_id: createForm.asignado_a || profile?.id || null,
        visibilidad: createForm.visibilidad,
      };

      const { error } = editingEventoId
        ? await (supabase as any).from("eventos").update(eventValues).eq("id", editingEventoId)
        : await (supabase as any).from("eventos").insert({
          ...eventValues,
          created_by: profile?.id || null,
          sociedad_id: sociedadActiva?.id || null,
          completado: false,
        });
      if (error) { alert(error.message); return; }

      // Notify assigned user (if different from creator)
      const assignedTo = createForm.asignado_a || null;
      if (!editingEventoId && assignedTo && assignedTo !== profile?.id) {
        const fechaLabel = createForm.todo_el_dia
          ? createForm.fecha_inicio.split("T")[0]
          : new Date(createForm.fecha_inicio).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: AR_TZ });
        await (supabase as any).from("alertas").insert({
          tipo: "seguimiento",
          title: `Nuevo evento: ${createForm.titulo}`,
          description: `${profile?.full_name || "Alguien"} te asignó "${createForm.titulo}" para el ${fechaLabel}`,
          module: "calendario",
          user_id: assignedTo,
          sociedad_id: sociedadActiva?.id || null,
        });
      }

      setCreateModalOpen(false);
      setEditingEventoId(null);
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

  function canManageEvento(evento: EventoRow): boolean {
    return evento.created_by === profile?.id
      || evento.user_id === profile?.id
      || profile?.role === "admin"
      || profile?.role === "super_admin";
  }

  const editingEvento = editingEventoId ? eventos.find((evento) => evento.id === editingEventoId) : null;
  const canReassignEditingEvento = !editingEvento
    || editingEvento.created_by === profile?.id
    || profile?.role === "admin"
    || profile?.role === "super_admin";

  // ── Today key ────────────────────────────────────────────────
  const todayKey = toDateKey(today);

  // ── Upcoming + overdue events (next 14 days) ─────────────────
  const upcomingAndOverdue = useMemo(() => {
    const todayStart = new Date(todayKey + "T00:00:00");
    const in14Days = new Date(todayStart.getTime() + 14 * 86400000);
    return filteredEventos
      .filter((e) => !e.completado)
      .map((e) => {
        const d = parseLocalDate(e.fecha_inicio);
        const isOverdue = d < todayStart;
        const isUpcoming = d >= todayStart && d <= in14Days;
        return { ...e, isOverdue, isUpcoming, fechaDate: d };
      })
      .filter((e) => e.isOverdue || e.isUpcoming)
      .sort((a, b) => a.fechaDate.getTime() - b.fechaDate.getTime());
  }, [filteredEventos, todayKey]);

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
          <select
            value={filterVisibilidad}
            onChange={(e) => setFilterVisibilidad(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">Públicos y privados</option>
            <option value="publico">Públicos</option>
            <option value="privado">Privados</option>
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
                  onClick={() => { setSelectedDate(cell.dateKey); openCreateModal(cell.dateKey); }}
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
                        title={`${ev.titulo}${ev.creador?.full_name ? ` — ${ev.creador.full_name}` : ""}`}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: ev.color }}
                        />
                        <span className="truncate">{ev.titulo}</span>
                        {ev.visibilidad === "privado" && <Lock className="h-2.5 w-2.5 shrink-0" />}
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

        {/* ── Upcoming & Overdue ──────────────────────────────────── */}
        {upcomingAndOverdue.length > 0 && (
          <Card className="p-4 sm:p-6">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-orange-500" />
              Próximos 14 días y vencidos
              <span className="ml-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">{upcomingAndOverdue.length}</span>
            </h3>
            <div className="space-y-1.5">
              {upcomingAndOverdue.map((ev) => {
                const cfg = tipoConfig[ev.tipo] || tipoConfig.otro;
                const safeFecha = parseLocalDate(ev.fecha_inicio);
                const dateLabel = ev.isOverdue
                  ? `Vencido — ${formatDate(safeFecha)}`
                  : formatDate(safeFecha);
                return (
                  <div
                    key={ev.id}
                    onClick={() => setDetailEvento(ev)}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                      ev.isOverdue
                        ? "border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/10"
                        : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium dark:text-white truncate">{ev.titulo}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        <Badge variant="outline">{ev.visibilidad === "privado" ? "Privado" : "Público"}</Badge>
                        <span className={`text-xs ${ev.isOverdue ? "text-red-500 font-medium" : "text-zinc-400"}`}>{dateLabel}</span>
                        {ev.clientes?.razon_social && <span className="text-xs text-zinc-400 truncate">· {ev.clientes.razon_social}</span>}
                        {ev.creador?.full_name && <span className="text-xs text-zinc-400 truncate">· Creado por {ev.creador.full_name.split(" ")[0]}</span>}
                      </div>
                    </div>
                    {ev.asignado && (
                      <span className="text-xs text-zinc-400 shrink-0" title="Responsable">{ev.asignado.full_name?.split(" ")[0] || "—"}</span>
                    )}
                    {canManageEvento(ev) && <button
                      onClick={(e) => { e.stopPropagation(); toggleCompletado(ev.id, ev.completado); }}
                      className="rounded p-1.5 text-zinc-400 hover:bg-emerald-100 hover:text-emerald-600 dark:hover:bg-emerald-900/30 transition-colors"
                      title="Marcar completado"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* ── Selected Date Events List ───────────────────────────── */}
        {selectedDate && (
          <Card className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
                {formatDate(selectedDate + "T12:00:00")} — {selectedDateEvents.length} evento{selectedDateEvents.length !== 1 ? "s" : ""}
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
                          <Badge variant="outline">{ev.visibilidad === "privado" ? "Privado" : "Público"}</Badge>
                          {!ev.todo_el_dia && (
                            <span className="text-xs text-zinc-400">
                              {new Date(ev.fecha_inicio).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: AR_TZ })}
                              {ev.fecha_fin && ` - ${new Date(ev.fecha_fin).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: AR_TZ })}`}
                            </span>
                          )}
                          {ev.todo_el_dia && (
                            <span className="text-xs text-zinc-400">Todo el dia</span>
                          )}
                          {ev.creador?.full_name && (
                            <span className="text-xs text-zinc-400">· {ev.creador.full_name.split(" ")[0]}</span>
                          )}
                        </div>
                      </div>
                      {ev.clientes?.razon_social && (
                        <span className="text-xs text-zinc-400 truncate max-w-[120px]">
                          {ev.clientes.razon_social}
                        </span>
                      )}
                      {canManageEvento(ev) && <button
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
                      </button>}
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
                  <Badge variant="outline">
                    {detailEvento.visibilidad === "privado" ? "Privado" : "Público"}
                  </Badge>
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
              {canManageEvento(detailEvento) && <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => openEditModal(detailEvento)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50 transition-colors"
                >
                  <Pencil className="h-4 w-4" /> Editar
                </button>
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
              </div>}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-400">Fecha inicio</span>
                  <p className="font-medium dark:text-white">
                    {detailEvento.todo_el_dia
                      ? formatDate(parseLocalDate(detailEvento.fecha_inicio))
                      : formatDateTime(detailEvento.fecha_inicio)}
                  </p>
                </div>
                {detailEvento.fecha_fin && (
                  <div>
                    <span className="text-zinc-400">Fecha fin</span>
                    <p className="font-medium dark:text-white">
                      {detailEvento.todo_el_dia
                        ? formatDate(parseLocalDate(detailEvento.fecha_fin))
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
                <div>
                  <span className="text-zinc-400">Visibilidad</span>
                  <p className="font-medium dark:text-white flex items-center gap-1.5">
                    {detailEvento.visibilidad === "privado" ? <Lock className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {detailEvento.visibilidad === "privado" ? "Privado" : "Público"}
                  </p>
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
                {detailEvento.asignado && (
                  <div>
                    <span className="text-zinc-400">Asignado a</span>
                    <p className="font-medium dark:text-white">
                      {detailEvento.asignado.full_name || detailEvento.asignado.email}
                    </p>
                  </div>
                )}
                {detailEvento.creador && (
                  <div>
                    <span className="text-zinc-400">Creado por</span>
                    <p className="font-medium dark:text-white">
                      {detailEvento.creador.full_name || detailEvento.creador.email}
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
              <h2 className="text-lg font-semibold dark:text-white">{editingEventoId ? "Editar Evento" : "Nuevo Evento"}</h2>
              <button onClick={() => { setCreateModalOpen(false); setEditingEventoId(null); }} className="text-zinc-400 hover:text-zinc-600">
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
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Quién puede verlo</label>
                <select
                  value={createForm.visibilidad}
                  onChange={(e) => setCreateForm({ ...createForm, visibilidad: e.target.value as "publico" | "privado" })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="privado">Privado — solo vos y el responsable</option>
                  <option value="publico">Público — todos los usuarios</option>
                </select>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cliente</label>
                  <div className="relative" ref={clienteSearchRef}>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Buscar cliente..."
                        value={clienteSearch || (createForm.cliente_id ? clientes.find(c => c.id === createForm.cliente_id)?.razon_social || "" : "")}
                        onChange={(e) => { setClienteSearch(e.target.value); setClienteDropdownOpen(true); if (!e.target.value) setCreateForm({ ...createForm, cliente_id: "" }); }}
                        onFocus={() => { if (clienteSearch || !createForm.cliente_id) setClienteDropdownOpen(true); }}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                      />
                      {createForm.cliente_id && (
                        <button onClick={() => { setCreateForm({ ...createForm, cliente_id: "" }); setClienteSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {clienteDropdownOpen && (clienteSearch || !createForm.cliente_id) && filteredClientes.length > 0 && (
                      <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                        {filteredClientes.slice(0, 50).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setCreateForm({ ...createForm, cliente_id: c.id }); setClienteSearch(""); setClienteDropdownOpen(false); }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:text-white"
                          >
                            {c.razon_social}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Responsable</label>
                  <select
                    value={createForm.asignado_a}
                    onChange={(e) => setCreateForm({ ...createForm, asignado_a: e.target.value })}
                    disabled={!canReassignEditingEvento}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:disabled:bg-zinc-800"
                  >
                    <option value="">Sin asignar</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name || u.id}</option>
                    ))}
                  </select>
                </div>
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
                onClick={() => { setCreateModalOpen(false); setEditingEventoId(null); }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateEvento}
                disabled={creating || !createForm.titulo || !createForm.fecha_inicio}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {creating ? "Guardando..." : editingEventoId ? "Guardar cambios" : "Crear Evento"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
