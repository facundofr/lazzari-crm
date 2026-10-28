import { NextRequest, NextResponse } from "next/server";

/**
 * Chequeo único de los crons (auditoría integral 28/10/2026, H36). Falla CERRADO: si en Vercel falta
 * CRON_SECRET o el pedido no trae esa clave, responde 401 y el cron no hace nada.
 * Antes tres crons (agente-mail, bcra, presupuestos-vencimiento) corrían para cualquiera si faltaba la variable.
 * Devuelve null cuando el pedido está autorizado.
 */
export function cronNoAutorizado(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
