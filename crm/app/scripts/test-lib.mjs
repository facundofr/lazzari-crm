// Freno de pruebas antes de publicar (auditoría integral 28/10/2026, Tanda 0).
// Corre las pruebas PURAS (no tocan la base, ni la red, ni ARCA): las cuentas de saldos, cheques, retenciones,
// compras, remitos, OP, etc. Si una falla, "npm run build" se corta y Vercel NO publica.
//   Uso (desde crm/app): node scripts/test-lib.mjs        → corre todas, de a varias a la vez
//   Saltear a propósito (solo una urgencia): SALTEAR_PRUEBAS=1 npm run build   → avisa bien claro y sigue
// Al agregar una prueba pura nueva (scripts/test-*.ts|mjs|cjs), sumarla a la lista de abajo.
// Afuera a propósito: las que leen la base o .env (catalogo-busqueda, lectura/*), las de ARCA (test:fce),
// y las que buscan texto dentro de pantallas (test:regressions).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRUEBAS = [
  "test-agente-mail.ts", "test-archivo-link.ts", "test-ayuda.ts", "test-bancos-lazza.ts", "test-buscar-texto.ts",
  "test-caja-proyectada.ts", "test-carga-diaria.ts", "test-cargar-factura.ts", "test-cartel-guardado.ts",
  "test-certificado-retencion.ts", "test-certificado-sufrido.ts", "test-cheque-comprobante-op.ts", "test-cheques-solos.ts",
  "test-cheques-banco.ts", "test-cheques-estado-banco.ts", "test-cheques-filtro.mjs", "test-cheques-lazza.ts",
  "test-cheques-plazo.ts", "test-cobertura-cheques.ts", "test-cobertura-fijos.ts", "test-cobro-orden-pago.ts",
  "test-cobro-reparto.mjs", "test-compras-armado.ts", "test-compras-lazza.ts", "test-compras-recepcion.ts",
  "test-comprobante-medios.ts", "test-conciliacion-preguntas.ts", "test-condicion-desde-factura.ts",
  "test-cashflow.ts", "test-condicion-pago.ts", "test-contabilidad.ts", "test-contacto-ventas.ts", "test-control-dia.ts", "test-correo-finanzas.ts",
  "test-cron-auth.ts", "test-cuenta-corriente-cliente.ts", "test-documento-cliente.ts", "test-documento-impositivo.ts",
  "test-dolar-presupuesto.ts", "test-echeq-reportes.ts", "test-envio-detectar.ts", "test-envio-factura-texto.ts",
  "test-envio-reparto.ts", "test-estado-factura-venta.mjs", "test-extracto-bbva.ts", "test-factura-condicion.ts",
  "test-factura-desglose-talles.ts", "test-factura-moneda.ts", "test-factura-sin-ia.ts", "test-factura-tipo.ts",
  "test-factura-vs-oc-guardado.ts", "test-factura-vs-oc.ts", "test-facturado-mes.ts", "test-facturas-lazza.ts",
  "test-fci-custodia.mjs", "test-fecha-cobro.mjs", "test-finanzas-destino.ts", "test-finanzas-grupos.mjs",
  "test-finanzas-lazza.ts", "test-finanzas-notas.ts", "test-finanzas-propuestas.ts", "test-gasto-fijo-factura.ts",
  "test-gastos-lazza.ts", "test-ia-acciones.ts", "test-lista-costos.ts", "test-mayusculas.ts",
  "test-movimientos-banco.ts", "test-movimientos-bbva.ts", "test-nc-sugerencia.ts", "test-nombres-estados.ts", "test-numero-ar.ts",
  "test-observaciones-cliente.ts", "test-oc-diferencia.mjs", "test-oc-lista.ts", "test-oc-reclamos.mjs",
  "test-oc-sin-proveedor.ts", "test-op-parcial.ts", "test-op-usd-pesos.ts", "test-pago-tarjeta.ts", "test-premios-lazza.ts", "test-jose-alvarez.ts",
  "test-pdf-descuento.ts", "test-pendientes.ts", "test-precio-factura.ts", "test-presupuesto-ayudas.ts",
  "test-presupuesto-ia.ts", "test-presupuesto-margen.ts", "test-presupuesto-seguimiento.ts", "test-email-remitente.ts", "test-presupuesto-envios.ts", "test-correos-enviados.ts", "test-presupuesto-duplicar.ts",
  "test-proveedor-nombre.ts", "test-recibos.ts", "test-reemplazo-oc.ts", "test-remito-entrega.ts",
  "test-remitos-armado.ts", "test-remitos-crear.ts", "test-resto-facturar.ts", "test-resumen-bbva.ts",
  "test-resumen-cuenta.ts", "test-resumen-economico.mjs", "test-revisar-finanzas.ts", "test-saldo-cuentas.ts", "test-retencion-conceptos.ts", "test-saldo-clientes.ts",
  "test-saldo-favor-proveedor.ts", "test-saldo-proveedores.ts", "test-sicore-linea.ts", "test-soap-fault.mjs",
  "test-sugerir-concepto.ts", "test-tc-cobro-usd.mjs", "test-texto-mayusculas.ts", "test-tipos-movimiento.ts",
  "test-transportes-anotador.ts", "test-ventas-documentos.ts", "test-ventas-etapas.ts", "test-vep.ts", "test-avisos-cobranza.ts",
  "test-whatsapp-ar.ts",
];

if (process.env.SALTEAR_PRUEBAS === "1") {
  console.warn("\n⚠️  PRUEBAS SALTEADAS A PROPÓSITO (SALTEAR_PRUEBAS=1). Se publica sin controlar las cuentas.\n");
  process.exit(0);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const A_LA_VEZ = 6;
const inicio = Date.now();

function correr(archivo) {
  return new Promise((resolve) => {
    const args = archivo.endsWith(".ts") ? ["--import", "tsx", path.join(dir, archivo)] : [path.join(dir, archivo)];
    const p = spawn(process.execPath, args, { cwd: path.join(dir, ".."), env: { ...process.env, FORCE_COLOR: "0" } });
    let salida = "";
    p.stdout.on("data", (d) => { salida += d; });
    p.stderr.on("data", (d) => { salida += d; });
    const corte = setTimeout(() => { salida += "\n(cortada: tardó más de 60 s)"; p.kill(); }, 60_000);
    p.on("close", (codigo) => { clearTimeout(corte); resolve({ archivo, ok: codigo === 0, salida }); });
  });
}

const resultados = [];
const cola = [...PRUEBAS];
await Promise.all(Array.from({ length: A_LA_VEZ }, async () => {
  while (cola.length) resultados.push(await correr(cola.shift()));
}));

const fallas = resultados.filter((r) => !r.ok);
for (const f of fallas) {
  console.error(`\n✗ FALLÓ ${f.archivo}\n${f.salida.trim().split("\n").slice(-15).join("\n")}`);
}
const seg = Math.round((Date.now() - inicio) / 1000);
if (fallas.length) {
  console.error(`\n✗ ${fallas.length} de ${PRUEBAS.length} pruebas fallaron (${seg} s). No se publica: arreglá la cuenta o la prueba.`);
  console.error("  Si es una urgencia y sabés lo que hacés: SALTEAR_PRUEBAS=1 npm run build\n");
  process.exit(1);
}
console.log(`✓ ${PRUEBAS.length} pruebas de cuentas OK (${seg} s)`);
