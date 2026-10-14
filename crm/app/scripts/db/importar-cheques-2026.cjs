// IMPORTA a echeqs los cheques de ideas/cheques_desde_2026.csv que todavía NO están en la base (solo agrega, nunca cambia ni borra).
// Por defecto es SIMULACIÓN: hace todo dentro de una transacción y la deshace (no queda nada guardado).
// Solo guarda si se pasa --aplicar (lo corre Augusto o Claude con su OK).
// Uso (desde crm/app):  node scripts/db/importar-cheques-2026.cjs            → simula
//                       node scripts/db/importar-cheques-2026.cjs --aplicar  → guarda
// Vuelta atrás: supabase/operaciones/20261014_importar_cheques_2026_vuelta_atras.sql (borra solo lo marcado con MARCA).
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const APLICAR = process.argv.includes("--aplicar");
const SOCIEDAD = "Lazzari";
const MARCA = "Importado de cheques_desde_2026.csv (14/10/2026)";
const CSV = path.join(__dirname, "../../../../ideas/cheques_desde_2026.csv");
// Se dejan afuera a propósito (se avisan): el depósito de Alesso es plata personal, no un cheque de cliente.
const EXCLUIR_RECIBIDOS = { "14588139": "Depósito de Juan Pablo Alesso: va como Personal en el extracto, no como cheque" };

const lineas = fs.readFileSync(CSV, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
const cab = lineas[0].split(";");
const filas = lineas.slice(1).map((l) => { const c = l.split(";"); return Object.fromEntries(cab.map((k, i) => [k, (c[i] || "").trim()])); });
// Año "2025" mal tipeado en fechas de 2026.
for (const f of filas) for (const k of ["fecha_emision", "fecha_pago", "fecha_debito", "fecha_deposito"]) if (/^2025-/.test(f[k])) f[k] = "2026" + f[k].slice(4);

const sinCeros = (n) => String(n).replace(/^0+/, "");
const dmy = (s) => (s ? s.split("-").reverse().join("/") : "");

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const soc = (await db.query("select id from sociedades where nombre=$1", [SOCIEDAD])).rows[0];
    if (!soc) throw new Error("No existe la sociedad " + SOCIEDAD);
    const base = (await db.query("select numero,direccion from echeqs where sociedad_id=$1", [soc.id])).rows;
    const existentes = new Set(base.map((b) => b.direccion + "|" + sinCeros(b.numero)));
    const antes = (await db.query("select count(*)::int n from echeqs where sociedad_id=$1", [soc.id])).rows[0].n;

    let agregados = 0, salteados = 0, total = 0;
    const avisos = [];
    for (const f of filas) {
      if (existentes.has(f.direccion + "|" + sinCeros(f.numero))) continue;
      if (f.direccion === "recibido" && EXCLUIR_RECIBIDOS[sinCeros(f.numero)]) { salteados++; avisos.push(`Salteado ${f.numero}: ${EXCLUIR_RECIBIDOS[sinCeros(f.numero)]}`); continue; }
      const esEmitido = f.direccion === "emitido";
      const notas = [MARCA];
      if (f.fecha_debito) notas.push("débito " + dmy(f.fecha_debito));
      if (f.fecha_deposito) notas.push("depósito " + dmy(f.fecha_deposito));
      if (f.nota) notas.push(f.nota);
      // fecha_pago es obligatoria: si el cheque recibido no la trae, se usa la del depósito (y queda anotado).
      let fechaPago = f.fecha_pago;
      if (!fechaPago && f.fecha_deposito) { fechaPago = f.fecha_deposito; notas.push("fecha de pago = fecha de depósito (el listado no la traía)"); }
      if (!fechaPago) { avisos.push(`Salteado ${f.numero}: sin fecha de pago`); salteados++; continue; }
      const tipo = /f[ií]sico/i.test(f.tipo) ? "fisico" : "echeq";
      await db.query(
        `insert into echeqs (direccion,tipo_cheque,numero,banco_emisor,monto,moneda,fecha_emision,fecha_pago,fecha_deposito,estado,
            origen_nombre,destino_nombre,sociedad_id,observaciones,cubre_tercero)
         values ($1,$2,$3,$4,$5,'ARS',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          f.direccion, esEmitido ? "echeq" : tipo, f.numero, esEmitido ? "BBVA" : null, f.monto, f.fecha_emision || null, fechaPago, f.fecha_deposito || null,
          esEmitido ? (f.estado === "cobrado" ? "cobrado" : f.estado === "rechazado" ? "rechazado" : "entregado") : f.estado,
          esEmitido ? null : (f.emisor || f.contraparte), esEmitido ? f.contraparte : (f.endosado_a || null),
          soc.id, notas.join(" · "), f.martin_fernandez ? "Martín Fernández" : null,
        ]);
      agregados++; total += +f.monto;
    }
    const despues = (await db.query("select count(*)::int n from echeqs where sociedad_id=$1", [soc.id])).rows[0].n;
    console.log(`${APLICAR ? "GUARDADO" : "SIMULACIÓN (no se guardó nada)"}: agregados ${agregados} por $${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}; salteados ${salteados}; echeqs de ${SOCIEDAD}: ${antes} → ${despues}`);
    avisos.forEach((a) => console.log("  ⚠", a));
    if (despues !== antes + agregados) throw new Error("La cuenta no cierra: se cancela todo");
    await db.query(APLICAR ? "commit" : "rollback");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
