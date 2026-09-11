import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { crearFacturaWsfeNode } from "@/lib/arca-wsfe-node";

export const runtime = "nodejs";

/**
 * POST /api/remito
 * Autoriza un remito electrónico con ARCA vía WSFE (CbteTipo 91 = Remito R).
 * Usa los mismos endpoints que facturación electrónica pero con PV dedicados para remitos.
 *
 * PV Remitos:
 *   Lazzari:  17
 *   Grupo LA: 11
 *
 * IMPORTANTE: Implicancia legal y fiscal — este endpoint genera comprobantes
 * válidos ante ARCA. Cada remito autorizado queda registrado en los servidores de ARCA.
 */

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

// CbteTipo 91 = Remito R (Responsable Inscripto)
const CBTE_TIPO_REMITO = 91;

// Multi-sociedad ARCA configuration — PV específicos para remitos
interface ArcaConfig {
  id: string;
  cuit: number;
  ptoVtaRemito: number; // PV dedicado para remitos electrónicos
  certFile: string;
  keyFile: string;
  certB64Env: string;
  keyB64Env: string;
}

const ARCA_CONFIGS: ArcaConfig[] = [
  {
    id: "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021",
    cuit: 20379309128,
    ptoVtaRemito: 17,
    certFile: "lazzari.crt",
    keyFile: "lazzari.key",
    certB64Env: "ARCA_CERT_B64",
    keyB64Env: "ARCA_KEY_B64",
  },
  {
    id: "fee94607-747a-4e87-ba24-aff9032f7a56",
    cuit: 30719396042,
    ptoVtaRemito: 11,
    certFile: "GrupoLa-crm.crt",
    keyFile: "grupoLA.key",
    certB64Env: "ARCA_GRUPOLA_CERT_B64",
    keyB64Env: "ARCA_GRUPOLA_KEY_B64",
  },
];

function getConfig(sociedadId?: string): ArcaConfig {
  if (!sociedadId) return ARCA_CONFIGS[0];
  const cfg = ARCA_CONFIGS.find((c) => c.id === sociedadId);
  if (!cfg) throw new Error(`Sociedad no configurada para remitos ARCA: ${sociedadId}`);
  return cfg;
}

function buildArca(cfg: ArcaConfig) {
  const certPath = path.join(process.cwd(), "..", "certs", cfg.certFile);
  const keyPath = path.join(process.cwd(), "..", "certs", cfg.keyFile);
  let cert = "", key = "";
  if (process.env[cfg.certB64Env]) cert = Buffer.from(process.env[cfg.certB64Env]!, "base64").toString();
  else if (fs.existsSync(certPath)) cert = fs.readFileSync(certPath, "utf-8");
  if (process.env[cfg.keyB64Env]) key = Buffer.from(process.env[cfg.keyB64Env]!, "base64").toString();
  else if (fs.existsSync(keyPath)) key = fs.readFileSync(keyPath, "utf-8");
  if (!cert || !key) throw new Error(`Certificado ARCA no disponible (${cfg.certB64Env}/${cfg.keyB64Env})`);
  const production = process.env.ARCA_PRODUCTION !== "false";
  return new Arca({ cuit: cfg.cuit, cert, key, production, requestTimeoutMs: 30_000, retries: 2, retryDelayMs: 750 });
}

function getSupabase(authHeader?: string | null) {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  const opts = authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
}

export async function POST(req: NextRequest) {
  try {
    await loadArca();

    const body = await req.json();
    const { remito_id, sociedad_id } = body;

    if (!remito_id || !sociedad_id) return NextResponse.json({ error: "remito_id y sociedad_id son requeridos" }, { status: 400 });

    const authHeader = req.headers.get("authorization");
    const supabase = getSupabase(authHeader);

    // Fetch remito + cliente
    const { data: remito, error: rErr } = await (supabase as any)
      .from("remitos")
      .select("id, numero, fecha, cliente_id, valor_declarado, cae, sociedad_id, clientes(razon_social, cuit, condicion_iva, direccion, localidad, provincia, cp)")
      .eq("id", remito_id)
      .eq("sociedad_id", sociedad_id)
      .single();

    if (rErr || !remito) return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 });
    if (remito.cae) return NextResponse.json({ error: "Este remito ya tiene CAE: " + remito.cae }, { status: 409 });

    // Fetch items para calcular valor declarado si no tiene
    const { data: items, error: iErr } = await supabase
      .from("remito_items")
      .select("descripcion, cantidad, unidad")
      .eq("remito_id", remito_id)
      .order("orden", { ascending: true });

    if (iErr || !items?.length) return NextResponse.json({ error: "El remito no tiene items para autorizar" }, { status: 400 });

    const sid = remito.sociedad_id;
    const cfg = getConfig(sid);

    // Obtener token WSAA para wsfe (mismo servicio que facturas)
    const arca = buildArca(cfg);
    const auth = await arca.getAuth("wsfe");
    const production = process.env.ARCA_PRODUCTION !== "false";

    const cliente = remito.clientes as any;
    const clienteCuit = cliente?.cuit?.replace(/-/g, "") || "";
    const docTipo = clienteCuit ? 80 : 99; // 80=CUIT, 99=Consumidor Final
    const docNro = clienteCuit ? Number(clienteCuit) : 0;

    // Fecha en formato YYYYMMDD para ARCA
    const fechaAFIP = String(remito.fecha).replace(/-/g, "");

    // Valor declarado (ImpTotal) — el remito R no discrimina IVA
    const valorDeclarado = Number(remito.valor_declarado) || 0;

    // Condición IVA del receptor
    const condicionIvaMap: Record<string, number> = {
      "Responsable Inscripto": 1,
      "Monotributista": 6,
      "Exento": 4,
      "Consumidor Final": 5,
      "No Responsable": 5,
    };
    const condicionIVAReceptorId = condicionIvaMap[cliente?.condicion_iva || ""] || 5;

    // Llamar a WSFE con CbteTipo 91 (Remito R)
    const result = await crearFacturaWsfeNode({
      auth,
      production,
      ptoVta: cfg.ptoVtaRemito,
      cbteTipo: CBTE_TIPO_REMITO,
      invoice: {
        Concepto: 1, // Productos
        DocTipo: docTipo,
        DocNro: docNro,
        CbteFch: fechaAFIP,
        ImpTotal: valorDeclarado,
        ImpTotConc: valorDeclarado, // No gravado (remito no tiene IVA propio)
        ImpNeto: 0,
        ImpOpEx: 0,
        ImpTrib: 0,
        ImpIVA: 0,
        MonId: "PES",
        MonCotiz: 1,
        CondicionIVAReceptorId: condicionIVAReceptorId,
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
        error: `ARCA rechazó el remito: ${obsMsg || "Error desconocido"}`,
      }, { status: 422 });
    }

    const cae = String(firstDet.CAE);
    const rawFchVto = String(firstDet.CAEFchVto);
    const caeFchVto = `${rawFchVto.slice(0, 4)}-${rawFchVto.slice(4, 6)}-${rawFchVto.slice(6, 8)}`;
    const cbteNro = Number(firstDet.CbteDesde);

    // Guardar CAE en la DB
    const updatePayload: Record<string, unknown> = {
      cae,
      car_vencimiento: caeFchVto,
      nro_remito_afip: `${String(cfg.ptoVtaRemito).padStart(5, "0")}-${String(cbteNro).padStart(8, "0")}`,
    };

    const { error: updErr } = await (supabase as any).from("remitos").update(updatePayload).eq("id", remito_id).eq("sociedad_id", sid);
    if (updErr) console.error("Error guardando CAE del remito:", updErr.message);

    return NextResponse.json({
      cae,
      cae_vencimiento: caeFchVto,
      nro_remito_afip: updatePayload.nro_remito_afip,
      cbte_nro: cbteNro,
      punto_venta: cfg.ptoVtaRemito,
    });
  } catch (err: any) {
    console.error("[/api/remito] Error:", err);
    return NextResponse.json({ error: err.message || "Error interno" }, { status: 500 });
  }
}
