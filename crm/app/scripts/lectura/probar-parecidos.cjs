// SOLO LECTURA: vuelve a cruzar facturas de compra ya conciliadas, SIN IA ni equivalencias aprendidas,
// y compara lo que propone el motor (código tolerante + parecidos) con lo que quedó guardado.
// Uso (desde crm/app): node scripts/lectura/probar-parecidos.cjs
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const ts = require("typescript");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const src = fs.readFileSync(path.join(__dirname, "../../src/lib/purchase-matching.ts"), "utf8");
const ctx = { exports: {} };
vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
const { matchPurchaseLines } = ctx.exports;

(async () => {
  const { data: asig, error } = await db.from("factura_compra_asignaciones")
    .select("factura_compra_id, factura_compra_item_id, orden_compra_item_id, orden_compra_id, cantidad").range(0, 9999);
  if (error) throw error;
  const porFactura = new Map();
  for (const a of asig) (porFactura.get(a.factura_compra_id) || porFactura.set(a.factura_compra_id, []).get(a.factura_compra_id)).push(a);
  const tot = { codigo: [0, 0], equivalencia: [0, 0], parecido: [0, 0] };
  let sinAntes = 0, sinAhora = 0;
  for (const [fid, as] of porFactura) {
    const { data: fc } = await db.from("facturas_compra").select("numero_factura, estado").eq("id", fid).single();
    if (!fc || fc.estado === "anulada") continue;
    const { data: items } = await db.from("facturas_compra_items").select("id, codigo, descripcion, cantidad, precio_unitario, descuento_porcentaje").eq("factura_compra_id", fid);
    const ocIds = [...new Set(as.map((a) => a.orden_compra_id))];
    const { data: ocItems } = await db.from("orden_compra_items").select("id, orden_id, codigo, descripcion, cantidad, precio_unitario, codigo_proveedor, descripcion_proveedor, talle").in("orden_id", ocIds);
    const { data: ocs } = await db.from("ordenes_compra").select("id, numero, fecha").in("id", ocIds);
    const ocById = new Map(ocs.map((o) => [o.id, o]));
    // Lo que esta factura tenía disponible = lo que se le asignó (así el cruce es comparable).
    const asignadoPorLinea = new Map();
    for (const a of as) asignadoPorLinea.set(a.orden_compra_item_id, (asignadoPorLinea.get(a.orden_compra_item_id) || 0) + Number(a.cantidad));
    const lineasOc = ocItems.filter((o) => asignadoPorLinea.has(o.id)).map((o) => ({
      id: o.id, ocId: o.orden_id, ocNumero: ocById.get(o.orden_id)?.numero || "", ocFecha: ocById.get(o.orden_id)?.fecha || "",
      codigo: o.codigo_proveedor || o.codigo,
      descripcion: o.descripcion_proveedor ? `${o.descripcion_proveedor}${o.talle ? ` TALLE ${o.talle}` : ""}` : o.descripcion,
      cantidad: asignadoPorLinea.get(o.id), precio: Number(o.precio_unitario) || 0,
    }));
    const lineasFc = items.map((it) => ({ key: it.id, codigo: it.codigo, descripcion: it.descripcion, cantidad: Number(it.cantidad),
      precio: Math.round(Number(it.precio_unitario) * (1 - (Number(it.descuento_porcentaje) || 0) / 100) * 100) / 100 }));
    const r = matchPurchaseLines(lineasFc, lineasOc, {});
    const real = new Set(as.map((a) => `${a.factura_compra_item_id}|${a.orden_compra_item_id}`));
    const malos = [];
    for (const a of r.asignaciones) {
      const ok = real.has(`${a.invoiceKey}|${a.ocLineId}`);
      tot[a.origen][ok ? 0 : 1]++;
      if (!ok && a.origen === "parecido") malos.push(`${lineasFc.find((l) => l.key === a.invoiceKey).descripcion} → ${lineasOc.find((o) => o.id === a.ocLineId).descripcion}`);
    }
    const unidades = lineasFc.reduce((s, l) => s + l.cantidad, 0);
    const sinParecido = matchPurchaseLines(lineasFc, lineasOc, {}).asignaciones.filter((a) => a.origen !== "parecido").reduce((s, a) => s + a.cantidad, 0);
    const conTodo = r.asignaciones.reduce((s, a) => s + a.cantidad, 0);
    sinAntes += unidades - sinParecido; sinAhora += unidades - conTodo;
    console.log(`${fc.numero_factura}: ${conTodo}/${unidades} u. cruzadas sin IA${malos.length ? ` · ${malos.length} parecido(s) distintos a lo guardado:` : ""}`);
    for (const m of malos) console.log(`    ✗ ${m}`);
  }
  console.log("\nAsignaciones correctas / distintas a lo guardado, por origen:", JSON.stringify(tot));
  console.log(`Unidades sin cruzar (sin IA): sin parecidos ${sinAntes} → con parecidos ${sinAhora}`);
})();
