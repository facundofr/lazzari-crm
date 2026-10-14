"use client";

import { useState, useRef, useEffect } from "react";
import { Filter, X, Calendar, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterConfig {
  key: string;
  label: string;
  type: "select" | "search-select" | "date-range" | "number-range";
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

function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const filtered = options.filter((o) =>
    norm(o.label).includes(norm(query))
  );

  const selectedLabel = options.find((o) => o.value === value)?.label || "";

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={isOpen ? query : selectedLabel}
          placeholder={placeholder}
          onFocus={() => { setIsOpen(true); setQuery(""); }}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-7 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
        {value && (
          <button
            onClick={() => { onChange(""); setQuery(""); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          {filtered.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setIsOpen(false); setQuery(""); }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700",
                opt.value === value ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400" : "text-zinc-700 dark:text-zinc-200"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
      if (f.type === "select" || f.type === "search-select") cleared[f.key] = "";
      else if (f.type === "date-range") cleared[f.key] = { from: "", to: "" };
      else if (f.type === "number-range") cleared[f.key] = {};
    });
    onChange(cleared);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors",
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
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
          {filters.map((filter) => (
            <div key={filter.key} className="min-w-[140px]">
              <label className="mb-0.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                {filter.label}
              </label>

              {filter.type === "select" && (
                <select
                  value={(values[filter.key] as string) || ""}
                  onChange={(e) => updateValue(filter.key, e.target.value)}
                  className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">{filter.placeholder || "Todos"}</option>
                  {filter.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}

              {filter.type === "search-select" && (
                <SearchSelect
                  value={(values[filter.key] as string) || ""}
                  onChange={(v) => updateValue(filter.key, v)}
                  options={filter.options || []}
                  placeholder={filter.placeholder || "Buscar..."}
                />
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
                      className="h-8 w-[130px] rounded-md border border-zinc-200 bg-white pl-7 pr-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
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
                    className="h-8 w-[130px] rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
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
                    className="h-8 w-[80px] rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
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
                    className="h-8 w-[80px] rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              )}
            </div>
          ))}

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="flex h-8 items-center gap-1 rounded-md px-3 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
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
