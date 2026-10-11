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
