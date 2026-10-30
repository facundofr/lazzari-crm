"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  Truck,
  Package,
  Wallet,
  Settings,
  Trash2,
  LogOut,
  ChevronLeft,
  Factory,
  ShoppingCart,
  Loader2,
  Sun,
  Moon,
  X,
  Calendar,
  MailCheck,
  BellRing,
  Shirt,
  Zap,
  FileSearch,
  Sparkles,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useEffect, useState } from "react";
import { aplicarOrdenMenu, moverEnLista } from "@/lib/orden-menu";
import { createBrowserClient } from "@supabase/ssr";
import type { Role } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { useUser } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { APP_VERSION_LABEL } from "@/lib/app-version";

// Menú en una sola lista, en el orden que pidió Augusto (29/10). Cada uno ve solo los módulos que su rol permite
// (los vendedores/compradores no ven Finanzas).
// `oculto`: no aparece en el menú por ahora (se desarrolla más adelante); la pantalla sigue andando si se entra por el link.
// `soloSuperAdmin`: en armado, por ahora la ve solo Augusto. `soloRoles`: solo esos roles (además de tener el módulo).
// Este es el orden de fábrica: Augusto lo cambia con "Ordenar menú" y ese orden lo ven todos (lib/orden-menu.ts).
const navigation: { grupo: string; items: { name: string; href: string; icon: typeof Users; module: string; oculto?: boolean; soloSuperAdmin?: boolean; soloRoles?: string[] }[] }[] = [
  { grupo: "Menú", items: [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard", oculto: true }, // Augusto 20/10: fuera del menú (sigue por link); el sistema abre en Presupuestos
    { name: "Clientes", href: "/clientes", icon: Users, module: "clientes" },
    { name: "Proveedores", href: "/proveedores", icon: Factory, module: "proveedores" },
    { name: "Presupuestos nuevo", href: "/presupuestos-nuevo", icon: Sparkles, module: "presupuestos_nuevo", oculto: true }, // Augusto 20/10: ahora es Presupuestos (el link redirige)
    { name: "Presupuestos", href: "/presupuestos", icon: FileText, module: "presupuestos" },
    { name: "Muestras", href: "/muestras", icon: Shirt, module: "muestras", oculto: true }, // Augusto 20/10: fuera del menú (sigue por link)
    { name: "Compras", href: "/compras-lazza", icon: ShoppingCart, module: "compras_nueva" },
    { name: "Remitos", href: "/remitos", icon: Receipt, module: "remitos" },
    { name: "Stock", href: "/stock", icon: Package, module: "stock", oculto: true },
    { name: "Transportes", href: "/transportes", icon: Truck, module: "remitos" },
    { name: "Facturas", href: "/facturas", icon: FileSearch, module: "consulta_facturas" }, // Augusto 20/10: Facturas de Finanzas Lazza (vendedores solo mirar); la vieja (/consulta-facturas) se borró 29/10 y redirige acá
    { name: "Correos", href: "/correos", icon: MailCheck, module: "calendario" }, // Augusto 28/10: cada mail que sale del CRM y si llegó (todos los usuarios)
    { name: "Calendario", href: "/calendario", icon: Calendar, module: "calendario" },
    { name: "Finanzas", href: "/finanzas", icon: Wallet, module: "finanzas", soloRoles: ["super_admin", "administrativo"] }, // Mudanza 23/10: Finanzas es la nueva (ex Finanzas Lazza); la vieja quedó oculta en /finanzas-vieja
    { name: "Cobranzas", href: "/cobranzas", icon: BellRing, module: "finanzas", soloRoles: ["super_admin", "administrativo"] }, // Augusto 29/10: avisos de facturas que vencen esta semana y vencidas
  ] },
];

function hasModuleAccess(role: Role, module: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.some((p) => p.module === "*" || p.module === module);
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    profile, role,
    sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed,
    mobileSidebarOpen, setMobileSidebarOpen,
    sociedadActiva, sociedades, setSociedadActiva,
  } = useUser();
  const { theme, toggleTheme, disenoNuevo } = useTheme();
  const [loggingOut, setLoggingOut] = useState(false);
  // Orden guardado por Augusto (null = el de fábrica). `borrador`: rutas mientras ordena; null = no está ordenando.
  const [orden, setOrden] = useState<string[] | null>(null);
  const [borrador, setBorrador] = useState<string[] | null>(null);
  const [guardandoOrden, setGuardandoOrden] = useState(false);

  useEffect(() => {
    fetch("/api/orden-menu").then((r) => (r.ok ? r.json() : null))
      .then((d: { orden: string[] | null } | null) => { if (d) setOrden(d.orden); })
      .catch(() => {});
  }, []);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function handleLogout() {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleNavClick() {
    // Close mobile sidebar on navigation
    setMobileSidebarOpen(false);
  }

  // Ordenar menú (solo super_admin): se ordenan las pantallas del menú (Augusto las ve todas); el orden vale para todos.
  const visiblesEnMenu = navigation[0].items.filter((item) => !item.oculto);
  async function guardarOrden(nuevo: string[] | null) {
    setGuardandoOrden(true);
    const r = await fetch("/api/orden-menu", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orden: nuevo }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setGuardandoOrden(false);
    if (!r?.ok) { alert(`No se pudo guardar el orden: ${d.error ?? "sin conexión"}`); return; }
    setOrden(d.orden ?? null);
    setBorrador(null);
  }

  const accentColor = sociedadActiva?.colorPrimario || "#FF4500";
  // Diseño nuevo: el menú es oscuro, la sección activa va en blanco sobre gris (el color queda en el ícono).
  const estiloActivo = disenoNuevo
    ? { backgroundColor: "rgba(255,255,255,0.09)", color: "#fff" }
    : { backgroundColor: accentColor + "15", color: accentColor };
  const logoInitial = sociedadActiva?.nombre?.charAt(0) || "L";
  const logoName = sociedadActiva?.nombre || "Lazzari";

  const displayName = profile?.full_name
    || profile?.email?.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    || "Usuario";

  const initials = displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const email = profile?.email ?? "";

  return (
    <aside
      className={cn(
        "dn-sidebar fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-zinc-200 bg-white transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-950",
        // Desktop: normal behavior
        collapsed ? "lg:w-[68px]" : "lg:w-[250px]",
        // Mobile: off-screen by default, slide in when open
        mobileSidebarOpen
          ? "w-[280px] translate-x-0"
          : "-translate-x-full lg:translate-x-0",
      )}
    >
      {/* Logo */}
      <div className="dn-logo flex h-16 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        {(!collapsed || mobileSidebarOpen) && (
          <Link href="/presupuestos" className="flex items-center gap-2" onClick={handleNavClick}>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white text-sm"
              style={{ backgroundColor: accentColor }}
            >
              {logoInitial}
            </div>
            <span className="text-base font-bold text-zinc-900 dark:text-white">
              {logoName}
            </span>
            <span className="text-xs text-zinc-400 font-medium">CRM</span>
          </Link>
        )}
        {collapsed && !mobileSidebarOpen && (
          <Link href="/presupuestos" className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white text-sm" style={{ backgroundColor: accentColor }}>
            {logoInitial}
          </Link>
        )}
        {/* Close button on mobile */}
        <button
          onClick={() => {
            if (mobileSidebarOpen) {
              setMobileSidebarOpen(false);
            } else {
              setCollapsed(!collapsed);
            }
          }}
          className={cn(
            "rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800",
            collapsed && !mobileSidebarOpen && "mx-auto mt-2"
          )}
        >
          {mobileSidebarOpen ? (
            <X className="h-4 w-4" />
          ) : (
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          )}
        </button>
      </div>

      {/* Diseño nuevo: cambio de sociedad en el menú (reemplaza el botón de la barra de arriba) */}
      {disenoNuevo && sociedades.length > 1 && sociedadActiva && (!collapsed || mobileSidebarOpen) && (
        <div className="dn-sociedades mx-3 mb-2 grid grid-cols-2 gap-1 rounded-xl p-1">
          {sociedades.map((s) => (
            <button key={s.id} type="button" onClick={() => setSociedadActiva(s)} data-active={s.id === sociedadActiva.id}
              className="flex items-center justify-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-xs font-medium">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.colorPrimario }} />
              <span className="truncate">{s.nombre}</span>
            </button>
          ))}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {borrador && (
          <div className="mb-2">
            <p className="px-1 pb-1.5 text-xs text-zinc-500">Subí o bajá cada pantalla. Este orden lo ven todos (cada uno solo las pantallas que tiene permitidas).</p>
            <ul className="space-y-0.5">
              {borrador.map((ruta, i) => {
                const item = visiblesEnMenu.find((it) => it.href === ruta);
                if (!item) return null;
                return (
                  <li key={ruta} className="dn-link flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    <button type="button" aria-label={`Subir ${item.name}`} disabled={i === 0} onClick={() => setBorrador(moverEnLista(borrador, i, -1))}
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-white">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={`Bajar ${item.name}`} disabled={i === borrador.length - 1} onClick={() => setBorrador(moverEnLista(borrador, i, 1))}
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-white">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex flex-wrap gap-1.5 px-1">
              <button type="button" disabled={guardandoOrden} onClick={() => void guardarOrden(borrador)}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50" style={{ backgroundColor: accentColor }}>
                {guardandoOrden && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar orden
              </button>
              <button type="button" disabled={guardandoOrden} onClick={() => setBorrador(null)}
                className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                Cancelar
              </button>
              {orden && (
                <button type="button" disabled={guardandoOrden} onClick={() => { if (confirm("¿Volver al orden original del menú? Lo ven todos.")) void guardarOrden(null); }}
                  className="rounded-md px-1.5 py-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                  Volver al original
                </button>
              )}
            </div>
          </div>
        )}
        {!borrador && navigation.map((g) => {
          const visibles = aplicarOrdenMenu(g.items, orden).filter((item) => !item.oculto && (!item.soloSuperAdmin || role === "super_admin") && (!item.soloRoles || item.soloRoles.includes(role))).filter((item) => item.module === "compras_nueva" ? !!profile?.prueba_compras_nueva : item.module === "presupuestos_nuevo" ? !!profile?.prueba_presupuestos_nuevo : hasModuleAccess(role, item.module));
          if (!visibles.length) return null;
          const showLabel = !collapsed || mobileSidebarOpen;
          return (
            <div key={g.grupo} className="mb-2">
              <ul className="space-y-0.5">
                {visibles.map((item) => {
                  // Exacto o subruta: que /finanzas-lazza no prenda también Finanzas.
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        onClick={handleNavClick}
                        className={cn(
                          "dn-link flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                          !isActive && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                        )}
                        data-active={isActive}
                        style={isActive ? estiloActivo : undefined}
                        title={!showLabel ? item.name : undefined}
                      >
                        <item.icon className="h-4 w-4 shrink-0" style={isActive ? { color: accentColor } : undefined} />
                        {showLabel && <span>{item.name}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="dn-pie border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {role === "super_admin" && !borrador && (!collapsed || mobileSidebarOpen) && (
          <button type="button" onClick={() => setBorrador(aplicarOrdenMenu(visiblesEnMenu, orden).map((it) => it.href))}
            className="dn-link flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white">
            <ArrowUpDown className="h-4 w-4 shrink-0" />
            <span>Ordenar menú</span>
          </button>
        )}
        {hasModuleAccess(role, "presupuestos") && (
          <Link
            href="/papelera"
            onClick={handleNavClick}
            className={cn(
              "dn-link flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              !pathname.startsWith("/papelera") && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
            data-active={pathname.startsWith("/papelera")}
            style={pathname.startsWith("/papelera") ? estiloActivo : undefined}
            title={collapsed && !mobileSidebarOpen ? "Papelera" : undefined}
          >
            <Trash2 className="h-4 w-4" />
            {(!collapsed || mobileSidebarOpen) && <span>Papelera</span>}
          </Link>
        )}
        {hasModuleAccess(role, "configuracion") && (
          <Link
            href="/configuracion"
            onClick={handleNavClick}
            className={cn(
              "dn-link flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              !pathname.startsWith("/configuracion") && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
            data-active={pathname.startsWith("/configuracion")}
            style={pathname.startsWith("/configuracion") ? estiloActivo : undefined}
            title={collapsed && !mobileSidebarOpen ? "Configuración" : undefined}
          >
            <Settings className="h-4 w-4" />
            {(!collapsed || mobileSidebarOpen) && <span>Configuración</span>}
          </Link>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className={cn(
            "dn-link flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white w-full",
            collapsed && !mobileSidebarOpen && "justify-center"
          )}
          title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
          {(!collapsed || mobileSidebarOpen) && <span>{theme === "dark" ? "Modo claro" : "Modo oscuro"}</span>}
        </button>

        {/* Versión publicada: permite comprobar visualmente qué release está cargado */}
        <div
          className={cn(
            "mt-1 px-3 flex items-center gap-1 text-[10px] font-bold tracking-wide text-red-600 dark:text-red-500",
            collapsed && !mobileSidebarOpen ? "justify-center" : "justify-end"
          )}
          title={`Versión publicada ${APP_VERSION_LABEL}`}
          data-testid="app-version"
        >
          <Zap className="h-3 w-3 fill-yellow-400 text-yellow-500" aria-hidden />
          {collapsed && !mobileSidebarOpen ? APP_VERSION_LABEL.replace("1.1.", "") : APP_VERSION_LABEL}
        </div>

        {/* User */}
        <div className={cn("mt-1 flex items-center gap-3 rounded-lg px-3 py-1.5", collapsed && !mobileSidebarOpen && "justify-center")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {initials}
          </div>
          {(!collapsed || mobileSidebarOpen) && (
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{displayName}</p>
              <p className="truncate text-xs text-zinc-400">{email}</p>
            </div>
          )}
          {(!collapsed || mobileSidebarOpen) && (
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="text-zinc-400 hover:text-red-500 transition-colors"
              title="Cerrar sesión"
            >
              {loggingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
