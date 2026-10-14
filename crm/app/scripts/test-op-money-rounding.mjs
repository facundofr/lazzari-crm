import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const moneySource = fs.readFileSync(new URL("../src/lib/payment-money.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(moneySource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const moneyModule = { exports: {} };
vm.runInNewContext(compiled, { module: moneyModule, exports: moneyModule.exports, Number, Math });
const { roundPaymentMoney, sumPaymentMoney } = moneyModule.exports;

assert.equal(roundPaymentMoney(8264.46 + 16528.93 + 24793.39), 49586.78);
assert.equal(sumPaymentMoney([10000.01, 20000.02, 30000.03]), 60000.06);
assert.equal(sumPaymentMoney([0.1, 0.2]), 0.3);

const finanzas = fs.readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
assert.match(finanzas, /const montoBrutoEfectivo = roundPaymentMoney\(opMontoBruto\)/);
assert.match(finanzas, /const baseRetencionEfectiva = roundPaymentMoney\(opBaseSinIVA\)/);
assert.match(finanzas, /monto: roundPaymentMoney\(f\.monto_a_pagar\)/);
assert.match(finanzas, /monto: roundPaymentMoney\(m\.monto\)/);
assert.match(finanzas, /p_base_retencion: roundPaymentMoney\(opBaseSinIVA\)/);

console.log("OK: OP y pagos parciales normalizan bruto, base, facturas, retenciones y medios al centavo.");
