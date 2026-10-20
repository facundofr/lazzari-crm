// Carga en el CRM la NC A 0001-00000025 (hecha en ARCA, 30/09/2026, CAE 86416795481784) que anula las FA 0015-00000010,
// 0015-00000019 y 0015-00000030 de BARRAZA JESICA PAOLA (Lazzari). Augusto 20/10/2026: "cargá la NC A 0001-00000025".
// No toca ARCA: usa crear_nota_credito_manual_venta_multiple como Augusto (auth.uid()).
// Uso (desde crm/app):  node scripts/db/pruebas/nc-barraza-0001-25.cjs          → prueba: llama y DESHACE (no guarda)
//                       node scripts/db/pruebas/nc-barraza-0001-25.cjs guardar  → guarda (idempotente por request_key)
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const GUARDAR = process.argv[2] === "guardar";
const AUGUSTO = "cb8fdf3e-d171-4042-9da7-248fe863b96d";
const LAZZARI = "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021";
const REQUEST_KEY = "5b0c9a1e-2f3d-4c6b-9e2a-0001000000a5";
const facturas = [
  { id: "d14caf46-c725-447d-aa93-08087b3ea0ad", monto: 7623000.00 },   // FA 0015-00000010
  { id: "6f19bfa5-409e-41e6-9b21-589256bf2df5", monto: 10110492.35 },  // FA 0015-00000019
  { id: "9d70418b-17ee-4760-8697-9c700d4075cc", monto: 9220848.56 },   // FA 0015-00000030
];
const items = [{ descripcion: "Error de facturación.", cantidad: 1, precio_unitario: 22276314.80, iva_porcentaje: 21, orden: 0 }];

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
      [JSON.stringify({ sub: AUGUSTO, role: "authenticated" }), AUGUSTO]);
    const { rows } = await db.query(
      `select public.crear_nota_credito_manual_venta_multiple($1, $2, $3::jsonb, 'NCA', 1, 25, '2026-09-30', 22276314.80, 4678026.11, 26954340.91,
        $4::jsonb, '86416795481784', '2026-10-10', 'NC hecha en ARCA (comprobantes en línea). Anula FA 0015-00000010, 0015-00000019 y 0015-00000030.', true) as r`,
      [REQUEST_KEY, LAZZARI, JSON.stringify(facturas), JSON.stringify(items)]);
    console.log(JSON.stringify(rows[0].r, null, 2));
    const est = await db.query("select punto_venta, numero, tipo, total, total_acreditado, estado, credito_aplicado, saldo_a_favor_cliente from facturas where id = any($1) or nota_credito_request_key = $2 order by tipo, numero",
      [facturas.map((f) => f.id), REQUEST_KEY]);
    console.table(est.rows);
    await db.query(GUARDAR ? "commit" : "rollback");
    console.log(GUARDAR ? "GUARDADO." : "PRUEBA: no se guardó nada (rollback).");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  } finally { await db.end(); }
})();
