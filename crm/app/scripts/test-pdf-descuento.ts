import assert from "node:assert/strict";
import { generatePresupuestoPDF } from "../src/lib/pdf-templates";

const soc: any = { razonSocial: "Test SA", nombre: "Test", cuit: "20000000001", color: "#FF4500", colorPrimario: "#FF4500", direccion: "x", telefono: "", email: "", condicionIva: "RI", logo: "" };
const base: any = { numero: "PR-TEST-1", fecha: "2026-10-14", vencimiento: "2026-10-30", estado: "enviado", estadoLabel: "Enviado", moneda: "ARS", subtotal: 1800, iva: 378, total: 2178, clienteNombre: "Cliente", tipoComprobante: "A" };
const conDesc = generatePresupuestoPDF({ ...base, descuentoGeneralPorcentaje: 10, items: [
  { codigo: "A1", descripcion: "Guante", cantidad: 2, unidad: "u", precioVenta: 900, total: 2178, ivaPorcentaje: 21, precioLista: 1000 },
  { codigo: "B2", descripcion: "Casco", cantidad: 1, unidad: "u", precioVenta: 500, total: 605, ivaPorcentaje: 21, precioLista: 500 },
] }, soc);
assert.equal((conDesc.match(/Precio de lista/g) || []).length, 1, "solo el renglón con descuento muestra la lista");
assert.match(conDesc, /Descuento 10%/);
assert.match(conDesc, /Incluye descuento general del 10%/);
const sinDesc = generatePresupuestoPDF({ ...base, items: [{ codigo: "A1", descripcion: "Guante", cantidad: 1, unidad: "u", precioVenta: 900, total: 1089, precioLista: 900 }] }, soc);
assert.doesNotMatch(sinDesc, /Precio de lista|Los precios ya tienen el descuento/, "sin descuento el PDF queda igual que antes");
const viejo = generatePresupuestoPDF({ ...base, items: [{ codigo: "A1", descripcion: "Guante", cantidad: 1, unidad: "u", precioVenta: 900, total: 1089 }] }, soc);
assert.doesNotMatch(viejo, /Precio de lista/, "PR viejo sin precio_lista no cambia");
console.log("OK: el PDF del presupuesto muestra lista y descuento solo cuando hay descuento.");
