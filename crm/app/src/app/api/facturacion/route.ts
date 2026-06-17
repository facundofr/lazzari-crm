import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Lazy-import arca-facturacion (ESM module)
let Arca: any;

async function loadArca() {
  if (!Arca) {
    const mod = await import("@ramiidv/arca-facturacion");
    Arca = mod.Arca;
  }
}

// Map our DB tipo codes to ARCA CbteTipo enum values
const CBTE_TIPO_MAP: Record<string, number> = {
  FA: 1, FB: 6,
  NCA: 3, NCB: 8,
  NDA: 2, NDB: 7,
};

// Default punto de venta (active ones: 8, 9, 10, 12)
const DEFAULT_PTO_VTA = 15;

function getArcaInstance() {
  const certPath = process.env.ARCA_CERT_PATH || path.join(process.cwd(), "..", "certs", "lazzari.crt");
  const keyPath = process.env.ARCA_KEY_PATH || path.join(process.cwd(), "..", "certs", "lazzari.key");

  const cert = process.env.ARCA_CERT || (fs.existsSync(certPath) ? fs.readFileSync(certPath, "utf-8") : "");
  const key = process.env.ARCA_KEY || (fs.existsSync(keyPath) ? fs.readFileSync(keyPath, "utf-8") : "");

  if (!cert || !key) {
    throw new Error("Certificado ARCA no configurado. Subi el certificado .crt a crm/certs/ o configura ARCA_CERT y ARCA_KEY en variables de entorno.");
  }

  const cuit = Number(process.env.ARCA_CUIT || "20379309128");
  // Certificate is from production ARCA — always use production
  const production = process.env.ARCA_PRODUCTION !== "false";

  return new Arca({ cuit, cert, key, production });
}

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
      punto_venta,    // number (ej: 10)
      items,          // [{ descripcion, cantidad, precio_unitario, iva_porcentaje }]
      presupuesto_id, // optional UUID
    } = body;

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

    const supabase = getSupabase();

    // Determine document type and client data
    let docTipo: number;
    let docNro: string;
    let cliente: { razon_social: string; cuit: string; condicion_iva?: string } | null = null;

    if (cliente_id === "consumidor_final") {
      // Consumidor Final — only for FB/NCB
      if (tipo.endsWith("A")) {
        return NextResponse.json({ error: "Factura A requiere un cliente con CUIT" }, { status: 400 });
      }
      docTipo = 99;
      docNro = "0";
      cliente = { razon_social: "Consumidor Final", cuit: "" };
    } else {
      const { data, error: clienteError } = await supabase
        .from("clientes")
        .select("razon_social, cuit, condicion_iva")
        .eq("id", cliente_id)
        .single();

      if (clienteError || !data) {
        return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
      }
      cliente = data;

      if (tipo.endsWith("A")) {
        if (!cliente.cuit) {
          return NextResponse.json({ error: "El cliente necesita CUIT para Factura A" }, { status: 400 });
        }
        docTipo = 80;
        docNro = cliente.cuit.replace(/-/g, "");
      } else if (tipo.endsWith("B")) {
        if (cliente.cuit) {
          docTipo = 80;
          docNro = cliente.cuit.replace(/-/g, "");
        } else {
          docTipo = 99;
          docNro = "0";
        }
      } else {
        return NextResponse.json({ error: `Tipo de comprobante no soportado: ${tipo}` }, { status: 400 });
      }
    }

    // Calculate totals per IVA rate
    const isFacturaA = tipo.endsWith("A");
    const ivaGroups: Record<number, { baseImp: number; importe: number }> = {};
    let totalNeto = 0;
    let totalIva = 0;

    for (const item of items) {
      let neto: number;
      let ivaPct: number;
      let ivaImporte: number;

      if (isFacturaA) {
        // FA/NCA: precio es neto, IVA se calcula aparte
        neto = Number(item.cantidad) * Number(item.precio_unitario);
        ivaPct = Number(item.iva_porcentaje || 21);
        ivaImporte = Math.round(neto * ivaPct / 100 * 100) / 100;
      } else {
        // FB/NCB: precio es final (IVA 21% incluido)
        const totalItem = Number(item.cantidad) * Number(item.precio_unitario);
        ivaPct = 21;
        neto = Math.round(totalItem / 1.21 * 100) / 100;
        ivaImporte = Math.round((totalItem - neto) * 100) / 100;
      }

      let ivaId: number;
      if (ivaPct === 0) ivaId = 3;
      else if (ivaPct === 10.5) ivaId = 4;
      else if (ivaPct === 21) ivaId = 5;
      else if (ivaPct === 27) ivaId = 6;
      else ivaId = 5;

      totalNeto += neto;
      totalIva += ivaImporte;

      if (!ivaGroups[ivaId]) {
        ivaGroups[ivaId] = { baseImp: 0, importe: 0 };
      }
      ivaGroups[ivaId].baseImp += neto;
      ivaGroups[ivaId].importe += ivaImporte;
    }

    totalNeto = Math.round(totalNeto * 100) / 100;
    totalIva = Math.round(totalIva * 100) / 100;
    const totalFinal = Math.round((totalNeto + totalIva) * 100) / 100;

    // Build ARCA invoice using crearFacturaAuto (handles cbteNro automatically)
    const arca = getArcaInstance();
    const ptoVta = Number(punto_venta);

    const ivaArray = Object.entries(ivaGroups).map(([id, vals]) => ({
      Id: Number(id),
      BaseImp: Math.round(vals.baseImp * 100) / 100,
      Importe: Math.round(vals.importe * 100) / 100,
    }));

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const result = await arca.crearFacturaAuto(ptoVta, cbteTipo, {
      Concepto: 1, // Productos
      DocTipo: docTipo,
      DocNro: Number(docNro),
      CbteFch: today,
      ImpTotal: totalFinal,
      ImpTotConc: 0,
      ImpNeto: totalNeto,
      ImpOpEx: 0,
      ImpTrib: 0,
      ImpIVA: totalIva,
      MonId: "PES",
      MonCotiz: 1,
      Iva: ivaArray,
    });

    // Extract CAE from response
    const det = result?.FeDetResp?.FECAEDetResponse;
    const detArray = Array.isArray(det) ? det : det ? [det] : [];
    const firstDet = detArray[0];

    if (!firstDet || firstDet.Resultado !== "A") {
      const obs = firstDet?.Observaciones?.Obs;
      const obsArray = Array.isArray(obs) ? obs : obs ? [obs] : [];
      const obsMsg = obsArray.map((o: any) => `[${o.Code}] ${o.Msg}`).join(", ");
      return NextResponse.json({
        error: `ARCA rechazó el comprobante: ${obsMsg || "Error desconocido"}`,
      }, { status: 422 });
    }

    const cae = String(firstDet.CAE);
    const caeFchVto = String(firstDet.CAEFchVto);
    const cbteNro = Number(firstDet.CbteDesde);

    // Save to database
    const { data: factura, error: insertError } = await supabase
      .from("facturas")
      .insert({
        tipo,
        punto_venta: ptoVta,
        numero: cbteNro,
        cliente_id: cliente_id === "consumidor_final" ? null : cliente_id,
        presupuesto_id: presupuesto_id || null,
        fecha: new Date().toISOString().slice(0, 10),
        cae,
        cae_vencimiento: caeFchVto,
        subtotal: totalNeto,
        iva: totalIva,
        total: totalFinal,
        estado: "emitida",
      } as any)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({
        warning: "Factura autorizada por ARCA pero hubo un error al guardar localmente.",
        arca: { cae, caeFchVto, cbteNro, total: totalFinal },
        error: insertError.message,
      }, { status: 207 });
    }

    return NextResponse.json({
      success: true,
      factura: {
        id: factura.id,
        numero: cbteNro,
        cae,
        cae_vencimiento: caeFchVto,
        total: totalFinal,
        comprobante: `${tipo} ${String(ptoVta).padStart(4, "0")}-${String(cbteNro).padStart(8, "0")}`,
      },
    });
  } catch (err: unknown) {
    console.error("Error emitiendo factura ARCA:", err);
    const message = err instanceof Error ? err.message : "Error desconocido al emitir factura";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/facturacion — Check status or list puntos de venta
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");

  if (action === "status") {
    try {
      await loadArca();
      const arca = getArcaInstance();
      const ptoVta = Number(process.env.ARCA_PTO_VTA || DEFAULT_PTO_VTA);
      const lastVoucher = await arca.ultimoComprobante(ptoVta, 1);
      return NextResponse.json({
        connected: true,
        production: true,
        lastVoucher,
        ptoVta,
        cuit: process.env.ARCA_CUIT || "20379309128",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error de conexion";
      return NextResponse.json({ connected: false, error: message });
    }
  }

  if (action === "puntos-venta") {
    try {
      await loadArca();
      const arca = getArcaInstance();
      const auth = await arca.getAuth();
      const puntos = await arca.wsfe.getPuntosVenta(auth);
      // Filter to only active ones (no FchBaja or FchBaja === "NULL")
      const activos = (puntos || []).filter((p: any) =>
        !p.FchBaja || p.FchBaja === "NULL"
      );
      return NextResponse.json({ puntosVenta: activos });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error consultando puntos de venta";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Accion no valida. Usar ?action=status o ?action=puntos-venta" }, { status: 400 });
}
