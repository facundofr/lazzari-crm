// Prueba de la detección de renglones de OC sin proveedor. Correr desde crm/app: npx tsx scripts/test-oc-sin-proveedor.ts
import assert from "node:assert/strict";
import { coincidenciasSinProveedor, type CandidataSinProveedor } from "../src/lib/oc-sin-proveedor";

const cand = (id: string, ocNumero: string, descripcion: string, cantidad: number, precio: number, codigo = ""): CandidataSinProveedor =>
  ({ id, ocId: "oc-" + ocNumero, ocNumero, ocFecha: "2026-10-08", codigo, descripcion, cantidad, precio, moneda: "ARS" });

// Caso VAL ARG (FA 0007-00000083): 3 válvulas de aguja a $ 85.165,82 contra la OC-2026-1215, entre otros renglones sin proveedor
const candidatas = [
  cand("l1", "OC-2026-1215", "VÁLVULA AGUJA 3000LBS ROSCA H-H A105 3/4G GENEBRE 2221 05", 3, 85165.82, "2221 05"),
  cand("l2", "OC-2026-1215", "ROLLO TEFLON GRANDE", 30, 90),
  cand("l3", "OC-2026-1215", "AURICULARES CON MIC NISUTA USB NS-AU60", 1, 42365),
];
const factura = [{ key: "f1", codigo: "2221 05", descripcion: "Válvulas de aguja – 3000 Lbs Art. 2221. Rosca BSP H/H. Construcción: acero A105 / aguja INOX A182 F316 + T. Térmico. Estopada: PTFE Presión máxima de trabajo 210 bar. Diámetro 3/4\"", cantidad: 3, precio: 85165.82 }] as any;
const r = coincidenciasSinProveedor(factura, candidatas);
assert.equal(r.length, 1); assert.equal(r[0].ocLineId, "l1"); assert.equal(r[0].cantidad, 3);

// Una factura de algo que no está en ninguna OC sin proveedor no propone nada
assert.equal(coincidenciasSinProveedor([{ key: "f2", codigo: "", descripcion: "Costo de envío", cantidad: 1, precio: 90000 }] as any, candidatas).length, 0);
console.log("test-oc-sin-proveedor OK");
