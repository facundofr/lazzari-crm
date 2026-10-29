// Prueba de lib/presupuesto-seguimiento.ts. Correr desde crm/app: npx tsx scripts/test-presupuesto-seguimiento.ts
import assert from "node:assert/strict";
import { avisoSeguimientoQueToca, clasificarPR, sumarDias, diasEntre, fechaAR, haceDias, compararSeguimiento, type EventoSeg } from "../src/lib/presupuesto-seguimiento";

const hoy = "2026-10-16";
const ev = (o: Partial<EventoSeg>): EventoSeg => ({ id: Math.random().toString(), presupuesto_id: "p", tipo: "contacto", created_at: "2026-10-10T15:00:00Z", ...o } as EventoSeg);

assert.equal(sumarDias("2026-10-30", 3), "2026-11-02");
assert.equal(diasEntre("2026-10-10", "2026-10-16"), 6);
assert.equal(fechaAR("2026-10-16T02:00:00Z"), "2026-10-15"); // 23:00 del día anterior en Argentina
assert.equal(haceDias(0), "hoy"); assert.equal(haceDias(1), "ayer"); assert.equal(haceDias(5), "hace 5 días");

// Enviado hace 5 días, sin contactos: toca hoy (más de 3 días), atraso 2
let c = clasificarPR({ id: "p", estado: "pendiente", enviado_at: "2026-10-11T15:00:00Z", vencimiento: "2026-11-10" }, [], hoy);
assert.equal(c.grupo, "hoy"); assert.equal(c.diasEnviado, 5); assert.equal(c.atraso, 2); assert.equal(c.proxima, "2026-10-14"); assert.equal(c.contactos, 0);

// Enviado ayer: espera, le toca el 18/10
c = clasificarPR({ id: "p", estado: "pendiente", enviado_at: "2026-10-15T15:00:00Z", vencimiento: "2026-11-10" }, [], hoy);
assert.equal(c.grupo, "esperando"); assert.equal(c.proxima, "2026-10-18"); assert.equal(c.atraso, 0);

// Contactado hace 1 día por mail: espera 3 días desde el contacto
c = clasificarPR({ id: "p", estado: "pendiente", enviado_at: "2026-10-01T15:00:00Z", vencimiento: "2026-11-10" }, [ev({ canal: "mail", created_at: "2026-10-15T15:00:00Z" })], hoy);
assert.equal(c.grupo, "esperando"); assert.equal(c.proxima, "2026-10-18"); assert.equal(c.diasDesdeContacto, 1); assert.equal(c.contactos, 1);

// Posponer hasta una fecha futura gana sobre la regla de días
c = clasificarPR({ id: "p", estado: "pendiente", enviado_at: "2026-10-01T15:00:00Z", vencimiento: "2026-11-10" }, [ev({ tipo: "posponer", proxima_fecha: "2026-10-25", created_at: "2026-10-16T12:00:00Z" })], hoy);
assert.equal(c.grupo, "esperando"); assert.equal(c.proxima, "2026-10-25");

// Posponer vencido (fecha ya pasada): toca hoy
c = clasificarPR({ id: "p", estado: "pendiente", enviado_at: "2026-10-01T15:00:00Z", vencimiento: "2026-11-10" }, [ev({ tipo: "posponer", proxima_fecha: "2026-10-14", created_at: "2026-10-10T12:00:00Z" })], hoy);
assert.equal(c.grupo, "hoy");

// No contestó cuenta como contacto
c = clasificarPR({ id: "p", estado: "pendiente", enviado_at: "2026-10-01T15:00:00Z", vencimiento: "2026-11-10" }, [ev({ tipo: "resultado", resultado: "no_contesto", created_at: "2026-10-16T12:00:00Z" })], hoy);
assert.equal(c.contactos, 1); assert.equal(c.grupo, "esperando");

// Vencido por estado o por fecha
c = clasificarPR({ id: "p", estado: "vencido", enviado_at: "2026-09-01T15:00:00Z", vencimiento: "2026-10-01" }, [], hoy);
assert.equal(c.grupo, "vencido"); assert.equal(c.diasVencido, 15);
c = clasificarPR({ id: "p", estado: "pendiente", enviado_at: "2026-09-01T15:00:00Z", vencimiento: "2026-10-15" }, [], hoy);
assert.equal(c.grupo, "vencido");
// Vence hoy: todavía vale
c = clasificarPR({ id: "p", estado: "pendiente", enviado_at: "2026-10-14T15:00:00Z", vencimiento: "2026-10-16" }, [], hoy);
assert.notEqual(c.grupo, "vencido");

// Orden: más atraso primero, después más plata
const orden = [{ grupo: "hoy", atraso: 1, diasEnviado: 4, montoPesos: 100 }, { grupo: "hoy", atraso: 3, diasEnviado: 6, montoPesos: 10 }, { grupo: "hoy", atraso: 1, diasEnviado: 4, montoPesos: 900 }] as const;
const o = [...orden].sort(compararSeguimiento);
assert.equal(o[0].atraso, 3); assert.equal(o[1].montoPesos, 900);

// Avisos del control diario: el de 5 días sale (antes no), sin repetir ni mandar los tres juntos
const ya = (...t: string[]) => new Set(t);
assert.equal(avisoSeguimientoQueToca(2, ya()), null);
assert.equal(avisoSeguimientoQueToca(3, ya())?.title, "Seguimiento PR");
assert.equal(avisoSeguimientoQueToca(4, ya("Seguimiento PR")), null);
assert.equal(avisoSeguimientoQueToca(5, ya("Seguimiento PR"))?.title, "Seguimiento PR (5 días)");
assert.equal(avisoSeguimientoQueToca(6, ya("Seguimiento PR", "Seguimiento PR (5 días)")), null);
assert.equal(avisoSeguimientoQueToca(7, ya("Seguimiento PR", "Seguimiento PR (5 días)"))?.urgente, true);
assert.equal(avisoSeguimientoQueToca(30, ya())?.title, "Seguimiento urgente PR"); // PR viejo: solo el último
assert.equal(avisoSeguimientoQueToca(6, ya("Seguimiento urgente PR")), null); // ya tiene uno posterior
assert.equal(avisoSeguimientoQueToca(9, ya("Seguimiento urgente PR")), null);

console.log("test-presupuesto-seguimiento OK");
