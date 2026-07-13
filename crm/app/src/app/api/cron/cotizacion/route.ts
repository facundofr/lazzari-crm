import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/cron/cotizacion
 * Cron diario (18:00 ART / 21:00 UTC) — guarda cotización BNA divisas + billetes del día.
 * Protegido por CRON_SECRET en producción.
 */

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

export async function GET(req: NextRequest) {
  // Verificar CRON_SECRET en producción
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const results: { modalidad: string; ok: boolean; error?: string }[] = [];

  let html: string;
  try {
    const res = await fetch("https://www.bna.com.ar/Personas", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LazzariCRM/1.0)" },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "BNA no respondió", status: res.status }, { status: 502 });
    }
    html = await res.text();
  } catch (e: any) {
    return NextResponse.json({ error: `Error al conectar con BNA: ${e.message}` }, { status: 502 });
  }

  const supabase = await createSupabaseServer();

  for (const modalidad of ["divisas", "billetes"] as const) {
    const tipoDb = modalidad === "billetes" ? "oficial_billetes" : "oficial_divisas";
    const parsed = parseBnaHtml(html, modalidad);

    if (!parsed) {
      results.push({ modalidad, ok: false, error: "No se pudo parsear" });
      continue;
    }

    const { error } = await (supabase as any)
      .from("cotizaciones_dolar")
      .upsert(
        {
          fecha: today,
          tipo: tipoDb,
          valor_compra: parsed.compra,
          valor_venta: parsed.venta,
          fuente: "BNA_cron",
          es_manual: false,
        },
        { onConflict: "fecha,tipo" }
      );

    results.push({ modalidad, ok: !error, error: error?.message });
  }

  return NextResponse.json({ fecha: today, results });
}
