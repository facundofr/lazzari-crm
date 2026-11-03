// Finanzas Lazza → Gastos (Tanda 4, Augusto 20/10/2026): 7 grupos, una sola lista (fijos y eventuales) editable,
// débito automático como forma de pago. Funciones puras (prueba: scripts/test-gastos-lazza.ts).
// Grupo: el que tenga el gasto (columna `grupo`, migración 20261020150000); si no tiene (cargado desde Finanzas vieja), sale de su categoría.

export const GRUPOS = ["Personal", "Premios", "Transportes", "Local y servicios", "Profesionales", "Impuestos", "Bancos y financieros", "Operativos", "Personales"] as const;
export type Grupo = (typeof GRUPOS)[number];
/**
 * "Transportes" (Augusto 29/10/2026): las facturas de transporte (de transportistas y liquidaciones internas, como las de José)
 * se MUESTRAN en Gastos con ese grupo, pero no son gastos cargados acá: se liquidan en Transportes y se pagan con OP.
 * Por eso no se elige en la ventana del gasto (no se puede cargar un gasto a mano en Transportes). Mismo nombre en Reportes
 * y en la Contabilidad (Costo → Transportes).
 */
export const GRUPO_TRANSPORTES = "Transportes" as const;
export const GRUPOS_EDITABLES = GRUPOS.filter((g) => g !== GRUPO_TRANSPORTES);

/** Nombre que se ve en pantalla (Augusto 23/10: "Sueldos" y "Augusto"). El valor guardado en la base no cambia: lo restringe un check de la tabla. */
const NOMBRE_GRUPO: Record<string, string> = { Personal: "Sueldos", Personales: "Augusto" };
export const nombreGrupo = (g: string | null | undefined) => NOMBRE_GRUPO[String(g || "")] || String(g || "");

/** Misma tabla que la migración 20261020150000. */
const POR_CATEGORIA: Record<string, Grupo> = {
  sueldos: "Personal", comisiones: "Personal", premios: "Premios",
  alquiler: "Local y servicios", servicios: "Local y servicios", "debitos automaticos": "Local y servicios",
  profesionales: "Profesionales",
  impuestos: "Impuestos",
  financieros: "Bancos y financieros", bancarios: "Bancos y financieros",
  mantenimiento: "Operativos", "compras sin factura": "Operativos", importaciones: "Operativos",
  personales: "Personales",
};
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function grupoDeCategoria(categoria: string | null | undefined): Grupo {
  return POR_CATEGORIA[sinAcentos(String(categoria || ""))] || "Operativos";
}
export function grupoDe(g: { grupo?: string | null; categoria?: string | null }): Grupo {
  return (GRUPOS as readonly string[]).includes(String(g.grupo || "")) ? (g.grupo as Grupo) : grupoDeCategoria(g.categoria);
}

/** Formas de pago (las que ya usa la base + débito automático). */
export const MEDIOS: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", tarjeta: "Tarjeta", tarjeta_visa_1582: "Tarjeta Visa 1582", tarjeta_mastercard_4775: "Tarjeta Mastercard 4775", cheque: "Cheque", vep: "VEP",
  debito: "Débito en cuenta", debito_automatico: "🔁 Débito automático",
  factura_transporte: "Factura (se paga en Pagar)",
  // Gasto de un fijo cuya factura del proveedor ya está en Compras (auditoría D4, 30/10/2026): cuenta como gasto pero no crea pago;
  // el pago es la OP de la factura (migración 20261030100000).
  factura_proveedor: "Factura (se paga con OP)",
};
export const etiquetaMedio = (m: string | null | undefined) => MEDIOS[String(m || "")] || (m ? String(m) : "—");

export interface GastoRow {
  id: string; fecha: string; descripcion: string | null; categoria: string | null; grupo?: string | null;
  monto: number | string | null; moneda: string | null; medio_pago: string | null; tipo_recurrencia: string | null;
  gasto_fijo_id: string | null; notas?: string | null; comprobante_url?: string | null;
}
export interface FijoRow {
  id: string; descripcion: string | null; categoria: string | null; grupo?: string | null; monto: number | string | null;
  moneda: string | null; activo: boolean | null; dia_vencimiento: number | null; medio_pago?: string | null; calculo?: string | null;
  proveedor_id?: string | null;
}

export interface FilaGasto {
  id: string; fecha: string; grupo: Grupo; detalle: string; fijo: boolean; medio: string; monto: number; moneda: "ARS" | "USD";
  fijoId: string | null; cargadoSolo: boolean; comprobante: string | null;
  /** Fila de una factura de transporte (solo lectura en Gastos: se maneja en Transportes y en Pagar). */
  facturaCompraId?: string | null;
}

/** Factura de compra tipo "transporte" (tabla facturas_compra), para mostrarla en Gastos. */
export interface FacturaTransporteRow {
  id: string; fecha: string; numero_factura: string | null; total: number | string | null; moneda: string | null;
  archivo_url?: string | null; proveedor?: string | null;
}

const num = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const mon = (m: unknown): "ARS" | "USD" => (String(m || "").toUpperCase() === "USD" ? "USD" : "ARS");

/** Un gasto es fijo si viene de un gasto fijo o se cargó como fijo/mensual. Un solo criterio para Gastos y Reportes (auditoría UX 27/10, arreglo 10). */
export const esGastoFijo = (g: { gasto_fijo_id?: string | null; tipo_recurrencia?: string | null }): boolean =>
  !!g.gasto_fijo_id || g.tipo_recurrencia === "fijo" || g.tipo_recurrencia === "mensual";

export function armarFilasGastos(gastos: GastoRow[], fijos: FijoRow[]): FilaGasto[] {
  const fijoPorId = new Map(fijos.map((f) => [f.id, f]));
  return gastos.map((g) => {
    const f = g.gasto_fijo_id ? fijoPorId.get(g.gasto_fijo_id) : undefined;
    return {
      id: g.id, fecha: String(g.fecha).slice(0, 10), grupo: grupoDe(g), detalle: g.descripcion || "",
      fijo: esGastoFijo(g),
      // Un gasto de un fijo con débito automático se muestra 🔁 aunque se haya cargado con otro medio.
      medio: f?.medio_pago === "debito_automatico" ? "debito_automatico" : (g.medio_pago || ""),
      monto: r2(num(g.monto)), moneda: mon(g.moneda), fijoId: g.gasto_fijo_id || null,
      cargadoSolo: String(g.notas || "").includes("[débito automático cargado solo]"),
      comprobante: g.comprobante_url || null, // el VEP o comprobante adjunto (Leer VEP)
    };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.grupo.localeCompare(b.grupo) || a.detalle.localeCompare(b.detalle));
}

/** Las facturas de transporte del mes como filas del grupo Transportes (por la fecha de la factura y su total). */
export function filasDeTransportes(facturas: FacturaTransporteRow[]): FilaGasto[] {
  return facturas.map((f) => ({
    id: `fc:${f.id}`, fecha: String(f.fecha).slice(0, 10), grupo: GRUPO_TRANSPORTES,
    detalle: [f.proveedor || "Transportista", f.numero_factura ? `factura ${f.numero_factura}` : ""].filter(Boolean).join(" — "),
    fijo: false, medio: "factura_transporte", monto: r2(num(f.total)), moneda: mon(f.moneda), fijoId: null, cargadoSolo: false,
    comprobante: f.archivo_url || null, facturaCompraId: f.id,
  }));
}

export interface FiltroGastos { grupo?: "" | Grupo; tipo?: "" | "fijo" | "eventual"; soloDebito?: boolean; texto?: string }
export function filtrarGastos(filas: FilaGasto[], f: FiltroGastos): FilaGasto[] {
  const q = sinAcentos(f.texto || "");
  return filas.filter((x) => (!f.grupo || x.grupo === f.grupo) && (!f.tipo || (f.tipo === "fijo") === x.fijo)
    && (!f.soloDebito || x.medio === "debito_automatico") && (!q || sinAcentos(`${x.detalle} ${x.grupo} ${etiquetaMedio(x.medio)}`).includes(q)));
}

/** Total por grupo (en el orden de GRUPOS) y total general, por moneda. */
export function totalesPorGrupo(filas: FilaGasto[]): { grupo: Grupo; ARS: number; USD: number; n: number }[] {
  return GRUPOS.map((grupo) => {
    const l = filas.filter((x) => x.grupo === grupo);
    return { grupo, n: l.length, ARS: r2(l.filter((x) => x.moneda === "ARS").reduce((s, x) => s + x.monto, 0)), USD: r2(l.filter((x) => x.moneda === "USD").reduce((s, x) => s + x.monto, 0)) };
  });
}

/** Día de vencimiento del fijo dentro del mes (el último día si el mes es más corto). */
export function venceEnMes(dia: number | null | undefined, mes: string): string | null {
  if (!dia || dia < 1) return null;
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

/**
 * Mes que nombra el detalle al cargar un fijo desde "Fijos sin cargar" del mes `mes` (AAAA-MM).
 * El sueldo es del mes anterior (Augusto 29/10/2026: "lo que pago a principio de mes es el sueldo del mes anterior"):
 * en octubre se carga "Sueldo … — septiembre". Lo demás, del mismo mes. Es la sugerencia: el detalle se puede cambiar.
 * La Contabilidad lo cuenta en el mes que dice el detalle; el pago queda con su fecha real.
 */
export function mesDelDetalleFijo(f: { descripcion?: string | null }, mes: string): string {
  if (!/^\s*sueldo\b/i.test(String(f.descripcion || ""))) return mes;
  const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** N° de VEP que dice un texto ("… (VEP 1696573116)", "Nro. VEP: 1682735631"): así se reconoce el mismo VEP cargado dos veces. */
export function numeroVep(texto: string | null | undefined): string | null {
  const m = String(texto || "").match(/\bvep\D{0,3}(\d{8,})/i);
  return m ? m[1] : null;
}

/**
 * Gasto ya cargado que se parece al que se va a guardar (auditoría de la plata, 29/10/2026): el mismo N° de VEP (de cualquier mes),
 * o el mismo grupo, moneda e importe (±$ 1) en el mismo mes. Solo para avisar: si el usuario dice que es otro, se guarda igual (regla 1).
 */
export function gastoParecido(
  nuevo: { fecha: string; grupo: string; monto: number; moneda: string; textos: string },
  cargados: GastoRow[],
): GastoRow | null {
  const vep = numeroVep(nuevo.textos);
  const mes = nuevo.fecha.slice(0, 7);
  return cargados.find((g) => (!!vep && numeroVep(`${g.descripcion || ""} ${g.notas || ""}`) === vep)
    || (String(g.fecha).slice(0, 7) === mes && grupoDe(g) === nuevo.grupo && mon(g.moneda) === mon(nuevo.moneda)
      && Math.abs(num(g.monto) - nuevo.monto) <= 1)) || null;
}

/** Línea del banco ya resuelta (del banco o asociada) y consumo de la tarjeta, para el aviso de "ya está" en Gastos. */
export interface LineaBancoGasto { fecha: string; descripcion: string; monto: number }
export interface ConsumoTarjetaGasto { fecha: string; comercio: string; importe: number; moneda: string }

const diasGasto = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const pesosGasto = (v: number, m: string) => `${mon(m) === "USD" ? "US$" : "$"} ${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Aviso para no cargar dos veces (Augusto 02/11/2026, solo aviso): el gasto nuevo ya está en el banco (una línea que salió por el
 * mismo importe ±$ 1, hasta 7 días antes o después, y que ya cuenta: del banco o asociada) o en el resumen de la Visa (mismo
 * importe y moneda, hasta 35 días), si no se carga con forma de pago tarjeta. Devuelve el texto del aviso o null.
 */
export function yaEstaEnBancoOVisa(
  nuevo: { fecha: string; monto: number; moneda: string; medio: string | null },
  lineas: LineaBancoGasto[], consumos: ConsumoTarjetaGasto[],
): string | null {
  const l = mon(nuevo.moneda) === "ARS" ? lineas.find((x) => Math.abs(num(x.monto) - nuevo.monto) <= 1 && Math.abs(diasGasto(x.fecha, nuevo.fecha)) <= 7) : undefined;
  if (l) return `Ya está en el banco: ${fechaCorta(l.fecha)} · ${l.descripcion} · ${pesosGasto(num(l.monto), "ARS")} (esa línea ya cuenta).`;
  if (String(nuevo.medio || "").startsWith("tarjeta")) return null;
  const c = consumos.find((x) => mon(x.moneda) === mon(nuevo.moneda) && Math.abs(num(x.importe) - nuevo.monto) <= 1 && Math.abs(diasGasto(x.fecha, nuevo.fecha)) <= 35);
  if (c) return `Está en el resumen de la Visa: ${fechaCorta(c.fecha)} · ${c.comercio} · ${pesosGasto(num(c.importe), c.moneda)}. Si lo pagaste con la Visa, elegí la forma de pago de la tarjeta.`;
  return null;
}

/**
 * Fijos con proveedor que ya tienen una factura de ese proveedor en el mes (auditoría, D4): la factura se paga con OP desde Pagar,
 * así que el gasto del fijo se carga sin pago propio (medio "factura_proveedor"). Antes creaba otro pago: dos salidas para una
 * sola transferencia (pasó con los honorarios del contador en octubre). El gasto sí se carga: es lo que cuenta en el resultado.
 */
export function fijosCubiertos<F extends { proveedor_id: string | null }>(fijos: FijoRow[], facturasDelMes: F[]): Map<string, F> {
  const out = new Map<string, F>();
  for (const f of fijos) {
    const fc = f.proveedor_id ? facturasDelMes.find((x) => x.proveedor_id === f.proveedor_id) : undefined;
    if (fc) out.set(f.id, fc);
  }
  return out;
}

/** Fijos activos que todavía no tienen gasto cargado en el mes (para "Cargar"). */
export function fijosSinCargar(fijos: FijoRow[], gastosDelMes: GastoRow[], mes: string): (FijoRow & { grupoFinal: Grupo; vence: string | null })[] {
  const cargados = new Set(gastosDelMes.filter((g) => String(g.fecha).slice(0, 7) === mes && g.gasto_fijo_id).map((g) => g.gasto_fijo_id));
  return fijos.filter((f) => f.activo !== false && !cargados.has(f.id))
    .map((f) => ({ ...f, grupoFinal: grupoDe(f), vence: venceEnMes(f.dia_vencimiento, mes) }))
    .sort((a, b) => (a.vence || "9").localeCompare(b.vence || "9") || String(a.descripcion).localeCompare(String(b.descripcion)));
}
