// Finanzas Lazza → Gastos (Tanda 4, Augusto 20/10/2026): 7 grupos, una sola lista (fijos y eventuales) editable,
// débito automático como forma de pago. Funciones puras (prueba: scripts/test-gastos-lazza.ts).
// Grupo: el que tenga el gasto (columna `grupo`, migración 20261020150000); si no tiene (cargado desde Finanzas vieja), sale de su categoría.

export const GRUPOS = ["Personal", "Local y servicios", "Profesionales", "Impuestos", "Bancos y financieros", "Operativos", "Personales"] as const;
export type Grupo = (typeof GRUPOS)[number];

/** Misma tabla que la migración 20261020150000. */
const POR_CATEGORIA: Record<string, Grupo> = {
  sueldos: "Personal", comisiones: "Personal",
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
  transferencia: "Transferencia", efectivo: "Efectivo", tarjeta: "Tarjeta", cheque: "Cheque", vep: "VEP",
  debito: "Débito en cuenta", debito_automatico: "🔁 Débito automático",
};
export const etiquetaMedio = (m: string | null | undefined) => MEDIOS[String(m || "")] || (m ? String(m) : "—");

export interface GastoRow {
  id: string; fecha: string; descripcion: string | null; categoria: string | null; grupo?: string | null;
  monto: number | string | null; moneda: string | null; medio_pago: string | null; tipo_recurrencia: string | null;
  gasto_fijo_id: string | null; notas?: string | null;
}
export interface FijoRow {
  id: string; descripcion: string | null; categoria: string | null; grupo?: string | null; monto: number | string | null;
  moneda: string | null; activo: boolean | null; dia_vencimiento: number | null; medio_pago?: string | null; calculo?: string | null;
}

export interface FilaGasto {
  id: string; fecha: string; grupo: Grupo; detalle: string; fijo: boolean; medio: string; monto: number; moneda: "ARS" | "USD";
  fijoId: string | null; cargadoSolo: boolean;
}

const num = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const mon = (m: unknown): "ARS" | "USD" => (String(m || "").toUpperCase() === "USD" ? "USD" : "ARS");

export function armarFilasGastos(gastos: GastoRow[], fijos: FijoRow[]): FilaGasto[] {
  const fijoPorId = new Map(fijos.map((f) => [f.id, f]));
  return gastos.map((g) => {
    const f = g.gasto_fijo_id ? fijoPorId.get(g.gasto_fijo_id) : undefined;
    return {
      id: g.id, fecha: String(g.fecha).slice(0, 10), grupo: grupoDe(g), detalle: g.descripcion || "",
      fijo: !!g.gasto_fijo_id || g.tipo_recurrencia === "fijo" || g.tipo_recurrencia === "mensual",
      // Un gasto de un fijo con débito automático se muestra 🔁 aunque se haya cargado con otro medio.
      medio: f?.medio_pago === "debito_automatico" ? "debito_automatico" : (g.medio_pago || ""),
      monto: r2(num(g.monto)), moneda: mon(g.moneda), fijoId: g.gasto_fijo_id || null,
      cargadoSolo: String(g.notas || "").includes("[débito automático cargado solo]"),
    };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.grupo.localeCompare(b.grupo) || a.detalle.localeCompare(b.detalle));
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

/** Fijos activos que todavía no tienen gasto cargado en el mes (para "Cargar"). */
export function fijosSinCargar(fijos: FijoRow[], gastosDelMes: GastoRow[], mes: string): (FijoRow & { grupoFinal: Grupo; vence: string | null })[] {
  const cargados = new Set(gastosDelMes.filter((g) => String(g.fecha).slice(0, 7) === mes && g.gasto_fijo_id).map((g) => g.gasto_fijo_id));
  return fijos.filter((f) => f.activo !== false && !cargados.has(f.id))
    .map((f) => ({ ...f, grupoFinal: grupoDe(f), vence: venceEnMes(f.dia_vencimiento, mes) }))
    .sort((a, b) => (a.vence || "9").localeCompare(b.vence || "9") || String(a.descripcion).localeCompare(String(b.descripcion)));
}
