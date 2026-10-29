// Envíos por mail de un PR (tabla mails_enviados, Augusto 28/10/2026): quién, cuándo, a quién y si llegó. Funciones puras.
// Prueba: npx tsx scripts/test-presupuesto-envios.ts

export interface EnvioPR {
  presupuesto_id: string;
  enviado_at: string;
  enviado_por: string | null;
  enviado_a: string;
  /** Estado verificado en Resend (Correos enviados), ya en palabras: "Entregado", "Rebotó"… */
  estadoTexto?: string | null;
}

/** Fecha y hora de Argentina: "28/10/2026 14:32". */
export function fechaHoraAR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = Object.fromEntries(new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** "28/10/2026 14:32 · Sebastian → compras@cliente.com · Entregado" */
export function textoEnvio(e: EnvioPR, nombreDe: (id: string | null) => string | null | undefined): string {
  return `${fechaHoraAR(e.enviado_at)} · ${nombreDe(e.enviado_por) || "—"} → ${e.enviado_a}${e.estadoTexto ? ` · ${e.estadoTexto}` : ""}`;
}

/** Envíos agrupados por PR, el más nuevo primero. */
export function enviosPorPR(envios: EnvioPR[]): Map<string, EnvioPR[]> {
  const m = new Map<string, EnvioPR[]>();
  for (const e of envios) m.set(e.presupuesto_id, [...(m.get(e.presupuesto_id) || []), e]);
  for (const lista of m.values()) lista.sort((a, b) => b.enviado_at.localeCompare(a.enviado_at));
  return m;
}
