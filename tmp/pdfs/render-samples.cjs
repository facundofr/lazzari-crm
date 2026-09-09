const fs = require("fs");
const path = require("path");
const ts = require("../../crm/app/node_modules/typescript");
const { chromium } = require("/Users/manu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const sourcePath = path.resolve(__dirname, "../../crm/app/src/lib/pdf-templates.ts");
let source = fs.readFileSync(sourcePath, "utf8");
source = source.replace(
  'import { formatCurrency, formatDate } from "@/lib/utils";',
  `const formatCurrency = (value, currency = "ARS") => new Intl.NumberFormat("es-AR", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(value) || 0);
   const formatDate = (value) => { if (!value) return ""; const raw = String(value).slice(0, 10); const [y,m,d] = raw.split("-"); return y && m && d ? [d,m,y].join("/") : raw; };`
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleBox = { exports: {} };
new Function("require", "module", "exports", compiled)(require, moduleBox, moduleBox.exports);
const pdf = moduleBox.exports;

const soc = {
  nombre: "Lazzari",
  razonSocial: "Lazzari Soluciones Industriales",
  cuit: "20-37930912-8",
  condicionIva: "Responsable Inscripto",
  colorPrimario: "#FF4500",
  domicilio: "Pueyrredón 653, Pergamino, Buenos Aires",
  telefono: "2477 628958",
  email: "administracion@lazzari.com.ar",
  commercialEmail: "ventas@lazzari.com.ar | jeronimo@lazzari.com.ar | sebastian@lazzari.com.ar",
  web: "",
  inicioActividades: "01/09/2017",
  ingresosBrutos: "20-37930912-8",
  jurisdiccion: "Buenos Aires",
};
const items = [
  { codigo: "VAL-101", descripcion: "Válvula esférica de acero inoxidable 2 pulgadas", cantidad: 4, unidad: "UN", precioVenta: 125000, precio_unitario: 125000, total: 605000, subtotal: 500000, iva_porcentaje: 21 },
  { codigo: "BRD-220", descripcion: "Brida ANSI 150 de acero al carbono", cantidad: 8, unidad: "UN", precioVenta: 48500, precio_unitario: 48500, total: 469480, subtotal: 388000, iva_porcentaje: 21 },
  { codigo: "SRV-010", descripcion: "Servicio de puesta en marcha y asistencia técnica", cantidad: 1, unidad: "SRV", precioVenta: 180000, precio_unitario: 180000, total: 217800, subtotal: 180000, iva_porcentaje: 21 },
];

const samples = {
  presupuesto: pdf.generatePresupuestoPDF({
    numero: "PR-2026-1027", fecha: "2026-08-31", vencimiento: "2026-09-30", estado: "pendiente", estadoLabel: "Pendiente", moneda: "ARS", tipoComprobante: "", modalidadEmision: "manual",
    subtotal: 1068000, iva: 224280, total: 1292280, observaciones: "Entrega estimada: 10 días hábiles. Garantía de 12 meses.",
    creadoPor: "Usuario interno", clienteNombre: "SOENERGY ARGENTINA S.A.", clienteCuit: "30-71037128-4", clienteCondicionIva: "RI",
    clienteEmail: "compras@cliente.com", clienteTelefono: "111", clienteDireccion: "Ruta 8 km 225", clienteLocalidad: "Pergamino", clienteProvincia: "Buenos Aires",
    vendedorNombre: "Jero", cotizacionModalidad: "billetes", items,
  }, soc),
  factura: pdf.generateFacturaPDF({
    tipo: "FB", punto_venta: 0, numero: 2, fecha: "2026-08-31", fecha_vencimiento: "2026-09-30", condicion_venta: "Cuenta corriente 30 días",
    moneda: "ARS", subtotal: 1068000, iva: 224280, total: 1292280, cae: null, cae_vencimiento: null, oc_cliente: "OC-8891",
    cliente: { razon_social: "Industrias del Centro S.A.", cuit: "30-71234567-9", condicion_iva: "RI", direccion: "Ruta 8 km 225", localidad: "Pergamino", provincia: "Buenos Aires" },
    items: items.map((item) => ({ ...item, precio_unitario: item.precio_unitario * 1.21, subtotal: item.subtotal * 1.21 })),
  }, { razonSocial: soc.razonSocial, cuit: soc.cuit, cuitNumero: 20379309128, condicionIva: soc.condicionIva, domicilio: soc.domicilio, ptoVta: 15 }, soc),
  remito: pdf.generateRemitoPDF({
    numero: "R-0015-00000142", fecha: "2026-08-27", cae: "CAR-2026-001423", oc_cliente: "OC-8891", valor_declarado: 1292280,
    observaciones: "Entregar de 8 a 16 h.", cliente: { razon_social: "Industrias del Centro S.A.", cuit: "30-71234567-9", condicion_iva: "RI", direccion: "Ruta 8 km 225", localidad: "Pergamino", provincia: "Buenos Aires" },
    sucursal_nombre: "Planta Pergamino", sucursal_direccion: "Ruta 8 km 225", items: items.map(({ descripcion, cantidad, unidad }) => ({ descripcion, cantidad, unidad })),
    transportes: [{ transportista: "Transportes Norte", destino: "Planta Pergamino", costo: 85000, moneda: "ARS" }],
  }, soc),
  orden_compra: pdf.generateOrdenCompraPDF({
    numero: "OC-2026-0412", fecha: "2026-08-27", fecha_entrega_estimada: "2026-09-10", estado: "emitida", estadoLabel: "Emitida", moneda: "ARS",
    subtotal: 1068000, iva: 224280, total: 1292280, observaciones: "Entregar mercadería identificada con número de OC.", presupuesto_origen: { numero: "PR-2026-0133" },
    proveedor: { razon_social: "Metalúrgica Argentina S.R.L.", cuit: "30-69876543-1", condicion_iva: "RI", direccion: "Av. Industrial 1550", localidad: "Rosario", provincia: "Santa Fe", forma_pago: "Transferencia 30 días" },
    items: items.map(({ codigo, descripcion, cantidad, unidad, precio_unitario, subtotal }) => ({ codigo, descripcion, cantidad, unidad, precio_unitario, subtotal })),
  }, soc),
  orden_pago: pdf.generateOrdenPagoPDF({
    numero: "OP-2026-0088", fecha: "2026-08-27", estado: "pagada", moneda: "ARS", monto_bruto: 1292280,
    retencion_ganancias_pct: 2, retencion_ganancias_monto: 25845.6, neto: 1266434.4, notas: "Pago correspondiente a factura A 0012-00003451.",
    proveedor: { razon_social: "Metalúrgica Argentina S.R.L.", cuit: "30-69876543-1", direccion: "Av. Industrial 1550, Rosario" },
    medios: [{ tipo: "transferencia", monto: 1266434.4, fecha: "2026-08-27", banco: "Banco Nación", moneda: "ARS", cotizacion: 1 }],
    facturas_vinculadas: [{ numero: "FA 0012-00003451", fecha: "2026-08-20", monto: 1292280 }],
  }, soc),
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  for (const [name, html] of Object.entries(samples)) {
    const htmlPath = path.join(__dirname, `${name}.html`);
    const pdfPath = path.join(__dirname, `${name}.pdf`);
    fs.writeFileSync(htmlPath, html);
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  }
  await browser.close();
})();
