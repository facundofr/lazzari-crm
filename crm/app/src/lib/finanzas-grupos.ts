// Finanzas ordenada en grupos (12/10/2026; desde el 16/10/2026: Hoy / Cobros / Pagos / Tesorería / Informes).
// Solo navegación: cada pestaña sigue siendo la misma pantalla de antes.

export type FinanzasTab =
  | "cuentas" | "para_confirmar" | "correo" | "movimientos" | "recibos" | "vencimientos" | "facturas_compra" | "ordenes_pago"
  | "gastos_manuales" | "echeqs" | "cheques_tercero" | "cc_clientes" | "cc_proveedores" | "extractos"
  | "lineas_credito" | "gastos_fijos" | "objetivos" | "facturacion" | "retenciones" | "revisar" | "informes"
  | "cobrar_clientes" | "pagar_semana";

export type FinanzasGrupo = "hoy" | "cobrar" | "pagar" | "bancos" | "informes";

/** Una pestaña del menú. `vistas`: pantallas que se juntaron en esta pestaña (botones chicos adentro); la primera es la propia. */
export interface FinanzasTabDef { id: FinanzasTab; label: string; mas?: boolean; vistas?: { id: FinanzasTab; label: string }[] }

export interface FinanzasGrupoDef {
  id: FinanzasGrupo;
  label: string;
  descripcion: string;
  tabs: FinanzasTabDef[];
}

// Orden de la pantalla (16/10/2026, unificación pedida por Augusto: "muchas pestañas y varias muestran lo mismo").
// 5 botones: Hoy · Cobros · Pagos · Tesorería · Informes. De 23 pestañas quedan 13; ninguna pantalla se perdió:
// las que mostraban lo mismo se juntaron (Clientes, Proveedores) y el resto quedó como "vista" dentro de otra.
export const FINANZAS_GRUPOS: FinanzasGrupoDef[] = [
  {
    id: "hoy", label: "Hoy", descripcion: "Plata de hoy y lo que hay que hacer",
    tabs: [
      { id: "cuentas", label: "Resumen" },
      { id: "revisar", label: "Para hacer", vistas: [{ id: "revisar", label: "Revisar" }, { id: "correo", label: "Correo" }] },
    ],
  },
  {
    id: "cobrar", label: "Cobros", descripcion: "Quién nos debe y facturas de venta",
    tabs: [
      // "Clientes" junta Por cliente + CC Clientes + Vencimientos de venta (botón "Por vencimiento"; clic = ficha).
      { id: "cc_clientes", label: "Clientes" },
      { id: "facturacion", label: "Facturas de venta" },
    ],
  },
  {
    id: "pagar", label: "Pagos", descripcion: "A quién le debemos, facturas de compra, órdenes de pago y gastos",
    tabs: [
      // "Proveedores" junta CC Proveedores + Vencimientos de compra.
      { id: "cc_proveedores", label: "Proveedores" },
      { id: "facturas_compra", label: "Facturas de compra" },
      { id: "ordenes_pago", label: "Órdenes de pago" },
      { id: "gastos_manuales", label: "Gastos", vistas: [{ id: "gastos_manuales", label: "Gastos" }, { id: "gastos_fijos", label: "Gastos fijos" }] },
      { id: "pagar_semana", label: "Próximas semanas" },
    ],
  },
  {
    id: "bancos", label: "Tesorería", descripcion: "Banco, cheques y movimientos",
    tabs: [
      { id: "para_confirmar", label: "Banco", vistas: [{ id: "para_confirmar", label: "Para confirmar" }, { id: "extractos", label: "Extracto y reglas" }] },
      { id: "echeqs", label: "Cheques", vistas: [{ id: "echeqs", label: "Todos" }, { id: "cheques_tercero", label: "Martín F." }] },
      { id: "movimientos", label: "Movimientos", vistas: [{ id: "movimientos", label: "Todos" }, { id: "recibos", label: "Recibos de cobro" }] },
    ],
  },
  {
    id: "informes", label: "Informes", descripcion: "Riesgo BCRA, retenciones, objetivos y créditos",
    tabs: [
      { id: "informes", label: "Informes", vistas: [{ id: "informes", label: "Riesgo BCRA" }, { id: "retenciones", label: "Retenciones" }, { id: "objetivos", label: "Objetivos" }, { id: "lineas_credito", label: "Créditos y préstamos" }] },
    ],
  },
];

/** La pestaña del menú que muestra esta pantalla (la propia o la que la contiene como vista). */
export function entradaDeTab(tab: FinanzasTab): FinanzasTabDef | undefined {
  for (const g of FINANZAS_GRUPOS) for (const t of g.tabs) if (t.id === tab || t.vistas?.some((v) => v.id === tab)) return t;
  return undefined;
}

/** Pestañas que se unificaron (16/10/2026): el link, botón o lo guardado viejo abre la nueva. */
const UNIFICADAS: Partial<Record<string, FinanzasTab>> = { cobrar_clientes: "cc_clientes", vencimientos: "cc_proveedores" };

/** La pestaña que se muestra de verdad (si la pedida se unificó con otra). */
export function tabReal(tab: FinanzasTab): FinanzasTab {
  return UNIFICADAS[tab] ?? tab;
}

const TODAS: FinanzasTab[] = Array.from(new Set(FINANZAS_GRUPOS.flatMap((g) => g.tabs.flatMap((t) => [t.id, ...(t.vistas ?? []).map((v) => v.id)]))));

/** Pestaña válida (incluye los nombres viejos de las unificadas; usar tabReal para mostrarla). */
export function esFinanzasTab(valor: unknown): valor is FinanzasTab {
  return typeof valor === "string" && ((TODAS as string[]).includes(valor) || valor in UNIFICADAS);
}

export function esFinanzasGrupo(valor: unknown): valor is FinanzasGrupo {
  return typeof valor === "string" && FINANZAS_GRUPOS.some((g) => g.id === valor);
}

/** Grupo de una pestaña. Si está en dos grupos, respeta el preferido. */
export function grupoDeTab(tab: FinanzasTab, preferido?: FinanzasGrupo | null): FinanzasGrupo {
  tab = tabReal(tab);
  const grupos = FINANZAS_GRUPOS.filter((g) => g.tabs.some((t) => t.id === tab || t.vistas?.some((v) => v.id === tab)));
  if (preferido && grupos.some((g) => g.id === preferido)) return preferido;
  return grupos[0]?.id ?? "hoy";
}

/**
 * Pestaña con la que abre Finanzas. Primero los links (?factura=, ?tab=),
 * después lo último que se abrió en esta compu, y si no hay nada, Hoy > Cuentas.
 */
export function pestanaInicial(
  params: { tab?: string | null; factura?: string | null; grupo?: string | null },
  guardado?: { grupo?: unknown; tab?: unknown } | null,
): { grupo: FinanzasGrupo; tab: FinanzasTab } {
  if (params.factura) return { grupo: "cobrar", tab: "facturacion" };
  const nueva = (t: unknown) => (typeof t === "string" && UNIFICADAS[t]) || t;
  params = { ...params, tab: nueva(params.tab) as string | null | undefined };
  if (guardado) guardado = { ...guardado, tab: nueva(guardado.tab) };
  if (esFinanzasTab(params.tab)) {
    return { grupo: grupoDeTab(params.tab, esFinanzasGrupo(params.grupo) ? params.grupo : null), tab: params.tab };
  }
  if (guardado && esFinanzasTab(guardado.tab)) {
    const grupo = grupoDeTab(guardado.tab, esFinanzasGrupo(guardado.grupo) ? guardado.grupo : null);
    return { grupo, tab: guardado.tab };
  }
  return { grupo: "hoy", tab: "cuentas" };
}
