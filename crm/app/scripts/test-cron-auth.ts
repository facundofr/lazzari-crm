// Prueba de src/lib/cron-auth.ts (auditoría 28/10/2026, H36): los crons fallan CERRADO.
// Correr: npx tsx scripts/test-cron-auth.ts
import { NextRequest } from "next/server";
import { cronNoAutorizado } from "../src/lib/cron-auth";

const pedido = (auth?: string) => new NextRequest("http://x/api/cron/bcra", { headers: auth ? { authorization: auth } : {} });
let fallas = 0;
const ver = (que: string, ok: boolean) => { console.log(ok ? "OK  " : "MAL ", que); if (!ok) fallas++; };

delete process.env.CRON_SECRET;
ver("sin CRON_SECRET configurada: rechaza", cronNoAutorizado(pedido())?.status === 401);
ver("sin CRON_SECRET configurada: rechaza aunque mande algo", cronNoAutorizado(pedido("Bearer undefined"))?.status === 401);
process.env.CRON_SECRET = "clave-de-prueba";
ver("sin encabezado: rechaza", cronNoAutorizado(pedido())?.status === 401);
ver("clave equivocada: rechaza", cronNoAutorizado(pedido("Bearer otra"))?.status === 401);
ver("clave correcta: deja pasar", cronNoAutorizado(pedido("Bearer clave-de-prueba")) === null);
if (fallas) process.exit(1);
