/**
 * Preguntas cortas para la conciliación de facturas de compra (Augusto 16/10: "ante la duda, que la IA haga
 * preguntas cortas y simples a quien cargó la factura"). Toma el resultado del cruce y arma UNA pregunta por
 * cada cosa que no cierra, con botones que deciden en un clic. Nada traba: siempre se puede corregir a mano
 * en la tabla. Las líneas del mismo renglón de OC (ej. una factura abierta por talle) van en una sola pregunta.
 */
import { parseVariant, esEnvio, type InvoiceLineInput, type MatchResult } from "./purchase-matching";
import { semaforoLinea, ocParaFlete, type Confianza, type Manual } from "./conciliacion-compras-analisis";

export type AccionPregunta =
  | { tipo: "aceptar" }          // es lo mismo, sin diferencia de precio
  | { tipo: "aceptar_costo" }    // es lo mismo y el costo nuevo pasa a la OC y al PR
  | { tipo: "reclamar" }         // es lo mismo, pero la diferencia de precio queda para reclamar al proveedor
  | { tipo: "fuera" }            // no es lo de la OC: queda en la factura fuera de OC (u OC complementaria)
  | { tipo: "asignar"; ocLineId: string; cantidad: number }
  | { tipo: "flete_oc"; ocId: string; ocNumero: string } // el flete se suma como renglón a esa OC
  | { tipo: "llegan_despues"; ocId: string }             // la OC queda parcial: lo que falta se sigue esperando
  | { tipo: "cerrar_oc"; ocId: string; ocNumero: string; motivo: string }; // lo que falta no viene: se cierra el saldo

export interface OpcionPregunta { label: string; accion: AccionPregunta }
export interface Pregunta { id: string; keys: string[]; texto: string; opciones: OpcionPregunta[] }

export interface OcLineaPregunta { id: string; ocNumero: string; descripcion: string; precio: number }
export interface SugerenciaSinOc { ocLineId: string; ocNumero: string; descripcion: string; libre: number }

const corto = (t: string, n = 45) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
/** Nombre corto que nunca pierde el talle (si se corta, se agrega "T XL" al final). */
const nombre = (t: string, n = 45) => {
  const c = corto(t, n), talle = parseVariant(t).talle;
  return talle && c !== t && !parseVariant(c).talle ? `${c} T ${talle}` : c;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export function armarPreguntas(args: {
  lineas: InvoiceLineInput[];
  resultado: MatchResult;
  ocLineas: OcLineaPregunta[];
  manual: Manual;
  confianza: Record<string, Confianza>;
  revisadas: Set<string>;
  motivo?: Record<string, string>;
  sugerenciaSinOc?: Map<string, SugerenciaSinOc>;
  /** OC parciales ya respondidas ("llegan después" o "cerrar"): no se vuelven a preguntar. */
  ocsRespondidas?: Set<string>;
  plata: (n: number) => string;
}): Pregunta[] {
  const { lineas, resultado, manual, confianza, revisadas, motivo = {}, sugerenciaSinOc, ocsRespondidas, plata } = args;
  const ocPorId = new Map(args.ocLineas.map(o => [o.id, o]));
  const color = (l: InvoiceLineInput) => semaforoLinea(l.key, l.descripcion, resultado, { manual, confianza, revisadas });
  const out: Pregunta[] = [];

  // Amarillas: agrupadas por renglón de OC.
  const grupos = new Map<string, InvoiceLineInput[]>();
  for (const l of lineas) {
    if (color(l) !== "amarillo") continue;
    const as = resultado.asignaciones.filter(a => a.invoiceKey === l.key);
    const sa = resultado.sinAsignar.find(s => s.invoiceKey === l.key);
    const ocLineId = as[0]?.ocLineId || sa?.ocLineId || l.key;
    grupos.set(ocLineId, [...(grupos.get(ocLineId) || []), l]);
  }
  for (const [ocLineId, ls] of grupos) {
    const keys = ls.map(l => l.key);
    const as = resultado.asignaciones.filter(a => keys.includes(a.invoiceKey));
    const oc = ocPorId.get(ocLineId);
    const partes: string[] = [];
    const notas = [...new Set(as.map(a => a.nota).filter(Boolean) as string[])];
    const nombreFc = ls.length > 1 ? corto(parseVariant(ls[0].descripcion).producto.toUpperCase()) : nombre(ls[0].descripcion);
    const conf = (key: string) => confianza[parseVariant(ls.find(l => l.key === key)?.descripcion || "").producto];
    const dudoso = as.some(a => a.origen === "parecido" || (a.origen === "equivalencia" && !!conf(a.invoiceKey) && conf(a.invoiceKey) !== "alta"));
    if (dudoso && oc) {
      const m = ls.map(l => motivo[parseVariant(l.descripcion).producto]).find(Boolean);
      partes.push(`¿"${nombreFc}" es "${nombre(oc.descripcion)}" de la ${oc.ocNumero}?${m ? ` (${corto(m, 70)})` : ""}`);
    } else if (oc) {
      partes.push(`"${nombreFc}" → ${oc.ocNumero} "${nombre(oc.descripcion)}".`);
    }
    // "Propuesto por parecido…" ya queda dicho en la pregunta: solo van las otras notas (talles, agregados).
    for (const n of notas.flatMap(x => x.split(" · ")).filter(x => !/^Propuesto por parecido/.test(x))) partes.push(`${n.replace(/\.$/, "")}.`);
    const sa = resultado.sinAsignar.filter(s => keys.includes(s.invoiceKey) && s.tipo === "de_mas");
    if (sa.length) partes.push(`Vienen ${round2(sa.reduce((t, s) => t + s.cantidad, 0))} de más.`);
    const conDif = as.filter(a => Math.abs(a.precioFactura - a.precioOc) > 0.005);
    const opciones: OpcionPregunta[] = [];
    if (conDif.length) {
      const pf = conDif[0].precioFactura, po = conDif[0].precioOc;
      const pct = po > 0 ? round2(((pf - po) / po) * 100) : 0;
      partes.push(`Precio: factura ${plata(pf)} y OC ${plata(po)} (${pct > 0 ? "+" : ""}${String(pct).replace(".", ",")} %).`);
      opciones.push({ label: "Sí, costo nuevo", accion: { tipo: "aceptar_costo" } }, { label: "Sí, reclamar precio", accion: { tipo: "reclamar" } });
    } else {
      opciones.push({ label: dudoso || notas.length ? "Sí, es lo mismo" : "Está bien", accion: { tipo: "aceptar" } });
    }
    opciones.push({ label: "No es lo de la OC", accion: { tipo: "fuera" } });
    out.push({ id: `a:${ocLineId}`, keys, texto: partes.join(" "), opciones });
  }

  // Rojas: no están en ninguna OC. Una pregunta por renglón.
  for (const l of lineas) {
    if (color(l) !== "rojo") continue;
    const sa = resultado.sinAsignar.find(s => s.invoiceKey === l.key);
    const cant = sa?.cantidad ?? l.cantidad;
    const opciones: OpcionPregunta[] = [];
    // Flete / envío: ¿se suma a la OC de esta factura o va aparte? (Augusto 16/10: "que me dé la opción")
    if (esEnvio(l.descripcion)) {
      const oc = ocParaFlete(lineas, resultado, l.key);
      if (oc) opciones.push({ label: `Sumar a la ${oc.ocNumero}`, accion: { tipo: "flete_oc", ocId: oc.ocId, ocNumero: oc.ocNumero } });
      opciones.push({ label: oc ? "No, aparte" : "Va aparte", accion: { tipo: "fuera" } });
      out.push({
        id: `r:${l.key}`, keys: [l.key],
        texto: `Viene flete: "${corto(l.descripcion)}" (${cant} × ${plata(l.precio)}).${oc ? ` ¿Lo sumo a la ${oc.ocNumero}?` : " Se paga con la factura, sin OC."}`,
        opciones,
      });
      continue;
    }
    const sug = sugerenciaSinOc?.get(l.key);
    if (sug && sug.libre > 0) opciones.push({ label: `Va a la ${sug.ocNumero}`, accion: { tipo: "asignar", ocLineId: sug.ocLineId, cantidad: Math.min(cant, sug.libre) } });
    opciones.push({ label: "No está en ninguna OC", accion: { tipo: "fuera" } });
    out.push({
      id: `r:${l.key}`, keys: [l.key],
      texto: `"${corto(l.descripcion)}" (${cant} × ${plata(l.precio)}) no apareció en las OC.${sug ? ` ¿Es "${corto(sug.descripcion)}" de la ${sug.ocNumero}?` : " Se paga igual con la factura."}`,
      opciones,
    });
  }

  // OC que quedan parciales: "vienen 31 de 35" → ¿lo que falta llega después o se cierra la OC? (sin responder = llega después)
  for (const q of preguntasFaltantes(resultado, ocPorId, ocsRespondidas)) out.push(q);
  return out;
}

/** Una pregunta por OC que esta(s) factura(s) tocan y dejan con unidades pendientes. */
export function preguntasFaltantes(resultado: MatchResult, ocPorId: Map<string, OcLineaPregunta>, respondidas?: Set<string>): Pregunta[] {
  const out: Pregunta[] = [];
  for (const ocId of resultado.ocsParciales) {
    if (respondidas?.has(ocId)) continue;
    const vienen = round2(resultado.asignaciones.filter(a => a.ocId === ocId).reduce((t, a) => t + a.cantidad, 0));
    const pend = resultado.pendientesOc.filter(p => p.ocId === ocId && p.cantidad > 0);
    const faltan = round2(pend.reduce((t, p) => t + p.cantidad, 0));
    if (!(vienen > 0) || !(faltan > 0)) continue;
    const ocNumero = pend[0]?.ocNumero || resultado.asignaciones.find(a => a.ocId === ocId)?.ocNumero || "";
    const total = round2(vienen + faltan);
    const detalle = pend.length === 1
      ? `"${nombre(ocPorId.get(pend[0].ocLineId)?.descripcion || "")}" de la ${ocNumero}: vienen ${vienen} de ${total} (faltan ${faltan}).`
      : `${ocNumero}: vienen ${vienen} de ${total} (faltan ${faltan} en ${pend.length} renglones: ${pend.slice(0, 2).map(p => `${p.cantidad} × ${corto(ocPorId.get(p.ocLineId)?.descripcion || "", 30)}`).join(", ")}${pend.length > 2 ? "…" : ""}).`;
    out.push({
      id: `f:${ocId}`, keys: [],
      texto: `${detalle} ¿Lo que falta llega después?`,
      opciones: [
        { label: "Llegan después", accion: { tipo: "llegan_despues", ocId } },
        { label: `Cerrar la OC en ${vienen}`, accion: { tipo: "cerrar_oc", ocId, ocNumero, motivo: `Vinieron ${vienen} de ${total}; el resto no llega` } },
      ],
    });
  }
  return out;
}
