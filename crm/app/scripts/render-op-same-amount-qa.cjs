const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../src/lib/pdf-templates.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: sourcePath,
}).outputText;
const moduleRef = { exports: {} };
const localRequire = (specifier) => {
  if (specifier === "@/lib/utils") return {
    formatCurrency: (value, currency) => new Intl.NumberFormat("es-AR", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(value || 0)),
    formatDate: (value) => String(value || "").slice(0, 10).split("-").reverse().join("/"),
  };
  if (specifier === "@/lib/fce-invoice") return { readFceMetadata: () => null, importeEnLetras: () => "" };
  if (specifier === "@/lib/pdf-style-scope") return { scopePdfStyles: (css) => css };
  return require(specifier);
};
vm.runInNewContext(compiled, {
  module: moduleRef, exports: moduleRef.exports, require: localRequire,
  console, Intl, Date, Math, Number, String, Array, Object, JSON, setTimeout, clearTimeout,
});

const html = moduleRef.exports.generateOrdenPagoPDF({
  numero: "OP-000044",
  fecha: "2026-10-02",
  estado: "pagada",
  moneda: "ARS",
  monto_bruto: 58758.64,
  retencion_ganancias_pct: 0,
  retencion_ganancias_monto: 0,
  neto: 58758.64,
  proveedor: { razon_social: "SPEED BUSINESS S. A.", cuit: "30-68697835-0", direccion: "RUTA NACIONAL N° 11 785" },
  medios: [{ tipo: "cheque_propio", monto: 58758.64, fecha: "2026-10-02", banco: "BBVA", numero_cheque: "QA-044", moneda: "ARS", cotizacion: 1 }],
  facturas_vinculadas: [
    { numero: "4240-00004929", fecha: "2026-09-07", monto: 29379.32, detalle: "Viaje del 10/09/2026 — Credifin" },
    { numero: "4240-00004929", fecha: "2026-09-07", monto: 29379.32, detalle: "Viaje del 07/09/2026 — Credifin" },
  ],
}, {
  nombre: "Lazzari", razonSocial: "Lazzari Soluciones Industriales", cuit: "20-37930912-8",
  condicionIva: "Responsable Inscripto", colorPrimario: "#FF4500",
  domicilio: "Pueyrredón 653, Pergamino, Buenos Aires", telefono: "2477 628958",
  email: "administracion@lazzari.com.ar", commercialEmail: "ventas@lazzari.com.ar",
  web: "https://www.lazzari.com.ar", inicioActividades: "01-09-2017",
  ingresosBrutos: "20379309128", jurisdiccion: "Buenos Aires",
});

const output = process.argv[2] || "/private/tmp/op-same-amount-qa.html";
fs.writeFileSync(output, html);
console.log(output);
