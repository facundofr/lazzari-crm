"use client";

import { useState } from "react";
import { Filter, X, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterConfig {
  key: string;
  label: string;
  type: "select" | "date-range" | "number-range";
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface FilterValues {
  [key: string]: string | { from?: string; to?: string } | { min?: number; max?: number };
}

interface SmartFiltersProps {
  filters: FilterConfig[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  className?: string;
}

export function SmartFilters({ filters, values, onChange, className }: SmartFiltersProps) {
  const [open, setOpen] = useState(false);

  const activeCount = Object.entries(values).filter(([, v]) => {
    if (typeof v === "string") return v !== "";
    if (typeof v === "object" && v !== null) {
      if ("from" in v || "to" in v) return (v as { from?: string; to?: string }).from || (v as { from?: string; to?: string }).to;
      if ("min" in v || "max" in v) return (v as { min?: number; max?: number }).min !== undefined || (v as { max?: number }).max !== undefined;
    }
    return false;
  }).length;

  function updateValue(key: string, val: FilterValues[string]) {
    onChange({ ...values, [key]: val });
  }

  function clearAll() {
    const cleared: FilterValues = {};
    filters.forEach((f) => {
      if (f.type === "select") cleared[f.key] = "";
      else if (f.type === "date-range") cleared[f.key] = { from: "", to: "" };
      else if (f.type === "number-range") cleared[f.key] = {};
    });
    onChange(cleared);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
          activeCount > 0
            ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-400"
            : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        )}
      >
        <Filter className="h-4 w-4" />
        Filtros
        {activeCount > 0 && (
          <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-xs text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          {filters.map((filter) => (
            <div key={filter.key} className="min-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {filter.label}
              </label>

              {filter.type === "select" && (
                <select
                  value={(values[filter.key] as string) || ""}
                  onChange={(e) => updateValue(filter.key, e.target.value)}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">{filter.placeholder || "Todos"}</option>
                  {filter.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}

              {filter.type === "date-range" && (
                <div className="flex items-center gap-1">
                  <div className="relative">
                    <Calendar className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="date"
                      value={(values[filter.key] as { from?: string })?.from || ""}
                      onChange={(e) =>
                        updateValue(filter.key, {
                          ...(values[filter.key] as object),
                          from: e.target.value,
                        })
                      }
                      className="h-9 w-[130px] rounded-md border border-zinc-200 bg-white pl-7 pr-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  <span className="text-xs text-zinc-400">a</span>
                  <input
                    type="date"
                    value={(values[filter.key] as { to?: string })?.to || ""}
                    onChange={(e) =>
                      updateValue(filter.key, {
                        ...(values[filter.key] as object),
                        to: e.target.value,
                      })
                    }
                    className="h-9 w-[130px] rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              )}

              {filter.type === "number-range" && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    placeholder="Min"
                    value={(values[filter.key] as { min?: number })?.min ?? ""}
                    onChange={(e) =>
                      updateValue(filter.key, {
                        ...(values[filter.key] as object),
                        min: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    className="h-9 w-[80px] rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                  <span className="text-xs text-zinc-400">a</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={(values[filter.key] as { max?: number })?.max ?? ""}
                    onChange={(e) =>
                      updateValue(filter.key, {
                        ...(values[filter.key] as object),
                        max: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    className="h-9 w-[80px] rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              )}
            </div>
          ))}

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="flex h-9 items-center gap-1 rounded-md px-3 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <X className="h-3 w-3" />
              Limpiar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
