/**
 * Línea del archivo de importación de retenciones de SICORE, "Estándar Retenciones Versión 9.0".
 * Registro de longitud fija de 198 caracteres (21 campos). Si una línea no mide 198, el aplicativo
 * rechaza todo el archivo con "Las longitudes de los registros no son todas iguales...".
 *
 * Posiciones (desde, largo): 1,2 comprobante · 3,10 fecha · 13,16 nro comprobante · 29,16 importe ·
 * 45,4 impuesto · 49,3 régimen · 52,1 operación · 53,14 base · 67,10 fecha retención · 77,2 condición ·
 * 79,1 suspendidos · 80,14 importe retención · 94,6 % exclusión · 100,10 fecha boletín ·
 * 110,2 tipo doc · 112,20 nro doc · 132,14 certificado original · 146,30 denominación ordenante ·
 * 176,1 acrecentamiento · 177,11 CUIT país retenido · 188,11 CUIT ordenante.
 */

export const LONGITUD_REGISTRO_SICORE = 198;

/** Código de régimen RG 830 por concepto del proveedor (códigos del Anexo VIII, RG 4525). */
export const REGIMEN_RG830: Record<string, string> = {
  compraventa_bienes: "078",
  servicios: "094",
  honorarios: "116",
  alquileres_inmuebles: "031",
  alquileres_muebles: "030",
  intereses_financieros: "019",
  intereses_otros: "021",
  transporte: "095",
  fletes: "095",
  comisiones: "025",
  publicidad: "094",
  seguros: "094",
};

/** Texto a la izquierda, relleno con espacios a la derecha, cortado al largo. */
const izq = (s: string, len: number) => s.slice(0, len).padEnd(len, " ");
/** Número a la derecha, relleno con ceros a la izquierda. */
const cer = (s: string, len: number) => s.slice(-len).padStart(len, "0");

/** Importe con coma decimal, ceros a la izquierda y largo fijo (ej. 14 → 0000000012345,67). */
export function montoSicore(n: number, len: number): string {
  const [ent, dec] = Math.abs(Number(n) || 0).toFixed(2).split(".");
  return cer(ent, len - 3) + "," + dec;
}

/** YYYY-MM-DD → DD/MM/AAAA */
export function fechaSicore(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export interface LineaSicore {
  fecha: string;              // YYYY-MM-DD
  numeroComprobante: string;  // solo se usan los dígitos
  importeComprobante: number;
  conceptoRetencion?: string | null;
  baseCalculo: number;
  importeRetencion: number;
  cuit: string;               // CUIT del retenido
}

export function armarLineaSicore(l: LineaSicore): string {
  const fecha = fechaSicore(l.fecha);
  const linea = [
    "06",                                                   // código de comprobante: orden de pago
    fecha,                                                  // fecha del comprobante
    cer(String(l.numeroComprobante || "").replace(/\D/g, ""), 16),
    montoSicore(l.importeComprobante, 16),
    "0217",                                                 // impuesto: Ganancias
    REGIMEN_RG830[l.conceptoRetencion || "compraventa_bienes"] || "078",
    "1",                                                    // operación: retención
    montoSicore(l.baseCalculo, 14),
    fecha,                                                  // fecha de emisión de la retención
    "01",                                                   // condición: inscripto
    "0",                                                    // retención a sujetos suspendidos
    montoSicore(l.importeRetencion, 14),
    "000,00",                                               // % de exclusión
    fecha,                                                  // fecha de publicación / vigencia
    "80",                                                   // tipo de documento: CUIT
    izq(l.cuit.replace(/\D/g, ""), 20),
    "00000000000000",                                       // certificado original
    izq("", 30),                                            // denominación del ordenante
    "0",                                                    // acrecentamiento
    izq("", 11),                                            // CUIT del país retenido
    izq("", 11),                                            // CUIT del ordenante
  ].join("");
  if (linea.length !== LONGITUD_REGISTRO_SICORE) {
    throw new Error(`Registro SICORE de ${linea.length} caracteres (debe medir ${LONGITUD_REGISTRO_SICORE})`);
  }
  return linea;
}
