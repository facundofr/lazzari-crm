/**
 * GET /api/sicore?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&sociedad_id=UUID
 *
 * Genera archivo TXT en formato SICORE para presentar retenciones ante ARCA.
 * Formato: registros de longitud fija según RG 2233 (SICORE).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Código de comprobante SICORE
const CBTE_SICORE: Record<string, string> = {
  "FA": "01", "FB": "06", "FC": "11",
  "NCA": "03", "NCB": "08", "NCC": "13",
  "NDA": "02", "NDB": "07", "NDC": "12",
  "FCEA": "201", "FCEB": "206",
};

// Códigos de régimen vigentes para los conceptos RG 830 que se pueden
// asignar a proveedores en el CRM. El código 078 solo corresponde a
// compraventa de bienes; no debe usarse para servicios u otros conceptos.
const REGIMEN_RG830: Record<string, string> = {
  compraventa_bienes: "078",
  servicios: "094",
  honorarios: "116",
  alquileres_inmuebles: "027",
  alquileres_muebles: "027",
  intereses_financieros: "019",
  intereses_otros: "021",
  transporte: "078",
  fletes: "078",
  comisiones: "025",
  publicidad: "094",
  seguros: "094",
};

function pad(s: string, len: number, char = " ", right = false): string {
  if (right) return s.slice(0, len).padEnd(len, char);
  return s.slice(0, len).padStart(len, char);
}

function fmtMonto(n: number, len: number): string {
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split(".");
  return pad(parts[0], len - 3, "0") + "," + parts[1];
}

function fmtDate(dateStr: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

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

  for (const op of sources) {
    const prov = provMap.get(op.proveedor_id);
    if (!prov?.cuit) continue;

    const cuit = prov.cuit.replace(/[-\s]/g, "");
    const fecha = fmtDate(op.fecha);

    // SICORE line fields (simplified format):
    // Código comprobante (2) + Fecha (10) + Nro comprobante (16) +
    // Importe comprobante (16) + Código impuesto (3) + Código régimen (3) +
    // Código operación (1) + Base cálculo (14) + Fecha emisión ret (10) +
    // Código condición (2) + Retención practicada sujeto no inscripto (1) +
    // Importe retención (14) + Porcentaje exclusión (6) +
    // Fecha emisión boletín (10) + Tipo documento retenido (2) +
    // Nro documento retenido (11) + Nro certificado original (14) +
    // Denominación o razón social (30)

    const codComprobante = "06"; // Orden de pago
    const nroComprobante = pad((op.numero || op.descripcion || "PAGO DIRECTO").replace(/[^0-9]/g, ""), 16, "0");
    const importeComprobante = fmtMonto(op.monto_bruto, 16);
    const codImpuesto = "217"; // Ganancias
    const codRegimen = REGIMEN_RG830[prov.concepto_retencion_ganancias || "compraventa_bienes"] || "078";
    const codOperacion = "1"; // Retención
    const baseCalculo = fmtMonto(op.base_retencion_ganancias || 0, 14);
    const fechaEmision = fecha;
    const codCondicion = "01"; // Inscripto
    const noInscripto = "0";
    const importeRetencion = fmtMonto(op.retencion_ganancias_monto, 14);
    const pctExclusion = pad("0,00", 6, " ");
    const fechaBoletin = pad("", 10, " ");
    const tipoDoc = "80"; // CUIT
    const nroDoc = pad(cuit, 11, "0");
    const nroCert = pad("", 14, " ");
    const razonSocial = pad(prov.razon_social.substring(0, 30), 30, " ", true);

    const line = [
      codComprobante, fecha, nroComprobante, importeComprobante,
      codImpuesto, codRegimen, codOperacion, baseCalculo,
      fechaEmision, codCondicion, noInscripto, importeRetencion,
      pctExclusion, fechaBoletin, tipoDoc, nroDoc, nroCert, razonSocial,
    ].join("");

    lines.push(line);
  }

  const content = lines.join("\r\n");
  const filename = `SICORE_${desde}_${hasta}.txt`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
