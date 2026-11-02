/**
 * Moneda, tipo de dólar y fecha mínima de una factura de venta (pedido de Augusto 13/10/2026):
 * - El tipo de dólar sale de la ficha del cliente ("USD Divisa" = divisas, "USD" = billetes).
 *   Pesos se puede siempre. El otro tipo de dólar queda trabado y solo lo destraba un rol de administración.
 * - No se factura con fecha anterior a la OC del cliente (también destrabable por administración).
 * - Sugerencia: la fecha más vieja permitida (ARCA y OC), para que el vencimiento corra antes.
 * - Leyenda de la cotización usada (tipo, día y valor) para las observaciones de la factura.
 *
 * Prueba: npx tsx scripts/test-factura-moneda.ts
 */

export type Modalidad = "divisas" | "billetes";

/** Roles que pueden destrabar el tipo de dólar y la fecha anterior a la OC (Augusto y Mariana, por rol). */
export const ROLES_DESTRABAR_FACTURA = ["super_admin", "admin", "administrativo"] as const;

export function puedeDestrabarFactura(role?: string | null): boolean {
  return !!role && (ROLES_DESTRABAR_FACTURA as readonly string[]).includes(role);
}

/** Tipo de dólar de la ficha del cliente (null si la ficha no dice: pesos o vacío). */
export function modalidadFicha(monedaPredeterminada?: string | null): Modalidad | null {
  const m = String(monedaPredeterminada || "").trim().toLowerCase();
  if (m === "usd divisa" || m === "usd divisas") return "divisas";
  if (m === "usd" || m === "usd billete" || m === "usd billetes") return "billetes";
  return null;
}

/** Tipo de dólar de la factura: manda la ficha; si no dice, el del presupuesto; si no, divisas. */
export function modalidadFactura(monedaPredeterminada?: string | null, modalidadPresupuesto?: string | null): Modalidad {
  const ficha = modalidadFicha(monedaPredeterminada);
  if (ficha) return ficha;
  return modalidadPresupuesto === "billetes" ? "billetes" : "divisas";
}

/** true si el tipo de dólar elegido va contra la ficha del cliente (hay que destrabarlo). */
export function modalidadContraFicha(monedaPredeterminada: string | null | undefined, elegida: Modalidad): boolean {
  const ficha = modalidadFicha(monedaPredeterminada);
  return !!ficha && ficha !== elegida;
}

export function nombreModalidad(m: Modalidad): string {
  return m === "billetes" ? "billete" : "divisa";
}

/**
 * Aviso de dólar billete a un cliente divisa (auditoría de la plata 30/10/2026; regla de Augusto: Corteva Seeds, Corteva
 * Agriscience, Synthon y Aerolíneas se facturan en pesos o en dólar divisa, nunca billete). Avisa, nunca frena:
 * - si se eligió dólar billete con un cliente "USD Divisa" en la ficha;
 * - si el tipo de cambio escrito a mano pasa al BNA divisa del día (FA 16-8 de Corteva Seeds: TC 1.535 a mano, billete).
 * `tcDivisa` = BNA divisa venta para esa factura (0 o null si no se sabe).
 */
export function avisoDolarBillete(p: { fichaMoneda?: string | null; moneda: string; modalidad: Modalidad; tc: number; tcDivisa?: number | null }): string | null {
  if (p.moneda !== "USD" || modalidadFicha(p.fichaMoneda) !== "divisas") return null;
  const regla = "Este cliente se factura en pesos o en dólar divisa, nunca billete.";
  if (p.modalidad === "billetes") return `Elegiste dólar billete: se le factura de más. ${regla}`;
  const ref = Number(p.tcDivisa) || 0;
  const tc = Number(p.tc) || 0;
  if (ref > 0 && tc > ref * 1.003) {
    const f = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `El tipo de cambio ($ ${f(tc)}) es más alto que el BNA divisa ($ ${f(ref)}): ¿es dólar billete? ${regla}`;
  }
  return null;
}

/** Fecha mínima para facturar: la mayor entre la que permite ARCA (o la última factura) y la fecha de la OC. */
export function fechaMinimaFactura(minFiscal: string, ocFecha?: string | null): string {
  const oc = String(ocFecha || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(oc) && oc > minFiscal ? oc : minFiscal;
}

/** true si la fecha elegida es anterior a la OC del cliente. */
export function fechaAntesDeOc(fecha: string, ocFecha?: string | null): boolean {
  const oc = String(ocFecha || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(oc) && !!fecha && fecha < oc;
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000);
}

/**
 * Sugerencia de atrasar la fecha: la más vieja permitida, si es anterior a la elegida y no pasa de hoy.
 * Devuelve null si no hay nada que sugerir.
 */
export function sugerenciaFechaFactura(p: { fecha: string; hoy: string; minFiscal: string; ocFecha?: string | null }): { fecha: string; dias: number } | null {
  const min = fechaMinimaFactura(p.minFiscal, p.ocFecha);
  if (!min || min > p.hoy || !p.fecha || min >= p.fecha) return null;
  return { fecha: min, dias: diasEntre(min, p.fecha) };
}

function fechaCorta(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Leyenda que va en las observaciones de la factura con la cotización usada. */
export function leyendaCotizacion(p: { modalidad: Modalidad; valor: number; fecha?: string | null; conversion?: { desde: string; hacia: string } | null }): string {
  const valor = p.valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dia = p.fecha ? ` del ${fechaCorta(p.fecha)}` : "";
  const base = `Cotización BNA dólar ${nombreModalidad(p.modalidad)} venta${dia}: $ ${valor}`;
  return p.conversion ? `${base} (precios convertidos de ${p.conversion.desde} a ${p.conversion.hacia}).` : `${base}.`;
}

/** Junta las observaciones del usuario con la leyenda de la cotización (sin repetirla). */
export function observacionesConCotizacion(observaciones: string, leyenda: string | null): string {
  const obs = observaciones.trim();
  if (!leyenda || obs.includes(leyenda)) return obs;
  return obs ? `${obs}\n${leyenda}` : leyenda;
}
