import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: "USD" | "ARS" = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: Date | string) {
  let safeDate = date instanceof Date ? date : new Date(date);

  // Postgres devuelve las columnas DATE como "YYYY-MM-DD". JavaScript las
  // interpreta como medianoche UTC y en Argentina eso cae en el día anterior.
  // Para fechas civiles conservamos explícitamente el día informado.
  if (typeof date === "string") {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const isUtcMidnight = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?(?:Z|\+00:?00)$/.test(date);
    if (isDateOnly || isUtcMidnight) {
      safeDate = new Date(`${date.slice(0, 10)}T12:00:00Z`);
    }
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(safeDate);
}

export function formatDateTime(date: Date | string) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(date));
}

/** Returns today's date as YYYY-MM-DD in Argentina timezone */
export function todayAR() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);
  return parts; // en-CA format is YYYY-MM-DD
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
