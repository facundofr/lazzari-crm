# Revisión cruzada — Auditoría integral CRM Lazzari (28/10/2026)

Revisor cruzado. Solo lectura: no se modificó ningún archivo del repo salvo este. Las consultas a la base se hicieron dentro de `begin transaction read only` (mismo mecanismo que `scripts/lectura/sql.cjs`, con un ayudante en el scratchpad que imprime texto plano). No se llamó a ARCA, BCRA, Resend, Anthropic ni a ningún servicio externo. No se levantó el servidor.

## 1. Alcance revisado

**Notas de los 8 agentes:** `docs/auditoria-integral/trabajo/agente-1..8-*.md` (resúmenes del orquestador).

**Código abierto para verificar:**
- `src/components/presupuestos/presupuestos-lista.tsx` (1569-1618, 1811-1945, 2201-2240, 2276-2392)
- `src/app/(crm)/clientes/page.tsx` (598-645, 820-840, 1436-1460, 2490-2502)
- `src/lib/oc-lista.ts` (15-70) — el archivo tiene 101 líneas: las líneas 412-435 citadas por el agente 2 no existen; la lógica está en 39-42.
- `src/components/compras-lazza-oc.tsx` (165-251)
- `src/app/api/facturacion/route.ts` (415-445, 676-735, 790-912)
- `src/components/facturacion/emitir-factura-modal.tsx` (470-482)
- `src/app/(crm)/facturacion/facturacion-content.tsx` (655-730)
- `src/lib/factura-condicion.ts` (50-57)
- `src/app/(crm)/remitos/page.tsx` (522-600)
- `src/app/api/cotizacion-bna/route.ts`, `src/lib/bna-historical.ts`, `src/lib/invoice-exchange-rate.ts`, `src/lib/dolar-presupuesto.ts`, `src/lib/supabase/middleware.ts:36`
- `src/app/api/cron/*/route.ts` (chequeo de CRON_SECRET), `src/app/api/email/send/route.ts:60-72`
- `src/app/api/ai-presupuesto/route.ts:18-40`
- `src/app/api/finanzas/asistente/route.ts:58-75`, `src/lib/agente-mail-server.ts:125-147`
- `src/lib/saldo-clientes.ts:125-142`, `src/lib/saldo-favor-cliente.ts:1-30`
- `src/lib/pago-tarjeta.ts:38-52`, `src/components/cargar-factura-oc.tsx` (176-238, 1315, 1605-1628, 2440-2446)
- `src/components/finanzas-lazza/gastos.tsx:178-215`
- `src/components/orden-pago-nueva.tsx:536,554,889,991`, `src/lib/plan-pagos.ts:65-88`, `src/lib/retencion-conceptos.ts:60-66`, `src/components/plan-pagos.tsx:282,386`
- `src/lib/auth-context.tsx:94-117`
- `src/app/(crm)/transportes/page.tsx:468`
- `src/lib/supabase/database.types.ts` (conteo de tablas), `package.json` (scripts)
- `scripts/test-op-validation.mjs` (leído y corrido: puro, solo lee archivos)
- Migraciones: `20261007113000_bloquear_facturas_compra_duplicadas.sql`, `20261015120000_gastos_fijos_inga_porcel_lazzari.sql`, `20261016090000_gastos_fijos_octubre_pagados.sql`, `20261026190000_op_cheque_de_op_anulada.sql` (235-258, grep de fc_compra_pagado)

**Base (solo SELECT):** `pg_policies` (cotizaciones_dolar, facturas_compra, op_facturas_compra, factura_compra_ocs, facturas, factura_items, clientes, movimientos, presupuestos, storage.objects), `storage.buckets`, `pg_class.reloptions` de vistas + `has_table_privilege('anon')`, `pg_proc` + `has_function_privilege('anon')`, cuerpos de `actualizar_presupuesto_atomico`, `recalcular_factura`, `registrar_pago_tarjeta_factura_compra`, `fc_compra_pagado`, `validar_saldo_aplicacion_factura_compra`, `registrar_nota_credito_venta_autorizada`, `lz_cobrado_factura`, `gestionar_cobro`, `desconciliar_movimiento`, `get_dashboard_kpis`, `presupuesto_estado_alert`, `recalcular_oc`; `pg_constraint` (FKs hacia presupuesto_items, orden_compra_items, facturas_compra); `pg_trigger` (factura_items, orden_compra_items, facturas_compra); `pg_indexes` (facturas, fiscal_emission_attempts); datos de `fiscal_emission_attempts`, `facturas`, `ordenes_compra`+items, `presupuestos`, `extracto_movimientos`+`movimientos`, `gastos_manuales`, `facturas_compra`, `proveedores`, `ordenes_pago`, `remitos`, `supabase_migrations.schema_migrations`.

## 2. Datos compartidos (los "módulos" del revisor cruzado) — 15 puntos

Como revisor cruzado mi área no son pantallas sino los **datos que cruzan módulos**. Para cada uno, los 15 puntos.

### 2.1 Saldo de factura de venta
1. Función: cuánto falta cobrar de cada factura y la deuda del cliente.
2. Recibe: facturas (total, total_acreditado, estado, tipo, moneda), movimientos con factura_id, cobro_aplicaciones.
3. De dónde: Facturación (ARCA), Cobros (RPC), NC.
4. Operaciones: total − cobrado − acreditado; NC aparte.
5. Modifica: facturas.estado (vía `lz_estado_factura_por_cobro`), facturas.total_acreditado (NC).
6. Guarda: estado en facturas; el saldo se calcula, no se guarda.
7. Dependen: Finanzas Lazza (Facturas, CC, Vencimientos), Ventas, Ficha 360, Clientes (lista y pestaña Cta. Cte.), Facturación masiva, agente de mail, asistente de Finanzas, NC.
8. Depende de: que todos los cobros pasen por RPC y que el total guardado sea el autorizado por ARCA.
9. Errores posibles: implementaciones paralelas (ver H28, H08), total distinto del de ARCA (H12).
10. Si falla un cobro: RPC atómica, no queda a medias (bien).
11. Si otro módulo cambia datos: el trigger `recalcular_factura` reescribe el total si alguien toca renglones (H12), anular/revertir por update directo deja estado sin recalcular (H31).
12. Pruebas: test-saldo-clientes, test-finanzas-lazza (pasan, según agentes 3/7).
13. Problemas reales: 6 implementaciones distintas (saldo-clientes.ts = lz_cobrado_factura; NC RPC; agente-mail; asistente de Finanzas; pestaña Cta. Cte. por estado; Clientes > Consumo).
14. Riesgos: estado de cuenta enviado al cliente con NC como deuda (ocurre hoy), NC que aplica de menos (latente).
15. Confiabilidad: **media** — el núcleo (RPC + saldo-clientes) es alto y coincide con los datos, pero los consumidores secundarios no lo usan.

### 2.2 Saldo / estado de factura de compra
1. Función: cuánto falta pagar a cada proveedor por factura.
2. Recibe: facturas_compra (total, total_acreditado, estado), op_facturas_compra, movimientos tipo pago (directos, NC, retención).
3. De dónde: Compras Lazza, cargar-factura-oc (viejo), Transportes, Personalización, OP, Plan, pago con tarjeta.
4. Operaciones: total − OP − directos − crédito NC (una vez).
5. Modifica: facturas_compra.estado.
6. Guarda: estado (texto libre, lo escriben front, RPC y scripts).
7. Dependen: Finanzas (Vencimientos, CC proveedores), OP, Plan de pagos, saldo a favor proveedor, ejes de OC, SICORE.
8. Depende de: `fc_compra_pagado` (declarada como regla única).
9. Errores posibles: 7 implementaciones con criterios distintos (H17), NC contada dos veces en tarjeta (H18), "pagada" sin pago (H19), total editable después de pagar (H22).
10. Si falla: la OP es atómica; tarjeta tiene respaldo no atómico (hoy inactivo).
11. Si otro módulo cambia datos: un UPDATE del total (RLS true) no revalida aplicaciones (H22); un DELETE cascada borra el vínculo con la OP (H53).
12. Pruebas: test-saldo-factura-compra prueba una función que nadie usa (contradicción, ver §5).
13. Problemas reales: 3 "pagada" sin pago (Grupo LA), 1 pagada de más $219.548, duplicado Speed Business.
14. Riesgos: pago doble o de menos si aparece una NC con un solo rastro.
15. Confiabilidad: **media**.

### 2.3 Estado de mercadería de la OC
1. Función: si llegó lo pedido.
2. Recibe: orden_compra_items.cantidad_recibida, ordenes_compra.estado, saldo_cerrado.
3. De dónde: Llegó (Compras Lazza/Compras nueva), IA modo Hacer, recepción vieja, trigger `auto_estado_oc`, syncOCsFromPR, edición de OC.
4. Operaciones: `estadoPorRecibido` (cliente), `auto_estado_oc` (solo sube), `estadoOC` (lista, mira primero la columna).
5. Modifica: ordenes_compra.estado.
6. Guarda: columna enum `oc_status` (borrador, enviada, confirmada, recibida_parcial, recibida, cancelada).
7. Dependen: Compras Lazza (En curso/Terminadas), Ventas, IA.
8. Depende de: que todo el que mueva renglones recalcule el estado.
9. Errores: columna desincronizada de los renglones (H10); `syncOCsFromPR` escribe `estado:"pendiente"`, valor que no existe en el enum (H56).
10. Si falla: Llegó deshace; editar OC no (H11).
11. Si otro módulo cambia: mover renglones entre OC recalcula totales (trigger `recalcular_oc`) pero no el estado.
12. Pruebas: test-oc-lista, test-compras-recepcion (pasan).
13. Problemas reales: 4 OC "recibida" con 0 recibido (OC-2026-1251, 1275, 1278, 1281) y 1 "enviada" con todo recibido (1283; esta se ve bien en Lazza porque `estadoOC` también mira renglones).
14. Riesgos: mercadería no reclamada.
15. Confiabilidad: **media**.

### 2.4 Renglón del presupuesto (presupuesto_items.id) como ancla
1. Función: identificar qué se vendió, para comprar, remitir, personalizar y facturar.
2-3. Lo crean `crear_/actualizar_presupuesto_atomico`.
4-6. La edición borra todo y reinserta 17 columnas (H06, H07).
7. Dependen: orden_compra_items, remito_items, personalizacion_items, lz_oc_ajustes (todas con FK ON DELETE SET NULL).
8. Depende de: que el id sea estable (no lo es).
9-11. Al editar, los vínculos quedan NULL; `syncOCsFromPR` re-ata por código/descripción solo las OC del mismo proveedor; remitos usan heurística.
12. Pruebas: ninguna del RPC.
13. Problemas reales: 47/364 renglones de remito y 35/463 de OC sin vínculo (agentes 1 y 7).
14. Riesgos: doble pedido de un renglón que Compras movió a otro proveedor; doble entrega.
15. Confiabilidad: **baja** para la trazabilidad, alta para totales.

### 2.5 Estado del PR (venta caída / facturado)
1. Función: ciclo de la venta.
2-3. doEstadoChange (front), Ventas, seguimiento IA, cron vencimiento, Facturación (marca facturado desde el navegador), NC total (RPC).
4-6. Update directo; solo "aprobado" dispara acciones (OC).
7. Dependen: Compras, Dashboard, Oportunidades, Facturar.
9-11. Rechazo/No facturar no propaga a OC (H09); facturación marca "facturado" aunque la factura no se guardó (H13); restaurar crea OC de PR no aprobado (H45).
13. 4 OC recibidas y pagadas ($19,1 M) de PR rechazados.
15. Confiabilidad: **media**.

### 2.6 Cotización del dólar
1. Función: tipo de cambio para presupuestos, facturas USD, cobros/liquidaciones FX.
2-3. BNA (scraping), cron (service role), `/api/cotizacion-bna` (pública, sesión o anon), carga manual.
4-6. Tabla `cotizaciones_dolar`; "confiable" = `es_manual` o `fuente='BNA histórico v2'` (columnas escribibles).
7. Dependen: presupuestos (`leerDolaresGuardados`), emitir factura (pantalla), cobro masivo, fx-settlement-dialog, cobertura de fijos.
9. anon puede insertar/actualizar (H01). La emisión ARCA re-verifica contra BNA en vivo y rechaza con 409 si no coincide (mitiga); si el BNA no responde, usa la tabla.
15. Confiabilidad: **media**.

### 2.7 Conciliación bancaria (línea de extracto ↔ movimiento)
1-6. extracto_movimientos.match_movimiento_id, movimientos.extracto_movimiento_id, movimientos.conciliado.
9-11. `gestionar_cobro` (anular/eliminar) no libera la línea (no menciona "extracto" en su cuerpo); `desconciliar_movimiento` sí. Borrar gasto usa gestionar_cobro (H15).
13. 4 líneas "matcheado" contra pagos anulados (sueldos y comisiones, $2.138.200).
15. Confiabilidad: **media**.

### 2.8 Retención de Ganancias
1-6. Calculada en OP (inline) y Plan (lib), congelada en `ordenes_pago.retencion_ganancias_*` solo desde la OP.
13. 47 OP con retención, 0 sin anotar (hoy bien). Plan no anota (H25), fórmula duplicada (H26), base calculada al armar el plan (H27).
15. Confiabilidad: **media**.

### 2.9 Seguridad / aislamiento por sociedad
1-6. RLS, vistas, funciones SECURITY DEFINER, Storage, middleware.
9-13. anon: escribe cotizaciones, lee 2 vistas con datos de clientes, ejecuta KPIs/proyección/increment_stock, lee/sube archivos. authenticated: facturas_compra ALL true; ninguna política de tablas viejas filtra sociedad_id; el front con 0 filas en user_sociedades muestra todas.
15. Confiabilidad: **baja**.

## 3. Verificación adversarial de cada hallazgo

Formato: **ID — título** · Origen · Veredicto · Severidad final (antes) · Qué abrí · Motivo.

### Críticos y altos

**H01 — Cotización del dólar escribible sin login** · A5 (alto), A6 (crítico) · **Confirmado** · **alto** (A6 crítico → alto).
Abrí `pg_policies`: `cotiz_insert_anon` WITH CHECK true y `cotiz_update_anon` USING/CHECK true para `{anon}`. `middleware.ts:36` deja `/api/cotizacion-bna` pública. `bna-historical.ts:14-16` confía en `es_manual`/`fuente`, que el anónimo controla. `route.ts:425-433` (facturación) vuelve a consultar el BNA en vivo y rechaza (409) si la cotización no coincide; solo si el BNA no responde usa la tabla. En cambio `dolar-presupuesto.ts:75-90`, cobro-masivo-liquidacion.tsx:166, fx-settlement-dialog.tsx:236/269 y cobertura-fijos.tsx:132 usan la tabla/la ruta cache-first.
Motivo de bajar: la factura ARCA está protegida por la re-verificación en vivo; el daño posible queda en presupuestos, liquidaciones FX y el respaldo cuando el BNA cae. Sigue siendo alto porque la clave anon es pública y no deja rastro.

**H02 — Vistas legibles sin login (facturas pendientes, presupuestos con CUIT)** · A6 · **Confirmado** · alto.
Abrí `pg_class.reloptions`: solo `orden_compra_items_pendientes` tiene `security_invoker=true`; `v_facturas_pendientes`, `v_presupuestos_completos` y `v_comparador_precios` tienen SELECT para anon y corren como dueño (saltean RLS). A6 lo ejecutó como anon (73 y 243 filas). Además nadie en el front las usa como fuente principal (agente 7: legacy), así que revocar no rompe pantallas.

**H03 — Funciones SECURITY DEFINER ejecutables por anon sin chequeo** · A6 (alto), A2/A4 (increment_stock) · **Confirmado** · alto.
`has_function_privilege('anon')=true` y sin `auth.uid` en `get_dashboard_kpis` (ambas firmas), `get_balance_projection`, `increment_stock`, `check_presupuestos_vencidos`. `delete_presupuesto_safe` y `change_pr_operator` también son ejecutables por anon pero sí usan `auth.uid()` (anon no tiene rol → fallan): esos quedan en H62 (bajo).

**H04 — Storage público; facturas-compra escribible por anónimo** · A5, A6 · **Confirmado** · alto.
`storage.buckets`: 5 buckets `public=true`, sin límite de tamaño ni tipo. Políticas `auth insert facturas-compra` / `auth update facturas-compra` / `public read facturas-compra` con rol `{public}` (incluye anon) y `Public read comprobantes` `{anon}`.

**H05 — RLS de tablas de plata sin rol ni sociedad (facturas_compra ALL true; sin aislamiento por sociedad; comprobantes con CAE editables)** · A2 (alto), A4 (medio), A6 (alto + medio) · **Confirmado** · alto.
`facturas_compra` SELECT/INSERT/UPDATE/DELETE `true` para authenticated; `factura_compra_ocs` ALL true. `facturas`, `factura_items`, `movimientos`, `presupuestos`, `clientes`: solo por rol, ninguna con `sociedad_id`. `factura_items` modificable por administrativo aunque la factura tenga CAE, y el trigger `recalcular_factura` reescribiría el total. `auth-context.tsx:103-113`: sin filas en user_sociedades o con error → todas las sociedades (la base, en tablas nuevas, da ninguna). Consolidé tres hallazgos en uno porque la solución es la misma (políticas con `lz_es_de_sociedad` + rol + inmutabilidad fiscal).

**H06 — Editar un PR borra y recrea todos los renglones** · A1, A7 · **Confirmado** · alto.
Cuerpo de `actualizar_presupuesto_atomico`: `delete from presupuesto_items where presupuesto_id = …` + `insert` de 17 columnas. FKs `remito_items`, `orden_compra_items`, `personalizacion_items`, `lz_oc_ajustes` → `confdeltype='n'` (SET NULL). Intenté refutarlo con `syncOCsFromPR` (presupuestos-lista.tsx:1811-1907): re-ata los renglones de OC por código o descripción y escribe el nuevo `presupuesto_item_id` (1856-1867), así que las OC del mismo proveedor se recuperan. Pero: (a) `ocDeRenglon` (1829-1835) se arma con los ids nuevos, que ya no tienen vínculo, así que un renglón que Compras movió a otro proveedor vuelve a agregarse en la OC del proveedor original (doble pedido); (b) los remitos no se re-atan nunca. Se sostiene.

**H08 — Pestaña Cta. Cte. del cliente: NC como deuda, total en vez de saldo, y se envía al cliente** · A1 · **Confirmado** · alto.
`clientes/page.tsx:827-832` trae `estado='emitida'` sin filtrar tipo; 2497-2500 suma `f.total`; `handleCopiarCC`/`handleEnviarCC` (1439-1459) arman el texto con `ccFacturas` y abren `mailto:` al cliente. Datos: 16 NC en `emitida` (9 NCA $31,6 M, 5 NCB $3,6 M, 2 NCEA) con total positivo; las facturas `parcial` quedan afuera.

**H09 — Rechazar / No facturar un PR no avisa ni cancela sus OC** · A1 · **Confirmado** · alto.
`doEstadoChange` (2201-2232) solo actúa con `aprobado`. `handleDelete` sí pregunta por las OC (2331-2352) — la regla existe para eliminar pero no para rechazar. SELECT: OC-2026-1117, 1133, 1155, 1173 recibidas y pagadas, de PR rechazados (≈ $19,1 M). Es aviso, no bloqueo (respeta regla 1).

**H10 — OC que figuran Completo sin haber llegado nada** · A2 (alto); A7 dijo lo contrario · **Confirmado** · **medio** (alto → medio).
`oc-lista.ts:41` (no 412): `oc.estado === "recibida"` gana antes que los renglones. SELECT: 4 OC `recibida` con 0 recibido (1251, 1275, 1278, 1281) y OC-2026-1283 `enviada` con todo recibido (esta se ve bien porque la misma línea también mira renglones). Bajé a medio: son 4 OC de 1–3 unidades y el arreglo es S. La afirmación del agente 7 ("estados coinciden con la recomputación") se refería solo a estado_facturacion/estado_pago.

**H11 — Editar OC en Compras Lazza: pasos sin transacción y borrado con cascada** · A2 (alto) · **Confirmado** · **medio** (alto → medio).
`compras-lazza-oc.tsx:175-251`: delete de renglones, updates, insert, update de encabezado, update de presupuesto_items, cada uno con su `throw` sin deshacer. FK `factura_compra_asignaciones.orden_compra_item_id` y `lz_oc_ajustes.oc_item_id` → CASCADE. Bajé porque el borrado es el que el usuario pidió, desde el 19/10 las facturas nuevas no se atan a OC (pocas asignaciones en juego) y el daño de un corte es una OC a medio editar que se ve y se corrige.

**H12 — Total guardado de la factura distinto del autorizado por ARCA** · A4 (alto), A7 (medio, "IVA") · **Confirmado (ejecución)** · **medio** (alto → medio).
SELECT: en 20 de 120 intentos `fiscal_emission_attempts.response.factura.total` ≠ `facturas.total` (ej. FA 15-30: 9.220.848,57 vs ,56; FA 16-12: 2.616,32 vs ,33). `route.ts:799` confirma que `response.factura.total` = `totalFinal` = `ImpTotal` enviado (746). `recalcular_factura` (AFTER INSERT/UPDATE/DELETE en factura_items) redondea al final y no mira `cae`. Bajé: el efecto en plata es de ±0,01/0,02 (saldos "parcial" de un centavo, QR y Libro IVA del CRM que no cuadran al centavo); ARCA tiene el dato correcto. La versión del agente 7 ("total igual en todos") queda **refutada** en lo del total.

**H13 — Factura común autorizada por ARCA sin recuperación si falla el guardado; el PV queda trabado y el PR igual se marca facturado** · A4 (alto + medio PV + bajo pasos post-emisión) · **Confirmado** · alto.
`route.ts:795-801` marca el intento `authorized` antes del insert; 894-906 devuelve `success:true` sin id si el insert falla; 684-731 solo reanuda si `isSalesCreditNote`; para el resto devuelve la respuesta guardada (733). El índice `fiscal_emission_attempts_unresolved_pv` (único por sociedad+PV con state reserved/authorized) existe: ese PV no emite más hasta conciliar a mano. `emitir-factura-modal.tsx:476-477` y `facturacion-content.tsx:690-692` marcan el PR con `success:true`; `guardarResto(data.factura.id)` recibe `undefined`. Hoy 121 intentos `completed`, 0 trabados. Consolidé H2, H4 y H11 del agente 4. Choca con la regla 1 ("nada me puede frenar").

**H15 — Anular un cobro o borrar un gasto deja la línea del banco conciliada contra un movimiento anulado** · A7 · **Confirmado (ejecución)** · alto.
`gestionar_cobro`: `position('extracto' in prosrc)=0`; `desconciliar_movimiento` sí lo maneja. `gastos.tsx:205-212` (Borrar gasto) usa `gestionar_cobro anular` y después DELETE del gasto. SELECT: 4 líneas `matcheado` contra pagos `[ANULADO] Gasto — Sueldos/Comisiones` del 06-07/10 (589.100 ×2, 400.000, 560.000 = $2.138.200). Se sostiene.

**H16 — Pruebas de regresión rotas desde la mudanza de Finanzas y fuera del build** · A8 (alto), A1 (bajo, tests de presupuestos) · **Confirmado (ejecución)** · alto.
Corrí `node scripts/test-op-validation.mjs` (lo leí: solo lee archivos) → exit 1, `AssertionError: OP y pago directo deben compartir la validación fiscal`; línea 7 lee `src/app/(crm)/finanzas/page.tsx`, que hoy es la pantalla nueva. 12 tests leen esa ruta. `package.json` `build` = `check:hooks && next build` (sin tests).

### Medios con certeza "estático" (y otros medios)

**H07 — Los RPC del PR no guardan descuento, precio_lista, catalogo_id, pedido_texto, ia_*** · A1 (bajo), A7 (medio) · **Confirmado** · medio. La lista de columnas del insert (ver H06) no las incluye; el front las manda (`presupuestos-lista.tsx:1569-1570`).

**H11b — Aprobar un PR arma las OC en el navegador; reaprobar no completa; doble aprobación** · A1 (medio + bajo hipótesis) · **Confirmado** · medio. `generateOCsFromPresupuesto` 1930-1939 sale si existe cualquier OC viva; el estado se escribe antes (2208-2214). La doble aprobación queda como hipótesis dentro del mismo hallazgo (H44).

**H45 — Restaurar un PR eliminado le crea OC aunque no esté aprobado** · A1 · **Confirmado** · medio. `handleRestore` 2379-2388 llama `generateOCsFromPresupuesto` sin mirar estado, y esa función tampoco lo mira (1919-1923 solo trae numero, sociedad, modalidad, iva, created_by).

**H17 — Saldo de factura de compra con 7 implementaciones** · A2, A3, A6, A7, A8 · **Confirmado** · medio (A8 alto → medio).
`fc_compra_pagado`: greatest(total_acreditado, mov NC). `registrar_pago_proveedor_seguro` modo OP (migración 20261026190000:235-252): total − directos (incluye mov NC) − OP, sin total_acreditado; en modo directo usa `fc_compra_pagado` (607). `validar_saldo_aplicacion_factura_compra`: compara contra total sin NC (A6 bajo, consolidado aquí). TS: `finanzas-lazza.ts:482`, `saldo-proveedores.ts`, `orden-pago-nueva.tsx`, `plan-pagos.tsx`, `saldo-factura-compra.ts` (sin uso). Hoy coinciden porque cada NC deja los dos rastros. Medio porque no hay casos hoy.

**H18 — Pago con tarjeta cuenta dos veces el crédito de una NC** · A2 · **Confirmado** · medio. Cuerpo de `registrar_pago_tarjeta_factura_compra` líneas 28-32: suma todos los movimientos `pago` (sin excluir `nota_credito_compra_id`) **más** `total_acreditado`. `fc_compra_pagado` usa greatest. Las 4 facturas con NC tienen ambos rastros → si se pagan con tarjeta, sale de menos y queda "pagada".

**H19 — Factura de compra "pagada" sin pago: Finanzas dice 0, la base dice deuda total** · A2 (medio), A3 (bajo), A6 (medio), A7, A8 · **Confirmado (ejecución)** · medio.
SELECT: 123 FC pagadas, 3 con `fc_compra_pagado` < total (INGA NATALIA 00002-00000145 US$1.100 y 00002-00000140 US$550; PORCEL LEANDRO 0001-00000415 $500.000; las 3 de Grupo LA, tipo `mercaderia`). **Causa raíz que los agentes dejaron como hipótesis:** la opción de diseño "Ya pagada por otro medio (sin OP)" de `cargar-factura-oc.tsx:2445` → `pagadaSinOP` (228) → `estado:"pagada"` (1315) sin movimiento; la regla TS lo acepta (pagada = 0) y la SQL no. No es un error de carga: es una regla de negocio implementada en un solo lado. El fallback de `pago-tarjeta.ts:46-50` (estado y después movimiento) solo corre si falta la RPC (`faltaFuncion`), hoy no.

**H20 (NUEVO) — Pagos de Inga y Porcel de octubre registrados dos veces en Grupo LA y ninguno mueve Bancos** · Revisor · **Probable** · medio.
`gastos_manuales` 48d20099 (Inga oct US$1.100) y d41a42d0 (Porcel oct $500.000), Grupo LA, con nota "Pagado por Grupo LA desde Galicia CC … el 09/10/2026", sin movimiento; y a la vez las FC C 00002-00000145 (US$1.100, fecha 01/10) y 0001-00000415 ($500.000, fecha 01/10) en `pagada` sin movimiento (H19). El mismo pago figura como gasto y como factura pagada; ninguno resta en la cuenta Galicia. No verifiqué si Reportes/Estado de resultados suma ambos (por eso "probable"). Conecta H19 (agentes 2/3/6/7/8) con H21 (agente 3), que los vieron por separado.

**H21 — Gastos: alta en dos pasos y borrado físico** · A3 (medio) · **Probable** · **bajo** (medio → bajo).
Código confirmado: `gastos.tsx:182-190` (insert gasto, después insert movimiento; si falla solo `toast.warning`) y 205-212 (anula pago y borra gasto aunque falle la anulación). **Evidencia de datos refutada:** de los 4 "gastos sin pago", 3 vienen a propósito de migraciones (`20261016090000_gastos_fijos_octubre_pagados.sql` dice "NO crea movimiento de pago", pedido de Augusto 16/10; Inga/Porcel con nota de pago desde Galicia); solo "Compra crédito fiscal IVA — FC 00005-00019878" ($1.616.059,20, efectivo, 29/09, sin notas) no tiene explicación. El daño real del borrado ya está contado en H15.

**H22 — Factura de compra pagada de más en $219.548** · A6 · **Confirmado (ejecución)** · medio. SELECT: 0007-00024709 total 804.129,86, OP-000047 aplicó 1.023.677,92, total_acreditado 0, estado pagada. Único trigger en facturas_compra: `lz_fact_pago_oc` (no revalida el total). Causa del cambio: hipótesis.

**H23 — Mismo número de factura de compra pagado dos veces (Speed Business)** · A2, A6 · **Probable** · medio. SELECT: SPEED BUSINESS 4240-00004929 tipo transporte, 2 registros, ambos pagados, $58.758,64. La migración 20261007113000 permite a propósito dos documentos con igual número (dos viajes) y su trigger solo impide el **mismo id** dos veces en una OP (no habría frenado esto); además ese trigger no existe en la base (A6). Puede ser legítimo (una factura que cubre dos viajes cargada en dos mitades) o un pago doble: hace falta ver el PDF.

**H24 — Proveedores duplicados por CUIT con guiones** · A2 · **Confirmado (ejecución)** · medio. SELECT: NESTLE (30546764040 y 30-54676404-0) y FERNANDEZ ANDRES ALBERTO (20252946358 y 20-25294635-8), ambos en Lazzari.

**H25 — OP del Plan de pagos sin retención congelada** · A3 · **Confirmado** · medio. `opRetencionAnotada` solo en `orden-pago-nueva.tsx:554/889/991`; `plan-pagos.tsx:386` llama al RPC sin anotar. Datos: 47 OP con retención, 0 sin anotar (hoy no hay pagos de plan con retención).

**H26 — Retención Ganancias con dos fórmulas (OP vs Plan)** · A3 (medio), A8 (bajo) · **Confirmado** · bajo. `orden-pago-nueva.tsx:536` usa `pctRetencion` (que en escala redondea la alícuota a 2 decimales, `retencion-conceptos.ts:65`); `plan-pagos.ts:85` usa `retencionEscala` exacta. Diferencia de pesos solo en honorarios.

**H27 — Plan de pagos usa la retención calculada al armar** · A3 · **Probable** · medio. No re-verificado en código; consistente con H25 (el plan manda lo guardado al RPC).

**H28 — Saldo de factura de venta: implementaciones paralelas** · A4 (NC RPC), A7 (NC RPC), A5 (agente-mail, asistente), A1 (Consumo) · **Confirmado** · medio.
`registrar_nota_credito_venta_autorizada` 157-169: suma movimientos con `factura_id` **sin excluir** los que tienen aplicaciones (`lz_cobrado_factura` sí excluye). `finanzas/asistente/route.ts:60-73`: total − aplicaciones − acreditado, sin cobros directos y **sin filtrar tipo** (las 16 NC en `emitida` aparecen como deuda en el asistente: detalle nuevo). `agente-mail-server.ts:129-145`: misma fórmula, `.limit(3000)` (PostgREST corta en 1000). Hoy 0 casos de solapamiento; 24 cobros directos sin aplicación (A5) que estas fórmulas ignoran.

**H29 — Dos definiciones de saldo a favor del cliente** · A7 · **Confirmado** · medio. `saldo-clientes.ts:133-138` suma `saldo_a_favor_cliente` de NC; `saldo-favor-cliente.ts:20-23` (y la RPC `aplicar_saldo_favor_cliente`) solo ajustes crédito sin factura. SELECT: NCB 15-5 con $59.500,24 a favor (y NCEA 15-1 con 0,01) que la CC muestra y "Aplicar saldo a favor" no ofrece.

**H30 — Columna vieja saldo_cuenta_corriente usada para el aviso de límite de crédito** · A3 (bajo), A6 (medio), A7 (medio) · **Confirmado** · bajo. `presupuestos-lista.tsx:311` lee `clientes.saldo_cuenta_corriente`. Hoy ningún cliente tiene límite cargado → sin efecto. Bajo por latente.

**H31 — Anular / revertir factura sin CAE por update directo** · A7 (medio), A4 (parte del RLS) · **Confirmado** · medio. `facturacion-content.tsx:705-727`: `update estado='anulada'/'emitida'` sin mirar cobros, NC ni PR.

**H32 — Facturación masiva elige FA/FB con otra regla (monotributistas)** · A4 · **Confirmado** · medio. `facturacion-content.tsx:660-661` (solo RI → FA) vs `factura-condicion.ts:55-57` (RI y Monotributo → FA). El propio código dice "PENDIENTE DE VERIFICAR EN PRODUCCIÓN".

**H33 — Liquidar transporte crea la FC como 'mercaderia'** · A4 (medio) · **Confirmado** · bajo (medio → bajo: clasificación, sin plata). `transportes/page.tsx:468`.

**H35 — ai-presupuesto lee sin sesión** · A5 (medio) · **Confirmado** · bajo (medio → bajo). `ai-presupuesto/route.ts:22-26`: `createServerClient` con anon y `getAll: () => []`; políticas de listas solo authenticated. Además `lista_precios_items` vigentes = 0, así que la función no aporta nada por dos motivos; no pierde datos.

**H36 — Tres crons fallan abiertos sin CRON_SECRET** · A5 (medio), A6 (bajo) · **Confirmado** · bajo. agente-mail:15, bcra:20 (`if (cronSecret && …)`), presupuestos-vencimiento:119-125 (`if (cronSecret) {…}`); cotizacion:71 falla cerrado. Hoy la variable existe.

**H37 — Dos reglas de cotización para facturas** · A5 (medio) · **Confirmado** · bajo (medio → bajo). `cotizacion-bna/route.ts:175-178` cache primero; `invoice-exchange-rate.ts:17-31` BNA primero. Si no coinciden, la ruta de facturación devuelve 409 y no emite (no factura mal; puede trabar en casos límite).

**H38 — email/send: remitente desde el navegador y descarga de URLs** · A5 (bajo), A6 (medio) · **Confirmado parcial** · bajo. `route.ts:62-71`: facturas/OP/recibos/resumen salen siempre de administracion@ (fijo); PR/remitos/OC usan `userEmail` del body. La suplantación queda acotada a documentos comerciales.

**H39 — Dashboard: tasa de conversión solo con 'aprobado'** · A1 · **Confirmado** · medio. Cuerpo de `get_dashboard_kpis(uuid)` líneas 98-101.

**H40 — Alertas del trigger de PR sin sociedad** · A1 · **Confirmado** · bajo. `presupuesto_estado_alert` inserta sin `sociedad_id` (líneas 6 y 15 del cuerpo).

**H41 — Clientes > Consumo: solo 'aprobado' y total mezcla monedas, anuladas y NC** · A1 · **Confirmado** · medio. `clientes/page.tsx:600-641`.

**H42 — OC con costos en pesos y dólares suman como pesos** · A1 · **Confirmado** · medio. `presupuestos-lista.tsx:1893-1894` (mixto → "ARS"); `recalcular_oc`/`lz_recalcular_totales_oc` no convierte. Ejecución del agente (OC-2026-1242), no re-ejecutado.

**H43 — Margen mínimo: tres fórmulas** · A1 · **Confirmado** (por ejecución del agente, no re-ejecutado) · medio.

**H46 — Duplicar PR copia fecha, vencimiento, eliminado e ia_*; renglones sin chequeo** · A1 · **Confirmado** · bajo. `handleDuplicate` 2294-2314.

**H47 — Recepción vieja mueve stock; Compras Lazza no; increment_stock sin control** · A2 (bajo), A8 (medio), A4 (mejora) · **Confirmado** · bajo (A8 medio → bajo: `productos` tiene 0 filas, el stock no se usa; regla "no tocar stock sin aviso").

**H48 — Operaciones multi-paso en pantallas activas (Llegó, cargar-factura-oc, pago-tarjeta)** · A8 (medio), A2 (bajo Llegó) · **Probable** · bajo. El fallback de `pago-tarjeta.ts` solo corre si la RPC no existe; "pagada sin movimiento" en cargar-factura-oc es por diseño (H19). Llegó sin concurrencia: riesgo.

**H49 — Tipos generados desactualizados y 550 'supabase as any'** · A8 · **Confirmado** · medio. 34 bloques `Row: {` en `database.types.ts`; 550 ocurrencias de `supabase as any`.

**H50 — Ejes factura/pago de OC sin alimentar desde 19/10 y todavía leídos** · A2 · **Confirmado** (ejecución del agente) · medio.

**H51 — Dos circuitos de carga de facturas de compra vivos** · A2 · **Probable** · medio (relacionado con H23 y H19).

**H53 — Borrar una FC pagada borra en cascada el vínculo con la OP** · A6 · **Confirmado** · medio. FK `op_facturas_compra` → CASCADE; `movimientos` → RESTRICT/NO ACTION (un pago directo sí frena el borrado; una OP no).

**H56 (NUEVO) — Editar un PR falla en silencio al actualizar el encabezado de sus OC (estado 'pendiente' no existe)** · Revisor · **Confirmado** · bajo. `presupuestos-lista.tsx:1899` escribe `estado:"pendiente"` en `ordenes_compra.estado`, enum `oc_status` = {borrador, enviada, confirmada, recibida_parcial, recibida, cancelada}. Cuando no llegó nada, el update completo (subtotal, iva, total, moneda, estado) falla y el error no se mira. Totales igual quedan bien por el trigger `recalcular_oc`; la **moneda** del encabezado no se actualiza si cambia la moneda de costo.

**H57 — Ventas asume una sola factura por PR** · A1 · **Probable** · bajo (medio → bajo: 0 PR con 2 facturas vigentes, 1 resto).

**H58 — Consultas sin paginar cerca de 1000 filas** · A1, A4 · **Probable** · medio. Incluye `agente-mail-server.ts:129` `.limit(3000)` (PostgREST devuelve máx. 1000).

### Bajos y mejoras (no exigían re-verificación; veredicto según lo que pude ver)
- H59 Personalización multi-paso (A1) — probable, bajo (0 trabajos).
- H60 Muestras "Se la quedó" sin facturar (A1) — probable, mejora.
- H61 Pantallas gigantes y duplicadas vivas por URL (A8, A3 Finanzas vieja, A2 Compras vieja) — confirmado, mejora medio.
- H62 delete_presupuesto_safe / change_pr_operator sin sociedad (A6) — confirmado parcial (ejecutables por anon pero usan auth.uid), bajo.
- H64 Índice único de facturas sin sociedad_id (A4) — confirmado (`facturas_tipo_punto_venta_numero_key`), bajo: solo afecta X (PV 0); los PV fiscales son distintos por sociedad.
- H65 API manual acepta NC/ND sin origen (A4) — probable, bajo.
- H66 cuit-lookup baja TLS del proceso (A5) — probable, bajo. Nota: `package.json` build ya usa `--tls-cipher-list=DEFAULT@SECLEVEL=0` para todo el build.
- H67 Lista de precios con IA (A5) — probable, bajo (vía paralela a la regla 7).
- H68 Tope de gasto IA y precios a mano (A5) — probable, mejora.
- H69 Agente de mail: error transitorio queda procesado (A5) — probable, bajo.
- H70 Aviso de 5 días del PR nunca se crea (A1, A5) — confirmado (`presupuestos-vencimiento/route.ts:34-35` mismo title), bajo.
- H71 ARQUITECTURA.md desactualizado (A5) — probable, mejora.
- H72 Control de acceso por rol distinto en cada pantalla (A8) — probable, bajo.
- H73 Stock sin kardex (A4) — confirmado, mejora.
- H75 Eje pago de OC distinto en cliente y base (A2) — probable, bajo.
- H76 Código muerto (`compras-lazza-facturas-oc.tsx`, `saldoFacturaCompra` de saldo-factura-compra.ts, trigger recalcular_saldo_proveedor) (A2, A8) — probable, mejora.
- H77 Cobro con saldo a favor en dos transacciones (A3) — probable, bajo.
- H78 registrar_pago_proveedor_seguro con control de sociedad laxo (A3) — probable, bajo.
- H79 Finanzas vieja handlePagarOP (A3) — probable, mejora.
- H80 Conciliado con tres significados (A7) — confirmado por ejecución del agente, bajo.
- H81 CC sin deuda previa al CRM (A7) — mejora.
- H82 Centavos y columnas muertas (A7) — mejora (la NCEA 0,01 se explica por H12).
- H83 Migraciones: registro cortado al 08/10 (132 filas, última 20261008120000), 176 archivos vs 127 rollback (49 sin rollback, no 50), trigger de 20261007113000 ausente (A6, A8) — confirmado, bajo.
- H84 Dividir remito (A4) — ver H14.
- H14 — **Dividir remito borra todos los renglones antes de reinsertar y no revisa errores** · A4 (alto) · **Confirmado** · **medio** (alto → medio). `remitos/page.tsx:526-589`: update, delete, insert, `next_cai_number`, insert, ninguno mira `{error}` salvo el insert del remito nuevo. Bajé porque solo hay 2 remitos divididos y 0 remitos sin renglones: es riesgo, no daño observado.

## 4. Hallazgos nuevos del contraste de conexiones

1. **H20** — mismo pago (Inga/Porcel oct, Grupo LA) como gasto manual y como FC "pagada", sin movimiento bancario. Lo vieron por separado A3 (gastos sin pago) y A2/A6/A8 (FC pagadas sin pago).
2. **H19 causa raíz** — la "pagada sin pago" viene de la opción de diseño "Ya pagada por otro medio" (cargar-factura-oc.tsx:2445/1315); la SQL no conoce esa excepción.
3. **H56** — `syncOCsFromPR` escribe un estado de OC que no existe.
4. **H28 detalle** — el asistente de Finanzas lista las NC como facturas a cobrar.
5. **H15 ↔ H21** — las 4 líneas de banco huérfanas son exactamente el resultado de "Borrar gasto" (gastos.tsx:205-212): el defecto de A7 tiene su disparador en el código que revisó A3.
6. **H01 matiz** — la emisión ARCA está mitigada por la re-verificación en vivo (route.ts:425-433); el riesgo real está en presupuestos y liquidaciones FX, que ninguno de los dos agentes separó.
7. **H23 ↔ H83** — la protección contra duplicados en OP (20261007113000) ni existe en la base ni habría frenado el caso Speed Business (compara ids, no números).

## 5. Contradicciones entre agentes

1. **Total de facturas vs ARCA:** A4 "20/120 totales difieren" vs A7 "total igual en todos, difiere el IVA en 24/145". Verificado: el total difiere en 20/120 contra lo enviado a ARCA (`ImpTotal`). A7 refutado en el total; ambos coinciden en la causa (trigger `recalcular_factura`).
2. **Saldo de factura de venta "una sola regla":** A3 lo afirma; A4/A7 (NC RPC), A5 (agente-mail, asistente) y A1 (pestaña Cta. Cte., Consumo) muestran implementaciones distintas. Lo correcto: el núcleo es único (saldo-clientes.ts = lz_cobrado_factura) pero hay 5 consumidores con fórmula propia.
3. **Estados de OC:** A7 "OC alta, estados coinciden con la recomputación" vs A2 "5 OC con estado de mercadería mal". A7 solo comparó estado_facturacion/estado_pago; A2 tiene razón para el eje mercadería (4 visibles).
4. **Saldo a favor del cliente:** A3 "Cobrar/saldo a favor: alta" vs A7 "dos definiciones, $59.500 inaplicable". A7 confirmado.
5. **Gastos sin pago:** A3 los atribuye al alta en dos pasos; los datos muestran que 3 de 4 se crearon a propósito sin movimiento (migraciones de gastos fijos, pedido de Augusto).
6. **Severidad de la cotización:** A6 crítico vs A5 alto → alto (mitigación en la ruta de facturación).
7. **Severidad de crons fail-open:** A5 medio vs A6 bajo → bajo.
8. **Severidad de email/send:** A5 bajo vs A6 medio → bajo (remitente fijo para documentos administrativos).
9. **Prueba de saldo de FC:** A6 lista como "bien hecho" que `test-saldo-factura-compra.ts` coincide con `fc_compra_pagado`; A2/A8 muestran que esa función (`lib/saldo-factura-compra.ts#saldoFacturaCompra`) no la usa ninguna pantalla. La prueba pasa sobre código muerto: no protege a Finanzas, OP ni Plan.
10. **Severidad del saldo de FC:** A8 alto vs A2/A3/A7 medio → medio (0 casos hoy).
11. **Facturación ARCA:** A7 "alta" vs A4 "media". A4 tiene razón: la falta de recuperación para facturas comunes (H13) y el total distinto (H12) son reales; A7 los menciona pero no los pesó.
12. **Paginación:** A6/A8 "listados grandes paginados con traerTodo" vs A1/A4 "consultas sin paginar en presupuestos, remitos, stock, ventas". Ambos ciertos en su alcance: las pantallas de Finanzas paginan, las comerciales/logística no.
13. **Rollback faltante:** A6 dice 50, A8 dice 50 con 176 vs 127 archivos (= 49). Diferencia menor.
14. **Referencias de línea:** A2 cita `lib/oc-lista.ts:412-435`; el archivo tiene 101 líneas (la lógica está en 39-42). El hallazgo se sostiene igual.
15. **Límite de crédito:** A3 bajo vs A6/A7 medio → bajo (sin límites cargados).

## 6. Causas raíz estructurales (por qué arreglar algo rompe otra cosa)

1. **Reglas de negocio copiadas en vez de una función única.** Saldo de FC (7 lugares), saldo de venta (6), estado de OC (4), margen (3), retención (2), FA/FB (2), cotización (2), saldo a favor cliente (2). Cada arreglo se hace en una copia y las otras quedan con la regla vieja.
2. **Dos fuentes de verdad para el mismo dato:** columna guardada + cálculo (facturas_compra.estado vs fc_compra_pagado; ordenes_compra.estado vs cantidad_recibida; clientes.saldo_cuenta_corriente vs saldo-clientes; facturas.total vs ImpTotal de ARCA; conciliado vs match_movimiento_id). Las excepciones de negocio ("pagada por otro medio") se implementan en un solo lado.
3. **Operaciones de varios pasos armadas en el navegador sin transacción:** aprobar PR → OC, editar OC, dividir remito, gastos, anular/revertir factura, marcar PR facturado, liquidar personalización. Lo nuevo de plata (cobros, OP, NC) ya pasó a RPC; lo demás no.
4. **Reemplazo destructivo en vez de actualizar por id, con FKs SET NULL/CASCADE silenciosas:** el PR borra y recrea renglones; el remito dividido borra y reinserta; borrar una FC cascada a la OP. Los vínculos se pierden sin error.
5. **Estados que no se propagan:** PR rechazado → OC; anular movimiento → extracto; anular factura → cobros/PR; mover renglones → estado OC; factura autorizada sin guardar → PR "facturado".
6. **La seguridad y el aislamiento por sociedad viven en el front:** RLS `true` o solo por rol, vistas sin security_invoker, funciones definer abiertas a anon, buckets públicos, rutas públicas; el front tiene además la regla opuesta a la base para "sin sociedades".
7. **Pantallas viejas vivas por URL con su propia lógica de escritura:** finanzas-vieja, ordenes-compra, carga masiva, cargar-factura-oc. Los arreglos en la nueva no llegan a la vieja.
8. **Sin red de seguridad automática:** tests que leen texto de archivos movidos (rotos y fuera del build), tipos de la base del 08/10 con 550 `as any`, migraciones sin registro desde 08/10. Un cambio de esquema o de regla no rompe la compilación ni ningún test.
9. **Triggers de recálculo sin guardas de dominio:** `recalcular_factura` no distingue comprobantes con CAE; `auto_estado_oc` solo sube; `recalcular_saldo_*` mantiene columnas que ya no son la verdad.

## 7. Lo que está bien (confirmado por varios agentes y por mí)
- Cobros: RPC atómicas e idempotentes; estado de factura de venta = recomputación (0 diferencias, A3/A6/A7).
- OP: `registrar_pago_proveedor_seguro` idempotente, con candado por proveedor; 0 OP vivas sin movimiento; retención congelada en las 47 OP.
- Emisión ARCA: reserva por intento, lock por PV, un solo intento a WSFE, número de ARCA; la NC tiene reanudación completa; la ruta re-verifica la cotización contra BNA en vivo.
- `guardar_conciliacion_compra`, `anular_factura_compra`, `aplicar_cruces_extracto` bien diseñadas.
- `syncOCsFromPR` ya intenta conservar lo recibido y re-atar renglones (mitiga parte de H06).
- `handleDelete` del PR sí pregunta por cancelar OC (falta lo mismo al rechazar).

## 8. Conexiones resumidas (fuente de verdad única propuesta)
| Dato | Fuente única propuesta | Consumidores a alinear |
|---|---|---|
| Saldo factura venta | `lz_cobrado_factura` / `saldo-clientes.ts` | NC RPC, agente-mail, asistente Finanzas, Clientes Cta. Cte. y Consumo |
| Saldo factura compra | `fc_compra_pagado` (+ decidir "pagada por otro medio" como ajuste registrado) | RPC OP modo OP, trigger validador, RPC tarjeta, finanzas-lazza, saldo-proveedores, OP, Plan |
| Estado mercadería OC | renglones (cantidad_recibida) + trigger único que suba y baje | oc-lista, Llegó, edición, mover renglones, syncOCsFromPR |
| Renglón del PR | id estable (upsert por id) | OC, remitos, personalización, ajustes |
| Total de factura | lo enviado a ARCA | trigger recalcular_factura, PDF/QR, IVA |
| Línea de banco | match_movimiento_id liberado al anular | gestionar_cobro, borrar gasto, rechazo de cheque |
| Saldo a favor cliente | un solo tipo de registro (ajuste crédito) | CC, Aplicar saldo a favor, NC |
| Cotización | tabla escrita solo por servidor | presupuestos, FX, facturación |
