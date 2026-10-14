// Tipo de una factura de compra: mercadería (va con OC), transporte, servicio / gasto (contador, alquiler, luz…) o solo IVA.
// Todo es sugerencia: el usuario siempre puede cambiarlo.

export type TipoFacturaCompra = "mercaderia" | "transporte" | "servicio" | "solo_iva";

export const TIPOS_FACTURA_COMPRA: Array<{ value: TipoFacturaCompra; label: string }> = [
  { value: "mercaderia", label: "Compra" },
  { value: "transporte", label: "Transporte" },
  { value: "servicio", label: "Servicio / gasto" },
  { value: "solo_iva", label: "Solo IVA" },
];

export const CATEGORIAS_GASTO: Array<{ value: string; label: string }> = [
  { value: "honorarios", label: "Honorarios (contador, abogado)" },
  { value: "alquiler", label: "Alquiler" },
  { value: "servicios_publicos", label: "Luz, gas, agua, internet, teléfono" },
  { value: "mantenimiento", label: "Mantenimiento y reparaciones" },
  { value: "software", label: "Software y suscripciones" },
  { value: "publicidad", label: "Publicidad" },
  { value: "seguros", label: "Seguros" },
  { value: "otros", label: "Otros gastos" },
];

export const etiquetaCategoriaGasto = (v: string | null | undefined) => CATEGORIAS_GASTO.find((c) => c.value === v)?.label || "";

const PALABRAS: Array<[string, RegExp]> = [
  ["honorarios", /honorario|asesor[ií]a|asesoramiento|contab|liquidaci[oó]n de (sueldos|haberes)|servicios? profesional|estudio jur[ií]dico|abogad/i],
  ["alquiler", /alquiler|locaci[oó]n|arrendamiento|expensas/i],
  ["servicios_publicos", /energ[ií]a el[eé]ctrica|consumo de (luz|gas|agua)|\bluz\b|\bgas natural\b|internet|telefon[ií]a|abono (mensual|de servicio)|fibra [oó]ptica/i],
  ["software", /software|licencia|suscripci[oó]n|hosting|dominio|google workspace|microsoft 365/i],
  ["publicidad", /publicidad|marketing|anuncio|campa[ñn]a/i],
  ["seguros", /seguro|p[oó]liza|prima/i],
  ["mantenimiento", /mantenimiento|reparaci[oó]n|service (de|del)/i],
];

/** Categoría de gasto según el texto de los renglones (null si no se reconoce). */
export function categoriaPorTexto(texto: string): string | null {
  for (const [cat, re] of PALABRAS) if (re.test(texto)) return cat;
  return null;
}

/**
 * Tipo sugerido para una factura nueva.
 * 1) Si el proveedor ya tiene facturas de transporte o servicio, se repite lo último (y su categoría).
 * 2) Si no, si TODOS los renglones parecen un servicio (honorarios, alquiler, luz…), "servicio".
 * Si no hay nada claro, null (queda "Compra").
 */
export function tipoSugerido(o: {
  ultimoTipo?: string | null; ultimaCategoria?: string | null; descripciones: string[];
}): { tipo: TipoFacturaCompra; categoria: string | null; motivo: "proveedor" | "texto" } | null {
  if (o.ultimoTipo === "servicio" || o.ultimoTipo === "transporte") {
    return { tipo: o.ultimoTipo, categoria: o.ultimoTipo === "servicio" ? o.ultimaCategoria || null : null, motivo: "proveedor" };
  }
  const textos = o.descripciones.map((d) => String(d || "").trim()).filter(Boolean);
  if (!textos.length) return null;
  const cats = textos.map(categoriaPorTexto);
  if (cats.some((c) => !c)) return null;
  return { tipo: "servicio", categoria: cats[0], motivo: "texto" };
}
