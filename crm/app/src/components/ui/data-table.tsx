"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";

export interface Column<T> {
  key: string;
  label: string;
  className?: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortKey?: string;
  sortValue?: (row: T) => string | number | null;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  pageSize?: number;
  loading?: boolean;
}

type SortDir = "asc" | "desc";

const FILAS_KEY = "tabla.filas";
const FILAS_OPCIONES = [25, 50, 100, 0];
const FILAS_DEFAULT = 50;

export function DataTable<T extends { id: string }>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No hay datos para mostrar",
  pageSize: pageSizeFijo,
  loading = false,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  // Filas por página que elige cada usuario (se recuerda en la compu). 0 = todas.
  const [filas, setFilas] = useState<number>(FILAS_DEFAULT);
  useEffect(() => {
    try {
      const crudo = window.localStorage.getItem(FILAS_KEY);
      const guardado = crudo === null ? NaN : Number(crudo);
      if (FILAS_OPCIONES.includes(guardado)) setFilas(guardado);
    } catch { /* sin almacenamiento: queda el valor por defecto */ }
  }, []);
  function elegirFilas(n: number) {
    setFilas(n);
    setPage(0);
    try { window.localStorage.setItem(FILAS_KEY, String(n)); } catch { /* no pasa nada */ }
  }
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  // Reset page only when data actually changes (different length or different IDs)
  const prevDataKeyRef = useRef("");
  useEffect(() => {
    const key = data.length + ":" + data.slice(0, 3).map(r => r.id).join(",");
    if (prevDataKeyRef.current && prevDataKeyRef.current !== key) {
      setPage(0);
    }
    prevDataKeyRef.current = key;
  }, [data]);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find(c => (c.sortKey || c.key) === sortKey);
    return [...data].sort((a, b) => {
      let aVal: unknown, bVal: unknown;
      if (col?.sortValue) {
        aVal = col.sortValue(a);
        bVal = col.sortValue(b);
      } else {
        aVal = (a as Record<string, unknown>)[sortKey];
        bVal = (b as Record<string, unknown>)[sortKey];
      }
      let cmp = 0;
      const aNum = typeof aVal === "number" ? aVal : (typeof aVal === "string" && !isNaN(Number(aVal)) ? Number(aVal) : null);
      const bNum = typeof bVal === "number" ? bVal : (typeof bVal === "string" && !isNaN(Number(bVal)) ? Number(bVal) : null);
      if (aNum !== null && bNum !== null) {
        cmp = aNum - bNum;
      } else {
        cmp = String(aVal ?? "").localeCompare(String(bVal ?? ""), "es");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, columns]);

  const pageSize = pageSizeFijo ?? (filas === 0 ? Math.max(1, sorted.length) : filas);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paged = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const showingFrom = sorted.length === 0 ? 0 : safePage * pageSize + 1;
  const showingTo = Math.min((safePage + 1) * pageSize, sorted.length);

  function handleSort(col: Column<T>) {
    if (col.sortable === false) return;
    const key = col.sortKey || col.key;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  function SortIcon({ col }: { col: Column<T> }) {
    if (col.sortable === false) return null;
    const key = col.sortKey || col.key;
    if (sortKey !== key) return <ChevronsUpDown className="ml-1 inline h-3 w-3 text-zinc-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="ml-1 inline h-3 w-3 text-orange-500" />
      : <ChevronDown className="ml-1 inline h-3 w-3 text-orange-500" />;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="dn-tabla w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col)}
                  className={cn(
                    "px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 whitespace-nowrap",
                    col.sortable !== false && "cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200",
                    col.className
                  )}
                >
                  {col.label}
                  <SortIcon col={col} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loading ? (
              Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-3 py-2", col.className)}>
                      <div className="h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" style={{ width: `${60 + Math.random() * 30}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : paged.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-16 text-center text-sm text-zinc-400"
                >
                  <svg className="mx-auto mb-3 h-10 w-10 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paged.map((row, rowIdx) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "transition-colors",
                    rowIdx % 2 === 1 && "bg-zinc-50/50 dark:bg-zinc-800/20",
                    onRowClick
                      ? "cursor-pointer hover:bg-orange-50/50 dark:hover:bg-orange-950/20"
                      : ""
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-2.5 py-1.5 text-[13px] text-zinc-700 dark:text-zinc-300",
                        col.className
                      )}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(pageSizeFijo ? sorted.length > pageSizeFijo : sorted.length > FILAS_OPCIONES[0]) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-zinc-500">
              Mostrando {showingFrom}–{showingTo} de {sorted.length}
            </span>
            {!pageSizeFijo && (
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                <span>Filas:</span>
                {FILAS_OPCIONES.map((n) => (
                  <button key={n} type="button" onClick={() => elegirFilas(n)}
                    className={cn(
                      "rounded-md px-2 py-0.5 font-medium",
                      filas === n ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    )}>
                    {n === 0 ? "Todas" : n}
                  </button>
                ))}
              </div>
            )}
          </div>
          {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i)
              .filter((i) => i === 0 || i === totalPages - 1 || Math.abs(i - safePage) <= 1)
              .reduce<(number | "ellipsis")[]>((acc, i, idx, arr) => {
                if (idx > 0 && arr[idx - 1] !== undefined && i - (arr[idx - 1] as number) > 1) {
                  acc.push("ellipsis");
                }
                acc.push(i);
                return acc;
              }, [])
              .map((item, idx) =>
                item === "ellipsis" ? (
                  <span key={`e${idx}`} className="px-1 text-xs text-zinc-400">...</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item)}
                    className={cn(
                      "min-w-[28px] rounded-md px-2 py-1 text-xs font-medium",
                      safePage === item
                        ? "bg-orange-500 text-white"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    )}
                  >
                    {item + 1}
                  </button>
                )
              )}
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed dark:hover:bg-zinc-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
