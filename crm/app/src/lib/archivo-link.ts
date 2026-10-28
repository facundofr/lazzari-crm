/**
 * Links de archivos guardados en Storage (auditoría integral 28/10/2026, Tanda 1 Parte D).
 * Los buckets de documentos (facturas de compra, comprobantes, certificados, presupuestos) pasan a ser PRIVADOS:
 * en la base se guarda un link propio del CRM, `/api/archivo/<bucket>/<ruta>`, que pide estar logueado y redirige
 * a un link firmado de Supabase que vence en un minuto. Así el link nunca sirve fuera del CRM.
 * `productos` (fotos del catálogo) sigue público.
 *
 * Prueba: npx tsx scripts/test-archivo-link.ts
 */

export const BUCKETS_PRIVADOS = ["facturas-compra", "comprobantes", "certificados", "presupuestos"] as const;
export type BucketPrivado = (typeof BUCKETS_PRIVADOS)[number];

export function esBucketPrivado(b: string): b is BucketPrivado {
  return (BUCKETS_PRIVADOS as readonly string[]).includes(b);
}

/** Link para guardar en la base en vez de getPublicUrl. Cada parte de la ruta va codificada (espacios, acentos). */
export function linkArchivo(bucket: BucketPrivado, ruta: string): string {
  return `/api/archivo/${bucket}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Bucket y ruta de un link guardado, sea el nuevo (`/api/archivo/...`, con o sin dominio) o el público viejo
 * (`https://<proyecto>.supabase.co/storage/v1/object/public/<bucket>/<ruta>`). Null si no es un archivo nuestro.
 */
export function rutaDeLinkArchivo(url: string | null | undefined): { bucket: BucketPrivado; ruta: string } | null {
  if (!url) return null;
  const m = String(url).match(/(?:\/api\/archivo\/|\/storage\/v1\/object\/(?:public|sign)\/)([a-z-]+)\/([^?#]+)/);
  if (!m || !esBucketPrivado(m[1])) return null;
  let ruta: string;
  try { ruta = m[2].split("/").map(decodeURIComponent).join("/"); } catch { return null; }
  if (!ruta || ruta.split("/").some((p) => p === ".." || p === "")) return null;
  return { bucket: m[1], ruta };
}
