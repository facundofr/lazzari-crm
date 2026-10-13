import { parseBnaHistorical, isTrustedBnaCache } from "./bna-historical";
import { createSupabaseServer } from "./supabase/server";

export function previousInvoiceDay(fecha: string) {
  const date = new Date(`${fecha}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== fecha) throw new Error("Fecha de factura inválida.");
  date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10);
}

/** Try BNA scraping first, then fall back to verified DB cache. */
export async function getInvoiceExchangeRate(fechaFactura: string, modalidad: "divisas" | "billetes" = "divisas") {
  if (!["divisas", "billetes"].includes(modalidad)) throw new Error("Modalidad de cotización inválida.");
  const target = previousInvoiceDay(fechaFactura);
  const tipoDb = modalidad === "billetes" ? "oficial_billetes" : "oficial_divisas";

  // 1. Try BNA direct scraping
  try {
    const [y,m,d] = target.split('-');
    const url = `https://www.bna.com.ar/Cotizador/HistoricoPrincipales?id=${modalidad}&fecha=${encodeURIComponent(`${d}/${m}/${y}`)}&idMoneda=${modalidad === "billetes" ? "22" : "55"}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const quote = parseBnaHistorical(await res.text(), target);
      if (quote && Date.parse(target) - Date.parse(quote.fecha) <= 7 * 86400000) {
        return { fecha: quote.fecha, valor_venta: quote.venta, valor_compra: quote.compra, modalidad, fuente: "BNA", automatica: true };
      }
    }
  } catch {
    // BNA no respondió — continuar a fallback DB
  }

  // 2. Fallback: verified cache in DB (cotizaciones_dolar)
  try {
    const supabase = await createSupabaseServer();
    // Look for exact date match first
    const { data: exact } = await (supabase as any)
      .from("cotizaciones_dolar")
      .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
      .eq("tipo", tipoDb)
      .eq("fecha", target)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (isTrustedBnaCache(exact)) {
      return { fecha: exact.fecha, valor_venta: Number(exact.valor_venta), valor_compra: Number(exact.valor_compra), modalidad, fuente: exact.fuente, automatica: true };
    }
    // Look for most recent trusted entry ≤ target (skip untrusted rows, e.g. a holiday saved by the cron)
    const { data: recientes } = await (supabase as any)
      .from("cotizaciones_dolar")
      .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
      .eq("tipo", tipoDb)
      .lte("fecha", target)
      .order("fecha", { ascending: false })
      .limit(10);
    const latest = (recientes || []).find((row: any) => isTrustedBnaCache(row)) || null;
    if (isTrustedBnaCache(latest) && Date.parse(target) - Date.parse(latest.fecha) <= 7 * 86400000) {
      return { fecha: latest.fecha, valor_venta: Number(latest.valor_venta), valor_compra: Number(latest.valor_compra), modalidad, fuente: latest.fuente, automatica: true };
    }
  } catch {
    // DB fallback failed too
  }

  throw new Error("No se pudo obtener la cotización BNA. Verificá tu conexión e intentá de nuevo, o usá la opción de cotización manual.");
}
