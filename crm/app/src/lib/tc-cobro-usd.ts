// Cobros de facturas en USD (regla de Augusto, 12/10/2026):
// - La factura se cancela con el tipo de cambio que usó el cliente (pesos + retenciones ÷ USD cancelados).
// - Se compara con el BNA del día hábil anterior al cobro, divisa o billete según la factura o la ficha del cliente.
// - Si el cliente pagó más de 2 % abajo del BNA → aviso para pedirle la actualización. Si pagó arriba → se muestra en verde.
// Nunca frena: es solo un aviso.

export type ModalidadUsd = "divisas" | "billetes";

export const UMBRAL_TC_COBRO = 0.02;

/**
 * Divisa o billete para comparar: lo que dicen las facturas (si todas coinciden);
 * si no, la ficha del cliente ("USD" = billete, "USD Divisa" = divisa); si no, divisas.
 */
export function modalidadCobroUsd(modalidadesFacturas: (string | null | undefined)[], monedaCliente?: string | null): ModalidadUsd {
  const deFacturas = [...new Set(modalidadesFacturas.filter((m): m is ModalidadUsd => m === "divisas" || m === "billetes"))];
  if (deFacturas.length === 1) return deFacturas[0];
  if (monedaCliente === "USD") return "billetes";
  if (monedaCliente === "USD Divisa") return "divisas";
  return deFacturas[0] ?? "divisas";
}

export interface ComparacionTc {
  /** (TC cliente − BNA) ÷ BNA. Negativo = el cliente pagó abajo del BNA. */
  diferenciaPct: number;
  /** Pesos de diferencia sobre los USD cancelados (positivo = falta cobrar). */
  faltante: number;
  estado: "abajo" | "en_rango" | "arriba";
}

/** Compara el TC que usó el cliente con el BNA. "abajo" solo si pasa el umbral (2 %). */
export function compararTcCobro(tcCliente: number, tcBna: number, usd: number, umbral = UMBRAL_TC_COBRO): ComparacionTc | null {
  if (!(tcCliente > 0) || !(tcBna > 0) || !(usd > 0)) return null;
  const diferenciaPct = (tcCliente - tcBna) / tcBna;
  const faltante = Math.round((tcBna - tcCliente) * usd * 100) / 100;
  const estado = diferenciaPct < -umbral ? "abajo" : diferenciaPct > 0 && faltante <= -1 ? "arriba" : "en_rango";
  return { diferenciaPct, faltante, estado };
}

const ars = (n: number) => `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");

/** Mensaje listo para mandarle al cliente pidiendo la actualización por tipo de cambio. */
export function mensajeActualizacionTc(p: { facturas: string[]; tcCliente: number; tcBna: number; modalidad: ModalidadUsd; fechaBna: string; faltante: number }): string {
  const fc = p.facturas.length === 1 ? `la factura ${p.facturas[0]}` : `las facturas ${p.facturas.join(", ")}`;
  return `Hola, ¿cómo están? Recibimos el pago de ${fc}. Se tomó un tipo de cambio de ${ars(p.tcCliente)}, ` +
    `y el dólar BNA ${p.modalidad === "billetes" ? "billete" : "divisa"} del ${fechaCorta(p.fechaBna)} (día hábil anterior al pago) era ${ars(p.tcBna)}. ` +
    `Queda una diferencia de ${ars(p.faltante)}. ¿Nos podrán transferir esa actualización? Muchas gracias.`;
}
