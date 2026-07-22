import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/cotizacion-bna?modalidad=divisas|billetes
 * Devuelve la cotización oficial del dólar (BNA).
 * modalidad=divisas (default) — Cotización Divisas (usada para operaciones de comercio exterior)
 * modalidad=billetes — Cotización Billetes (dinero en efectivo)
 *
 * Lógica:
 *   1. Busca el valor de hoy en cotizaciones_dolar (cache DB)
 *   2. Si no está, scrape BNA → luego intenta Bluelytics como backup (solo divisas)
 *   3. Guarda en DB para futuros pedidos del día
 *   4. Si todo falla, retorna el valor más reciente guardado en DB
 */

// Cierre del día hábil anterior
const YESTERDAY = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  if (d.getDay() === 0) d.setDate(d.getDate() - 2);
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
};

const parse = (s: string) => {
  if (s.includes(",")) return parseFloat(s.replace(/\./g, "").replace(",", "."));
  return parseFloat(s);
};

function parseBnaHtml(html: string, modalidad: "divisas" | "billetes"): { compra: number; venta: number } | null {
  // Extraer la sección correcta por id
  const sectionMatch = html.match(new RegExp(`id="${modalidad}"[\\s\\S]*?(?=id="|$)`, "i"));
  const section = sectionMatch ? sectionMatch[0] : html;

  const match = section.match(
    /Dolar\s+U\.S\.A[\s\S]*?<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>/i
  );
  if (!match) return null;

  const compra = parse(match[1]);
  const venta = parse(match[2]);
  if (isNaN(compra) || isNaN(venta) || compra <= 0 || venta <= 0) return null;
  return { compra, venta };
}

async function scrapeBna(modalidad: "divisas" | "billetes"): Promise<{ compra: number; venta: number; fuente: string } | null> {
  try {
    const res = await fetch("https://www.bna.com.ar/Personas", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LazzariCRM/1.0)" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const parsed = parseBnaHtml(html, modalidad);
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

export async function GET(req: NextRequest) {
  const modalidad = (req.nextUrl.searchParams.get("modalidad") || "divisas") as "divisas" | "billetes";
  const fechaParam = req.nextUrl.searchParams.get("fecha"); // YYYY-MM-DD opcional
  // tipo en DB: "oficial_divisas" o "oficial_billetes"
  const tipoDb = modalidad === "billetes" ? "oficial_billetes" : "oficial_divisas";

  const supabase = await createSupabaseServer();
  const today = fechaParam || YESTERDAY();

  // Si se pidió una fecha específica, solo buscar en DB (no scrapear)
  if (fechaParam) {
    const { data: cached } = await (supabase as any)
      .from("cotizaciones_dolar")
      .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
      .eq("tipo", tipoDb)
      .eq("fecha", fechaParam)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      return NextResponse.json({
        fecha: cached.fecha,
        modalidad,
        tipo: tipoDb,
        valor_compra: Number(cached.valor_compra),
        valor_venta: Number(cached.valor_venta),
        fuente: cached.fuente,
        es_manual: cached.es_manual,
        cached: true,
      });
    }
    return NextResponse.json(
      { error: `No hay cotización guardada para ${fechaParam}. Puede cargarla manualmente.` },
      { status: 404 }
    );
  }

  // 1. Buscar en DB el valor del día hábil anterior
  const { data: cached } = await (supabase as any)
    .from("cotizaciones_dolar")
    .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
    .eq("tipo", tipoDb)
    .eq("fecha", today)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return NextResponse.json({
      fecha: cached.fecha,
      modalidad,
      tipo: tipoDb,
      valor_compra: Number(cached.valor_compra),
      valor_venta: Number(cached.valor_venta),
      fuente: cached.fuente,
      es_manual: cached.es_manual,
      cached: true,
    });
  }

  // 2. Scrape BNA
  let scraped = await scrapeBna(modalidad);

  // Fallback Bluelytics (no distingue divisas/billetes, pero sirve como aproximación)
  if (!scraped) {
    scraped = await fetchBluelytics();
  }

  if (scraped) {
    // 3. Guardar en DB (best-effort, upsert por fecha+tipo)
    await (supabase as any)
      .from("cotizaciones_dolar")
      .upsert(
        {
          fecha: today,
          tipo: tipoDb,
          valor_compra: scraped.compra,
          valor_venta: scraped.venta,
          fuente: scraped.fuente,
          es_manual: false,
        },
        { onConflict: "fecha,tipo" }
      );

    return NextResponse.json({
      fecha: today,
      modalidad,
      tipo: tipoDb,
      valor_compra: scraped.compra,
      valor_venta: scraped.venta,
      fuente: scraped.fuente,
      es_manual: false,
      cached: false,
    });
  }

  // 4. Fallback: último valor guardado en DB para este tipo
  const { data: ultimo } = await (supabase as any)
    .from("cotizaciones_dolar")
    .select("fecha, tipo, valor_compra, valor_venta, fuente, es_manual")
    .eq("tipo", tipoDb)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ultimo) {
    return NextResponse.json({
      fecha: ultimo.fecha,
      modalidad,
      tipo: tipoDb,
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
