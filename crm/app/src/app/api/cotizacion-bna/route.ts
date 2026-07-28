import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/cotizacion-bna?modalidad=divisas|billetes&fecha=YYYY-MM-DD
 *
 * Fuentes (en orden de prioridad):
 *   1. Cache en DB (cotizaciones_dolar)
 *   2. DolarAPI.com (API pública, datos BNA oficiales)
 *   3. Bluelytics (fallback)
 *   4. Último valor en DB (stale)
 */

const todayAR = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });

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

async function fetchBluelyticsHistorical(fecha: string): Promise<{ compra: number; venta: number } | null> {
  try {
    const res = await fetch("https://api.bluelytics.com.ar/v2/evolution.json?days=30", {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data: Array<{ date: string; source: string; value_sell: number; value_buy: number }> = await res.json();
    const match = data.find((d) => d.date === fecha && d.source === "Oficial");
    if (!match) return null;
    const compra = Number(match.value_buy);
    const venta = Number(match.value_sell);
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

async function lookupLatest(supabase: any, tipoDb: string) {
  const { data } = await supabase
    .from("cotizaciones_dolar")
    .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
    .eq("tipo", tipoDb)
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

export async function GET(req: NextRequest) {
  const modalidad = (req.nextUrl.searchParams.get("modalidad") || "divisas") as "divisas" | "billetes";
  const fechaParam = req.nextUrl.searchParams.get("fecha");
  const tipoDb = modalidad === "billetes" ? "oficial_billetes" : "oficial_divisas";
  const supabase = await createSupabaseServer();

  const hoy = todayAR();

  // -- Fecha específica (no hoy) -> solo DB + Bluelytics histórico --
  if (fechaParam && fechaParam !== hoy) {
    const cached = await lookupDb(supabase as any, tipoDb, fechaParam);
    if (cached) return buildResponse(cached, modalidad, tipoDb, true);

    // Intentar Bluelytics histórico
    const hist = await fetchBluelyticsHistorical(fechaParam);
    if (hist) {
      await (supabase as any)
        .from("cotizaciones_dolar")
        .upsert(
          { fecha: fechaParam, tipo: tipoDb, valor_compra: hist.compra, valor_venta: hist.venta, fuente: "bluelytics_hist", es_manual: false },
          { onConflict: "fecha,tipo" }
        );
      return buildResponse(
        { fecha: fechaParam, valor_compra: hist.compra, valor_venta: hist.venta, fuente: "bluelytics_hist", es_manual: false },
        modalidad, tipoDb, false
      );
    }

    return NextResponse.json(
      { error: `No hay cotización guardada para ${fechaParam}` },
      { status: 404 }
    );
  }

  // -- Hoy (o sin fecha) -> DB cache, luego APIs --
  const targetFecha = fechaParam || hoy;
  const cached = await lookupDb(supabase as any, tipoDb, targetFecha);
  if (cached) return buildResponse(cached, modalidad, tipoDb, true);

  // DolarAPI (principal)
  const dolarApi = await fetchDolarApi();
  if (dolarApi) {
    await (supabase as any)
      .from("cotizaciones_dolar")
      .upsert(
        { fecha: targetFecha, tipo: tipoDb, valor_compra: dolarApi.compra, valor_venta: dolarApi.venta, fuente: "dolarapi", es_manual: false },
        { onConflict: "fecha,tipo" }
      );
    return buildResponse(
      { fecha: targetFecha, valor_compra: dolarApi.compra, valor_venta: dolarApi.venta, fuente: "dolarapi", es_manual: false },
      modalidad, tipoDb, false
    );
  }

  // Bluelytics (fallback)
  const bluelytics = await fetchBluelytics();
  if (bluelytics) {
    await (supabase as any)
      .from("cotizaciones_dolar")
      .upsert(
        { fecha: targetFecha, tipo: tipoDb, valor_compra: bluelytics.compra, valor_venta: bluelytics.venta, fuente: "bluelytics", es_manual: false },
        { onConflict: "fecha,tipo" }
      );
    return buildResponse(
      { fecha: targetFecha, valor_compra: bluelytics.compra, valor_venta: bluelytics.venta, fuente: "bluelytics", es_manual: false },
      modalidad, tipoDb, false
    );
  }

  // Fallback: último valor en DB
  const ultimo = await lookupLatest(supabase as any, tipoDb);
  if (ultimo) return buildResponse(ultimo, modalidad, tipoDb, true, true);

  return NextResponse.json(
    { error: "No se pudo obtener la cotización del dólar. Ingresela manualmente." },
    { status: 503 }
  );
}
