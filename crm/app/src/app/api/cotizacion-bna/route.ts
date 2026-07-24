import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/cotizacion-bna?modalidad=divisas|billetes&fecha=YYYY-MM-DD
 *
 * Lógica simplificada:
 *   - Con fecha (o sin fecha para día anterior): busca en DB directamente
 *   - Sin fecha y es HOY: scrape BNA → guarda en DB → retorna
 *   - Fallback: último valor en DB
 */

const todayAR = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });

const yesterdayHabil = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Buenos_Aires" }));
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

async function scrapeBna(modalidad: "divisas" | "billetes"): Promise<{ compra: number; venta: number } | null> {
  try {
    const res = await fetch("https://www.bna.com.ar/Personas", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LazzariCRM/1.0)" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return parseBnaHtml(await res.text(), modalidad);
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
  const isToday = fechaParam === hoy;
  const targetFecha = fechaParam || yesterdayHabil();

  // ── Fecha específica (no hoy) → solo DB ──
  if (fechaParam && !isToday) {
    const cached = await lookupDb(supabase as any, tipoDb, fechaParam);
    if (cached) return buildResponse(cached, modalidad, tipoDb, true);
    return NextResponse.json(
      { error: `No hay cotización guardada para ${fechaParam}` },
      { status: 404 }
    );
  }

  // ── Hoy o sin fecha → intentar DB primero ──
  const cached = await lookupDb(supabase as any, tipoDb, targetFecha);
  if (cached) return buildResponse(cached, modalidad, tipoDb, true);

  // ── No hay en DB → scrape BNA (solo para hoy/ayer) ──
  const scraped = await scrapeBna(modalidad);
  if (scraped) {
    await (supabase as any)
      .from("cotizaciones_dolar")
      .upsert(
        {
          fecha: targetFecha,
          tipo: tipoDb,
          valor_compra: scraped.compra,
          valor_venta: scraped.venta,
          fuente: "BNA",
          es_manual: false,
        },
        { onConflict: "fecha,tipo" }
      );
    return buildResponse(
      { fecha: targetFecha, valor_compra: scraped.compra, valor_venta: scraped.venta, fuente: "BNA", es_manual: false },
      modalidad, tipoDb, false
    );
  }

  // ── Fallback: último valor en DB ──
  const ultimo = await lookupLatest(supabase as any, tipoDb);
  if (ultimo) return buildResponse(ultimo, modalidad, tipoDb, true, true);

  return NextResponse.json(
    { error: "No se pudo obtener la cotización del dólar. Ingresela manualmente." },
    { status: 503 }
  );
}
