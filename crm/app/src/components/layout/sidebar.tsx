"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Lightbulb,
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  Truck,
  Package,
  Wallet,
  BarChart3,
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
  ArrowRightLeft,
  Calendar,
  Shirt,
  Zap,
  Scissors,
  Plane,
  FileSearch,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { Role } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { useUser } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { APP_VERSION_LABEL } from "@/lib/app-version";

// Menú agrupado por lo que hace cada sector. Cada uno ve solo los módulos que su rol permite
// (los vendedores/compradores no ven Plata). Los grupos sin nada visible no se muestran.
// `oculto`: no aparece en el menú por ahora (se desarrolla más adelante); la pantalla sigue andando si se entra por el link.
// `soloSuperAdmin`: en armado, por ahora la ve solo Augusto.
const navigation: { grupo: string; items: { name: string; href: string; icon: typeof Users; module: string; oculto?: boolean; soloSuperAdmin?: boolean }[] }[] = [
  { grupo: "Inicio", items: [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard", oculto: true }, // Augusto 20/10: fuera del menú (sigue por link); el sistema abre en Presupuestos
    { name: "Pendientes", href: "/pendientes", icon: ListChecks, module: "dashboard" },
    { name: "Calendario", href: "/calendario", icon: Calendar, module: "calendario" },
  ] },
  { grupo: "Vender", items: [
    { name: "Clientes", href: "/clientes", icon: Users, module: "clientes" },
    { name: "Oportunidades", href: "/oportunidades", icon: Lightbulb, module: "clientes", oculto: true },
    { name: "Presupuestos nuevo", href: "/presupuestos-nuevo", icon: Sparkles, module: "presupuestos_nuevo", oculto: true }, // Augusto 20/10: ahora es Presupuestos (el link redirige)
    { name: "Presupuestos", href: "/presupuestos", icon: FileText, module: "presupuestos" },
    { name: "Muestras", href: "/muestras", icon: Shirt, module: "muestras", oculto: true }, // Augusto 20/10: fuera del menú (sigue por link)
    { name: "Ventas", href: "/ventas", icon: ArrowRightLeft, module: "presupuestos", oculto: true }, // Augusto 20/10: fuera del menú (sigue por link)
    { name: "Facturas", href: "/consulta-facturas", icon: FileSearch, module: "consulta_facturas" },
  ] },
  { grupo: "Comprar", items: [
    { name: "Proveedores", href: "/proveedores", icon: Factory, module: "proveedores" },
    { name: "Compras nueva", href: "/compras-nueva", icon: ShoppingCart, module: "compras_nueva", oculto: true }, // Augusto 18/10: no se usa más (sigue por link)
    { name: "Compras Lazza", href: "/compras-lazza", icon: ShoppingCart, module: "compras_nueva" },
    { name: "Compras", href: "/ordenes-compra", icon: ShoppingCart, module: "ordenes_compra", oculto: true }, // Augusto 19/10: todo en Compras Lazza (sigue por link)
    { name: "Personalización", href: "/personalizacion", icon: Scissors, module: "ordenes_compra", oculto: true },
    { name: "Importaciones", href: "/importaciones", icon: Plane, module: "ordenes_compra", oculto: true },
  ] },
  { grupo: "Entregar", items: [
    { name: "Remitos", href: "/remitos", icon: Receipt, module: "remitos" },
    { name: "Stock", href: "/stock", icon: Package, module: "stock", oculto: true },
    { name: "Transportes", href: "/transportes", icon: Truck, module: "remitos" },
  ] },
  { grupo: "Plata", items: [
    { name: "Finanzas", href: "/finanzas", icon: Wallet, module: "finanzas" },
    { name: "Finanzas Lazza", href: "/finanzas-lazza", icon: Wallet, module: "finanzas", soloSuperAdmin: true },
    { name: "Reportes", href: "/reportes", icon: BarChart3, module: "reportes", oculto: true }, // Augusto 20/10: usa Reportes de Finanzas Lazza (sigue por link)
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
    sociedadActiva,
  } = useUser();
  const { theme, toggleTheme } = useTheme();
  const [loggingOut, setLoggingOut] = useState(false);

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

  const accentColor = sociedadActiva?.colorPrimario || "#FF4500";
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
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-zinc-200 bg-white transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-950",
        // Desktop: normal behavior
        collapsed ? "lg:w-[68px]" : "lg:w-[250px]",
        // Mobile: off-screen by default, slide in when open
        mobileSidebarOpen
          ? "w-[280px] translate-x-0"
          : "-translate-x-full lg:translate-x-0",
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {navigation.map((g) => {
          const visibles = g.items.filter((item) => !item.oculto && (!item.soloSuperAdmin || role === "super_admin")).filter((item) => item.module === "compras_nueva" ? !!profile?.prueba_compras_nueva : item.module === "presupuestos_nuevo" ? !!profile?.prueba_presupuestos_nuevo : hasModuleAccess(role, item.module));
          if (!visibles.length) return null;
          const showLabel = !collapsed || mobileSidebarOpen;
          return (
            <div key={g.grupo} className="mb-2">
              {showLabel
                ? <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{g.grupo}</p>
                : <div className="mx-3 mb-1 border-t border-zinc-200 dark:border-zinc-800" />}
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
                          "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                          !isActive && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                        )}
                        style={isActive ? { backgroundColor: accentColor + "15", color: accentColor } : undefined}
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
      <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {hasModuleAccess(role, "presupuestos") && (
          <Link
            href="/papelera"
            onClick={handleNavClick}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              !pathname.startsWith("/papelera") && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
            style={pathname.startsWith("/papelera") ? { backgroundColor: accentColor + "15", color: accentColor } : undefined}
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
              "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              !pathname.startsWith("/configuracion") && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
            style={pathname.startsWith("/configuracion") ? { backgroundColor: accentColor + "15", color: accentColor } : undefined}
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
            "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white w-full",
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
