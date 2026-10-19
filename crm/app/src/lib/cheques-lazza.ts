// Finanzas Lazza → Cheques (diseño de Augusto 19/10/2026): todos los cheques con todos los estados, resumen por estado,
// lo que está EN FECHA de pago y de cobro, y resumen por semana de las próximas 4 semanas. Solo informativo.
// "En fecha" usa la misma regla que Finanzas (lib/cheques-plazo). Prueba: npx tsx scripts/test-cheques-lazza.ts
import { chequePendiente, domingoDe, type ChequeParaPlazo } from "@/lib/cheques-plazo";

export interface ChequeFL extends ChequeParaPlazo {
  id: string;
  numero: string;
  direccion: "emitido" | "recibido";
  cubre_tercero?: string | null;
}

/** Estado para mostrar (un emitido "cobrado" es uno que el banco ya debitó). */
export function estadoCheque(ch: Pick<ChequeFL, "direccion" | "estado">): { clave: string; label: string; tono: "naranja" | "azul" | "verde" | "rojo" | "gris" | "violeta" } {
  const e = ch.estado;
  if (e === "rechazado") return { clave: `${ch.direccion}:rechazado`, label: "Rechazado", tono: "rojo" };
  if (e === "anulado") return { clave: `${ch.direccion}:anulado`, label: "Anulado", tono: "gris" };
  if (ch.direccion === "emitido") {
    if (e === "pendiente" || e === "entregado") return { clave: "emitido:sin_debitar", label: "Emitido sin debitar", tono: "naranja" };
    if (e === "cobrado") return { clave: "emitido:debitado", label: "Debitado", tono: "verde" };
  } else {
    if (e === "en_cartera") return { clave: "recibido:en_cartera", label: "En cartera", tono: "azul" };
    if (e === "depositado") return { clave: "recibido:depositado", label: "Depositado", tono: "violeta" };
    if (e === "cobrado") return { clave: "recibido:cobrado", label: "Cobrado", tono: "verde" };
    if (e === "endosado") return { clave: "recibido:endosado", label: "Endosado", tono: "gris" };
  }
  return { clave: `${ch.direccion}:${e}`, label: e || "Sin estado", tono: "gris" };
}

export interface Total { cantidad: number; ARS: number; USD: number }
const vacio = (): Total => ({ cantidad: 0, ARS: 0, USD: 0 });
const sumar = (t: Total, ch: ChequeParaPlazo) => { t.cantidad += 1; t[ch.moneda === "USD" ? "USD" : "ARS"] += Number(ch.monto) || 0; };
const redondear = (t: Total) => { t.ARS = Math.round(t.ARS * 100) / 100; t.USD = Math.round(t.USD * 100) / 100; return t; };

/** Resumen por estado, en el orden en que se muestra (primero emitidos, después recibidos). */
export function resumenPorEstado(cheques: ChequeFL[]): Array<{ clave: string; label: string; tono: ReturnType<typeof estadoCheque>["tono"]; direccion: "emitido" | "recibido"; total: Total }> {
  const orden = ["emitido:sin_debitar", "emitido:debitado", "emitido:rechazado", "emitido:anulado", "recibido:en_cartera", "recibido:depositado", "recibido:cobrado", "recibido:endosado", "recibido:rechazado", "recibido:anulado"];
  const porClave = new Map<string, { clave: string; label: string; tono: ReturnType<typeof estadoCheque>["tono"]; direccion: "emitido" | "recibido"; total: Total }>();
  for (const ch of cheques) {
    const e = estadoCheque(ch);
    if (!porClave.has(e.clave)) porClave.set(e.clave, { ...e, direccion: ch.direccion, total: vacio() });
    sumar(porClave.get(e.clave)!.total, ch);
  }
  const pos = (k: string) => { const i = orden.indexOf(k); return i < 0 ? 99 : i; };
  return [...porClave.values()].map((x) => ({ ...x, total: redondear(x.total) })).sort((a, b) => pos(a.clave) - pos(b.clave));
}

/** En fecha hoy: propios sin debitar con fecha de pago ≤ hoy (para pagar) y recibidos en cartera ≤ hoy (para cobrar). */
export function enFecha(cheques: ChequeFL[], hoy: string): { pagar: Total; cobrar: Total } {
  const r = { pagar: vacio(), cobrar: vacio() };
  for (const ch of cheques) {
    if (!chequePendiente(ch) || !ch.fecha_pago || String(ch.fecha_pago).slice(0, 10) > hoy) continue;
    sumar(ch.direccion === "emitido" ? r.pagar : r.cobrar, ch);
  }
  return { pagar: redondear(r.pagar), cobrar: redondear(r.cobrar) };
}

const masDias = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/**
 * Las próximas 4 semanas (sin lo que ya está en fecha): la 1ª va de mañana al domingo, las otras de lunes a domingo.
 * Pagar = propios sin debitar; cobrar = recibidos en cartera.
 */
export function proximasSemanas(cheques: ChequeFL[], hoy: string, cuantas = 4): Array<{ desde: string; hasta: string; pagar: Total; cobrar: Total }> {
  const semanas: Array<{ desde: string; hasta: string; pagar: Total; cobrar: Total }> = [];
  let desde = masDias(hoy, 1);
  let hasta = domingoDe(hoy);
  if (hasta < desde) hasta = masDias(hoy, 7); // hoy es domingo: la 1ª semana es la que arranca mañana
  for (let i = 0; i < cuantas; i++) {
    semanas.push({ desde, hasta, pagar: vacio(), cobrar: vacio() });
    desde = masDias(hasta, 1);
    hasta = masDias(hasta, 7);
  }
  for (const ch of cheques) {
    if (!chequePendiente(ch) || !ch.fecha_pago) continue;
    const f = String(ch.fecha_pago).slice(0, 10);
    const s = semanas.find((x) => f >= x.desde && f <= x.hasta);
    if (s) sumar(ch.direccion === "emitido" ? s.pagar : s.cobrar, ch);
  }
  return semanas.map((s) => ({ ...s, pagar: redondear(s.pagar), cobrar: redondear(s.cobrar) }));
}
