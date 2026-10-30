// Prueba de src/lib/mercado-libre-compras.ts (pestaña Mercado Libre de Compras Lazza). Correr: npx tsx scripts/test-mercado-libre-compras.ts
import assert from "node:assert/strict";
import { armarFilasML, faltaFactura, importeRenglon, ordenarCandidatas, resumenML, esMercadoLibre, vendedorML, type FacturaML } from "../src/lib/mercado-libre-compras";

assert.ok(esMercadoLibre("Mercado Libre") && esMercadoLibre("MERCADOLIBRE S.R.L.") && !esMercadoLibre("Prisina S.A."));

// OC-2026-1167: auriculares JBL 1 × 69.614 + IVA = 84.232,94 (la factura de You Choose dice 84.233).
assert.equal(importeRenglon({ id: "x", descripcion: "", cantidad: 1, precio_unitario: 69614, iva_porcentaje: 21 }), 84232.94);
assert.equal(importeRenglon({ id: "x", descripcion: "", cantidad: 2, precio_unitario: 100, iva_porcentaje: null }), 242);

const jbl: FacturaML = { id: "f1", numero: "00002-00001376", tipo: "FC A", total: 84233, moneda: "ARS" as const, fecha: "2026-09-26", proveedor: "You Choose S. A. S.", archivoUrl: null };
const cabsha: FacturaML = { id: "f2", numero: "00005-00117115", tipo: "FC A", total: 85996, moneda: "ARS", fecha: "2026-09-11", proveedor: "Mercado Libre", archivoUrl: null };
const anulada = "f9"; // no viene en la lista de facturas: no cuenta

const filas = armarFilasML([
  { id: "oc1", numero: "OC-2026-1167", fecha: "2026-09-29", moneda: "ARS", prNumero: "PR-2026-1191", cliente: "Corteva", items: [
    { id: "i1", descripcion: "AURICULARES JBL TUNE 520", cantidad: 1, precio_unitario: 69614, iva_porcentaje: 21 },
  ] },
  { id: "oc2", numero: "OC-2026-1055", fecha: "2026-09-01", moneda: "USD", prNumero: "PR-2026-1019", cliente: "Soenergy", items: [
    { id: "i2", descripcion: "TABLET WACOM", cantidad: 1, precio_unitario: 77, iva_porcentaje: 21, moneda: "USD" },
    { id: "i3", descripcion: "ESTANTE", cantidad: 1, precio_unitario: 43.37, iva_porcentaje: 21, moneda: "USD" },
    { id: "i4", descripcion: "renglón sin cantidad", cantidad: 0, precio_unitario: 10, iva_porcentaje: 21 },
  ] },
], [
  { ocItemId: "i1", facturaId: "f1", origen: "mercado_libre" },
  { ocItemId: "i1", facturaId: "f1", origen: "mercado_libre" }, // repetida: una sola vez
  { ocItemId: "i2", facturaId: anulada, origen: "mercado_libre" },
], [jbl, cabsha]);

assert.deepEqual(filas.map((f) => f.ocItemId), ["i1", "i3", "i2"], "más nuevas primero; el renglón sin cantidad no aparece");
assert.equal(filas[0].facturas.length, 1);
assert.equal(filas[0].facturas[0].numero, "00002-00001376");
assert.equal(filas.find((f) => f.ocItemId === "i2")!.facturas.length, 0, "la factura anulada no cuenta");
assert.equal(filas.find((f) => f.ocItemId === "i2")!.moneda, "USD");

const r = resumenML(filas);
assert.equal(r.total, 3);
assert.equal(r.sinFactura, 2);
assert.equal(r.importeSinFactura, 0);
assert.equal(r.importeSinFacturaUsd, 145.65); // 93,17 + 52,48

// Elegir una ya cargada: la de igual importe primero y marcada; la otra después.
const c = ordenarCandidatas([cabsha, jbl], 84232.94, "ARS");
assert.equal(c[0].id, "f1");
assert.equal(c[0].coincide, true);
assert.equal(c[1].coincide, false);
// Otra moneda va al final aunque el número se parezca.
const usd: FacturaML = { ...jbl, id: "f3", moneda: "USD", total: 84232.94 };
assert.equal(ordenarCandidatas([usd, cabsha], 84232.94, "ARS")[0].id, "f2");

// «No tiene factura» (Synthon, pagó Seba): deja de faltar y no suma.
const conMarca = armarFilasML([
  { id: "oc3", numero: "OC-2026-1151", fecha: "2026-09-23", moneda: "ARS", prNumero: "PR-2026-1143", cliente: "Synthon", items: [
    { id: "i5", descripcion: "ALTAVOZ JABRA", cantidad: 2, precio_unitario: 259225.27, iva_porcentaje: 21 },
    { id: "i6", descripcion: "otro", cantidad: 1, precio_unitario: 100, iva_porcentaje: 21 },
  ] },
], [], [], [{ ocItemId: "i5", motivo: "Pagó Seba" }]);
assert.equal(conMarca.find((f) => f.ocItemId === "i5")!.noTiene, "Pagó Seba");
assert.equal(faltaFactura(conMarca.find((f) => f.ocItemId === "i5")!), false);
assert.equal(faltaFactura(conMarca.find((f) => f.ocItemId === "i6")!), true);
assert.equal(resumenML(conMarca).sinFactura, 1);
assert.equal(resumenML(conMarca).importeSinFactura, 121);

// Vendedor que no está cargado (OC-2026-1261, pilotín, CUIT 30717434788): se crea solo con lo de ARCA.
assert.deepEqual(
  (({ razon_social, cuit, condicion_iva }) => ({ razon_social, cuit, condicion_iva }))(vendedorML({ cuit: "30-71743478-8", tipo: "FC A", arca: { razon_social: "PILOTINES S.A.", condicion_iva: "RI" } })),
  { razon_social: "PILOTINES S.A.", cuit: "30717434788", condicion_iva: "RI" });
// ARCA no respondió: nombre leído de la factura; condición por el tipo.
assert.equal(vendedorML({ cuit: "20111111112", tipo: "FC C", leido: "Juan Pérez" }).razon_social, "Juan Pérez");
assert.equal(vendedorML({ cuit: "20111111112", tipo: "FC C" }).condicion_iva, "Monotributo");
assert.equal(vendedorML({ cuit: "30717434788", tipo: "FC A", arca: null }).razon_social, "Vendedor Mercado Libre CUIT 30717434788");
assert.equal(vendedorML({ cuit: "30717434788", tipo: "FC A", arca: { condicion_iva: "Monotributo" } }).condicion_iva, "Monotributo");

console.log("test-mercado-libre-compras OK");
