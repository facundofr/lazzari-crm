"use client";

import {
  Bell,
  Search,
  Plus,
  X,
  Package,
  Clock,
  DollarSign,
  FileText,
  AlertTriangle,
  Users,
  Receipt,
  Loader2,
  Menu,
  Building2,
  ChevronDown,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { mockAlerts } from "@/lib/mock-data";
import { useUser } from "@/lib/auth-context";

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface AlertRow {
  id: string;
  tipo: string;
  title: string;
  description: string;
  module: string;
  read: boolean;
  created_at: string;
  entity_id: string | null;
}

interface SearchResultCliente {
  id: string;
  razon_social: string;
  cuit: string;
}

interface SearchResultPresupuesto {
  id: string;
  numero: string | null;
  clientes: { razon_social: string } | null;
}

interface SearchResultFactura {
  id: string;
  numero: number;
  tipo: string;
  clientes: { razon_social: string } | null;
}

interface SearchResultProducto {
  id: string;
  codigo: string;
  nombre: string;
}

interface SearchResults {
  clientes: SearchResultCliente[];
  presupuestos: SearchResultPresupuesto[];
  facturas: SearchResultFactura[];
  productos: SearchResultProducto[];
}

const alertIcons: Record<string, typeof AlertTriangle> = {
  stock_bajo: Package,
  vencimiento_pr: Clock,
  cheque_proximo: DollarSign,
  seguimiento: FileText,
  cc_vencida: AlertTriangle,
};

const alertVariant: Record<string, "danger" | "warning" | "info" | "purple"> = {
  stock_bajo: "danger",
  vencimiento_pr: "warning",
  cheque_proximo: "info",
  seguimiento: "purple",
  cc_vencida: "danger",
};

export function Header({ title, subtitle, action }: HeaderProps) {
  const router = useRouter();
  const { setMobileSidebarOpen, sociedades, sociedadActiva, setSociedadActiva } = useUser();
  const [sociedadOpen, setSociedadOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Cmd+K shortcut ──────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        searchInputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Click outside to close search dropdown ──────────────────────
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Debounced search ────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (search.length < 2) {
      setSearchResults(null);
      setSearchOpen(false);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    setSearchOpen(true);

    debounceRef.current = setTimeout(() => {
      performSearch(search);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function performSearch(query: string) {
    const pattern = `%${query}%`;

    try {
      const [clientesRes, presupuestosRes, facturasRes, productosRes] =
        await Promise.all([
          supabase
            .from("clientes")
            .select("id, razon_social, cuit")
            .ilike("razon_social", pattern)
            .limit(3),
          supabase
            .from("presupuestos")
            .select("id, numero, clientes(razon_social)")
            .ilike("numero", pattern)
            .limit(3),
          supabase
            .from("facturas")
            .select("id, numero, tipo, clientes(razon_social)")
            .ilike("numero::text", pattern)
            .limit(3),
          supabase
            .from("productos")
            .select("id, codigo, nombre")
            .or(`codigo.ilike.${pattern},nombre.ilike.${pattern}`)
            .limit(3),
        ]);

      setSearchResults({
        clientes: (clientesRes.data as SearchResultCliente[] | null) ?? [],
        presupuestos:
          (presupuestosRes.data as unknown as SearchResultPresupuesto[] | null) ?? [],
        facturas:
          (facturasRes.data as unknown as SearchResultFactura[] | null) ?? [],
        productos: (productosRes.data as SearchResultProducto[] | null) ?? [],
      });
    } catch {
      setSearchResults({ clientes: [], presupuestos: [], facturas: [], productos: [] });
    } finally {
      setSearchLoading(false);
    }
  }

  function navigateTo(path: string) {
    setSearchOpen(false);
    setSearch("");
    router.push(path);
  }

  const hasResults =
    searchResults &&
    (searchResults.clientes.length > 0 ||
      searchResults.presupuestos.length > 0 ||
      searchResults.facturas.length > 0 ||
      searchResults.productos.length > 0);

  // ── Alerts ──────────────────────────────────────────────────────
  const fetchAlerts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("alertas")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (!error && data && data.length > 0) {
        setAlerts(data as AlertRow[]);
      } else {
        setAlerts(mockAlerts.map((a) => ({
          id: a.id,
          tipo: a.type,
          title: a.title,
          description: a.description,
          module: a.module,
          read: a.read,
          created_at: a.createdAt,
          entity_id: a.entityId ?? null,
        })));
      }
    } catch {
      setAlerts(mockAlerts.map((a) => ({
        id: a.id,
        tipo: a.type,
        title: a.title,
        description: a.description,
        module: a.module,
        read: a.read,
        created_at: a.createdAt,
        entity_id: a.entityId ?? null,
      })));
    }
  }, [supabase]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const unread = alerts.filter((a) => !a.read);

  async function markAllRead() {
    const unreadIds = unread.map((a) => a.id);
    if (unreadIds.length === 0) return;

    await supabase
      .from("alertas")
      .update({ read: true })
      .in("id", unreadIds);

    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-4 sm:px-8 sm:py-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-3">
        {/* Hamburger menu - mobile only */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 lg:hidden dark:hover:bg-zinc-800"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        )}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Sociedad selector */}
        {sociedades.length > 1 && sociedadActiva && (
          <div className="relative">
            <button
              onClick={() => setSociedadOpen(!sociedadOpen)}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                borderColor: sociedadActiva.colorPrimario + "40",
                backgroundColor: sociedadActiva.colorPrimario + "10",
                color: sociedadActiva.colorPrimario,
              }}
            >
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">{sociedadActiva.nombre}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {sociedadOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSociedadOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {sociedades.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSociedadActiva(s);
                        setSociedadOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        s.id === sociedadActiva.id
                          ? "bg-zinc-100 dark:bg-zinc-800"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                      }`}
                    >
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white text-xs font-bold"
                        style={{ backgroundColor: s.colorPrimario }}
                      >
                        {s.nombre.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {s.nombre}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          CUIT: {s.cuit}
                        </p>
                      </div>
                      {s.id === sociedadActiva.id && (
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.colorPrimario }} />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative hidden md:block" ref={searchContainerRef}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Buscar clientes, PR, facturas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              if (search.length >= 2) setSearchOpen(true);
            }}
            className="h-9 w-72 rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-4 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-400 dark:border-zinc-600 dark:bg-zinc-700">
            ⌘K
          </kbd>

          {/* Search results dropdown */}
          {searchOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-96 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {searchLoading ? (
                <div className="flex items-center justify-center gap-2 py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    Buscando...
                  </span>
                </div>
              ) : !hasResults ? (
                <div className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Sin resultados
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  {/* Clientes */}
                  {searchResults.clientes.length > 0 && (
                    <div>
                      <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        Clientes
                      </div>
                      {searchResults.clientes.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => navigateTo("/clientes")}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                            <Users className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {c.razon_social}
                            </p>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              CUIT: {c.cuit}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Presupuestos */}
                  {searchResults.presupuestos.length > 0 && (
                    <div>
                      <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        Presupuestos
                      </div>
                      {searchResults.presupuestos.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => navigateTo("/presupuestos")}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              PR {p.numero}
                            </p>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {p.clientes?.razon_social ?? ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Facturas */}
                  {searchResults.facturas.length > 0 && (
                    <div>
                      <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        Facturas
                      </div>
                      {searchResults.facturas.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => navigateTo("/facturacion")}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400">
                            <Receipt className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {f.tipo} N.° {f.numero}
                            </p>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {f.clientes?.razon_social ?? ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Productos */}
                  {searchResults.productos.length > 0 && (
                    <div>
                      <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        Productos
                      </div>
                      {searchResults.productos.map((prod) => (
                        <button
                          key={prod.id}
                          onClick={() => navigateTo("/stock")}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400">
                            <Package className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {prod.nombre}
                            </p>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              Cod: {prod.codigo}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* bottom padding */}
                  <div className="h-2" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notifications with dropdown */}
        <div className="relative">
          <button
            onClick={() => setAlertsOpen(!alertsOpen)}
            className="relative rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <Bell className="h-5 w-5" />
            {unread.length > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {unread.length}
              </span>
            )}
          </button>

          {alertsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAlertsOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-96 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-zinc-900 dark:text-white">Alertas</h3>
                    {unread.length > 0 && <Badge variant="danger">{unread.length} nuevas</Badge>}
                  </div>
                  <button
                    onClick={() => setAlertsOpen(false)}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {alerts.map((alert) => {
                    const Icon = alertIcons[alert.tipo] || AlertTriangle;
                    return (
                      <div
                        key={alert.id}
                        className={`flex gap-3 border-b border-zinc-100 p-4 last:border-0 dark:border-zinc-800 ${
                          !alert.read ? "bg-orange-50/50 dark:bg-orange-950/20" : ""
                        }`}
                      >
                        <div className={`mt-0.5 rounded-md p-1.5 ${!alert.read ? "bg-orange-100 text-orange-600" : "bg-zinc-100 text-zinc-400"}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{alert.title}</p>
                            <Badge variant={alertVariant[alert.tipo]}>{alert.module}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-zinc-500 line-clamp-2">{alert.description}</p>
                          <p className="mt-1 text-xs text-zinc-400">{formatDateTime(alert.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
                  <button
                    onClick={markAllRead}
                    className="w-full rounded-lg py-2 text-center text-xs font-medium text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                  >
                    Marcar todas como leidas
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Primary action */}
        {action && (
          <button
            onClick={action.onClick}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 sm:px-4 text-sm font-medium text-white shadow-sm hover:bg-orange-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{action.label}</span>
          </button>
        )}
      </div>
    </header>
  );
}
