import assert from "node:assert/strict";
import { observacionesParaCliente } from "../src/lib/observaciones-cliente";

// Caso real: lo que escribió el vendedor se conserva, lo que anota el sistema se saca.
const real = [
  "INDUMENTARIA: SALDAÑA ZITA/PEREZ GUTIERREZ",
  "OC: 1003PO000003402 - REM-00004015 - PERGAMINO",
  "[09/10/2026 07:05] FC 0002-00036698: CAMISA CAIRO UV BEIGE - PAMPERO - TALLE S: costo 37259.00 ARS → 37529 ARS (margen 43.59% → 42.56%); CAMISA CAIRO UV BEIGE - PAMPERO - TALLE M: costo 37259.00 ARS → 37529 ARS (margen 40.05% → 39.04%)",
].join("\n");
assert.equal(observacionesParaCliente(real), "INDUMENTARIA: SALDAÑA ZITA/PEREZ GUTIERREZ\nOC: 1003PO000003402 - REM-00004015 - PERGAMINO");

// Formatos de fecha que usa el CRM: toLocaleString de es-AR ("14/10/2026, 03:24:43") y el de la base ("DD/MM/YYYY HH24:MI")
assert.equal(observacionesParaCliente("Entrega en 48 hs\n[14/10/2026, 03:24:43] «Botín» se compró como «Botín 2»: 3 a 28000 ARS"), "Entrega en 48 hs");
assert.equal(observacionesParaCliente("[9/10/2026 07:05] OC-2026-1221 ajustada a la factura: Botín: costo 26862 → 28275.8 (margen 35% → 28.25%)"), "");

// Sin marcas automáticas no toca nada (ni siquiera con corchetes o porcentajes comunes)
assert.equal(observacionesParaCliente("Pago a 30 días. Descuento 5% por pronto pago [ver condiciones]"), "Pago a 30 días. Descuento 5% por pronto pago [ver condiciones]");
assert.equal(observacionesParaCliente("Garantía 12 meses\n\nEntrega inmediata"), "Garantía 12 meses\n\nEntrega inmediata");

// Una línea con margen/costo sin fecha también se saca
assert.equal(observacionesParaCliente("Hola\nBotín: costo 100 → 120 (margen 30% → 20%)"), "Hola");

// Vacíos
assert.equal(observacionesParaCliente(null), "");
assert.equal(observacionesParaCliente(undefined), "");
assert.equal(observacionesParaCliente(""), "");

console.log("OK: las observaciones para el cliente no llevan costos ni márgenes automáticos.");

// El PDF del presupuesto, de punta a punta: no imprime costos ni márgenes, sí lo que escribió el vendedor.
import { generatePresupuestoPDF } from "../src/lib/pdf-templates";
const soc: any = { razonSocial: "Test SA", nombre: "Test", cuit: "20000000001", color: "#FF4500", colorPrimario: "#FF4500", direccion: "x", telefono: "", email: "", condicionIva: "RI", logo: "" };
const html = generatePresupuestoPDF({
  numero: "PR-TEST-2", fecha: "2026-10-14", vencimiento: "2026-10-30", estado: "enviado", estadoLabel: "Enviado", moneda: "ARS",
  subtotal: 100, iva: 21, total: 121, clienteNombre: "Cliente", tipoComprobante: "A", observaciones: real,
  items: [{ codigo: "A1", descripcion: "Camisa", cantidad: 1, unidad: "u", precioVenta: 100, total: 121 }],
} as any, soc);
assert.match(html, /INDUMENTARIA: SALDAÑA ZITA/);
assert.doesNotMatch(html, /margen 4\d|43\.59|37259|37529|→/);
console.log("OK: el PDF del presupuesto no imprime costos ni márgenes automáticos.");
