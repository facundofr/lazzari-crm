import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/cron/cotizacion
 * Cron diario (18:00 ART / 21:00 UTC) — guarda cotización BNA divisas + billetes del día.
 * Fuente: BNA Cotizador AJAX (principal) → DolarAPI (fallback).
 * Protegido por CRON_SECRET en producción.
 */

const parse = (s: string) => {
  if (s.includes(",")) return parseFloat(s.replace(/\./g, "").replace(",", "."));
  return parseFloat(s);
};

const toddmmyyyy = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
};

async function scrapeBna(
  modalidad: "divisas" | "billetes",
  fechaIso: string
): Promise<{ compra: number; venta: number } | null> {
  const idMoneda = modalidad === "billetes" ? "22" : "55";
  const fechaDdMm = toddmmyyyy(fechaIso);
  try {
    const url = `https://www.bna.com.ar/Cotizador/HistoricoPrincipales?id=${modalidad}&fecha=${encodeURIComponent(fechaDdMm)}&idMoneda=${idMoneda}`;
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
    const rowMatch = html.match(
      /Dolar\s+U\.S\.A<\/td>\s*<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>/i
    );
    if (!rowMatch) return null;
    const compra = parse(rowMatch[1]);
    const venta = parse(rowMatch[2]);
    if (isNaN(compra) || isNaN(venta) || compra <= 0 || venta <= 0) return null;
    return { compra, venta };
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
  const supabase = await createSupabaseServer();

  for (const modalidad of ["divisas", "billetes"] as const) {
    const tipoDb = modalidad === "billetes" ? "oficial_billetes" : "oficial_divisas";

    // BNA primero (distingue divisas/billetes)
    let scraped = await scrapeBna(modalidad, today);
    let fuente = "BNA_cron";

    // Fallback: DolarAPI (no distingue pero mejor que nada)
    if (!scraped) {
      scraped = await fetchDolarApi();
      fuente = "dolarapi_cron";
    }

    if (!scraped) {
      results.push({ tipo: tipoDb, ok: false, error: "Sin datos" });
      continue;
    }

    const { error } = await (supabase as any)
      .from("cotizaciones_dolar")
      .upsert(
        {
          fecha: today,
          tipo: tipoDb,
          valor_compra: scraped.compra,
          valor_venta: scraped.venta,
          fuente,
          es_manual: false,
        },
        { onConflict: "fecha,tipo" }
      );
    results.push({ tipo: tipoDb, ok: !error, fuente, error: error?.message });
  }

  return NextResponse.json({ fecha: today, results });
}
