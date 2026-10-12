// SOLO LECTURA: prueba qué ve alguien NO logueado (solo con la clave pública) en las tablas de plata.
// Uso (desde crm/app): node scripts/lectura/probar-anonimo.cjs
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
(async () => {
  for (const t of ["ordenes_pago", "op_facturas_compra", "cobro_aplicaciones", "echeqs", "email_templates", "gastos_manuales", "saldos_caja"]) {
    const { data, error } = await anon.from(t).select("*").limit(5);
    console.log(t.padEnd(20), error ? `error: ${error.message}` : `filas visibles sin login: ${data.length}`);
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
