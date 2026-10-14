import assert from "node:assert/strict";
import { esRenglonEnvio } from "../src/lib/envio-detectar";

for (const t of ["Envío", "ENVIO", "envios", "Flete", "Fletes a obra", "Costo de transporte", "Traslado de mercadería", "Despacho", "Servicio de logística", "Envío a domicilio - Córdoba", "Entrega", "Encomienda Andreani", "shipping"]) {
  assert.equal(esRenglonEnvio(t), true, t);
}
for (const t of ["Botín de seguridad", "Guante nitrilo", "Caja de envío x 50", "Cinta de embalaje", "Casco con barbijo", "Entregable", "", "Camisa grafa talle 52"]) {
  assert.equal(esRenglonEnvio(t), false, t);
}
assert.equal(esRenglonEnvio("Servicio", "FLETE"), true);
console.log("OK test-envio-detectar");
