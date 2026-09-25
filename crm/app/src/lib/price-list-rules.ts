import type { ListaPreciosRegla } from "./types";

export type PriceListRule = ListaPreciosRegla;

export interface PriceListItemForRules {
  precio: number;
  precio_neto?: number | null;
  descuento?: number | null;
  categoria?: string | null;
  variante?: string | null;
}

export function parseQuantityRange(variante?: string | null): { min: number; max: number } | null {
  if (!variante) return null;
  const value = variante.trim();
  const range = value.match(/^(\d+(?:[.,]\d+)?)\s*[-–a]\s*(\d+(?:[.,]\d+)?)/i);
  if (range) return { min: Number(range[1].replace(",", ".")), max: Number(range[2].replace(",", ".")) };
  const plus = value.match(/^(\d+(?:[.,]\d+)?)\s*\+/);
  if (plus) return { min: Number(plus[1].replace(",", ".")), max: Infinity };
  const hasta = value.match(/hasta\s+(\d+(?:[.,]\d+)?)/i);
  if (hasta) return { min: 1, max: Number(hasta[1].replace(",", ".")) };
  return null;
}

function todayArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

function specificity(rule: PriceListRule) {
  return rule.tipo === "cantidad" ? 3 : rule.tipo === "categoria" ? 2 : 1;
}

export function calculateNetPrice(
  item: PriceListItemForRules,
  rules: PriceListRule[],
  quantity?: number | null,
  date = todayArgentina(),
) {
  const price = Math.max(0, Number(item.precio) || 0);
  const manualDiscount = Math.min(100, Math.max(0, Number(item.descuento) || 0));
  const explicitNet = item.precio_neto == null ? NaN : Number(item.precio_neto);
  const baseNet = Number.isFinite(explicitNet) && explicitNet >= 0
    ? explicitNet
    : price * (1 - manualDiscount / 100);
  const parsedQuantity = parseQuantityRange(item.variante)?.min;
  const effectiveQuantity = quantity != null && Number.isFinite(Number(quantity)) ? Number(quantity) : parsedQuantity;
  const category = String(item.categoria || "").trim().toLocaleLowerCase("es-AR");

  const applicable = rules.filter(rule => {
    if (!rule.activa || rule.descuento < 0 || rule.descuento > 100) return false;
    if (rule.vigencia_desde && rule.vigencia_desde > date) return false;
    if (rule.vigencia_hasta && rule.vigencia_hasta < date) return false;
    if (rule.tipo === "categoria" && String(rule.categoria || "").trim().toLocaleLowerCase("es-AR") !== category) return false;
    if (rule.tipo === "cantidad") {
      if (effectiveQuantity == null) return false;
      if (rule.categoria && rule.categoria.trim().toLocaleLowerCase("es-AR") !== category) return false;
      if (rule.cantidad_desde != null && effectiveQuantity < Number(rule.cantidad_desde)) return false;
      if (rule.cantidad_hasta != null && effectiveQuantity > Number(rule.cantidad_hasta)) return false;
    }
    return true;
  }).sort((a, b) =>
    b.prioridad - a.prioridad
    || specificity(b) - specificity(a)
    || a.id.localeCompare(b.id)
  );

  const rule = applicable[0] || null;
  const ruleDiscount = rule ? Number(rule.descuento) : 0;
  const netPrice = Math.round(baseNet * (1 - ruleDiscount / 100) * 100) / 100;
  return { baseNet: Math.round(baseNet * 100) / 100, netPrice, rule, ruleDiscount, quantity: effectiveQuantity ?? null };
}
