// Mudanza de Finanzas (23/10/2026): los links viejos de Finanzas (`/finanzas?tab=...`) pasan a Finanzas Lazza (`/finanzas?seccion=...`).
// 28/10/2026: la pantalla vieja se sacó del todo; lo que no existe en Finanzas abre el inicio de Finanzas.
// Función pura. Prueba: npx tsx scripts/test-finanzas-destino.ts

/** Secciones de Finanzas Lazza que se pueden abrir por link (ids de `TARJETAS` en components/finanzas-lazza/inicio.tsx). */
export const SECCIONES_LAZZA = [
  "cobrar", "pagar", "facturas", "cuentas", "ordenes_pago", "recibos", "retenciones", "iva",
  "bancos", "cheques", "gastos", "movimientos", "objetivos", "reportes", "vencimientos", "contabilidad",
  // 27/10/2026 (auditoría UX, arreglo 8): atajos que no son tarjeta. "facturar" abre Facturas en su pestaña Facturar;
  // "movimientos_banco" abre Bancos en la pestaña Movimientos (donde se suben los archivos del banco).
  "facturar", "movimientos_banco",
] as const;
export type SeccionLazza = typeof SECCIONES_LAZZA[number];

export function esSeccionLazza(s: string | null | undefined): s is SeccionLazza {
  return !!s && (SECCIONES_LAZZA as readonly string[]).includes(s);
}

/** Pestaña de Finanzas vieja → sección de Lazza. Lo que no está acá no existe en Lazza (se queda en la vieja). */
const TAB_A_SECCION: Record<string, SeccionLazza> = {
  gastos_fijos: "gastos", gastos_manuales: "gastos", objetivos: "objetivos",
  facturas_compra: "pagar", facturacion: "cobrar", cobrar_clientes: "cobrar", cc_clientes: "cuentas", cc_proveedores: "cuentas", vencimientos: "cuentas",
  ordenes_pago: "ordenes_pago", movimientos: "movimientos", recibos: "recibos", retenciones: "retenciones",
  echeqs: "cheques", cheques_tercero: "cheques", lineas_credito: "bancos", informes: "cuentas", cuentas: "bancos",
};

/**
 * Link a una factura de venta puntual: Facturas con su ficha abierta (ahí están Cobrar, Hacer NC, Anular, Ver y Enviar).
 * 29/10/2026: la Facturación vieja (/facturacion) se borró; antes el link iba ahí con &accion=cobro|nc.
 */
export function linkFactura(facturaId: string): string {
  return `/facturas?factura=${encodeURIComponent(facturaId)}`;
}

/** A dónde lleva hoy un link viejo `/finanzas?tab=<tab>`. Sin tab: el inicio de Finanzas. */
export function linkFinanzas(tab?: string | null): string {
  if (!tab) return "/finanzas";
  const s = TAB_A_SECCION[tab];
  return s ? `/finanzas?seccion=${s}` : "/finanzas";
}

/**
 * Para la dirección vieja: recibe los parámetros de `/finanzas?...` y dice a dónde ir, o null si ya es un link nuevo
 * (`seccion=` o sin parámetros) y no hay nada que traducir.
 */
export function traducirLinkViejo(params: URLSearchParams): string | null {
  const factura = params.get("factura");
  if (factura && !params.get("seccion")) return linkFactura(factura);
  const tab = params.get("tab");
  if (tab && !params.get("seccion")) return linkFinanzas(tab);
  return null;
}

/** Evento para abrir una sección cuando ya se está en `/finanzas` (router.push solo cambia la dirección, no la pantalla). */
export const EVENTO_ABRIR_FINANZAS = "finanzas:abrir";

/**
 * A dónde lleva un aviso de la campana (auditoría UX 27/10/2026, arreglo 8): al ítem, no a Finanzas en general.
 * Cheque rechazado (aviso de un cliente) → la ficha de ese cliente en Cuentas corrientes; aviso de cheque de tercero → Cheques;
 * aviso de una factura de compra (total cambiado) → Facturas; aviso de una línea del banco (banco simple, 30/10/2026) → Bancos.
 * Cualquier otro aviso de finanzas → el inicio.
 */
export function linkDeAlertaFinanzas(entityType: string | null | undefined, entityId: string | null | undefined): string {
  switch (entityType) {
    case "cliente": return entityId ? `/finanzas?seccion=cuentas&cliente=${encodeURIComponent(entityId)}` : "/finanzas?seccion=cuentas";
    case "echeq_tercero": return "/finanzas?seccion=cheques";
    case "factura_compra": return "/finanzas?seccion=facturas";
    case "extracto_movimiento": return "/finanzas?seccion=bancos";
    default: return "/finanzas";
  }
}
