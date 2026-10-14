// Lectura de una factura de compra por el TEXTO del PDF, con reglas fijas (sin IA).
// Se usa cuando el PDF no tiene QR de ARCA legible. Saca: CUIT del emisor, tipo, número, fecha, total, neto, IVA y CAE.
// Lo que no encuentra queda vacío para completar a mano.

import { cuitConGuiones } from "./factura-qr-arca";

export interface DatosTextoFactura {
  cuitEmisor: string | null;
  tipoComprobante: string | null;   // "FACTURA A", "NOTA DE CREDITO B", …
  numero: string | null;            // 00012-00012760
  fecha: string | null;             // YYYY-MM-DD
  fechaVencimiento: string | null;
  total: number | null;
  neto: number | null;
  iva: number | null;
  ivaPorcentaje: number | null;     // 21 / 10,5 / 27 si hay una sola alícuota; null si hay varias o no se sabe
  cae: string | null;
  moneda: "ARS" | "USD";
  encontrados: number;              // cuántos de los datos principales (CUIT, número, fecha, total) encontró
}

/** CUIT válido (dígito verificador). */
export function cuitValido(cuit: string): boolean {
  const d = cuit.replace(/\D/g, "");
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(d[10]);
}

/** "1.234.567,89" / "1,234,567.89" / "1234567.89" / "$ 1.234,5" → número. */
export function importeArgentino(s: string): number | null {
  const t = s.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return null;
  const ultComa = t.lastIndexOf(",");
  const ultPunto = t.lastIndexOf(".");
  let normal: string;
  if (ultComa > ultPunto) normal = t.replace(/\./g, "").replace(",", ".");
  else if (ultPunto > ultComa && ultComa !== -1) normal = t.replace(/,/g, "");
  else if (ultPunto !== -1 && t.length - ultPunto - 1 === 3 && (t.match(/\./g) || []).length >= 1 && !/\.\d{1,2}$/.test(t)) normal = t.replace(/\./g, "");
  else normal = t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

function fechaISO(dd: string, mm: string, aa: string): string | null {
  const a = aa.length === 2 ? `20${aa}` : aa;
  const d = Number(dd), m = Number(mm), y = Number(a);
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= 2100)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const RE_IMPORTE = String.raw`\$?\s*(-?[\d.,]*\d[.,]\d{2})\b`;

function importeTrasEtiqueta(texto: string, etiquetas: RegExp): number | null {
  // Toma la ÚLTIMA aparición (el total suele estar al pie, después de subtotales).
  const re = new RegExp(`(?:${etiquetas.source})[^\\d$\\n]{0,40}${RE_IMPORTE}`, "gi");
  let ultimo: number | null = null;
  for (const m of texto.matchAll(re)) {
    const n = importeArgentino(m[1]);
    if (n != null) ultimo = n;
  }
  return ultimo;
}

/**
 * @param texto texto del PDF (todas las páginas)
 * @param cuitsPropios CUIT de nuestras sociedades: se descartan para quedarse con el del proveedor
 * @param opts.nombreArchivo nombre del PDF (si trae el número de comprobante, se usa cuando el texto no lo etiqueta)
 */
export function leerTextoFactura(texto: string, cuitsPropios: string[] = [], opts: { nombreArchivo?: string } = {}): DatosTextoFactura {
  const t = (texto || "").replace(/ /g, " ");
  const propios = new Set(cuitsPropios.map((c) => c.replace(/\D/g, "")));

  // CUIT: el primero válido que no sea nuestro (el del emisor va arriba).
  let cuitEmisor: string | null = null;
  for (const m of t.matchAll(/\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/g)) {
    const c = `${m[1]}${m[2]}${m[3]}`;
    if (!propios.has(c) && cuitValido(c)) { cuitEmisor = c; break; }
  }

  // Tipo: "NOTA DE CRÉDITO", "NOTA DE DÉBITO" o "FACTURA" + letra (A/B/C/M) cerca.
  let tipoComprobante: string | null = null;
  const tU = t.toUpperCase();
  const clase = /NOTA\s+DE\s+CR[EÉ]DITO/.test(tU) ? "NOTA DE CREDITO" : /NOTA\s+DE\s+D[EÉ]BITO/.test(tU) ? "NOTA DE DEBITO" : /FACTURA/.test(tU) ? "FACTURA" : null;
  const letra = tU.match(/\bC[OÓ]D(?:IGO|\.)?\s*(?:N[°ºO.]?\s*)?0?(01|02|03|06|07|08|11|12|13)\b/)
    ? ({ "01": "A", "02": "A", "03": "A", "06": "B", "07": "B", "08": "B", "11": "C", "12": "C", "13": "C" } as Record<string, string>)[
        tU.match(/\bC[OÓ]D(?:IGO|\.)?\s*(?:N[°ºO.]?\s*)?0?(01|02|03|06|07|08|11|12|13)\b/)![1]]
    : (tU.match(/(?:FACTURA|CR[EÉ]DITO|D[EÉ]BITO)\s*(?:ELECTR[OÓ]NICA\s*)?\(?\s*([ABCM])\s*\)?(?:\s|$)/) || tU.match(/^\s*([ABCM])\s*$/m) || [])[1] || null;
  if (clase) tipoComprobante = letra ? `${clase} ${letra}` : clase;
  if (/FCE|MIPYME/.test(tU) && clase === "NOTA DE CREDITO" && letra && letra !== "C") tipoComprobante = `NOTA DE CREDITO FCE MIPYME ${letra}`;

  // Número: "Punto de Venta: 00012  Comp. Nro: 00012760" o "0012-00012760".
  let numero: string | null = null;
  const pv = t.match(/Punto\s+de\s+Venta[:\s]*0*(\d{1,5})[\s\S]{0,40}?(?:Comp(?:robante)?\.?\s*)?N(?:ro|°|º|úmero|umero)\.?[:\s]*0*(\d{1,8})/i);
  if (pv) numero = `${pv[1].padStart(5, "0")}-${pv[2].padStart(8, "0")}`;
  if (!numero) {
    for (const n of t.matchAll(/(?<!\d)(\d{4,5})\s*-\s*(\d{8})(?!\d)/g)) {
      const antes = t.slice(Math.max(0, (n.index ?? 0) - 18), n.index ?? 0);
      if (/PED|REM|O\.?\s?C\b|ORDEN|PRESUP/i.test(antes)) continue; // pedido, remito u OC: no es el número de la factura
      numero = `${n[1].padStart(5, "0")}-${n[2]}`;
      break;
    }
  }

  // Si el texto no lo trae, el nombre del archivo suele traerlo ("FCA-0002-00006290.pdf", "A-0005-00005144-…").
  const nArchivo = (opts.nombreArchivo || "").match(/(?<!\d)(\d{4,5})\s*-\s*(\d{8})(?!\d)/);
  if (!numero && nArchivo) numero = `${nArchivo[1].padStart(5, "0")}-${nArchivo[2]}`;

  // Fechas: la de emisión (etiquetada o la primera que no sea de inicio de actividades, CAE ni vencimiento), y el vencimiento etiquetado.
  const reFecha = String.raw`(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})`;
  let fecha: string | null = null;
  const fe = t.match(new RegExp(String.raw`Fecha\s+de\s+Emisi[oó]n[:\s]*` + reFecha, "i")) || t.match(new RegExp(String.raw`\bFecha[:\s]+` + reFecha, "i"));
  if (fe) fecha = fechaISO(fe[1], fe[2], fe[3]);
  if (!fecha) {
    for (const f of t.matchAll(new RegExp(reFecha, "g"))) {
      const antes = t.slice(Math.max(0, (f.index ?? 0) - 45), f.index ?? 0);
      if (/Inicio|Actividad|CAE|Vto|Venc/i.test(antes)) continue;
      fecha = fechaISO(f[1], f[2], f[3]);
      if (fecha) break;
    }
  }
  let fechaVencimiento: string | null = null;
  const fv = t.match(new RegExp(String.raw`(?<!CAE[:\s]{0,3})Vto\.?\s*(?:para\s+el\s+)?(?:de\s+)?(?:pago)?[:\s]*` + reFecha, "i"))
    || t.match(new RegExp(String.raw`Vencimiento(?:\s+de\s+pago)?[:\s]*` + reFecha, "i"));
  if (fv && !/CAE\s*$/i.test(t.slice(Math.max(0, (fv.index ?? 0) - 12), fv.index ?? 0))) fechaVencimiento = fechaISO(fv[1], fv[2], fv[3]);

  const { total, neto, iva, ivaPorcentaje } = importesFactura(t);

  const caeM = t.match(/C\.?A\.?E\.?\s*(?:N[°ºo.]*)?[:\s]*(\d{14})\b/i);
  const cae = caeM ? caeM[1] : null;

  const moneda: "ARS" | "USD" = /\b(?:U\$S|USD|D[OÓ]LAR(?:ES)?\s+ESTADOUNIDENSES?)\b/i.test(t) && !/Moneda[:\s]*(?:PES|\$|ARS)/i.test(t) ? "USD" : "ARS";

  const encontrados = [cuitEmisor, numero, fecha, total].filter((x) => x != null).length;
  return { cuitEmisor, tipoComprobante, numero, fecha, fechaVencimiento, total, neto, iva, ivaPorcentaje, cae, moneda, encontrados };
}

const casi = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.0005);

/**
 * Total, neto e IVA. Muchos PDF separan las etiquetas de los valores, así que además de las etiquetas se usa la cuenta:
 * el total es el importe más grande; el neto es el que, sumándole 21 / 10,5 / 27 %, da el total (o la suma de los IVA).
 */
export function importesFactura(t: string): { total: number | null; neto: number | null; iva: number | null; ivaPorcentaje: number | null } {
  const montos = [...new Set([...t.matchAll(/(?<![\d.,])(-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})(?![\d.,]*\d)/g)]
    .map((m) => importeArgentino(m[1])).filter((n): n is number => n != null && n > 0))];
  const etiquetaTotal = importeTrasEtiqueta(t, /Importe\s+Total|Total\s+a\s+Pagar|TOTAL(?!\s*(?:NETO|IVA|BRUTO|BONIF|DESC|MEDIC))/);
  const maximo = montos.length ? Math.max(...montos) : null;
  const netoEtiq = importeTrasEtiqueta(t, /Importe\s+Neto\s+Gravado|Neto\s+Gravado(?:\s+al\s+\d+%)?|Subtotal/);
  // Se prueba primero el total etiquetado y después el importe más grande: gana el primero que "cierra" con un neto + IVA.
  const candidatos = [...new Set([etiquetaTotal, maximo].filter((n): n is number => n != null))];
  for (const total of candidatos) {
    const r = desglose(total, montos, netoEtiq);
    if (r) return { total, ...r };
  }
  const total = etiquetaTotal ?? maximo;
  return { total, neto: null, iva: null, ivaPorcentaje: null };
}

function desglose(total: number, montos: number[], netoEtiq: number | null): { neto: number; iva: number; ivaPorcentaje: number | null } | null {
  // 1) Una sola alícuota: neto × (1 + p) = total.
  for (const p of [21, 10.5, 27]) {
    const neto = montos.find((n) => n < total && casi(Math.round(n * (1 + p / 100) * 100) / 100, total));
    if (neto != null) return { neto, iva: Math.round((total - neto) * 100) / 100, ivaPorcentaje: p };
  }
  // 2) Neto y uno o dos importes de IVA que cierran el total (alícuotas mezcladas o percepciones).
  const netos = [netoEtiq, ...montos].filter((n): n is number => n != null && n < total && n > total * 0.6);
  for (const neto of netos) {
    const resto = Math.round((total - neto) * 100) / 100;
    const ivas = montos.filter((m) => m < neto * 0.28);
    if (ivas.some((a) => casi(a, resto))) return { neto, iva: resto, ivaPorcentaje: null };
    for (let i = 0; i < ivas.length; i++) for (let j = i + 1; j < ivas.length; j++) {
      if (casi(ivas[i] + ivas[j], resto)) return { neto, iva: resto, ivaPorcentaje: null };
    }
  }
  return null;
}

/** Datos del texto con la forma de /api/parse-factura-compra (solo encabezado). */
export function textoComoImportacion(d: DatosTextoFactura) {
  const ivaPct = d.ivaPorcentaje;
  return {
    proveedor: { razon_social: "", nombre_fantasia: "", cuit: d.cuitEmisor ? cuitConGuiones(d.cuitEmisor) : "" },
    fecha: d.fecha,
    fecha_vencimiento: d.fechaVencimiento,
    numero_factura: d.numero,
    cae: d.cae,
    tipo_comprobante: d.tipoComprobante ?? "",
    moneda: d.moneda,
    subtotal: d.neto,
    iva_porcentaje: ivaPct != null && [10.5, 21, 27].includes(ivaPct) ? ivaPct : null,
    iva: d.iva,
    total: d.total,
    items: [],
    referencias_oc: [],
    origen_lectura: "texto" as const,
  };
}
