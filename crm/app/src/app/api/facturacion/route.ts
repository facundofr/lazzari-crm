import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { crearFacturaWsfeNode } from "@/lib/arca-wsfe-node";

export const runtime = "nodejs";

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
  FCEA: 201, FCEB: 206,
  NCEA: 203, NCEB: 208,
};

// Multi-sociedad ARCA configuration
interface ArcaConfig {
  id: string;
  cuit: number;
  ptoVta: number;
  ptoVtaPermitidos: number[];
  certFile: string;
  keyFile: string;
  certB64Env: string;
  keyB64Env: string;
}

const ARCA_CONFIGS: ArcaConfig[] = [
  { id: "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021", cuit: 20379309128, ptoVta: 15, ptoVtaPermitidos: [15, 16], certFile: "lazzari.crt", keyFile: "lazzari.key", certB64Env: "ARCA_CERT_B64", keyB64Env: "ARCA_KEY_B64" },
  { id: "fee94607-747a-4e87-ba24-aff9032f7a56", cuit: 30719396042, ptoVta: 10, ptoVtaPermitidos: [10], certFile: "GrupoLa-crm.crt", keyFile: "grupoLA.key", certB64Env: "ARCA_GRUPOLA_CERT_B64", keyB64Env: "ARCA_GRUPOLA_KEY_B64" },
];

const DEFAULT_ARCA_CONFIG = ARCA_CONFIGS[0]; // Lazzari

function getArcaConfigBySociedad(sociedadId?: string): ArcaConfig {
  if (!sociedadId) return DEFAULT_ARCA_CONFIG;
  const config = ARCA_CONFIGS.find((c) => c.id === sociedadId);
  if (!config) {
    throw new Error(`Sociedad no configurada para ARCA: ${sociedadId}`);
  }
  return config;
}

function getArcaInstance(config: ArcaConfig = DEFAULT_ARCA_CONFIG) {
  const certPath = path.join(process.cwd(), "..", "certs", config.certFile);
  const keyPath = path.join(process.cwd(), "..", "certs", config.keyFile);

  // Support base64-encoded certs (Vercel), plain text certs (env), or file-based certs (local)
  let cert = "";
  if (process.env[config.certB64Env]) {
    cert = Buffer.from(process.env[config.certB64Env]!, "base64").toString("utf-8");
  } else if (fs.existsSync(certPath)) {
    cert = fs.readFileSync(certPath, "utf-8");
  }

  let key = "";
  if (process.env[config.keyB64Env]) {
    key = Buffer.from(process.env[config.keyB64Env]!, "base64").toString("utf-8");
  } else if (fs.existsSync(keyPath)) {
    key = fs.readFileSync(keyPath, "utf-8");
  }

  if (!cert || !key) {
    throw new Error(`Certificado ARCA no configurado para sociedad (CUIT ${config.cuit}). Configura ${config.certB64Env}/${config.keyB64Env} o coloca ${config.certFile}/${config.keyFile} en /certs.`);
  }

  const production = process.env.ARCA_PRODUCTION !== "false";

  return new Arca({ cuit: config.cuit, cert, key, production, requestTimeoutMs: 30_000, retries: 2, retryDelayMs: 750 });
}

function condicionIvaArca(value?: string | null) {
  const normalized = (value || "").trim().toUpperCase();
  if (["RI", "RESPONSABLE INSCRIPTO"].includes(normalized)) return 1;
  if (["EX", "EXENTO"].includes(normalized)) return 4;
  if (["CF", "CONSUMIDOR FINAL"].includes(normalized)) return 5;
  if (["MONOTRIBUTO", "MONOTRIBUTISTA"].includes(normalized)) return 6;
  return 7;
}

function getSupabase(authHeader?: string | null) {
  // If service role key is available, use it (bypasses RLS)
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  // Otherwise, use the user's JWT to respect RLS
  const opts = authHeader
    ? { global: { headers: { Authorization: authHeader } } }
    : undefined;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    opts
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
      punto_venta,    // number (15 for Lazzari, 10 for Grupo LA)
      items,          // [{ descripcion, cantidad, precio_unitario, iva_porcentaje }]
      presupuesto_id, // optional UUID
      moneda,         // "ARS" | "USD" (default ARS)
      tipo_cambio,    // number — exchange rate USD→ARS (required when USD)
      sociedad_id,    // optional UUID — defaults to Lazzari
      oc_cliente,     // optional string — OC number from client
      solicitado_por, // optional string — who requested it
      observaciones,  // optional string — visible on invoice
      condicion_venta, // optional string — payment terms
      fecha_vencimiento, // optional date string — invoice due date
      nota_interna,   // optional string — internal note
      manual,         // optional boolean — skip ARCA, use numero_manual
      numero_manual,  // optional number — invoice number for manual mode
      fecha,          // optional date string YYYY-MM-DD — custom invoice date (defaults to today)
      factura_origen_id, // optional UUID — original invoice for NC/ND (CbtesAsoc)
    } = body;

    const authHeader = req.headers.get("authorization");
    const supabase = getSupabase(authHeader);

    // ── Manual mode: skip ARCA entirely ──
    if (manual === true) {
      if (!numero_manual && numero_manual !== 0) {
        return NextResponse.json({ error: "Número de factura requerido para emisión manual" }, { status: 400 });
      }
      if (!tipo || !cliente_id || !items?.length) {
        return NextResponse.json({ error: "Faltan campos requeridos: tipo, cliente_id, items" }, { status: 400 });
      }

      const isFacturaA = tipo.endsWith("A");
      const isUSD = moneda === "USD";
      const tc = Number(tipo_cambio) || 0;

      // Calculate totals
      let totalNeto = 0;
      let totalIva = 0;
      for (const item of items) {
        const precioItem = Number(item.precio_unitario);
        if (isFacturaA) {
          const neto = Number(item.cantidad) * precioItem;
          const ivaPct = Number(item.iva_porcentaje ?? 21);
          totalNeto += neto;
          totalIva += Math.round(neto * ivaPct / 100 * 100) / 100;
        } else {
          const totalItem = Number(item.cantidad) * precioItem;
          const ivaPctB = Number(item.iva_porcentaje ?? 21);
          const neto = Math.round(totalItem / (1 + ivaPctB / 100) * 100) / 100;
          totalNeto += neto;
          totalIva += Math.round((totalItem - neto) * 100) / 100;
        }
      }
      totalNeto = Math.round(totalNeto * 100) / 100;
      totalIva = Math.round(totalIva * 100) / 100;
      const totalFinal = Math.round((totalNeto + totalIva) * 100) / 100;

      const ptoVta = Number(punto_venta) || 0;
      const fechaFactura = fecha || new Date().toISOString().slice(0, 10);

      const { data: factura, error: insertError } = await supabase
        .from("facturas")
        .insert({
          tipo,
          punto_venta: ptoVta,
          numero: Number(numero_manual),
          cliente_id: cliente_id === "consumidor_final" ? null : cliente_id,
          presupuesto_id: presupuesto_id || null,
          fecha: fechaFactura,
          cae: null,
          cae_vencimiento: null,
          subtotal: totalNeto,
          iva: totalIva,
          total: totalFinal,
          moneda: isUSD ? "USD" : "ARS",
          tipo_cambio: isUSD ? tc : null,
          estado: "emitida",
          sociedad_id: sociedad_id || ARCA_CONFIGS[0].id,
          oc_cliente: oc_cliente || null,
          solicitado_por: solicitado_por || null,
          observaciones: observaciones || null,
          condicion_venta: condicion_venta || null,
          fecha_vencimiento: fecha_vencimiento || null,
          nota_interna: nota_interna || null,
        } as any)
        .select()
        .single();

      if (insertError) {
        console.error("Error guardando factura manual en DB:", insertError);
        return NextResponse.json({ error: `Error al guardar factura: ${insertError.message}` }, { status: 500 });
      }

      // Save factura_items
      const facturaItems = items.map((item: any, idx: number) => ({
        factura_id: factura.id,
        descripcion: item.descripcion || "Item",
        cantidad: Number(item.cantidad),
        precio_unitario: Number(item.precio_unitario),
        iva_porcentaje: isFacturaA ? Number(item.iva_porcentaje ?? 21) : 21,
        orden: idx,
      }));

      const { error: itemsError } = await supabase
        .from("factura_items")
        .insert(facturaItems);

      if (itemsError) {
        console.error("Error guardando factura_items (manual):", itemsError);
      }

      return NextResponse.json({
        success: true,
        factura: {
          id: factura.id,
          numero: Number(numero_manual),
          cae: null,
          cae_vencimiento: null,
          total: totalFinal,
          comprobante: `${tipo} ${String(ptoVta).padStart(4, "0")}-${String(numero_manual).padStart(8, "0")}`,
        },
      });
    }

    // ── ARCA mode (default) ──

    // Resolve ARCA config for the sociedad
    let arcaConfig: ArcaConfig;
    try {
      arcaConfig = getArcaConfigBySociedad(sociedad_id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sociedad no valida";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const isUSD = moneda === "USD";
    const tc = Number(tipo_cambio) || 0;
    if (isUSD && (!tc || tc <= 0)) {
      return NextResponse.json({ error: "Tipo de cambio requerido para facturar en USD (ARCA necesita la cotizacion)" }, { status: 400 });
    }

    if (!tipo || !cliente_id || !punto_venta || !items?.length) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: tipo, cliente_id, punto_venta, items" },
        { status: 400 }
      );
    }

    // Validate punto_venta is allowed for this sociedad
    if (!arcaConfig.ptoVtaPermitidos.includes(Number(punto_venta))) {
      return NextResponse.json({
        error: `Punto de venta ${punto_venta} no está permitido para esta sociedad (permitidos: ${arcaConfig.ptoVtaPermitidos.join(", ")})`,
      }, { status: 400 });
    }

    const cbteTipo = CBTE_TIPO_MAP[tipo];
    if (!cbteTipo) {
      return NextResponse.json({ error: `Tipo de comprobante no valido: ${tipo}` }, { status: 400 });
    }

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

      // Items come in the invoice's currency (ARS or USD) — no conversion needed
      const precioItem = Number(item.precio_unitario);

      if (isFacturaA) {
        neto = Number(item.cantidad) * precioItem;
        ivaPct = Number(item.iva_porcentaje ?? 21);
        ivaImporte = Math.round(neto * ivaPct / 100 * 100) / 100;
      } else {
        // FB/NCB: precio es final (IVA incluido), usar IVA del item
        const totalItem = Number(item.cantidad) * precioItem;
        ivaPct = Number(item.iva_porcentaje ?? 21);
        neto = Math.round(totalItem / (1 + ivaPct / 100) * 100) / 100;
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
    const arca = getArcaInstance(arcaConfig);
    const ptoVta = Number(punto_venta);

    const ivaArray = Object.entries(ivaGroups).map(([id, vals]) => ({
      Id: Number(id),
      BaseImp: Math.round(vals.baseImp * 100) / 100,
      Importe: Math.round(vals.importe * 100) / 100,
    }));

    const today = fecha ? fecha.replace(/-/g, "") : new Date().toISOString().slice(0, 10).replace(/-/g, "");

    // Build CbtesAsoc for NC/ND (required by ARCA)
    const isNCND = ["NCA", "NCB", "NCEA", "NCEB", "NDA", "NDB"].includes(tipo);
    let cbtesAsoc: { Tipo: number; PtoVta: number; Nro: number; Cuit: number; CbteFch: string }[] | undefined;
    if (isNCND && factura_origen_id) {
      const { data: origen } = await (supabase as any)
        .from("facturas")
        .select("tipo, punto_venta, numero, fecha")
        .eq("id", factura_origen_id)
        .single();
      if (origen) {
        const origenTipo = CBTE_TIPO_MAP[origen.tipo];
        if (origenTipo) {
          cbtesAsoc = [{
            Tipo: origenTipo,
            PtoVta: Number(origen.punto_venta),
            Nro: Number(origen.numero),
            Cuit: arcaConfig.cuit,
            CbteFch: String(origen.fecha).replace(/-/g, ""),
          }];
        }
      }
    }

    // El ticket WSAA se obtiene con el SDK. Para WSFE usamos node:https con IPv4
    // y reintentos: evita los fallos intermitentes de fetch/undici observados en Vercel.
    const auth = await arca.getAuth("wsfe");
    const production = process.env.ARCA_PRODUCTION !== "false";
    const result = await crearFacturaWsfeNode({
      auth,
      production,
      ptoVta,
      cbteTipo,
      invoice: {
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
      MonId: isUSD ? "DOL" : "PES",
      MonCotiz: isUSD ? tc : 1,
      CondicionIVAReceptorId: cliente_id === "consumidor_final" ? 5 : condicionIvaArca(cliente?.condicion_iva),
      ...(isUSD ? { CanMisMonExt: "N" as const } : {}),
      Iva: ivaArray,
      ...(cbtesAsoc ? { CbtesAsoc: cbtesAsoc } : {}),
      },
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
    const fechaFactura = fecha || new Date().toISOString().slice(0, 10);

    // Save factura to database
    const { data: factura, error: insertError } = await supabase
      .from("facturas")
      .insert({
        tipo,
        punto_venta: ptoVta,
        numero: cbteNro,
        cliente_id: cliente_id === "consumidor_final" ? null : cliente_id,
        presupuesto_id: presupuesto_id || null,
        fecha: fechaFactura,
        cae,
        cae_vencimiento: caeFchVto,
        subtotal: totalNeto,
        iva: totalIva,
        total: totalFinal,
        moneda: isUSD ? "USD" : "ARS",
        tipo_cambio: isUSD ? tc : null,
        estado: "emitida",
        sociedad_id: arcaConfig.id,
        oc_cliente: oc_cliente || null,
        solicitado_por: solicitado_por || null,
        observaciones: observaciones || null,
        condicion_venta: condicion_venta || null,
        fecha_vencimiento: fecha_vencimiento || null,
        nota_interna: nota_interna || null,
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
    await loadArca();
    const sociedadId = req.nextUrl.searchParams.get("sociedad_id") || undefined;
    let arcaConfig: ArcaConfig;
    try {
      arcaConfig = getArcaConfigBySociedad(sociedadId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sociedad no valida";
      return NextResponse.json({ connected: false, certOk: false, error: message });
    }

    // First: check if cert/key are present (no network call)
    let certOk = false;
    try {
      getArcaInstance(arcaConfig); // throws if cert/key missing
      certOk = true;
    } catch {
      return NextResponse.json({ connected: false, certOk: false, error: "Certificado no configurado", ptoVta: arcaConfig.ptoVta, cuit: String(arcaConfig.cuit) });
    }

    // Second: try AFIP connectivity (may fail due to network/AFIP downtime)
    try {
      const arca = getArcaInstance(arcaConfig);
      const lastVoucher = await arca.ultimoComprobante(arcaConfig.ptoVta, 1);
      return NextResponse.json({
        connected: true,
        certOk: true,
        production: true,
        lastVoucher,
        ptoVta: arcaConfig.ptoVta,
        cuit: String(arcaConfig.cuit),
        sociedad_id: arcaConfig.id,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error de conexion";
      // Cert is OK but AFIP is unreachable — still return certOk: true
      return NextResponse.json({ connected: false, certOk: true, afipError: message, ptoVta: arcaConfig.ptoVta, cuit: String(arcaConfig.cuit) });
    }
  }

  return NextResponse.json({ error: "Accion no valida. Usar ?action=status" }, { status: 400 });
}
