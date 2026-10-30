// Correos enviados (tabla mails_enviados, Augusto 28/10/2026): estado verificado en Resend, textos y aviso de rebote.
// Funciones puras. Prueba: npx tsx scripts/test-correos-enviados.ts
import { fechaHoraAR } from "./presupuesto-envios";

// "programado" / "cancelado" (Augusto 29/10/2026): mail programado para una fecha y hora (enviado_at = cuándo sale) y su cancelación.
export type EstadoMail = "enviado" | "entregado" | "rebotado" | "demorado" | "spam" | "programado" | "cancelado";

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
    case "scheduled": return "programado";
    case "canceled": return "cancelado";
    default: return "enviado";
  }
}

/** Entregado, rebotado, spam o cancelado ya no cambian: no se vuelven a consultar. */
export function estadoFinal(e: EstadoMail): boolean {
  return e === "entregado" || e === "rebotado" || e === "spam" || e === "cancelado";
}

/** Se vuelve a consultar si no es final, tiene id de Resend, se mandó hace menos de 7 días y no se miró en los últimos 5 minutos. */
export function hayQueVerificar(m: { estado: EstadoMail; enviado_at: string; verificado_at: string | null; resend_id?: string | null }, ahora = Date.now()): boolean {
  if (estadoFinal(m.estado) || !m.resend_id) return false;
  if (m.estado === "programado" && new Date(m.enviado_at).getTime() > ahora) return false; // todavía no salió
  if (ahora - new Date(m.enviado_at).getTime() > 7 * 86400000) return false;
  return !m.verificado_at || ahora - new Date(m.verificado_at).getTime() > 5 * 60000;
}

export const ETIQUETA_ESTADO: Record<EstadoMail, string> = {
  enviado: "Enviado", entregado: "Entregado", rebotado: "Rebotó", demorado: "Demorado", spam: "Marcado como spam",
  programado: "Programado", cancelado: "Cancelado",
};

/** Resend deja programar hasta 30 días antes. */
const MAX_PROGRAMAR_MS = 30 * 86400000;

/** Fecha (AAAA-MM-DD) y hora (HH:MM) de Argentina → ISO, o el motivo por el que no se puede programar. */
export function programarPara(fecha: string, hora: string, ahora = Date.now()): { iso: string } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return { error: "Elegí día y hora." };
  const d = new Date(`${fecha}T${hora}:00-03:00`);
  if (Number.isNaN(d.getTime())) return { error: "Elegí día y hora." };
  return validarProgramado(d.toISOString(), ahora);
}

/** Lo que manda la pantalla: tiene que ser dentro de al menos 2 minutos y de no más de 30 días. */
export function validarProgramado(iso: string, ahora = Date.now()): { iso: string } | { error: string } {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { error: "La fecha para programar no es válida." };
  if (t < ahora + 2 * 60000) return { error: "Esa hora ya pasó: elegí una más adelante." };
  if (t > ahora + MAX_PROGRAMAR_MS) return { error: "Se puede programar hasta 30 días adelante." };
  return { iso: new Date(t).toISOString() };
}

/** Mañana a las 9:00 (Argentina), para proponer al programar. */
export function mananaALas9(hoyAR: string): { fecha: string; hora: string } {
  const d = new Date(`${hoyAR}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return { fecha: d.toISOString().slice(0, 10), hora: "09:00" };
}

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
