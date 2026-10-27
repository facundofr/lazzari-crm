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

/**
 * Lo que un VEP leído completa en la ventana de Gastos de Finanzas (arreglo 17, 26/10/2026). Nunca guarda: Augusto revisa.
 * Gasto nuevo: detalle, monto y fecha (la de pago; si no figura, el vencimiento).
 * Gasto ya cargado (casi siempre sale del banco): la fecha y el monto del pago no se tocan; lo del VEP va adelante del
 * detalle (salvo que ya tenga su número) y, si el VEP es por otro monto, se avisa en `otroMonto`.
 */
export function gastoConVep(d: DatosVep, actual: { detalle: string; fecha: string; monto: number; editando: boolean }): {
  detalle: string; fecha: string; monto: number; otroMonto: number | null; nota: string;
} {
  const desc = descripcionVep(d);
  const previo = actual.detalle.trim();
  const nota = [d.vencimiento ? `Vence ${d.vencimiento.split("-").reverse().join("/")}` : "", d.organismo || ""].filter(Boolean).join(" · ");
  if (!actual.editando) {
    return { detalle: desc, fecha: d.fecha_pago || d.vencimiento || actual.fecha, monto: d.monto > 0 ? d.monto : actual.monto, otroMonto: null, nota };
  }
  const yaLoDice = previo.includes(desc) || (!!d.numero && previo.includes(d.numero));
  const tieneMonto = actual.monto > 0;
  return {
    detalle: !previo ? desc : yaLoDice ? previo : `${desc} — ${previo}`,
    fecha: actual.fecha || d.fecha_pago || d.vencimiento || "",
    monto: tieneMonto ? actual.monto : d.monto,
    otroMonto: tieneMonto && d.monto > 0 && Math.abs(d.monto - actual.monto) > 0.005 ? d.monto : null,
    nota,
  };
}
