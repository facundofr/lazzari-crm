// OC con diferencia entre lo pedido y lo facturado: qué conviene sugerir. Solo sugiere; el usuario elige.

export const TOLERANCIA_DIFERENCIA = 0.01; // menos del 1 % se toma como completa (redondeos, percepciones)

export interface DiagnosticoOC {
  oc_neto: number;
  oc_total: number;
  saldo_cerrado: boolean;
  cant_pedida: number;
  cant_recibida: number;
  cant_facturada: number | null; // solo si la factura se concilió por renglón
  n_facturas: number;
  fc_neto: number;
  fc_total: number;
  todas_pagadas: boolean;
  compartida: boolean; // alguna factura está repartida entre varias OC
  otra_moneda: boolean;
  ajuste_activo: boolean;
}

export type SugerenciaOC = "ajustar" | "cerrar";

export interface DiferenciaOC {
  diferencia: number; // total de la OC menos lo facturado (positivo = facturaron menos)
  porcentaje: number; // sobre el total de la OC
  faltanUnidades: number; // pedidas - facturadas (solo si la factura se concilió por renglón)
  puedeAjustar: boolean;
  sugerencia: SugerenciaOC;
  motivo: string;
}

/** null si no hay nada que mostrar (sin facturas, saldo cerrado, ya ajustada o diferencia menor al 1 %). */
export function analizarDiferenciaOC(d: DiagnosticoOC | null): DiferenciaOC | null {
  if (!d || d.saldo_cerrado || d.ajuste_activo || d.n_facturas === 0 || !(d.oc_total > 0)) return null;
  const diferencia = Math.round((d.oc_total - d.fc_total) * 100) / 100;
  const porcentaje = diferencia / d.oc_total;
  if (Math.abs(porcentaje) < TOLERANCIA_DIFERENCIA) return null;

  const faltanUnidades = d.cant_facturada != null ? Math.max(0, d.cant_pedida - d.cant_facturada) : 0;
  const puedeAjustar = !d.compartida && !d.otra_moneda && d.fc_neto > 0 && d.oc_neto > 0;

  if (faltanUnidades > 0.0001 || !puedeAjustar) {
    return {
      diferencia, porcentaje, faltanUnidades, puedeAjustar, sugerencia: "cerrar",
      motivo: faltanUnidades > 0.0001
        ? `Faltan facturar ${faltanUnidades} unidades: si el proveedor no las va a mandar, cerrá la OC; si las va a mandar, dejala abierta.`
        : "La factura está repartida entre varias OC o en otra moneda: si no va a llegar nada más, cerrá la OC.",
    };
  }
  return {
    diferencia, porcentaje, faltanUnidades: 0, puedeAjustar, sugerencia: "ajustar",
    motivo: diferencia > 0
      ? "La factura vino más barata que la OC. Si fue un descuento o un precio distinto, ajustá la OC a la factura (también actualiza el costo del PR). Si todavía falta otra factura, dejala abierta."
      : "La factura vino más cara que la OC: ajustá la OC a la factura (también actualiza el costo del PR).",
  };
}
