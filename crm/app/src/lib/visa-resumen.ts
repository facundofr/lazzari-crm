/**
 * Resumen de la tarjeta del BBVA (Visa / Mastercard, Pymes y Negocios) consumo por consumo (Augusto 02/11/2026).
 * Se lee el texto del PDF sin IA: pdfjs da los pedazos de texto con su posición; renglonesDePdf los junta por renglón
 * ("DD-Mmm-AA | DESCRIPCIÓN | [C.NN/MM] | CUPÓN | importe") y leerResumenTarjeta saca la cabecera (cierre, vencimiento,
 * saldo, mínimo), los consumos y los cargos del banco. Control: la suma de los consumos tiene que dar el «TOTAL CONSUMOS».
 * Funciones puras. Prueba: npx tsx scripts/test-visa-resumen.ts
 */

export type Moneda = "ARS" | "USD";
export type ClaseConsumo = "compra" | "servicio" | "personal";

export interface ConsumoLeido {
  fecha: string;            // YYYY-MM-DD (de la compra; en cuotas, la fecha de la compra original)
  descripcion: string;      // tal cual el resumen: "MERPAGO*BOSSH"
  comercio: string;         // para clasificar una vez: "MERPAGO*BOSSH", "CLARO DEB AUT", "GOOGLE WORKSPACE"
  cupon: string | null;
  cuotaN: number | null;
  cuotaDe: number | null;
  importe: number;          // negativo = devolución
  moneda: Moneda;
  tipo: "consumo" | "cargo";
  /** Clave para no guardar dos veces el mismo renglón si se vuelve a subir el resumen. */
  clave: string;
}

export interface ResumenLeido {
  cierre: string | null;
  vencimiento: string | null;
  saldoArs: number | null;
  saldoUsd: number | null;
  minimoArs: number | null;
  consumos: ConsumoLeido[];   // consumos y cargos del banco (tipo)
  totalConsumos: { ars: number; usd: number } | null;  // lo que dice el resumen
  sumaConsumos: { ars: number; usd: number };           // lo leído
  cierra: boolean;
}

const MES: Record<string, string> = { ENE: "01", FEB: "02", MAR: "03", ABR: "04", MAY: "05", JUN: "06", JUL: "07", AGO: "08", SEP: "09", SET: "09", OCT: "10", NOV: "11", DIC: "12" };
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", "."));
const esImporte = (s: string) => /^-?[\d.]+,\d{2}$/.test(s.trim());
const r2 = (n: number) => Math.round(n * 100) / 100;
const sinTilde = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "29-Oct-26" → "2026-10-29". */
export function fechaResumen(s: string): string | null {
  const m = String(s || "").trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const mes = MES[sinTilde(m[2]).toUpperCase()];
  return mes ? `20${m[3]}-${mes}-${m[1]}` : null;
}

/** Junta los pedazos de texto de pdfjs por renglón (misma altura ±2) y los separa con " | " cuando hay espacio entre columnas. */
export function renglonesDePdf(paginas: { str: string; x: number; y: number }[][]): string {
  const out: string[] = [];
  for (const items of paginas) {
    const renglones = new Map<number, { x: number; s: string }[]>();
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.y);
      const k = [...renglones.keys()].find((yy) => Math.abs(yy - y) <= 2) ?? y;
      if (!renglones.has(k)) renglones.set(k, []);
      renglones.get(k)!.push({ x: it.x, s: it.str });
    }
    for (const y of [...renglones.keys()].sort((a, b) => b - a)) {
      const partes = renglones.get(y)!.sort((a, b) => a.x - b.x);
      let linea = "";
      let ultimoX = 0;
      for (const t of partes) {
        linea += (linea && t.x - ultimoX > 8 ? " | " : linea ? " " : "") + t.s.trim();
        ultimoX = t.x + t.s.length * 4;
      }
      out.push(linea);
    }
  }
  return out.join("\n");
}

/** El comercio, para clasificarlo una sola vez: sin WWW./.COM, sin códigos con números ni "USD". */
export function comercioDe(descripcion: string): string {
  let t = sinTilde(String(descripcion || "")).toUpperCase().trim();
  const estrella = t.indexOf("*");
  if (estrella > 0 && t.slice(0, estrella).trim() !== "MERPAGO") t = t.slice(0, estrella);
  t = t.replace(/\bWWW\./g, "").replace(/\.COM(-PROM)?\b/g, "");
  const palabras = t.split(/\s+/).filter((w) => w && !/\d/.test(w) && w !== "USD");
  return palabras.join(" ").replace(/\s*\*\s*/g, "*").trim() || t.trim();
}

const SERVICIOS = /^(CLARO|PERSONAL|MOVISTAR|AUTOPISTAS|TELEPEAJE|SMG|GOOGLE|ANTHROPIC|SUPABASE|VERCEL|MERPAGO\*TIENDANUBE|ASOC MUTUAL|OPENAI|MICROSOFT|ADOBE)/;
/** Sugerencia de clase para un comercio nuevo (Augusto la confirma; nunca se guarda sola). */
export function claseSugerida(comercio: string): ClaseConsumo | null {
  const c = String(comercio || "").toUpperCase();
  if (SERVICIOS.test(c)) return "servicio";
  if (/^MERPAGO\*|^MERCADO ?(LIBRE|ONLINE)/.test(c)) return "compra";
  return null;
}

/** Lee el texto (renglonesDePdf) del resumen de la tarjeta del BBVA. */
export function leerResumenTarjeta(texto: string): ResumenLeido {
  const lineas = String(texto || "").split(/\r?\n/).map((l) => l.trim());
  const res: ResumenLeido = { cierre: null, vencimiento: null, saldoArs: null, saldoUsd: null, minimoArs: null, consumos: [], totalConsumos: null, sumaConsumos: { ars: 0, usd: 0 }, cierra: false };
  let seccion: "" | "consumos" | "cargos" = "";
  const vistas = new Map<string, number>();
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    // Cabecera: "CIERRE ACTUAL | VENCIMIENTO ACTUAL | SALDO ACTUAL $ | SALDO ACTUAL U$S | PAGO MÍNIMO $" y abajo los valores.
    if (/^CIERRE ACTUAL\b/.test(l) && !res.cierre) {
      const v = (lineas[i + 1] || "").split("|").map((s) => s.trim());
      res.cierre = fechaResumen(v[0]);
      res.vencimiento = fechaResumen(v[1]);
      const n = v.slice(2).filter(esImporte).map(num);
      const tieneUsd = /U\$S|USD/.test(l);
      res.saldoArs = n[0] ?? null;
      res.saldoUsd = tieneUsd ? n[1] ?? null : null;
      res.minimoArs = (tieneUsd ? n[2] : n[1]) ?? null;
      continue;
    }
    if (/^Consumos\s/i.test(l) && !/\|/.test(l)) { seccion = "consumos"; continue; }
    if (/^Impuestos, cargos e intereses/i.test(l)) { seccion = "cargos"; continue; }
    if (/^TOTAL CONSUMOS/i.test(l)) {
      if (seccion === "consumos") {
        const n = l.split("|").slice(1).filter(esImporte).map(num);
        res.totalConsumos = { ars: r2((res.totalConsumos?.ars || 0) + (n[0] || 0)), usd: r2((res.totalConsumos?.usd || 0) + (n[1] || 0)) };
        seccion = "";
      }
      continue;
    }
    if (/^SALDO ACTUAL/i.test(l) || /^Legales/i.test(l)) { seccion = ""; continue; }
    if (!seccion) continue;
    const m = l.match(/^(\d{2}-[A-Za-z]{3}-\d{2}) \| (.*)$/);
    if (!m) continue;
    const fecha = fechaResumen(m[1]);
    if (!fecha) continue;
    const partes = m[2].split("|").map((s) => s.trim()).filter(Boolean);
    const ultimo = partes[partes.length - 1];
    if (!ultimo || !esImporte(ultimo)) continue;
    const importe = num(ultimo);
    const descripcion = partes[0].replace(/\s+/g, " ");
    const esUsd = seccion === "consumos" ? /USD/.test(m[2]) : /U\$S|USD/.test(m[2]);
    const cuotaTxt = partes.find((s) => /^C\.\d{2}\/\d{2}$/.test(s));
    const cupon = seccion === "consumos" ? partes.slice(1, -1).reverse().find((s) => /^\d{6}$/.test(s)) ?? null : null;
    const moneda: Moneda = esUsd ? "USD" : "ARS";
    const base = [fecha, descripcion, cupon || "", cuotaTxt || "", moneda, importe.toFixed(2)].join("|");
    const vez = (vistas.get(base) || 0) + 1;
    vistas.set(base, vez);
    res.consumos.push({
      fecha, descripcion, comercio: comercioDe(descripcion), cupon,
      cuotaN: cuotaTxt ? Number(cuotaTxt.slice(2, 4)) : null, cuotaDe: cuotaTxt ? Number(cuotaTxt.slice(5, 7)) : null,
      importe, moneda, tipo: seccion === "consumos" ? "consumo" : "cargo", clave: `${base}|${vez}`,
    });
  }
  for (const c of res.consumos) if (c.tipo === "consumo") { if (c.moneda === "USD") res.sumaConsumos.usd += c.importe; else res.sumaConsumos.ars += c.importe; }
  res.sumaConsumos = { ars: r2(res.sumaConsumos.ars), usd: r2(res.sumaConsumos.usd) };
  res.cierra = !!res.totalConsumos && res.consumos.some((c) => c.tipo === "consumo")
    && Math.abs(res.sumaConsumos.ars - res.totalConsumos.ars) < 0.01 && Math.abs(res.sumaConsumos.usd - res.totalConsumos.usd) < 0.01;
  return res;
}
