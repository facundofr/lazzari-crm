import { sugerirFacturaParaNC } from "../src/lib/nc-sugerencia";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

const facts = [
  { id: "a", numero_factura: "0012-00012760", saldo_acreditable: 1103989.48 },
  { id: "b", numero_factura: "0012-00012700", saldo_acreditable: 20000 },
  { id: "c", numero_factura: "0012-00012600", saldo_acreditable: 0 },
];
ok(sugerirFacturaParaNC(facts, ["FC A 0012-00012760"], [], 55199.47)?.id === "a", "toma la factura citada con prefijo FC A");
ok(sugerirFacturaParaNC(facts, ["12-12700"], [], 1000)?.motivo === "asociada", "número corto citado");
ok(sugerirFacturaParaNC(facts, [], ["0012-00012760"], 55199.47)?.motivo === "tanda", "sin citada usa la de la tanda");
ok(sugerirFacturaParaNC(facts, [], ["0012-00012700", "0012-00012760"], 55199.47)?.id === "a", "prefiere la que alcanza para toda la NC");
ok(sugerirFacturaParaNC(facts, [], ["0012-00012700"], 55199.47)?.id === "b", "si ninguna alcanza, la primera");
ok(sugerirFacturaParaNC(facts, ["0012-00012600"], [], 10) === null, "sin saldo no se sugiere");
ok(sugerirFacturaParaNC(facts, ["9999-1"], ["0012-00012760"], 10)?.id === "a", "citada inexistente cae a la tanda");
ok(sugerirFacturaParaNC([], ["1-1"], ["1-1"], 10) === null, "sin facturas nada");
