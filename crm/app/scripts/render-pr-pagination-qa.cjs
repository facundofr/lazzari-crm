const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../src/lib/pdf-templates.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

const moduleRef = { exports: {} };
const formatCurrency = (value, currency) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: currency === "USD" ? "USD" : "ARS",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
const formatDate = (value) => {
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
};
const localRequire = (specifier) => {
  if (specifier === "@/lib/utils") return { formatCurrency, formatDate };
  if (specifier === "@/lib/fce-invoice") return { readFceMetadata: () => null, importeEnLetras: () => "" };
  if (specifier === "@/lib/pdf-style-scope") return { scopePdfStyles: (css) => css };
  return require(specifier);
};

vm.runInNewContext(compiled, {
  module: moduleRef,
  exports: moduleRef.exports,
  require: localRequire,
  console,
  Intl,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  setTimeout,
  clearTimeout,
});

const items = Array.from({ length: 34 }, (_, index) => {
  const quantity = (index % 5) + 1;
  const price = 32 + index * 2.75;
  return {
    codigo: `COD-${String(index + 1).padStart(4, "0")}`,
    descripcion:
      index % 4 === 0
        ? `Elemento industrial de prueba ${index + 1}, descripción deliberadamente extensa con especificaciones técnicas, terminación reforzada y accesorios para verificar el salto multipágina`
        : `Elemento industrial de prueba ${index + 1} con terminación reforzada`,
    cantidad: quantity,
    unidad: "UN",
    precioVenta: price,
    ivaPorcentaje: 21,
    total: quantity * price,
  };
});
const subtotal = items.reduce((sum, item) => sum + item.total, 0);

const html = moduleRef.exports.generatePresupuestoPDF(
  {
    numero: "PR-2026-QA34",
    fecha: "2026-10-07",
    vencimiento: "2026-10-31",
    estadoLabel: "Pendiente",
    moneda: "USD",
    subtotal,
    iva: subtotal * 0.21,
    total: subtotal * 1.21,
    condicionPago: "Transferencia - 30 días",
    observaciones: "Documento sintético para validar visualmente encabezados, continuidad, totales y pie en todas las páginas.",
    clienteNombre: "CLIENTE DE PRUEBA MULTIPÁGINA S.A.",
    clienteCuit: "30-12345678-9",
    clienteCondicionIva: "Responsable Inscripto",
    sucursalNombre: "Planta principal",
    sucursalDireccion: "Parque Industrial, Buenos Aires",
    vendedorNombre: "Augusto Lazzari",
    tipoComprobante: "A",
    modalidadEmision: "arca",
    cotizacionModalidad: "divisas",
    tipoCambio: 1450,
    items,
  },
  {
    nombre: "Lazzari",
    razonSocial: "Lazzari Soluciones Industriales",
    cuit: "20-37930912-8",
    condicionIva: "Responsable Inscripto",
    colorPrimario: "#FF4500",
    domicilio: "Pueyrredón 653, Pergamino, Buenos Aires",
    telefono: "2477 628958",
    email: "administracion@lazzari.com.ar",
    commercialEmail: "ventas@lazzari.com.ar",
    web: "https://www.lazzari.com.ar",
    inicioActividades: "01-09-2017",
    ingresosBrutos: "20379309128",
    jurisdiccion: "Buenos Aires",
  }
);

const output = process.argv[2] || "/private/tmp/pr-pagination-qa.html";
fs.writeFileSync(output, html);
console.log(output);
