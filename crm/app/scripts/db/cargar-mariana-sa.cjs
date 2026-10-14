// Carga única: Mariana S.A. (Pegaso) FC A 0012-00012760 + NC A 0010-00017374 contra OC-2026-1221.
// Usa las MISMAS funciones de la base que la pantalla (guardar_conciliacion_compra y registrar_nota_credito_compra_v2).
// Uso (desde crm/app):
//   node scripts/db/cargar-mariana-sa.cjs             -> PRUEBA: hace todo y lo DESHACE (no guarda nada)
//   node scripts/db/cargar-mariana-sa.cjs --aplicar   -> GUARDA de verdad (solo con OK de Augusto)
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const APLICAR = process.argv.includes("--aplicar");
const SOCIEDAD = "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021";
const PROVEEDOR = "bb2ece46-c2b9-4f40-897d-0dba192c7658"; // Pegaso = MARIANA SOCIEDAD ANONIMA
const AUGUSTO = "cb8fdf3e-d171-4042-9da7-248fe863b96d";
const OC = "OC-2026-1221";
const PDF_FC = "C:/Users/lazza/Downloads/FacturaA_0012-00012760_13-10-2026_16-40-13.pdf";
const PDF_NC = "C:/Users/lazza/Downloads/Nota_de_Credito_A_0010-00017374_13-10-2026_17-19-04.pdf";
const r2 = (n) => Math.round(n * 100) / 100;

const BOTIN = "BOT.FC.BOX.NGRO PCV NVA CP FRANCES NRO";
const botines = [[36, 1], [37, 2], [38, 4], [39, 3], [40, 6], [42, 2], [43, 5], [44, 1], [45, 2], [46, 2]];
const zapatos = [[41, 1], [42, 1], [43, 1]];
const itemsFC = [
  ...botines.map(([t, c]) => ({ key: `b${t}`, codigo: `131040${t}`, descripcion: `${BOTIN} ${t}`, cantidad: c, precio_unitario: 29764, descuento_porcentaje: 0, iva_porcentaje: 21, unidad: "UN" })),
  ...zapatos.map(([t, c]) => ({ key: `z${t}`, codigo: `121040${t}`, descripcion: `ZAP..BOX.NGRO PCV NVA CP ${t}`, cantidad: c, precio_unitario: 26332, descuento_porcentaje: 0, iva_porcentaje: 21, unidad: "UN" })),
];
const subtotal = r2(itemsFC.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0));
if (subtotal !== 912388) throw new Error("El neto no da 912.388: " + subtotal);

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: AUGUSTO, role: "authenticated" }), AUGUSTO]);

    const ocItems = await q(`select i.id, i.descripcion, i.cantidad, i.precio_unitario from orden_compra_items i join ordenes_compra o on o.id = i.orden_id where o.numero = $1 and o.sociedad_id = $2`, [OC, SOCIEDAD]);
    const ocBotin = ocItems.find((i) => /BOTIN/i.test(i.descripcion));
    const ocZapato = ocItems.find((i) => /ZAPATO/i.test(i.descripcion));
    if (!ocBotin || !ocZapato) throw new Error("No encuentro los renglones de la OC");

    // Lo que se cobra de verdad es el precio de la FC menos el 5 % de la NC (OK de Augusto: el costo del botín pasa a 28.275,80).
    const neto = (precio) => r2(precio * 0.95);
    const asignaciones = itemsFC.map((i) => {
      const esBotin = i.key.startsWith("b");
      const oc = esBotin ? ocBotin : ocZapato;
      return { key: i.key, orden_compra_item_id: oc.id, cantidad: i.cantidad, precio_factura: neto(i.precio_unitario), precio_oc: Number(oc.precio_unitario), origen: "manual" };
    });
    const eqs = [
      { producto_factura: "bot fc box ngro pcv nva cp frances nro", producto_oc: "botin de seguridad pegazo frances", codigo_proveedor: "13104036" },
      { producto_factura: "zap box ngro pcv nva cp", producto_oc: "zapato de seguridad pegazo negro", codigo_proveedor: "12104041" },
    ];
    const notasFC = "Conciliada por línea contra OC-2026-1221 (carga por script, OK de Augusto)\n"
      + "Precio de la factura $ 29.764 (botín) y $ 26.332 (zapato); Mariana S.A. bonifica el 5 % con NC A 0010-00017374. Costo aceptado en la OC y el PR: $ 28.275,80 (botín).\n"
      + "Entrega parcial: faltan 2 botines y 2 zapatos. Remito RE 0001-00035060, pedido 23338.";
    const f = await q(`select public.guardar_conciliacion_compra($1::uuid, null, $2::jsonb, $3::jsonb, $4::jsonb, false, true, $5::jsonb, true) r`, [
      SOCIEDAD,
      JSON.stringify({ proveedor_id: PROVEEDOR, numero_factura: "00012-00012760", tipo_comprobante: "FC A", fecha: "2026-10-13", fecha_vencimiento: "2026-10-23", cae: "86417530487007", moneda: "ARS", subtotal: 912388, iva: 191601.48, iva_porcentaje: 21, percepciones: 0, total: 1103989.48, notas: notasFC }),
      JSON.stringify(itemsFC), JSON.stringify(asignaciones), JSON.stringify(eqs),
    ]);
    const rf = f[0].r;
    console.log("FC →", JSON.stringify(rf));
    if (rf.requiere_confirmacion) throw new Error("Pide confirmación: " + rf.aviso);
    const fcId = rf.factura_compra_id;

    const nc = await q(`select public.registrar_nota_credito_compra_v2($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb) r`, [
      SOCIEDAD, require("crypto").randomUUID(),
      JSON.stringify({
        numero_factura: "00010-00017374", tipo_comprobante: "NC A", proveedor_id: PROVEEDOR, fecha: "2026-10-13", fecha_vencimiento: null,
        subtotal: 45619.4, iva_porcentaje: 21, iva: 9580.07, percepciones: 0, total: 55199.47, moneda: "ARS",
        estado: "pendiente_aprobacion", tipo: "mercaderia", solo_iva: false, notas: "Descuentos concedidos 5 % s/ FC 12-12760 (OC-2026-1221)",
        cae: "86417538929415", sociedad_id: SOCIEDAD, created_by: AUGUSTO, factura_origen_id: fcId,
      }),
      JSON.stringify([{ codigo: "51372001", descripcion: "DESCUENTOS CONCEDIDOS - COM", cantidad: 1, precio_unitario: 45619.4, descuento_porcentaje: 0, unidad: "UN", iva_porcentaje: 21 }]),
      JSON.stringify([{ factura_compra_id: fcId, monto: 55199.47 }]),
    ]);
    const ncId = nc[0].r.factura_compra_id;
    console.log("NC →", JSON.stringify(nc[0].r));

    // Resultado: lo que quedaría
    console.table(await q(`select numero_factura, tipo_comprobante, estado, fecha, subtotal, iva, total, credito_aplicado, total_acreditado, factura_origen_id is not null con_origen from facturas_compra where id in ($1,$2)`, [fcId, ncId]));
    console.table(await q(`select i.descripcion, i.cantidad, i.precio_unitario, i.subtotal from orden_compra_items i join ordenes_compra o on o.id = i.orden_id where o.numero = $1`, [OC]));
    console.table(await q(`select numero, subtotal, iva, total, estado_facturacion from ordenes_compra where numero = $1`, [OC]));
    console.table(await q(`select pi.descripcion, pi.precio_costo, pi.markup_porcentaje, pi.precio_venta from presupuesto_items pi where pi.presupuesto_id = 'b97bfde0-a60f-4fc5-b24d-0c82f4cc1eeb' and pi.descripcion ~* 'BOTIN|ZAPATO'`));
    const saldo = await q(`select (f.total - coalesce(f.total_acreditado,0)) saldo_fc from facturas_compra f where f.id = $1`, [fcId]);
    console.log("Saldo de la FC a pagar:", saldo[0]);

    if (!APLICAR) { await db.query("rollback"); console.log("\nPRUEBA: todo deshecho, NO se guardó nada."); return; }
    await db.query("commit");
    console.log("\nGUARDADO en la base.");
    // PDFs al Storage
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    for (const [id, file, nombre] of [[fcId, PDF_FC, "FAC 0012-00012760 MARIANA SA.pdf"], [ncId, PDF_NC, "NC 0010-00017374 MARIANA SA.pdf"]]) {
      const p = `${SOCIEDAD}/${id}/factura.pdf`;
      const { error } = await sb.storage.from("facturas-compra").upload(p, fs.readFileSync(file), { upsert: true, contentType: "application/pdf" });
      if (error) { console.log("PDF no subido:", nombre, error.message); continue; }
      const { data: u } = sb.storage.from("facturas-compra").getPublicUrl(p);
      await sb.from("facturas_compra").update({ archivo_url: u.publicUrl, archivo_nombre: nombre }).eq("id", id);
      console.log("PDF subido:", nombre);
    }
  } catch (e) {
    await db.query("rollback").catch(() => {});
    console.error("ERROR (se deshizo todo):", e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
