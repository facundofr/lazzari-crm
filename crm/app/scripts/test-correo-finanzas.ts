// Prueba rápida: npx tsx scripts/test-correo-finanzas.ts
import assert from "node:assert/strict";
import { estadoMail, avisoDePagoReciente, numeroComparable } from "../src/lib/correo-finanzas";
import type { FacturaAbierta } from "../src/lib/agente-mail";

const fac = (id: string, pv: number, numero: number, saldo: number): FacturaAbierta => ({
  id, tipo: "FA", punto_venta: pv, numero, cliente_id: "termo", cliente_nombre: "TERMO CORDOBA SAU", cliente_cuit: "30715378023",
  total: 966929.4, saldo, moneda: "ARS", estado: saldo > 0 ? "emitida" : "pagada",
});
const pagoTermo = { direccion: "recibido" as const, cliente_nombre: "TERMO CORDOBA SAU", cliente_cuit: "30-71537802-3", monto_neto: 936962.44, monto_total: 966929.4, fecha_pago: "2026-10-13", facturas: [{ numero: "00015-00000017", importe: 966929.4 }] };
const mail = (datos: any, categoria = "pago_retencion") => ({ id: "m", fecha_mail: "2026-10-13", categoria, datos });
const base = { facturas: [fac("f17", 15, 17, 966929.4)], lineas: [], extractoHasta: "2026-10-09", facturasCompra: [] };

// Extracto viejo → falta subir el extracto.
assert.equal(estadoMail(mail({ pago: pagoTermo }), base).estado, "falta_extracto");
// Llegó al banco y la línea está pendiente → para confirmar (con botón).
const r = estadoMail(mail({ pago: pagoTermo }), { ...base, extractoHasta: "2026-10-15", lineas: [{ id: "l", fecha: "2026-10-14", importe: 936962.44, estado: "pendiente" }] });
assert.equal(r.estado, "para_confirmar");
assert.equal(r.ir?.tab, "para_confirmar");
// Línea ya cruzada → conciliado.
assert.equal(estadoMail(mail({ pago: pagoTermo }), { ...base, extractoHasta: "2026-10-15", lineas: [{ id: "l", fecha: "2026-10-14", importe: 936962.44, estado: "matcheado" }] }).estado, "conciliado");
// Extracto al día y no está → no llegó.
assert.equal(estadoMail(mail({ pago: pagoTermo }), { ...base, extractoHasta: "2026-10-20" }).estado, "no_llego");
// Factura ya cobrada → cobrado (aunque no esté en el banco).
assert.equal(estadoMail(mail({ pago: pagoTermo }), { ...base, facturas: [fac("f17", 15, 17, 0)] }).estado, "cobrado");
// Pago nuestro.
assert.equal(estadoMail(mail({ pago: { ...pagoTermo, direccion: "emitido" } }), base).estado, "pago_nuestro");

// Factura de proveedor: cargada o no (el número se compara sin ceros ni letras).
assert.equal(numeroComparable("A-00042-00103132"), "42-103132");
assert.equal(numeroComparable("0004200103132"), "42-103132");
const facSegufer = { factura: { cuit: "30-67814536-6", emisor: "Segufer S.A.", numero: "00042-00103132", importe: 3562.5, vencimiento: "2026-10-21" } };
assert.equal(estadoMail(mail(facSegufer, "factura_proveedor"), base).estado, "factura_falta");
assert.equal(estadoMail(mail(facSegufer, "factura_proveedor"), { ...base, facturasCompra: [{ numero_factura: "A 0042-00103132", proveedor_cuit: "30678145366" }] }).estado, "factura_cargada");
// Factura nuestra (de venta) que reenvía un cliente → no es "sin cargar".
assert.equal(estadoMail(mail({ factura: { cuit: "20-37930912-8", emisor: "Lazzari Soluciones Industriales", numero: "0015-00000052" } }, "factura_proveedor"), base).estado, "mirar");
// Fecha del pago mal leída (08/01 en un mail del 09/10): vale la del mail → con extracto al 09/10 todavía no se sabe.
assert.equal(estadoMail({ id: "s", fecha_mail: "2026-10-09", categoria: "pago_retencion", datos: { pago: { ...pagoTermo, fecha_pago: "2026-01-08" } } }, { ...base, extractoHasta: "2026-10-08" }).estado, "falta_extracto");
// Reclamo sin datos → mirar.
assert.equal(estadoMail(mail(null, "reclamo_consulta"), base).estado, "mirar");

// No reclamar a quien avisó un pago que todavía no se cobró.
const pagos = [{ fecha: "2026-10-13", estado: "para_confirmar" as const, cliente: { nombre: "TERMO CORDOBA SAU", cuit: "30-71537802-3" } }];
assert.equal(avisoDePagoReciente({ nombre: "Termo Córdoba", cuit: "30715378023" }, pagos, "2026-10-15"), "2026-10-13");
assert.equal(avisoDePagoReciente({ nombre: "Otro SA", cuit: "30111111119" }, pagos, "2026-10-15"), null);
assert.equal(avisoDePagoReciente({ nombre: "Termo", cuit: "30715378023" }, [{ ...pagos[0], estado: "cobrado" }], "2026-10-15"), null);

console.log("correo-finanzas OK");
