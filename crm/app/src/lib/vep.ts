// Datos de un VEP / comprobante de impuestos leído por la IA (pestaña Gastos). Solo ordena y valida lo que vino.

export interface DatosVep {
  concepto: string;
  detalle: string;
  periodo: string | null; // YYYY-MM
  monto: number;
  vencimiento: string | null; // YYYY-MM-DD
  fecha_pago: string | null;
  numero: string | null;
  cuit: string | null;
  organismo: string | null;
}

const fechaOk = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Convierte "1.234,56", "1234.56" o 1234.56 a número. */
export function montoVep(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  if (typeof v !== "string") return 0;
  let s = v.replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function normalizarVep(raw: Record<string, unknown>): DatosVep {
  const periodo = typeof raw.periodo === "string" && /^\d{4}-\d{2}$/.test(raw.periodo) ? raw.periodo : null;
  return {
    concepto: texto(raw.concepto) ?? "Impuesto",
    detalle: texto(raw.detalle) ?? texto(raw.concepto) ?? "Impuesto",
    periodo,
    monto: montoVep(raw.monto),
    vencimiento: fechaOk(raw.vencimiento),
    fecha_pago: fechaOk(raw.fecha_pago),
    numero: texto(raw.numero),
    cuit: typeof raw.cuit === "string" ? raw.cuit.replace(/\D/g, "") || null : null,
    organismo: texto(raw.organismo),
  };
}

/** Descripción para el gasto: "IVA - DDJJ - período 09/2026 (VEP 123)". */
export function descripcionVep(d: DatosVep): string {
  return `${d.detalle}${d.numero ? ` (VEP ${d.numero})` : ""}`;
}
