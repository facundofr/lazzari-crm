# Estado del proyecto — CRM Lazzari

Actualizado: 12/10/2026 · Versión publicada: **V1.1.424** (12/10/2026, commit d26c557)

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
  - **V1.1.414:** el error al borrar un gasto muestra el texto real (antes "[object Object]").
  - No se probó en local: las funciones nuevas no existen en la base hasta correr la migración, y probar anulaciones implica guardar.

El `git stash` "correcciones financieras a medias" es una copia **vieja** de este trabajo. No usarlo.

## 3. Publicado el 11/10/2026 (V1.1.414, commit bf8c19d), migración 20261011150000 ya corrida — cobros con cheque

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

## 3b. Publicado el 11/10/2026 (V1.1.415), migraciones 20261011160000 y 20261011170000 ya corridas

- Finanzas > Cheques: buscador (número, cliente, banco o importe), filtros por tipo y fecha de pago, "Limpiar filtros",
  cantidad y total de lo filtrado (`lib/cheques-filtro.ts`, prueba `scripts/test-cheques-filtro.mjs`).
- Rechazar cheque: modal con desplegable de motivos y "Otro…" para escribirlo (antes era una ventanita de texto).
- Augusto rechazó los cheques 00000074 y 00000176 de Barraza (11/10/2026).
- Factura con cheque rechazado se ve como **"Cheque rechazado"** (rojo) mientras siga sin cobrar, en Facturación (con filtro)
  y en CC Clientes (`lib/estado-factura-venta.ts`, prueba `scripts/test-estado-factura-venta.mjs`). En CC Clientes los cobros anulados dicen "Anulado".
- **Migración ya corrida (11/10/2026):** `20261011160000_facturas_cheque_rechazado.sql` (columnas `cheque_rechazado_at/_motivo`,
  marca FA 15-10 y 15-30 de Barraza, y `rechazar_cheque_recibido` las completa). Con vuelta atrás.
- Campana: las alertas del módulo "finanzas" se muestran siempre (las de Barraza existían, pero Augusto tiene apagado "seguimiento").
- **Cuentas y extractos, etapa 1 (hecha; migración ya corrida 11/10/2026, 10 cuentas verificadas):** `20261011170000_cuentas_financieras.sql` (+ vuelta atrás):
  tabla `cuentas_financieras` (solo super_admin/admin/administrativo), `cuenta_id` en movimientos y extractos_bancarios,
  trigger `lz_cuenta_sugerida_movimiento` (cuenta sugerida según el medio para lo nuevo; si falla, guarda sin cuenta)
  y carga de las 10 cuentas de Lazzari con saldos al 31/08/2026. Pestaña **"Cuentas"** primera y por defecto en Finanzas
  (`components/cuentas-financieras.tsx`): totales (disponible, cheques en cartera/depositados, comprometido en emitidos con vencimientos),
  aviso de movimientos sin cuenta desde el corte, acuerdo de la CC, editar/crear cuentas. Cálculo en `lib/saldo-cuentas.ts`
  (prueba `scripts/test-saldo-cuentas.mjs`). Sin la migración, la pestaña muestra "Falta correr la migración" (no rompe nada).
  Recuadro **"Sugerencias"** arriba (pedido de Augusto): CC en negativo → "Rescatá $X del FCI" para dejarla en 0 (redondeo a $1.000);
  en la CC principal también cubre los cheques propios a debitar en 7 días; si el FCI no alcanza, dice cuánto falta (`sugerenciasCuentas`).
  Es real recién con el extracto del día (etapa 2). Ideas siguientes: avisarlo en la campana; sugerir suscribir al FCI el sobrante.

## 3c. Publicado el 11/10/2026 (V1.1.416), migración 20261011180000 ya corrida — Cuentas y extractos, etapa 2

- **Migración ya corrida (11/10/2026):** `20261011180000_extractos_bbva.sql` (+ vuelta atrás en `rollback/`). Aditiva:
  columnas en `extracto_movimientos` (cuenta, saldo, clave sin duplicar, clasificación, cheque, cuenta contraria, nota),
  `saldo_banco`/`saldo_banco_fecha` en `cuentas_financieras`, tabla `extracto_reglas` ("Recordar"), `cubre_tercero`/`cubierto_at` en `echeqs`,
  y las funciones `importar_extracto_bbva`, `aplicar_cruces_extracto` (también deshace) y `completar_cheques_emitidos`.
  Sin la migración, Extractos y "Cheques Martín F." muestran "Falta correr la migración" (no rompe nada).
- **Finanzas > Extractos** (`components/extracto-bbva.tsx`, lógica en `lib/extracto-bbva.ts`, prueba `scripts/test-extracto-bbva.mjs`):
  subir el .xls del BBVA tal cual (cuenta por número del encabezado, solo desde el corte, no duplica, avisa saltos de saldo, resumen antes de guardar);
  cruce automático (cheques propios por número, cheque acreditado por importe, devueltos, impuestos/comisiones/SIRCREB, FCI, entre cuentas,
  efectivo, tarjetas, cobros y pagos por importe + fecha + CUIT); "Para revisar" con botones, candidatos y "Recordar"; cobros/pagos "a cargar"
  que se cruzan solos cuando se cargan; totales mensuales de gastos e impuestos del banco (1a); deshacer por línea.
  "Completar cheques emitidos": sube la planilla o los eCheq, agrega solo los que faltan (pagos desde 01/08 o sin pagar), completa números de
  cheques "CHQ-…", marca Martín, y pasa a debitados los que el banco pagó antes del corte y el CRM tenía "a pagar".
  Simulado con los Excel reales: de 522 líneas de la CC desde 01/09, 391 se clasifican solas sin mirar el CRM (161 cheques, impuestos, FCI…).
- **Cuentas:** con extracto, el saldo es el del banco + lo del CRM posterior ("Según el banco al…"); los pases a FCI/efectivo mueven esas cuentas.
  `lib/saldo-cuentas.ts` (prueba ampliada).
- **Finanzas > Cheques Martín F.** (`components/cheques-tercero.tsx`): pendientes, próximo débito, aviso (≤3 días), "Ya cubrió", copiar mensaje,
  agregar/sacar por N°. La campana avisa 3 días antes (cron diario `presupuestos-vencimiento`, módulo finanzas).
- **Pasos de Augusto después de publicar:** 1) Extractos → "Completar cheques emitidos" con `Cheques_Lazzari.xlsx` + los 3 eCheqs emitidos.
  2) Subir los Excel "(3)" (CC) y "(2)" (CA) del 11/10 → Guardar. 3) "Aplicar cruces". 4) Revisar el resto
  (Alesso: depósito 06/10 y transferencia 01/10 de $1.000.000 → Personal, nota "Juan Pablo Alesso").
- Chequeos: tipos 0 errores, hooks OK, tests extracto-bbva, saldo-cuentas y cheques-filtro OK. No probado en pantalla (necesita la migración).
- **Hecho por Augusto (11/10/2026):** "Completar cheques emitidos" → 339 cheques agregados (13 ya estaban; Martín marcado).
  Extractos guardados: CC 522 líneas y CA 41 (saldos al 09/10: −$1.575.636,31 y $295.614,01). Cruce: 435 automáticos
  (impuesto 168, cheque propio 161, gasto bancario 59, FCI 15, pago 9, entre cuentas 6, tarjeta 5, cobro 5, intereses 3, devuelto 2, acreditado 2)
  → **aplicados por Augusto (11/10/2026)**. Quedan **128 para revisar** (los resuelve él de a poco).
- **Próximo: conciliar cobros con las OP de clientes** (las OP llegan al Gmail **administracion@lazzari.com.ar**; conector de Gmail, solo lectura). 45 entradas al banco desde 01/09 parecen cobros (≈ $242.015.105,87; solo 5 cruzaron):
  lista en `Claude outputs/entradas_banco_sin_cobro_sept_oct_2026.csv` (cuenta;fecha;concepto;importe; "PAGO A PROVEEDORES OP.n" = OP del cliente vía BBVA).
  Augusto manda las OP de clientes (facturas + retenciones + neto) → armar por OP: cliente, facturas, retenciones y la línea del banco que le corresponde,
  para que él cargue el cobro (Facturación) y después "Aplicar cruces" lo enganche solo. No cargar cobros desde el chat.
  Idea de mejora: en "Para revisar", sugerir facturas abiertas del cliente cuyo saldo (neto de retenciones) coincida con la entrada.
  **Hecho 11/10/2026 (leyendo el Gmail de administracion@ en el navegador de la app, solo lectura):** tabla en
  `Claude outputs/cobros_identificados_gmail_sept_oct_2026.csv`: 15 cobros EXACTOS ($186.532.340,43: Corteva Seeds x8, Corteva Agriscience 40,6M,
  Synthon x2, Limagrain x2, Soychu, Adecco) con facturas y retenciones; 9 PROBABLES ($13,1M: SO Energy/Termocórdoba y Pedro Peregrini, PDF escaneados);
  03/09 $15.989.281,41 dudoso (¿Corteva Agriscience pago 31/08?, no cierra) y 4 sin aviso ($20M, incluye 29/09 $15.994.806,07).
  **Segunda búsqueda (por monto, Gmail lee los PDF escaneados):** 27 CONFIRMADOS ($232.993.760,33), incluidos SO Energy/Termocórdoba,
  Criper SA, Pedro Peregrini y Corteva Agriscience 03/09 y 29/09. Quedan: 15/09 $1.394.525,00 (solo en la doc de IVA de agosto del contador)
  y 11/09 $1.255.728,47 (sin rastro).
  **Resueltos con el home banking (11/10/2026):** 15/09 $1.394.525,00 = Logística Casadei SRL (30716804840); 11/09 $1.255.728,47 = Chacraservicios SRL (30708583819).
  → Los 29 ingresos del CSV tienen cliente.
  **Cobros aplicados por Claude en el CRM (11/10/2026, con OK de Augusto):** Corteva Seeds FA 16-1 ($294.483,93 + Gan 5.023,18 cert 4824 + IIBB 4.395,28 cert 6005, 07/10);
  SO Energy FA 15-6 (US$796,24 a TC 1530: $1.184.971,58 + Gan 15.656,33 cert 2590 + IIBB 17.619,29 cert 991, 05/10); Limagrain FA 16-5 (US$301,47 a TC 1520:
  $448.512,85 + IIBB 6.627,39 RB 25897 + Gan 3.094,16 RG 16589, 07/10; dif. cambio −$3.014,70 informativa). Las 3 quedaron "Pagada".
  Ya estaban pagadas: Termocórdoba FA 15-2/15-4/15-7, Criper 16-4, Peregrini 15-27, Chacraservicios 16-2 ($568.558,20 del 25/09). Adecco 05/10 = FA 8-667 (sistema anterior).
  "Aplicar 3 cruces" falló: "Anulá y registrá nuevamente la liquidación" (trigger `proteger_movimiento_fx` solo dejaba cambiar `conciliado`
  en movimientos de liquidaciones USD; el cruce también pone cuenta_id/conciliado_at/conciliado_por). No se guardó nada (todo o nada).
  **Arreglo:** migración `20261011190000_fx_conciliar_cuenta.sql` (+ vuelta atrás): permite esos 3 campos. Sin cambios de código ni publicar.
  **Hecho (11/10/2026):** migración corrida y "Aplicar 3 cruces" aplicado por Augusto.
  **Error a revisar:** "Registrar cobro" de FA 16-1 mostraba "Saldo pendiente $0,00" estando impaga (la CC sí la debía).
- **Idea de Augusto (11/10/2026) — tipo de cambio de cobros en USD:** se cancela con el TC que usó el cliente (pesos ÷ USD); se compara con BNA del día anterior al pago
  (divisa o billete según el cliente, dato en la ficha); si la diferencia supera un % (sugerido 2 %) → aviso "pedir actualización al cliente", nunca frena.
  Además: que el CRM guarde todos los días hábiles la cotización BNA divisa y billete (ya existe el cron `/api/cron/cotizacion`, revisar D1).
  Siguiente: Augusto carga esos cobros en Facturación (los que no estén) y aprieta "Aplicar cruces".

## 4. Pendiente (próximas tandas)

**Tanda V1.1.425 (13/10/2026) — Punto 6: PERMISOS POR ROL. PUBLICADA (commit db0e841). Migraciones 20261013100000 y 20261013110000 CORRIDAS: Mariana ya es administrativo. Falta: que Mariana y un vendedor la prueben (si algo falla, hay rollback).**
- **Cómo trabaja Lazzari (Augusto):** él ve y hace todo. Mariana = administrativa (plata y compras). Los vendedores también compran
  (pedidos, OC, mandarlas, recibir mercadería, cargar facturas de proveedores), llevan muestras, transportes y personalización, y NO pagan.
  Todos ven, crean, editan y eliminan clientes y proveedores; eliminar pide motivo que queda guardado. Manu: NO desactivarlo por ahora.
- **Migración 1 `20261013100000_permisos_por_rol.sql`** (+ vuelta atrás, probada): escribir órdenes de pago, aplicaciones de cobros, eCheqs,
  saldos de caja, movimientos, retenciones y plantillas de mail = solo super_admin/admin/administrativo (leer sigue igual). Gastos manuales:
  crear también vendedores (factura "solo IVA"). Rol administrativo: gastos fijos, crear presupuestos, notificaciones, configuración, plantillas.
  Tabla nueva `registros_eliminados` + funciones `eliminar_cliente` / `eliminar_proveedor` (con historial → se desactiva, sin historial → se borra;
  siempre guarda copia, motivo, quién y cuándo). `registrar_factura_compra_con_oc_extra` acepta vendedores (antes los trababa).
  No se tocó: CAI de remitos (`next_cai_number` escribe `cai_config` con el usuario; es de ARCA), muestras, transportes, personalización, numeración.
  Las 7 funciones de plata ya pedían administración (`lz_puede_operar_finanzas`). Prueba: `scripts/db/pruebas/permisos_por_rol.sql` (35 de 35 OK).
- **Migración 2 `20261013110000_mariana_administrativa.sql`** (+ vuelta atrás): Mariana pasa a administrativa. Correrla DESPUÉS de publicar.
- **App:** `components/eliminar-con-motivo.tsx` (ventanita) en Clientes y Proveedores; proveedores: vendedores crean/editan/eliminan;
  `ROLE_PERMISSIONS` (vendedor: clientes y proveedores completos; administrativo: crear/eliminar clientes, eliminar proveedores, Configuración,
  sin borrar presupuestos); Finanzas: el administrativo puede lo que antes era "solo administrador" (borrar movimientos, ajustes manuales);
  Dashboard: cobertura de gastos fijos también para administrativo; Configuración: pestaña Comisiones solo super_admin/admin.
  tsc 0 errores, hooks OK, probado en local sin guardar (ventanita en Clientes y Proveedores, aviso "Falta correr la migración", Configuración).
- **Pantalla nueva "Facturas"** (`/consulta-facturas`, menú debajo de Ventas, todos los roles; módulo `consulta_facturas`): SOLO LECTURA.
  De venta: buscar (cliente, CUIT, número, PR, OC del cliente), detalle con renglones, CAE y envío, "Ver / bajar PDF" y "Reenviar al cliente"
  (mail con el PDF; la marca de envío la guarda la función nueva `marcar_factura_enviada`, en la migración 1). De compra: buscar (proveedor,
  CUIT, número, OC), detalle con renglones, todas sus OC y "Ver factura del proveedor" (archivo). No emite, no cobra, no paga, no anula.
  No se tocó Facturación (ARCA). Datos del emisor del PDF en `lib/emisor-sociedad.ts` (copia de `emisorData` de Facturación: si cambian, cambiar los dos).
  Probado en local sin guardar ni enviar (101 de venta / 82 de compra en Lazzari; PDF, ventanita de mail cancelada, detalle de compra).
  Prueba de la base: 39 de 39 OK (el vendedor ve las facturas, no las puede cambiar, sí marcar el envío).
- **Para publicar, en orden:** correr migración 1 → publicar V1.1.425 → correr migración 2 → Mariana prueba (si algo no le anda: vuelta atrás 2).
- **Calendario por rol:** queda para más adelante (pedido de Augusto). Hoy un administrativo solo edita/borra sus propios eventos.
- Sugerencia futura: mostrar los clientes/proveedores eliminados (con motivo) en la Papelera.

**Tanda V1.1.418 (12/10/2026) — PUBLICADA (commit 6d75961), migraciones 20261012100000 y 20261012110000 ya corridas por Augusto. Plan y estudio: `docs/ESTUDIO-Y-PLAN-12-10-2026.md`.**
- **Pestaña Revisar** (Finanzas > Hoy): `components/finanzas-revisar.tsx`, lógica `lib/revisar-finanzas.ts` (prueba `scripts/test-revisar-finanzas.mjs`).
  A) lo anotado (tabla nueva `finanzas_revisar`: motivo, nota, "Recordarme el", Resuelto con nota, Posponer, Volver a pendiente; no se borra nada);
  B) lo que encuentra el sistema (movimientos con fecha futura, cheques recibidos en cartera vencidos hace +3 días, líneas del extracto sin cruzar).
  Botón "Dejar para revisar" (`components/dejar-revisar.tsx`) en: detalle de cheque, orden de pago, factura de compra, factura de venta y cada línea "Para revisar" del extracto.
  La campana avisa el día de "Recordarme el" (cron `presupuestos-vencimiento`). Sin la migración muestra "Falta correr la migración" y no rompe.
  **Migración nueva:** `20261012100000_finanzas_revisar.sql` (+ vuelta atrás). Aditiva, una tabla, sin DELETE.
- **Cobro masivo con diferencia** (`cobro-masivo-liquidacion.tsx`, reparto en `lib/cobro-reparto.ts`, prueba `scripts/test-cobro-reparto.mjs`):
  Confirmar ya no se traba; cuadro amarillo con cómo queda cada factura (más vieja primero, el saldo queda en la más nueva); antes de guardar avisa y pregunta;
  casilla "Dejar en Revisar" (tildada) anota la diferencia. Las facturas se mandan a la base ordenadas de la más vieja a la más nueva.
  Probado en local SIN guardar con Del Sol (eCheq $6.210.728,30 vs 5 facturas $6.463.222,05): FA 15-54 queda con $252.493,75.
  **Función de la base leída (12/10/2026):** `registrar_cobro_masivo` reparte EN PROPORCIÓN al "saldo" que recibe y la última se lleva el resto
  (copia en `supabase/diagnostico/registrar_cobro_masivo_actual.sql`). Por eso la pantalla manda a cada factura lo que le toca y deja afuera las que no reciben nada
  (`facturasParaRegistrar`, simulado en la prueba): **no hace falta migración** para dejar el saldo en la más nueva. Si sobra plata, la base se lo aplica a la última (queda a favor en la CC).
  Ojo: la base solo acepta facturas "emitida" o "parcial" (una "vencida" da error al cobrar en masa). Revisar.
  **"Diferencia a la cuenta corriente" (OK de Augusto 12/10, HECHO en código):** en el cobro masivo con faltante (solo facturas en pesos) se elige
  "Saldo en la factura más nueva" o "Diferencia a la cuenta corriente": las facturas quedan pagadas y la diferencia queda como deuda suelta del cliente.
  **Migración nueva:** `20261012110000_cobro_diferencia_cc.sql` (+ vuelta atrás): función `registrar_cobro_masivo_diferencia_cc` (llama a la segura de siempre con un
  renglón "ajuste" que cierra las facturas y graba un ajuste `ajuste_sentido = 'debito'` en la CC; todo junto; doble clic no duplica). Sin la migración avisa y se usa la otra opción.
  **Saldo de clientes unificado:** `lib/saldo-clientes.ts` ahora suma los ajustes de CC sin factura (débito = deuda, crédito = a favor). Antes solo Finanzas > CC Clientes los sumaba;
  el listado de Clientes, Facturación y Ficha 360 no (daban otro número si había ajustes manuales). Prueba `test-saldo-clientes.ts` ampliada.
  Probado en local SIN guardar (Del Sol): las dos opciones se ven y explican bien.
  ⚠️ Si sobra plata, la base se lo suma a la última factura y hoy NO se ve como saldo a favor (el saldo por factura no baja de 0). El cartel ahora lo dice; queda en Revisar. Resolver más adelante.
  **Respuestas de Augusto para "Liquidar servicios":** internos = independientes, se les paga por viaje; liquidación mensual pero a veces piden cobrar antes (liquidar cuando quiera);
  sin adelantos; pagos variados (transferencia, eCheq, efectivo); algunos sin CUIT; el flete a veces se le cobra al cliente, pero mezclado en los precios o con un renglón "Envío"
  (no sirve "facturar el flete"). El flete es proporcional, no hay monto fijo por entrega; algunos clientes no quieren ver "Envío".
  **Acordado (12/10):** cada viaje atado a su venta (por remito o eligiéndola); renglón "Envío/flete/traslado/entrega" del presupuesto = flete cobrado explícito;
  en la venta: margen antes y después del flete real (si el flete estaba metido en los precios, se ve si el precio lo cubrió); reporte "Fletes del mes" por cliente.
  Sin campo de "flete incluido" por ahora (no hay monto fijo); se suma solo si hace falta.
- Visto de paso: en "Cobro masivo — Selección de facturas" de Del Sol aparece la **NCA 0015-5** ($1.242.839,98) como pendiente de cobro (no debería listar NC). Revisar.
- **Decisiones de Augusto sobre mejoras (12/10/2026)** — lista en el chat:
  Transportes: **A** (el viaje se arma desde el remito: "¿Quién lo lleva?") y **E** (liquidación del mes armada sola) = OK; **B** (salida con varias paradas) DESCARTADA; C y D no elegidas.
  Pidió más info de: 2 (Esperando OC del cliente), 3 (margen real por venta), 4 (presupuestos que se enfrían), 5 (proyección de caja 30/60/90), 6 (un solo número de plata disponible), 12 (bandeja única de avisos), 15 (pruebas viejas).
  Le sirven: 7 (cobros sugeridos desde el extracto), 9 (cobro masivo con facturas vencidas), 11 (Mercado Libre → Visa), 13 (ficha "cómo paga"), 14 (Finanzas más rápida), 16 (anular en vez de borrar).
  10 (retención Ganancias por tipo): espera al contador el martes 13/10. 17 (seguridad): proponerlo más adelante.
- **Clientes que piden OC para facturar (dato de Augusto 12/10/2026):** Synthon, Corteva Agriscience, Corteva Seeds, Adecco, Termocórdoba, SO Energy.
  Del Sol manda OC pero no es imprescindible. (Cargar la marca "Pide OC para facturar" cuando se haga el punto 2; lleva migración.)
- **Presupuestos que se enfrían (punto 4), gustos de Augusto:** mensaje amigable ("Hola Juan, ¿cómo estás? ¿Pudiste ver el PR N° …?");
  estados Aprobado / Rechazado (no "ganado/perdido"); dentro de Rechazado, opción "Postergado". No pide adelantos a clientes.
- **Margen real por venta (punto 3):** más adelante; revisar los "costos" que Augusto ya puso al armar un PR y ordenarlos.
- **Prioridad de Augusto (12/10/2026): ARREGLAR LO ROTO primero**, de a un tema por vez y a fondo, empezando por las funciones viejas de Manu.
  Paso 1 HECHO: Augusto corrió `supabase/diagnostico/todas_las_funciones.sql`; el resultado está en
  `C:\Users\lazza\Downloads\Supabase Snippet Untitled query (5).csv` (98 funciones + triggers, una sola fila; leerlo por partes, pesa 270 KB).
  **PRÓXIMO:** comparar esas funciones con `crm/app/supabase/migrations`, listar las hechas a mano y lo roto (ordenado por gravedad, en palabras simples)
  y arreglar de a un tema por vez con OK de Augusto. Ya conocidos: `registrar_cobro_masivo` no acepta facturas "vencida"; el pago de más se pierde
  (no queda a favor); Caja/Balance (`get_balance_projection`) y Dashboard (`get_dashboard_kpis`) calculan distinto que Cuentas; 13 de 59 pruebas fallan.
  **Paso 2 HECHO (12/10/2026): comparación.** 99 funciones en la base: 63 iguales al repo, 3 con diferencias menores, 36 hechas a mano (no están en el repo).
  Diferencias: `crear_presupuesto_atomico` en la base graba como operador el `created_by` que manda la pantalla (el repo usa el usuario logueado);
  `conciliar_extracto_movimiento` y `anular_liquidacion_fx` = solo formato / la base es más estricta (OK).
  Ojo: `registrar_cobro` y `registrar_cobro_masivo` (de Manu) SIGUEN EN USO: las llaman `registrar_cobro_seguro` / `registrar_cobro_masivo_seguro`.
  Lista de lo roto entregada a Augusto, por gravedad: 1) `handle_new_user` toma el rol que manda quien se registra (si el registro público
  de Supabase está abierto, cualquiera entra como super_admin); 2) `registrar_cobro_masivo` reparte proporcional, el pago de más queda dentro de la última
  factura (no a favor), rechaza "vencida", usa el saldo que manda la pantalla, liga todas las aplicaciones al primer medio, moneda de la última factura;
  `registrar_cobro` también rechaza "vencida"; 3) trigger `recalcular_oc` pone IVA 21 % fijo a toda la OC en cada cambio de renglón (también al recibir):
  rompe OC de PR manual (IVA 0) y renglones al 10,5 %; 4) `get_balance_projection` (Finanzas → Balance) no cuenta facturas "parcial"/"vencida",
  usa el total y no el saldo, ignora el vencimiento real; 5) `get_dashboard_kpis` suma ARS + USD juntos y NC como venta, "pendiente de cobro" solo "emitida";
  6) funciones con permiso total sin chequear sociedad/rol (`increment_stock`, `change_pr_operator`, `registrar_cobro*` directas, `get_*` con sociedad vacía);
  7) menores: `auto_estado_oc` revive OC canceladas, alertas sin sociedad (`check_stock_bajo`, `presupuesto_estado_alert`), `generate_document_number`
  con dos versiones (la de 2 datos es una trampa), `next_cai_number` gasta el número aunque el remito falle, saldos guardados en
  `clientes/proveedores.saldo_cuenta_corriente` mal calculados (la app no los usa). **Esperando OK de Augusto para arreglar de a uno, empezando por el 1.**
  **Punto 1 (usuarios) HECHO EN CÓDIGO, SIN PUBLICAR (V1.1.419), con OK de Augusto:** Augusto es el único super_admin y el único que invita/maneja usuarios.
  Hallazgos: "Allow new users to sign up" estaba PRENDIDO en Supabase (se le pidió apagarlo); la regla `profiles_update_own` dejaba que cualquiera
  se cambie el rol; los admin podían invitar y cambiar roles. Migración `20261012120000_usuarios_solo_superadmin.sql` (+ rollback): `handle_new_user`
  siempre "viewer", disparadores que solo dejan al super_admin (o al servidor/SQL Editor) cambiar rol/activo/email y `user_sociedades`.
  Código: `/api/invite` y `/api/users` solo super_admin; dar de baja ya NO borra el usuario (solo inactivo + bloqueado); Configuración muestra
  la gestión de usuarios solo al super_admin. Laura: tiene 1 movimiento y 15 actividades → baja sin borrar con
  `supabase/diagnostico/baja_laura_12_10_2026.sql` (+ vuelta atrás). **12/10/2026: Augusto apagó el registro público, corrió la migración
  20261012120000 (Success) y la baja de Laura (listo).** José Alvarez es vendedor que NO usa el sistema (solo para asignarle PR y ventas):
  se propuso bloquearle solo la entrada (sin tocar su ficha); falta OK. Falta que diga qué hacer con Manu.
  **OK de Augusto a todo (12/10/2026).** Scripts listos para que los corra: `diagnostico/bloquear_entrada_jose_12_10_2026.sql` (solo entrada),
  `diagnostico/baja_manu_12_10_2026.sql` (baja sin borrar), `diagnostico/laura_pasar_a_mariana_y_borrar_12_10_2026.sql` (su movimiento y
  actividad pasan a Mariana con marca `pasado_de` y se BORRA el usuario; sin vuelta atrás). Pedido: "nadie que yo no invite entra, ni a mirar":
  migración `20261012130000_usuarios_nuevos_inactivos.sql` (+ rollback; usuario nuevo nace inactivo, la invitación del CRM lo activa) y
  middleware: sin ficha o inactivo → afuera. Probado en local: Configuración carga con Augusto.
  **CORRIDO por Augusto (12/10/2026):** José bloqueado (vendedor, activo, entrada bloqueada hasta 2126), Laura borrada (15 actividades a Mariana),
  migración 20261012130000 OK. **Manu NO se dio de baja (decisión de Augusto: que pueda entrar por si hace falta);** `baja_manu_12_10_2026.sql` queda sin usar.
  Roles según Augusto: Jero y Seba vendedores, Mariana administradora (falta confirmar si en la base es "admin" o "administrativo"
  con `diagnostico/estado_usuarios.sql`), rol de Manu sin confirmar.
  **PUNTO 1 TERMINADO.** El código (api/invite, api/users, configuración, middleware) sale en la próxima publicación (V1.1.419).
  **Punto 2 (cobros) HECHO EN CÓDIGO, SIN PUBLICAR (V1.1.419), con OK de Augusto (12/10/2026; pago de más → saldo a favor en la CC del cliente).**
  Migración `20261012140000_cobros_corregidos.sql` (+ rollback que deja las funciones de Manu textuales): reescribe `registrar_cobro` y
  `registrar_cobro_masivo` con los mismos parámetros (las `_seguro` y `registrar_cobro_masivo_diferencia_cc` no cambian). Ahora: acepta "vencida";
  lo cobrado se calcula como `gestionar_cobro` (sin anulados ni dobles) con la ayuda nueva `lz_cobrado_factura`; el masivo calcula el saldo real
  y reparte de la más vieja a la más nueva, **cada medio y cada retención con sus propias `cobro_aplicaciones`** (antes todo al primer medio:
  si rebotaba otro cheque la factura seguía pagada); **pago de más = movimiento `ajuste` con `ajuste_sentido='credito'`** atado al cobro por la
  columna nueva `movimientos.cobro_origen_id`; disparador `lz_anular_a_favor_de_cobro`: si ese cobro se anula o se borra, el saldo a favor se anula solo.
  No se mezclan ARS y USD (error claro). **USD masivo:** la pantalla ahora manda `tipo_cambio` en medios y retenciones; los movimientos quedan en ARS
  y lo aplicado en USD (antes grababa los pesos como dólares). Sin TC → error claro. Cobro simple: lo que sobra también queda a favor.
  Pantalla: textos de "sobran" (masivo, Revisar y cobro simple) dicen que queda a favor. Probado en un Postgres de juguete (PGlite) con datos
  inventados: 10 casos OK (justo, de menos, de más, cheque rebotado, borrado, vencida, USD, mezcla, diferencia a CC, doble clic, vuelta atrás).
  tsc 0, check-hooks OK, test-cobro-reparto y test-cobros-cheques-atomicos OK. Finanzas carga en local.
  **Orden al publicar: primero la migración 20261012140000, después el código** (si no, un cobro masivo en USD daría "falta el tipo de cambio").
  **Falta que Augusto corra (solo lectura):** `supabase/diagnostico/cobros_revisar_12_10_2026.sql` → lista cobros viejos atados a un solo medio,
  facturas cobradas de más (sobrante escondido), cobros USD grabados en pesos y cuántas facturas tienen "vencida" en la base. Con eso se decide
  qué corregir de lo viejo, de a uno y con OK.
  **Resultado de la revisión (12/10/2026):** 0 cobros USD en pesos, 0 facturas cobradas de más, 0 "vencida" en la base. 2 cobros con las
  retenciones colgadas del medio: DEL SOL cheque 3881 (30/09, $3.677.887,22 aplicado $3.739.700,45) y TERMO CORDOBA transferencia
  (05/10, $181.135,41 aplicado $186.340). Script listo, ESPERANDO OK: `diagnostico/corregir_cobros_atados_12_10_2026.sql` (+ `_vuelta_atras`):
  pasa cada retención a su propia aplicación sin cambiar lo cobrado por factura; se corta sin cambiar nada si no coincide al centavo;
  respaldo en `lz_respaldo_correcciones`. Probado en PGlite (corrige, 2.ª vez no hace nada, vuelta atrás deja igual).
  **CORRIDO por Augusto con OK (12/10/2026):** 5 renglones, todos con monto = aplicado (DEL SOL cheque + Ganancias; TERMO transferencia +
  Ganancias $2.509,59 + IIBB $2.695). **PUNTO 2 TERMINADO.** Falta solo publicar (migración 20261012140000 primero, después el código).
  **Resumen económico en Finanzas → Hoy → Cuentas (12/10/2026, pedido de Augusto, V1.1.419 sin publicar, sin migración):** se sacaron los botones
  "Caja" (saldo inicial a mano, repetía las cuentas) y "Balance" (usaba `get_balance_projection`, mal: ya no se llama). En su lugar, arriba de las
  cuentas: "Resumen: cómo estoy hoy" → Lo que tengo (disponible, cheques en cartera + depositados, a cobrar = CC clientes neto, vendido sin
  facturar = PR aprobados/facturar sin factura, apagado de entrada) − Lo que debo (cheques emitidos, a pagar = CC proveedores neto, deudas =
  `lineas_credito.monto_utilizado`) = posición neta, ARS y USD aparte + todo en pesos con BNA divisa. "Elegir qué ver": casillas guardadas en
  localStorage de la compu. Cálculo puro `lib/resumen-economico.ts` (prueba `scripts/test-resumen-economico.mjs` OK), componente
  `components/resumen-economico.tsx`, `CuentasFinancieras` acepta `resumen` (reemplaza los 4 recuadros). Probado en local: posición neta
  $1.416.070,25 + US$ 39.774,43 (todo en pesos $61.753.880,56). Tarjetas de crédito: el sistema todavía no tiene su deuda como número
  (`deudaTarjetas` siempre 0; solo nota en la cuenta) → sumarla cuando se carguen los resúmenes. Quedan en el código (sin uso) los cálculos viejos de Caja.
  **TANDA V1.1.419 PUBLICADA (12/10/2026, commit 66166a2, vercel --prod Ready), con la migración 20261012140000 ya corrida por Augusto (Success).**
  **Punto 3 (`recalcular_oc`) HECHO Y MIGRACIÓN `20261012150000_recalcular_oc_iva.sql` CORRIDA (12/10/2026, verificado: 125 de 125 OC bien)** (rollback en `supabase/rollback/`).
  Nueva regla: IVA por renglón (`iva_porcentaje`, sin dato = 21 %, redondeo por renglón como la pantalla); PR manual → 0; OC que ya estaba
  sin IVA → sigue sin IVA; recepción (`cantidad_recibida`) no recalcula. Corrige OC de Lazzari (todas recibida), confirmado contra la factura
  del proveedor: 1160/1166/1184/1194 (PR manual) y 1112/1142/1148 (FC sin IVA) → IVA 0; 1059/1216 → IVA por renglón 10,5 %. Respaldo en
  `lz_backup_oc_iva_20261012`. OC-2026-1173 (con OK de Augusto): su factura vino al 21 % y los renglones decían 10,5 % → renglones pasan a 21 %
  (10 OC en total). Después de correrla, verificar con `node scripts/lectura/oc-iva.cjs` (tiene que dar 0 con diferencias).
  Simulación (`scripts/lectura/oc-iva-simular.cjs`): las otras 113 OC no cambian; 1104 y 1199 diferirían 3 centavos si se edita un renglón.
  No cambia la app ni la versión.
  **Punto 5 (`get_dashboard_kpis`) HECHO Y MIGRACIÓN `20261012240000_dashboard_kpis_monedas.sql` CORRIDA (12/10/2026)** (rollback = la función
  vieja copiada de la base). Ventas/facturado/cobranzas del mes y pendiente de cobro: ARS solo en las claves de siempre, USD en claves nuevas `_usd`;
  NC restan (sin anuladas ni NC de factura anulada); pendiente = saldo real por factura (total − NC aplicadas − cobrado, como Facturación);
  cobranzas sin anulados; mes según hora de Argentina. Probado antes sin guardar: coincide al centavo con `lib/reportes-comprobantes` y
  `lib/saldo-clientes` en las dos sociedades (Lazzari oct $8.881.926,69 / US$8.228,31; pendiente $48.401.672,76 / US$45.323,02).
  Dashboard en producción OK. La pantalla ya calculaba bien el facturado por su cuenta (no mostraba los números rotos), así que no cambia la app
  ni la versión. Queda la versión vieja `get_dashboard_kpis()` sin sociedad (nadie la usa; va con el punto 6).
  **Forma de trabajo nueva (12/10/2026):** las lecturas de la base las corre Claude con scripts de SOLO LECTURA en `crm/app/scripts/lectura/`
  (permiso agregado en `.claude/settings.local.json`); Augusto aprueba listas numeradas en bloque. Regla: si cambia el costo de una OC,
  se actualiza el costo en el PR de origen.
  **TANDA V1.1.420 PUBLICADA (12/10/2026, commit 2c97f12, vercel --prod Ready), con OK de Augusto ("todo"). Migración `20261012160000_oc_estados.sql` CORRIDA por Claude con `scripts/db/migrar.cjs`** (rollback en `supabase/rollback/`).
  Verificado después: pago = 56 pagadas por facturas + 12 tarjeta + 57 pendientes; facturación = 64 facturada, 4 parcial, 57 sin factura;
  IVA 125/125 bien; las 3 "recibida" con 0 ya están completas. Quedan "pendiente" con todas sus facturas pagadas solo las que están
  facturadas en parte (1062, 1088, 1180, 1199) y la cancelada 1043: es la regla (pagada = facturada completa y todo pagado).
  **Revisión de estados de OC (12/10/2026, `scripts/lectura/oc-estados.cjs`):** 125 OC: enviada 40, recibida 81, recibida_parcial 3, cancelada 1.
  `estado_facturacion` y `estado_pago` casi nunca se actualizan solos: 60 OC facturadas completas con `estado_facturacion` vacío y 61 con
  todas sus facturas pagadas pero `estado_pago` = pendiente (la pantalla de OC lo calcula bien desde las facturas, los campos guardados no).
  17 OC "enviada" ya tienen factura (nadie registró la recepción); 3 "recibida" con 0 recibido (1134, 1130, 1173); OC-1043 cancelada con
  recepción completa y factura. OC-1043: queda para que la revisen los vendedores (no se toca).
  Qué tiene la tanda: (1) migración: `estado_facturacion`/`estado_pago` de la OC se completan SOLOS con disparadores en `facturas_compra`
  y `factura_compra_ocs` (`lz_actualizar_fact_pago_oc`; pagada por facturas = `medio_pago` 'facturas', `pagada_at` = fecha de la última OP;
  tarjeta y canceladas no se tocan) + corrige todas las OC (respaldo `lz_backup_oc_estados_20261012`); `auto_estado_oc` no revive canceladas;
  OC-1130/1134/1173 recibidas completas (sin stock, son pedidos de PR); 3 centavos de OC-1104/1199. (2) Compras: filtro "A reclamar" (pagada y
  sin recibir), cartel "Pagada · reclamar", avisos de atraso (pagada > 7 días sin recibir, sin recibir > 30 días; `lib/oc-reclamos.ts`, prueba
  `scripts/test-oc-reclamos.mjs` OK); en el detalle de la OC, "Órdenes de pago" con "Descargar OP" y certificado de retención
  (`lib/orden-pago-pdf.ts`, mismo PDF que Finanzas). Editar la OC no pisa el pago automático. Probado en local sin guardar (16 a reclamar,
  OP de OC-1199 descargada). Los vendedores ya pueden leer `ordenes_pago`/`op_facturas_compra` (no hizo falta regla nueva).
  SEGURIDAD HECHO (12/10/2026, migración `20261012170000_cerrar_tablas_sin_login.sql` CORRIDA por Claude, rollback en `supabase/rollback/`):
  las reglas `public`+`true` de ordenes_pago, op_facturas_compra, cobro_aplicaciones, echeqs, email_templates, gastos_manuales y saldos_caja
  pasan a `authenticated` (sin login ya no se ve ni se toca nada: probado con `scripts/lectura/probar-anonimo.cjs`; logueado sigue igual,
  probado en local). Queda abierta a propósito `cotizaciones_dolar` (anon inserta/actualiza: la usa la carga del dólar).
  Pendiente punto 6: afinar por rol (hoy cualquier logueado puede todo en esas tablas).
  ⚠️ Augusto pegó el `.env.local` completo en el chat (12/10/2026): conviene cambiar la clave de Anthropic y, con cuidado (toca Vercel),
  la `service_role` de Supabase. La contraseña de la base ya se regeneró.
  **OC con diferencia (12/10/2026, OK de Augusto "dale 1 a 5", va en V1.1.420). Migración `20261012180000_oc_diferencias.sql` CORRIDA**
  (probada antes con `migrar.cjs --probar scripts/db/pruebas/oc_diferencias.sql`, que deshace todo). Agrega `diagnostico_diferencia_oc`,
  `ajustar_oc_a_factura` (precios de la OC × factura neta / OC neta, IVA de la factura si es 21/10,5/0, costo al PR con la misma búsqueda y
  cuenta de margen que la conciliación; guarda lo anterior en `lz_oc_ajustes`), `deshacer_ajuste_oc`, y disparador al cerrar/reabrir saldo
  (recalcula pago y avisa al vendedor del PR en `alertas`). Pantalla: filtro "Con diferencia" (hoy 4: OC-1062, 1088, 1180 por precio;
  OC-1199 faltan 2 unidades) y cartel amarillo en el detalle con "Ajustar OC a la factura" / "Cerrar: no entrega el resto" (sugerida
  marcada, `lib/oc-diferencia.ts`, prueba `scripts/test-oc-diferencia.mjs` OK) y "Deshacer ajuste". Las 4 OC NO se tocaron: las decide Augusto.
  **Acceso directo a la base (OK de Augusto):** `pg` instalado (dev); `scripts/lectura/sql.cjs` (consulta en transacción READ ONLY) y
  `scripts/db/migrar.cjs` (corre UN archivo de migración/rollback en transacción; solo con OK de Augusto; `--probar <scripts/db/pruebas/x.sql>` corre y deshace). Necesitan `SUPABASE_DB_URL` en
  `.env.local` (ya cargada; permisos en `.claude/settings.local.json`: lectura y `migrar.cjs`). Claude corre las migraciones que Augusto aprueba.
  **Carga de facturas de compra contra OC más fácil — PUBLICADO V1.1.421 (12/10/2026, commit 56b6c2f, sin migración).** OK de Augusto al plan 1-9:
  (1-3) motor `lib/purchase-matching.ts`: código tolerante (`mismoCodigo`: ceros adelante, guiones, talle pegado; nunca otro talle) y paso
  nuevo "parecido" (`puntajeParecido`: nombre hasta 50 + misma cantidad que lo pendiente 35 + precio 15/5; mínimo 40; la cantidad sola no
  alcanza, hace falta una palabra en común; siempre amarillo, se aprende al confirmar). La carga individual (`cargar-factura-oc.tsx`) usa
  las mismas reglas (y la IA igual revisa lo propuesto por parecido). (4) "Facturado de más" (`sinAsignar.tipo = "de_mas"`, amarillo) ≠ "sin OC"
  (rojo); las rojas ya no frenan el confirmar. Lo que vino sin OC o de más va a una **OC complementaria** creada y atada a la factura
  (casilla marcada; si falla el guardado, la OC queda cancelada, no se borra); "Aceptar de más en la OC-x" la deja en la misma OC.
  (5-6) conciliación: concilia sola al abrir, arranca mostrando solo lo que no cierra ("N renglones cierran solos — Ver todo"), botones
  "Es este, OK" / "Aceptar precio" / "A reclamar" (queda en notas de la FC) / "Fuera de OC" y "¿Es este? OC-x … Asignar" en las rojas.
  (7) la IA lee `referencias_oc` (N° de nuestra OC impreso en la factura) y el motor prefiere esa OC (`citaOc`, `ocPreferidas`).
  (8) carga masiva: al terminar de leer cruza sola cada proveedor (análisis en `lib/conciliacion-compras-analisis.ts`, compartido con la
  pantalla), muestra "Cierra con las OC" / "N para revisar" y el botón "Confirmar las que cierran" (abre cada una con `autoConfirmar` y la
  guarda sola si todo está en verde; las demás quedan abiertas mostrando solo lo que no cierra). Varias facturas de la misma OC: se
  reparten contra lo pendiente. (9) pruebas: `scripts/test-purchase-parecidos.cjs` y `test-purchase-matching.cjs` OK; lectura
  `scripts/lectura/probar-parecidos.cjs` con las 3 FC reales conciliadas, sin IA: 29 propuestas por parecido, 0 erradas; sin cruzar 129 → 10 u.
  tsc 0 errores, hooks OK; en local abren conciliación y carga masiva sin errores. NO probado guardando (base real): probar al publicar con una
  factura real. "Cerrar saldo" de lo que falta sigue en el detalle de la OC (no se duplicó en la conciliación).
  **Enviar OC al proveedor — PUBLICADO en la misma V1.1.421 (12/10/2026).** Pedido de Augusto:
  al aprobar un PR se propone sola la ventana `components/enviar-oc-proveedor.tsx` con sus OC con proveedor aún no pedidas (sugerencia,
  "Después" la cierra). Por OC: WhatsApp (wa.me con la OC escrita), Mail con PDF (`EmailComposeModal`), Copiar y PDF. Toma el WhatsApp
  y mail del contacto principal del proveedor (`contactos` entity_type proveedor; si no, teléfono/mail del proveedor); si falta o se
  cambia, botón "Guardar en el proveedor" (actualiza el contacto principal o crea "Compras"). Al enviar por WhatsApp o mail marca la
  OC como pedida (`pedido = true`, con "deshacer"). También botón "Enviar" en cada fila y en el detalle de Compras.
  Aviso "IMPORTANTE: por favor indicar el N° de orden de compra X en la factura (y en el remito)" en el PDF (recuadro arriba de los
  renglones), en WhatsApp/copiar y en el mail (`lib/oc-envio.ts`). Con eso la IA lee `referencias_oc` y cruza la factura con su OC.
  Probado en local: la ventana abre y arma todo sin errores; NO se envió nada.
  **V1.1.421 publicada por Augusto (12/10/2026, Vercel Ready, se ve "V1.1.421").** Probado por Claude en producción: la ventana "Enviar OC" abre
  (OC-1224 Prisina: mail cargado, WhatsApp vacío porque el proveedor no tiene teléfono, aviso del N° de OC) y se cerró SIN enviar.
  **Falta:** cargar una factura de compra real contra su OC (necesita el PDF de Augusto; guarda datos reales → avisar antes).
  **Tanda V1.1.422 (12/10/2026, OK de Augusto "Va 1 a 4") — PUBLICADA por Claude (commit 680e1f9, Vercel Ready), migración CORRIDA.**
  Probado en producción: "Abiertas 77 / Todas 125 / Completas 47", tarjeta A reclamar, y el cartel de OC-1199 dice
  "Facturado y pagado $2.340.164,27 de $2.412.764,36. Diferencia $72.600,09 (3 %). Faltan facturar 2 unidades".
  **Tanda V1.1.423 (12/10/2026) — PUBLICADA por Claude (commit 525a675, Vercel Ready) y probada en producción.**
  - **Migración `20261012200000_proveedores_lista_fantasia.sql` CORRIDA** (+ vuelta atrás): vínculo proveedor ↔ nombre en `catalogo_crm.csv`
    (`catalogo_proveedores`, las dos sociedades) y nombre de fantasía, confirmados por Augusto: Prisina, TKW, Startex, FADI, Aire Libre (AYRE LIBRE SA),
    Mediglove, Segutécnica, Segufer, BH Industrial (EUGENIO MASTROIANNI 20-08528051-2; GRUPO MASTROIANNI S.A. es otro CUIT sin movimientos),
    Iturria (COMERCIALIZADORA ITURRIA MDP), SPI (SPI SHIELD INDUSTRIAL), DPS (INDUSTRIAS DE PASCALE), Conoflex (SERENPLAS SRL).
    Se sacó "Delta Plus" de ESPACIO MARKETING (era un error: Delta Plus = **ESLINGAR**, no está cargado en el CRM).
    **Pendientes:** dar de alta Eslingar (Delta Plus) y **MARIANA SA** (Pegaso) y vincularlos; Ecoway (Augusto pasa el nombre); Fravida (sin confirmar).
  - Ordenar OC abiertas: al abrir muestra botones con los proveedores que tienen lista de costos y renglones sin ordenar (hoy: Prisina 59, Star-Tex 23,
    TKW 19, De Pascale 9, Ayre Libre 6, Mastroianni 4, Mediglove 3, Segutécnica 2, Serenplas 2; FADI ya ordenado). Se busca también por fantasía.
  - Compras: el proveedor se ve "RAZÓN SOCIAL · Fantasía" (si es distinta) y se busca por los dos (`lib/proveedor-nombre.ts`, prueba `scripts/test-proveedor-nombre.ts`).
  - **Enviar OC: solo al contacto de VENTAS** (`contactoVentas` en `lib/oc-envio.ts`, prueba `scripts/test-contacto-ventas.ts`). Nunca usa el mail del
    proveedor (es el de administración, para facturas; se muestra "Administración: x (no se usa)") ni contactos de Cobros. "Guardar en el proveedor"
    crea/actualiza el contacto "Ventas". Probado en producción con OC-1224 Prisina: campos vacíos + aviso; cerrado SIN enviar.
  - **Datos de proveedores (Excel `Claude outputs/proveedores_datos_faltantes_12_10_2026.xlsx`):** de los 51 con OC, 48 sin vendedor (WhatsApp/mail),
    27 sin mail de administración, 10 sin CBU; Prisina, FADI, Inmuovi y San Martín tienen un mail de ventas en el campo de administración.
    Augusto lo completa y Claude carga los vendedores (mostrar la lista antes de guardar).
  - **Pendientes de Augusto como checklist en Finanzas > Hoy > Revisar** (migración `20261012210000_pendientes_proveedores_augusto.sql`, corrida, con
    vuelta atrás; aviso en la campana el 13/10): Excel de vendedores, alta de Eslingar y Mariana SA, Ecoway/Fravida, CUIT de los talleres.
  - Los vendedores se cargan en Proveedores > ficha > "Contactos comerciales" (ya existía) con **Cargo = Ventas**: de ahí los toma "Enviar OC".
  **Tanda V1.1.424 (12/10/2026) — EN CURSO, código SIN PUBLICAR (en el working tree, tsc 0 / hooks OK, probado en local sin guardar):**
  - Regla de Augusto: **un mail de ADMINISTRACIÓN** (facturas, cobros y pagos = `proveedores.email` + `proveedores.telefono`) y **VENDEDORES**
    (contactos, siempre cargo "Ventas"; no se puede cargar cobros/administración como contacto). Cada mail/WhatsApp con el **nombre de la persona**
    (falta: columna nueva para el nombre de administración).
  - WhatsApp en dos casillas: característica (2 a 4 dígitos) + número sin 15, suman 10 (`lib/whatsapp-ar.ts`, prueba `scripts/test-whatsapp-ar.ts`;
    `components/ui/whatsapp-input.tsx`): en ficha, formulario de proveedor y Enviar OC. Formulario: secciones "Administración (facturas, cobros y pagos)"
    y "Comercial (vendedores…)" con "+ Agregar vendedor" (se sacaron "+ email"/"+ celular"). Ficha: "Mail/WhatsApp de administración" y sección de vendedores.
    ⚠️ La sección vieja "Comercial" (forma de pago, días CC, límite, saldo) NO se renombra ("Condiciones de pago" es otra cosa, dijo Augusto);
    propuesta: la de vendedores se llama **"Vendedores"** (esperando OK).
  - **Migración `20261012220000_proveedores_admin_comercial.sql` YA CORRIDA** (+ vuelta atrás con copia): Star-Tex (cuentascorrientes@startex.com.ar,
    nota "Administración: Belén") y Matcom (info@felemax.com) pasan el contacto "Cobros" al mail de administración y se sacan esos 2 contactos;
    Air Products y Amoblamientos Nexo → cargo Ventas; 15 WhatsApp con formato "característica número".
  - **PLAN "Cómo se le paga a cada proveedor" (pedido de Augusto 12/10, esperando OK al plan numerado del chat):**
    condición = Anticipado / Contra entrega / Cuenta corriente N días / **Escalonado de N a M días**; días 0-15-30-45-60-75-90; medios (varios + preferido):
    transferencia, eCheq, cheque físico, tarjeta, efectivo; **plazo del cheque con las mismas opciones de días**.
    **3 fechas de cheque por mes** (idea interna de Augusto, si el proveedor lo permite): ej. oct 12·21·31, nov 11·21·30, dic 11·20·30 → la OP / plan de pagos
    proponen los cheques en esas fechas. Datos que dio Augusto: **Prisina escalonado 30 a 75 días, TKW escalonado 30 a 75, Segutécnica 60 días**; el resto lo irá pasando.
    Proveedor nuevo cargado desde Compras: en la OC / carga de factura el comprador indica la condición de pago que pide el proveedor (se guarda en el
    proveedor; aviso amarillo si falta, nunca bloquea). **"Nuevo proveedor" desde la factura** (`cargar-factura-oc.tsx`, `carga-masiva-facturas-compra.tsx`)
    hoy es un formulario aparte e incompleto (forma de pago vieja, sin vendedores): usar el MISMO formulario completo que Proveedores.
    **OK de Augusto "Va 1 a 7" (12/10/2026):** 1) nombre en cada mail/WhatsApp (administración y vendedores), sección "Vendedores";
    2) bloque "Cómo se le paga" en el proveedor; 3) 3 fechas de cheque por mes en Configuración, OP/plan de pagos proponen esas fechas
    (escalonado: un cheque en cada fecha permitida dentro del rango); 4) factura calcula su vencimiento; 5) "Pago que pide el proveedor" en OC y
    carga de factura (se guarda en el proveedor; aviso, nunca bloquea); 6) "Nuevo proveedor" desde factura (individual y masiva) = MISMO formulario
    que Proveedores (extraer el modal de `proveedores/page.tsx` a `components/proveedor-form-modal.tsx`); 7) migración.
    Respuestas: **días desde la FECHA DE FACTURA**; **pronto pago: Star-Tex 5 % y DPS 5 % por pago anticipado** (DPS casi obligatorio anticipado:
    tiene CC de ~400 USD). Plazo del cheque: mismas opciones de días que la cuenta corriente (0-15-30-45-60-75-90).
    **HECHO 1/7: migración `20261012230000_proveedores_formas_pago.sql` CORRIDA** (probada antes con `--probar scripts/db/pruebas/proveedores_formas_pago.sql`;
    vuelta atrás en `rollback/`): proveedores.`administracion_nombre, condicion_pago` (anticipado|contra_entrega|cuenta_corriente|escalonado),
    `dias_pago, dias_pago_hasta, medios_pago text[], medio_pago_preferido` (transferencia|echeq|cheque|tarjeta|efectivo), `plazo_cheque_dias,
    descuento_pronto_pago`; ordenes_compra: `condicion_pago, dias_pago, dias_pago_hasta, medio_pago_preferido, plazo_cheque_dias, descuento_pronto_pago`;
    facturas_compra: `condicion_pago, dias_pago, dias_pago_hasta` (fecha_vencimiento ya existía); tabla `cheque_fechas_mes` (sociedad, mes día 1,
    dias int[]; lectura lz_es_de_sociedad, escritura lz_puede_operar_finanzas) con oct 12·21·31, nov 11·21·30, dic 11·20·30 en las 2 sociedades.
    Datos: Prisina y TKW escalonado 30-75 eCheq; Segutécnica CC 60; Star-Tex 5 %; DPS anticipado 5 %; medios pasados desde forma_pago vieja.
    **PUBLICADO V1.1.424 (commit d26c557), probado en local sin guardar y versión verificada en producción:**
    `lib/condicion-pago.ts` (+ `scripts/test-condicion-pago.ts`): texto, vencimiento desde fecha de factura, fechas de cheque permitidas
    (31 → último día del mes), cheques propuestos (CC: última fecha fija ≤ vencimiento; escalonado: una en cada fecha fija del rango, monto
    repartido; anticipado: fecha + plazo cheque), `legacyDesdePlan` mantiene forma_pago/dias_cuenta_corriente viejos al guardar.
    `components/condicion-pago-editor.tsx`; `components/proveedor-form-modal.tsx` (formulario ÚNICO: Proveedores, cargar factura y carga masiva;
    nombre de administración, "Vendedores", "Cómo se le paga" + límite de crédito); ficha muestra "Cómo se le paga" y "Vendedores".
    `components/pago-proveedor-oc.tsx` en el detalle de la OC (si el proveedor no tenía, se le guarda). Cargar factura: bloque "Pago que pide
    el proveedor", vencimiento automático (botón "Usar el calculado" si se escribió a mano), se guarda en la factura y en el proveedor si faltaba.
    Configuración → **Fechas de cheque** (`components/fechas-cheque-config.tsx`, 6 meses, avisa feriado/fin de semana y cuándo se debita).
    Plan de pagos y OP: muestran cómo se le paga y "Cheques sugeridos" (solo si el medio preferido es eCheq/cheque).
    ⚠️ Para Augusto: 12/10 es feriado, 31/10 sábado, 21/11 sábado (se debita 24/11), 20/12 domingo: revisar fechas en Configuración.
  1) Compras: filtro **"Abiertas"** por defecto (todas menos completas y canceladas; hoy 77 de 125). "Todas" y "Completas" siguen.
  2) Columnas Pago, Pedido y Factura con íconos (✓ verde, ½ azul, ✗ naranja/gris, tarjeta); el texto sale al pasar el mouse.
  3) Recibido (antes "Mercadería") solo con el punto de color (y "3/10" si es parcial); sin mail debajo del proveedor; "Copiar" solo ícono;
     títulos cortos (OC, PR); tarjeta "Recibidas completas" → **"A reclamar"** (clic filtra). A 1920 px la tabla entra entera.
  4) Cartel "OC con diferencia": sumaba la factura ENTERA aunque estuviera repartida entre varias OC (OC-1199 decía 141,8 % de más).
     **Migración `20261012190000_oc_diferencia_compartida.sql` (+ vuelta atrás; solo reemplaza `diagnostico_diferencia_oc`, no toca datos):**
     de una factura compartida cuenta lo asignado a la OC (renglones conciliados × precio de factura, con su IVA); sin renglones, reparte por total de OC.
     Probada sin guardar (`--probar scripts/db/pruebas/oc_diferencia_compartida.sql`): OC-1199 $2.340.164 de $2.412.764 (faltan 2 u, $72.600);
     las otras 10 OC con factura compartida dan $0. **CORRIDA por Claude (12/10/2026, `migrar.cjs` sin `cd` adelante, verificado).**
  **Personalización desde el PR (bordado / estampa / reflectivo) — PLAN, se hace DESPUÉS de arreglar lo roto (decisión de Augusto 12/10):**
  hoy el bordado es un renglón suelto ("BORDADOS", 37 renglones) que termina en OC a "Stock propio" (ej. OC-1197); el módulo Personalización está vacío.
  Plan: botón "+ Personalizar" en cada prenda del PR (técnica; ubicación y logo OPCIONALES — casi nunca los tiene al cotizar; cantidad de la prenda;
  quién lo hace: taller, o para reflectivo "el mismo proveedor de la prenda" = renglón extra en su OC con costo); al aprobar se arma el trabajo
  para el taller y se manda por **WhatsApp**; sugerencia (no bloqueo) si un renglón dice bordado/estampa/reflectivo. Lleva migración chica.
  Talleres a cargar: **Nora** (bordado), **Eve** y **Cordobés** (estampado); CUIT y documento los completa Augusto más adelante.
  **Permisos (12/10/2026, OK de Augusto):** Claude publica (git add/commit/push, vercel.cmd --prod) y prueba haciendo clic en el CRM.
  Nunca envía mensajes (WhatsApp/mail) ni toca nada de ARCA. Comandos sin `cd ... &&` adelante (si no, no coinciden con las reglas).
  tsc 0 errores, hooks OK, probado en local sin guardar. Visto de paso: la campana da error 400 en la consulta de `alertas` (dos `or=`), ya estaba antes.
  Ojo (menor, no se tocó): editar el monto de un medio que dejó saldo a favor (`gestionar_cobro` 'editar') no ajusta ese saldo a favor.
  Ya estaba bien: las funciones directas ya no se podían llamar desde la app (lo cerró 20260925220000); igual se vuelve a cerrar.
  Pendiente (punto 6, más adelante): las reglas de lectura de la base dejan leer a cualquier usuario logueado; con el registro cerrado,
  los bloqueos y el middleware no hay forma de que entre alguien no invitado.
  Pendiente aparte: `profiles_select_all` deja a cualquier logueado ver la lista de usuarios (menor).
- **Rescate del FCI (12/10/2026):** Augusto pidió rescatar solo lo inmediato y después aclaró que **el sistema tenía razón**: se mantiene rescatar
  **un día hábil antes** del débito (con feriado, el 13/10 se rescata el 09/10). No cambiar esta regla.
- **Control de cheques emitidos (12/10/2026):** los 126 "a pagar" del CRM ($115.297.683,61) cruzados con la lista de eCheqs "Aceptado" del home banking (100 renglones, corta ahí)
  y los Excel del 11/10: ningún monto distinto, ningún cheque de más en el banco, ninguno "pagado" en el banco que el CRM tenga a pagar. 18 ($20.783.695,95) no estaban en esos
  archivos, pero 16 se cargaron del propio listado del banco (en "Custodia" o fuera de los 100). Augusto rescató $49.200.000 del FCI a la CC el 12/10 (ref. 50001364014261012)
  para los débitos del 13/10. **Corregido con OK (SQL corrido por Augusto):** 8 cheques de "Físico" a "eCheq" (90017369/70/71/72/64/73/65 y 90000172), script en
  `supabase/diagnostico/corregir_tipo_echeqs_12_10_2026.sql`. 90017362 (Sinpostre $270.075,03) y 90017368 (Conte Hnos $34.140,75) también corregidos a eCheq (confirmado por Augusto; script `..._b.sql`, 2 filas OK). Ningún emitido queda mal como Físico.
  **Control completo con `12-10-2026-eCheqs-emitidos.xls` (400 eCheqs emitidos desde 18/05, todos los estados):** los 126 "a pagar" del CRM coinciden 126/126
  con los pendientes del banco (99 ACTIVO + 18 CUSTODIA + 9 ACTIVO_PENDIENTE) en número, monto y fecha de pago. Ninguno pagado en el banco que el CRM tenga a pagar,
  ninguno pendiente en el banco que falte en el CRM. Cheques emitidos: OK.
- **Arreglado (V1.1.418):** el cobro masivo desde Facturación listaba notas de crédito como si fueran facturas a cobrar (Finanzas ya las filtraba).
- Chequeos: tsc 0 errores, check-hooks OK, tests revisar-finanzas, cobro-reparto y finanzas-grupos OK. Versión 1.1.418.

00. **Correcciones de la conciliación BBVA (V1.1.416)** — **PUBLICADO como V1.1.417 (12/10/2026, commit f5b725c, sin migración)**; todo lo que abajo dice "sin publicar" ya está en producción. Revisión completa 12/10/2026:
   1. **"Saldo pendiente $0" (HECHO):** no era un error de datos: el cartel mostraba lo que queda DESPUÉS del cobro y el CRM precarga el total.
      Ahora dice "Saldo de la factura: X — Queda después de este cobro: Y". Además, cobrar de más ya no frena: avisa y pregunta (regla 1).
   2. **Tipo de cambio en cobros USD + BNA diaria:** HECHO en código (12/10/2026, V1.1.417 sin publicar, sin migración).
      `lib/tc-cobro-usd.ts` (prueba `scripts/test-tc-cobro-usd.mjs`) + `components/fx-settlement-dialog.tsx`:
      divisa/billete sale de la factura o de la ficha del cliente ("USD" = billete, "USD Divisa" = divisa); BNA de referencia del **día hábil anterior**
      (`diaHabilAnterior`, saltea feriados) traído solo; la factura se cancela con el TC del cliente (pesos + retenciones ÷ USD) mientras no elija otro;
      si el cliente pagó **más de 2 % abajo** del BNA → recuadro amarillo con lo que falta y "Copiar mensaje para el cliente" (nunca frena);
      si pagó arriba → verde. Probado en local sin guardar (FA 15-52 Soenergy: billete, BNA 09/10 $1.535, −2,9 % aviso / +1,3 % verde).
      **D1 revisado:** el cron guarda divisa y billete todos los días hábiles. ⚠️ Las filas viejas (fuente `BNA_cron`, hasta 09/10) están corridas un día
      (guardaban el valor del día anterior con la fecha de hoy). El CRM no las usa (solo confía en `BNA histórico v2` o cargadas a mano) y el cron nuevo ya graba bien.
      **Corregido con OK de Augusto (12/10/2026):** las 76 filas de días hábiles (19/08 a 09/10) quedaron con el histórico del BNA y fuente `BNA histórico v2`
      (39 cambiaron de valor, 37 ya coincidían). Las 3 filas de fin de semana (05/09 y 06/09, fuente `BNA`) quedaron igual: el BNA no cotiza esos días y el CRM no las usa.
      Valores anteriores en `Claude outputs/antes_cotizaciones_dolar_12_10_2026.json`.
   3. **Cuentas (HECHO en código):**
      - Efectivo = lo que dice Augusto (las extracciones no suman a la caja; "Según tu caja al ..."). FCI = saldo del banco, sin interés estimado.
      - `lib/fci-custodia.ts` (+ `scripts/test-fci-custodia.mjs`): lee el Excel de la custodia (BBVA_Comprobante_*.xls) y calcula lo que generó el FCI
        por mes con valuaciones reales. Sept (27/08→30/09) **$1.646.385,79**; oct (30/09→11/10, con el total del home banking) **$453.278,60**.
        Falta mostrarlo en el CRM (subir el Excel en la tarjeta del FCI; para guardarlo haría falta una tabla nueva → plan y OK).
      - Débitos por semana + aviso rojo de rescate 1 día hábil antes (`lib/dias-habiles.ts`, feriados 2026; ⚠️ cargar móviles 2027).
        Un cheque de sábado/feriado no figura "atrasado" (se debita el hábil siguiente).
      - **Error arreglado (V1.1.416):** una OP pagada con eCheq restaba su total de la CC el día de la OP (el trigger le pone la CC a todo "pago")
        y otra vez al debitarse el cheque. Ahora solo resta la parte en transferencias (`montoCuentaDeOp` con `ordenes_pago.medios_pago`).
        El aviso "sin cuenta" solo cuenta lo que mueve banco o caja (bajó de 78 a 15). Mejora futura: que el trigger use los medios de la OP.
      - Extracto: los pagos de OP mixtos (cheques + transferencia) cruzan por la parte en transferencia (4 líneas más cruzan solas).
   4. **Revisión de datos (solo lectura) 12/10:**
      - Cheques emitidos: los 126 "a pagar" coinciden con el banco (ACTIVO / CUSTODIA / ACTIVO_PENDIENTE) o con la planilla (12 viejos que el listado
        del banco no trae). Ninguno a cambiar. 90017077 y 90017203 (20/09) siguen activos en el banco.
      - **Aplicado en la base con OK de Augusto (12/10/2026):** Efectivo $2.561.020 al 09/10 (saldo_banco); FCI $71.480.800,70 al 11/10;
        cheque 30012626 (Fedea $2.145.833,33) "endosado" a STAR-TEX SA el 15/09 (OP-000011, con observación); cheques 90017359/60/66 a "eCheq";
        pagos OP-000038 (Inmuovi) y OP-000052 (Da Silva) a la cuenta Visa. Valores anteriores: `Claude outputs/antes_correcciones_finanzas_12_10_2026.json`.
      - **Explicado por Augusto:** OP-000043 Electronic: pagó $620.329,99 y después le avisaron que están exentos → les transfirió los $5.870,42
        retenidos el 08/10. OP-000004 Mastroianni: le anularon los eCheqs por las fechas y pagó por transferencia el 02/10 ($325.500,12).
        **Hecho con OK (12/10/2026):** retención de Electronic anulada (ya no sale en SICORE); pago nuevo de $5.870,42 del 08/10 (CC, factura 0004-00011819,
        sigue "pagada") conciliado con la línea del banco; línea del 02/10 conciliada con el pago de la OP-000004. Antes: `Claude outputs/antes_electronic_mastroianni_12_10_2026.json`.
   **SIGUIENTE:** Augusto pidió ideas para Finanzas y para ordenar Ventas (sin tareas repetidas): revisar las pantallas de Ventas/Presupuestos/Oportunidades/Facturación y proponer. Después, Augusto revisa el CSV de líneas pendientes.
      **Hecho 12/10/2026 (solo ideas, sin código):** propuesta pasada en el chat: Finanzas de 16 pestañas a 5 grupos (Hoy / Cobrar / Pagar / Cheques / Deudas),
      una sola pantalla por acción (hoy "Emitir factura" está en Ventas y en Facturación; Facturación entera está repetida en Finanzas > Fact. Ventas;
      "Cobro masivo" en Facturación y Finanzas), botón "Próximo paso" en cada operación, Presupuestos hasta Aprobado y después Ventas,
      bandeja de pendientes, proyección de caja 30/60/90 días, tarjeta ARCA a Configuración. Esperando OK y respuestas de Augusto.
      **Etapa A HECHA en código (12/10/2026, OK de Augusto; va en la V1.1.417 sin publicar, sin migración):**
      - Finanzas en 5 grupos (`lib/finanzas-grupos.ts`, prueba `scripts/test-finanzas-grupos.mjs`): **Hoy** (Cuentas, Movimientos, Extractos, Objetivos
        + botones Caja/Balance, que ahora solo salen acá) · **Cobrar** (Facturas de venta, CC Clientes, Recibos, Vencimientos) · **Pagar** (Facturas de compra,
        Órdenes de pago, CC Proveedores, Gastos, **Gastos fijos** —ya no está oculta; total en $ y US$—, Retenciones, Vencimientos) · **Cheques** (Cheques,
        Cheques Martín F.) · **Deudas** (Créditos). Vencimientos abre filtrado "a cobrar" desde Cobrar y "a pagar" desde Pagar.
        Recuerda el último grupo/pestaña en la compu (localStorage `finanzas.ultimaPestana`); los links (`?tab=`, `?factura=`) mandan sobre lo guardado.
      - `/facturacion` ya no es una pantalla aparte: lleva a Finanzas > Cobrar > Facturas de venta (quien no tiene Finanzas, p. ej. "viewer", la sigue viendo ahí).
        El buscador de arriba y Remitos abren la factura puntual (`?factura=ID`).
      - Tarjeta ARCA → Configuración > Integraciones (`components/arca-status-card.tsx`, solo consulta el estado). En Facturación queda un aviso amarillo solo si falta el certificado.
        En local siempre dice "Certificado no configurado" (normal: las variables ARCA están solo en Vercel).
      - Arreglado: links que llegan a Finanzas sin recargar (Ventas "ver factura", Proveedores "Ver cuenta corriente") abrían Cuentas; ahora abren la pestaña pedida
        y la CC del proveedor.
      - Cobro masivo: se deja en los dos lugares (Facturación y CC Clientes) porque los dos guardan con el mismo componente (`CobroMasivoLiquidacion`);
        solo cambia la ventana para elegir facturas. No es lógica repetida.
      - Probado en local sin guardar: 5 grupos, Vencimientos, recordar pestaña, `/facturacion`, link de Proveedores, Configuración. tsc 0 errores, check-hooks OK.
      - Ruido viejo en consola (no es de este cambio): dos columnas con key "cuit" en las tablas de CC Clientes/Proveedores.
      **Pantallas más compactas (12/10/2026, OK de Augusto; V1.1.417 sin publicar):** Card p-4, StatCard más baja (text-xl), Header más bajo,
      páginas `p-3 sm:p-5 space-y-4` (12 archivos), Facturación dentro de Finanzas sin doble margen. `DataTable`: filas más finas (py-2) y botones
      "Filas: 25 · 50 · 100 · Todas" (por defecto 50, se recuerda en la compu con `tabla.filas`; las tablas con `pageSize` fijo —Dashboard, Transportes— no cambian).
      Listas desplegables de clientes (`select size`) cambiadas por el buscador `Autocompletar`: Registrar cheque (Finanzas) y Facturación masiva sin OC.
      **Cheques de Del Sol (12/10/2026, pedido de Augusto):**
      - **Cargado:** eCheq 3644 $11.801.686,09 (pago 30/10) como cheque recibido de DEL SOL en cartera (sin cobro: paga FC-A 0009-405 $7.394.812,15 y
        0009-406 $4.600.666,31 del sistema anterior, total $11.995.478,46). Diferencia **$193.792,37** = retenciones a confirmar (anotado en el cheque).
        Recibidos en cartera: 3 — $25.590.065,66.
      - **Falta (REVISAR el martes 13/10):** eCheq $6.210.728,30 (pago 11/12) contra FA 16-17, 16-18, 16-16, 15-45 y 15-54 (total $6.463.222,05; diferencia
        **$252.493,75**, ¿retenciones?). No se cargó porque el cobro masivo exige "diferencia $0" (⚠️ va contra la regla 1: debería avisar y dejar seguir).
        Con los certificados de retención cuadra exacto y se carga normal. Fecha de recepción de ambos: 09/10 a confirmar (Del Sol paga a 45–60 días, los viernes).
        Recordatorio programado para el martes 13/10 9 h (tarea `recordatorio-retenciones-del-sol`).
      - Ojo: FA 16-18 ($1.370.733,34, 25/09) tiene el mismo importe que la FC-A 9-399 del sistema anterior (20/08): confirmar que no sea la misma venta facturada dos veces.
      - **Bichara (HECHO 12/10, decisión de Augusto: sin factura):** cheques físicos recibidos de MARCOS MARTIN BICHARA en cartera: 00406334 $266.000 (pago 20/10,
        firmante Borgogno Guillermo Dario) y 85983561 $290.000 (pago 23/10, firmante Alvarez Juan Carlos); datos de `ideas/cheques_desde_2026.csv`.
        Pagan una factura del sistema anterior. Fecha de recepción: REVISAR. Recibidos en cartera: 5 — $26.146.065,66.
      - **REVISAR (Augusto lo deja para después):** fecha de recepción de todos estos cheques y de los cobros con fecha futura (Barraza $10.110.492,35 y
        Del Sol $3.677.887,22). Van a la pestaña "Revisar" cuando exista.
      - **Líneas pendientes del extracto (125):** siguen en Finanzas > Hoy > Extractos (filtro "pendiente") y en el CSV; cuando exista "Revisar", se ven ahí también.
      - Pendiente de código: que el cobro masivo deje confirmar con diferencia (avisa y pregunta; lo que falta queda como saldo de la última factura).
        La función de la base `registrar_cobro_masivo` no está en el repo: antes de tocarla, leer su definición en Supabase (`select pg_get_functiondef('public.registrar_cobro_masivo'::regproc)`).
      **Datos de Augusto para cargar (12/10/2026), faltan detalles:**
      - **Crédito BNA 1 (lo paga Luis María Lazzari, papá; al día, pagó todas las vencidas):** cuenta BNA CA $ 27003971709297, titular LAZZARI AUGUSTO,
        CUIT 20-37930912-8, alias lazzariaugusto.bna. 12 cuotas de capital $300.000 ($3.600.000), sistema alemán, débito ~el 10.
        Cuota total (cuota + cargos): 1) 13/07/26 $432.874,52 · 2) 10/08 $385.261,15 · 3) 10/09 $385.814,80 · 4) 09/10 $382.216,11 ·
        5) 10/11 $362.008,11 · 6) 10/12 $358.132,60 · 7) 08/01/27 $353.149,80 · 8) 10/02 $341.523,29 · 9) 10/03 $331.004,05 · 10) 08/04 $327.405,36 ·
        11) 10/05 $315.502,04 · 12) 10/06 $308.581,48. Quedan 5 a 12: $2.697.306,73 (capital $2.400.000).
      - **Crédito BNA 2 (lo paga Andrés Leguizamo):** ⏰ **Recordarle a Augusto** que pase los detalles.
      - **Préstamo Cecilia Alvarez (tía), plata de la empresa:** US$ 25.000; US$ 10.000 están en **BAVSA** (ALyC/banco: descuenta cheques y presta;
        cargarla como cuenta en US$ y $, el $ se actualiza el martes 13/10). Sin fechas de devolución.
      - **Préstamo José Alvarez (abuelo):** US$ 18.500. US$ 8.500 se los paga Andrés Leguizamo **a Augusto** y Augusto se los da al abuelo
        (no tiene que ver con el crédito BNA). Sin fechas. Idea: "apartado" mensual sugerido para devolver a Cecilia y José sin afectar el negocio.
      - **Gastos fijos (Lazzari):** sueldos $1.500.000/mes c/u (Mariana Santinelli, Jerónimo Casadidio, Sebastián Pereyra), se pagan del 1 al 10;
        alquiler US$ 800/mes del 1 al 15, en dólares (retira efectivo → compra US$ en financiera → inmobiliaria).
        **TC del alquiler = dólar blue** (no BNA): el CRM pregunta el valor a Augusto (lo carga él), nunca toma el del banco.
      - **Cómo pagan los terceros:** papá (BNA 1) paga cuando quiere, sin cuenta fija → el cobro lo carga Augusto cuando avisa (la cuota igual figura en la proyección).
        Andrés todavía no pagó nada de los US$ 8.500 → se carga cuando Augusto avise.
      - **Estado "Facturar" de Presupuestos (dato de Augusto 12/10):** algunas empresas aprueban pero no se factura hasta que mandan su OC.
        Propuesta (esperando OK, va en la Etapa D): Presupuestos termina en Aprobado; en Ventas, si falta la OC, la operación queda "Esperando OC del cliente"
        (aviso a los X días, botón "Cargar OC" con número/fecha/PDF en los campos `oc_cliente`/`oc_cliente_fecha` que ya existen) y al cargarla pasa sola a "Lista para facturar".
        Marca opcional en la ficha del cliente "Pide OC para facturar". Facturar sin OC se puede igual: avisa y pregunta (regla 1). Reemplaza `listo_para_facturar`.
      - **Falta de Augusto:** colchón mínimo para el "apartado" (Cecilia/José) y la tabla del crédito BNA 2.
        **Pendientes de Augusto:** honorarios del contador (monto) y otros gastos fijos que va completando esta semana.
        La pestaña "G. Fijos" de Finanzas existe pero está oculta ("en revisión"); la tabla `gastos_fijos` ya tiene moneda.
      - **Regla de Augusto:** todo lo que se compra con tarjeta en Mercado Libre se paga con la Visa (la Visa es la tarjeta sugerida para lo nuevo).
      - **Faltan en el CRM (los tiene que cargar Augusto con las OP de Del Sol, etc.):** cobro con cheque Del Sol 3414 ($12.532.078,86, depositado 01/10);
        cheques en mano Del Sol 3644 ($11.801.686,09, 30/10) y 3968 ($6.210.728,30, 11/12); Bichara 00406334 ($266.000) y 85983561 ($290.000);
        recibidos y endosados: Del Sol 3587 y Punto Espacios 211 (a Bruno Francione, OP-000009), Pachamama 9919 (Prisina), Musso 2105 (BA Valores).
      - **Dudas para Augusto:** OP-000004 Mastroianni y OP-000043 Electronic están ANULADAS pero su pago sigue activo y la plata salió
        (02/10 $325.500,12 y $620.329,99); la retención de Electronic ($5.870,42) sigue activa y el 08/10 salió una transferencia por ese importe.
        OP-000038 y OP-000052 pagadas con tarjeta: ¿cuál? 21 cobros del banco son de facturas del sistema anterior (no están en el CRM): ¿cómo registrarlos?
      - Las 125 líneas pendientes del extracto, con lo que se sabe de cada una: `Claude outputs/extracto_pendiente_revision_12_10_2026.csv`.

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
   - **Datos de Augusto (11/10/2026):** Lazzari opera con **BBVA** (cuenta + tarjetas BBVA Visa y BBVA Master).
     La Master hoy la usa también para gastos personales; la idea es que Visa y Master queden solo para trabajo y lo personal vaya a Galicia.
     Falta cargar: cobros recibidos que no están en el sistema, cheques emitidos viejos (pagos e impagos del sistema viejo), eCheqs recibidos sin actualizar.
     Respuestas 11/10/2026: fecha de corte = el día en que empezó a usar el sistema (sacarla de la base); solo Lazzari/BBVA en pesos
     (Grupo LA usa Galicia pero hoy sin acceso; ignorar USD); usan FCI. Después de cargar todo, Augusto reenvía las órdenes de pago de clientes de sus mails.
   - **Plan "Cuentas y extractos" propuesto (esperando OK):** ya existen `extractos_bancarios`/`extracto_movimientos` y un cruce manual por importe exacto
     (`lib/extracto-match.ts`), sin tabla de cuentas.
     1) Cuentas (migración): tabla de cuentas (cuenta corriente, caja de ahorro, FCI, tarjeta, efectivo) con saldo al corte; `cuenta_id` en movimientos y extractos.
        **OK de Augusto (11/10/2026), con estos ajustes:** pestaña "Cuentas" primera en Finanzas, en archivo propio; `lib/saldo-cuentas.ts` con prueba.
        Saldo al corte solo para BBVA, FCI y efectivo. Cuentas automáticas: "Cheques en cartera" y "Cheques emitidos a pagar"
        (eCheq/cheque propio: el pago al proveedor queda hecho, pero la plata sale del BBVA recién cuando se debita; mostrar lo comprometido por semana y mes).
        Tarjetas Visa/Master: sin saldo al corte, van por resumen mensual, en **ARS y USD** (dos saldos; el USD se paga en pesos o en dólares, se ve en etapa 3).
        Cuenta sugerida por medio para lo nuevo (trigger, nunca frena); lo viejo queda "sin cuenta" y se asigna en la etapa 2.
        Paso 1: `supabase/diagnostico/fecha_corte_lazzari.sql` (solo lectura). Resultado: cheques desde 22/08, presupuestos 26/08,
        OC 01/09, facturas y cobros/pagos cargados desde 02/09 (alguno con fecha 22/08). **Propuesta: corte = cierre del 31/08/2026**
        (saldo al corte = saldo del extracto al 31/08; entran los movimientos con fecha desde 01/09).
        **Cuentas reales BBVA (resúmenes al 09/10/2026 en Descargas, 11/10):** CC "EPP LAZZARI" 091-312483/1 (la principal, acuerdo $1.500.000,
        debita las tarjetas; hoy −$1.575.636,31; FALTA su extracto); CC "INDU LAZZARI" 091-318933/7 ($4.797,36, sin movimientos);
        CA $ 091-339549/3 (saldo anterior 88.411,83 al ~10/09; falta el saldo al 31/08); CA U$S ignorar;
        FCI FBA Money Market Pesos (custodia 91-565772/5): 551.950,26 cuotapartes al 31/08 (calculado con el Excel de custodia y cruzado con el resumen) ≈ $97,56 M;
        Visa Signature ·1582 y Mastercard Black ·4775: resúmenes con cierre 01/10, vto 09/10, en $ y U$S; la deuda al corte sale del "saldo anterior" (cierre 01/09):
        Visa $9.792.257,37 + U$S 148,82; Master $4.402.026,27 + U$S 4.389,17. Agregar campo "acuerdo" (descubierto) a la cuenta.
        Sumar también CA U$S 091-314103/6 (U$S 14,62; Augusto la quiere incluida). Efectivo: planilla "Cierre de caja" de Augusto, arranque 08/09 $33.520
        (usar como saldo al corte). En esa planilla, "Útil – Venta/Ingreso" es un negocio por afuera (ventas tercerizadas por la empresa Útil de Camila y
        Agustín Musso, el contador, que se queda un %): ignorarlo por ahora, armarlo más adelante si Augusto lo pide.
        **Saldos al 31/08 calculados de los Excel completos (Descargas, "Detalle_mov_cuenta_11_10_2026 (2)/(3).xls", cadena de saldos verificada):**
        CC EPP LAZZARI **$10.829.781,65**; CA $ **$300.440,53**. Con esto están todos los datos de la etapa 1.
        El 09/10 la CC pagó Visa $4.694.598,40 y Master $3.201.710,17 + $4.709.743,56 (los U$S). El 25/09 hubo extracción de efectivo de $6.200.000 de la CA
        que no está en la planilla de caja (preguntar en la etapa 2).
     2) Importar extracto BBVA y cruce automático; lo que no cruza se pregunta (cobro, pago, gasto bancario, impuesto, transferencia a FCI, cheque acreditado, personal).
        **Plan etapa 2 con OK de Augusto (11/10/2026):** subir el .xls del BBVA tal cual (cuenta por encabezado, desde 01/09, sin duplicar, control de saldos);
        cruce automático (PAGO CHEQUE por número, DEPOSITO CHEQUE = cobro acreditado, DEVUELTO avisa, cobros/pagos por importe y fecha, FCI/entre cuentas/tarjetas = pases);
        "Para revisar" con botones y "Recordar"; saldo real en Cuentas. **1a:** gastos e impuestos del banco quedan clasificados en el extracto
        con totales por mes (SIRCREB aparte), sin crear movimientos. **2:** la primera subida cruza todo desde 01/09 y asigna cuenta a lo viejo.
        Antes de programar: Augusto exporta los eCheqs de todas las categorías (para cruzar los 154 PAGO CHEQUE). Excel CC = Descargas "(3)", CA = "(2)" del 11/10.
        **Datos para la etapa 2 (11/10/2026):** eCheqs exportados en Descargas (11-10-2026-eCheqs-*.xls; el banco corta en 100 filas) + planilla "Cheques_Lazzari.xlsx"
        (hoja Emitidos: 1.710 cheques desde 2022 con fecha de débito). Con eso cruzan 156 de 161 PAGO CHEQUE desde 01/09; faltan 5 de chequera física (00496361/63/64/65/66) → cruzar por importe con pagos.
        Depósito 06/10 $1.000.000 = cheque 14588139 de Alesso (efectivo prestado a un amigo): pase personal, su salida es la Transferencia inmediata del 01/10 de $1.000.000.
        **Martín Fernández:** cheques que emite Lazzari pero cubre él (hoja "Martín Fernández", 15; 6 pendientes por $15.515.936, próximo 22/10).
        Cuentan en el comprometido, pero con lista aparte con fechas para avisarle.
        Cheque acreditado en el extracto = cobro acreditado (idea de Augusto).
     3) Tarjetas Visa y Master: resumen, consumos a proveedor/gasto/"personal", pago del resumen desde la cuenta.
        **Mercado Libre (aclarado por Augusto):** todo lo de ML se paga con la Visa. Las OC se cargan con proveedor "Mercado Libre";
        a fin de mes se suben todas las facturas de ML, cada una se ata a su OC y pasa al vendedor real (dejando marcado que la compra fue por ML),
        queda pagada con tarjeta Visa (sin OP) y se cruza con el resumen de la Visa y su pago en el extracto. Ojo con compras en cuotas.
        Sugerencia: anotar el N° de compra de ML en la OC al comprar (ayuda mucho al cruce).
     4) Puesta al día: cruce del listado de eCheqs del BBVA (✅ coinciden / ➕ faltan / ✏️ estado distinto) y OP de clientes por mail.
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
