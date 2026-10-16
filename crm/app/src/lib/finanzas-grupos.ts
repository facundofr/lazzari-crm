// Finanzas ordenada en grupos (12/10/2026; desde el 16/10: Hoy / Cobrar / Pagar / Cheques y créditos).
// Solo navegación: cada pestaña sigue siendo la misma pantalla de antes.

export type FinanzasTab =
  | "cuentas" | "para_confirmar" | "correo" | "movimientos" | "recibos" | "vencimientos" | "facturas_compra" | "ordenes_pago"
  | "gastos_manuales" | "echeqs" | "cheques_tercero" | "cc_clientes" | "cc_proveedores" | "extractos"
  | "lineas_credito" | "gastos_fijos" | "objetivos" | "facturacion" | "retenciones" | "revisar" | "informes"
  | "cobrar_clientes" | "pagar_semana";

export type FinanzasGrupo = "hoy" | "cobrar" | "pagar" | "bancos";

export interface FinanzasGrupoDef {
  id: FinanzasGrupo;
  label: string;
  descripcion: string;
  /** `mas`: va dentro del botón "Más" del grupo (menos pestañas a la vista; orden 16/10/2026). */
  tabs: { id: FinanzasTab; label: string; mas?: boolean }[];
}

// Orden de la pantalla (16/10/2026, segunda vuelta pedida por Augusto: "muestra todo junto, no se entiende nada").
// 4 preguntas: Hoy (¿qué hago hoy?), Cobrar (¿quién me debe?), Pagar (¿qué pago?), Bancos (¿cuadra con el banco?).
// El correo de administración vive en Hoy (antes era la pantalla suelta "Mail y cobros"). Lo de consulta va en "Más".
export const FINANZAS_GRUPOS: FinanzasGrupoDef[] = [
  {
    id: "hoy", label: "Hoy", descripcion: "Qué hacer hoy: plata, cruces del banco para confirmar y correo",
    tabs: [
      { id: "cuentas", label: "Resumen" },
      { id: "para_confirmar", label: "Para confirmar" },
      { id: "correo", label: "Correo" },
      { id: "revisar", label: "Revisar", mas: true },
      { id: "informes", label: "Informes", mas: true },
      { id: "objetivos", label: "Objetivos", mas: true },
    ],
  },
  {
    id: "cobrar", label: "Cobrar", descripcion: "Facturas de venta, clientes y recibos",
    tabs: [
      // 16/10/2026: un renglón por cliente (cuánto debe, vencido, próximo vencimiento, último cobro).
      { id: "cobrar_clientes", label: "Por cliente" },
      { id: "facturacion", label: "Facturas de venta" },
      { id: "recibos", label: "Recibos" },
      { id: "cc_clientes", label: "CC Clientes", mas: true },
      { id: "vencimientos", label: "Vencimientos", mas: true },
    ],
  },
  {
    id: "pagar", label: "Pagar", descripcion: "Cheques, facturas de compra, órdenes de pago y gastos",
    tabs: [
      // 16/10/2026: línea de tiempo por semana (cheques, facturas de compra, gastos fijos y cuotas aparte).
      { id: "pagar_semana", label: "Por semana" },
      { id: "echeqs", label: "Cheques" },
      { id: "facturas_compra", label: "Facturas de compra" },
      { id: "ordenes_pago", label: "Órdenes de pago" },
      { id: "gastos_manuales", label: "Gastos" },
      { id: "cc_proveedores", label: "CC Proveedores", mas: true },
      { id: "vencimientos", label: "Vencimientos", mas: true },
      { id: "gastos_fijos", label: "Gastos fijos", mas: true },
      { id: "retenciones", label: "Retenciones", mas: true },
      { id: "lineas_credito", label: "Créditos y préstamos", mas: true },
      { id: "cheques_tercero", label: "Cheques Martín F.", mas: true },
    ],
  },
  {
    id: "bancos", label: "Bancos", descripcion: "Extractos del banco y movimientos",
    tabs: [
      { id: "extractos", label: "Extractos" },
      { id: "movimientos", label: "Movimientos" },
    ],
  },
];

const TODAS: FinanzasTab[] = Array.from(new Set(FINANZAS_GRUPOS.flatMap((g) => g.tabs.map((t) => t.id))));

export function esFinanzasTab(valor: unknown): valor is FinanzasTab {
  return typeof valor === "string" && (TODAS as string[]).includes(valor);
}

export function esFinanzasGrupo(valor: unknown): valor is FinanzasGrupo {
  return typeof valor === "string" && FINANZAS_GRUPOS.some((g) => g.id === valor);
}

/** Grupo de una pestaña. Si está en dos grupos (Vencimientos), respeta el preferido. */
export function grupoDeTab(tab: FinanzasTab, preferido?: FinanzasGrupo | null): FinanzasGrupo {
  const grupos = FINANZAS_GRUPOS.filter((g) => g.tabs.some((t) => t.id === tab));
  if (preferido && grupos.some((g) => g.id === preferido)) return preferido;
  return grupos[0]?.id ?? "hoy";
}

/** Qué operaciones muestra Vencimientos según el grupo desde el que se abre. */
export function operacionVencimientos(grupo: FinanzasGrupo): "" | "venta" | "compra" {
  if (grupo === "cobrar") return "venta";
  if (grupo === "pagar") return "compra";
  return "";
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
  if (esFinanzasTab(params.tab)) {
    return { grupo: grupoDeTab(params.tab, esFinanzasGrupo(params.grupo) ? params.grupo : null), tab: params.tab };
  }
  if (guardado && esFinanzasTab(guardado.tab)) {
    const grupo = grupoDeTab(guardado.tab, esFinanzasGrupo(guardado.grupo) ? guardado.grupo : null);
    return { grupo, tab: guardado.tab };
  }
  return { grupo: "hoy", tab: "cuentas" };
}
