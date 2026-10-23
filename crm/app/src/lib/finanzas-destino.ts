// Mudanza de Finanzas (23/10/2026): los links viejos de Finanzas (`/finanzas?tab=...`) pasan a Finanzas Lazza (`/finanzas?seccion=...`).
// Lo que Lazza todavía no tiene (extractos, revisar, correo, etc.) sigue en la pantalla vieja, que ahora vive en `/finanzas-vieja`.
// Función pura. Prueba: npx tsx scripts/test-finanzas-destino.ts

/** Secciones de Finanzas Lazza que se pueden abrir por link (ids de `TARJETAS` en components/finanzas-lazza/inicio.tsx). */
export const SECCIONES_LAZZA = [
  "cobrar", "pagar", "facturas", "cuentas", "ordenes_pago", "recibos", "retenciones", "iva",
  "bancos", "cheques", "gastos", "movimientos", "objetivos", "reportes", "vencimientos",
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

export const RUTA_FINANZAS_VIEJA = "/finanzas-vieja";

/** Link a una factura de venta puntual (cobro o nota de crédito): la pantalla de Facturación de siempre, que abre esa factura. */
export function linkFactura(facturaId: string, accion?: "cobro" | "nc"): string {
  return `/facturacion?factura=${encodeURIComponent(facturaId)}${accion ? `&accion=${accion}` : ""}`;
}

/** A dónde lleva hoy un link viejo `/finanzas?tab=<tab>`. Sin tab: el inicio de Finanzas. */
export function linkFinanzas(tab?: string | null): string {
  if (!tab) return "/finanzas";
  const s = TAB_A_SECCION[tab];
  return s ? `/finanzas?seccion=${s}` : `${RUTA_FINANZAS_VIEJA}?tab=${encodeURIComponent(tab)}`;
}

/**
 * Para la dirección vieja: recibe los parámetros de `/finanzas?...` y dice a dónde ir, o null si ya es un link nuevo
 * (`seccion=` o sin parámetros) y no hay nada que traducir.
 */
export function traducirLinkViejo(params: URLSearchParams): string | null {
  const factura = params.get("factura");
  if (factura && !params.get("seccion")) {
    const a = params.get("accion");
    return linkFactura(factura, a === "cobro" || a === "nc" ? a : undefined);
  }
  const tab = params.get("tab");
  if (tab && !params.get("seccion")) return linkFinanzas(tab);
  return null;
}
