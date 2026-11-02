/**
 * Aviso "la factura supera al PR" (auditoría de la plata 30/10/2026): el PR-1125 de Corteva Seeds se facturó US$ 268,62 más
 * que lo cotizado y el PR-1167 de Corteva Agriscience US$ 32,23 más; el margen y la comisión salen del PR y quedan mal.
 * Al facturar, si un renglón tiene precio o cantidad mayor que el del PR, o el total pasa al del PR, se avisa. Nunca frena.
 *
 * Se compara en los precios de la ventana (moneda del PR, neto en A y final en B/X): el precio esperado de cada renglón del PR
 * es el mismo con el que la ventana lo precarga (precioUnitarioParaFactura). Facturar menos (resto) no avisa.
 *
 * Prueba: npx tsx scripts/test-factura-vs-pr.ts
 */

export interface RenglonPrEsperado {
  descripcion: string;
  cantidad: number;
  /** Precio unitario del PR en los términos de la factura (neto en A, final en B/X). */
  precio: number;
}

export interface RenglonFacturaVsPr {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  /** Renglón del PR del que sale; los agregados a mano no tienen. */
  prIdx?: number | null;
}

export interface ExcesoRenglon {
  descripcion: string;
  motivo: "precio" | "cantidad" | "agregado";
  pr: number;
  factura: number;
}

export interface ExcesoFacturaPr {
  renglones: ExcesoRenglon[];
  totalPr: number;
  totalFactura: number;
  /** Lo que la factura pasa al PR (0 si no lo pasa). */
  diferencia: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Margen para los centavos de pasar precios entre A y B (redondeo por unidad). */
const tolerancia = (base: number) => Math.max(0.05, Math.abs(base) * 0.001);

export function excesoFacturaSobrePr(pr: RenglonPrEsperado[], factura: RenglonFacturaVsPr[]): ExcesoFacturaPr {
  const renglones: ExcesoRenglon[] = [];
  const cantidadPorIdx = new Map<number, number>();
  for (const it of factura) {
    const cantidad = Number(it.cantidad) || 0;
    const precio = Number(it.precio_unitario) || 0;
    const base = it.prIdx != null ? pr[it.prIdx] : undefined;
    if (!base) {
      if (cantidad > 0 && precio > 0) renglones.push({ descripcion: it.descripcion, motivo: "agregado", pr: 0, factura: r2(cantidad * precio) });
      continue;
    }
    cantidadPorIdx.set(it.prIdx!, (cantidadPorIdx.get(it.prIdx!) || 0) + cantidad);
    if (precio - base.precio > tolerancia(base.precio)) {
      renglones.push({ descripcion: it.descripcion, motivo: "precio", pr: r2(base.precio), factura: r2(precio) });
    }
  }
  for (const [idx, cantidad] of cantidadPorIdx) {
    const base = pr[idx];
    if (cantidad - base.cantidad > 0.00005) renglones.push({ descripcion: base.descripcion, motivo: "cantidad", pr: base.cantidad, factura: cantidad });
  }
  const totalPr = r2(pr.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio) || 0), 0));
  const totalFactura = r2(factura.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0));
  const exceso = r2(totalFactura - totalPr);
  return { renglones, totalPr, totalFactura, diferencia: exceso > tolerancia(totalPr) ? exceso : 0 };
}

/** true si hay algo que avisar. */
export function hayExcesoSobrePr(e: ExcesoFacturaPr): boolean {
  return e.diferencia > 0 || e.renglones.length > 0;
}

/** "precio 10,00 → 12,00 en Botín X · cantidad 5 → 6 en Guante Y · agregado: Flete" */
export function detalleExcesoPr(e: ExcesoFacturaPr, max = 3): string {
  const num = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const partes = e.renglones.map((r) => r.motivo === "agregado" ? `agregado: ${r.descripcion}`
    : r.motivo === "precio" ? `precio ${num(r.pr)} → ${num(r.factura)} en ${r.descripcion}`
    : `cantidad ${Number(r.pr.toFixed(4))} → ${Number(r.factura.toFixed(4))} en ${r.descripcion}`);
  const extra = partes.length > max ? ` y ${partes.length - max} más` : "";
  return partes.slice(0, max).join(" · ") + extra;
}
