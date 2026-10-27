import { normalizarVep, montoVep, descripcionVep, gastoConVep } from "../src/lib/vep";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };
ok(montoVep("1.234.567,89") === 1234567.89, "monto con puntos y coma");
ok(montoVep("1,234,567.89") === 1234567.89, "monto en formato inglés");
ok(montoVep("$ 950,5") === 950.5, "monto con coma decimal");
ok(montoVep(1616059.2) === 1616059.2, "monto número");
ok(montoVep(null) === 0, "sin monto = 0");
const d = normalizarVep({ concepto: "IVA", detalle: "IVA - DDJJ - período 09/2026", periodo: "2026-09", monto: "1.616.059,20", vencimiento: "2026-10-20", numero: "123456", cuit: "20-37930912-8", fecha_pago: "20/10/2026" });
ok(d.monto === 1616059.2 && d.periodo === "2026-09" && d.vencimiento === "2026-10-20", "normaliza VEP de IVA");
ok(d.cuit === "20379309128", "CUIT solo números");
ok(d.fecha_pago === null, "fecha en otro formato se descarta");
ok(descripcionVep(d) === "IVA - DDJJ - período 09/2026 (VEP 123456)", "descripción con número de VEP");
ok(normalizarVep({}).concepto === "Impuesto" && normalizarVep({}).periodo === null, "vacío no rompe");

// Arreglo 17: lo que el VEP completa en la ventana de Gastos (nunca guarda)
const vep = normalizarVep({ concepto: "IVA", detalle: "IVA - DDJJ - período 09/2026", periodo: "2026-09", monto: 1518750.73, vencimiento: "2026-10-21", numero: "1696000001", organismo: "ARCA" });
const nuevo = gastoConVep(vep, { detalle: "", fecha: "2026-10-26", monto: 0, editando: false });
ok(nuevo.detalle === "IVA - DDJJ - período 09/2026 (VEP 1696000001)" && nuevo.monto === 1518750.73 && nuevo.fecha === "2026-10-21" && nuevo.otroMonto === null, "gasto nuevo: detalle, monto y vencimiento del VEP");
ok(nuevo.nota === "Vence 21/10/2026 · ARCA", "nota con vencimiento y organismo");
ok(gastoConVep({ ...vep, fecha_pago: "2026-10-20" }, { detalle: "", fecha: "2026-10-26", monto: 0, editando: false }).fecha === "2026-10-20", "la fecha de pago gana al vencimiento");
ok(gastoConVep({ ...vep, monto: 0 }, { detalle: "", fecha: "2026-10-26", monto: 0, editando: false }).monto === 0, "sin monto leído no inventa uno");
const delBanco = gastoConVep(vep, { detalle: "ARCA VEP — pago 21/10 (BBVA OP1396)", fecha: "2026-10-21", monto: 1518750.73, editando: true });
ok(delBanco.detalle === "IVA - DDJJ - período 09/2026 (VEP 1696000001) — ARCA VEP — pago 21/10 (BBVA OP1396)" && delBanco.fecha === "2026-10-21" && delBanco.monto === 1518750.73 && delBanco.otroMonto === null, "gasto del banco: lo del VEP va adelante; fecha y monto quedan");
const otroMonto = gastoConVep(vep, { detalle: "ARCA VEP — pago 17/09 (BBVA OP8721)", fecha: "2026-09-17", monto: 507390, editando: true });
ok(otroMonto.monto === 507390 && otroMonto.fecha === "2026-09-17" && otroMonto.otroMonto === 1518750.73, "VEP por otro monto: no lo cambia y avisa");
ok(gastoConVep(vep, { detalle: "ARCA VEP — VEP IVA (VEP 1696000001) — pago 21/10", fecha: "2026-10-21", monto: 1518750.73, editando: true }).detalle === "ARCA VEP — VEP IVA (VEP 1696000001) — pago 21/10", "si el detalle ya tiene el N° de VEP no se repite");
ok(gastoConVep(vep, { detalle: "", fecha: "2026-10-21", monto: 0, editando: true }).monto === 1518750.73, "gasto sin monto: toma el del VEP");
