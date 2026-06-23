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

// Try ARCA padron (authenticated, most reliable)
async function tryArcaPadron(cuit: string) {
  try {
    await loadArca();
    const arca = getArcaInstance();
    if (!arca) {
      console.warn("ARCA padron: no cert/key configured, skipping");
      return null;
    }

    const persona = await arca.consultarCuit(Number(cuit));
    if (!persona) return null;

    const impuestoIds = (persona.impuestos || []).map((i: any) => i.id);
    const domicilio = persona.domicilioFiscal || {};

    // Try to resolve provincia from codPostal or from the raw domicilio data
    let provincia = "";
    if (domicilio.codPostal && domicilio.codPostal.length >= 1) {
      // codPostal prefix sometimes maps to provincia, but it's unreliable
      // Prefer descripcionProvincia if available from raw data
      provincia = (domicilio as any).descripcionProvincia || (domicilio as any).nombreProvincia || "";
    }
    // If still empty, check idProvincia in domicilio
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
    const persona = await arca.consultarCuit(Number(cuit));
    if (!persona) return null;

    const impuestoIds = (persona.impuestos || []).map((i: any) => i.id);
    const domicilio = persona.domicilioFiscal || {};
    let provincia = (domicilio as any).descripcionProvincia || (domicilio as any).nombreProvincia || "";
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
  } catch (err) {
    console.error("ARCA Grupo LA padron error:", err);
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

  // Try ARCA authenticated padron first (most reliable)
  const arcaResult = await tryArcaPadron(cuit);
  if (arcaResult) {
    return NextResponse.json(arcaResult);
  }

  // Fallback: try with Grupo LA cert
  const grupoLAResult = await tryArcaPadronGrupoLA(cuit);
  if (grupoLAResult) {
    return NextResponse.json(grupoLAResult);
  }

  return NextResponse.json(
    { error: "No se pudo consultar el CUIT. Verifica que los certificados ARCA estén configurados y que el CUIT sea válido." },
    { status: 503 }
  );
}
