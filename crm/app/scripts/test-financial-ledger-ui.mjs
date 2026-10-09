import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const finanzas = readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
const reportes = readFileSync(new URL("../src/app/(crm)/reportes/page.tsx", import.meta.url), "utf8");
const cargaFactura = readFileSync(new URL("../src/components/cargar-factura-oc.tsx", import.meta.url), "utf8");

assert.match(finanzas, /from\("clientes"\)\.select\("id, razon_social, cuit, dias_cuenta_corriente, forma_pago, limite_credito"\)/, "CC clientes debe salir de entidades y comprobantes reales");
assert.match(finanzas, /from\("proveedores"\)\.select\("id, razon_social, cuit, rubro, dias_cuenta_corriente, forma_pago, limite_credito"\)/, "CC proveedores debe salir de entidades y comprobantes reales");
assert.doesNotMatch(finanzas, /qCc(Cli|Prov).*\.eq\("activo", true\)/, "Una entidad inactiva con deuda no debe desaparecer de su cuenta corriente");
assert.doesNotMatch(finanzas, /from\("v_cuenta_corriente_(clientes|proveedores)"\)/, "Finanzas no debe depender de vistas de CC desactualizadas");
assert.match(finanzas, /id: "recibos", label: "Recibos"/, "Debe existir la pestaña Recibos");
assert.match(finanzas, /generateReciboPDF/, "Cada recibo debe poder generar un PDF real");
assert.match(finanzas, /Descargar recibo en PDF/, "La tabla de recibos debe exponer la descarga del comprobante");
assert.match(finanzas, /setResumenFinanciero\(\(actual\) => actual === "caja" \? null : "caja"\)/, "Caja debe ser un resumen plegable");
assert.match(finanzas, /setResumenFinanciero\(\(actual\) => actual === "balance" \? null : "balance"\)/, "Balance debe ser un resumen plegable");
assert.doesNotMatch(finanzas, /title="Saldo CC clientes"/, "El encabezado no debe repetir los saldos que ya están en cuentas corrientes");
assert.match(finanzas, /placeholder="Buscar número, proveedor, CUIT, medio o estado\.\.\."/, "Órdenes de pago debe tener búsqueda operativa");
assert.match(finanzas, /op\.proveedor_cuit/, "La búsqueda de OP debe contemplar CUIT del proveedor");
assert.match(finanzas, /id: "vencimientos", label: "Vencimientos"/, "Debe existir la pestaña Vencimientos");
assert.match(finanzas, /Compra y venta/, "Vencimientos debe filtrar tipo de operación");
assert.match(finanzas, /Clientes y proveedores/, "Vencimientos debe filtrar tipo de entidad");
assert.match(finanzas, /ARS y USD/, "Vencimientos debe filtrar moneda");
assert.match(finanzas, /Math\.max\(Number\(factura\.total_acreditado \|\| 0\), Number\(factura\.credito_nc \|\| 0\)\)/, "Una NC de compra no debe descontarse dos veces");
assert.match(finanzas, /\.eq\("movimientos\.sociedad_id", sociedadActiva\.id\)/, "Las aplicaciones de cobro deben filtrarse por la sociedad del movimiento asociado");
assert.doesNotMatch(finanzas, /qAplicaciones\.eq\("sociedad_id"/, "cobro_aplicaciones no tiene una columna sociedad_id propia");
assert.doesNotMatch(finanzas, /q(?:Aplic|CobAplic)\.eq\("sociedad_id"/, "Los detalles y cobros múltiples tampoco deben filtrar una columna inexistente");
assert.match(finanzas, /!movimientosAplicados\.has\(mov\.id\)/, "Un cobro consolidado no debe descontarse dos veces");
assert.match(finanzas, /const facturasCobrables = \(data \|\| \[\]\)\.filter\(\(factura: any\) => !String\(factura\.tipo \|\| ""\)\.toUpperCase\(\)\.startsWith\("NC"\)\)/, "Una nota de crédito nunca debe ofrecerse como factura a cobrar");

assert.match(reportes, /Compras vs ventas/, "Debe existir el reporte compras vs ventas");
assert.match(reportes, /Costo de lo vendido vs venta \(PR\)/, "Debe existir el reporte costo vs venta de PR");
assert.match(reportes, /\.in\("estado", \["aprobado", "facturado"\]\)/, "El reporte de margen debe tomar PR aprobados o facturados");
assert.match(reportes, /startsWith\("NC"\) \? -1 : 1/, "Las notas de crédito deben restar en los totales");
assert.match(reportes, /costoEnMonedaPresupuesto/, "El margen debe convertir cada costo a la moneda del PR");
assert.match(reportes, /tipo_cambio, tipo_cambio_divisas, presupuesto_items\(cantidad, precio_costo, costo_moneda\)/, "El reporte debe usar las cotizaciones congeladas del PR");

assert.match(cargaFactura, /from\("factura_compra_ocs"\)/, "La carga debe soportar la relación múltiple factura-OC");
assert.match(cargaFactura, /previouslyInvoiced/, "La carga debe considerar facturas previas de la OC");

console.log("OK: recibos con PDF, resumen financiero plegable, búsqueda de OP, vencimientos, cuentas corrientes, reportes y múltiples facturas por OC cubiertos.");
