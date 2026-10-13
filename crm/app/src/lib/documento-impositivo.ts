// Datos que la IA extrae de un papel impositivo (constancia de inscripción ARCA,
// certificado de exención de IVA, de exclusión de retención de Ganancias, etc.) o bancario
// (constancia de CBU, mail o captura con los datos de la cuenta).
// Lo usan el alta de proveedor y el alta de cliente: se muestran los cambios y el usuario los aplica.

export type TipoDocumentoImpositivo =
  | "constancia_inscripcion"
  | "exencion_iva"
  | "exclusion_ganancias"
  | "exclusion_iibb"
  | "datos_bancarios"
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
  /** Datos bancarios (constancia de CBU o similar) */
  banco: string | null;
  /** "CC" | "CA" | "CVU" */
  tipo_cuenta: "CC" | "CA" | "CVU" | null;
  numero_cuenta: string | null;
  cbu: string | null;
  alias: string | null;
  titular_cuenta: string | null;
  /** CUIT del titular de la cuenta (para avisar si no es el del proveedor) */
  cuit_titular_cuenta: string | null;
  /** Resumen en una línea de lo que dice el papel */
  resumen: string;
}

export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumentoImpositivo, string> = {
  constancia_inscripcion: "Constancia de inscripción",
  exencion_iva: "Certificado de exención de IVA",
  exclusion_ganancias: "Exclusión de retención de Ganancias",
  exclusion_iibb: "Exclusión / no retención de IIBB",
  datos_bancarios: "Datos bancarios (CBU)",
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
  const cbu = txt(raw?.cbu)?.replace(/\D/g, "") || null;
  const tipoCuenta = txt(raw?.tipo_cuenta)?.toUpperCase() || null;
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
    banco: txt(raw?.banco),
    tipo_cuenta: tipoCuenta && ["CC", "CA", "CVU"].includes(tipoCuenta) ? (tipoCuenta as "CC" | "CA" | "CVU") : null,
    numero_cuenta: txt(raw?.numero_cuenta),
    cbu: cbu && cbu.length === 22 ? cbu : null,
    alias: txt(raw?.alias)?.replace(/\s/g, "") || null,
    titular_cuenta: txt(raw?.titular_cuenta),
    cuit_titular_cuenta: txt(raw?.cuit_titular_cuenta)?.replace(/\D/g, "") || null,
    resumen: txt(raw?.resumen) || "",
  };
}

/** Junta lo leído de varios papeles: el primero que trae cada dato gana; el tipo es el más "fuerte". */
export function combinarDatosImpositivos(lista: DatosImpositivos[]): DatosImpositivos | null {
  if (!lista.length) return null;
  const out = { ...lista[0] } as Record<string, unknown>;
  for (const d of lista.slice(1)) {
    for (const [k, v] of Object.entries(d)) {
      if (k === "tipo_documento" || k === "resumen") continue;
      if ((out[k] === null || out[k] === undefined || out[k] === "") && v !== null && v !== "") out[k] = v;
    }
  }
  // Una exclusión pesa más que una constancia; una constancia más que solo datos bancarios.
  const prioridad: TipoDocumentoImpositivo[] = ["exclusion_ganancias", "exencion_iva", "exclusion_iibb", "constancia_inscripcion", "datos_bancarios", "otro"];
  out.tipo_documento = prioridad.find((t) => lista.some((d) => d.tipo_documento === t)) || "otro";
  out.resumen = lista.map((d) => d.resumen).filter(Boolean).join(" · ");
  return out as unknown as DatosImpositivos;
}

/** Lleva el nombre del banco leído a la lista del formulario ("BANCO DE GALICIA Y BUENOS AIRES" → "Banco Galicia"). */
export function bancoDeLista(nombre: string | null | undefined, lista: string[]): string | null {
  const t = String(nombre || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!t) return null;
  const claves: [RegExp, string][] = [
    [/naci[o]n/, "Banco Nación"], [/provincia/, "Banco Provincia"], [/ciudad/, "Banco Ciudad"], [/galicia/, "Banco Galicia"],
    [/santander/, "Banco Santander"], [/bbva|frances/, "Banco BBVA"], [/macro/, "Banco Macro"], [/hsbc/, "Banco HSBC"],
    [/icbc/, "Banco ICBC"], [/patagonia/, "Banco Patagonia"], [/credicoop/, "Banco Credicoop"], [/comafi/, "Banco Comafi"],
    [/itau/, "Banco Itaú"], [/supervielle/, "Banco Supervielle"], [/columbia/, "Banco Columbia"], [/brubank/, "Brubank"],
    [/mercado ?pago/, "Mercado Pago"], [/uala/, "Ualá"], [/naranja/, "Naranja X"],
  ];
  const hit = claves.find(([re]) => re.test(t))?.[1];
  return hit && lista.includes(hit) ? hit : null;
}
