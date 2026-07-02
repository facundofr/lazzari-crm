import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/cotizacion-bna
 * Devuelve la cotización oficial del dólar (BNA).
 * Lógica:
 *   1. Busca el valor de hoy en cotizaciones_dolar (cache DB)
 *   2. Si no está, scrape BNA → luego intenta Bluelytics como backup
 *   3. Guarda en DB para futuros pedidos del día
 *   4. Si todo falla, retorna el valor más reciente guardado en DB
 */

const TODAY = () => new Date().toISOString().split("T")[0];

function parseBnaHtml(html: string): { compra: number; venta: number } | null {
  // Extraer específicamente la sección id="divisas" (Cotización Divisas, no Billetes)
  const divisasMatch = html.match(/id="divisas"[\s\S]*?(?=id="|$)/i);
  const section = divisasMatch ? divisasMatch[0] : html;

  const match = section.match(
    /Dolar\s+U\.S\.A[\s\S]*?<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>/i
  );
  if (!match) return null;

  // Divisas usa punto como decimal (1488.0000); Billetes usa coma (1510,00)
  const parse = (s: string) => {
    if (s.includes(",")) return parseFloat(s.replace(/\./g, "").replace(",", "."));
    return parseFloat(s);
  };
  const compra = parse(match[1]);
  const venta = parse(match[2]);
  if (isNaN(compra) || isNaN(venta) || compra <= 0 || venta <= 0) return null;
  return { compra, venta };
}

async function scrapeBna(): Promise<{ compra: number; venta: number; fuente: string } | null> {
  try {
    const res = await fetch("https://www.bna.com.ar/Personas", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LazzariCRM/1.0)" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const parsed = parseBnaHtml(html);
    if (!parsed) return null;
    return { ...parsed, fuente: "BNA" };
  } catch {
    return null;
  }
}

async function fetchBluelytics(): Promise<{ compra: number; venta: number; fuente: string } | null> {
  try {
    const res = await fetch("https://api.bluelytics.com.ar/v2/latest", {
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const compra = data?.oficial?.value_buy;
    const venta = data?.oficial?.value_sell;
    if (!compra || !venta) return null;
    return { compra, venta, fuente: "bluelytics" };
  } catch {
    return null;
  }
}

export async function GET() {
  const supabase = await createSupabaseServer();
  const today = TODAY();

  // 1. Buscar en DB el valor de hoy
  const { data: cached } = await (supabase as any)
    .from("cotizaciones_dolar")
    .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
    .eq("tipo", "oficial")
    .eq("fecha", today)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return NextResponse.json({
      fecha: cached.fecha,
      tipo: "oficial",
      valor_compra: Number(cached.valor_compra),
      valor_venta: Number(cached.valor_venta),
      fuente: cached.fuente,
      es_manual: cached.es_manual,
      cached: true,
    });
  }

  // 2. Intentar scrape BNA → fallback Bluelytics
  const scraped = (await scrapeBna()) ?? (await fetchBluelytics());

  if (scraped) {
    // 3. Guardar en DB (best-effort)
    await (supabase as any)
      .from("cotizaciones_dolar")
      .upsert(
        {
          fecha: today,
          tipo: "oficial",
          valor_compra: scraped.compra,
          valor_venta: scraped.venta,
          fuente: scraped.fuente,
          es_manual: false,
        },
        { onConflict: "fecha,tipo" }
      );

    return NextResponse.json({
      fecha: today,
      tipo: "oficial",
      valor_compra: scraped.compra,
      valor_venta: scraped.venta,
      fuente: scraped.fuente,
      es_manual: false,
      cached: false,
    });
  }

  // 4. Fallback: último valor guardado en DB (cualquier día)
  const { data: ultimo } = await (supabase as any)
    .from("cotizaciones_dolar")
    .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
    .eq("tipo", "oficial")
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ultimo) {
    return NextResponse.json({
      fecha: ultimo.fecha,
      tipo: "oficial",
      valor_compra: Number(ultimo.valor_compra),
      valor_venta: Number(ultimo.valor_venta),
      fuente: ultimo.fuente,
      es_manual: ultimo.es_manual,
      cached: true,
      stale: true,
    });
  }

  return NextResponse.json(
    { error: "No se pudo obtener la cotización del dólar. Ingresela manualmente." },
    { status: 503 }
  );
}
