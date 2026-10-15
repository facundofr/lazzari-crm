// Agente de correo y cobros: lógica pura (sin red ni base). Todo lo que sale de acá es SUGERENCIA, nunca bloquea.
// Prueba: scripts/test-agente-mail.ts (npx tsx scripts/test-agente-mail.ts)

export type CategoriaMail = "pago_retencion" | "reclamo_consulta" | "factura_proveedor" | "oc_cliente" | "vencimiento_aviso" | "otro";
export type PrioridadMail = "alta" | "normal" | "baja";

export const CATEGORIAS_MAIL: { id: CategoriaMail; label: string; prioridad: PrioridadMail; leerAdjuntos: boolean }[] = [
  { id: "pago_retencion", label: "Pagos y retenciones", prioridad: "alta", leerAdjuntos: true },
  { id: "reclamo_consulta", label: "Reclamos y consultas", prioridad: "alta", leerAdjuntos: true },
  { id: "factura_proveedor", label: "Facturas y notas de crédito de proveedores", prioridad: "normal", leerAdjuntos: true },
  { id: "oc_cliente", label: "Órdenes de compra de clientes", prioridad: "normal", leerAdjuntos: false },
  { id: "vencimiento_aviso", label: "Vencimientos y avisos administrativos", prioridad: "normal", leerAdjuntos: false },
  { id: "otro", label: "Otros", prioridad: "baja", leerAdjuntos: false },
];

export function categoriaInfo(id: string) {
  return CATEGORIAS_MAIL.find((c) => c.id === id) || CATEGORIAS_MAIL[CATEGORIAS_MAIL.length - 1];
}

/** Orden de las categorías en el resumen: lo urgente arriba. */
export function ordenCategoria(id: string): number {
  const i = CATEGORIAS_MAIL.findIndex((c) => c.id === id);
  return i < 0 ? 99 : i;
}

// ── Costo y tope de gasto ────────────────────────────────────────────────────
// USD por millón de tokens (entrada / salida).
const PRECIOS: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-5": [3, 15],
};
export const TOPE_DIARIO_USD = 1.5;
export const MAX_PDF_VISION_POR_CORRIDA = 10;
export const MAX_MAILS_POR_CORRIDA = 25;
export const DESDE_INICIAL = "2026/10/01"; // primera carga: todo octubre 2026, nunca septiembre

export function costoModeloUSD(modelo: string, tokensEntrada: number, tokensSalida: number): number {
  const clave = Object.keys(PRECIOS).find((k) => modelo.startsWith(k)) || "claude-sonnet-4-5";
  const [pin, pout] = PRECIOS[clave];
  return (tokensEntrada * pin + tokensSalida * pout) / 1_000_000;
}

export function superaTopeDiario(gastadoHoyUSD: number, tope = TOPE_DIARIO_USD): boolean {
  return gastadoHoyUSD >= tope;
}

/** Inicio del día (00:00 hora Argentina) como ISO UTC, para sumar el gasto de hoy. */
export function inicioDiaAR(ahora = new Date()): string {
  const ar = new Date(ahora.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate(), 3, 0, 0)).toISOString();
}

// ── Respuestas de la IA ──────────────────────────────────────────────────────
export function extraerJSON(texto: string): any | null {
  if (!texto) return null;
  const limpio = texto.replace(/```json|```/g, "").trim();
  const ini = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (ini < 0 || fin <= ini) return null;
  try { return JSON.parse(limpio.slice(ini, fin + 1)); } catch { return null; }
}

export function normalizarCategoria(x: unknown): CategoriaMail {
  const s = String(x || "").trim().toLowerCase();
  return (CATEGORIAS_MAIL.find((c) => c.id === s)?.id) || "otro";
}

// ── Cruce de un aviso de pago con facturas abiertas y entradas del banco ─────
export type FacturaAbierta = {
  id: string; tipo: string | null; punto_venta: number | null; numero: number | null;
  cliente_id: string | null; cliente_nombre: string | null; cliente_cuit: string | null;
  total: number; saldo: number; moneda: string | null; estado?: string | null; tipo_cambio?: number | null;
};
export type EntradaBanco = { id: string; fecha: string; monto: number; descripcion: string | null; estado?: string | null };
export type PagoExtraido = {
  cliente_nombre?: string | null; cliente_cuit?: string | null;
  monto_neto?: number | null;       // lo que entra al banco
  monto_total?: number | null;      // facturas pagadas (antes de retenciones)
  retenciones_total?: number | null;
  fecha_pago?: string | null;
  direccion?: "recibido" | "emitido" | null; // recibido = un cliente nos pagó; emitido = nosotros pagamos a un proveedor
  facturas?: { numero?: string | null; importe?: number | null }[];
};
export type CruceSugerido = {
  facturas: { id: string; etiqueta: string; saldo: number; motivo: string; cobrada: boolean }[];
  entrada_banco: { id: string; fecha: string; monto: number; ya_cruzada: boolean } | null;
  confianza: "alta" | "media" | "baja";
  notas: string[];
};

/** "FA 00016-00000018", "16-18", "0016 0000018" → { pv: 16, num: 18 } (o null). */
export function parseNumeroFactura(s: string | null | undefined): { pv: number; num: number } | null {
  const crudos = String(s || "").match(/\d+/g) || [];
  if (crudos.length === 1 && crudos[0].length >= 9) {
    // Número pegado: los últimos 8 dígitos son el comprobante y lo anterior el punto de venta.
    return { pv: Number(crudos[0].slice(0, -8)), num: Number(crudos[0].slice(-8)) };
  }
  const grupos = crudos.map(Number);
  if (grupos.length < 2) return null;
  const [pv, num] = grupos.slice(-2);
  return Number.isFinite(pv) && Number.isFinite(num) ? { pv, num } : null;
}

export function etiquetaFactura(f: Pick<FacturaAbierta, "tipo" | "punto_venta" | "numero">): string {
  return `${f.tipo ? f.tipo + " " : ""}${String(f.punto_venta ?? 0).padStart(5, "0")}-${String(f.numero ?? 0).padStart(8, "0")}`;
}

const cuitSolo = (s: string | null | undefined) => String(s || "").replace(/\D/g, "");
const enCentavos = (n: number) => Math.round(n * 100);

const UMBRAL_COBRADA = 1; // saldo menor a $1 = la factura ya figura cobrada

const palabrasNombre = (n: string | null | undefined) =>
  String(n || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/).filter((w) => w.length > 2 && !["sociedad", "anonima", "s.a", "srl", "sas", "argentina", "comercial", "industrial"].includes(w));

/** Dos nombres de cliente se consideran el mismo si comparten la mitad (o más) de las palabras del más corto. */
export function mismoCliente(a: string | null | undefined, b: string | null | undefined): boolean {
  const A = palabrasNombre(a), B = palabrasNombre(b);
  if (!A.length || !B.length) return false;
  const comunes = A.filter((w) => B.includes(w)).length;
  return comunes >= Math.max(1, Math.ceil(Math.min(A.length, B.length) / 2));
}

/**
 * Cruza un aviso de pago de un cliente con las facturas del CRM y con el extracto.
 * `facturas` trae todas las facturas vigentes (abiertas y cobradas): así se puede decir "esa factura ya figura cobrada".
 */
export function cruzarPago(pago: PagoExtraido, facturas: FacturaAbierta[], entradas: EntradaBanco[]): CruceSugerido {
  const notas: string[] = [];
  const elegidas = new Map<string, { id: string; etiqueta: string; saldo: number; motivo: string; cobrada: boolean }>();
  const agregar = (f: FacturaAbierta, motivo: string) =>
    elegidas.set(f.id, { id: f.id, etiqueta: etiquetaFactura(f), saldo: f.saldo, motivo, cobrada: f.saldo < UMBRAL_COBRADA || f.estado === "pagada" });
  const abiertas = facturas.filter((f) => f.saldo >= UMBRAL_COBRADA && f.estado !== "pagada");

  // 1) Por número de factura mencionado en el aviso (entre todas, abiertas o no). Si hay varias con el mismo número
  //    (ej. FA 15-2 en pesos y FCEA 15-2 en dólares), se elige la que coincide con el importe del aviso (pesos, o dólares × cotización).
  for (const m of pago.facturas || []) {
    const p = parseNumeroFactura(m.numero);
    if (!p) continue;
    const candidatas = facturas.filter((x) => x.punto_venta === p.pv && x.numero === p.num);
    if (!candidatas.length) { notas.push(`El aviso nombra ${m.numero} pero no figura en el CRM.`); continue; }
    const importe = m.importe && m.importe > 0 ? m.importe : null;
    const puntaje = (f: FacturaAbierta) => {
      let pts = 0;
      if (importe) {
        if (Math.abs(importe - f.total) <= Math.max(1, f.total * 0.005)) pts += 3;
        else if (f.moneda === "USD" && f.total > 0) {
          const tc = importe / f.total;
          const ref = f.tipo_cambio && f.tipo_cambio > 0 ? f.tipo_cambio : null;
          if (tc > 300 && tc < 5000 && (!ref || Math.abs(tc - ref) / ref <= 0.03)) pts += 3;
        }
      }
      if (f.saldo >= UMBRAL_COBRADA && f.estado !== "pagada") pts += 1;
      const letras = String(m.numero || "").toUpperCase().match(/[A-Z]{1,5}/g)?.join("") || "";
      if (letras && f.tipo && letras.includes(f.tipo.toUpperCase())) pts += 1;
      return pts;
    };
    const mejor = [...candidatas].sort((a, b) => puntaje(b) - puntaje(a))[0];
    agregar(mejor, importe ? "número e importe del aviso" : "número de factura en el aviso");
    if (mejor.moneda === "USD" && importe && mejor.total > 0) {
      notas.push(`${etiquetaFactura(mejor)} es en dólares: US$ ${mejor.total.toFixed(2)} × ${(importe / mejor.total).toFixed(2)} = $ ${importe.toFixed(2)} (el pago llegó en pesos).`);
    }
  }

  // 2) Sin número: por CUIT (o nombre) del cliente y suma exacta de saldos abiertos con el total pagado.
  if (!elegidas.size && pago.monto_total) {
    const cuit = cuitSolo(pago.cliente_cuit);
    const delCliente = abiertas.filter((f) => f.moneda !== "USD" && (cuit && cuitSolo(f.cliente_cuit) === cuit) || (!cuit && mismoCliente(f.cliente_nombre, pago.cliente_nombre)));
    const objetivo = enCentavos(pago.monto_total);
    const unica = delCliente.filter((f) => enCentavos(f.saldo) === objetivo);
    if (unica.length === 1) agregar(unica[0], "saldo = total pagado");
    else if (delCliente.length && delCliente.length <= 12) {
      const combo = combinacionExacta(delCliente, objetivo);
      if (combo) for (const f of combo) agregar(f, "la suma de saldos = total pagado");
    }
  }

  // 3) Entrada del banco: monto neto exacto, dentro de ±10 días de la fecha del pago.
  let entrada: CruceSugerido["entrada_banco"] = null;
  const neto = pago.monto_neto ?? (pago.monto_total != null && pago.retenciones_total != null ? pago.monto_total - pago.retenciones_total : null);
  if (neto && neto > 0) {
    const t0 = pago.fecha_pago ? Date.parse(pago.fecha_pago.slice(0, 10)) : NaN;
    const cand = entradas.filter((e) => enCentavos(e.monto) === enCentavos(neto)
      && (!Number.isFinite(t0) || Math.abs(Date.parse(e.fecha.slice(0, 10)) - t0) <= 10 * 86400000));
    if (cand.length === 1) entrada = { id: cand[0].id, fecha: cand[0].fecha, monto: cand[0].monto, ya_cruzada: cand[0].estado === "matcheado" };
    else if (cand.length > 1) notas.push(`Hay ${cand.length} entradas del banco por ese monto: revisar a mano.`);
  }

  const lista = [...elegidas.values()];
  const cobradas = lista.filter((f) => f.cobrada);
  if (cobradas.length) notas.push(`${cobradas.map((f) => f.etiqueta).join(", ")} ya figura${cobradas.length > 1 ? "n" : ""} cobrada${cobradas.length > 1 ? "s" : ""} en el CRM.`);
  const abiertasElegidas = lista.filter((f) => !f.cobrada);
  if (pago.monto_total && abiertasElegidas.length && !cobradas.length && abiertasElegidas.every((f) => (facturas.find((x) => x.id === f.id)?.moneda || "ARS") !== "USD")) {
    const totalSaldo = abiertasElegidas.reduce((a, f) => a + f.saldo, 0);
    if (enCentavos(totalSaldo) !== enCentavos(pago.monto_total)) notas.push(`Las facturas abiertas suman ${totalSaldo.toFixed(2)} y el aviso paga ${pago.monto_total.toFixed(2)}: revisar diferencia.`);
  }
  // Alta: factura abierta + entrada del banco sin cruzar. Una factura ya cobrada no necesita acción.
  const confianza: CruceSugerido["confianza"] =
    abiertasElegidas.length && entrada && !entrada.ya_cruzada ? "alta" : lista.length || entrada ? "media" : "baja";
  return { facturas: lista, entrada_banco: entrada, confianza, notas };
}

function combinacionExacta(fs: FacturaAbierta[], objetivoCent: number): FacturaAbierta[] | null {
  const n = fs.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s += enCentavos(fs[i].saldo);
    if (s === objetivoCent) return fs.filter((_, i) => mask & (1 << i));
  }
  return null;
}

// ── Reclamos de cobranza (borradores para copiar; nunca se envían solos) ─────
export type FacturaVencida = { etiqueta: string; fecha: string; vencimiento: string; saldo: number; moneda: string | null };

export function diasDeAtraso(vencimiento: string, hoy = new Date()): number {
  const v = Date.parse(vencimiento.slice(0, 10));
  const h = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.floor((h - v) / 86400000);
}

function fmtMonto(n: number, moneda: string | null): string {
  const s = n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === "USD" ? `US$ ${s}` : `$ ${s}`;
}
function fmtFecha(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function armarReclamoCobranza(cliente: string, facturas: FacturaVencida[], sociedad: string, hoy = new Date()): { asunto: string; texto: string } {
  const lineas = facturas.map((f) => `• ${f.etiqueta} del ${fmtFecha(f.fecha)} — venció el ${fmtFecha(f.vencimiento)} (${diasDeAtraso(f.vencimiento, hoy)} días) — ${fmtMonto(f.saldo, f.moneda)}`);
  const totales = new Map<string, number>();
  for (const f of facturas) totales.set(f.moneda || "ARS", (totales.get(f.moneda || "ARS") || 0) + f.saldo);
  const total = [...totales.entries()].map(([m, v]) => fmtMonto(v, m)).join(" + ");
  const una = facturas.length === 1;
  const texto = [
    `Hola, buen día.`,
    ``,
    `Te escribimos de ${sociedad}. Revisando la cuenta corriente de ${cliente} vemos ${una ? "una factura vencida" : "las siguientes facturas vencidas"}:`,
    ``,
    ...lineas,
    ...(una ? [] : [``, `Total adeudado: ${total}`]),
    ``,
    `Si ya ${una ? "la" : "las"} abonaron, te pedimos que nos envíen el comprobante de pago y la retención (si corresponde) para imputarlo. Si no, ¿nos confirman la fecha estimada de pago?`,
    ``,
    `Gracias, quedamos atentos.`,
  ].join("\n");
  return { asunto: `${sociedad} - ${una ? "Factura vencida" : "Facturas vencidas"} - ${cliente}`, texto };
}
