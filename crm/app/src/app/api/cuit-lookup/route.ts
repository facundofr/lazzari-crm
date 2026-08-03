import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

/**
 * GET /api/cuit-lookup?cuit=XXXXXXXXXXX
 * Consulta el padron de AFIP via ws_sr_padron_a13 (autenticado con cert ARCA).
 * Lazzari y GrupoLA se intentan en paralelo (Promise.any) para máxima velocidad.
 */

export const maxDuration = 25;

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

const PROVINCIA_MAP: Record<string, string> = {
  "0": "CABA", "1": "Buenos Aires", "2": "Catamarca", "3": "Córdoba",
  "4": "Corrientes", "5": "Entre Ríos", "6": "Jujuy", "7": "Mendoza",
  "8": "La Rioja", "9": "Salta", "10": "San Juan", "11": "San Luis",
  "12": "Santa Fe", "13": "Santiago del Estero", "14": "Tucumán",
  "16": "Chaco", "17": "Chubut", "18": "Formosa", "19": "Misiones",
  "20": "Neuquén", "21": "La Pampa", "22": "Río Negro", "23": "Santa Cruz",
  "24": "Tierra del Fuego",
};

function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
  return m ? m[1].trim() : "";
}

function parseDomicilioFiscal(xml: string) {
  const blocks: string[] = [];
  let idx = 0;
  while (true) {
    const start = xml.indexOf("<domicilio>", idx);
    if (start === -1) break;
    const end = xml.indexOf("</domicilio>", start);
    if (end === -1) break;
    blocks.push(xml.slice(start, end + 12));
    idx = end + 12;
  }

  const fiscal = blocks.find((b) => b.includes("<tipoDomicilio>FISCAL</tipoDomicilio>")) || blocks[0];
  if (!fiscal) return null;

  const provincia =
    xmlTag(fiscal, "descripcionProvincia") ||
    PROVINCIA_MAP[xmlTag(fiscal, "idProvincia")] ||
    "";

  return {
    direccion: xmlTag(fiscal, "direccion"),
    localidad: xmlTag(fiscal, "localidad"),
    cp: xmlTag(fiscal, "codigoPostal"),
    provincia,
  };
}

async function soapPadronA13(auth: any, targetCuit: string): Promise<any> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ser:getPersona xmlns:ser="http://a13.soap.ws.server.puc.sr/">
      <token>${auth.Token}</token>
      <sign>${auth.Sign}</sign>
      <cuitRepresentada>${auth.Cuit}</cuitRepresentada>
      <idPersona>${targetCuit}</idPersona>
    </ser:getPersona>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(
    "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13",
    {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": "" },
      body: envelope,
      signal: AbortSignal.timeout(10000),
    }
  );

  const text = await res.text();
  if (!res.ok || text.includes("<soap:Fault>") || text.includes("<faultcode>")) {
    const fault = text.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] || text.slice(0, 200);
    throw new Error(`PadronA13 SOAP error: ${fault}`);
  }

  const razonSocial =
    xmlTag(text, "razonSocial") ||
    [xmlTag(text, "apellido"), xmlTag(text, "nombre")].filter(Boolean).join(" ");

  if (!razonSocial) throw new Error("Persona no encontrada en respuesta");

  const domicilio = parseDomicilioFiscal(text);
  const tipoPersona = xmlTag(text, "tipoPersona");
  const estadoClave = xmlTag(text, "estadoClave");

  // Parse impuesto blocks considering only ACTIVO estado
  const activeImpuestos = new Set<number>();
  let impIdx = 0;
  while (true) {
    const start = text.indexOf("<impuesto>", impIdx);
    if (start === -1) break;
    const end = text.indexOf("</impuesto>", start);
    if (end === -1) break;
    const block = text.slice(start, end + 11);
    const estado = xmlTag(block, "estado");
    if (estado === "ACTIVO" || estado === "") {
      const id = Number(xmlTag(block, "idImpuesto"));
      if (id) activeImpuestos.add(id);
    }
    impIdx = end + 11;
  }
  // Fallback: if no <impuesto> blocks found, try flat <idImpuesto> tags
  if (activeImpuestos.size === 0) {
    const flatMatch = text.match(/<idImpuesto>(\d+)<\/idImpuesto>/g);
    if (flatMatch) flatMatch.forEach(m => activeImpuestos.add(Number(m.replace(/<\/?idImpuesto>/g, ""))));
  }

  // Detect Monotributo from datosMonotributo section (may not have idImpuesto 20)
  const hasMonotributoSection = text.includes("<datosMonotributo>") || text.includes("<categoriaMonotributo>");
  // Detect RI from datosRegimenGeneral with active IVA
  const hasRegimenGeneral = text.includes("<datosRegimenGeneral>");

  const hasActividad = !!xmlTag(text, "idActividadPrincipal");

  let condicion_iva = "";
  // Priority: RI (active IVA/Ganancias) > Monotributo > Exento > Jurídica=RI > Física activa con actividad=Monotributo > CF
  // Impuesto 20 = IVA (→ RI), 30 = Ganancias PJ, 32 = IIBB, 34 = Exento
  if (activeImpuestos.has(30) || activeImpuestos.has(32) || activeImpuestos.has(20)) {
    condicion_iva = "RI";
  } else if (hasMonotributoSection) {
    condicion_iva = "Monotributo";
  } else if (activeImpuestos.has(34)) {
    condicion_iva = "Exento";
  } else if (hasRegimenGeneral) {
    condicion_iva = "RI";
  } else if (text.includes("<formaJuridica>")) {
    condicion_iva = "RI";
  } else if (tipoPersona === "FISICA" && estadoClave === "ACTIVO" && hasActividad && activeImpuestos.size === 0) {
    // A13 no devuelve impuestos para muchas personas físicas.
    // Si tiene clave activa y actividad económica registrada, lo más probable es Monotributo.
    condicion_iva = "Monotributo";
  } else {
    condicion_iva = "CF";
  }

  return {
    razon_social: razonSocial,
    condicion_iva,
    direccion: domicilio?.direccion || "",
    localidad: domicilio?.localidad || "",
    provincia: domicilio?.provincia || "",
    cp: domicilio?.cp || "",
    tipo_persona: tipoPersona,
    estado_clave: estadoClave,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    ),
  ]);
}

function loadCertKey(
  certEnv: string | undefined, keyEnv: string | undefined,
  certFile: string, keyFile: string
): { cert: string; key: string } | null {
  let cert = "";
  if (certEnv) {
    cert = Buffer.from(certEnv, "base64").toString("utf-8");
  } else {
    const certPath = path.join(process.cwd(), "..", "certs", certFile);
    if (fs.existsSync(certPath)) cert = fs.readFileSync(certPath, "utf-8");
  }
  let key = "";
  if (keyEnv) {
    key = Buffer.from(keyEnv, "base64").toString("utf-8");
  } else {
    const keyPath = path.join(process.cwd(), "..", "certs", keyFile);
    if (fs.existsSync(keyPath)) key = fs.readFileSync(keyPath, "utf-8");
  }
  if (!cert || !key) return null;
  return { cert, key };
}

async function tryArcaPadron(cuit: string, label: string, arcaCuit: number, certEnv: string | undefined, keyEnv: string | undefined, certFile: string, keyFile: string): Promise<any> {
  await loadArca();
  const creds = loadCertKey(certEnv, keyEnv, certFile, keyFile);
  if (!creds) throw new Error(`${label}: cert/key faltante`);

  const production = process.env.ARCA_PRODUCTION !== "false";
  const arca = new Arca({ cuit: arcaCuit, cert: creds.cert, key: creds.key, production });

  const auth = await withTimeout(
    arca.getAuth("ws_sr_padron_a13"),
    12000,
    `${label} WSAA`
  );
  return await soapPadronA13(auth, cuit);
}

/** Calcula dígito verificador de CUIT */
function cuitVerifier(base10: string): number {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(base10[i]) * weights[i];
  const mod = 11 - (sum % 11);
  if (mod === 11) return 0;
  if (mod === 10) return 9;
  return mod;
}

/** Dado un DNI, genera CUITs válidos probando prefijos 20, 27, 23, 24 */
function dniToCuits(dni: string): string[] {
  const padded = dni.padStart(8, "0");
  const cuits: string[] = [];
  for (const prefix of ["20", "27", "23", "24"]) {
    const base = prefix + padded;
    const verifier = cuitVerifier(base);
    cuits.push(base + verifier);
  }
  return cuits;
}

async function lookupCuit(cuit: string) {
  const lazzariP = tryArcaPadron(
    cuit, "Lazzari", Number(process.env.ARCA_CUIT || "20379309128"),
    process.env.ARCA_CERT_B64, process.env.ARCA_KEY_B64,
    "lazzari.crt", "lazzari.key"
  );
  const grupoLAP = tryArcaPadron(
    cuit, "GrupoLA", 30719396042,
    process.env.ARCA_GRUPOLA_CERT_B64, process.env.ARCA_GRUPOLA_KEY_B64,
    "GrupoLa-crm.crt", "grupoLA.key"
  );
  return await Promise.any([lazzariP, grupoLAP]);
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");

  if (!input || input.length < 7 || input.length === 9 || input.length === 10 || input.length > 11) {
    return NextResponse.json(
      { error: "Ingrese un DNI (7-8 dígitos) o CUIT (11 dígitos)." },
      { status: 400 }
    );
  }

  // CUIT directo (11 dígitos)
  if (input.length === 11) {
    try {
      const result = await lookupCuit(input);
      return NextResponse.json(result);
    } catch (aggErr: any) {
      const errors = aggErr.errors?.map((e: any) => e.message) || [aggErr.message];
      return NextResponse.json(
        { error: "No se pudo obtener datos del CUIT. Ingresá los datos manualmente.", debug: errors },
        { status: 503 }
      );
    }
  }

  // DNI (7-8 dígitos) — probar prefijos en paralelo
  const candidateCuits = dniToCuits(input);
  try {
    const result = await Promise.any(
      candidateCuits.map((c) => lookupCuit(c).then((r) => ({ ...r, cuit: c })))
    );
    return NextResponse.json(result);
  } catch (aggErr: any) {
    const errors = aggErr.errors?.map((e: any) => e.message) || [aggErr.message];
    return NextResponse.json(
      { error: "No se encontró persona con ese DNI. Ingresá los datos manualmente.", debug: errors },
      { status: 503 }
    );
  }
}
