# Estado del proyecto — CRM Lazzari

Actualizado: 11/10/2026 · Versión publicada: **V1.1.413** · En curso, sin publicar: **V1.1.414**

Leer esto primero en cada chat nuevo. Detalle de las ideas futuras: `IDEAS-PROXIMAS.md`.
Detalle de los errores financieros (A1…E): `DIAGNOSTICO-FINANCIERO.md`.
Versiones anteriores de este archivo: historial de git (`ESTADO-PROYECTO.md`).

---

## 1. Terminado y publicado

- **V1.1.410** (con migración ya corrida `20261010100000_compras_pagos_personalizacion_muestras_bcra.sql`):
  Ordenar OC abiertas con IA, un solo circuito de facturas de compra, Compras en 3 ejes (mercadería / factura / pago),
  Plan de pagos con retención RG 830 y Excel, Personalización, Muestras rehecho, Ficha 360, Oportunidades e informe BCRA.
  Para que el BCRA se actualice solo, en Vercel tienen que existir `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET` (solo nombres).
- **V1.1.411:** arreglos de Oportunidades (vendedor = `clientes.assigned_to`), aviso en bucle, cobros en Ficha 360 y paginado del cron BCRA.
- **V1.1.412:** OC sin candado (avisa en amarillo), lista de proveedores nueva con saldo real (`lib/saldo-proveedores.ts`),
  altas de proveedor y cliente rediseñadas con IA de papeles impositivos, buscador nuevo (2 letras, máx. 8) y nombre de fantasía automático.

## 2. Publicado el 11/10/2026 (V1.1.413), con las 3 migraciones ya corridas

Guardado en el commit `04c8b7f` (11/10/2026). Chequeo de tipos: 0 errores. Orden de hooks: OK. Tests de saldos, tipos de movimiento,
ventas, precio de factura, reportes y NC: todos OK.

- **Alta de cliente:** sucursales en el mismo alta.
- **Reportes y Dashboard:** libro IVA resta NC, sin anuladas, ARS y USD separados; meses sin corrimiento por zona horaria; sin cortes de 1000 filas; sin datos de ejemplo (`lib/reportes-comprobantes.ts`).
- **Correcciones financieras** (códigos de `DIAGNOSTICO-FINANCIERO.md`):
  - Ya en el código: A1 (Factura B con IVA, `lib/precio-factura.ts`), A6 (rechazar cheque), A8 (NC manual de venta en un paso),
    A9a (SICORE pide rol y sociedad), B1, B3, B4, B5, B6, B7, B8, B9, B12, C4, D2, D3.
  - En las migraciones: A2, A4, A7, A9b, B9, B10, C1, C2, C3, D3.
- **3 migraciones nuevas, YA corridas el 11/10/2026** (cada una con su vuelta atrás en `crm/app/supabase/rollback/`):
  1. `20261011100000_finanzas_correcciones.sql`
  2. `20261011110000_ventas_correcciones.sql`
  3. `20261011120000_compras_correcciones.sql`
  Se corren en ese orden en el SQL Editor de Supabase **antes** de publicar el código.

- **"Finish Finanzas fixes" terminado** (11/10/2026, en `finanzas/page.tsx`, también dentro de V1.1.413):
  - **A3:** anular una NC de compra usa `anular_nota_credito_compra_v2`.
  - **A7:** anular una factura de compra usa `anular_factura_compra()` (pide motivo opcional y muestra los avisos de pagos).
    "Eliminar" factura: si tiene pagos o NC aplicadas, recomienda anular; si Augusto insiste, elimina igual (avisa, no frena).
  - **B10:** el alta de gasto manual guarda `gasto_manual_id` en su pago; editar el gasto actualiza el pago (vía `gestionar_cobro`);
    eliminar el gasto anula su pago (queda el registro).
  - ⚠️ Necesita la migración `20261011100000_finanzas_correcciones.sql` corrida **antes** de publicar (si no, anular facturas y crear gastos dan error).
  - Chequeos: tipos 0 errores, hooks OK, tests de saldos, pago directo, anulación OP y edición FC OK.
    Fallan 6 tests de texto viejos (`financial-ledger-ui`, `op-echeqs`, `op-money-rounding`, `op-validation`,
    `pr-pagination-and-op-duplicates`, `purchase-credit-note`): **ya fallaban antes** de este cambio; quedan para revisar.
  - **Arreglo 11/10/2026:** la regla `tiene_contraparte` de `movimientos` (creada a mano en la base, no estaba en el repo) pedía cliente o proveedor,
    y rechazaba el pago de los gastos sin proveedor. Migración `20261011130000_movimientos_contraparte_gasto.sql` (con vuelta atrás):
    también acepta `gasto_manual_id`. No necesita cambio de código ni publicar.
  - **Arreglo 2 (11/10/2026):** otra regla hecha a mano, `monto_positivo` (monto > 0), hacía fallar **todas** las anulaciones
    (cobros, OP, NC de compra, pagos de gastos), porque anular deja el monto en 0. Migración `20261011140000_movimientos_anulados_reglas.sql`
    (con vuelta atrás): un movimiento anulado puede quedar en 0 y sin contraparte. Las 3 reglas CHECK de `movimientos` hoy son:
    `monto_positivo`, `tiene_contraparte` y `movimientos_ajuste_sentido_check`.
  - **V1.1.414 (sin publicar):** el error al borrar un gasto muestra el texto real (antes "[object Object]").
  - No se probó en local: las funciones nuevas no existen en la base hasta correr la migración, y probar anulaciones implica guardar.

El `git stash` "correcciones financieras a medias" es una copia **vieja** de este trabajo. No usarlo.

## 3. Tanda en curso, sin publicar (V1.1.414) — cobros con cheque (11/10/2026)

- **Código:** `lib/fecha-cobro.ts` (prueba `scripts/test-fecha-cobro.mjs`): el cobro va con la fecha en que se recibe; con cheque es hoy y
  la fecha del cheque queda en el cheque. Aviso (no bloqueo) si la fecha del cobro es futura. Aplicado en `cobro-masivo-liquidacion.tsx`
  y en el cobro simple de `facturacion-content.tsx`. En Finanzas > Cheques: "Rechazar" también para cheques depositados/cobrados,
  y "Eliminar" pasó a "Anular" (no borra).
- **Migración** `20261011150000_cobros_fecha_conciliado_nc_multiple.sql` (con vuelta atrás; respaldo en `lz_respaldo_correcciones`):
  fechas reales de los 3 cobros, cheque 00000131 con cliente, cheques atados a su cobro, NC 0015-00000005 de DEL SOL atada a FA 0015-00000039
  (antes figuraba como saldo a favor y restaba ventas), cobros nuevos nacen "pendientes de conciliar", función
  `crear_nota_credito_manual_venta_multiple` + tabla `nota_credito_venta_aplicaciones`.
- **Después de publicar:** Augusto rechaza los cheques 00000074 y 00000176 de Barraza desde Finanzas > Cheques.
  Cuando venga rechazado el 00000131: rechazarlo y correr `crm/app/supabase/operaciones/20261011_nc_barraza_0001_00000025.sql`
  (NC A 0001-00000025, CAE 86416795481784, $26.954.340,91, anula FA 15-10, 15-19 y 15-30).
- Chequeos: tipos 0 errores, hooks OK, tests fecha-cobro, cobros/cheques y saldo-clientes OK. No probado en pantalla (necesita sesión).

## 4. Pendiente (próximas tandas)

0. **PRÓXIMO: análisis a fondo de Finanzas** (lo más importante del CRM, pedido por Augusto 11/10/2026):
   - Cobros con eCheq guardados con **fecha futura** y ya "Conciliado": DEL SOL CONSTRUCTORA (20/11/2026, cobro $3.677.887,22 + ret. Ganancias $61.813,23)
     y cheque Galicia / BARRAZA JESICA PAOLA (16/10/2026, $10.110.492,35). Sospecha: el cobro toma la fecha de pago del eCheq en vez de la de recepción.
     Revisar cómo se arma la fecha al registrar cobros con cheque/eCheq, el impacto en caja y cómo corregir los ya cargados (sin borrar, con OK de Augusto).
   - Buscar otras reglas o datos de la base que no estén en el repo, y revisar el resto de los circuitos de Finanzas (caja, conciliación, saldos).
   - **Avance 11/10/2026:** causa encontrada en el código: al leer la OP del cliente con IA (`cobro-masivo-liquidacion.tsx` + `lib/orden-pago-plan.ts`),
     la fecha del cobro sale de `fecha_cobro` del eCheq (su vencimiento). La retención toma la misma fecha.
     Consulta de solo lectura lista para Augusto: `crm/app/supabase/diagnostico/revisar_finanzas_cobros.sql` (falta el resultado).
     Otros hallazgos: las OP nacen "conciliadas"; la caja suma cheques en cartera, cheques propios diferidos y tarjeta como plata del día;
     OC "pagada con tarjeta" no genera ningún pago; borrar un cheque es borrado físico.
   - **Resultado del diagnóstico (CSV 11/10/2026):** solo 3 movimientos con fecha futura: DEL SOL cheque 3881 + ret. Ganancias (fecha 20/11, cargados 30/09)
     y Barraza cheque 00000131 (fecha 16/10, cargado 18/09). `registrar_cobro_masivo` (hecha a mano) graba `conciliado = true` fijo;
     todos los cobros y pagos están "conciliados" y ninguno tiene línea de extracto. `saldos_caja` vacía. Cheque 00000131 sin `origen_id`
     (rechazarlo no encontraría el cobro). Funciones de finanzas hechas a mano y fuera del repo: registrar_cobro, registrar_cobro_masivo,
     recalcular_saldo_cliente/_proveedor/_for_cliente, recalcular_extracto, get_balance_projection, get_dashboard_kpis.
     El botón "Rechazar" cheque solo aparece si está "en cartera": los de Barraza 00000074 y 00000176 están "depositado".
   - **Barraza (estafa):** una sola NC hecha en ARCA anula las 3 facturas (FA 15-10, 15-19, 15-30). Orden: 1) rechazar los eCheqs (anula el cobro), 2) cargar cada NC con "NC manual" (sin ARCA) guardando el CAE en observaciones. Faltan los PDF de las NC.
     El 3er eCheq NO se rechaza todavía (decisión de Augusto): se rechaza cuando aparezca en el extracto; su NC se carga recién ahí.
   - **Idea de Augusto (11/10/2026):** Finanzas como centro de todo, enlazado con los extractos que él carga día a día:
     cuentas corrientes, cajas de ahorro, FCI, tarjetas y efectivo. Un cobro con cheque "se cobra" cuando el cheque se acredita.
0b. **Tests viejos que fallan** (ver punto 2): actualizarlos a cómo quedó el código.
1. **A5 Retención RG 830:** mínimo y escala por concepto (bienes, servicios, honorarios), unificar 224.000 vs 400.000 y no "congelar" en el Plan de pagos. Comparar con el archivo de Netegia que va a pasar Augusto y confirmar montos con el contador.
2. **Diagnóstico sin tocar:** D1 (cron cotización BNA, revisar lo que quedó), D4 (saldo inicial de caja automático), D5 (cuentas bancarias), D6 (errores sin revisar en Plan de pagos y Finanzas), sección E.
3. **Cheque vs echeq:** unificar en "Cheque" Físico / Electrónico en todas las pantallas y reglas claras para la IA. Falta un ejemplo de Augusto.
4. **Importar cheques** desde 01/01/2026: `ideas/cheques_desde_2026.csv` (695 cheques; 5 con año "2925" a corregir; los 15 de Martín Fernández aparte).
5. **"Para revisar"** (idea 8): mandar OC, clientes y proveedores a la Papelera; lleva migración. Incluye borrar OC con facturas vinculadas.
6. **Lista de costos dentro de Proveedores** (idea 9): fotos (`recursos/fotos_costos.zip`), rubro, marca y reglas por proveedor.
7. **Comisiones** (idea 1) y **Torneo** (idea 7): faltan respuestas de Augusto.
8. **Archivo BBVA Net Cash:** falta el formato del banco (el botón ya está, desactivado).
9. Otros: propuestas de `PROPUESTA-REPORTES-DASHBOARD.md`, centro de alertas unificado, descuento visible en el PDF del presupuesto, filtro por moneda en facturas de venta, revisar migraciones viejas de Manu.
10. **Seguridad:** rotar la clave de Anthropic y activar MFA en Supabase y Vercel.

## 5. Archivos que no están en git (a propósito)

- `ideas/cheques_desde_2026.csv`: datos de cheques reales.
- `recursos/fotos_costos.zip`: 9 MB de fotos.
- `Claude outputs/`: copias de la migración de V1.1.410 (ya está en `crm/app/supabase/migrations`).
