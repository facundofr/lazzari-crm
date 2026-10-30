// Avisos de cobranza (Augusto 29/10/2026): facturas de venta que vencen esta semana (recordatorio) y vencidas
// (reclamo), agrupadas por cliente, con un mensaje predeterminado que se puede cambiar antes de mandar.
// Funciones puras: la pantalla /cobranzas trae los datos y manda; acá solo se arman listas y textos. Nada se envía solo.

export type TipoAviso = "semana" | "vencidas";
export type MonedaAviso = "ARS" | "USD";

export interface FacturaAviso {
  id: string;
  clienteId: string;
  cliente: string;
  cuit: string | null;
  /** "FA 0015-00000086" */
  comprobante: string;
  fecha: string;
  /** Vencimiento guardado en la factura (null = no tiene). */
  fechaVencimiento: string | null;
  saldo: number;
  moneda: MonedaAviso;
}

export interface FacturaEnAviso extends FacturaAviso {
  /** Vencimiento que se usa: el de la factura, o la fecha + los días de cuenta corriente del cliente. */
  vence: string;
  /** Días hasta el vencimiento (negativo = vencida hace N días). */
  dias: number;
}

export interface GrupoAviso {
  tipo: TipoAviso;
  clienteId: string;
  cliente: string;
  cuit: string | null;
  facturas: FacturaEnAviso[];
  total: Record<MonedaAviso, number>;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const iso = (s: string) => String(s).slice(0, 10);
const aUTC = (s: string) => Date.parse(`${iso(s)}T12:00:00Z`);
export const diasEntre = (desde: string, hasta: string) => Math.round((aUTC(hasta) - aUTC(desde)) / 86_400_000);

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(aUTC(fecha));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Domingo de la semana de `hoy` (la semana va de lunes a domingo). */
export function finDeSemana(hoy: string): string {
  const dow = new Date(aUTC(hoy)).getUTCDay(); // 0 = domingo
  return sumarDias(hoy, dow === 0 ? 0 : 7 - dow);
}

/** Vencimiento de la factura; si no tiene, la fecha + los días de cuenta corriente del cliente. */
export function venceFactura(f: { fecha: string; fechaVencimiento: string | null }, diasCC: number): string {
  return f.fechaVencimiento ? iso(f.fechaVencimiento) : sumarDias(f.fecha, Math.max(0, Math.round(diasCC || 0)));
}

/**
 * Arma las dos listas: "semana" = vencen desde hoy hasta el domingo; "vencidas" = vencieron antes de hoy.
 * Solo facturas con saldo (≥ 1). Un cliente puede estar en las dos. Orden: más plata en $ arriba.
 */
export function armarAvisos(facturas: FacturaAviso[], diasCC: Map<string, number>, hoy: string): Record<TipoAviso, GrupoAviso[]> {
  const domingo = finDeSemana(hoy);
  const grupos: Record<TipoAviso, Map<string, GrupoAviso>> = { semana: new Map(), vencidas: new Map() };
  for (const f of facturas) {
    if (!f.clienteId || !(f.saldo >= 1)) continue;
    const vence = venceFactura(f, diasCC.get(f.clienteId) || 0);
    const tipo: TipoAviso | null = vence < hoy ? "vencidas" : vence <= domingo ? "semana" : null;
    if (!tipo) continue;
    const g = grupos[tipo].get(f.clienteId) || { tipo, clienteId: f.clienteId, cliente: f.cliente, cuit: f.cuit, facturas: [], total: { ARS: 0, USD: 0 } };
    g.facturas.push({ ...f, vence, dias: diasEntre(hoy, vence) });
    g.total[f.moneda] = r2(g.total[f.moneda] + f.saldo);
    grupos[tipo].set(f.clienteId, g);
  }
  const ordenar = (m: Map<string, GrupoAviso>) => [...m.values()]
    .map((g) => ({ ...g, facturas: [...g.facturas].sort((a, b) => a.vence.localeCompare(b.vence) || a.comprobante.localeCompare(b.comprobante)) }))
    .sort((a, b) => b.total.ARS - a.total.ARS || b.total.USD - a.total.USD || a.cliente.localeCompare(b.cliente));
  return { semana: ordenar(grupos.semana), vencidas: ordenar(grupos.vencidas) };
}

export const fmtFechaAviso = (s: string) => iso(s).split("-").reverse().join("/");
export function fmtMontoAviso(n: number, moneda: MonedaAviso): string {
  const s = n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === "USD" ? `US$ ${s}` : `$ ${s}`;
}
/** "$ 1.000,00 + US$ 50,00" (solo las monedas que tienen algo). */
export function totalTexto(total: Record<MonedaAviso, number>): string {
  return (["ARS", "USD"] as MonedaAviso[]).filter((m) => total[m] > 0).map((m) => fmtMontoAviso(total[m], m)).join(" + ") || "$ 0,00";
}

/** Mensaje predeterminado: recordatorio (vencen esta semana) o reclamo (vencidas). */
export function mensajeAviso(g: GrupoAviso, sociedad: string): { asunto: string; texto: string } {
  const una = g.facturas.length === 1;
  const lineas = g.facturas.map((f) => g.tipo === "vencidas"
    ? `• ${f.comprobante} del ${fmtFechaAviso(f.fecha)} — venció el ${fmtFechaAviso(f.vence)} (${-f.dias} ${-f.dias === 1 ? "día" : "días"}) — ${fmtMontoAviso(f.saldo, f.moneda)}`
    : `• ${f.comprobante} del ${fmtFechaAviso(f.fecha)} — vence el ${fmtFechaAviso(f.vence)}${f.dias === 0 ? " (hoy)" : ""} — ${fmtMontoAviso(f.saldo, f.moneda)}`);
  const total = una ? [] : [``, `Total: ${totalTexto(g.total)}`];
  if (g.tipo === "semana") {
    return {
      asunto: `${sociedad} - ${una ? "Factura que vence" : "Facturas que vencen"} esta semana - ${g.cliente}`,
      texto: [
        `Hola, buen día.`,
        ``,
        `Te escribimos de ${sociedad} para recordarte ${una ? "la factura de" : "las facturas de"} ${g.cliente} que ${una ? "vence" : "vencen"} esta semana:`,
        ``,
        ...lineas,
        ...total,
        ``,
        `Te ${una ? "la" : "las"} adjuntamos. Cuando hagan el pago, por favor envíennos el comprobante y la retención (si corresponde) para imputarlo.`,
        ``,
        `Gracias, quedamos atentos.`,
      ].join("\n"),
    };
  }
  return {
    asunto: `${sociedad} - ${una ? "Factura vencida" : "Facturas vencidas"} - ${g.cliente}`,
    texto: [
      `Hola, buen día.`,
      ``,
      `Te escribimos de ${sociedad}. Revisando la cuenta corriente de ${g.cliente} vemos ${una ? "una factura vencida" : "las siguientes facturas vencidas"}:`,
      ``,
      ...lineas,
      ...(una ? [] : [``, `Total adeudado: ${totalTexto(g.total)}`]),
      ``,
      `Te ${una ? "la" : "las"} adjuntamos. Si ya ${una ? "la" : "las"} abonaron, te pedimos que nos envíen el comprobante de pago y la retención (si corresponde) para imputarlo. Si no, ¿nos confirman la fecha estimada de pago?`,
      ``,
      `Gracias, quedamos atentos.`,
    ].join("\n"),
  };
}

/** Texto del mail a HTML simple (escapado, con saltos de línea). */
export function textoAHtml(texto: string): string {
  const esc = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${esc.replace(/\n/g, "<br>")}</div>`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Separa "a@x.com; b@y.com, c" en mails válidos, sin repetir. */
export function separarMails(s: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(s || "").split(/[,;\s]+/)) {
    const x = m.trim().toLowerCase();
    if (EMAIL.test(x) && !out.includes(x)) out.push(x);
  }
  return out;
}

/** Contacto que paga: Cobranzas, Cuentas por pagar, Facturas a pagar, Pagos, Tesorería, Proveedores, payables… */
const DE_PAGOS = /cobranza|pagar|pagos|payable|tesorer|proveedores|accounts|cuentas/i;

/** Para: los contactos de pagos del cliente (por cargo, nombre o mail); si no tiene, el mail del cliente. */
export function destinatariosAviso(contactos: { cargo: string | null; nombre: string | null; email: string | null }[], emailCliente: string | null): string[] {
  const cobr = contactos.filter((c) => [c.cargo, c.nombre, String(c.email || "").split("@")[0]].some((x) => DE_PAGOS.test(x || "")));
  const deCobranzas = separarMails(cobr.map((c) => c.email).join(","));
  return deCobranzas.length ? deCobranzas : separarMails(emailCliente);
}

/** "hoy", "ayer", "hace 3 días" */
export function haceCuanto(fecha: string, hoy: string): string {
  const d = diasEntre(iso(fecha), hoy);
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
}
