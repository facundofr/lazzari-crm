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
  BarChart3,
  Settings,
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
} from "lucide-react";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { Role } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { useUser } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

const navigation = [
  // ── Comercial ──
  { name: "Clientes", href: "/clientes", icon: Users, module: "clientes" },
  { name: "Proveedores", href: "/proveedores", icon: Factory, module: "proveedores" },
  { name: "Presupuestos", href: "/presupuestos", icon: FileText, module: "presupuestos" },
  { name: "Ventas", href: "/ventas", icon: ArrowRightLeft, module: "presupuestos" },
  // ── Compras & logistica ──
  { name: "Compras", href: "/ordenes-compra", icon: ShoppingCart, module: "ordenes_compra" },
  { name: "Remitos", href: "/remitos", icon: Truck, module: "remitos" },
  { name: "Transportes", href: "/transportes", icon: Truck, module: "remitos" },
  // ── Admin ──
  { name: "Finanzas", href: "/finanzas", icon: Wallet, module: "finanzas" },
  { name: "Reportes", href: "/reportes", icon: BarChart3, module: "reportes" },
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
  { name: "Calendario", href: "/calendario", icon: Calendar, module: "calendario" },
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
          <Link href="/dashboard" className="flex items-center gap-2" onClick={handleNavClick}>
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
          <Link href="/dashboard" className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white text-sm" style={{ backgroundColor: accentColor }}>
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
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navigation
            .filter((item) => hasModuleAccess(role, item.module))
            .map((item) => {
              const isActive = pathname.startsWith(item.href);
              const showLabel = !collapsed || mobileSidebarOpen;
              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    onClick={handleNavClick}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      !isActive && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                    )}
                    style={isActive ? { backgroundColor: accentColor + "15", color: accentColor } : undefined}
                    title={!showLabel ? item.name : undefined}
                  >
                    <item.icon className="h-5 w-5 shrink-0" style={isActive ? { color: accentColor } : undefined} />
                    {showLabel && <span>{item.name}</span>}
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>

      {/* Bottom */}
      <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
        {hasModuleAccess(role, "configuracion") && (
          <Link
            href="/configuracion"
            onClick={handleNavClick}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              !pathname.startsWith("/configuracion") && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
            style={pathname.startsWith("/configuracion") ? { backgroundColor: accentColor + "15", color: accentColor } : undefined}
            title={collapsed && !mobileSidebarOpen ? "Configuración" : undefined}
          >
            <Settings className="h-5 w-5" />
            {(!collapsed || mobileSidebarOpen) && <span>Configuración</span>}
          </Link>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white w-full",
            collapsed && !mobileSidebarOpen && "justify-center"
          )}
          title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
        >
          {theme === "dark" ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
          {(!collapsed || mobileSidebarOpen) && <span>{theme === "dark" ? "Modo claro" : "Modo oscuro"}</span>}
        </button>

        {/* User */}
        <div className={cn("mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5", collapsed && !mobileSidebarOpen && "justify-center")}>
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
