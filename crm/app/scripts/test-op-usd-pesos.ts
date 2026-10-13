import { pesosDeUsd, brutoPesosDeUsd, cotizacionValida } from "../src/lib/op-usd-pesos";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

// Segufer (13/10): 173,57 + 954,08 a $1450 → mismos centavos que la base.
ok(pesosDeUsd(173.57, 1450) === 251676.5, `173,57 × 1450 = 251.676,50 (${pesosDeUsd(173.57, 1450)})`);
ok(pesosDeUsd(954.08, 1450) === 1383416, "954,08 × 1450 = 1.383.416,00");
ok(brutoPesosDeUsd([173.57, 954.08], 1450) === 1635092.5, "bruto Segufer 1.635.092,50 (igual que la prueba en la base)");
// Cotización con decimales y redondeo mitad hacia arriba.
ok(pesosDeUsd(0.01, 1450.5) === 14.51, "0,01 × 1450,5 = 14,505 → 14,51");
ok(pesosDeUsd(1112.58, 1506.5) === 1676101.77, `1112,58 × 1506,5 = 1.676.101,77 (${pesosDeUsd(1112.58, 1506.5)})`);
// Cada factura se redondea por separado.
ok(brutoPesosDeUsd([0.01, 0.01], 1450.5) === 29.02, "dos facturas de 0,01 a 1450,5 = 29,02");
ok(pesosDeUsd(100, 0) === 0 && !cotizacionValida(0) && cotizacionValida(1450), "cotización 0 no convierte");
console.log("TODO OK");
