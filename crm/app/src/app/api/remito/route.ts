import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as tls from "node:tls";

// AFIP uses DH keys smaller than OpenSSL 3.x default minimum
if (!tls.DEFAULT_CIPHERS.includes("@SECLEVEL=0")) {
  (tls as any).DEFAULT_CIPHERS += ":@SECLEVEL=0";
}

/**
 * POST /api/remito
 * Autoriza un remito electrónico con AFIP via WSREMHOM.
 * Obtiene el CAR (Código de Autorización de Remito) y lo guarda en la DB.
 *
 * WSREMHOM endpoints:
 *   Producción : https://serviciosjava.afip.gob.ar/wsremhom/RemHom
 *   Homologación: https://wsremhom.afip.gov.ar/ws/services/RemHom
 */

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

interface ArcaConfig {
  id: string;
  cuit: number;
  ptoVta: number;
  certFile: string;
  keyFile: string;
  certB64Env: string;
  keyB64Env: string;
}

const ARCA_CONFIGS: ArcaConfig[] = [
  { id: "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021", cuit: 20379309128, ptoVta: 15, certFile: "lazzari.crt",    keyFile: "lazzari.key",  certB64Env: "ARCA_CERT_B64",         keyB64Env: "ARCA_KEY_B64"         },
  { id: "fee94607-747a-4e87-ba24-aff9032f7a56", cuit: 30719396042, ptoVta: 10, certFile: "GrupoLa-crm.crt", keyFile: "grupoLA.key",  certB64Env: "ARCA_GRUPOLA_CERT_B64", keyB64Env: "ARCA_GRUPOLA_KEY_B64" },
];

function getConfig(sociedadId?: string): ArcaConfig {
  if (!sociedadId) return ARCA_CONFIGS[0];
  const cfg = ARCA_CONFIGS.find((c) => c.id === sociedadId);
  if (!cfg) throw new Error(`Sociedad no configurada: ${sociedadId}`);
  return cfg;
}

function buildArca(cfg: ArcaConfig) {
  const certPath = path.join(process.cwd(), "..", "certs", cfg.certFile);
  const keyPath  = path.join(process.cwd(), "..", "certs", cfg.keyFile);
  let cert = "", key = "";
  if (process.env[cfg.certB64Env]) cert = Buffer.from(process.env[cfg.certB64Env]!, "base64").toString();
  else if (fs.existsSync(certPath)) cert = fs.readFileSync(certPath, "utf-8");
  if (process.env[cfg.keyB64Env])  key  = Buffer.from(process.env[cfg.keyB64Env]!,  "base64").toString();
  else if (fs.existsSync(keyPath))  key  = fs.readFileSync(keyPath,  "utf-8");
  if (!cert || !key) throw new Error(`Certificado no disponible (${cfg.certB64Env}/${cfg.keyB64Env})`);
  const production = process.env.ARCA_PRODUCTION !== "false";
  return new Arca({ cuit: cfg.cuit, cert, key, production, requestTimeoutMs: 30_000, retries: 2, retryDelayMs: 750 });
}

// Códigos de unidad de medida AFIP (CodigoUnidadMedida)
const UNIDAD_MAP: Record<string, number> = {
  UN: 7, U: 7, UNIDAD: 7, PZ: 7, PZA: 7, UND: 7,
  KG: 1, KGS: 1, KILOGRAMO: 1,
  LT: 5, L: 5, LTS: 5, LITRO: 5,
  MT: 15, M: 15, MTS: 15, METRO: 15,
  M2: 3, M3: 4,
  JG: 17, JUEGO: 17,
  HR: 47, HORA: 47, HS: 47,
  SRV: 48, SERVICIO: 48,
  GR: 14, G: 14, GRAMO: 14,
  CM: 20,
};

function mapUnidad(u: string | null | undefined): number {
  if (!u) return 7;
  return UNIDAD_MAP[u.toUpperCase().trim()] ?? 7;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

async function callWsremhom(
  auth: { Token: string; Sign: string; Cuit: string | number },
  payload: {
    cfg: ArcaConfig;
    fecha: string;
    clienteCuit: string;
    clienteNombre: string;
    domicilioEntrega?: string;
    localidad?: string;
    provincia?: string;
    cp?: string;
    valorDeclarado?: number | null;
    items: { descripcion: string; cantidad: number; unidad: string | null; precio?: number }[];
  }
) {
  const { cfg, fecha, clienteCuit, clienteNombre, domicilioEntrega, localidad, provincia, cp, valorDeclarado, items } = payload;
  const production = process.env.ARCA_PRODUCTION !== "false";
  const endpoint = production
    ? "https://serviciosjava.afip.gob.ar/wsremhom/RemHom"
    : "https://wsremhom.afip.gov.ar/ws/services/RemHom";

  const fechaAFIP = fecha.replace(/-/g, "");
  const docTipo   = clienteCuit ? 80 : 99;
  const docNro    = clienteCuit ? clienteCuit.replace(/-/g, "") : "0";

  const domNodo = domicilioEntrega
    ? `<DomicilioEntregaMercaderia>
        <CodigoPais>200</CodigoPais>
        <Calle>${escapeXml(domicilioEntrega)}</Calle>
        ${localidad ? `<Localidad>${escapeXml(localidad)}</Localidad>` : ""}
        ${cp       ? `<CodigoPostal>${escapeXml(cp)}</CodigoPostal>`   : ""}
        ${provincia ? `<Descripcion>${escapeXml(provincia)}</Descripcion>` : ""}
      </DomicilioEntregaMercaderia>`
    : "";

  const valorNodo = valorDeclarado && valorDeclarado > 0
    ? `<ValorDeclarado>${valorDeclarado.toFixed(2)}</ValorDeclarado>`
    : "";

  const detalleNodo = items.map((it, i) => `
      <ComprobanteDetalle>
        <Ordn>${i + 1}</Ordn>
        <Descricpion>${escapeXml(it.descripcion.slice(0, 200))}</Descricpion>
        <Cantidad>${Number(it.cantidad).toFixed(2)}</Cantidad>
        <CodigoUnidadMedida>${mapUnidad(it.unidad)}</CodigoUnidadMedida>
        ${it.precio != null ? `<Precio>${Number(it.precio).toFixed(2)}</Precio>` : ""}
      </ComprobanteDetalle>`).join("");

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:rem="http://impl.service.wsremhom.dom.afip.gov.ar/">
  <soapenv:Body>
    <rem:remHomInformar>
      <authRequest>
        <token>${auth.Token}</token>
        <sign>${auth.Sign}</sign>
        <cuitRepresentada>${cfg.cuit}</cuitRepresentada>
      </authRequest>
      <comprobanteCABRequest>
        <CantReg>1</CantReg>
        <PtoEmision>${cfg.ptoVta}</PtoEmision>
        <CodTipoRemito>351</CodTipoRemito>
        <Concepto>1</Concepto>
        <FechaEmision>${fechaAFIP}</FechaEmision>
        <DocTipoDestinatario>${docTipo}</DocTipoDestinatario>
        <DocNroDestinatario>${docNro}</DocNroDestinatario>
        <NombreDestinatario>${escapeXml(clienteNombre.slice(0, 100))}</NombreDestinatario>
        ${domNodo}
        ${valorNodo}
      </comprobanteCABRequest>
      <comprobanteDetRequest>
        ${detalleNodo}
      </comprobanteDetRequest>
    </rem:remHomInformar>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=UTF-8",
      SOAPAction: '""',
    },
    body: envelope,
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();

  if (text.includes("<faultstring>") || text.includes("<soap:Fault>") || text.includes("<soapenv:Fault>")) {
    const fault = xmlTag(text, "faultstring") || text.slice(0, 300);
    throw new Error(`WSREMHOM SOAP error: ${fault}`);
  }

  const car       = xmlTag(text, "CAR")       || xmlTag(text, "car");
  const nroRemito = xmlTag(text, "NroRemito") || xmlTag(text, "nroRemito");
  const fecVto    = xmlTag(text, "FechaVencimientoCAR") || xmlTag(text, "fechaVencimientoCAR");

  if (!car) {
    const errMsg  = xmlTag(text, "Msg")        || xmlTag(text, "mensaje")    || xmlTag(text, "descripcion");
    const errCode = xmlTag(text, "Code")       || xmlTag(text, "codigo");
    throw new Error(
      errCode
        ? `AFIP rechazó el remito [${errCode}]: ${errMsg}`
        : `WSREMHOM: no se obtuvo CAR. Respuesta: ${text.slice(0, 500)}`
    );
  }

  return { car, nroRemito, fecVto };
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

    if (!remito_id) return NextResponse.json({ error: "remito_id requerido" }, { status: 400 });

    const authHeader = req.headers.get("authorization");
    const supabase = getSupabase(authHeader);

    // Fetch remito + cliente
    const { data: remito, error: rErr } = await (supabase as any)
      .from("remitos")
      .select("id, numero, fecha, cliente_id, valor_declarado, cae, sociedad_id, clientes(razon_social, cuit, direccion, localidad, provincia, cp)")
      .eq("id", remito_id)
      .single();

    if (rErr || !remito) return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 });
    if (remito.cae)      return NextResponse.json({ error: "Este remito ya tiene CAR: " + remito.cae }, { status: 409 });

    // Fetch items
    const { data: items, error: iErr } = await supabase
      .from("remito_items")
      .select("descripcion, cantidad, unidad")
      .eq("remito_id", remito_id)
      .order("orden", { ascending: true });

    if (iErr || !items?.length) return NextResponse.json({ error: "El remito no tiene items para autorizar" }, { status: 400 });

    const sid = sociedad_id || remito.sociedad_id;
    const cfg = getConfig(sid);

    // Obtener token WSAA para wsremhom
    const arca = buildArca(cfg);
    const auth = await arca.getAuth("wsremhom");

    const cliente = remito.clientes as any;

    const { car, nroRemito, fecVto } = await callWsremhom(auth, {
      cfg,
      fecha: remito.fecha,
      clienteCuit:      cliente?.cuit      || "",
      clienteNombre:    cliente?.razon_social || "Sin nombre",
      domicilioEntrega: cliente?.direccion  || undefined,
      localidad:        cliente?.localidad  || undefined,
      provincia:        cliente?.provincia  || undefined,
      cp:               cliente?.cp        || undefined,
      valorDeclarado:   remito.valor_declarado,
      items: (items as any[]).map((it) => ({
        descripcion: it.descripcion,
        cantidad:    it.cantidad,
        unidad:      it.unidad,
      })),
    });

    // Guardar CAR en la DB
    const updatePayload: Record<string, unknown> = { cae: car };
    if (nroRemito) updatePayload.nro_remito_afip = nroRemito;
    if (fecVto && fecVto.length === 8) {
      updatePayload.car_vencimiento = `${fecVto.slice(0, 4)}-${fecVto.slice(4, 6)}-${fecVto.slice(6, 8)}`;
    }

    const { error: updErr } = await (supabase as any).from("remitos").update(updatePayload).eq("id", remito_id);
    if (updErr) console.error("Error guardando CAR:", updErr.message);

    return NextResponse.json({
      car,
      nro_remito_afip: nroRemito || null,
      car_vencimiento: updatePayload.car_vencimiento || null,
    });
  } catch (err: any) {
    console.error("[/api/remito] Error:", err);
    return NextResponse.json({ error: err.message || "Error interno" }, { status: 500 });
  }
}
