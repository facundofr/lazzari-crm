# Estado del proyecto — CRM Lazzari

Actualizado: 11/10/2026 · Versión publicada: **V1.1.416** (11/10/2026)

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

00. **Correcciones de la conciliación BBVA (V1.1.416)** — en código, SIN publicar (V1.1.417, sin migración). Revisión completa 12/10/2026:
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
