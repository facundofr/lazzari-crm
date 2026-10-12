import { nombreProveedor, proveedorCoincide } from "../src/lib/proveedor-nombre";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };
ok(nombreProveedor({ razon_social: "STAR-TEX SA", nombre_fantasia: "Startex" }) === "STAR-TEX SA", "startex incluido");
ok(nombreProveedor({ razon_social: "AYRE LIBRE SA", nombre_fantasia: "Aire Libre" }) === "AYRE LIBRE SA · Aire Libre", "aire");
ok(nombreProveedor({ razon_social: "TKW S.A.", nombre_fantasia: "TKW" }) === "TKW S.A.", "tkw");
ok(nombreProveedor({ razon_social: "SERENPLAS SRL", nombre_fantasia: "Conoflex" }) === "SERENPLAS SRL · Conoflex", "conoflex");
ok(proveedorCoincide({ razon_social: "SERENPLAS SRL", nombre_fantasia: "Conoflex" }, "conof"), "busca fantasia");
ok(proveedorCoincide({ razon_social: "SEGUTECNICA S R L", nombre_fantasia: "Segutécnica" }, "segutécnica"), "acentos");
console.log("OK proveedor-nombre");
