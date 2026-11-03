// Prueba rápida: npx tsx scripts/test-banco-revision.ts
import assert from "node:assert/strict";
import { candidatosManual, marcasRevision, separarDecisiones } from "../src/lib/banco-revision";
import type { DecisionBanco, MovMotor } from "../src/lib/banco-motor";

const d = (linea_id: string, x: Partial<DecisionBanco>): DecisionBanco =>
  ({ linea_id, estado: "sin_cruzar", clasificacion: null, subtipo: null, movimientos: [], cheque_id: null, contra_cuenta_id: null, motivo: "", ...x });

// Lo del banco y los cheques se aplican; los cobros y pagos exactos solo se sugieren; lo sin cruzar con aviso va a la campana.
{
  const { aplicar, sugerencias } = separarDecisiones([
    d("imp", { estado: "del_banco", clasificacion: "impuesto" }),
    d("chq", { estado: "cruzada", clasificacion: "cheque_emitido", cheque_id: "c1" }),
    d("cob", { estado: "cruzada", clasificacion: "cobro", movimientos: ["m1"] }),
    d("vep", { estado: "cruzada", clasificacion: "impuesto", subtipo: "afip", movimientos: ["g1"] }),
    d("rech", { estado: "sin_cruzar", aviso: "Cheque rechazado" }),
    d("nada", { estado: "sin_cruzar", motivo: "No está el cobro en el CRM" }),
  ]);
  assert.deepEqual(aplicar.map((x) => x.linea_id), ["imp", "chq", "rech"]);
  assert.deepEqual([...sugerencias.keys()], ["cob", "vep"]);
}

// Revisada / no revisada y "No pasa por el BBVA" / "Volver": vale la última marca.
{
  const r = (accion: string, linea_id: string | null, created_at: string, propuesta: any = null) => ({ accion, linea_id, created_at, propuesta });
  const m = marcasRevision([
    r("revisada", "L1", "2026-11-02T10:00:00Z"),
    r("revisada", "L2", "2026-11-02T10:00:00Z"),
    r("no_revisada", "L2", "2026-11-02T11:00:00Z"),
    r("cruce_solo", "L3", "2026-11-02T11:00:00Z"),
    r("no_pasa_banco", null, "2026-11-02T10:00:00Z", { movimiento_id: "M1", nota: "Banco Nación" }),
    r("no_pasa_banco", null, "2026-11-02T10:00:00Z", { movimiento_id: "M2", nota: "" }),
    r("vuelve_banco", null, "2026-11-02T12:00:00Z", { movimiento_id: "M2" }),
  ]);
  assert.deepEqual([...m.revisadas], ["L1"]);
  assert.deepEqual([...m.noPasa.entries()], [["M1", "Banco Nación"]]);
}

// Elegir a mano: del mismo sentido, en pesos, hasta 30 días; primero el importe más parecido.
{
  const mov = (id: string, x: Partial<MovMotor>): MovMotor => ({ id, fecha: "2026-10-20", monto: 100, moneda: "ARS", tipo: "cobro", cliente_id: "c", ...x } as MovMotor);
  const movs = [
    mov("lejos", { monto: 1000 }),
    mov("cerca", { monto: 990 }),
    mov("pago", { tipo: "pago", cliente_id: null, proveedor_id: "p", monto: 1000 }),
    mov("usd", { monto: 1000, moneda: "USD" }),
    mov("viejo", { monto: 1000, fecha: "2026-09-01" }),
    mov("ret", { tipo: "retencion_iibb", monto: 1000 }),
    mov("exacto", { monto: 1000, fecha: "2026-10-25" }),
  ];
  assert.deepEqual(candidatosManual({ fecha: "2026-10-21", importe: 1000 }, movs).map((m) => m.id), ["lejos", "exacto", "cerca"]);
  assert.deepEqual(candidatosManual({ fecha: "2026-10-21", importe: -1000 }, movs).map((m) => m.id), ["pago"]);
}

console.log("test-banco-revision OK");
