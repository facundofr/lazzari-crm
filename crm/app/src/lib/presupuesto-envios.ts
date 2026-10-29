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

export interface ContactoMail { email: string | null; nombre: string | null; cargo?: string | null; sucursal_id?: string | null }

/** Contacto de facturación / pagos del cliente por su nombre o cargo ("Cuentas por pagar", "Administración", "Proveedores"…). */
export function esContactoDeFacturacion(c: { nombre?: string | null; cargo?: string | null }): boolean {
  return /factur|cuentas? (a |por )?pagar|pagos|proveedores|administraci|cobranz|invoice|payable|tesorer/i.test(`${c.nombre || ""} ${c.cargo || ""}`);
}

/**
 * Mails que se sugieren al enviar un PR (Augusto 29/10/2026): primero el solicitante del PR; después todos los contactos
 * del cliente con mail (los de la sucursal del PR primero). Los mails de facturación del cliente NO van: no es lo mismo
 * (ni email_facturacion ni contactos de pagos/administración, Augusto 29/10/2026).
 * `para` es el solicitante; sin solicitante queda vacío para elegir (nada se asigna solo).
 */
export function sugerenciasMailPR(d: {
  solicitante?: { email?: string | null; nombre?: string | null } | null;
  contactos: ContactoMail[];
  sucursalId?: string | null;
  emailCliente?: string | null;
  /** clientes.email_facturacion (separados por coma): nunca se sugieren, aunque estén cargados como contacto. */
  emailsFacturacion?: string | null;
  creador?: { email?: string | null; nombre?: string | null } | null;
}): { para: string; sugeridos: { email: string; label?: string }[] } {
  const deFacturacion = new Set(String(d.emailsFacturacion || "").split(/[,;]/).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const sugeridos: { email: string; label?: string }[] = [];
  const sumar = (email: string | null | undefined, label: string) => {
    const e = String(email || "").trim();
    if (e && !deFacturacion.has(e.toLowerCase()) && !sugeridos.some((s) => s.email.toLowerCase() === e.toLowerCase())) sugeridos.push({ email: e, label });
  };
  const solicitante = String(d.solicitante?.email || "").trim();
  sumar(solicitante, `Solicitante: ${d.solicitante?.nombre || ""}`.trim());
  const deLaSucursal = (c: ContactoMail) => (d.sucursalId && c.sucursal_id === d.sucursalId ? 0 : 1);
  [...d.contactos].filter((c) => !esContactoDeFacturacion(c)).sort((a, b) => deLaSucursal(a) - deLaSucursal(b))
    .forEach((c) => sumar(c.email, [c.nombre, c.cargo].filter(Boolean).join(" · ") || "Contacto"));
  sumar(d.emailCliente, "Email cliente");
  sumar(d.creador?.email, `Creador: ${d.creador?.nombre || ""}`.trim());
  return { para: solicitante, sugeridos };
}
