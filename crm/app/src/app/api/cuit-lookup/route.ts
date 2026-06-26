import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

/**
 * GET /api/cuit-lookup?cuit=XXXXXXXXXXX
 * Consulta el padron de AFIP via ws_sr_padron_a13 (autenticado con cert ARCA).
 * Fallback: scraping cuitonline.com
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

const PROVINCIA_MAP: Record<string, string> = {
  "0": "CABA", "1": "Buenos Aires", "2": "Catamarca", "3": "Córdoba",
  "4": "Corrientes", "5": "Entre Ríos", "6": "Jujuy", "7": "Mendoza",
  "8": "La Rioja", "9": "Salta", "10": "San Juan", "11": "San Luis",
  "12": "Santa Fe", "13": "Santiago del Estero", "14": "Tucumán",
  "16": "Chaco", "17": "Chubut", "18": "Formosa", "19": "Misiones",
  "20": "Neuquén", "21": "La Pampa", "22": "Río Negro", "23": "Santa Cruz",
  "24": "Tierra del Fuego",
};

/** Extrae texto de un tag XML simple */
function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
  return m ? m[1].trim() : "";
}

/** Extrae el primer domicilio fiscal del XML de respuesta A13 */
function parseDomicilioFiscal(xml: string) {
  // Encuentra todos los bloques <domicilio>...</domicilio>
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

  // Preferir FISCAL
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

/**
 * Llama directamente al SOAP de padron A13 con namespace correcto.
 * La librería @ramiidv/arca-facturacion tiene un bug de namespace en este servicio.
 */
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
      signal: AbortSignal.timeout(15000),
    }
  );

  const text = await res.text();
  if (!res.ok || text.includes("<soap:Fault>") || text.includes("<faultcode>")) {
    const fault = text.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] || text.slice(0, 200);
    throw new Error(`PadronA13 SOAP error: ${fault}`);
  }

  // Extraer persona del XML
  const razonSocial =
    xmlTag(text, "razonSocial") ||
    [xmlTag(text, "apellido"), xmlTag(text, "nombre")].filter(Boolean).join(" ");

  if (!razonSocial) throw new Error("Persona no encontrada en respuesta");

  const domicilio = parseDomicilioFiscal(text);
  const tipoPersona = xmlTag(text, "tipoPersona");
  const estadoClave = xmlTag(text, "estadoClave");

  // A13 no trae impuestos — inferir condicion IVA básica
  // (el usuario puede corregirlo; lo importante es razon_social + domicilio)
  let condicion_iva = "";
  if (text.includes("<formaJuridica>")) condicion_iva = "RI"; // empresas casi siempre RI
  // Si hay impuestos en la respuesta los usamos
  const impuestoMatch = text.match(/<idImpuesto>(\d+)<\/idImpuesto>/g);
  if (impuestoMatch) {
    const ids = impuestoMatch.map((m) => Number(m.replace(/<\/?idImpuesto>/g, "")));
    if (ids.includes(30) || ids.includes(32)) condicion_iva = "RI";
    else if (ids.includes(20)) condicion_iva = "Monotributo";
    else if (ids.includes(34)) condicion_iva = "Exento";
    else condicion_iva = "CF";
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

async function tryArcaPadron(cuit: string) {
  try {
    await loadArca();

    let cert = "";
    if (process.env.ARCA_CERT_B64) {
      cert = Buffer.from(process.env.ARCA_CERT_B64, "base64").toString("utf-8");
    } else {
      const certPath = path.join(process.cwd(), "..", "certs", "lazzari.crt");
      if (fs.existsSync(certPath)) cert = fs.readFileSync(certPath, "utf-8");
    }
    let key = "";
    if (process.env.ARCA_KEY_B64) {
      key = Buffer.from(process.env.ARCA_KEY_B64, "base64").toString("utf-8");
    } else {
      const keyPath = path.join(process.cwd(), "..", "certs", "lazzari.key");
      if (fs.existsSync(keyPath)) key = fs.readFileSync(keyPath, "utf-8");
    }
    if (!cert || !key) {
      console.warn("ARCA padron: no cert/key configurado");
      return null;
    }

    const arcaCuit = Number(process.env.ARCA_CUIT || "20379309128");
    const production = process.env.ARCA_PRODUCTION !== "false";
    const arca = new Arca({ cuit: arcaCuit, cert, key, production });

    const auth = await arca.getAuth("ws_sr_padron_a13");
    return await soapPadronA13(auth, cuit);
  } catch (err: any) {
    console.warn("ARCA padron Lazzari error:", err.message);
    return null;
  }
}

async function tryArcaPadronGrupoLA(cuit: string) {
  try {
    await loadArca();

    let cert = "";
    if (process.env.ARCA_GRUPOLA_CERT_B64) {
      cert = Buffer.from(process.env.ARCA_GRUPOLA_CERT_B64, "base64").toString("utf-8");
    } else {
      const certPath = path.join(process.cwd(), "..", "certs", "GrupoLa-crm.crt");
      if (fs.existsSync(certPath)) cert = fs.readFileSync(certPath, "utf-8");
    }
    let key = "";
    if (process.env.ARCA_GRUPOLA_KEY_B64) {
      key = Buffer.from(process.env.ARCA_GRUPOLA_KEY_B64, "base64").toString("utf-8");
    } else {
      const keyPath = path.join(process.cwd(), "..", "certs", "grupoLA.key");
      if (fs.existsSync(keyPath)) key = fs.readFileSync(keyPath, "utf-8");
    }
    if (!cert || !key) return null;

    const production = process.env.ARCA_PRODUCTION !== "false";
    const arca = new Arca({ cuit: 30719396042, cert, key, production });

    const auth = await arca.getAuth("ws_sr_padron_a13");
    return await soapPadronA13(auth, cuit);
  } catch (err: any) {
    console.warn("ARCA padron GrupoLA error:", err.message);
    return null;
  }
}

// Fallback: scraping cuitonline.com
async function tryCuitOnline(cuit: string) {
  try {
    const res = await fetch(`https://www.cuitonline.com/search.php?q=${cuit}`, {
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    if (html.includes("no obtuvo resultados")) return null;

    const nombreMatch = html.match(/<h2[^>]*class="denominacion"[^>]*>([^<]+)</);
    if (!nombreMatch) return null;
    const razon_social = nombreMatch[1].trim();

    let condicion_iva = "CF";
    const ivaMatch = html.match(/IVA:(?:&nbsp;|\s)+([^<\n&]+)/);
    if (ivaMatch) {
      const t = ivaMatch[1].trim().toLowerCase();
      if (t.includes("inscripto") || t.includes("responsable")) condicion_iva = "RI";
      else if (t.includes("monotributo") || t.includes("monotributista")) condicion_iva = "Monotributo";
      else if (t.includes("exento")) condicion_iva = "Exento";
    }
    if (html.includes("linea-monotributo-persona") && condicion_iva === "CF") condicion_iva = "Monotributo";

    let localidad = "";
    let provincia = "";
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      const locMatch = titleMatch[1].match(/\([\d\-]+\),\s*([^(]+?)\s*\(([^)]+)\)/);
      if (locMatch) { localidad = locMatch[1].trim(); provincia = locMatch[2].trim(); }
    }

    let tipo_persona = "";
    if (html.includes("Persona Jurídica") || html.includes("Persona Juridica")) tipo_persona = "JURIDICA";
    else if (html.includes("Persona Física") || html.includes("Persona Fisica")) tipo_persona = "FISICA";

    return { razon_social, condicion_iva, direccion: "", localidad, provincia, cp: "", tipo_persona, estado_clave: "ACTIVO" };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const cuit = request.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");

  if (!cuit || cuit.length !== 11) {
    return NextResponse.json(
      { error: "CUIT invalido. Debe tener 11 digitos." },
      { status: 400 }
    );
  }

  // 1. ARCA padron A13 con cert Lazzari
  const arcaResult = await tryArcaPadron(cuit);
  if (arcaResult) return NextResponse.json(arcaResult);

  // 2. Fallback: cert Grupo LA
  const grupoLAResult = await tryArcaPadronGrupoLA(cuit);
  if (grupoLAResult) return NextResponse.json(grupoLAResult);

  // 3. Fallback: scraping cuitonline.com
  const cuitOnlineResult = await tryCuitOnline(cuit);
  if (cuitOnlineResult) return NextResponse.json(cuitOnlineResult);

  return NextResponse.json(
    { error: "No se pudo obtener datos del CUIT. Ingresá los datos manualmente." },
    { status: 503 }
  );
}
