// Prueba rápida de lib/remitos-crear.ts. Correr: npx tsx scripts/test-remitos-crear.ts
import assert from "node:assert/strict";
import { valorSugerido, excesos, agruparPorSucursal, ocAnteriorDistinta, numeroCAI, descripcionCorta } from "../src/lib/remitos-crear";

// Valor sugerido: cantidad × precio sin IVA; sin precio no suma; cantidad 0 no suma.
assert.equal(valorSugerido([{ cantidad: 5, precio: 1000 }, { cantidad: 2, precio: 250.5 }, { cantidad: 3, precio: null }, { cantidad: 0, precio: 99 }]), 5501);
assert.equal(valorSugerido([]), 0);

// Excesos: solo aviso para los que se pasan; renglón libre (pendiente null) nunca.
const ex = excesos([
  { key: "a", descripcion: "Camisa", cantidad: 12, pendiente: 10 },
  { key: "b", descripcion: "Pantalón", cantidad: 10, pendiente: 10 },
  { key: "c", descripcion: "Libre", cantidad: 99, pendiente: null },
]);
assert.deepEqual(ex.map((e) => e.key), ["a"]);

// Sucursales: sin repartir todo a la única; repartir = un grupo por sucursal; cantidad 0 afuera.
const rs = [
  { cantidad: 5, sucursal_id: "s1" },
  { cantidad: 3, sucursal_id: "s2" },
  { cantidad: 0, sucursal_id: "s2" },
  { cantidad: 1, sucursal_id: null },
];
const unica = agruparPorSucursal(rs, false, "s9");
assert.equal(unica.length, 1);
assert.equal(unica[0].sucursal_id, "s9");
assert.equal(unica[0].renglones.length, 3);
const rep = agruparPorSucursal(rs, true, "s9");
assert.deepEqual(rep.map((g) => [g.sucursal_id, g.renglones.length]), [["s1", 1], ["s2", 1], [null, 1]]);
assert.equal(agruparPorSucursal(rs, false, null)[0].sucursal_id, null);

// OC anterior distinta: avisa solo si el último remito con OC usó otra.
assert.equal(ocAnteriorDistinta("4500123", [{ fecha: "2026-10-01", oc_cliente: "4500999" }, { fecha: "2026-09-01", oc_cliente: "4500123" }]), "4500999");
assert.equal(ocAnteriorDistinta("4500123", [{ fecha: "2026-10-01", oc_cliente: " 4500123 " }]), null);
assert.equal(ocAnteriorDistinta("4500123", [{ fecha: "2026-10-01", oc_cliente: null }]), null);
assert.equal(ocAnteriorDistinta(null, [{ fecha: "2026-10-01", oc_cliente: "X1" }]), "X1");

// Número CAI y descripción corta.
assert.equal(numeroCAI(15, 77), "0015-00000077");
assert.equal(numeroCAI(null, 77), null);
assert.deepEqual(descripcionCorta([{ descripcion: "Pantalón", orden: 2 }, { descripcion: "Camisa", orden: 1 }, { descripcion: "Gorra", orden: 3 }]), { corta: "Camisa +2 más", todas: "Camisa\nPantalón\nGorra" });
assert.deepEqual(descripcionCorta([]), { corta: "", todas: "" });

console.log("test-remitos-crear OK");

// Número visible y nombre del PDF.
import { numeroRemito, nombrePDFRemito } from "../src/lib/remitos-crear";
assert.equal(numeroRemito({ numero: "R-2026-1088", punto_venta_cai: 18, nro_comprobante_cai: 82 }), "0018-00000082");
assert.equal(numeroRemito({ numero: "R-2026-1083", punto_venta_cai: null, nro_comprobante_cai: null }), "R-2026-1083");
assert.equal(nombrePDFRemito("0018-00000082", "SYNERTECH INDUSTRIAS S.A."), "Remito 0018-00000082 - SYNERTECH INDUSTRIAS S.A.pdf");
assert.equal(nombrePDFRemito("R-2026-1083", "A/B: C"), "Remito R-2026-1083 - A B C.pdf");
assert.equal(nombrePDFRemito("R-1", null), "Remito R-1.pdf");
console.log("test número/nombre PDF OK");
