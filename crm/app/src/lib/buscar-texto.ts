// Búsqueda sin tildes ni mayúsculas: "pantalon" encuentra "Pantalón" (Augusto 13/10).

/** Pasa a minúsculas y saca tildes/diéresis (ñ queda como n). */
export function normalizarTexto(texto: string | null | undefined): string {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Palabras de la búsqueda, ya normalizadas. */
export function palabrasBusqueda(q: string): string[] {
  return normalizarTexto(q).split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

/** true si TODAS las palabras aparecen en el texto (ya normalizado). */
export function coincideTodas(textoNormalizado: string, palabras: string[]): boolean {
  return palabras.every((w) => textoNormalizado.includes(w));
}

// ── Clientes y Proveedores: buscar por cualquier dato (Augusto 03/11/2026: "cbu, cuit, mail, teléfono, cualquier tipo de información") ──

/** Datos de la ficha del cliente donde se busca (además de sus sucursales y contactos). */
export const CAMPOS_FICHA_CLIENTE = ["razon_social", "cuit", "email", "email_facturacion", "email_comprobante", "telefono", "direccion", "localidad", "provincia", "cp", "alias_cbu", "notas"];
/** Datos de la ficha del proveedor donde se busca (además de sus contactos). */
export const CAMPOS_FICHA_PROVEEDOR = [
  "razon_social", "nombre_fantasia", "cuit", "email", "telefono", "direccion", "localidad", "provincia", "rubro", "marcas", "notas",
  "cbu", "alias_bancario", "numero_cuenta", "banco", "titular_cuenta", "cuit_titular_cuenta", "administracion_nombre",
];
export const CAMPOS_SUCURSAL = ["nombre", "direccion", "localidad", "provincia", "telefono", "email", "cp", "notas"];
export const CAMPOS_CONTACTO = ["nombre", "cargo", "email", "telefono", "whatsapp", "notas"];

/** Los datos con texto de una fila, en el orden de `campos` (los vacíos no van). */
export function datosDeFicha(fila: Record<string, unknown> | null | undefined, campos: string[]): string[] {
  if (!fila) return [];
  return campos.map((c) => fila[c]).filter((v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "").map(String);
}

/**
 * true si cada palabra de la búsqueda aparece en algún dato de la ficha. Sin tildes ni mayúsculas; los números se comparan sin
 * guiones, puntos ni espacios ("30-71048063-6" = "30710480636", "+54 9 351 555-1234" contiene "3515551234"), dato por dato.
 */
export function coincideFicha(q: string, datos: (string | null | undefined)[]): boolean {
  const palabras = palabrasBusqueda(q);
  if (!palabras.length) return true;
  const textos = datos.filter((d): d is string => !!d).map(normalizarTexto);
  const numeros = textos.map((t) => t.replace(/\D/g, "")).filter(Boolean);
  return palabras.every((w) => {
    if (textos.some((t) => t.includes(w))) return true;
    const dw = w.replace(/\D/g, "");
    // Solo si la palabra es un número (con guiones, puntos o barras) de 3 cifras o más.
    return dw.length >= 3 && /^[\d\-./()+]+$/.test(w) && numeros.some((n) => n.includes(dw));
  });
}
