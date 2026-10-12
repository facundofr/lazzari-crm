// SOLO LECTURA: foto de los estados de las OC y de las incoherencias entre estado, recepción, facturas y pago.
// Uso (desde crm/app): node scripts/lectura/oc-estados.cjs
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { data: ocs, error } = await db.from("ordenes_compra")
    .select("numero, sociedad_id, estado, estado_pago, medio_pago, estado_facturacion, saldo_cerrado, pedido, fecha, fecha_entrega_estimada, total, moneda, presupuesto_origen_id, orden_compra_items(cantidad, cantidad_recibida), facturas_compra(estado, total, tipo_comprobante), factura_compra_ocs(facturas_compra(estado, total, tipo_comprobante))")
    .range(0, 4999);
  if (error) throw error;
  const hoy = new Date().toISOString().slice(0, 10);
  const cuenta = (f) => { const m = {}; ocs.forEach((o) => { const k = f(o); m[k] = (m[k] || 0) + 1; }); return m; };
  console.log("Total OC:", ocs.length);
  console.log("estado:", cuenta((o) => o.estado));
  console.log("estado_pago:", cuenta((o) => `${o.estado_pago}${o.medio_pago ? "/" + o.medio_pago : ""}`));
  console.log("estado_facturacion:", cuenta((o) => String(o.estado_facturacion)));
  console.log("saldo_cerrado:", cuenta((o) => String(o.saldo_cerrado)), "| pedido:", cuenta((o) => String(o.pedido)));

  const raros = {};
  const add = (k, o, extra = "") => { (raros[k] ||= []).push(`${o.numero} [${o.estado}] ${extra}`); };
  for (const o of ocs) {
    const it = o.orden_compra_items || [];
    const pedida = it.reduce((s, i) => s + Number(i.cantidad), 0);
    const recibida = it.reduce((s, i) => s + Number(i.cantidad_recibida), 0);
    const fcs = [...(o.facturas_compra || []), ...(o.factura_compra_ocs || []).map((l) => l.facturas_compra).filter(Boolean)]
      .filter((f) => f.estado !== "anulada" && !/^NC/i.test(f.tipo_comprobante || ""));
    const facturado = fcs.reduce((s, f) => s + Number(f.total || 0), 0);
    const rec = `rec ${recibida}/${pedida}`;
    if (!it.length) add("sin renglones", o);
    if (o.estado === "recibida" && recibida < pedida && !o.saldo_cerrado) add("dice recibida pero falta mercadería", o, rec);
    if (["pendiente", "enviada", "confirmada"].includes(o.estado) && recibida > 0) add("dice pendiente pero ya recibió algo", o, rec);
    if (["pendiente", "enviada", "confirmada"].includes(o.estado) && fcs.length) add("pendiente de recibir pero ya tiene factura", o, `${rec} facturado ${facturado} de ${o.total}`);
    if (o.estado === "recibida_parcial" && pedida > 0 && recibida >= pedida) add("dice parcial pero recibió todo", o, rec);
    if (o.estado === "cancelada" && (recibida > 0 || fcs.length)) add("cancelada con recepción o factura", o, `${rec} fc ${fcs.length}`);
    if (o.estado_facturacion === "facturada" && !fcs.length) add("dice facturada sin factura", o);
    if (!o.estado_facturacion && fcs.length && facturado >= Number(o.total) * 0.99) add("facturada completa pero estado_facturacion vacío", o);
    if (o.estado_pago === "pagada" && o.medio_pago !== "tarjeta" && fcs.some((f) => f.estado !== "pagada")) add("dice pagada con facturas impagas", o);
    if (o.estado_pago !== "pagada" && fcs.length && fcs.every((f) => f.estado === "pagada")) add("facturas pagadas pero estado_pago pendiente", o);
    if (o.fecha_entrega_estimada && o.fecha_entrega_estimada < hoy && !["recibida", "cancelada"].includes(o.estado) && recibida < pedida)
      add("entrega vencida sin recibir", o, `entrega ${o.fecha_entrega_estimada} ${rec}`);
    if (o.estado !== "cancelada" && o.estado !== "borrador" && recibida === 0 && !fcs.length && o.fecha < new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10))
      add("más de 60 días sin recibir ni facturar", o, `fecha ${o.fecha}`);
  }
  for (const [k, v] of Object.entries(raros)) {
    console.log(`\n== ${k}: ${v.length}`);
    v.slice(0, 12).forEach((x) => console.log("  " + x));
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
