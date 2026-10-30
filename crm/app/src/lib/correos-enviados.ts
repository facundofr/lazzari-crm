// Correos enviados (tabla mails_enviados, Augusto 28/10/2026): estado verificado en Resend, textos y aviso de rebote.
// Funciones puras. Prueba: npx tsx scripts/test-correos-enviados.ts
import { fechaHoraAR } from "./presupuesto-envios";

export type EstadoMail = "enviado" | "entregado" | "rebotado" | "demorado" | "spam";

export interface MailEnviado {
  id: string;
  enviado_at: string;
  enviado_por: string | null;
  remitente: string | null;
  enviado_a: string;
  asunto: string | null;
  documento_tipo: string | null;
  documento_id: string | null;
  documento_nombre: string | null;
  estado: EstadoMail;
  estado_at: string | null;
  verificado_at: string | null;
}

/** Último evento de Resend → estado del CRM. Lo que no se reconoce queda "enviado" (se vuelve a mirar). */
export function estadoDesdeResend(lastEvent: string | null | undefined): EstadoMail {
  switch (lastEvent) {
    case "delivered": case "opened": case "clicked": return "entregado";
    case "bounced": return "rebotado";
    case "complained": return "spam";
    case "delivery_delayed": return "demorado";
    default: return "enviado";
  }
}

/** Entregado, rebotado o spam ya no cambian: no se vuelven a consultar. */
export function estadoFinal(e: EstadoMail): boolean {
  return e === "entregado" || e === "rebotado" || e === "spam";
}

/** Se vuelve a consultar si no es final, tiene id de Resend, se mandó hace menos de 7 días y no se miró en los últimos 5 minutos. */
export function hayQueVerificar(m: { estado: EstadoMail; enviado_at: string; verificado_at: string | null; resend_id?: string | null }, ahora = Date.now()): boolean {
  if (estadoFinal(m.estado) || !m.resend_id) return false;
  if (ahora - new Date(m.enviado_at).getTime() > 7 * 86400000) return false;
  return !m.verificado_at || ahora - new Date(m.verificado_at).getTime() > 5 * 60000;
}

export const ETIQUETA_ESTADO: Record<EstadoMail, string> = {
  enviado: "Enviado", entregado: "Entregado", rebotado: "Rebotó", demorado: "Demorado", spam: "Marcado como spam",
};

const TIPO_CORTO: Record<string, string> = {
  presupuesto: "PR", remito: "Remito", orden_compra: "OC", factura: "Factura", orden_pago: "OP", recibo: "Recibo", resumen_cuenta: "Resumen de cuenta", aviso_cobranza: "Aviso de cobranza",
};

/** "PR-2026-1285" (del nombre del PDF) o el tipo de documento. */
export function nombreDocumento(m: { documento_tipo: string | null; documento_nombre: string | null }): string {
  const n = String(m.documento_nombre || "").replace(/\.pdf$/i, "").trim();
  return n || TIPO_CORTO[m.documento_tipo || ""] || "Mail";
}

/** Aviso de la campana para quien mandó un mail que rebotó. */
export function avisoRebote(m: { enviado_at: string; enviado_a: string; documento_tipo: string | null; documento_nombre: string | null; estado: EstadoMail }): { title: string; description: string } {
  const doc = nombreDocumento(m);
  const que = m.estado === "spam" ? "lo marcó como spam" : "no llegó (la dirección no existe o rechazó el mail)";
  return {
    title: `Mail que no llegó: ${doc}`,
    description: `El ${fechaHoraAR(m.enviado_at)} mandaste ${doc} a ${m.enviado_a} y ${que}. Revisá el mail en Correos enviados y mandalo de nuevo.`,
  };
}
