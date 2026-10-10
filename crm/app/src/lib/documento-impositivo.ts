// Datos que la IA extrae de un papel impositivo (constancia de inscripción ARCA,
// certificado de exención de IVA, de exclusión de retención de Ganancias, etc.).
// Lo usan el alta de proveedor y el alta de cliente: se muestran los cambios y el usuario los aplica.

export type TipoDocumentoImpositivo =
  | "constancia_inscripcion"
  | "exencion_iva"
  | "exclusion_ganancias"
  | "exclusion_iibb"
  | "otro";

export interface DatosImpositivos {
  tipo_documento: TipoDocumentoImpositivo;
  cuit: string | null;
  razon_social: string | null;
  /** "RI" | "Monotributo" | "Exento" | "CF" (mismos valores que el campo condicion_iva) */
  condicion_iva: "RI" | "Monotributo" | "Exento" | "CF" | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  /** Exclusión de retención (Ganancias u otra) */
  exclusion_desde: string | null; // YYYY-MM-DD
  exclusion_hasta: string | null; // YYYY-MM-DD
  numero_certificado: string | null;
  /** Porcentaje de exclusión si figura (ej. 100) */
  porcentaje_exclusion: number | null;
  /** Resumen en una línea de lo que dice el papel */
  resumen: string;
}

export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumentoImpositivo, string> = {
  constancia_inscripcion: "Constancia de inscripción",
  exencion_iva: "Certificado de exención de IVA",
  exclusion_ganancias: "Exclusión de retención de Ganancias",
  exclusion_iibb: "Exclusión / no retención de IIBB",
  otro: "Otro documento impositivo",
};

/** Normaliza lo que devuelve la IA (campos faltantes → null, fechas a YYYY-MM-DD). */
export function normalizarDatosImpositivos(raw: any): DatosImpositivos {
  const txt = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const fecha = (v: any) => {
    const t = txt(v);
    if (!t) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  };
  const cond = txt(raw?.condicion_iva);
  const condicion = cond && ["RI", "Monotributo", "Exento", "CF"].includes(cond) ? (cond as DatosImpositivos["condicion_iva"]) : null;
  const tipos = Object.keys(TIPO_DOCUMENTO_LABEL) as TipoDocumentoImpositivo[];
  const pct = Number(raw?.porcentaje_exclusion);
  return {
    tipo_documento: tipos.includes(raw?.tipo_documento) ? raw.tipo_documento : "otro",
    cuit: txt(raw?.cuit)?.replace(/\D/g, "") || null,
    razon_social: txt(raw?.razon_social),
    condicion_iva: condicion,
    direccion: txt(raw?.direccion),
    localidad: txt(raw?.localidad),
    provincia: txt(raw?.provincia),
    exclusion_desde: fecha(raw?.exclusion_desde),
    exclusion_hasta: fecha(raw?.exclusion_hasta),
    numero_certificado: txt(raw?.numero_certificado),
    porcentaje_exclusion: Number.isFinite(pct) && raw?.porcentaje_exclusion != null ? pct : null,
    resumen: txt(raw?.resumen) || "",
  };
}
