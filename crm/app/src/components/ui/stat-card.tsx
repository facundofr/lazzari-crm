"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change?: number;
  changeLabel?: string;
  icon: LucideIcon;
  iconColor?: string;
}

const iconBgMap: Record<string, string> = {
  "text-emerald-600": "bg-emerald-100 dark:bg-emerald-900/40",
  "text-blue-600": "bg-blue-100 dark:bg-blue-900/40",
  "text-orange-500": "bg-orange-100 dark:bg-orange-900/40",
  "text-violet-600": "bg-violet-100 dark:bg-violet-900/40",
  "text-red-600": "bg-red-100 dark:bg-red-900/40",
  "text-amber-600": "bg-amber-100 dark:bg-amber-900/40",
  "text-zinc-500": "bg-zinc-100 dark:bg-zinc-800",
};

export function StatCard({ title, value, change, changeLabel, icon: Icon, iconColor = "text-zinc-500" }: StatCardProps) {
  const TrendIcon = change === undefined ? null : change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  const trendColor = change === undefined ? "" : change > 0 ? "text-emerald-600" : change < 0 ? "text-red-600" : "text-zinc-400";
  const iconBg = iconBgMap[iconColor] || "bg-zinc-100 dark:bg-zinc-800";

  return (
    <div className="group rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
        <div className={cn("rounded-lg p-2 transition-transform group-hover:scale-110", iconBg, iconColor)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">{value}</p>
      {change !== undefined && TrendIcon && (
        <div className="mt-2 flex items-center gap-1.5">
          <TrendIcon className={cn("h-3.5 w-3.5", trendColor)} />
          <span className={cn("text-xs font-medium", trendColor)}>
            {change > 0 ? "+" : ""}{change}%
          </span>
          {changeLabel && (
            <span className="text-xs text-zinc-400">{changeLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
