import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Lazy-import arca-facturacion (ESM module)
let Arca: any;
let arcaPromise: Promise<void> | null = null;

async function loadArca() {
  if (!arcaPromise) {
    arcaPromise = import("@ramiidv/arca-facturacion").then((mod) => {
      Arca = mod.Arca;
    });
  }
  await arcaPromise;
}

// Map our DB tipo codes to ARCA CbteTipo enum values
const CBTE_TIPO_MAP: Record<string, number> = {
  FA: 1, FB: 6,
  NCA: 3, NCB: 8,
  NDA: 2, NDB: 7,
};

const DEFAULT_PTO_VTA = 15;

function getArcaInstance() {
  const certPath = process.env.ARCA_CERT_PATH || path.join(process.cwd(), "..", "certs", "lazzari.crt");
  const keyPath = process.env.ARCA_KEY_PATH || path.join(process.cwd(), "..", "certs", "lazzari.key");

  const cert = process.env.ARCA_CERT || (fs.existsSync(certPath) ? fs.readFileSync(certPath, "utf-8") : "");
  const key = process.env.ARCA_KEY || (fs.existsSync(keyPath) ? fs.readFileSync(keyPath, "utf-8") : "");

  if (!cert || !key) {
    throw new Error("Certificado ARCA no configurado. Configura ARCA_CERT y ARCA_KEY en variables de entorno.");
  }

  const cuit = Number(process.env.ARCA_CUIT || "20379309128");
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
      tipo,           // "FA" | "FB" | "NCA" | "NCB"
      cliente_id,     // UUID or "consumidor_final"
      punto_venta,    // number (15)
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

      // Validate tipo vs condicion_iva
      if (tipo.endsWith("A") && cliente.condicion_iva !== "RI") {
        return NextResponse.json({
          error: `Factura A solo para Responsable Inscripto. Este cliente es ${cliente.condicion_iva || "desconocido"}.`,
        }, { status: 400 });
      }

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
        neto = Number(item.cantidad) * Number(item.precio_unitario);
        ivaPct = Number(item.iva_porcentaje ?? 21);
        ivaImporte = Math.round(neto * ivaPct / 100 * 100) / 100;
      } else {
        // FB/NCB: precio es final (IVA incluido), siempre 21% para productos
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

    // Build ARCA invoice
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
    const rawFchVto = String(firstDet.CAEFchVto);
    // Convert YYYYMMDD → YYYY-MM-DD for DB date column
    const caeFchVto = `${rawFchVto.slice(0, 4)}-${rawFchVto.slice(4, 6)}-${rawFchVto.slice(6, 8)}`;
    const cbteNro = Number(firstDet.CbteDesde);
    const fechaHoy = new Date().toISOString().slice(0, 10);

    // Save factura to database
    const { data: factura, error: insertError } = await supabase
      .from("facturas")
      .insert({
        tipo,
        punto_venta: ptoVta,
        numero: cbteNro,
        cliente_id: cliente_id === "consumidor_final" ? null : cliente_id,
        presupuesto_id: presupuesto_id || null,
        fecha: fechaHoy,
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
      console.error("Error guardando factura en DB:", insertError);
      return NextResponse.json({
        success: true,
        warning: "Factura autorizada por ARCA pero hubo un error al guardar localmente.",
        factura: {
          numero: cbteNro, cae, cae_vencimiento: caeFchVto, total: totalFinal,
          comprobante: `${tipo} ${String(ptoVta).padStart(4, "0")}-${String(cbteNro).padStart(8, "0")}`,
        },
        dbError: insertError.message,
      });
    }

    // Save factura_items server-side
    const facturaItems = items.map((item: any, idx: number) => ({
      factura_id: factura.id,
      descripcion: item.descripcion || "Item",
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario),
      iva_porcentaje: isFacturaA ? Number(item.iva_porcentaje ?? 21) : 21,
      subtotal: Math.round(Number(item.cantidad) * Number(item.precio_unitario) * 100) / 100,
      orden: idx,
    }));

    const { error: itemsError } = await supabase
      .from("factura_items")
      .insert(facturaItems);

    if (itemsError) {
      console.error("Error guardando factura_items:", itemsError);
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

  return NextResponse.json({ error: "Accion no valida. Usar ?action=status" }, { status: 400 });
}
