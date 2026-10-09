/**
 * Prompt y lectura de respuesta para que la IA decida qué producto de una factura
 * de compra es qué producto de las OC. La IA NO asigna cantidades ni talles: solo
 * dice "estos nombres son el mismo artículo". Las cantidades y los talles los
 * resuelve el motor (purchase-matching.ts) con reglas fijas, así un error de la IA
 * nunca cruza un talle con otro ni inventa cantidades.
 */
import type { Equivalencias } from "./purchase-matching";

export interface GrupoFactura { producto: string; ejemplo: string; talles: string[]; precios: number[]; codigos: string[] }
export interface GrupoOc { producto: string; ejemplo: string; talles: string[]; precios: number[]; ocs: string[] }
export type Confianza = "alta" | "media" | "baja";

export interface EquivalenciasIA {
  equivalencias: Equivalencias;
  confianza: Record<string, Confianza>;   // por producto de factura
  motivo: Record<string, string>;
}

export const SISTEMA_CONCILIACION = `Sos el comprador senior de una distribuidora argentina de ropa de trabajo y EPP (Lazzari).
Tenés que decidir qué artículos de una FACTURA de proveedor corresponden a qué artículos de las ÓRDENES DE COMPRA (OC) que le hicimos a ese mismo proveedor.

Las OC las escriben vendedores con nombres propios, genéricos o con errores de tipeo; la factura usa el nombre comercial del proveedor. Ejemplos reales del mismo artículo:
- "PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO" = "Pampero Pantalón Cargo Fit Ela Beige" (Fit Ela = elastizado)
- "REMERA MANGA CORTA ALGODON PAMPERO" = "Pampero Remera M/C Gris Mel." (M/C = manga corta)
- "CAMISA OXFORD CELESTE - PAMPERO (MUJER)" = "Pampero Camisa Oxford Dama Celeste"; "(HOMBRE)" = "Camisa Oxford H."
- "CAMISA CAIRO UV BEIGE" = "Camisa Cairo Arena" (el proveedor llama "Arena" a su beige)

Reglas:
1. Emparejá por ARTÍCULO: tipo de prenda, modelo/línea, color y si es de dama u hombre. Ignorá el talle (se controla aparte).
2. Un artículo de la factura puede corresponder a VARIOS artículos de OC (ej.: el mismo producto pedido en dos OC con nombres distintos, o una variante "sin bordado").
3. No unas artículos de distinto tipo (pantalón con camisa), ni dama con hombre, ni modelos claramente distintos (Ripstop ≠ Fit Ela/elastizado).
4. Los talles en común y los precios parecidos son pistas a favor, no reglas: el proveedor puede facturar a otro precio.
5. Si dudás, igual proponelo pero con confianza "media" o "baja" y explicá por qué en "motivo" (en castellano, una frase corta). Si no hay ninguno razonable, no lo incluyas.

Respondé SOLO con JSON, sin texto adicional:
{"equivalencias":[{"f":"F1","o":["O2","O5"],"confianza":"alta","motivo":"..."}]}`;

export function promptConciliacion(proveedor: string, factura: GrupoFactura[], oc: GrupoOc[]): string {
  const precio = (ps: number[]) => ps.map(p => `$${p.toFixed(2)}`).join(" / ");
  const lf = factura.map((g, i) => `F${i + 1}: "${g.ejemplo}"${g.codigos.length ? ` [código ${g.codigos.slice(0, 3).join(", ")}]` : ""} · talles ${g.talles.join(", ") || "—"} · precio ${precio(g.precios)}`);
  const lo = oc.map((g, i) => `O${i + 1}: "${g.ejemplo}" · OC ${g.ocs.join(", ")} · talles ${g.talles.join(", ") || "—"} · precio ${precio(g.precios)}`);
  return `Proveedor: ${proveedor || "(sin nombre)"}\n\nARTÍCULOS DE LA FACTURA:\n${lf.join("\n")}\n\nARTÍCULOS PENDIENTES EN LAS OC:\n${lo.join("\n")}\n\nDevolvé las equivalencias.`;
}

/** Lee la respuesta de la IA y la valida contra los grupos enviados. */
export function leerRespuestaConciliacion(texto: string, factura: GrupoFactura[], oc: GrupoOc[]): EquivalenciasIA {
  let json = String(texto || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const a = json.indexOf("{"), b = json.lastIndexOf("}");
  if (a >= 0 && b > a) json = json.slice(a, b + 1);
  const data = JSON.parse(json);
  const out: EquivalenciasIA = { equivalencias: {}, confianza: {}, motivo: {} };
  for (const e of Array.isArray(data?.equivalencias) ? data.equivalencias : []) {
    const fi = Number(String(e?.f || "").replace(/\D/g, "")) - 1;
    const f = factura[fi];
    if (!f) continue;
    const os = (Array.isArray(e?.o) ? e.o : [])
      .map((x: unknown) => oc[Number(String(x || "").replace(/\D/g, "")) - 1])
      .filter(Boolean)
      .map((g: GrupoOc) => g.producto);
    if (!os.length) continue;
    out.equivalencias[f.producto] = [...new Set([...(out.equivalencias[f.producto] || []), ...os])];
    const c = String(e?.confianza || "").toLowerCase();
    out.confianza[f.producto] = c === "alta" || c === "media" || c === "baja" ? c : "media";
    if (e?.motivo) out.motivo[f.producto] = String(e.motivo).slice(0, 300);
  }
  return out;
}
