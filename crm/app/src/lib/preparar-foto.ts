// Prepara una foto o PDF para subir a Storage y mandar a la IA (en el navegador).
/** Achica la foto (lado mayor 1600 px, JPG) para que suba rápido y la IA la lea igual. Los PDF van como están. */
export async function prepararArchivo(file: File): Promise<{ blob: Blob; mediaType: string; base64: string; ext: string }> {
  const aBase64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(b); });
  if (file.type === "application/pdf") return { blob: file, mediaType: "application/pdf", base64: await aBase64(file), ext: "pdf" };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("No se pudo abrir la foto")); i.src = url; });
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo preparar la foto"))), "image/jpeg", 0.82));
    return { blob, mediaType: "image/jpeg", base64: await aBase64(blob), ext: "jpg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
