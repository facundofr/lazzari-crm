import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cuit-lookup?cuit=XXXXXXXXXXX
 * Consulta el padron de AFIP via la API gratuita de tangofactura
 * y devuelve razon social, condicion IVA, direccion, localidad, provincia.
 */

interface TangoResponse {
  success: boolean;
  errorGetData: boolean;
  errorMessage: string | null;
  razonSocial: string;
  tipoPersona: string;
  tipoClave: string;
  estadoClave: string;
  domicilioFiscal: {
    direccion: string;
    localidad: string;
    codPostal: string;
    idProvincia: string;
    descripcionProvincia: string;
  };
  idImpuesto: number[];
  impuestos: string[];
}

function detectCondicionIva(impuestoIds: number[]): string {
  if (impuestoIds.includes(30) || impuestoIds.includes(32)) return "RI";
  if (impuestoIds.includes(20)) return "Monotributo";
  if (impuestoIds.includes(34)) return "Exento";
  return "CF";
}

const PROVINCIA_MAP: Record<string, string> = {
  "0": "CABA",
  "1": "Buenos Aires",
  "2": "Catamarca",
  "3": "Córdoba",
  "4": "Corrientes",
  "5": "Entre Ríos",
  "6": "Jujuy",
  "7": "Mendoza",
  "8": "La Rioja",
  "9": "Salta",
  "10": "San Juan",
  "11": "San Luis",
  "12": "Santa Fe",
  "13": "Santiago del Estero",
  "14": "Tucumán",
  "16": "Chaco",
  "17": "Chubut",
  "18": "Formosa",
  "19": "Misiones",
  "20": "Neuquén",
  "21": "La Pampa",
  "22": "Río Negro",
  "23": "Santa Cruz",
  "24": "Tierra del Fuego",
};

export async function GET(request: NextRequest) {
  const cuit = request.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");

  if (!cuit || cuit.length !== 11) {
    return NextResponse.json(
      { error: "CUIT invalido. Debe tener 11 digitos." },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://afip.tangofactura.com/Rest/GetContribuyenteById?cuit=${cuit}`,
      {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Error consultando AFIP (HTTP ${res.status})` },
        { status: 502 }
      );
    }

    const data: TangoResponse = await res.json();

    if (data.errorGetData || !data.razonSocial) {
      return NextResponse.json(
        { error: data.errorMessage || "CUIT no encontrado en el padron de AFIP" },
        { status: 404 }
      );
    }

    const provinciaId = data.domicilioFiscal?.idProvincia ?? "";
    const provincia =
      PROVINCIA_MAP[provinciaId] ||
      data.domicilioFiscal?.descripcionProvincia ||
      "";

    return NextResponse.json({
      razon_social: data.razonSocial,
      condicion_iva: detectCondicionIva(data.idImpuesto || []),
      direccion: data.domicilioFiscal?.direccion || "",
      localidad: data.domicilioFiscal?.localidad || "",
      provincia,
      cp: data.domicilioFiscal?.codPostal || "",
      tipo_persona: data.tipoPersona || "",
      estado_clave: data.estadoClave || "",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      { error: `No se pudo consultar AFIP: ${message}` },
      { status: 500 }
    );
  }
}
