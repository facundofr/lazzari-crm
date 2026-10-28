import { NextRequest, NextResponse } from "next/server";
import { cronNoAutorizado } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { parseBnaHistorical, BNA_VERIFIED_SOURCE } from "@/lib/bna-historical";
import { esDiaHabil } from "@/lib/dias-habiles";

/**
 * GET /api/cron/cotizacion
 * Cron (lun a vie 11:00 y 18:00 ART / 14:00 y 21:00 UTC) — guarda la cotización BNA divisas + billetes.
 * A la mañana deja el valor de apertura (y completa el cierre anterior si faltaba); a las 18 el cierre del día.
 * - Exige CRON_SECRET (sin la clave configurada o con otra clave responde 401).
 * - Escribe con la clave de servicio (el cron no tiene sesión de usuario), como el cron del BCRA.
 * - Lo leído del BNA se graba con la fuente verificada (BNA_VERIFIED_SOURCE), la misma que
 *   /api/cotizacion-bna acepta como cache confiable, y con la fecha real que publicó el BNA.
 * - Nunca pisa una cotización cargada a mano (es_manual = true).
 * - DolarAPI no distingue divisas de billetes: solo se usa de respaldo para billetes del día
 *   y nunca pisa un valor verificado del BNA.
 * - Si falla una escritura responde 500, para que se vea en los logs de Vercel.
 */

const toddmmyyyy = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
};

async function scrapeBna(
  modalidad: "divisas" | "billetes",
  fechaIso: string
): Promise<{ compra: number; venta: number; fecha: string } | null> {
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
    // Mismo parser que /api/cotizacion-bna: toma la fila con la fecha real publicada (<= hoy).
    return parseBnaHistorical(await res.text(), fechaIso);
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

type Resultado = { tipo: string; ok: boolean; fecha?: string; fuente?: string; omitida?: string; error?: string };

export async function GET(req: NextRequest) {
  const noAutorizado = cronNoAutorizado(req);
  if (noAutorizado) return noAutorizado;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) as any;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });
  const results: Resultado[] = [];
  let erroresEscritura = 0;

  for (const modalidad of ["divisas", "billetes"] as const) {
    const tipoDb = modalidad === "billetes" ? "oficial_billetes" : "oficial_divisas";

    let fila: { fecha: string; compra: number; venta: number; fuente: string; verificada: boolean } | null = null;
    const bna = await scrapeBna(modalidad, today);
    if (bna) {
      fila = { fecha: bna.fecha, compra: bna.compra, venta: bna.venta, fuente: BNA_VERIFIED_SOURCE, verificada: true };
    } else if (modalidad === "billetes" && esDiaHabil(today)) {
      // En feriados y fines de semana no hay cotización del día: DolarAPI repetiría la anterior con fecha de hoy.
      const api = await fetchDolarApi();
      if (api) fila = { fecha: today, compra: api.compra, venta: api.venta, fuente: "dolarapi_cron", verificada: false };
    }
    if (!fila) {
      results.push({ tipo: tipoDb, ok: false, error: "Sin datos del BNA" });
      continue;
    }

    const { data: existente, error: errorLectura } = await db
      .from("cotizaciones_dolar")
      .select("es_manual, fuente")
      .eq("fecha", fila.fecha)
      .eq("tipo", tipoDb)
      .limit(1)
      .maybeSingle();
    if (errorLectura) {
      erroresEscritura++;
      results.push({ tipo: tipoDb, ok: false, fecha: fila.fecha, error: errorLectura.message });
      continue;
    }
    if (existente?.es_manual) {
      results.push({ tipo: tipoDb, ok: true, fecha: fila.fecha, omitida: "cargada a mano: no se pisa" });
      continue;
    }
    if (!fila.verificada && existente?.fuente === BNA_VERIFIED_SOURCE) {
      results.push({ tipo: tipoDb, ok: true, fecha: fila.fecha, omitida: "ya está la del BNA" });
      continue;
    }

    const { error } = await db
      .from("cotizaciones_dolar")
      .upsert(
        {
          fecha: fila.fecha,
          tipo: tipoDb,
          valor_compra: fila.compra,
          valor_venta: fila.venta,
          fuente: fila.fuente,
          es_manual: false,
        },
        { onConflict: "fecha,tipo" }
      );
    if (error) erroresEscritura++;
    results.push({ tipo: tipoDb, ok: !error, fecha: fila.fecha, fuente: fila.fuente, error: error?.message });
  }

  const status = erroresEscritura > 0 ? 500 : results.some(r => r.ok) ? 200 : 502;
  return NextResponse.json({ fecha: today, results }, { status });
}
