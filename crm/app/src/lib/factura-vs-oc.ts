// Factura de compra contra su OC: control del IVA, emparejar renglones por precio y elegir la OC sola.
// Funciones puras (prueba: scripts/test-factura-vs-oc.ts). Todo es aviso: nada de esto frena la carga.

export interface RenglonFactura { key: string; cantidad: number; precio: number; iva: number }
export interface RenglonOC { id: string; cantidad: number; precio: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * neto + IVA + percepciones tiene que dar el total impreso. Si no da y con 21 % en todo da, se propone 21 %.
 * (La IA a veces toma "Iva 0%" o "IVA 10.5%" vacíos del pie como la tasa de los renglones.)
 */
export function controlIva(p: { renglones: RenglonFactura[]; neto: number; percepciones: number; totalLeido: number | null | undefined; tolerancia?: number }) {
  const tol = p.tolerancia ?? 1;
  const totalLeido = Number(p.totalLeido) || 0;
  const iva = p.renglones.length
    ? r2(p.renglones.reduce((s, r) => s + r.cantidad * r.precio * r.iva / 100, 0))
    : 0;
  const calculado = r2(p.neto + iva + p.percepciones);
  if (totalLeido <= 0) return { controlado: false, cuadra: true, calculado, totalLeido, diferencia: 0, propone21: false };
  const diferencia = r2(totalLeido - calculado);
  const cuadra = Math.abs(diferencia) <= tol;
  const con21 = r2(p.neto * 1.21 + p.percepciones);
  const propone21 = !cuadra && Math.abs(totalLeido - con21) <= tol;
  return { controlado: true, cuadra, calculado, totalLeido, diferencia, propone21 };
}

/** Mismo precio unitario (tolerancia $1 o 0,5 %). */
export function mismoPrecio(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
}

/**
 * Empareja por PRECIO los renglones que no coincidieron por código o nombre (el proveedor los llama distinto).
 * Solo si el precio identifica a un único renglón libre de la OC. Si queda un solo renglón de cada lado
 * con precio parecido (±15 %), también se empareja. Devuelve key de factura → id de OC.
 */
export function emparejarPorPrecio(factura: RenglonFactura[], ocLibres: RenglonOC[]): Record<string, string> {
  const out: Record<string, string> = {};
  const usados = new Set<string>();
  for (const f of factura) {
    const cands = ocLibres.filter((o) => !usados.has(o.id) && mismoPrecio(f.precio, o.precio));
    if (cands.length === 1) { out[f.key] = cands[0].id; usados.add(cands[0].id); continue; }
    if (cands.length > 1) {
      const igualCant = cands.filter((o) => Math.abs(o.cantidad - f.cantidad) < 0.0001);
      if (igualCant.length === 1) { out[f.key] = igualCant[0].id; usados.add(igualCant[0].id); }
    }
  }
  const restoF = factura.filter((f) => !out[f.key]);
  const restoO = ocLibres.filter((o) => !usados.has(o.id));
  if (restoF.length === 1 && restoO.length === 1 && restoO[0].precio > 0
    && Math.abs(restoF[0].precio - restoO[0].precio) / restoO[0].precio <= 0.15) {
    out[restoF[0].key] = restoO[0].id;
  }
  return out;
}

const PALABRAS_VACIAS = new Set(["de", "del", "la", "las", "el", "los", "con", "sin", "para", "por", "y", "en", "mts", "mm", "cm", "x", "opcional"]);
/** Palabras de una descripción, sin tildes ni plurales simples ("Cajas" = "CAJA"). */
export function palabrasNombre(texto: string): Set<string> {
  return new Set(String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PALABRAS_VACIAS.has(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)));
}
/** Qué tan parecidos son dos nombres: palabras en común / palabras del más corto (0 a 1). */
export function parecidoNombre(a: string, b: string): number {
  const pa = palabrasNombre(a), pb = palabrasNombre(b);
  if (!pa.size || !pb.size) return 0;
  let comunes = 0;
  for (const w of pa) if (pb.has(w)) comunes++;
  return comunes / Math.min(pa.size, pb.size);
}

/**
 * Elige la OC de la factura entre las pendientes del proveedor: 1) la que la factura nombra (referencias_oc);
 * 2) la que tiene más artículos con nombre parecido; 3) más precios iguales; 4) más cantidades iguales; 5) total más parecido.
 * Si hay OC pendientes siempre elige una (la más parecida).
 */
export function elegirOC(
  ocs: { id: string; numero: string; total: number; precios: number[]; nombres?: string[]; cantidades?: number[] }[],
  factura: { precios: number[]; total: number; referencias?: string[]; nombres?: string[]; cantidades?: number[] },
): string | null {
  if (!ocs.length) return null;
  const soloDigitos = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  for (const ref of factura.referencias || []) {
    const d = soloDigitos(String(ref));
    if (!d) continue;
    const porRef = ocs.filter((oc) => { const n = soloDigitos(oc.numero); return n === d || n.endsWith(d) && d.length >= 3; });
    if (porRef.length === 1) return porRef[0].id;
  }
  const contar = <T,>(deFactura: T[], deOC: T[], igual: (a: T, b: T) => boolean) => {
    const libres = [...deOC];
    let n = 0;
    for (const x of deFactura) {
      const i = libres.findIndex((y) => igual(x, y));
      if (i >= 0) { n++; libres.splice(i, 1); }
    }
    return n;
  };
  const puntajes = ocs.map((oc) => ({
    id: oc.id,
    nombres: contar(factura.nombres || [], oc.nombres || [], (a, b) => parecidoNombre(a, b) >= 0.5),
    precios: contar(factura.precios, oc.precios, mismoPrecio),
    cantidades: contar(factura.cantidades || [], oc.cantidades || [], (a, b) => Math.abs(a - b) < 0.0001),
    dif: factura.total > 0 ? Math.abs(oc.total - factura.total) / factura.total : 1,
  }));
  puntajes.sort((a, b) => b.nombres - a.nombres || b.precios - a.precios || b.cantidades - a.cantidades || a.dif - b.dif);
  return puntajes[0].id;
}
