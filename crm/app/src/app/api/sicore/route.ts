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
import { detalleRetencion, diferenciasConHoy, pagosAnteriores, type AvisosSicore, type PagoDelMes } from "@/lib/certificado-retencion";
import { RETENCION_DEFAULT } from "@/lib/plan-pagos";
import { traerTodo } from "@/lib/paginar";

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
    .select("id, numero, fecha, created_at, monto_bruto, base_retencion_ganancias, retencion_ganancias_pct, retencion_ganancias_monto, proveedor_id, moneda")
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
    .select("id, fecha, created_at, monto, base_retencion_ganancias, retencion_ganancias_pct, retencion_ganancias_monto, proveedor_id, moneda, descripcion, anulado")
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
    .select("id, cuit, razon_social, condicion_iva, concepto_retencion_ganancias, alicuota_ganancias")
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
    id: string;
    created_at: string;
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
      id: mov.id,
      created_at: mov.created_at,
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

  if (searchParams.get("formato") === "json") {
    try {
      return NextResponse.json({ filas, avisos: await controlSicore(supabase, sociedadId, desde, hasta, sources, provMap) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo controlar el período" }, { status: 500 });
    }
  }

  const content = lines.length ? lines.join("\r\n") + "\r\n" : ""; // cada línea termina en CRLF, como el archivo del contador
  const filename = `SICORE_${desde}_${hasta}.txt`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Control antes de bajar el TXT (auditoría UX 26/10/2026, arreglo 13). Solo avisa: el TXT sale igual.
 * - Proveedores sin concepto de Ganancias: van como régimen 78 (bienes).
 * - Retenciones calculadas con un % o un mínimo que no es el del concepto que el proveedor tiene hoy, que es con el
 *   que las manda el TXT (caso OP-000049: se retuvo como bienes y hoy el proveedor está en transporte).
 */
async function controlSicore(
  supabase: any, sociedadId: string, desde: string, hasta: string,
  sources: Array<{ id: string; created_at: string; fecha: string; numero?: string | null; descripcion?: string | null; proveedor_id: string; monto_bruto: number; base_retencion_ganancias: number; retencion_ganancias_pct: number; retencion_ganancias_monto: number }>,
  provMap: Map<string, { razon_social?: string | null; cuit?: string | null; concepto_retencion_ganancias?: string | null; alicuota_ganancias?: number | null }>,
): Promise<AvisosSicore> {
  // Los pagos del mes que cada OP sumó al acumulado (lib/certificado-retencion.ts): OP no anuladas y pagos directos de una factura.
  const provIds = [...new Set(sources.map((s) => s.proveedor_id))];
  const mesDesde = `${desde.slice(0, 7)}-01`;
  const [year, month] = hasta.slice(0, 7).split("-").map(Number);
  const mesHasta = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const [opsMes, directosMes, cfg] = await Promise.all([
    traerTodo<any>(() => supabase.from("ordenes_pago").select("id, proveedor_id, fecha, created_at, base_retencion_ganancias, retencion_ganancias_monto")
      .eq("sociedad_id", sociedadId).in("proveedor_id", provIds).neq("estado", "anulada").gte("fecha", mesDesde).lt("fecha", mesHasta).order("id")),
    traerTodo<any>(() => supabase.from("movimientos").select("id, proveedor_id, fecha, created_at, base_retencion_ganancias, retencion_ganancias_monto, anulado")
      .eq("sociedad_id", sociedadId).in("proveedor_id", provIds).eq("tipo", "pago").not("factura_compra_id", "is", null).is("nota_credito_compra_id", null)
      .gte("fecha", mesDesde).lt("fecha", mesHasta).order("id")),
    supabase.from("retencion_config").select("minimo_ganancias, tasa_ganancias_ri").eq("sociedad_id", sociedadId).maybeSingle(),
  ]);
  if (cfg.error) throw cfg.error;
  const pago = (x: any): PagoDelMes => ({
    id: x.id, proveedor_id: x.proveedor_id, fecha: String(x.fecha).slice(0, 10), creado: x.created_at,
    base: Number(x.base_retencion_ganancias || 0), retenido: Number(x.retencion_ganancias_monto || 0),
  });
  const delMes = [...opsMes, ...directosMes.filter((m: any) => !m.anulado)].map(pago);
  const minimoBienes = Number(cfg.data?.minimo_ganancias ?? RETENCION_DEFAULT.minimo_ganancias);
  const tasaSociedad = Number(cfg.data?.tasa_ganancias_ri ?? RETENCION_DEFAULT.tasa_ganancias_ri);

  const sinConcepto = new Map<string, AvisosSicore["sinConcepto"][number]>();
  const distintos: AvisosSicore["distintos"] = [];
  for (const s of sources) {
    const prov = provMap.get(s.proveedor_id);
    if (!prov?.cuit) continue;
    const d = detalleRetencion({
      concepto: prov.concepto_retencion_ganancias, alicuotaProveedor: prov.alicuota_ganancias, minimoBienes, tasaSociedad,
      bruto: s.monto_bruto, base: Number(s.base_retencion_ganancias || 0), pct: Number(s.retencion_ganancias_pct || 0),
      retenido: Number(s.retencion_ganancias_monto || 0), anteriores: pagosAnteriores(pago(s), delMes),
    });
    if (d.sinConcepto) {
      const x = sinConcepto.get(s.proveedor_id) || { proveedor: prov.razon_social || "", retenciones: 0, retenido: 0 };
      x.retenciones += 1;
      x.retenido = Math.round((x.retenido + d.retenido) * 100) / 100;
      sinConcepto.set(s.proveedor_id, x);
    }
    const dif = diferenciasConHoy(d);
    if (dif.pct || dif.minimo) distintos.push({
      comprobante: s.numero || s.descripcion || "Pago directo", fecha: String(s.fecha).slice(0, 10), proveedor: prov.razon_social || "",
      regimen: d.regimen, pct: d.pct, pctHoy: d.pctHoy, minimo: d.minimo, minimoHoy: d.minimoHoy, difPct: dif.pct, difMinimo: dif.minimo,
    });
  }
  return { sinConcepto: [...sinConcepto.values()].sort((a, b) => a.proveedor.localeCompare(b.proveedor)), distintos };
}
