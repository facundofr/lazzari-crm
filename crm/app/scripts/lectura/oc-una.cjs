// SOLO LECTURA: estado de una OC, sus renglones, remitos de proveedor y alertas de "Llegó mercadería" del PR.
// Uso (desde crm/app): node scripts/lectura/oc-una.cjs OC-2026-1259
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const { data: o, error } = await db.from("ordenes_compra").select("id, numero, estado, updated_at, proveedores(razon_social, cuit), presupuestos:presupuesto_origen_id(id, numero), orden_compra_items(id, descripcion, cantidad, cantidad_recibida)").eq("numero", process.argv[2]).single();
  if (error) throw error;
  console.log(o.numero, o.estado, o.proveedores?.razon_social, o.proveedores?.cuit, o.presupuestos?.numero);
  for (const i of o.orden_compra_items) console.log(`  ${i.cantidad_recibida || 0}/${i.cantidad} ${i.descripcion}`);
  const r = await db.from("oc_remitos").select("id, numero_remito, anulado, estado_antes, estado_despues, cargado, created_at").eq("orden_id", o.id);
  console.log("oc_remitos:", JSON.stringify(r.data));
  if (o.presupuestos) { const a = await db.from("alertas").select("id, title, user_id, created_at").eq("entity_id", o.presupuestos.id).eq("module", "compras_nueva"); console.log("alertas:", JSON.stringify(a.data)); }
})().catch((e) => { console.error(e.message); process.exit(1); });
