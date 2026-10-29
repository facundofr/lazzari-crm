// Presupuestos nuevo > Seguimiento: a qué PR le toca contacto hoy, cuáles esperan y cuáles están vencidos.
// Lógica pura (sin pantalla ni base). Prueba: scripts/test-presupuesto-seguimiento.ts

export const DIAS_PRIMER_SEGUIMIENTO = 3;
export const DIAS_ENTRE_CONTACTOS = 3;

export type TipoSeg = "contacto" | "resultado" | "posponer" | "extension" | "nota";
export interface EventoSeg {
  id: string; presupuesto_id: string; tipo: TipoSeg; canal?: string | null; resultado?: string | null;
  detalle?: string | null; proxima_fecha?: string | null; user_id?: string | null; created_at: string;
}
export interface PRSeg { id: string; estado: string; fecha?: string | null; vencimiento?: string | null; enviado_at?: string | null }
export type GrupoSeg = "hoy" | "esperando" | "vencido";

export interface ClasificacionSeg {
  grupo: GrupoSeg;
  /** Días desde que se mandó el PR. */
  diasEnviado: number;
  /** Días desde el último contacto (null si nunca). */
  diasDesdeContacto: number | null;
  /** Fecha en que le toca el próximo seguimiento. */
  proxima: string;
  /** Días de atraso respecto de esa fecha (0 si todavía no toca). */
  atraso: number;
  contactos: number;
  ultimoContacto: EventoSeg | null;
  diasVencido: number;
}

/** Fecha (AAAA-MM-DD) en Argentina de un instante ISO. */
export function fechaAR(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });
}

const aUTC = (f: string) => { const [y, m, d] = f.split("-").map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
export const diasEntre = (desde: string, hasta: string): number => Math.round((aUTC(hasta) - aUTC(desde)) / 86400000);
export function sumarDias(fecha: string, n: number): string {
  const d = new Date(aUTC(fecha) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

export function clasificarPR(pr: PRSeg, eventos: EventoSeg[], hoy: string): ClasificacionSeg {
  const evs = [...eventos].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const contactos = evs.filter(e => e.tipo === "contacto" || (e.tipo === "resultado" && e.resultado === "no_contesto"));
  const ultimoContacto = contactos[0] || null;
  const enviado = fechaAR(pr.enviado_at) || fechaAR(pr.fecha) || hoy;
  const refContacto = ultimoContacto ? fechaAR(ultimoContacto.created_at) : null;
  const diasEnviado = Math.max(0, diasEntre(enviado, hoy));
  const diasDesdeContacto = refContacto ? Math.max(0, diasEntre(refContacto, hoy)) : null;

  const venc = fechaAR(pr.vencimiento);
  const vencido = pr.estado === "vencido" || (!!venc && venc < hoy);

  const conFecha = evs.find(e => !!e.proxima_fecha);
  // Una fecha anterior al último contacto ya no cuenta (por ejemplo, un posponer viejo).
  const proximaEv = conFecha && (!refContacto || fechaAR(conFecha.created_at) >= refContacto || (conFecha.proxima_fecha as string) > refContacto) ? (conFecha.proxima_fecha as string).slice(0, 10) : null;
  const base = refContacto || enviado;
  const proxima = proximaEv || sumarDias(base, refContacto ? DIAS_ENTRE_CONTACTOS : DIAS_PRIMER_SEGUIMIENTO);
  const atraso = Math.max(0, diasEntre(proxima, hoy));
  const grupo: GrupoSeg = vencido ? "vencido" : proxima <= hoy ? "hoy" : "esperando";
  return { grupo, diasEnviado, diasDesdeContacto, proxima, atraso, contactos: contactos.length, ultimoContacto, diasVencido: vencido && venc ? Math.max(0, diasEntre(venc, hoy)) : 0 };
}

export interface ItemOrden { grupo: GrupoSeg; atraso: number; diasEnviado: number; montoPesos: number }
/** Primero lo más atrasado y de más plata. */
export function compararSeguimiento(a: ItemOrden, b: ItemOrden): number {
  return (b.atraso - a.atraso) || (b.montoPesos - a.montoPesos) || (b.diasEnviado - a.diasEnviado);
}

export const MOTIVOS_PERDIDO = ["Precio", "Plazo de entrega", "Compró a otro proveedor", "Ya no lo necesita", "Venció sin respuesta", "Otro"] as const;
export const CANAL_TEXTO: Record<string, string> = { mail: "mail", whatsapp: "WhatsApp", llamada: "llamada", otro: "otro" };

/** "hoy", "ayer", "hace 3 días" */
export function haceDias(d: number): string {
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
}

// Avisos de la campana del control diario (cron presupuestos-vencimiento). Cada paso tiene su propio título
// (antes el de 5 días repetía el de 3 y nunca salía). Se dedupe por lo que va antes de ":".
export const AVISOS_SEGUIMIENTO_PR = [
  { dias: 3, title: "Seguimiento PR", urgente: false },
  { dias: 5, title: "Seguimiento PR (5 días)", urgente: false },
  { dias: 7, title: "Seguimiento urgente PR", urgente: true },
] as const;
export type AvisoSeguimientoPR = (typeof AVISOS_SEGUIMIENTO_PR)[number];

/** El aviso que toca hoy: solo el último paso alcanzado, y nada si ya salió ese o uno posterior
 *  (así un PR viejo no recibe los tres juntos ni vuelve atrás). `yaSalieron`: títulos ya creados para ese PR. */
export function avisoSeguimientoQueToca(dias: number, yaSalieron: ReadonlySet<string>): AvisoSeguimientoPR | null {
  let i = -1;
  AVISOS_SEGUIMIENTO_PR.forEach((a, k) => { if (dias >= a.dias) i = k; });
  if (i < 0) return null;
  for (let k = i; k < AVISOS_SEGUIMIENTO_PR.length; k++) if (yaSalieron.has(AVISOS_SEGUIMIENTO_PR[k].title)) return null;
  return AVISOS_SEGUIMIENTO_PR[i];
}
