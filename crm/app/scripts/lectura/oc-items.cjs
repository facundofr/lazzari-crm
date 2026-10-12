// SOLO LECTURA: muestra los renglones de las OC indicadas.
// Uso (desde crm/app): node scripts/lectura/oc-items.cjs OC-2026-1134 OC-2026-1130
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await db.from("ordenes_compra")
    .select("numero, sociedad_id, estado, pedido, notas_recepcion, presupuesto_origen_id, orden_compra_items(codigo, descripcion, cantidad, cantidad_recibida, producto_id)")
    .in("numero", process.argv.slice(2));
  if (error) throw error;
  for (const oc of data) {
    console.log(oc.numero, oc.sociedad_id.slice(0, 4), oc.estado, "pedido:", oc.pedido, "PR:", !!oc.presupuesto_origen_id, "notas:", oc.notas_recepcion || "");
    oc.orden_compra_items.forEach((i) => console.log("   ", i.cantidad_recibida, "/", i.cantidad, i.codigo, i.descripcion?.slice(0, 40), i.producto_id ? "CON PRODUCTO" : ""));
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
