# Agente 7 — Flujos de negocio completos y fuentes de verdad

Auditoría de SOLO LECTURA (28/10/2026). No se modificó ningún archivo del repo salvo este. Consultas a la base: solo SELECT con `scripts/lectura/sql.cjs` (transacción READ ONLY). No se llamó a ARCA, Resend, Anthropic, BCRA ni a ningún servicio externo. No se levantó el servidor.

Convención de certeza: **ejecucion** = confirmado corriendo algo (SELECT sobre la base real o test); **estatico** = confirmado leyendo código/funciones con referencia exacta; **riesgo** = fundamentado pero sin caso real hoy; **hipotesis**.

No se exponen datos personales: solo conteos, montos agregados e identificadores de comprobante.

---

## 1. Alcance revisado

### Documentación
- `docs/ARQUITECTURA.md`, `CLAUDE.md`, memoria del proyecto (reglas de negocio: avisar nunca bloquear, remito hecho = entregado, cheques los mueve el banco, nada se asigna solo).

### Código (crm/app/src)
- `lib/saldo-clientes.ts` (CC clientes, cobrado por factura), `lib/saldo-proveedores.ts` (CC proveedores), `lib/saldo-factura-compra.ts`, `lib/finanzas-lazza.ts` (`saldoFacturaCompra`, `armarVencimientos`), `lib/saldo-favor-cliente.ts`, `lib/saldo-favor-proveedor.ts` (cabecera), `lib/estado-factura-venta.ts`, `lib/pago-tarjeta.ts`, `lib/remitos-armado.ts` (vínculo renglón PR), `lib/cobro-reparto.ts` (cabecera).
- `app/api/facturacion/route.ts` (emisión manual y ARCA, guardado de factura e ítems, NC).
- `app/(crm)/facturacion/facturacion-content.tsx` (facturación masiva, anular/revertir/eliminar, límite de crédito).
- `components/presupuestos/presupuestos-lista.tsx` (edición de PR, aviso de límite de crédito) — **ojo: este archivo tiene cambios sin commitear de otro chat; solo se leyó.**
- `components/finanzas-lazza/datos.ts`, `gastos.tsx` (borrar gasto), `ajuste-manual.tsx`.
- `app/(crm)/clientes/page.tsx` (saldo CC).

### Base de datos (funciones, triggers, vistas)
- Triggers de `movimientos`, `cobro_aplicaciones`, `facturas`, `factura_items`, `facturas_compra`, `factura_compra_ocs`, `orden_compra_items`, `ordenes_compra`, `ordenes_pago`.
- Funciones: `registrar_cobro`, `registrar_cobro_masivo`, `gestionar_cobro`, `lz_cobrado_factura`, `lz_estado_factura_por_cobro`, `recalcular_saldo_cliente(_from_aplicacion)`, `recalcular_saldo_proveedor`, `registrar_nota_credito_venta_autorizada`, `recalcular_factura`, `fc_compra_pagado`, `validar_saldo_aplicacion_factura_compra`, `registrar_pago_proveedor_seguro`, `anular_orden_pago_segura` (partes), `aplicar_saldo_favor_proveedor` (partes), `lz_actualizar_fact_pago_oc`, `lz_trg_fact_pago_oc`, `auto_estado_oc`, `guardar_conciliacion_compra` (partes), `rechazar_cheque_recibido`, `desconciliar_movimiento`, `actualizar_presupuesto_atomico`, `crear_presupuesto_atomico` (insert de ítems).
- Permisos (ACL / `auth.uid()` / control de sociedad) de 17 RPC de plata.
- Vistas legacy `v_facturas_pendientes`, `v_cuenta_corriente_*`.

### Tablas consultadas (solo conteos)
`facturas`, `factura_items`, `movimientos`, `cobro_aplicaciones`, `recibo_movimientos`, `nota_credito_venta_aplicaciones`, `notas_credito`, `presupuestos`, `presupuesto_items`, `presupuesto_restos_facturar`, `remitos`, `remito_items`, `ordenes_compra`, `orden_compra_items`, `factura_compra_asignaciones`, `factura_compra_ocs`, `facturas_compra`, `ordenes_pago`, `op_facturas_compra`, `saldos_favor_proveedor`, `echeqs`, `extracto_movimientos`, `clientes`, `personalizacion_items`.

### Tests corridos (leídos antes; puros, sin base ni red)
- `npx.cmd tsx scripts/test-saldo-clientes.ts` → OK
- `npx.cmd tsx scripts/test-saldo-proveedores.ts` → OK (incluye "pagada sin pago no es deuda")
- `node scripts/test-saldo-favor-cliente.cjs` → OK
- `npx.cmd tsx scripts/test-finanzas-lazza.ts` → OK
- `node scripts/test-estado-factura-venta.mjs` → OK

---

## 2. Mapa de fuentes de verdad (punta a punta)

| Dato | Fuente de verdad real | Quién la escribe | Quién la lee | Copias / cálculos paralelos |
|---|---|---|---|---|
| Renglones del PR | `presupuesto_items` | `crear_/actualizar_presupuesto_atomico` (borra y recrea), `guardar_conciliacion_compra` (costos) | Facturación, Remitos, Compras (OC por renglón), Personalización | Ninguna, pero los **IDs cambian en cada edición** (H2) |
| Estado del PR | `presupuestos.estado` | UI PR, facturacion-content (`facturado`, paso separado), NC total (`facturar`), cron vencimiento | Listas, facturación masiva | `facturadoIds` en presupuestos-lista se arma también desde `facturas.presupuesto_id` |
| Entregado | `remito_items` (no anulados) por `presupuesto_item_id` | Remitos | remitos-armado (pendiente por renglón) | `presupuesto_items.entregado` / `.facturado` (boolean) **nunca se escriben** (0 de 837 en true) |
| Recibido de proveedor | `orden_compra_items.cantidad_recibida` | Recepción | `auto_estado_oc` → `ordenes_compra.estado`; remitos-armado ("llegó") | — |
| Factura de venta (importes) | `facturas.subtotal/iva/total` | route.ts (valores enviados a ARCA) **y luego** trigger `recalcular_factura` desde `factura_items` | Todo | Dos reglas de redondeo (H6) |
| Cobrado de una factura | `movimientos.factura_id` (sin aplicaciones) + `cobro_aplicaciones` de movimientos no anulados | `registrar_cobro(_masivo)`, `aplicar_saldo_favor_cliente`, `gestionar_cobro` | `lz_cobrado_factura` (SQL), `cobradoPorFactura` (TS) | Tercera versión en `registrar_nota_credito_venta_autorizada` (H7). TS además descarta movimientos en otra moneda (SQL no) |
| Estado de factura venta | `facturas.estado` | `lz_estado_factura_por_cobro`, `gestionar_cobro`, NC RPC, `handleAnular/handleRevertirAnulacion` (update directo) | Listas, cobro (solo `emitida/parcial/vencida` se cobran) | `estadoVisibleFactura` (TS) agrega vencida/cheque rechazado; Finanzas Lazza muestra "no cobrada" hasta que el cheque se acredite |
| NC aplicada a factura | `facturas.total_acreditado` (origen) | NC RPC, `crear_nota_credito_manual_venta(_multiple)` | saldo-clientes, cobros | `facturas.credito_aplicado` en la NC y `nota_credito_venta_aplicaciones`; NC viejas con `credito_aplicado=0` (legacy) |
| Saldo a favor cliente | **Dos definiciones** (H4) | NC RPC (`saldo_a_favor_cliente`), cobros (ajuste crédito), ajuste manual | CC: saldo-clientes; Aplicable: saldo-favor-cliente / `aplicar_saldo_favor_cliente` | — |
| Saldo CC cliente | Calculado en TS (`calcularSaldosClientes`) | — | Clientes, Facturación, Ficha 360, Finanzas | `clientes.saldo_cuenta_corriente` lo **sigue escribiendo** un trigger legacy con otra fórmula y lo lee el aviso de límite en Presupuestos (H10) |
| Pagado de factura compra | **Tres reglas** (H5) | — | `fc_compra_pagado` (SQL), trigger `validar_saldo_aplicacion_factura_compra` y RPC de pago, `calcularSaldosProveedores`/`saldoFacturaCompra` (TS) | — |
| Estado factura compra | `facturas_compra.estado` | RPC de pago, anular OP, pago tarjeta, conciliación | OP, plan de pagos (solo `pendiente/recibida`) | — |
| Estado facturación / pago de OC | `ordenes_compra.estado_facturacion/estado_pago` | `lz_actualizar_fact_pago_oc` (trigger) **y** `guardar_conciliacion_compra` (misma regla copiada) | Compras | 3 vínculos factura↔OC: `facturas_compra.orden_compra_id` (viejo), `factura_compra_ocs`, `factura_compra_asignaciones` |
| Retención Ganancias practicada | `ordenes_pago.retencion_ganancias_*` + movimiento `retencion_ganancias` | RPC de pago | SICORE, certificados, plan | Coinciden en las 90 OP vigentes (0 diferencias) |
| Saldo a favor proveedor | `saldos_favor_proveedor` + OP sin facturas + ajustes + pagos sobre facturas anuladas | RPC de pago, `aplicar_saldo_favor_proveedor` | CC proveedores (todo) vs aplicable (solo OP) | Misma asimetría que clientes, menor |
| Conciliado con banco | **Ambiguo** (H9) | `movimientos.conciliado` (lo pone true el RPC de pago sin banco), `movimientos.extracto_movimiento_id`, `extracto_movimientos.match_movimiento_id` | Bancos, Finanzas | Dos vínculos inversos que no siempre se escriben juntos |
| Cheques | `echeqs.estado` (lo define el banco) | OP (entregado/endosado), cobros, rechazo, reportes banco | Cartera, OP | Anular cobro/OP no cambia cheques (decisión de negocio) |

---

## 3. Módulos (15 puntos cada uno)

### M1. Presupuesto y renglones (PR)
1. **Función:** cotizar al cliente; base de OC a proveedor, remitos, facturación y personalización.
2. **Recibe:** cliente, renglones (código, descripción, cantidad, costo, markup, precio, IVA, proveedor, descuento, lista).
3. **De dónde:** UI presupuestos-lista, IA/asistente, cotización express.
4. **Operaciones:** `crear_presupuesto_atomico`, `actualizar_presupuesto_atomico` (update cabecera + **delete de todos los ítems + insert**), triggers `calcular_totales_presupuesto_item` y `recalcular_presupuesto`.
5. **Modifica:** `presupuestos`, `presupuesto_items`; al editar también `ordenes_compra` vía `syncOCsFromPR` (cliente).
6. **Guarda:** `presupuestos`, `presupuesto_items`.
7. **Dependen:** OC (`orden_compra_items.presupuesto_item_id`), remitos (`remito_items.presupuesto_item_id`), personalización, `lz_oc_ajustes.pr_item_id`, facturación (ítems), conciliación de compras (escribe costos al PR).
8. **Depende de:** catálogo/listas, clientes, cotización.
9. **Errores posibles:** pérdida de vínculos por recreación de ítems; columnas que el RPC no guarda.
10. **Si falla:** el RPC es atómico (bien). `syncOCsFromPR` y `guardarEnvioInterno` corren después, fuera de la transacción: si fallan, PR guardado y OC sin sincronizar.
11. **Si otro módulo cambia sus datos:** la conciliación de compras pisa `precio_costo` de `presupuesto_items` (por diseño: "costo OC → PR"); si después se edita el PR, el costo viene del formulario abierto.
12. **Pruebas:** no hay prueba del RPC; hay pruebas de libs de armado (test-compras-armado, etc.).
13. **Problemas reales:** H2 (47 renglones de remito y 35 de OC sin vínculo, ejecucion), H3 (descuento/precio_lista/catalogo_id no se guardan, ejecucion).
14. **Riesgos:** editar un PR ya facturado o remitido no está bloqueado ni avisado (`handleEditPR` no mira estado); por la regla "nunca bloquear" debería al menos avisar y conservar IDs.
15. **Confiabilidad: media** — cabecera y totales sólidos (RPC atómico, triggers), pero la identidad de los renglones no es estable.

### M2. Facturación de venta (ARCA) — `api/facturacion/route.ts`
1. **Función:** emitir FA/FB/FCE/NC en ARCA y registrar el comprobante.
2. **Recibe:** tipo, cliente, PV, ítems, moneda/TC, PR, OC cliente, NC origen.
3. **De dónde:** facturacion-content (individual y masiva), Finanzas Lazza > Facturar.
4. **Operaciones:** validación, reserva idempotente (`fiscal_emission_attempts`), WSFE, insert `facturas`, insert `factura_items` (dispara `recalcular_factura`), NC vía `registrar_nota_credito_venta_autorizada`.
5. **Modifica:** `facturas`, `factura_items`, `fiscal_emission_attempts`; NC: factura origen (`total_acreditado`, estado) y PR (`facturar`).
6. **Guarda:** idem.
7. **Dependen:** cobros, CC, Libro IVA / Finanzas IVA, reportes, comisiones.
8. **Depende de:** clientes (CUIT, condición IVA), PR, cotización BNA, certificados ARCA (Vercel).
9. **Errores posibles:** totales locales distintos de ARCA por redondeo (H6); ítems no guardados (queda `reconciliation_required`, bien manejado).
10. **Si falla:** si ARCA autoriza y el insert local falla, la respuesta lo dice y bloquea reemitir (muy bien). En **facturación masiva** el PR pasa a `facturado` en un update separado desde el navegador (`facturacion-content.tsx:692`); si falla, solo se avisa en el resultado.
11. **Si otro módulo cambia:** editar `factura_items` de una factura con CAE recalcularía sus totales (trigger sin guarda de CAE); hoy ningún código de la app edita ítems de facturas emitidas.
12. **Pruebas:** varias de FCE, fiscal date, emisión SQL (no corridas: tocan rutas/ARCA o requieren base).
13. **Problemas reales:** H6 (IVA guardado ≠ enviado a ARCA en 24/145 comprobantes por 0,01–0,02).
14. **Riesgos:** modo manual (sin CAE) inserta factura e ítems en dos pasos sin transacción (`route.ts:325-374`): si el insert de ítems falla, solo se loguea.
15. **Confiabilidad: alta** en el circuito fiscal (idempotencia, bloqueo de reemisión); **media** en la coherencia de importes guardados.

### M3. Cobros, recibos y retenciones sufridas
1. **Función:** registrar lo que paga el cliente (medios + retenciones) y aplicarlo a facturas.
2. **Recibe:** factura(s), renglones/medios, retenciones, fecha, cheques.
3. **De dónde:** facturacion-content (`registrar_cobro_seguro`), cobro masivo / liquidación (`registrar_cobro_masivo_seguro`, `..._diferencia_cc`), finanzas-para-confirmar, aplicar saldo a favor.
4. **Operaciones:** insert `movimientos` (uno por medio/retención), `cobro_aplicaciones`, ajuste crédito por pago de más (`cobro_origen_id`), `lz_estado_factura_por_cobro`, trigger `asignar_recibo_movimiento`.
5. **Modifica:** `movimientos`, `cobro_aplicaciones`, `facturas.estado`, `recibos`, `echeqs` (vínculo).
6. **Guarda:** idem.
7. **Dependen:** CC clientes, conciliación bancaria, cheques, retenciones sufridas/certificados, Finanzas IVA.
8. **Depende de:** `facturas.total/total_acreditado`, `lz_cobrado_factura`.
9. **Errores posibles:** moneda mixta (bloqueado en masivo: bien); anulación que no libera la línea de banco (H1).
10. **Si falla:** todo dentro de una función SQL (atómico). Los wrappers `_seguro` controlan permisos; `registrar_cobro` y `registrar_cobro_masivo` NO están otorgados a `authenticated` (bien: solo vía wrapper).
11. **Si otro módulo cambia:** una NC posterior cambia `total_acreditado` y estado; si la factura ya estaba pagada, la NC queda toda "a favor" (ver H4).
12. **Pruebas:** test-saldo-clientes, test-cobro-reparto, test-cobros-cheques-atomicos (no corrido: no verificado si es puro), test-estado-factura-venta.
13. **Problemas reales:** H1 (anular deja extracto "matcheado"); H4 (saldo a favor por NC no aplicable).
14. **Riesgos:** 85 movimientos de clientes (~$ 270 M, cargados 16-21/10) sin factura ni aplicación: cobros de facturas previas al CRM (PV 0008/0009, no cargadas). No suman ni restan en la CC: correcto por diseño, pero la CC del CRM **no** incluye deuda histórica (H11).
15. **Confiabilidad: alta** — una sola regla SQL (`lz_cobrado_factura`) usada por todos los RPC de cobro; estados coinciden 100 % con la recomputación (57 emitidas sin cobro, 62 pagadas, 1 parcial: 0 diferencias).

### M4. Notas de crédito de venta y anulaciones
1. **Función:** acreditar total o parcialmente una factura; anular comprobantes sin CAE.
2. **Recibe:** factura origen, ítems/monto, modo (total/items/amount).
3. **De dónde:** modal NC (facturacion-content / Finanzas), route.ts.
4. **Operaciones:** `registrar_nota_credito_venta_autorizada` (inserta NC, ítems, actualiza origen, PR → `facturar` si total); `crear_nota_credito_manual_venta(_multiple)`; `handleAnular` / `handleRevertirAnulacion` (update directo de `facturas.estado`).
5. **Modifica:** `facturas` (NC y origen), `factura_items`, `nota_credito_venta_aplicaciones`, `presupuestos.estado`.
6. **Guarda:** idem.
7. **Dependen:** CC, cobros, Libro IVA, PR (refacturar).
8. **Depende de:** cobrado de la factura (calculado dentro del RPC con su propia fórmula, H7).
9. **Errores posibles:** doble conteo de cobros si un movimiento tiene `factura_id` y aplicaciones (H7, hoy 0 casos); centavo fantasma (NCEA 1: aplicado = total y a favor 0,01).
10. **Si falla:** si ARCA autoriza y el RPC falla, se informa `reconciliation_required` y se puede reintentar con la misma clave (bien).
11. **Si otro módulo cambia:** nadie consume `saldo_a_favor_cliente` de la NC (H4).
12. **Pruebas:** test-invoice-notes-nc-date, test-checklist-email-credit (no corridos).
13. **Problemas reales:** H4, H8 (anular/revertir manual sin recalcular).
14. **Riesgos:** "Revertir anulación" pone `emitida` aunque la factura tenga cobros (debería recalcular con `lz_estado_factura_por_cobro`); "Anular" de una factura sin CAE con cobros deja esos cobros fuera de la CC (la factura anulada no cuenta y el cobro no pasa a favor). Hoy hay 2 facturas sin CAE en `emitida` expuestas.
15. **Confiabilidad: media.**

### M5. Cuenta corriente de clientes (`lib/saldo-clientes.ts`)
1. **Función:** saldo por cliente ARS/USD (deuda, a favor, saldo) y límite de crédito.
2. **Recibe:** facturas (no anuladas), movimientos con factura, aplicaciones, ajustes.
3. **De dónde:** `traerDatosSaldoClientes` con `traerTodo` (paginado, filtrado por sociedad; aplicaciones por `movimientos!inner(sociedad_id)`).
4. **Operaciones:** cálculo puro.
5. **Modifica:** nada.
6. **Guarda:** nada.
7. **Dependen:** Clientes, Facturación (límite), Ventas, Ficha 360, Finanzas Lazza (CC, vencimientos, cobrar), scripts de Excel de CC.
8. **Depende de:** `facturas.total_acreditado`, `saldo_a_favor_cliente`, `movimientos`, `cobro_aplicaciones`.
9. **Errores posibles:** ignora movimientos con moneda distinta a la factura (SQL no) — hoy 0 casos.
10. **Si falla:** la pantalla muestra error / vacío; no escribe.
11. **Si otro módulo cambia:** coherente con los RPC de cobro (misma regla).
12. **Pruebas:** test-saldo-clientes (OK).
13. **Problemas reales:** la columna legacy `clientes.saldo_cuenta_corriente` la sigue escribiendo el trigger `recalcular_saldo_cliente` con otra fórmula (mezcla monedas, no excluye anulados): 22 de 209 clientes difieren del saldo real; Presupuestos usa esa columna para "Límite de crédito excedido" (H10).
14. **Riesgos:** saldo a favor por NC visible pero no aplicable (H4).
15. **Confiabilidad: alta** (una sola implementación TS, paginada, probada).

### M6. Remitos / entrega
1. **Función:** entregar mercadería del PR; "remito hecho = entregado".
2. **Recibe:** renglones del PR con cantidades.
3. **De dónde:** pantalla Remitos, `lib/remitos-crear.ts`, `lib/remitos-armado.ts`.
4. **Operaciones:** insert `remitos` + `remito_items` (con `presupuesto_item_id`).
5. **Modifica:** `remitos`, `remito_items`.
6. **Guarda:** idem.
7. **Dependen:** pendiente de remitir, transportes, facturación (PV/nros en factura).
8. **Depende de:** IDs de `presupuesto_items`, OC (lo que llegó).
9. **Errores posibles:** vínculo roto tras editar el PR (H2); remito de más (se avisa, no se bloquea: correcto por regla).
10. **Si falla:** n/a en esta auditoría (otro agente).
11. **Si otro módulo cambia:** editar el PR deja `presupuesto_item_id = NULL` (FK `ON DELETE SET NULL`); `remitos-armado.ts:43-48` recupera por descripción/orden (heurística).
12. **Pruebas:** test-remitos-* (no corridos).
13. **Problemas reales:** 47 renglones de remito huérfanos en 11 PR (todos de PR con ítems recreados después del remito). 1 renglón remitido dos veces (PR-2026-1248, 35 u, remitos internos R-2026-1073 y R-2026-1094): permitido por regla, conviene revisar si es duplicado.
14. **Riesgos:** `facturas.remito_id` y `remitos.factura_id` existen pero están en 0 (vínculo no usado).
15. **Confiabilidad: media.**

### M7. OC a proveedor, recepción y estados de la OC
1. **Función:** pedir al proveedor, recibir, seguir facturación y pago de la OC.
2. **Recibe:** renglones (desde PR o manuales), cantidades recibidas.
3. **De dónde:** Compras Lazza, recepción, conciliación de facturas.
4. **Operaciones:** triggers `recalcular_oc`, `auto_estado_oc` (solo al recibir), `lz_trg_fact_pago_oc` → `lz_actualizar_fact_pago_oc`, `lz_saldo_cerrado_oc`.
5. **Modifica:** `ordenes_compra.estado`, `estado_facturacion`, `estado_pago`, `medio_pago`, `pagada_at`.
6. **Guarda:** idem.
7. **Dependen:** Compras, remitos ("llegó"), plan de pagos.
8. **Depende de:** `facturas_compra` (estado, total), `factura_compra_ocs`, `factura_compra_asignaciones`, `facturas_compra.orden_compra_id` (vínculo viejo).
9. **Errores posibles:** `auto_estado_oc` no retrocede (si se baja lo recibido a 0, queda `recibida_parcial`); `factura_compra_asignaciones` no tiene trigger (depende de que el RPC de conciliación recalcule, y lo hace con una copia de la regla).
10. **Si falla:** todo por triggers dentro de la misma transacción.
11. **Si otro módulo cambia:** pago de factura → trigger en `facturas_compra` → estado de pago de la OC (bien).
12. **Pruebas:** test-compras-*, test-factura-vs-oc (no corridos).
13. **Problemas reales:** ninguno en datos: recomputación por asignaciones = guardado (11/11); estados de pago coherentes con la regla en las 187 OC no canceladas.
14. **Riesgos:** misma regla de `estado_facturacion` en dos lugares (`lz_actualizar_fact_pago_oc` y `guardar_conciliacion_compra`).
15. **Confiabilidad: alta.**

### M8. Facturas de compra y conciliación
1. **Función:** cargar facturas de proveedor (simple, IA, conciliación por renglón), NC de compra, pago con tarjeta.
2. **Recibe:** comprobante leído, renglones, asignaciones a OC.
3. **De dónde:** cargar-factura-oc, cargar-factura-simple, compras-lazza-factura, conciliacion-compras.
4. **Operaciones:** `guardar_conciliacion_compra` (atómica), `registrar_nota_credito_compra`, `anular_factura_compra`, `registrar_pago_tarjeta_factura_compra`.
5. **Modifica:** `facturas_compra(_items)`, `factura_compra_asignaciones`, `factura_compra_ocs`, `orden_compra_items.precio_unitario`, `presupuesto_items` (costos), `proveedor_equivalencias`.
6. **Guarda:** idem.
7. **Dependen:** OP, plan de pagos, CC proveedores, Libro IVA compras, costo del PR.
8. **Depende de:** OC, proveedor.
9. **Errores posibles:** `lib/pago-tarjeta.ts:48-51` tiene un respaldo (si la RPC no existe) que hace update de estado e insert de movimiento en dos pasos; la RPC existe, así que es código muerto.
10. **Si falla:** RPC atómicas (bien).
11. **Si otro módulo cambia:** pagos/OP cambian estado `pagada`.
12. **Pruebas:** test-cargar-factura, test-fc-edit-guards, etc. (no corridos).
13. **Problemas reales:** 3 FC C de Grupo LA en `pagada` sin ningún pago cargado (US$ 1.100, US$ 550, $ 500.000; cargadas 09/09 y 09/10): la UI las trata como saldo 0, `fc_compra_pagado` como sin pagar (H5).
14. **Riesgos:** ver H5.
15. **Confiabilidad: alta.**

### M9. Órdenes de pago, retención de Ganancias y saldo a favor proveedor
1. **Función:** pagar facturas de compra (OP o directo), retener Ganancias, registrar cheques entregados/endosados y saldo a favor.
2. **Recibe:** facturas con importe, medios, base y retención, request_key.
3. **De dónde:** orden-pago-nueva, plan-pagos.
4. **Operaciones:** `registrar_pago_proveedor_seguro` (atómica, idempotente, lock por proveedor), `..._con_nc`, `registrar_op_usd_en_pesos`, `anular_orden_pago_segura`, `aplicar_saldo_favor_proveedor`.
5. **Modifica:** `ordenes_pago`, `op_facturas_compra`, `movimientos` (pago + retención), `saldos_favor_proveedor`, `echeqs`, `facturas_compra.estado`.
6. **Guarda:** idem.
7. **Dependen:** CC proveedores, SICORE, certificados, conciliación bancaria, cheques.
8. **Depende de:** saldo de facturas (regla propia del RPC, H5).
9. **Errores posibles:** el RPC calcula saldo como `total − pagos(incluye movimientos de NC) − OP`, sin `total_acreditado` (H5).
10. **Si falla:** todo revierte (bien, incluida la cartera de cheques).
11. **Si otro módulo cambia:** anular OP no cambia cheques (decisión de Augusto "lo define el banco"); la factura vuelve a `pendiente`.
12. **Pruebas:** test-direct-payment, test-op-* (no corridos).
13. **Problemas reales:** ninguno de plata: retención en OP = movimiento de retención en las 90 OP vigentes; `monto_bruto − retención = neto` salvo OP con saldo a favor ya aplicado (el bruto pasa a incluir lo aplicado, cuadra igual: p. ej. OP-000062 aplicado 2.312.437,78 + saldo 75.459,85 = bruto 2.387.897,63).
14. **Riesgos:** la semántica de `monto_bruto` cambia después de aplicar saldo a favor (antes = documentos; después = documentos + aplicado). Quien sume `monto_bruto` como "pagado en el mes" (bases de RG 830) debe usar `base_retencion_ganancias`, no `monto_bruto` (no verificado en profundidad: área de otro agente).
15. **Confiabilidad: alta.**

### M10. Cheques (echeqs)
1. **Función:** cartera recibidos/emitidos; estado según banco.
2. **Recibe:** cheques de cobros, cheques propios en OP, reportes del banco.
3. **De dónde:** cobros, OP, cheques-banco.
4. **Operaciones:** `lz_echeqs_vincular_movimiento` (trigger), `rechazar_cheque_recibido` (anula el cobro vía `gestionar_cobro` y marca facturas `cheque_rechazado_at`).
5. **Modifica:** `echeqs`, `movimientos`, `facturas`.
6. **Guarda:** idem.
7. **Dependen:** OP (cheques endosables), cobertura de cheques, CC clientes.
8. **Depende de:** cobro de origen (`movimiento_id`; 17 recibidos, uno por movimiento).
9. **Errores posibles:** el rechazo anula el cobro con `gestionar_cobro`, que no libera la línea de banco (H1) — si el cheque estaba depositado y conciliado, la línea queda "matcheada" a un cobro anulado.
10. **Si falla:** dentro de la función.
11. **Si otro módulo cambia:** anular cobro/OP no cambia estado de cheques (por decisión de negocio).
12. **Pruebas:** test-cheques-* (no corridos).
13. **Problemas reales:** ninguno detectado en datos.
14. **Riesgos:** Finanzas Lazza muestra "no cobrada" una factura pagada con cheque sin acreditar, mientras `facturas.estado = pagada` (dos definiciones de "cobrada", intencional).
15. **Confiabilidad: alta.**

### M11. Conciliación bancaria (extractos)
1. **Función:** cruzar líneas del banco con movimientos/gastos/cheques.
2. **Recibe:** extracto BBVA, reglas, clasificación.
3. **De dónde:** extracto-bbva, finanzas-para-confirmar, gastos.
4. **Operaciones:** `conciliar_extracto_movimiento`, `aplicar_cruces_extracto`, `pagar_gasto_desde_extracto`, `desconciliar_movimiento`.
5. **Modifica:** `extracto_movimientos` (estado, `match_movimiento_id`), `movimientos` (`conciliado`, `extracto_movimiento_id`).
6. **Guarda:** idem.
7. **Dependen:** saldo de bancos, control del día, gastos.
8. **Depende de:** movimientos vigentes.
9. **Errores posibles:** H1, H9.
10. **Si falla:** RPC.
11. **Si otro módulo cambia:** anular un movimiento con `gestionar_cobro` (cobro, gasto, cheque rechazado) **no** toca `extracto_movimientos`; `desconciliar_movimiento` sí lo hace.
12. **Pruebas:** test-extracto-* (no corridos).
13. **Problemas reales:** 4 líneas de banco (débitos 06-07/10, total $ 2.138.200) siguen "matcheado" apuntando a pagos de gastos anulados el 27/10 al borrar los gastos (ejecucion).
14. **Riesgos:** 134 líneas con `match_movimiento_id` sin el vínculo inverso; 129 movimientos `conciliado = true` sin ninguna línea de banco (56 pagos de OP + 47 retenciones de OP los pone así el RPC de pago).
15. **Confiabilidad: media.**

### M12. Cuenta corriente de proveedores
1. **Función:** saldo por proveedor ARS/USD.
2. **Recibe:** facturas de compra, pagos directos, movimientos de NC, créditos (saldos a favor, OP sin facturas, ajustes, pagos sobre anuladas).
3. **De dónde:** `traerCreditosProveedores`, datos.ts (paginado y por sociedad).
4. **Operaciones:** cálculo puro.
5. **Modifica:** nada.
6. **Guarda:** nada.
7. **Dependen:** Finanzas Lazza (CC, vencimientos, pagar), finanzas-vieja.
8. **Depende de:** misma regla que `fc_compra_pagado` salvo `estado = pagada` → 0.
9. **Errores posibles:** H5.
10. **Si falla:** n/a.
11. **Si otro módulo cambia:** coherente con OP.
12. **Pruebas:** test-saldo-proveedores (OK), test-finanzas-lazza (OK).
13. **Problemas reales:** `proveedores.saldo_cuenta_corriente` también lo escribe un trigger legacy (`recalcular_saldo_proveedor`) con una fórmula que no excluye anulados (no se usa en pantallas nuevas).
14. **Riesgos:** dos implementaciones TS del saldo de una FC (`lib/saldo-factura-compra.ts: saldoFacturaCompra` y `lib/finanzas-lazza.ts: saldoFacturaCompra`, **mismo nombre, distinta regla**: la primera no trata `pagada` como 0). La de saldo-factura-compra hoy solo se usa para duplicados.
15. **Confiabilidad: alta.**

---

## 4. Hallazgos detallados

### H1 — Anular un cobro/gasto deja la línea del banco "conciliada" contra un movimiento anulado
- **Severidad:** alto · **Tipo:** error_funcional · **Certeza:** ejecucion · **Esfuerzo:** S
- **Evidencia:** `gestionar_cobro` (acción `anular`/`eliminar`) pone `movimientos.conciliado=false` y `monto=0`, pero no toca `extracto_movimientos` (0 referencias a "extracto" en la función). `desconciliar_movimiento` sí libera la línea (`estado='pendiente', match_movimiento_id=null`). Lo llaman: `components/finanzas-lazza/gastos.tsx:209` (Borrar gasto), `ajuste-manual.tsx:133`, `rechazar_cheque_recibido` (anula el cobro del cheque). SELECT: 4 líneas de extracto en estado `matcheado` con `match_movimiento_id` de pagos de gastos anulados el 27/10/2026 (débitos del 06 y 07/10, $ 400.000 + 589.100 + 589.100 + 560.000 = $ 2.138.200), sin otro movimiento vigente atado.
- **Síntoma:** el débito del banco figura conciliado, pero el gasto ya no existe.
- **Causa raíz:** dos caminos para "deshacer" un movimiento; solo uno libera el extracto.
- **Consecuencia:** la línea no vuelve a "pendientes de conciliar": nadie la reclasifica; el banco y los gastos dejan de cuadrar sin aviso. Si un cheque depositado y conciliado se rechaza, la acreditación queda explicada por un cobro anulado.
- **Solución estructural:** en `gestionar_cobro` (anular/eliminar), liberar las líneas de `extracto_movimientos` con la misma lógica que `desconciliar_movimiento` (o llamarla), y avisar "la línea del banco volvió a pendientes". Reparar las 4 líneas con un script aditivo (volver a `pendiente`), con OK de Augusto.

### H2 — Editar un PR borra y recrea todos los renglones: se pierden los vínculos con remitos y OC
- **Severidad:** alto · **Tipo:** riesgo_estructural (con daño ya visible) · **Certeza:** ejecucion · **Esfuerzo:** M
- **Evidencia:** `actualizar_presupuesto_atomico`: `delete from public.presupuesto_items where presupuesto_id = p_presupuesto_id;` + `insert ... from jsonb_populate_recordset` (IDs nuevos). FK con `ON DELETE SET NULL`: `remito_items.presupuesto_item_id`, `orden_compra_items.presupuesto_item_id`, `personalizacion_items.presupuesto_item_id`, `lz_oc_ajustes.pr_item_id`. Llamado desde `presupuestos-lista.tsx:1608`; `handleEditPR` (`:2410`) no mira el estado del PR. SELECT: 47 de 364 renglones de remitos con PR quedaron sin vínculo (11 PR), y los 47 son de PR cuyos ítems se recrearon después del remito; 35 de 463 renglones de OC con PR sin vínculo (16 de ellos por recreación).
- **Síntoma:** después de editar un PR, lo ya remitido/pedido deja de reconocerse por renglón.
- **Causa raíz:** "reemplazar todo" en vez de actualizar por ID.
- **Consecuencia:** pendiente de remitir calculado por heurística de descripción (`remitos-armado.ts:43-48`); "llegó" de la OC por renglón en 0 (`remitos-armado.ts:56-58` no tiene heurística); riesgo de entregar o pedir dos veces; se pierde la trazabilidad costo OC → PR.
- **Solución estructural:** que el RPC haga upsert por `id` (actualiza los que vienen con id, inserta los nuevos, borra solo los quitados) y que, si se quita un renglón con remito u OC, avise (sin bloquear). Script aditivo para re-vincular los 47 + 16 por PR + descripción + orden, revisado por Augusto.

### H3 — Columnas nuevas del renglón que los RPC del PR no guardan
- **Severidad:** medio · **Tipo:** error_funcional · **Certeza:** ejecucion · **Esfuerzo:** S
- **Evidencia:** `crear_presupuesto_atomico` y `actualizar_presupuesto_atomico` insertan solo `presupuesto_id, producto_id, codigo, descripcion, categoria, cantidad, unidad, precio_costo, markup_porcentaje, precio_venta, iva_porcentaje, orden, proveedor_id, stock_propio, lista_item_id, proveedor_nombre, costo_moneda`. La UI manda `descuento_porcentaje` (`presupuestos-lista.tsx:1570`). SELECT: 0 de 957 renglones con `descuento_porcentaje` o `precio_lista`; 14 con `catalogo_id`/`pedido_texto` (vienen de otro camino) que se pierden al editar.
- **Síntoma:** al reabrir un PR, el descuento por artículo y el precio de lista desaparecen (el precio de venta queda bien).
- **Causa raíz:** columnas agregadas después; los RPC viejos no se actualizaron.
- **Consecuencia:** información comercial perdida; el vínculo con catálogo/IA se pierde en cada edición.
- **Solución:** sumar esas columnas al insert/upsert de ambos RPC (migración aditiva con rollback) y una prueba que compare columnas de la tabla vs las del RPC.

### H4 — Dos definiciones de "saldo a favor del cliente"
- **Severidad:** medio · **Tipo:** error_funcional · **Certeza:** ejecucion · **Esfuerzo:** M
- **Evidencia:** CC (`lib/saldo-clientes.ts:132-139`) suma a favor: `saldo_a_favor_cliente` de cada NC + NC sueltas + ajustes crédito. Aplicable al cobrar (`lib/saldo-favor-cliente.ts:19-24` y RPC `aplicar_saldo_favor_cliente`): solo movimientos `ajuste` crédito sin factura. Nadie descuenta `facturas.saldo_a_favor_cliente`. SELECT: la NCB 5 (de la FB 0015-6, pagada y anulada) tiene $ 59.500,24 a favor; el cliente tiene 0 ajustes crédito y 4 facturas abiertas: la CC muestra el crédito pero "Aplicar saldo a favor" no lo ofrece.
- **Síntoma:** "tiene saldo a favor" en la cuenta corriente y en el cobro no aparece.
- **Causa raíz:** el crédito de una NC sobre factura ya cobrada queda en una columna de la NC, y la herramienta de aplicar solo mira movimientos.
- **Consecuencia:** se cobra de más o se arregla a mano; el saldo a favor nunca se consume.
- **Solución:** una sola fuente: cuando la NC deja saldo a favor, crear también el movimiento `ajuste` crédito (atado a la NC) y que la CC deje de sumar la columna para esos casos; o ampliar `aplicar_saldo_favor_cliente` para consumir NC con `saldo_a_favor_cliente` y bajarlo. Script aditivo para el caso existente, con OK.

### H5 — "Pagado de una factura de compra": tres reglas distintas
- **Severidad:** medio · **Tipo:** riesgo_estructural · **Certeza:** estatico (+ datos) · **Esfuerzo:** S
- **Evidencia:**
  - `fc_compra_pagado`: OP vigentes + pagos directos con retención + **max(total_acreditado, movimientos de NC)**.
  - trigger `validar_saldo_aplicacion_factura_compra` y `registrar_pago_proveedor_seguro` (saldo = total − todos los movimientos `pago` (incluye NC) − OP): **ignoran `total_acreditado`**.
  - `lib/saldo-proveedores.ts:209` y `lib/finanzas-lazza.ts:482`: igual que `fc_compra_pagado` pero `estado = 'pagada'` → saldo 0. `lib/saldo-factura-compra.ts` (mismo nombre `saldoFacturaCompra`) no aplica esa excepción.
  - SELECT: hoy coinciden (0 facturas con `total_acreditado` sin movimiento de NC). 3 FC C de Grupo LA en `pagada` sin pago: UI = 0, SQL = total.
- **Consecuencia:** si una NC queda registrada solo en `total_acreditado` (camino viejo), el RPC y el trigger permiten pagar la factura completa (pago de más). Las 3 "pagada sin pago" volverían a `pendiente` si alguna anulación las recalcula.
- **Solución:** una sola función SQL de saldo (`fc_compra_saldo`) usada por el trigger y los RPC, y un espejo TS con prueba que compare ambos sobre casos fijos. Decidir con Augusto qué hacer con las 3 "pagada sin pago" (cargar el pago con tarjeta o dejar nota).

### H6 — La base recalcula los importes de la factura después de autorizarla ARCA, con otro redondeo
- **Severidad:** medio · **Tipo:** error_funcional · **Certeza:** estatico (+ reconstrucción con SELECT) · **Esfuerzo:** S
- **Evidencia:** `route.ts:510-550` arma `ImpNeto/ImpIVA` redondeando el IVA **por renglón**; luego inserta la factura con esos valores (`:864`) y los ítems (`:919`), y el trigger `recalcular_factura` (AFTER INSERT en `factura_items`) **reescribe** `subtotal/iva/total` con `round(sum(...))`. SELECT: en 24 de 145 comprobantes con CAE el IVA guardado difiere del enviado en 0,01–0,02 (18 FA, 4 FCEA, 1 NCEA, 1 FB); el total coincide en todos.
- **Consecuencia:** Libro IVA / Finanzas IVA con centavos distintos a ARCA en neto e IVA (posibles observaciones al cruzar con "Mis comprobantes").
- **Solución:** que `recalcular_factura` no toque facturas con CAE (o que el route guarde los ítems antes y la cabecera al final con los valores de ARCA); verificar con Augusto si conviene corregir los 24 (aditivo, con respaldo).

### H7 — La NC calcula lo cobrado con una fórmula propia
- **Severidad:** medio · **Tipo:** riesgo_estructural · **Certeza:** estatico · **Esfuerzo:** S
- **Evidencia:** `registrar_nota_credito_venta_autorizada`: `v_pagado = sum(movimientos con factura_id) + sum(cobro_aplicaciones)` sin excluir movimientos que ya entran por aplicaciones (`lz_cobrado_factura` sí lo excluye). SELECT: hoy 0 movimientos con `factura_id` y aplicaciones.
- **Consecuencia:** si aparece ese caso, la NC aplicaría de menos y dejaría de más "a favor".
- **Solución:** usar `public.lz_cobrado_factura(v_origen.id)`.

### H8 — Anular / revertir factura sin CAE por update directo
- **Severidad:** medio · **Tipo:** riesgo_estructural · **Certeza:** estatico · **Esfuerzo:** S
- **Evidencia:** `facturacion-content.tsx:705-728` hace `update facturas set estado='anulada'` / `'emitida'` desde el navegador. No revisa cobros, no recalcula estado, no devuelve el PR a `facturar` (la NC total sí lo hace). Facturación masiva marca el PR `facturado` en un update aparte (`:692`). SELECT: 2 facturas sin CAE en `emitida` (alcanzables por el botón).
- **Consecuencia:** cobros de una factura anulada quedan fuera de la CC (ni deuda ni a favor); revertir deja `emitida` una factura con cobros.
- **Solución:** RPC `anular_factura_manual` que avise si tiene cobros (pasarlos a favor), recalcule con `lz_estado_factura_por_cobro` al revertir y devuelva el PR a `facturar`; y que la emisión deje el PR en `facturado` dentro del route (servidor).

### H9 — "Conciliado" tiene tres fuentes y significados distintos
- **Severidad:** bajo · **Tipo:** riesgo_estructural · **Certeza:** ejecucion · **Esfuerzo:** M
- **Evidencia:** `registrar_pago_proveedor_seguro` inserta pagos y retenciones con `conciliado = true` sin banco; vínculos `movimientos.extracto_movimiento_id` y `extracto_movimientos.match_movimiento_id`. SELECT: 129 movimientos conciliados sin ninguna línea de banco; 134 líneas con `match_movimiento_id` sin el recíproco (los inversos sí cuadran: 0 movimientos con `extracto_movimiento_id` sin recíproco).
- **Consecuencia:** no se puede saber con una consulta simple qué pagos pasaron por el banco.
- **Solución:** definir `extracto_movimientos.match_movimiento_id` como única fuente (y `conciliado` como derivado o "confirmado sin banco"), escribir siempre los dos lados en las RPC.

### H10 — Columna de saldo legacy que se sigue escribiendo y se usa en Presupuestos
- **Severidad:** medio · **Tipo:** error_funcional (latente) · **Certeza:** ejecucion · **Esfuerzo:** S
- **Evidencia:** triggers `movimiento_recalcular_saldo_cliente`, `trg_cobro_aplicaciones_saldo` y `movimiento_recalcular_saldo_proveedor` escriben `clientes/proveedores.saldo_cuenta_corriente` con una fórmula que mezcla ARS y USD y no excluye anulados. Comentarios en `clientes/page.tsx:905` y `facturacion-content.tsx:181` dicen "no la actualiza nadie" (falso). `presupuestos-lista.tsx:311` y `:3225` usan esa columna para "Límite de crédito excedido", mientras Facturación/Finanzas usan `superaLimiteCredito` con el saldo real. SELECT: 22 de 209 clientes con columna ≠ saldo real ARS (diferencia absoluta total ≈ $ 307 M). Hoy ningún cliente tiene `limite_credito` cargado → el aviso no se dispara todavía.
- **Consecuencia:** cuando carguen límites, Presupuestos avisará distinto que Facturación.
- **Solución:** Presupuestos con `traerSaldosClientes`; dejar de recalcular la columna (o recalcularla con la regla real) y marcarla como obsoleta. Las vistas `v_facturas_pendientes`, `v_cuenta_corriente_*` no se usan (solo en tipos): documentar como legacy.

### H11 — La CC de clientes no incluye la deuda previa al CRM
- **Severidad:** bajo · **Tipo:** mejora · **Certeza:** ejecucion · **Esfuerzo:** S
- **Evidencia:** 85 movimientos de clientes (Lazzari, ~$ 270 M) sin factura ni aplicación, con recibo; refieren a facturas de PV 0008/0009 que no están en `facturas` (PV cargados: 0, 1, 15, 16 y 10).
- **Consecuencia:** correcto por diseño (ni deuda ni crédito), pero el saldo del CRM es parcial para clientes con historia anterior.
- **Solución:** aclararlo en la ficha/CC ("no incluye facturas anteriores al CRM") o cargar saldos iniciales como ajustes débito.

### H12 — Detalles de centavos y datos legacy
- **Severidad:** bajo · **Tipo:** mejora · **Certeza:** ejecucion · **Esfuerzo:** S
- NCEA 1: `credito_aplicado = total` y `saldo_a_favor_cliente = 0,01` (un centavo a favor que no existe).
- 6 facturas anuladas con `total_acreditado` de 4 decimales y 7 NC viejas con `credito_aplicado = 0` aunque su factura quedó acreditada (sin efecto en saldos porque las facturas están anuladas).
- `presupuesto_items.entregado/facturado` nunca se escriben (0/837): columnas muertas que confunden.
- `facturas.remito_id` / `remitos.factura_id`: 0 usos.
- **Solución:** redondear a 2 decimales en las RPC de NC; documentar/retirar columnas muertas.

### Lo que está bien hecho (no tocar)
- Cobros: toda la plata de clientes pasa por RPC atómicas con la misma regla (`lz_cobrado_factura`); `registrar_cobro(_masivo)` no están expuestas a `authenticated` (solo los wrappers `_seguro` con permisos). Estados de facturas de venta = recomputación (0 diferencias en 120).
- Pagos: `registrar_pago_proveedor_seguro` con `request_key` idempotente, `pg_advisory_xact_lock` por proveedor, locks de facturas, validación de saldo por trigger y cartera de cheques dentro de la misma transacción.
- Emisión ARCA: reserva idempotente y bloqueo de reemisión cuando ARCA autoriza y lo local falla.
- Saldos en TS: paginados con `traerTodo`, filtrados por sociedad, probados (tests OK).
- OC: estados de facturación y pago coinciden con la recomputación.
- Retenciones de Ganancias: OP y movimiento de retención coinciden en las 90 OP vigentes.
- Todas las RPC de plata revisadas usan `auth.uid()` y controlan la sociedad.

---

## 5. Conexiones entre módulos (matriz de dependencias)

| Desde | Hacia | Dato | Fuente de verdad | ¿Compatible? | Nota |
|---|---|---|---|---|---|
| PR | Remitos | `presupuesto_items.id` | `presupuesto_items` | no | IDs cambian al editar (H2); 47 renglones huérfanos |
| PR | OC proveedor | `presupuesto_items.id` | `presupuesto_items` | no | 35 renglones OC sin vínculo (16 por edición) |
| PR (UI) | PR (base) | descuento, precio lista, catálogo | `presupuesto_items` | no | RPC no guarda las columnas (H3) |
| PR | Facturación | ítems y total | `presupuesto_items` | sí | 8 PR con total ≠ facturado: re-facturaciones, NC y restos; explicables |
| Facturación | PR | `estado = facturado` | `presupuestos.estado` | dudoso | update aparte desde el navegador en masiva; NC total vuelve a `facturar` |
| Facturación | Libro IVA / Finanzas IVA | neto/IVA | `facturas` | dudoso | IVA recalculado por trigger ≠ ARCA en centavos (H6) |
| Cobros | Facturas | cobrado/estado | `movimientos` + `cobro_aplicaciones` | sí | misma regla SQL; TS igual salvo moneda distinta |
| NC venta | Facturas | `total_acreditado` | `facturas` | dudoso | NC usa su propia suma de cobrado (H7) |
| NC venta | CC / cobro | saldo a favor | `facturas.saldo_a_favor_cliente` vs ajustes | no | dos definiciones (H4) |
| Cobros / Gastos | Conciliación | vínculo con línea de banco | `extracto_movimientos.match_movimiento_id` | no | anular no libera la línea (H1) |
| Cheque rechazado | Cobros / Facturas | anulación y marca | `echeqs` → `gestionar_cobro` | dudoso | hereda H1 |
| Movimientos | Clientes / Proveedores | `saldo_cuenta_corriente` | cálculo TS | no | columna legacy con otra fórmula; Presupuestos la usa (H10) |
| Factura compra | OC | estado facturación/pago | `facturas_compra` + vínculos | sí | trigger + copia en conciliación, hoy coinciden |
| Factura compra | OP / Plan de pagos | saldo pendiente | `fc_compra_pagado` / RPC / TS | dudoso | tres reglas (H5) |
| OP | CC proveedores | pagos, retenciones, saldo a favor | `op_facturas_compra`, `saldos_favor_proveedor` | sí | cuadra (bruto = aplicado + saldo) |
| OP | Cheques | entregado / endosado | `echeqs` | sí | anular OP no los cambia (decisión de negocio) |
| OP | SICORE / certificados | régimen y base congelados | `ordenes_pago.retencion_ganancias_*` | sí | coinciden con movimientos |
| Pagos (RPC) | Conciliación | `conciliado` | `movimientos.conciliado` | dudoso | true sin banco (H9) |
