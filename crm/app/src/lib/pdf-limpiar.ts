// Algunos PDF de proveedores vienen con basura ANTES de "%PDF-" (ej. el aviso "**** WARNING: The .setpdfwrite operator has been deprecated…"
// de Ghostscript): los visores los abren, pero la IA (Anthropic) los rechaza o no los lee. Esto recorta todo lo que está antes del encabezado real.
// Caso real: FA de Fujiwara Argentina (00001001000200002816.PDF) con 384 bytes de texto antes de "%PDF-1.7".

const FIRMA = Buffer.from("%PDF-");

/** Recorta lo que haya antes de "%PDF-" (solo se busca en los primeros 8 KB). Si no hay nada que recortar, devuelve el mismo buffer. */
export function limpiarPdfBuffer(buf: Buffer): Buffer {
  if (buf.length < 8 || buf.subarray(0, 5).equals(FIRMA)) return buf;
  const i = buf.subarray(0, 8192).indexOf(FIRMA);
  return i > 0 ? buf.subarray(i) : buf;
}

/** Igual que limpiarPdfBuffer pero con el archivo en base64. */
export function limpiarPdfBase64(base64: string): string {
  try {
    const buf = Buffer.from(base64, "base64");
    const limpio = limpiarPdfBuffer(buf);
    return limpio === buf ? base64 : limpio.toString("base64");
  } catch {
    return base64;
  }
}
