"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { useState } from "react";
import type { Role } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/types";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
  { name: "Clientes", href: "/clientes", icon: Users, module: "clientes" },
  { name: "Proveedores", href: "/proveedores", icon: Factory, module: "proveedores" },
  { name: "Presupuestos", href: "/presupuestos", icon: FileText, module: "presupuestos" },
  { name: "Órdenes compra", href: "/ordenes-compra", icon: ShoppingCart, module: "ordenes_compra" },
  { name: "Facturación", href: "/facturacion", icon: Receipt, module: "facturacion" },
  { name: "Remitos", href: "/remitos", icon: Truck, module: "remitos" },
  { name: "Stock", href: "/stock", icon: Package, module: "stock" },
  { name: "Finanzas", href: "/finanzas", icon: Wallet, module: "finanzas" },
  { name: "Reportes", href: "/reportes", icon: BarChart3, module: "reportes" },
];

function hasModuleAccess(role: Role, module: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.some((p) => p.module === "*" || p.module === module);
}

export function Sidebar({ role = "admin" }: { role?: Role }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-zinc-200 bg-white transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-950",
        collapsed ? "w-[68px]" : "w-[250px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 font-bold text-white text-sm">
              L
            </div>
            <span className="text-base font-bold text-zinc-900 dark:text-white">
              Lazzari
            </span>
            <span className="text-xs text-zinc-400 font-medium">CRM</span>
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard" className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 font-bold text-white text-sm">
            L
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800",
            collapsed && "mx-auto mt-2"
          )}
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navigation
            .filter((item) => hasModuleAccess(role, item.module))
            .map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                    )}
                    title={collapsed ? item.name : undefined}
                  >
                    <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-orange-500")} />
                    {!collapsed && <span>{item.name}</span>}
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
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              pathname.startsWith("/configuracion")
                ? "bg-orange-50 text-orange-600"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
            title={collapsed ? "Configuración" : undefined}
          >
            <Settings className="h-5 w-5" />
            {!collapsed && <span>Configuración</span>}
          </Link>
        )}

        {/* User */}
        <div className={cn("mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5", collapsed && "justify-center")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            ML
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">Martín Lazzari</p>
              <p className="truncate text-xs text-zinc-400">Administrador</p>
            </div>
          )}
          {!collapsed && (
            <button className="text-zinc-400 hover:text-zinc-600">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
