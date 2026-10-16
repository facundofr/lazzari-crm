/**
 * ARCA → "Mis Comprobantes" → Recibidos (CSV, montos en pesos): todas las facturas que nos hicieron los proveedores.
 * Sirve para saber qué factura paga cada transferencia a un proveedor (por CUIT + importe exacto), aunque no esté
 * cargada en Compras (16/10/2026). Funciones puras. Prueba: npx tsx scripts/test-arca-recibidos.ts
 */

export interface FacturaArca {
  fecha: string;       // YYYY-MM-DD
  tipo: string;        // FA, FB, FC, NCA…
  punto_venta: number;
  numero: number;
  cuit: string;        // emisor
  emisor: string;
  neto: number;
  iva: number;
  total: number;
  esNC: boolean;
}

const TIPOS: Record<string, string> = { "1": "FA", "2": "NDA", "3": "NCA", "6": "FB", "7": "NDB", "8": "NCB", "11": "FC", "12": "NDC", "13": "NCC", "51": "FM", "201": "FCEA", "203": "NCEA", "206": "FCEB", "211": "FCEC" };
const num = (s: string) => Number(String(s || "0").replace(/\./g, "").replace(",", ".")) || 0;

/** Lee el CSV (separado por ";", con comillas). Devuelve [] si no es el formato de ARCA. */
export function leerArcaRecibidos(csv: string): FacturaArca[] {
  const filas = String(csv || "").split(/\r?\n/).filter((l) => l.trim());
  if (!filas.length) return [];
  const cab = filas[0].split(";").map((c) => c.replace(/^"|"$/g, "").trim().toLowerCase());
  const col = (nombre: RegExp) => cab.findIndex((c) => nombre.test(c));
  const iFecha = col(/fecha de emisi/), iTipo = col(/tipo de comprobante/), iPv = col(/punto de venta/), iNum = col(/n[úu]mero desde/);
  const iDoc = col(/nro\.? doc\.? emisor/), iNom = col(/denominaci[óo]n emisor/), iNeto = col(/imp\.? neto gravado total/), iIva = col(/total iva/), iTot = col(/imp\.? total/);
  if ([iFecha, iTipo, iPv, iNum, iDoc, iTot].some((i) => i < 0)) return [];
  return filas.slice(1).map((l) => {
    const c = l.split(";").map((x) => x.replace(/^"|"$/g, "").trim());
    const codigo = String(Number(c[iTipo]) || c[iTipo]);
    const tipo = TIPOS[codigo] || codigo;
    return {
      fecha: c[iFecha], tipo, punto_venta: Number(c[iPv]) || 0, numero: Number(c[iNum]) || 0,
      cuit: String(c[iDoc] || "").replace(/\D/g, ""), emisor: c[iNom] || "", neto: num(c[iNeto]), iva: num(c[iIva]), total: num(c[iTot]),
      esNC: /^NC/.test(tipo),
    };
  }).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.fecha) && f.cuit.length === 11);
}

/**
 * Factura que paga una salida al CUIT `cuit` por `importe`: mismo total al centavo, emitida hasta 5 días después del pago.
 * Si hay varias del mismo importe (abono mensual), la más reciente anterior al pago y no usada; `unica` = false.
 */
export function facturaDelPago(cuit: string, importe: number, fecha: string, facturas: FacturaArca[], usadas: Set<string> = new Set()) {
  const cent = (n: number) => Math.round(Math.abs(n) * 100);
  const limite = new Date(`${fecha}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + 5);
  const tope = limite.toISOString().slice(0, 10);
  const clave = (f: FacturaArca) => `${f.cuit}|${f.tipo}|${f.punto_venta}|${f.numero}`;
  const cands = facturas.filter((f) => !f.esNC && f.cuit === cuit && cent(f.total) === cent(importe) && f.fecha <= tope && !usadas.has(clave(f)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!cands.length) return null;
  const antes = cands.filter((f) => f.fecha <= fecha);
  const f = antes[0] || cands[cands.length - 1];
  usadas.add(clave(f));
  return { factura: f, unica: cands.length === 1 };
}

export const numeroFactura = (f: { tipo: string; punto_venta: number; numero: number }) =>
  `${f.tipo} ${String(f.punto_venta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}`;
