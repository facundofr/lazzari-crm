// Prueba de src/lib/archivo-link.ts (auditoría 28/10/2026, Parte D). Correr: npx tsx scripts/test-archivo-link.ts
import { linkArchivo, rutaDeLinkArchivo } from "../src/lib/archivo-link";

let fallas = 0;
const ver = (que: string, ok: boolean, dato?: unknown) => { console.log(ok ? "OK  " : "MAL ", que, ok ? "" : JSON.stringify(dato)); if (!ok) fallas++; };

const l = linkArchivo("facturas-compra", "lazzari/2026/FC Nº 12 año.pdf");
ver("arma el link propio codificando cada parte", l === "/api/archivo/facturas-compra/lazzari/2026/FC%20N%C2%BA%2012%20a%C3%B1o.pdf", l);
ver("lee de vuelta el link propio", JSON.stringify(rutaDeLinkArchivo(l)) === JSON.stringify({ bucket: "facturas-compra", ruta: "lazzari/2026/FC Nº 12 año.pdf" }), rutaDeLinkArchivo(l));
const viejo = "https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/comprobantes/op/OP-000044/a%20b.pdf";
ver("lee el link público viejo", JSON.stringify(rutaDeLinkArchivo(viejo)) === JSON.stringify({ bucket: "comprobantes", ruta: "op/OP-000044/a b.pdf" }), rutaDeLinkArchivo(viejo));
ver("con dominio del CRM adelante también", rutaDeLinkArchivo("https://lazzari-crm.vercel.app" + l)?.bucket === "facturas-compra");
ver("ignora ?download y #", rutaDeLinkArchivo(l + "?download=1")?.ruta === "lazzari/2026/FC Nº 12 año.pdf");
ver("productos no es privado: null", rutaDeLinkArchivo("https://x.supabase.co/storage/v1/object/public/productos/a.jpg") === null);
ver("bucket inventado: null", rutaDeLinkArchivo("/api/archivo/otro/a.pdf") === null);
ver("ruta con .. : null", rutaDeLinkArchivo("/api/archivo/comprobantes/a/../b.pdf") === null);
ver("link de otro sitio: null", rutaDeLinkArchivo("https://google.com/a.pdf") === null);
ver("vacío: null", rutaDeLinkArchivo(null) === null);
if (fallas) process.exit(1);
