// SOLO LECTURA: OC "Esperando" (pedidas o con algo recibido, no recibidas) con proveedor, PR, vendedor y renglones.
// Uso (desde crm/app): node scripts/lectura/oc-esperando.cjs [sociedad: Lazzari]
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const soc = (await db.from("sociedades").select("id, nombre").eq("nombre", process.argv[2] || "Lazzari").single()).data;
  const { data: ocs, error } = await db.from("ordenes_compra")
    .select("id, numero, estado, pedido, pedido_at, fecha, saldo_cerrado, proveedores(razon_social, cuit), presupuestos:presupuesto_origen_id(numero, vendedor_id, created_by), orden_compra_items(descripcion, codigo, cantidad, cantidad_recibida)")
    .eq("sociedad_id", soc.id).not("estado", "in", "(cancelada,recibida)").not("proveedor_id", "is", null);
  if (error) throw error;
  const perf = Object.fromEntries(((await db.from("profiles").select("id, full_name")).data || []).map((p) => [p.id, p.full_name]));
  for (const o of ocs.filter((o) => !o.saldo_cerrado && (o.pedido || o.orden_compra_items.some((i) => Number(i.cantidad_recibida) > 0)))) {
    const pr = o.presupuestos;
    console.log(`${o.numero} | ${o.estado} | ${o.proveedores?.razon_social} | pedido ${String(o.pedido_at || o.fecha).slice(0, 10)} | ${pr ? pr.numero + " vend " + perf[pr.vendedor_id || pr.created_by] : "sin PR"}`);
    for (const i of o.orden_compra_items) console.log(`    ${i.cantidad_recibida || 0}/${i.cantidad}  ${i.codigo || ""} ${i.descripcion}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
