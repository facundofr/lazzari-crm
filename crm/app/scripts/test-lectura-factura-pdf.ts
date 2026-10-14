// Prueba la lectura SIN IA de facturas reales (QR de ARCA y, si no, texto del PDF). Solo lee los archivos; no toca la base.
// Uso (desde crm/app): npx tsx scripts/test-lectura-factura-pdf.ts "C:\ruta\factura1.pdf" "C:\ruta\factura2.pdf" ...
import fs from "node:fs";
import path from "node:path";
import jsQR from "jsqr";
import { createCanvas } from "@napi-rs/canvas";
import { leerQrArca, qrArcaComoImportacion } from "../src/lib/factura-qr-arca";
import { leerTextoFactura } from "../src/lib/factura-texto";

const CUITS_PROPIOS = ["20379309128", "30719396042"];

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  for (const archivo of process.argv.slice(2)) {
    const data = new Uint8Array(fs.readFileSync(archivo));
    const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
    let texto = "";
    for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      texto += (tc.items as any[]).map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("") + "\n";
    }
    let qr: ReturnType<typeof leerQrArca> = null;
    for (const escala of [2, 3, 4]) {
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: escala });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx as any, viewport: vp, canvas: canvas as any } as any).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(new Uint8ClampedArray(img.data.buffer), img.width, img.height, { inversionAttempts: "attemptBoth" });
      if (r?.data) { qr = leerQrArca(r.data); if (qr) break; }
    }
    const tx = leerTextoFactura(texto, CUITS_PROPIOS, { nombreArchivo: path.basename(archivo) });
    console.log(`\n=== ${path.basename(archivo)}`);
    console.log("QR   :", qr ? JSON.stringify(qrArcaComoImportacion(qr)) : "(no)");
    console.log("TEXTO:", JSON.stringify(tx));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
