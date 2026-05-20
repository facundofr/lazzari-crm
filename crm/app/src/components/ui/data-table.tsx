"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";

export interface Column<T> {
  key: string;
  label: string;
  className?: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortKey?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  pageSize?: number;
}

type SortDir = "asc" | "desc";

export function DataTable<T extends { id: string }>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No hay datos para mostrar",
  pageSize = 10,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  // Reset page when data changes
  const dataLen = data.length;
  const [prevLen, setPrevLen] = useState(dataLen);
  if (dataLen !== prevLen) {
    setPrevLen(dataLen);
    setPage(0);
  }

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortKey];
      const bVal = (b as Record<string, unknown>)[sortKey];
      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal ?? "").localeCompare(String(bVal ?? ""), "es");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

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
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col)}
                  className={cn(
                    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400",
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
            {paged.length === 0 ? (
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
              paged.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "transition-colors",
                    onRowClick
                      ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                      : ""
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3.5 text-sm text-zinc-700 dark:text-zinc-300",
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
      {sorted.length > pageSize && (
        <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <span className="text-xs text-zinc-500">
            Mostrando {showingFrom}–{showingTo} de {sorted.length}
          </span>
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
        </div>
      )}
    </div>
  );
}
