// Solo lectura: arma Finanzas Lazza › Facturas (traerFacturasFL) con la base real y compara lo pendiente con Vencimientos
// (traerDeudas, la misma cuenta de siempre). Uso (desde crm/app): npx tsx scripts/db/pruebas/verificar-facturas-lazza.ts
// Solo hace SELECT (con la clave de servicio, en memoria; no se muestra).
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const r2 = (x: number) => Math.round(x * 100) / 100;

(async () => {
  const { traerFacturasFL, traerDeudas } = await import("../../../src/components/finanzas-lazza/datos");
  const { filtrarFacturas, totalesFacturas } = await import("../../../src/lib/facturas-lazza");
  const hoy = new Date().toISOString().slice(0, 10);
  const socs = [["Lazzari", "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021"], ["Grupo LA", "fee94607-747a-4e87-ba24-aff9032f7a56"]];
  let mal = 0;
  for (const [nombre, id] of socs) {
    const deudas = await traerDeudas(id, hoy);
    for (const lado of ["venta", "compra"] as const) {
      const pend = await traerFacturasFL(id, lado, hoy, false);
      const todas = await traerFacturasFL(id, lado, hoy, true);
      const v = deudas.vencimientos.filter((x) => x.lado === lado);
      const sv = { ARS: 0, USD: 0 }; for (const x of v) sv[x.moneda] = r2(sv[x.moneda] + x.saldo);
      const tp = totalesFacturas(pend.filas);
      const tt = totalesFacturas(filtrarFacturas(todas.filas, { filtro: "pendientes" }));
      const ok = pend.filas.length === v.length && tp.saldo.ARS === sv.ARS && tp.saldo.USD === sv.USD && tt.saldo.ARS === sv.ARS && tt.saldo.USD === sv.USD;
      if (!ok) mal++;
      const cuenta = (e: string) => todas.filas.filter((f) => f.estado === e).length;
      console.log(`${nombre} · ${lado}: ${ok ? "OK" : "NO COINCIDE"} | pendientes ${pend.filas.length} (Vencimientos ${v.length}) $ ${tp.saldo.ARS} US$ ${tp.saldo.USD} (Vencimientos $ ${sv.ARS} US$ ${sv.USD}) | vencidas ${filtrarFacturas(pend.filas, { filtro: "vencidas" }).length}`
        + ` | todas ${todas.filas.length}: pendiente ${cuenta("pendiente")}, parcial ${cuenta("parcial")}, vencida ${cuenta("vencida")}, pagada ${cuenta("pagada")}, anulada ${cuenta("anulada")}, NC ${cuenta("nc")}`
        + ` | con "${lado === "venta" ? "cobrada" : "pagada"} con" ${todas.filas.filter((f) => f.docs.length).length}`
        + (lado === "venta" ? ` | con vendedor ${todas.filas.filter((f) => f.vendedor).length}, con OC ${todas.filas.filter((f) => f.ocCliente).length}, recibos ${todas.recibos.length}` : ""));
    }
  }
  console.log(mal ? `${mal} lados NO coinciden` : "Todo coincide con Vencimientos");
})().catch((e) => { console.error(e); process.exit(1); });
