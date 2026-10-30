// Compras Lazza › pestaña Mercado Libre (Augusto 30/10/2026): una fila por artículo de las OC a Mercado Libre y a cada una se le
// carga o se elige su factura A MANO. Nada se une solo: el orden de las facturas para elegir es solo una ayuda.

export const esMercadoLibre = (t: string | null | undefined) => /mercado\s*libre/i.test(String(t || ""));

const round2 = (n: number) => Math.round(n * 100) / 100;
export type Moneda = "ARS" | "USD";

export type ItemOcML = { id: string; descripcion: string | null; cantidad: number | null; precio_unitario: number | null; iva_porcentaje: number | null; moneda?: string | null };
export type OcML = {
  id: string; numero: string; fecha: string | null; moneda: string | null; prNumero: string; cliente: string;
  items: ItemOcML[];
};
export type FacturaML = {
  id: string; numero: string; tipo: string | null; total: number; moneda: Moneda; fecha: string | null;
  proveedor: string; archivoUrl: string | null;
};
export type AsignacionML = { ocItemId: string; facturaId: string; origen: string };
/** Artículo marcado «No tiene factura» (ej. lo pagó alguien con su plata): deja de faltar. */
export type SinFacturaML = { ocItemId: string; motivo: string };

export type FilaML = {
  ocItemId: string; ocId: string; ocNumero: string; fecha: string | null; prNumero: string; cliente: string;
  descripcion: string; cantidad: number; precioUnitario: number; moneda: Moneda;
  /** Lo que se pagó con IVA (cantidad × precio × (1 + IVA)). */
  importe: number;
  facturas: (FacturaML & { origen: string })[];
  /** Motivo si se marcó «No tiene factura»; null si no. */
  noTiene: string | null;
};

/** Le falta la factura: no tiene ninguna unida y no se marcó «No tiene factura». */
export const faltaFactura = (f: FilaML) => !f.facturas.length && !f.noTiene;

/** Importe con IVA de un renglón de OC. */
export function importeRenglon(it: ItemOcML): number {
  const iva = it.iva_porcentaje == null ? 21 : Number(it.iva_porcentaje);
  return round2((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0) * (1 + iva / 100));
}

/** Una fila por artículo (renglón de OC), con las facturas que ya tiene unidas. Más nuevas primero. */
export function armarFilasML(ocs: OcML[], asignaciones: AsignacionML[], facturas: FacturaML[], sinFactura: SinFacturaML[] = []): FilaML[] {
  const noTiene = new Map(sinFactura.map((x) => [x.ocItemId, x.motivo]));
  const porId = new Map(facturas.map((f) => [f.id, f]));
  const porItem = new Map<string, (FacturaML & { origen: string })[]>();
  for (const a of asignaciones) {
    const f = porId.get(a.facturaId);
    if (!f) continue; // anulada o de otra sociedad
    const l = porItem.get(a.ocItemId) || [];
    if (!l.some((x) => x.id === f.id)) l.push({ ...f, origen: a.origen });
    porItem.set(a.ocItemId, l);
  }
  const filas: FilaML[] = [];
  for (const o of ocs) {
    for (const it of o.items) {
      if (!(Number(it.cantidad) > 0)) continue;
      filas.push({
        ocItemId: it.id, ocId: o.id, ocNumero: o.numero, fecha: o.fecha, prNumero: o.prNumero, cliente: o.cliente,
        descripcion: String(it.descripcion || "").trim(), cantidad: Number(it.cantidad) || 0, precioUnitario: Number(it.precio_unitario) || 0,
        moneda: (it.moneda || o.moneda || "ARS") === "USD" ? "USD" : "ARS",
        importe: importeRenglon(it), facturas: porItem.get(it.id) || [], noTiene: noTiene.get(it.id) ?? null,
      });
    }
  }
  return filas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || b.ocNumero.localeCompare(a.ocNumero) || a.descripcion.localeCompare(b.descripcion));
}

/** Cuántos artículos y cuánta plata (en $; los de US$ aparte) falta facturar. */
export function resumenML(filas: FilaML[]) {
  const falta = filas.filter(faltaFactura);
  return {
    total: filas.length,
    sinFactura: falta.length,
    importeSinFactura: round2(falta.filter((f) => f.moneda === "ARS").reduce((s, f) => s + f.importe, 0)),
    importeSinFacturaUsd: round2(falta.filter((f) => f.moneda === "USD").reduce((s, f) => s + f.importe, 0)),
  };
}

/**
 * Facturas para "Elegir una ya cargada", ordenadas por lo que más se parece al importe de lo elegido (misma moneda primero).
 * `coincide` = el total da igual (hasta $ 2 o 0,5 %). Es solo el orden: la persona elige.
 */
export function ordenarCandidatas<T extends FacturaML>(facturas: T[], importe: number, moneda: Moneda): (T & { diferencia: number; coincide: boolean })[] {
  return facturas
    .map((f) => {
      const diferencia = round2(Number(f.total || 0) - importe);
      const mismaMoneda = f.moneda === moneda;
      return { ...f, diferencia, coincide: mismaMoneda && Math.abs(diferencia) <= Math.max(2, Math.abs(importe) * 0.005), mismaMoneda };
    })
    .sort((a, b) => Number(b.mismaMoneda) - Number(a.mismaMoneda) || Math.abs(a.diferencia) - Math.abs(b.diferencia))
    .map(({ mismaMoneda: _m, ...f }) => f as T & { diferencia: number; coincide: boolean });
}
