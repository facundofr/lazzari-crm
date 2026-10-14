// Lectura del QR de ARCA (ex AFIP) de una factura electrónica, sin IA.
// El QR es un link https://www.afip.gob.ar/fe/qr/?p=<base64 de un JSON> (o arca.gob.ar) con:
// ver, fecha, cuit (emisor), ptoVta, tipoCmp, nroCmp, importe, moneda (PES/DOL/…), ctz, tipoDocRec, nroDocRec, tipoCodAut, codAut (CAE/CAEA).
// Devuelve los datos con la misma forma que /api/parse-factura-compra (para usar el mismo "applyImportedData").

export interface DatosQrArca {
  ver: number | null;
  fecha: string;            // YYYY-MM-DD
  cuitEmisor: string;       // 11 dígitos
  puntoVenta: number;
  tipoCmp: number;
  numero: number;
  importe: number;
  moneda: "ARS" | "USD" | string;
  cotizacion: number | null;
  docReceptor: string | null;
  cae: string | null;
}

/** Códigos de comprobante de ARCA → nombre que entiende la carga de facturas de compra. */
const TIPOS_CMP: Record<number, string> = {
  1: "FACTURA A", 2: "NOTA DE DEBITO A", 3: "NOTA DE CREDITO A",
  6: "FACTURA B", 7: "NOTA DE DEBITO B", 8: "NOTA DE CREDITO B",
  11: "FACTURA C", 12: "NOTA DE DEBITO C", 13: "NOTA DE CREDITO C",
  51: "FACTURA M", 52: "NOTA DE DEBITO M", 53: "NOTA DE CREDITO M",
  201: "FACTURA A", 202: "NOTA DE DEBITO A", 203: "NOTA DE CREDITO FCE MIPYME A",
  206: "FACTURA B", 207: "NOTA DE DEBITO B", 208: "NOTA DE CREDITO FCE MIPYME B",
  211: "FACTURA C", 212: "NOTA DE DEBITO C", 213: "NOTA DE CREDITO C",
};

export function tipoComprobanteArca(tipoCmp: number): string | null {
  return TIPOS_CMP[tipoCmp] ?? null;
}

function base64Decode(s: string): string {
  const limpio = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const conRelleno = limpio + "===".slice((limpio.length + 3) % 4);
  if (typeof atob === "function") {
    const bin = atob(conRelleno);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(conRelleno, "base64").toString("utf8");
}

function soloDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Lee el texto del QR. Devuelve null si no es un QR de factura de ARCA válido. */
export function leerQrArca(texto: string): DatosQrArca | null {
  const t = (texto || "").trim();
  if (!/(afip|arca)\.gob\.ar\/fe\/qr/i.test(t)) return null;
  const m = t.match(/[?&]p=([^&#\s]+)/);
  if (!m) return null;
  let json: any;
  try {
    json = JSON.parse(base64Decode(decodeURIComponent(m[1])));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const cuit = soloDigitos(json.cuit);
  const ptoVta = Number(json.ptoVta);
  const tipoCmp = Number(json.tipoCmp);
  const nro = Number(json.nroCmp);
  const fecha = String(json.fecha || "").slice(0, 10);
  if (cuit.length !== 11 || !(ptoVta > 0) || !(tipoCmp > 0) || !(nro > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const monedaArca = String(json.moneda || "PES").toUpperCase();
  const moneda = monedaArca === "PES" ? "ARS" : monedaArca === "DOL" ? "USD" : monedaArca;
  const ctz = Number(json.ctz);
  const cae = soloDigitos(json.codAut);
  return {
    ver: json.ver != null ? Number(json.ver) : null,
    fecha,
    cuitEmisor: cuit,
    puntoVenta: ptoVta,
    tipoCmp,
    numero: nro,
    importe: Number(json.importe) || 0,
    moneda,
    cotizacion: Number.isFinite(ctz) && ctz > 0 ? ctz : null,
    docReceptor: soloDigitos(json.nroDocRec) || null,
    cae: cae || null,
  };
}

export function numeroComprobante(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

export function cuitConGuiones(cuit: string): string {
  const d = soloDigitos(cuit);
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
}

/** Datos del QR con la forma de /api/parse-factura-compra (solo encabezado: el QR no trae renglones ni IVA). */
export function qrArcaComoImportacion(q: DatosQrArca) {
  return {
    proveedor: { razon_social: "", nombre_fantasia: "", cuit: cuitConGuiones(q.cuitEmisor) },
    fecha: q.fecha,
    fecha_vencimiento: null,
    numero_factura: numeroComprobante(q.puntoVenta, q.numero),
    cae: q.cae,
    tipo_comprobante: tipoComprobanteArca(q.tipoCmp) ?? "",
    moneda: q.moneda === "USD" ? "USD" : "ARS",
    tipo_cambio: q.moneda === "USD" ? q.cotizacion : null,
    total: q.importe,
    items: [],
    referencias_oc: [],
    origen_lectura: "qr" as const,
  };
}
