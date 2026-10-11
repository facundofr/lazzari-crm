/**
 * Estado que se muestra de una factura de venta.
 * - "pagada" y "anulada" se muestran tal cual.
 * - Si se había cobrado con un cheque que vino rechazado y sigue sin cobrar: "cheque_rechazado".
 * - "emitida": "vencida" si pasó su vencimiento, si no "pendiente".
 */
export type EstadoVisibleFactura = "pendiente" | "vencida" | "parcial" | "pagada" | "anulada" | "cheque_rechazado" | string;

export function estadoVisibleFactura(
  f: { estado: string; cheque_rechazado_at?: string | null },
  vencimiento: string | null | undefined,
  hoy: string,
): EstadoVisibleFactura {
  const estado = f.estado;
  if (estado === "pagada" || estado === "anulada") return estado;
  if (f.cheque_rechazado_at && (estado === "emitida" || estado === "parcial")) return "cheque_rechazado";
  if (estado === "emitida") return vencimiento && vencimiento < hoy ? "vencida" : "pendiente";
  return estado;
}
