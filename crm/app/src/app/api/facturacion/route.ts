import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Lazy-import arca-facturacion (ESM module)
let Arca: any;
let CbteTipo: any;
let IvaTipo: any;
let DocTipo: any;

async function loadArca() {
  if (!Arca) {
    const mod = await import("@ramiidv/arca-facturacion");
    Arca = mod.Arca;
    CbteTipo = mod.CbteTipo;
    IvaTipo = mod.IvaTipo;
    DocTipo = mod.DocTipo;
  }
}

// Map our DB tipo codes to ARCA CbteTipo enum values
// ARCA codes: 1=FA, 6=FB, 11=FC, 3=NCA, 8=NCB, 13=NCC, 2=NDA, 7=NDB, 12=NDC
const CBTE_TIPO_MAP: Record<string, number> = {
  FA: 1, FB: 6, FC: 11,
  NCA: 3, NCB: 8, NCC: 13,
  NDA: 2, NDB: 7, NDC: 12,
};

// Map condicion_iva to ARCA DocTipo
// FA requires CUIT (80), FB accepts DNI (96) or consumidor final (99)
const DOC_TIPO_MAP: Record<string, number> = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  "Consumidor Final": 99,
};

function getArcaInstance() {
  const certPath = process.env.ARCA_CERT_PATH || path.join(process.cwd(), "..", "certs", "lazzari.crt");
  const keyPath = process.env.ARCA_KEY_PATH || path.join(process.cwd(), "..", "certs", "lazzari.key");

  const cert = process.env.ARCA_CERT || (fs.existsSync(certPath) ? fs.readFileSync(certPath, "utf-8") : "");
  const key = process.env.ARCA_KEY || (fs.existsSync(keyPath) ? fs.readFileSync(keyPath, "utf-8") : "");

  if (!cert || !key) {
    throw new Error("Certificado ARCA no configurado. Subi el certificado .crt a crm/certs/ o configura ARCA_CERT y ARCA_KEY en variables de entorno.");
  }

  const cuit = Number(process.env.ARCA_CUIT || "20379309128");
  const production = process.env.ARCA_PRODUCTION === "true";

  return new Arca({ cuit, cert, key, production });
}

// Supabase admin client for server-side operations
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// POST /api/facturacion — Emitir factura via ARCA
export async function POST(req: NextRequest) {
  try {
    await loadArca();

    const body = await req.json();
    const {
      tipo,           // "FA" | "FB" | "FC" | "NCA" | "NCB" | "NCC"
      cliente_id,     // UUID
      punto_venta,    // number (ej: 1)
      items,          // [{ descripcion, cantidad, precio_unitario, iva_porcentaje }]
      presupuesto_id, // optional UUID
    } = body;

    // Validate required fields
    if (!tipo || !cliente_id || !punto_venta || !items?.length) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: tipo, cliente_id, punto_venta, items" },
        { status: 400 }
      );
    }

    const cbteTipo = CBTE_TIPO_MAP[tipo];
    if (!cbteTipo) {
      return NextResponse.json({ error: `Tipo de comprobante no valido: ${tipo}` }, { status: 400 });
    }

    // Fetch client data from Supabase
    const supabase = getSupabase();
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select("razon_social, cuit, condicion_iva")
      .eq("id", cliente_id)
      .single();

    if (clienteError || !cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Determine document type based on comprobante type
    let docTipo: number;
    let docNro: string;

    if (tipo.endsWith("A")) {
      // Factura A: requires CUIT
      if (!cliente.cuit) {
        return NextResponse.json({ error: "El cliente necesita CUIT para Factura A" }, { status: 400 });
      }
      docTipo = 80; // CUIT
      docNro = cliente.cuit.replace(/-/g, "");
    } else if (tipo.endsWith("B")) {
      // Factura B: CUIT, DNI, or Consumidor Final
      if (cliente.cuit) {
        docTipo = 80;
        docNro = cliente.cuit.replace(/-/g, "");
      } else {
        docTipo = 99; // Consumidor Final
        docNro = "0";
      }
    } else {
      // Factura C
      docTipo = 99;
      docNro = "0";
    }

    // Build ARCA items — group by IVA rate
    const arcaItems = items.map((item: any) => {
      const neto = Number(item.cantidad) * Number(item.precio_unitario);
      const ivaPct = Number(item.iva_porcentaje || 21);
      // Map percentage to ARCA IvaTipo enum
      let ivaId: number;
      if (ivaPct === 0) ivaId = 3;       // 0%
      else if (ivaPct === 10.5) ivaId = 4; // 10.5%
      else if (ivaPct === 21) ivaId = 5;   // 21%
      else if (ivaPct === 27) ivaId = 6;   // 27%
      else ivaId = 5; // default 21%

      return { neto, iva: ivaId };
    });

    // Call ARCA
    const arca = getArcaInstance();
    const result = await arca.facturar({
      ptoVta: punto_venta,
      cbteTipo,
      docTipo,
      docNro,
      items: arcaItems,
    });

    // Calculate totals from result
    const subtotal = result.importes?.neto ?? items.reduce((a: number, it: any) => a + Number(it.cantidad) * Number(it.precio_unitario), 0);
    const iva = result.importes?.iva ?? Math.round(subtotal * 0.21 * 100) / 100;
    const total = result.importes?.total ?? subtotal + iva;

    // Save to database
    const { data: factura, error: insertError } = await supabase
      .from("facturas")
      .insert({
        tipo,
        punto_venta,
        numero: result.cbteNro,
        cliente_id,
        presupuesto_id: presupuesto_id || null,
        fecha: new Date().toISOString().slice(0, 10),
        cae: result.cae,
        cae_vencimiento: result.caeFchVto,
        subtotal,
        iva,
        total,
        estado: "emitida",
      } as any)
      .select()
      .single();

    if (insertError) {
      // The invoice was authorized by ARCA but we failed to save it locally
      // Return the ARCA data so the user doesn't lose it
      return NextResponse.json({
        warning: "Factura autorizada por ARCA pero hubo un error al guardar localmente. Guardar los datos manualmente.",
        arca: {
          cae: result.cae,
          caeFchVto: result.caeFchVto,
          cbteNro: result.cbteNro,
          importes: result.importes,
        },
        error: insertError.message,
      }, { status: 207 });
    }

    return NextResponse.json({
      success: true,
      factura: {
        id: factura.id,
        numero: result.cbteNro,
        cae: result.cae,
        cae_vencimiento: result.caeFchVto,
        total,
        comprobante: `${tipo} ${String(punto_venta).padStart(4, "0")}-${String(result.cbteNro).padStart(8, "0")}`,
      },
    });
  } catch (err: unknown) {
    console.error("Error emitiendo factura ARCA:", err);
    const message = err instanceof Error ? err.message : "Error desconocido al emitir factura";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/facturacion?action=status — Check ARCA connection status
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");

  if (action === "status") {
    try {
      await loadArca();
      const arca = getArcaInstance();
      // Try to get last authorized voucher number to verify connection
      const lastVoucher = await arca.ultimoComprobante({
        ptoVta: Number(process.env.ARCA_PTO_VTA || 1),
        cbteTipo: 1, // Factura A
      });
      return NextResponse.json({
        connected: true,
        production: process.env.ARCA_PRODUCTION === "true",
        lastVoucher: lastVoucher,
        cuit: process.env.ARCA_CUIT || "20379309128",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error de conexion";
      return NextResponse.json({
        connected: false,
        error: message,
      });
    }
  }

  return NextResponse.json({ error: "Accion no valida" }, { status: 400 });
}
