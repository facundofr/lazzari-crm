"use client";

import { Bell, Search, Plus, X, Package, Clock, DollarSign, FileText, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { mockAlerts } from "@/lib/mock-data";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
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
  const [alertsOpen, setAlertsOpen] = useState(false);
  const unread = mockAlerts.filter((a) => !a.read);

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-8 py-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Buscar clientes, PR, facturas..."
            className="h-9 w-72 rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-4 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-400 dark:border-zinc-600 dark:bg-zinc-700">
            ⌘K
          </kbd>
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

          {/* Alerts dropdown panel */}
          {alertsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAlertsOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
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
                  {mockAlerts.map((alert) => {
                    const Icon = alertIcons[alert.type] || AlertTriangle;
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
                            <Badge variant={alertVariant[alert.type]}>{alert.module}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-zinc-500 line-clamp-2">{alert.description}</p>
                          <p className="mt-1 text-xs text-zinc-400">{formatDateTime(alert.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
                  <button className="w-full rounded-lg py-2 text-center text-xs font-medium text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/30">
                    Marcar todas como leídas
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
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-orange-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {action.label}
          </button>
        )}
      </div>
    </header>
  );
}
