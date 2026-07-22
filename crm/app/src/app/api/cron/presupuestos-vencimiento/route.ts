import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/cron/presupuestos-vencimiento
 *
 * Cron diario — revisa presupuestos activos y genera alertas de seguimiento:
 *   - A los 10 dias de creado: alerta "seguimiento" para consultar al cliente
 *   - A los 20 dias de creado: alerta urgente "seguimiento"
 *   - Al superar fecha de vencimiento: marca estado = "vencido" + alerta "vencimiento_pr"
 *
 * Protegido por CRON_SECRET en produccion.
 */

function getSupabase() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Tipos de alerta de seguimiento por dias transcurridos
const SEGUIMIENTO_DIAS = [
  { dias: 10, tag: "seguimiento_10d", title: "Seguimiento PR", urgencia: "normal" },
  { dias: 20, tag: "seguimiento_20d", title: "Seguimiento urgente PR", urgencia: "urgente" },
] as const;

export async function GET(req: NextRequest) {
  // Verificar CRON_SECRET en produccion
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  const stats = {
    presupuestos_revisados: 0,
    alertas_seguimiento_creadas: 0,
    presupuestos_vencidos: 0,
    errores: [] as string[],
  };

  try {
    // 1) Buscar PRs con estado pendiente, aprobado, solicitud o postergado
    const { data: presupuestos, error: prError } = await supabase
      .from("presupuestos")
      .select("id, numero, fecha, vencimiento, estado, vendedor_id, sociedad_id, cliente_id")
      .in("estado", ["pendiente", "aprobado", "solicitud", "postergado"]);

    if (prError) {
      return NextResponse.json({ error: `Error al buscar presupuestos: ${prError.message}` }, { status: 500 });
    }

    if (!presupuestos || presupuestos.length === 0) {
      return NextResponse.json({ ...stats, message: "Sin presupuestos activos" });
    }

    stats.presupuestos_revisados = presupuestos.length;

    // 2) Buscar alertas existentes para evitar duplicados
    const prIds = presupuestos.map((pr) => pr.id);
    const { data: alertasExistentes } = await (supabase as any)
      .from("alertas")
      .select("id, title, entity_id")
      .eq("entity_type", "presupuesto")
      .in("entity_id", prIds);

    // Set de dedup: "title|entity_id" para no crear la misma alerta dos veces
    const alertaSet = new Set<string>(
      (alertasExistentes ?? []).map((a: any) => {
        // Extraer el prefijo del title hasta ":" para dedup generico
        const titleKey = (a.title ?? "").split(":")[0].trim();
        return `${titleKey}|${a.entity_id}`;
      })
    );

    const alertasAInsertar: any[] = [];
    const prIdsAVencer: string[] = [];

    for (const pr of presupuestos) {
      const fechaCreacion = new Date(pr.fecha + "T00:00:00");
      const fechaVencimiento = new Date(pr.vencimiento + "T23:59:59");
      const diasDesdeCreacion = Math.floor((now.getTime() - fechaCreacion.getTime()) / 86400000);
      const vencido = now > fechaVencimiento;

      // Determinar user_id para la alerta (vendedor o created_by)
      const userId = pr.vendedor_id || null;

      // A) Alertas de seguimiento a los 10 y 20 dias
      for (const seg of SEGUIMIENTO_DIAS) {
        if (diasDesdeCreacion >= seg.dias && !vencido) {
          const dedupKey = `${seg.title}|${pr.id}`;
          if (!alertaSet.has(dedupKey)) {
            const desc = seg.urgencia === "urgente"
              ? `Hace ${diasDesdeCreacion} dias que se creo. Consultar al cliente antes de que venza.`
              : `Pasaron ${diasDesdeCreacion} dias desde la creacion. Consultar al cliente.`;

            alertasAInsertar.push({
              tipo: "seguimiento",
              title: `${seg.title}: ${pr.numero}`,
              description: desc,
              entity_id: pr.id,
              entity_type: "presupuesto",
              module: "presupuestos",
              user_id: userId,
              sociedad_id: pr.sociedad_id,
              read: false,
            });
            alertaSet.add(dedupKey);
          }
        }
      }

      // B) Vencimiento: cambiar estado y crear alerta
      if (vencido && pr.estado !== "aprobado") {
        // Solo vencer si no esta aprobado (un PR aprobado no se vence automaticamente)
        prIdsAVencer.push(pr.id);

        const dedupKey = `PR vencido|${pr.id}`;
        if (!alertaSet.has(dedupKey)) {
          alertasAInsertar.push({
            tipo: "vencimiento_pr",
            title: `PR vencido: ${pr.numero}`,
            description: `El presupuesto ${pr.numero} ha superado su fecha de vencimiento.`,
            entity_id: pr.id,
            entity_type: "presupuesto",
            module: "presupuestos",
            user_id: userId,
            sociedad_id: pr.sociedad_id,
            read: false,
          });
          alertaSet.add(dedupKey);
        }
      }
    }

    // 3) Insertar alertas
    if (alertasAInsertar.length > 0) {
      const { error: insertError } = await (supabase as any)
        .from("alertas")
        .insert(alertasAInsertar);

      if (insertError) {
        stats.errores.push(`Error insertando alertas: ${insertError.message}`);
      } else {
        stats.alertas_seguimiento_creadas = alertasAInsertar.length;
      }
    }

    // 4) Marcar PRs como vencidos
    if (prIdsAVencer.length > 0) {
      const { error: updateError } = await supabase
        .from("presupuestos")
        .update({ estado: "vencido" } as any)
        .in("id", prIdsAVencer);

      if (updateError) {
        stats.errores.push(`Error marcando vencidos: ${updateError.message}`);
      } else {
        stats.presupuestos_vencidos = prIdsAVencer.length;
      }
    }

    return NextResponse.json({ fecha: today, ...stats });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error inesperado: ${err.message}`, ...stats },
      { status: 500 }
    );
  }
}
