// Factura que trae abierto por talle lo que en la OC es un solo renglón (Augusto 16/10):
// OC "PRUSIANO · PVC · Negro" x35 ↔ factura "BOT... PRUSIANO NRO 39" x3, "NRO 40" x8 … "NRO 44" x5 (suman 35).
// En vez de 6 avisos de "no está en la OC", se atan todos a ese renglón y se dice claro: "la cantidad coincide,
// la factura trae el desglose de talles". Es una sugerencia: siempre se puede cambiar a mano.

import { parseVariant } from "./purchase-matching";
import { normalizarTexto } from "./buscar-texto";

export type RenglonFacturaDesglose = { key: string; descripcion: string; cantidad: number; precio: number };
export type RenglonOCDesglose = { id: string; descripcion: string; cantidad: number; precio: number };
export type Desglose = {
  ocId: string;
  keys: string[];
  /** Talle y cantidad de cada renglón de la factura, en orden. */
  talles: { talle: string; cantidad: number }[];
  total: number;
  /** true si la suma de los talles da justo la cantidad de la OC. */
  coincide: boolean;
};

const PALABRAS_VACIAS = new Set(["de", "la", "el", "con", "y", "para", "sin", "por", "en", "nro", "num", "numero", "talle", "talles", "nva", "nuevo", "nueva", "cp", "un", "unidad"]);
const palabras = (t: string) => normalizarTexto(t).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 4 && !PALABRAS_VACIAS.has(w) && !/^\d+$/.test(w));
const ordenTalle = (t: string) => (/^\d+$/.test(t) ? Number(t) : 1000 + ["XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL"].indexOf(t.toUpperCase()));

/**
 * Busca grupos de renglones de la factura que son el mismo artículo en distintos talles y que juntos
 * corresponden a un renglón de la OC sin talle. Pide: 2 talles o más, al menos una palabra en común con la OC
 * y que la suma no se pase de la cantidad de la OC. Si hay varios renglones posibles en la OC, elige el que
 * da justo la cantidad; si sigue habiendo más de uno, no elige (lo deja para revisar a mano).
 */
export function detectarDesgloseTalles(factura: RenglonFacturaDesglose[], oc: RenglonOCDesglose[]): Desglose[] {
  const grupos = new Map<string, { r: RenglonFacturaDesglose; talle: string }[]>();
  for (const r of factura) {
    const v = parseVariant(r.descripcion);
    if (!v.talle || !(Number(r.cantidad) > 0)) continue;
    const k = v.producto;
    if (!k) continue;
    grupos.set(k, [...(grupos.get(k) || []), { r, talle: v.talle }]);
  }
  const ocSinTalle = oc.filter((o) => !parseVariant(o.descripcion).talle && Number(o.cantidad) > 0);
  const usados = new Set<string>();
  const out: Desglose[] = [];
  for (const [producto, lst] of grupos) {
    if (new Set(lst.map((x) => x.talle)).size < 2) continue;
    const total = Math.round(lst.reduce((a, x) => a + Number(x.r.cantidad), 0) * 10000) / 10000;
    const pf = new Set(palabras(producto));
    const candidatos = ocSinTalle.filter((o) => !usados.has(o.id) && total <= Number(o.cantidad) + 0.0001 && palabras(o.descripcion).some((w) => pf.has(w)));
    const justos = candidatos.filter((o) => Math.abs(Number(o.cantidad) - total) < 0.0001);
    const elegido = justos.length === 1 ? justos[0] : justos.length === 0 && candidatos.length === 1 ? candidatos[0] : null;
    if (!elegido) continue;
    usados.add(elegido.id);
    const orden = [...lst].sort((a, b) => ordenTalle(a.talle) - ordenTalle(b.talle));
    out.push({
      ocId: elegido.id, keys: orden.map((x) => x.r.key), total,
      talles: orden.map((x) => ({ talle: x.talle, cantidad: Number(x.r.cantidad) })),
      coincide: Math.abs(Number(elegido.cantidad) - total) < 0.0001,
    });
  }
  return out;
}

/** "39×3, 40×8, 41×6" para mostrar. */
export const textoTalles = (d: Desglose) => d.talles.map((t) => `${t.talle}×${t.cantidad}`).join(", ");
