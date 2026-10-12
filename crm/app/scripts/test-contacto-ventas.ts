// Prueba: la OC se manda al contacto de Ventas, nunca a Cobros/Administración.
import { contactoVentas } from "../src/lib/oc-envio";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };
ok(contactoVentas([{ cargo: "Cobros" }]) === null, "solo cobros -> nada");
ok(contactoVentas([{ cargo: "Cobros", id: 1 }, { cargo: "Ventas", id: 2 }] as Array<{ cargo: string | null; id: number }>)?.id === 2, "elige ventas");
ok(contactoVentas([{ cargo: null, id: 3 }] as Array<{ cargo: string | null; id: number }>)?.id === 3, "sin cargo sirve");
ok(contactoVentas([{ cargo: "Administración", id: 4 }, { cargo: "", id: 5 }] as Array<{ cargo: string | null; id: number }>)?.id === 5, "saltea administración");
ok(contactoVentas([]) === null, "sin contactos");
console.log("OK contacto-ventas");
