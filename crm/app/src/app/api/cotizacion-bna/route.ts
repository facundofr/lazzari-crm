import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { parseBnaHistorical, isTrustedBnaCache, BNA_VERIFIED_SOURCE } from "@/lib/bna-historical";

/**
 * GET /api/cotizacion-bna?modalidad=divisas|billetes&fecha=YYYY-MM-DD
 *
 * Fuentes (en orden de prioridad):
 *   1. Cache en DB (cotizaciones_dolar)
 *   2. BNA Cotizador (endpoint AJAX real — distingue divisas/billetes)
 *   3. DolarAPI.com / Bluelytics (fallback, sin distinción divisa/billete)
 *   4. Último valor en DB (stale)
 */

const todayAR = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });

// Cuando el usuario no indica una fecha, la cotización aplicable a una
// factura es la del día hábil anterior (el formulario permite editarla).
const previousBusinessDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00-03:00`);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

const toddmmyyyy = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
};


/**
 * Scrape BNA Cotizador — AJAX endpoint que devuelve HTML parcial con tabla.
 * Billetes: id=billetes, idMoneda=22
 * Divisas:  id=divisas,  idMoneda=55
 */
async function scrapeBna(
  modalidad: "divisas" | "billetes",
  fecha: string
): Promise<{ compra: number; venta: number; fecha: string } | null> {
  const id = modalidad;
  const idMoneda = modalidad === "billetes" ? "22" : "55";
  const fechaDdMm = toddmmyyyy(fecha);

  try {
    const url = `https://www.bna.com.ar/Cotizador/HistoricoPrincipales?id=${id}&fecha=${encodeURIComponent(fechaDdMm)}&idMoneda=${idMoneda}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.bna.com.ar/Cotizador/HistoricoPrincipales",
      },
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const html = await res.text();

    return parseBnaHistorical(html, fecha);
  } catch {
    return null;
  }
}

async function fetchDolarApi(): Promise<{ compra: number; venta: number } | null> {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/oficial", {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const compra = Number(data.compra);
    const venta = Number(data.venta);
    if (isNaN(compra) || isNaN(venta) || compra <= 0 || venta <= 0) return null;
    return { compra, venta };
  } catch {
    return null;
  }
}

async function fetchBluelytics(): Promise<{ compra: number; venta: number } | null> {
  try {
    const res = await fetch("https://api.bluelytics.com.ar/v2/latest", {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const compra = Number(data.oficial?.value_buy);
    const venta = Number(data.oficial?.value_sell);
    if (isNaN(compra) || isNaN(venta) || compra <= 0 || venta <= 0) return null;
    return { compra, venta };
  } catch {
    return null;
  }
}

async function lookupDb(supabase: any, tipoDb: string, fecha: string) {
  const { data } = await supabase
    .from("cotizaciones_dolar")
    .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
    .eq("tipo", tipoDb)
    .eq("fecha", fecha)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function lookupLatest(supabase: any, tipoDb: string, targetFecha: string) {
  const { data } = await supabase
    .from("cotizaciones_dolar")
    .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
    .eq("tipo", tipoDb)
    .lte("fecha", targetFecha)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function buildResponse(row: any, modalidad: string, tipoDb: string, cached: boolean, stale = false) {
  return NextResponse.json({
    fecha: row.fecha,
    modalidad,
    tipo: tipoDb,
    valor_compra: Number(row.valor_compra),
    valor_venta: Number(row.valor_venta),
    fuente: row.fuente,
    es_manual: row.es_manual,
    cached,
    ...(stale ? { stale: true } : {}),
  });
}

async function upsertCotiz(supabase: any, fecha: string, tipoDb: string, compra: number, venta: number, fuente: string) {
  const { error } = await (supabase as any)
    .from("cotizaciones_dolar")
    .upsert(
      { fecha, tipo: tipoDb, valor_compra: compra, valor_venta: venta, fuente, es_manual: false },
      { onConflict: "fecha,tipo" }
    );
  if (error) console.warn("No se pudo guardar la cotización verificada:", error.message);
}

export async function GET(req: NextRequest) {
  const modalidad = (req.nextUrl.searchParams.get("modalidad") || "divisas") as "divisas" | "billetes";
  const fechaParam = req.nextUrl.searchParams.get("fecha");
  const forceRefresh = req.nextUrl.searchParams.get("force") === "1";
  const tipoDb = modalidad === "billetes" ? "oficial_billetes" : "oficial_divisas";
  const supabase = await createSupabaseServer();

  const hoy = todayAR();
  const targetFecha = fechaParam || previousBusinessDay(hoy);
  const validFecha = /^\d{4}-\d{2}-\d{2}$/.test(targetFecha)
    && Number.isFinite(Date.parse(`${targetFecha}T12:00:00Z`))
    && new Date(`${targetFecha}T12:00:00Z`).toISOString().slice(0, 10) === targetFecha;
  if (!["divisas", "billetes"].includes(modalidad) || !validFecha || targetFecha > hoy) {
    return NextResponse.json({ error: "Modalidad o fecha de cotización inválida." }, { status: 400 });
  }

  // -- Buscar en DB primero (skip si force) --
  if (!forceRefresh) {
    const cached = await lookupDb(supabase as any, tipoDb, targetFecha);
    if (isTrustedBnaCache(cached)) return buildResponse(cached, modalidad, tipoDb, true);
  }

  // -- BNA Cotizador (distingue divisas vs billetes) --
  const bna = await scrapeBna(modalidad, targetFecha);
  if (bna) {
    const fechaReal = bna.fecha;
    // Nunca etiquetar como histórica una cotización que BNA devolvió para otro día.
    if (fechaReal && fechaReal <= targetFecha) {
      const existing = await lookupDb(supabase as any, tipoDb, fechaReal);
      if (!existing?.es_manual) await upsertCotiz(supabase as any, fechaReal, tipoDb, bna.compra, bna.venta, BNA_VERIFIED_SOURCE);
      return buildResponse(
        { fecha: fechaReal, valor_compra: bna.compra, valor_venta: bna.venta, fuente: BNA_VERIFIED_SOURCE, es_manual: false },
        modalidad, tipoDb, false, fechaReal !== targetFecha
      );
    }
  }

  // -- Fallback: DolarAPI / Bluelytics (solo para fecha actual, no distinguen divisas/billetes) --
  if (targetFecha === hoy && modalidad === "billetes") {
    let fuente = "dolarapi";
    let fallback = await fetchDolarApi();
    if (!fallback) { fallback = await fetchBluelytics(); fuente = "bluelytics"; }
    if (fallback) {
      await upsertCotiz(supabase as any, targetFecha, tipoDb, fallback.compra, fallback.venta, fuente);
      return buildResponse(
        { fecha: targetFecha, valor_compra: fallback.compra, valor_venta: fallback.venta, fuente, es_manual: false },
        modalidad, tipoDb, false
      );
    }
  }

  // -- Último valor en DB (stale) --
  const ultimo = await lookupLatest(supabase as any, tipoDb, targetFecha);
  if (isTrustedBnaCache(ultimo)) return buildResponse(ultimo, modalidad, tipoDb, true, true);

  return NextResponse.json(
    { error: "No se pudo obtener la cotización del dólar. Ingresela manualmente." },
    { status: 503 }
  );
}
