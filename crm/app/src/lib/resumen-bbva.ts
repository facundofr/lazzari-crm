/**
 * Resumen mensual en PDF del BBVA (Pymes y Negocios): al final trae, por cuenta, las secciones
 * "Transferencias ENVIADAS ACEPTADAS", "RECIBIDAS" y "Débitos automáticos REALIZADOS" con el CUIT y el nombre
 * de la otra parte, que el extracto en Excel no trae (16/10/2026). Se lee el texto del PDF (pdfjs) y se cruza
 * cada renglón con la línea del extracto por cuenta + importe + fecha cercana.
 * Funciones puras. Prueba: npx tsx scripts/test-resumen-bbva.ts
 */

export type SeccionResumen = "enviada" | "recibida" | "debito_automatico";

export interface ItemResumen {
  seccion: SeccionResumen;
  fecha: string;          // YYYY-MM-DD
  importe: number;        // positivo
  cuentaDigitos: string;  // "0913124831" (sucursal + número + dígito)
  cuit: string | null;
  nombre: string;         // "DONADIO", "MUNICIPALIDAD D", "COOP E PER ELECTRICO"
  detalle: string;        // referencia / servicio / factura del débito
}

/** Lo que se guarda en la línea del extracto (columna `contraparte`). */
export interface Contraparte {
  fuente: "resumen_bbva" | "arca";
  seccion?: SeccionResumen;
  nombre?: string | null;
  cuit?: string | null;
  detalle?: string | null;
  /** Factura de ARCA (Mis comprobantes recibidos) que paga esta salida. */
  factura?: { tipo: string; punto_venta: number; numero: number; fecha: string; total: number; emisor: string; cuit: string; unica: boolean } | null;
}

const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;
const digitos = (s: string) => String(s || "").replace(/\D/g, "");

/** CUIT de 11 dígitos al final de una tira de dígitos ("0020119172560" → "20119172560", "620146237283" → "20146237283"). */
function cuitDeTira(t: string): string | null {
  const m = t.match(/\d{11,13}/);
  if (!m) return null;
  const c = m[0].slice(-11);
  return /^(20|23|24|27|30|33|34)/.test(c) ? c : null;
}

export function leerResumenBbva(texto: string): { hasta: string | null; items: ItemResumen[] } {
  const lineas = String(texto || "").split(/\r?\n/);
  const items: ItemResumen[] = [];
  let seccion: SeccionResumen | null = null;
  let anio = "";
  let hasta: string | null = null;
  for (const raw of lineas) {
    const l = raw.trim();
    const info = l.match(/informaci[oó]n al:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (/^ENVIADAS ACEPTADAS/i.test(l)) seccion = "enviada";
    else if (/^RECIBIDAS/i.test(l)) seccion = "recibida";
    else if (/^REALIZADOS/i.test(l)) seccion = "debito_automatico";
    else if (/^(NOVEDADES|RECHAZADAS|PENDIENTES|Cheques electr|Legales|Inversiones|D[ée]bitos autom[áa]ticos\s*$)/i.test(l)) { if (!/^D[ée]bitos/i.test(l)) seccion = null; }
    if (info) { anio = info[3]; hasta = `${info[3]}-${info[2]}-${info[1]}`; continue; }
    if (!seccion) continue;
    const m = l.match(/^(\d{2})\/(\d{2})\s{2,}(.+?)\s{2,}(?:U\$S|\$)\s{2,}([\d.]+,\d{2})\s{2,}(C[AC]\s*(?:\$|U\$S)\s*\d{3}-\d{6}\/\d)/);
    if (!m) continue;
    const [, dd, mm, medio, importe, cuenta] = m;
    let y = anio || String(new Date().getFullYear());
    if (hasta && Number(mm) > Number(hasta.slice(5, 7)) + 1) y = String(Number(y) - 1); // resumen de enero con renglones de diciembre
    const cols = medio.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    let cuit: string | null = null;
    let nombre = "";
    let detalle = "";
    if (seccion === "enviada") {
      cuit = cuitDeTira(cols[0] || "");
      nombre = (cols[0] || "").replace(/^\d+\s*/, "").trim();
      detalle = cols.slice(1).filter((c) => !/^0+$/.test(c)).join(" ");
    } else if (seccion === "recibida") {
      // [banco, "30636021578CORTEVA AGRISCIEN" | "20379309128 MUNICIPALIDAD D" | "30999034515. Pergamino", servicio, referencia…]
      const quien = cols[1] || "";
      cuit = cuitDeTira(quien);
      nombre = quien.replace(/^\d+[.\s]*/, "").trim();
      detalle = cols.slice(2).join(" ");
    } else {
      nombre = `${cols[0] || ""} ${cols[1] || ""}`.trim();
      detalle = cols.slice(2).join(" ");
    }
    items.push({ seccion, fecha: `${y}-${mm}-${dd}`, importe: num(importe), cuentaDigitos: digitos(cuenta), cuit, nombre, detalle });
  }
  return { hasta, items };
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export interface LineaParaResumen { id: string; fecha: string; importe: number; cuentaDigitos: string }

/**
 * Cruza cada renglón del resumen con una línea del extracto: misma cuenta, mismo importe (salida para enviadas y
 * débitos, entrada para recibidas) y fecha entre 2 días antes y 4 días después. Cada línea se usa una sola vez.
 */
export function cruzarResumen(items: ItemResumen[], lineas: LineaParaResumen[]): { linea_id: string; contraparte: Contraparte }[] {
  const usadas = new Set<string>();
  const out: { linea_id: string; contraparte: Contraparte }[] = [];
  const cent = (n: number) => Math.round(Math.abs(n) * 100);
  for (const it of [...items].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const signo = it.seccion === "recibida" ? 1 : -1;
    const cands = lineas.filter((l) => !usadas.has(l.id) && Math.sign(l.importe) === signo && cent(l.importe) === cent(it.importe)
      && (!it.cuentaDigitos || !l.cuentaDigitos || l.cuentaDigitos.endsWith(it.cuentaDigitos.slice(-7)) || it.cuentaDigitos.endsWith(l.cuentaDigitos.slice(-7)))
      && diasEntre(it.fecha, l.fecha) >= -2 && diasEntre(it.fecha, l.fecha) <= 4)
      .sort((a, b) => Math.abs(diasEntre(it.fecha, a.fecha)) - Math.abs(diasEntre(it.fecha, b.fecha)));
    const l = cands[0];
    if (!l) continue;
    usadas.add(l.id);
    out.push({ linea_id: l.id, contraparte: { fuente: "resumen_bbva", seccion: it.seccion, nombre: it.nombre || null, cuit: it.cuit, detalle: it.detalle || null } });
  }
  return out;
}

/** Texto que se suma al concepto de la línea para que la bandeja reconozca CUIT, proveedor y reglas. */
export function textoContraparte(c: Contraparte | null | undefined): string {
  if (!c) return "";
  const partes = [c.nombre, c.cuit, c.detalle].filter(Boolean).join(" ");
  const fac = c.factura ? ` FACTURA ARCA ${c.factura.emisor} ${c.factura.cuit}` : "";
  return `${partes}${fac}`.trim();
}
