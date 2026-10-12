// SOLO LECTURA: simula la regla nueva de recalcular_oc (migración 20261012150000) sobre todas las OC
// y lista las que cambiarían si se tocara un renglón. No escribe nada.
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r2 = (n) => Math.round(n * 100) / 100;
(async () => {
  const { data, error } = await db.from("ordenes_compra")
    .select("numero, subtotal, iva, total, presupuesto_origen:presupuesto_origen_id(modalidad_emision), orden_compra_items(cantidad, precio_unitario, iva_porcentaje)").range(0, 4999);
  if (error) throw error;
  let iguales = 0;
  for (const oc of data) {
    const it = oc.orden_compra_items || [];
    const sub = r2(it.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0));
    let iva = r2(it.reduce((s, i) => s + r2(i.cantidad * i.precio_unitario * Number(i.iva_porcentaje ?? 21) / 100), 0));
    if (oc.presupuesto_origen?.modalidad_emision === "manual" || (Number(oc.iva) === 0 && Number(oc.subtotal) > 0)) iva = 0;
    const d = Math.abs(sub - oc.subtotal) + Math.abs(iva - oc.iva) + Math.abs(r2(sub + iva) - oc.total);
    if (d <= 0.05) { iguales++; continue; }
    console.log(oc.numero, "hoy:", oc.subtotal, oc.iva, oc.total, "→ nueva regla:", sub, iva, r2(sub + iva), it.length ? "" : "(sin renglones)");
  }
  console.log("OC:", data.length, "| sin cambio:", iguales);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
