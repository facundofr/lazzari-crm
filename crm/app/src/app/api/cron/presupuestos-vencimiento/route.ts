import { NextRequest, NextResponse } from "next/server";
import { cronNoAutorizado } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { avisoSeguimientoQueToca } from "@/lib/presupuesto-seguimiento";

/**
 * GET /api/cron/presupuestos-vencimiento
 *
 * Cron diario — revisa presupuestos activos y genera alertas de seguimiento
 * basadas en dias sin respuesta desde la fecha de envio/creacion:
 *   - 3 dias sin respuesta: alerta suave
 *   - 5 dias sin respuesta: alerta de atencion
 *   - 7 dias sin respuesta: alerta urgente
 *   (solo el último paso alcanzado; los aprobados no reciben seguimiento: el cliente ya respondió)
 *   - Al superar fecha de vencimiento: marca estado = "vencido" + alerta "vencimiento_pr"
 *     (no a los aprobados ni a los que tienen remito vigente: ya se entregaron)
 * Además (Finanzas): avisa 3 días antes del débito de cada cheque propio que cubre un tercero
 * (echeqs.cubre_tercero, ej. Martín Fernández), para avisarle a tiempo.
 *
 * Protegido por CRON_SECRET en produccion.
 */

// Solo con la clave de servicio (el GET corta antes si falta). Ya no cae a la clave anónima.
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Avisos de cheques que cubre un tercero: uno por cheque, cuando faltan 3 días o menos. Nunca rompe el cron. */
async function avisarChequesTercero(supabase: ReturnType<typeof getSupabase>, today: string): Promise<{ creadas: number; error?: string }> {
  try {
    const hasta = new Date(`${today}T12:00:00Z`);
    hasta.setUTCDate(hasta.getUTCDate() + 3);
    const { data: cheques, error } = await (supabase as any)
      .from("echeqs")
      .select("id, numero, monto, fecha_pago, cubre_tercero, sociedad_id")
      .not("cubre_tercero", "is", null)
      .in("estado", ["pendiente", "entregado"])
      .gte("fecha_pago", today)
      .lte("fecha_pago", hasta.toISOString().slice(0, 10));
    if (error) return { creadas: 0, error: error.message };
    if (!cheques?.length) return { creadas: 0 };
    const { data: existentes } = await (supabase as any)
      .from("alertas").select("entity_id").eq("entity_type", "echeq_tercero").in("entity_id", cheques.map((c: any) => c.id));
    const ya = new Set((existentes ?? []).map((a: any) => a.entity_id));
    const filas = cheques.filter((c: any) => !ya.has(c.id)).map((c: any) => {
      const [y, m, d] = String(c.fecha_pago).slice(0, 10).split("-");
      const monto = Number(c.monto || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return {
        tipo: "seguimiento",
        title: `Avisale a ${c.cubre_tercero}: cheque ${c.numero}`,
        description: `El ${d}/${m}/${y} se debita el cheque ${c.numero} por $${monto}, que cubre ${c.cubre_tercero}.`,
        entity_id: c.id,
        entity_type: "echeq_tercero",
        module: "finanzas",
        user_id: null,
        sociedad_id: c.sociedad_id,
        read: false,
      };
    });
    if (!filas.length) return { creadas: 0 };
    const { error: insError } = await (supabase as any).from("alertas").insert(filas);
    return insError ? { creadas: 0, error: insError.message } : { creadas: filas.length };
  } catch (err: any) {
    return { creadas: 0, error: err?.message || String(err) };
  }
}

export async function GET(req: NextRequest) {
  const noAutorizado = cronNoAutorizado(req);
  if (noAutorizado) return noAutorizado;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  const supabase = getSupabase();
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  const stats = {
    presupuestos_revisados: 0,
    alertas_seguimiento_creadas: 0,
    presupuestos_vencidos: 0,
    alertas_cheques_tercero: 0,
    errores: [] as string[],
  };

  const chequesTercero = await avisarChequesTercero(supabase, today);
  stats.alertas_cheques_tercero = chequesTercero.creadas;
  if (chequesTercero.error) stats.errores.push(`Cheques de terceros: ${chequesTercero.error}`);

  try {
    // 1) Buscar PRs con estado pendiente, aprobado, solicitud o postergado
    const { data: presupuestos, error: prError } = await supabase
      .from("presupuestos")
      .select("id, numero, fecha, vencimiento, estado, vendedor_id, sociedad_id, cliente_id")
      .in("estado", ["pendiente", "aprobado", "solicitud", "postergado"])
      // Los de la Papelera no avisan ni se vencen
      .or("eliminado.is.null,eliminado.eq.false");

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

    // PR con remito vigente (no anulado): ya se entregó, no se vence (sigue en Facturar como entregado sin facturar).
    // Si no se pueden leer los remitos, ese día no se vence ninguno.
    const { data: remitos, error: remError } = await (supabase as any)
      .from("remitos")
      .select("presupuesto_id")
      .in("presupuesto_id", prIds)
      .or("anulado.is.null,anulado.eq.false");
    if (remError) stats.errores.push(`Remitos: ${remError.message} (hoy no se vence ningún PR)`);
    const conRemito = new Set<string>((remitos ?? []).map((r: any) => String(r.presupuesto_id)));

    const alertasAInsertar: any[] = [];
    const prIdsAVencer: string[] = [];

    for (const pr of presupuestos) {
      const fechaCreacion = new Date(pr.fecha + "T00:00:00");
      const fechaVencimiento = new Date(pr.vencimiento + "T23:59:59");
      const diasDesdeCreacion = Math.floor((now.getTime() - fechaCreacion.getTime()) / 86400000);
      const vencido = now > fechaVencimiento;

      // Determinar user_id para la alerta (vendedor o created_by)
      const userId = pr.vendedor_id || null;

      // A) Alertas de seguimiento a los 3, 5 y 7 dias (no a los aprobados: el cliente ya respondió)
      if (!vencido && pr.estado !== "aprobado") {
        const yaSalieron = new Set<string>();
        for (const k of alertaSet) if (k.endsWith(`|${pr.id}`)) yaSalieron.add(k.slice(0, -(pr.id.length + 1)));
        const seg = avisoSeguimientoQueToca(diasDesdeCreacion, yaSalieron);
        if (seg) {
          const desc = seg.urgente
            ? `${diasDesdeCreacion} dias sin respuesta. Consultar al cliente con urgencia.`
            : `${diasDesdeCreacion} dias sin respuesta. Hacer seguimiento con el cliente.`;

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
          alertaSet.add(`${seg.title}|${pr.id}`);
        }
      }

      // B) Vencimiento: cambiar estado y crear alerta
      if (vencido && pr.estado !== "aprobado" && !remError && !conRemito.has(String(pr.id))) {
        // Solo vencer si no esta aprobado ni tiene remito (esos no se vencen automaticamente)
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
