import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/cron/cotizacion
 * Cron diario (18:00 ART / 21:00 UTC) — guarda cotización oficial del día.
 * Fuentes: DolarAPI.com (principal) → Bluelytics (fallback).
 * Protegido por CRON_SECRET en producción.
 */

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

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });
  const results: { tipo: string; ok: boolean; fuente?: string; error?: string }[] = [];

  // Intentar DolarAPI primero, luego Bluelytics
  let fuente = "dolarapi_cron";
  let scraped = await fetchDolarApi();
  if (!scraped) {
    scraped = await fetchBluelytics();
    fuente = "bluelytics_cron";
  }

  if (!scraped) {
    return NextResponse.json({ error: "No se pudo obtener cotización de ninguna fuente", fecha: today }, { status: 502 });
  }

  const supabase = await createSupabaseServer();

  for (const tipoDb of ["oficial_divisas", "oficial_billetes"]) {
    const { error } = await (supabase as any)
      .from("cotizaciones_dolar")
      .upsert(
        {
          fecha: today,
          tipo: tipoDb,
          valor_compra: scraped.compra,
          valor_venta: scraped.venta,
          fuente: fuente || "dolarapi_cron",
          es_manual: false,
        },
        { onConflict: "fecha,tipo" }
      );
    results.push({ tipo: tipoDb, ok: !error, fuente: fuente || "dolarapi_cron", error: error?.message });
  }

  return NextResponse.json({ fecha: today, compra: scraped.compra, venta: scraped.venta, results });
}
