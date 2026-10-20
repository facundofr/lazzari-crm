/**
 * GET /api/sicore?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&sociedad_id=UUID
 *
 * Genera archivo TXT en formato SICORE para presentar retenciones ante ARCA.
 * Formato: "Estándar Retenciones Versión 9.0" del aplicativo SICORE (198 caracteres por registro, ver lib/sicore-linea.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";
import { armarLineaSicore, regimenSicore } from "@/lib/sicore-linea";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  const sociedadId = searchParams.get("sociedad_id");

  if (!desde || !hasta || !sociedadId) {
    return NextResponse.json({ error: "Parámetros requeridos: desde, hasta, sociedad_id" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return NextResponse.json({ error: "Las fechas deben tener formato YYYY-MM-DD" }, { status: 400 });
  }
  if (desde > hasta) {
    return NextResponse.json({ error: "La fecha desde no puede ser posterior a la fecha hasta" }, { status: 400 });
  }

  // Seguridad (A9a): este archivo trae CUIT y retenciones, y la consulta usa la
  // clave de servicio. Antes de leer nada se verifica la sesión del usuario, su
  // rol y que pertenezca a la sociedad pedida (mismo criterio que /api/facturacion
  // y las funciones seguras de la base).
  const bearer = req.headers.get("authorization");
  const authSupabase = bearer
    ? createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: bearer } } })
    : await createSupabaseServer();
  const { data: { user }, error: authError } = await authSupabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida. Volvé a ingresar al CRM." }, { status: 401 });
  }
  const { data: perfil, error: perfilError } = await (authSupabase as any)
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (perfilError || !perfil || !["super_admin", "admin", "administrativo"].includes(String(perfil.role))) {
    return NextResponse.json({ error: "No tenés permiso para descargar el archivo SICORE." }, { status: 403 });
  }
  const { data: membresia, error: membresiaError } = await (authSupabase as any)
    .from("user_sociedades").select("sociedad_id").eq("user_id", user.id).eq("sociedad_id", sociedadId).maybeSingle();
  if (membresiaError || !membresia) {
    return NextResponse.json({ error: "No tenés acceso a la sociedad seleccionada." }, { status: 403 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch OPs with retención ganancias in the period.
  const { data: ops, error } = await supabase
    .from("ordenes_pago")
    .select("id, numero, fecha, monto_bruto, base_retencion_ganancias, retencion_ganancias_pct, retencion_ganancias_monto, proveedor_id, moneda")
    .eq("sociedad_id", sociedadId)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .gt("retencion_ganancias_monto", 0)
    .neq("estado", "anulada")
    .order("fecha");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Los pagos parciales directos no tienen OP, pero registran la retención
  // en movimientos. También deben formar parte de la presentación mensual.
  const { data: directMovements, error: directError } = await supabase
    .from("movimientos")
    .select("id, fecha, monto, base_retencion_ganancias, retencion_ganancias_pct, retencion_ganancias_monto, proveedor_id, moneda, descripcion, anulado")
    .eq("sociedad_id", sociedadId)
    .eq("tipo", "pago")
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .gt("retencion_ganancias_monto", 0)
    .neq("anulado", true)
    .order("fecha");

  if (directError) {
    return NextResponse.json({ error: directError.message }, { status: 500 });
  }

  if ((!ops || ops.length === 0) && (!directMovements || directMovements.length === 0)) {
    return NextResponse.json({ error: "No hay retenciones en el período seleccionado" }, { status: 404 });
  }

  // Fetch proveedores for CUIT
  const provIds = [...new Set([
    ...(ops || []).map(op => op.proveedor_id),
    ...(directMovements || []).map(mov => mov.proveedor_id),
  ].filter(Boolean))];
  const { data: provs } = await supabase
    .from("proveedores")
    .select("id, cuit, razon_social, condicion_iva, concepto_retencion_ganancias")
    .in("id", provIds)
    .eq("sociedad_id", sociedadId);

  const provMap = new Map((provs || []).map(p => [p.id, p]));

  // No omitir silenciosamente una retención: un archivo SICORE incompleto es
  // peor que un error visible que permita corregir el proveedor/CUIT antes de
  // presentarlo.
  const missingCuit = [...new Set([
    ...(ops || []).map(op => op.proveedor_id),
    ...(directMovements || []).map(mov => mov.proveedor_id),
  ].filter((id): id is string => !!id && !provMap.get(id)?.cuit))];
  if (missingCuit.length > 0) {
    return NextResponse.json({
      error: "No se puede generar SICORE: hay retenciones con proveedor sin CUIT",
      proveedor_ids: missingCuit,
    }, { status: 422 });
  }

  // Build SICORE lines
  // Format per RG 2233: fixed-width text
  const lines: string[] = [];

  type SicoreSource = {
    fecha: string;
    numero?: string | null;
    monto_bruto: number;
    base_retencion_ganancias: number;
    retencion_ganancias_pct: number;
    retencion_ganancias_monto: number;
    proveedor_id: string;
    descripcion?: string | null;
  };
  const sources: SicoreSource[] = [
    ...(ops || []).map((op) => ({ ...op, monto_bruto: Number(op.monto_bruto || 0) })),
    ...(directMovements || []).map((mov) => ({
      fecha: mov.fecha,
      numero: null,
      monto_bruto: Number(mov.monto || 0) + Number(mov.retencion_ganancias_monto || 0),
      base_retencion_ganancias: Number(mov.base_retencion_ganancias || 0),
      retencion_ganancias_pct: Number(mov.retencion_ganancias_pct || 0),
      retencion_ganancias_monto: Number(mov.retencion_ganancias_monto || 0),
      proveedor_id: mov.proveedor_id,
      descripcion: mov.descripcion,
    })),
  ];

  // Los mismos renglones del TXT, para el Excel de Finanzas Lazza (formato=json).
  const filas: Array<{ fecha: string; comprobante: string; proveedor: string; cuit: string; regimen: string; importe: number; base: number; pct: number; retencion: number }> = [];

  for (const op of sources) {
    const prov = provMap.get(op.proveedor_id);
    if (!prov?.cuit) continue;

    const line = armarLineaSicore({
      fecha: op.fecha,
      numeroComprobante: op.numero || op.descripcion || "",
      importeComprobante: op.monto_bruto,
      conceptoRetencion: prov.concepto_retencion_ganancias,
      baseCalculo: op.base_retencion_ganancias || 0,
      importeRetencion: op.retencion_ganancias_monto,
      cuit: prov.cuit,
    });

    lines.push(line);
    filas.push({
      fecha: String(op.fecha).slice(0, 10),
      comprobante: op.numero || op.descripcion || "Pago directo",
      proveedor: prov.razon_social || "",
      cuit: String(prov.cuit).replace(/\D/g, ""),
      regimen: regimenSicore(prov.concepto_retencion_ganancias),
      importe: Number(op.monto_bruto || 0),
      base: Number(op.base_retencion_ganancias || 0),
      pct: Number(op.retencion_ganancias_pct || 0),
      retencion: Number(op.retencion_ganancias_monto || 0),
    });
  }

  if (searchParams.get("formato") === "json") return NextResponse.json({ filas });

  const content = lines.length ? lines.join("\r\n") + "\r\n" : ""; // cada línea termina en CRLF, como el archivo del contador
  const filename = `SICORE_${desde}_${hasta}.txt`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
