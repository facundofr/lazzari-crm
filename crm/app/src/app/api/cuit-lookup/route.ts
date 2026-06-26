import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

/**
 * GET /api/cuit-lookup?cuit=XXXXXXXXXXX
 * Consulta el padron de AFIP via ws_sr_padron (autenticado con certificado ARCA)
 * Fallback: intenta múltiples APIs públicas gratuitas.
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

function getArcaInstance() {
  const certPath = path.join(process.cwd(), "..", "certs", "lazzari.crt");
  const keyPath = path.join(process.cwd(), "..", "certs", "lazzari.key");

  let cert = "";
  if (process.env.ARCA_CERT_B64) {
    cert = Buffer.from(process.env.ARCA_CERT_B64, "base64").toString("utf-8");
  } else if (fs.existsSync(certPath)) {
    cert = fs.readFileSync(certPath, "utf-8");
  }

  let key = "";
  if (process.env.ARCA_KEY_B64) {
    key = Buffer.from(process.env.ARCA_KEY_B64, "base64").toString("utf-8");
  } else if (fs.existsSync(keyPath)) {
    key = fs.readFileSync(keyPath, "utf-8");
  }

  if (!cert || !key) return null;

  const cuit = Number(process.env.ARCA_CUIT || "20379309128");
  const production = process.env.ARCA_PRODUCTION !== "false";
  return new Arca({ cuit, cert, key, production });
}

function detectCondicionIva(impuestoIds: number[]): string {
  if (impuestoIds.includes(30) || impuestoIds.includes(32)) return "RI";
  if (impuestoIds.includes(20)) return "Monotributo";
  if (impuestoIds.includes(34)) return "Exento";
  return "CF";
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

function mapPersonaToResult(persona: any) {
  const impuestoIds = (persona.impuestos || []).map((i: any) => i.id);
  const domicilio = persona.domicilioFiscal || {};

  let provincia = "";
  if (domicilio.codPostal && domicilio.codPostal.length >= 1) {
    provincia = (domicilio as any).descripcionProvincia || (domicilio as any).nombreProvincia || "";
  }
  if (!provincia && (domicilio as any).idProvincia != null) {
    provincia = PROVINCIA_MAP[String((domicilio as any).idProvincia)] || "";
  }

  return {
    razon_social: persona.nombre || "",
    condicion_iva: detectCondicionIva(impuestoIds),
    direccion: domicilio.direccion || "",
    localidad: domicilio.localidad || "",
    provincia,
    cp: domicilio.codPostal || "",
    tipo_persona: persona.tipoPersona || "",
    estado_clave: persona.estadoClave || "",
  };
}

// Try ARCA padron — tries both consultarCuit (a13) and consultarCuitDetalle (a5)
async function tryArcaPadron(cuit: string) {
  try {
    await loadArca();
    const arca = getArcaInstance();
    if (!arca) {
      console.warn("ARCA padron: no cert/key configured, skipping");
      return null;
    }

    // Try consultarCuit first (ws_sr_padron_a13)
    try {
      const persona = await arca.consultarCuit(Number(cuit));
      if (persona) return mapPersonaToResult(persona);
    } catch (e: any) {
      console.warn("consultarCuit failed:", e.message);
    }

    // Fallback: consultarCuitDetalle (ws_sr_padron_a5)
    try {
      const persona = await arca.consultarCuitDetalle(Number(cuit));
      if (persona) return mapPersonaToResult(persona);
    } catch (e: any) {
      console.warn("consultarCuitDetalle failed:", e.message);
    }

    return null;
  } catch (err) {
    console.error("ARCA padron error:", err);
    return null;
  }
}

// Fallback: try ARCA with the other sociedad cert (Grupo LA)
async function tryArcaPadronGrupoLA(cuit: string) {
  try {
    await loadArca();

    let cert = "";
    if (process.env.ARCA_GRUPOLA_CERT_B64) {
      cert = Buffer.from(process.env.ARCA_GRUPOLA_CERT_B64, "base64").toString("utf-8");
    }
    let key = "";
    if (process.env.ARCA_GRUPOLA_KEY_B64) {
      key = Buffer.from(process.env.ARCA_GRUPOLA_KEY_B64, "base64").toString("utf-8");
    }

    if (!cert || !key) return null;

    const arca = new Arca({ cuit: 30719396042, cert, key, production: process.env.ARCA_PRODUCTION !== "false" });

    try {
      const persona = await arca.consultarCuit(Number(cuit));
      if (persona) return mapPersonaToResult(persona);
    } catch (e: any) {
      console.warn("GrupoLA consultarCuit failed:", e.message);
    }

    try {
      const persona = await arca.consultarCuitDetalle(Number(cuit));
      if (persona) return mapPersonaToResult(persona);
    } catch (e: any) {
      console.warn("GrupoLA consultarCuitDetalle failed:", e.message);
    }

    return null;
  } catch (err) {
    console.error("ARCA Grupo LA padron error:", err);
    return null;
  }
}

// Fallback: scraping de cuitonline.com (HTML)
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

    // No results page
    if (html.includes("no obtuvo resultados")) return null;

    // Extract razon_social from <h2 class="denominacion">
    const nombreMatch = html.match(/<h2[^>]*class="denominacion"[^>]*>([^<]+)</);
    if (!nombreMatch) return null;
    const razon_social = nombreMatch[1].trim();

    // Extract condicion IVA
    let condicion_iva = "CF";
    const ivaMatch = html.match(/IVA:(?:&nbsp;|\s)+([^<\n&]+)/);
    if (ivaMatch) {
      const ivaText = ivaMatch[1].trim().toLowerCase();
      if (ivaText.includes("inscripto") || ivaText.includes("responsable")) condicion_iva = "RI";
      else if (ivaText.includes("monotributo") || ivaText.includes("monotributista")) condicion_iva = "Monotributo";
      else if (ivaText.includes("exento")) condicion_iva = "Exento";
    }
    if (html.includes("linea-monotributo-persona") && condicion_iva === "CF") condicion_iva = "Monotributo";

    // Extract localidad and provincia from page title
    // Format: "NOMBRE (CUIT), Localidad (Provincia) - Cuit Online"
    let localidad = "";
    let provincia = "";
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      const locMatch = titleMatch[1].match(/\([\d\-]+\),\s*([^(]+?)\s*\(([^)]+)\)/);
      if (locMatch) {
        localidad = locMatch[1].trim();
        provincia = locMatch[2].trim();
      }
    }

    let tipo_persona = "";
    if (html.includes("Persona Jurídica") || html.includes("Persona Juridica")) tipo_persona = "JURIDICA";
    else if (html.includes("Persona Física") || html.includes("Persona Fisica")) tipo_persona = "FISICA";

    return {
      razon_social,
      condicion_iva,
      direccion: "",
      localidad,
      provincia,
      cp: "",
      tipo_persona,
      estado_clave: "ACTIVO",
    };
  } catch {
    return null;
  }
}

// Fallback: padrón público de AFIP (sin certificados)
async function tryPadronPublico(cuit: string) {
  const urls = [
    `https://soa.afip.gob.ar/sr-padron/v2/persona/${cuit}`,
    `https://afip.tangofactura.com/Rest/GetContribuyenteFull?cuit=${cuit}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();

      // soa.afip.gob.ar format
      if (data?.data) {
        const p = data.data;
        const impuestoIds = (p.impuestos || []).map((i: any) => Number(i.idImpuesto || i.id));
        const dom = p.domicilioFiscal || {};
        const provincia =
          dom.descripcionProvincia || dom.nombreProvincia ||
          PROVINCIA_MAP[String(dom.idProvincia ?? "")] || "";
        return {
          razon_social: p.nombre || p.razonSocial || "",
          condicion_iva: detectCondicionIva(impuestoIds),
          direccion: dom.direccion || "",
          localidad: dom.localidad || "",
          provincia,
          cp: dom.codPostal || "",
          tipo_persona: p.tipoPersona || "",
          estado_clave: p.estadoClave || "",
        };
      }

      // tangofactura format
      if (data?.Contribuyente) {
        const p = data.Contribuyente;
        return {
          razon_social: p.razonSocial || p.nombre || "",
          condicion_iva: p.condicionIva || "CF",
          direccion: p.direccion || "",
          localidad: p.localidad || "",
          provincia: p.provincia || "",
          cp: p.cp || "",
          tipo_persona: "",
          estado_clave: "",
        };
      }
    } catch {
      // try next
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const cuit = request.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");

  if (!cuit || cuit.length !== 11) {
    return NextResponse.json(
      { error: "CUIT invalido. Debe tener 11 digitos." },
      { status: 400 }
    );
  }

  // 1. Try ARCA authenticated padron (más datos, requiere cert)
  const arcaResult = await tryArcaPadron(cuit);
  if (arcaResult) return NextResponse.json(arcaResult);

  // 2. Fallback: Grupo LA cert
  const grupoLAResult = await tryArcaPadronGrupoLA(cuit);
  if (grupoLAResult) return NextResponse.json(grupoLAResult);

  // 3. Fallback: padrón público sin certificados
  const publicResult = await tryPadronPublico(cuit);
  if (publicResult) return NextResponse.json(publicResult);

  // 4. Fallback: scraping cuitonline.com
  const cuitOnlineResult = await tryCuitOnline(cuit);
  if (cuitOnlineResult) return NextResponse.json(cuitOnlineResult);

  return NextResponse.json(
    { error: "No se pudo obtener datos del CUIT. Ingresá los datos manualmente." },
    { status: 503 }
  );
}
