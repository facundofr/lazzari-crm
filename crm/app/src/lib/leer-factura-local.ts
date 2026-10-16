// Lectura de una factura de compra EN EL NAVEGADOR, sin IA y sin mandar el archivo a ningún lado:
// 1) busca el QR de ARCA (PDF dibujado en una imagen, o la foto) → 2) si no hay, lee el texto del PDF con reglas fijas.
// Devuelve los datos con la forma de /api/parse-factura-compra, o null si no encontró lo mínimo.
// Las librerías (pdfjs-dist y jsqr) se cargan recién cuando se usa.

import { leerQrArca, qrArcaComoImportacion } from "./factura-qr-arca";
import { leerTextoFactura, textoComoImportacion } from "./factura-texto";

export type OrigenLectura = "qr" | "texto";

export interface LecturaLocal {
  origen: OrigenLectura;
  data: Record<string, any>;
  /** Lo que no se pudo leer o conviene revisar (para el cartel). */
  avisos: string[];
}

const CUITS_PROPIOS = ["20379309128", "30719396042"];

async function cargarPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

async function buscarQrEnCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const { default: jsQR } = await import("jsqr");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** Recorta la basura antes de "%PDF-" (ej. aviso de Ghostscript en las FA de Fujiwara; ver lib/pdf-limpiar.ts para el servidor). */
export function recortarAntesDePdf(bytes: Uint8Array): Uint8Array {
  const firma = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  const hasta = Math.min(bytes.length - firma.length, 8192);
  for (let i = 0; i <= hasta; i++) if (firma.every((c, j) => bytes[i + j] === c)) return i > 0 ? bytes.subarray(i) : bytes;
  return bytes;
}

async function leerPdf(file: File): Promise<{ qr: string | null; texto: string }> {
  const pdfjs = await cargarPdfjs();
  const tarea = pdfjs.getDocument({ data: recortarAntesDePdf(new Uint8Array(await file.arrayBuffer())) });
  const doc = await tarea.promise;
  try {
    let texto = "";
    for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      texto += (tc.items as any[]).map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("") + "\n";
    }
    let qr: string | null = null;
    for (const pagina of [1, 2].filter((p) => p <= doc.numPages)) {
      const page = await doc.getPage(pagina);
      for (const escala of [2, 3]) {
        const vp = page.getViewport({ scale: escala });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        // intent "print": dibuja sin esperar requestAnimationFrame (si la pestaña está oculta, si no, se traba).
        await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, intent: "print" } as any).promise;
        const leido = await buscarQrEnCanvas(canvas);
        if (leido && leerQrArca(leido)) { qr = leido; break; }
      }
      if (qr) break;
    }
    return { qr, texto };
  } finally {
    void tarea.destroy();
  }
}

async function leerImagen(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("No se pudo abrir la imagen"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return await buscarQrEnCanvas(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function leerFacturaLocal(file: File): Promise<LecturaLocal | null> {
  const esPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const esImagen = file.type.startsWith("image/");
  if (!esPdf && !esImagen) return null;

  const { qr, texto } = esPdf ? await leerPdf(file) : { qr: await leerImagen(file), texto: "" };
  const datosQr = qr ? leerQrArca(qr) : null;
  const datosTexto = texto.trim() ? leerTextoFactura(texto, CUITS_PROPIOS, { nombreArchivo: file.name }) : null;

  if (datosQr) {
    const data: Record<string, any> = qrArcaComoImportacion(datosQr);
    const avisos: string[] = [];
    // El QR trae el total pero no el neto ni el IVA: si el texto los tiene y cierran con el total, se usan.
    if (datosTexto?.neto != null && datosTexto.total != null && Math.abs(datosTexto.total - datosQr.importe) < 0.05) {
      data.subtotal = datosTexto.neto;
      if (datosTexto.ivaPorcentaje != null) data.iva_porcentaje = datosTexto.ivaPorcentaje;
      else avisos.push("IVA con varias alícuotas: revisá el IVA");
    } else {
      avisos.push("Neto e IVA: completalos (el QR solo trae el total)");
    }
    if (datosTexto?.fechaVencimiento) data.fecha_vencimiento = datosTexto.fechaVencimiento;
    avisos.push("Los artículos no vienen en el QR: cargalos o usá \"Leer con IA\"");
    return { origen: "qr", data, avisos };
  }

  if (datosTexto && datosTexto.encontrados >= 2) {
    const data = textoComoImportacion(datosTexto);
    const faltan = [
      !datosTexto.cuitEmisor && "CUIT",
      !datosTexto.numero && "número",
      !datosTexto.fecha && "fecha",
      datosTexto.total == null && "total",
      !datosTexto.tipoComprobante && "tipo",
    ].filter(Boolean) as string[];
    const avisos = [
      faltan.length ? `No se encontró: ${faltan.join(", ")}` : "",
      datosTexto.total != null && datosTexto.neto == null ? "Neto e IVA: completalos" : "",
      datosTexto.neto != null && datosTexto.ivaPorcentaje == null ? "IVA con varias alícuotas: revisá el IVA" : "",
      "Los artículos no se leen del texto: cargalos o usá \"Leer con IA\"",
    ].filter(Boolean);
    return { origen: "texto", data, avisos };
  }
  return null;
}
