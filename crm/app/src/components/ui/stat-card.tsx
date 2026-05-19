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

export function StatCard({ title, value, change, changeLabel, icon: Icon, iconColor = "text-zinc-500" }: StatCardProps) {
  const TrendIcon = change === undefined ? null : change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  const trendColor = change === undefined ? "" : change > 0 ? "text-emerald-600" : change < 0 ? "text-red-600" : "text-zinc-400";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
        <div className={cn("rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800", iconColor)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">{value}</p>
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
