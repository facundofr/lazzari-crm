import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cuitLimpio, mesActual } from "@/lib/bcra";
import { actualizarInformeCliente } from "@/lib/bcra-server";

/**
 * GET /api/cron/bcra — corre todos los días a la mañana.
 * Cada mes consulta la Central de Deudores de todos los clientes activos con CUIT.
 * Procesa de a tandas (los que todavía no tienen informe del mes) hasta agotar el tiempo;
 * al día siguiente sigue con los que falten. Cuando todos están al día, no hace nada.
 * Protegido por CRON_SECRET. Necesita SUPABASE_SERVICE_ROLE_KEY en Vercel.
 */
export const maxDuration = 60;
const PRESUPUESTO_MS = 50_000;
const EN_PARALELO = 3;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY) as any;
  const inicio = Date.now();
  const mes = mesActual();

  const { data: clientes, error } = await db.from("clientes").select("id, cuit, razon_social, sociedad_id").eq("activo", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: hechos } = await db.from("cliente_bcra_informes").select("cliente_id, semaforo").eq("mes", mes);
  const listos = new Set((hechos || []).filter((h: any) => h.semaforo !== "gris").map((h: any) => h.cliente_id));

  const pendientes = (clientes || [])
    .map((c: any) => ({ ...c, cuit: cuitLimpio(c.cuit) }))
    .filter((c: any) => c.cuit && c.sociedad_id && !listos.has(c.id));

  const stats = { mes, pendientes: pendientes.length, consultados: 0, empeoraron: 0, errores: 0 };
  let i = 0;
  async function trabajador() {
    while (i < pendientes.length && Date.now() - inicio < PRESUPUESTO_MS) {
      const c = pendientes[i++];
      try {
        const r = await actualizarInformeCliente(db, { sociedad_id: c.sociedad_id, cliente_id: c.id, cuit: c.cuit, razon_social: c.razon_social });
        stats.consultados++;
        if (r.semaforo === "gris") stats.errores++;
        if (r.empeoro) stats.empeoraron++;
      } catch {
        stats.errores++;
      }
      await new Promise(res => setTimeout(res, 250)); // no saturar al BCRA
    }
  }
  await Promise.all(Array.from({ length: EN_PARALELO }, trabajador));
  return NextResponse.json({ ...stats, faltan: Math.max(0, pendientes.length - i) });
}
