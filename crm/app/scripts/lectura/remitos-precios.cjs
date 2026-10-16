// SOLO LECTURA: revisa si presupuesto_items.precio_venta es el precio unitario sin IVA (subtotal = cantidad × precio_venta).
// Uso (desde crm/app): node scripts/lectura/remitos-precios.cjs
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await db.from("presupuesto_items").select("cantidad, precio_venta, subtotal, iva, total, iva_porcentaje").order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  let igual = 0, distinto = 0, sinPrecio = 0; const ej = [];
  for (const r of data) {
    if (r.precio_venta == null) { sinPrecio++; continue; }
    const calc = Number(r.cantidad) * Number(r.precio_venta);
    if (r.subtotal != null && Math.abs(calc - Number(r.subtotal)) < 1) igual++; else { distinto++; if (ej.length < 5) ej.push(r); }
  }
  console.log({ igual, distinto, sinPrecio }, ej);
  const { data: est } = await db.from("presupuestos").select("estado").limit(5000);
  const c = {}; for (const p of est || []) c[p.estado] = (c[p.estado] || 0) + 1; console.log(c);
})();
