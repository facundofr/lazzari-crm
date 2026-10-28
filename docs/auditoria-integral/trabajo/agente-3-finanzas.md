# Auditoría integral — Agente 3: Finanzas

Fecha: 28/10/2026. Auditoría de SOLO LECTURA (no se tocó código ni datos). Base consultada solo con `scripts/lectura/sql.cjs`
(transacción READ ONLY). No se llamó a ARCA, Resend, Anthropic, BCRA ni ningún servicio externo.

## Alcance revisado

**Código (TS/TSX)**
- Rutas: `app/(crm)/finanzas/page.tsx` (Finanzas Lazza, la de hoy), `app/(crm)/finanzas-lazza/page.tsx` (redirige), `app/(crm)/finanzas-vieja/page.tsx` (6.615 líneas, oculta; leído por partes: carga de saldos 955-1160, compras 1245-1320, OP 1790-1840), `app/(crm)/facturas/page.tsx`.
- `components/finanzas-lazza/*` (datos.ts completo; cobrar.tsx, gastos.tsx, listas.tsx Retenciones, bancos.tsx, cheques-banco.tsx por partes; resto por grep de escrituras y consultas).
- `components/orden-pago-nueva.tsx` (carga de facturas 285-335, NC/base 440-600, guardado 740-1000), `components/plan-pagos.tsx` (carga 115-160, mensual 225-240, armado/guardado/pago 260-435), `components/cobro-masivo-liquidacion.tsx` (330-500), `components/saldo-favor-proveedor.tsx`, `components/extracto-bbva.tsx` (por grep), `components/cheques-tercero.tsx` (grep).
- `lib/`: saldo-clientes, saldo-proveedores, saldo-factura-compra, saldo-favor-cliente, finanzas-lazza (saldoFacturaCompra, armarVencimientos, armarCuentasCorrientes, armarRetenciones, facturasACobrar), facturas-lazza, estado-factura-venta, payment-money, plan-pagos, retencion-conceptos, certificado-retencion, saldo-cuentas, extracto-match, pago-tarjeta, caja-proyectada (cabecera), tipos-movimiento (sentidoAjuste).
- `app/api/sicore/route.ts` (auth y consultas).

**Base (migraciones leídas)**
- `20261011120000_compras_correcciones.sql` (fc_compra_pagado, anular_orden_pago_segura v1)
- `20261012140000_cobros_corregidos.sql` (lz_cobrado_factura, lz_estado_factura_por_cobro, saldo a favor por cobro)
- `20261026160000_aplicar_saldo_favor_cliente.sql`, `20261019200000_aplicar_saldo_favor_proveedor.sql`
- `20261026180000_anular_no_cambia_cheques.sql` (anular_orden_pago_segura y gestionar_cobro vigentes)
- `20261026190000_op_cheque_de_op_anulada.sql` (registrar_pago_proveedor_seguro vigente, lz_cheque_libre_para_op)
- `20261009230000_nc_compra_saldo.sql` (registrar_pago_proveedor_con_nc)
- `20260925204500_notas_credito_compra_origen.sql` (trigger validar_saldo_aplicacion_factura_compra)
- `20261026130000_finanzas_simple.sql` (aplicar_cruces_extracto)

**Tablas consultadas (SELECT)**: facturas, facturas_compra, movimientos, cobro_aplicaciones, ordenes_pago, op_facturas_compra,
saldos_favor_proveedor, echeqs, gastos_manuales, nota_credito_venta_aplicaciones, profiles, user_sociedades, pagos_lote_items,
personalizacion_liquidaciones, clientes; funciones `lz_cobrado_factura` y `fc_compra_pagado` (stable, de solo lectura).

**Pruebas corridas (puras, leídas antes)**: test-saldo-clientes, test-saldo-proveedores, test-finanzas-lazza, test-facturas-lazza,
test-saldo-factura-compra, test-certificado-retencion, test-sicore-linea, test-retencion-conceptos, test-op-parcial (tsx);
test-saldo-favor-cliente.cjs, test-extracto-match.mjs (node); test-saldo-cuentas.mjs (con tsx: con `node` solo falla por resolución
de módulos, no por lógica). **Todas OK.**

**No cubierto**: IVA (`ivaDelMes`) y Reportes en detalle, Facturar (resto-facturar), préstamos/tarjetas de Bancos, importación
del extracto BBVA (`importar_extracto_bbva`, parser `lib/extracto-bbva.ts` de 760 líneas), `registrar_op_usd_en_pesos` y
liquidaciones FX en detalle, `rechazar_cheque_recibido`, RLS de las tablas financieras, `registrar_cobro_masivo_seguro` por dentro.

---

## Respuesta a la pregunta clave

**¿El saldo de una factura de venta / de compra y el saldo de CC salen de UNA fuente o de varias?**

### Ventas — una regla, dos implementaciones equivalentes (bien)
- Regla única: `saldo = total − total_acreditado − cobrado`, con `cobrado = movimientos con factura_id (no anulados, sin aplicaciones) + cobro_aplicaciones vigentes`.
- TS: `lib/saldo-clientes.ts:80 cobradoPorFactura` + `:108 saldoFacturaVenta`. La usan Finanzas Lazza (`datos.ts:162,194`), Finanzas vieja (`finanzas-vieja/page.tsx:1123-1150`), Clientes, Facturación, Ventas, Ficha 360.
- DB: `public.lz_cobrado_factura` (`20261012140000:43`) — la usan los cobros y `aplicar_saldo_favor_cliente`.
- Diferencia menor: TS ignora un movimiento directo en otra moneda que la factura (`saldo-clientes.ts:100`); la base lo suma. Hoy no hay ninguno (consulta: 0 filas con moneda distinta).
- Copia inline idéntica en `lib/finanzas-lazza.ts:842 facturasACobrar` (no usa `saldoFacturaVenta`).
- **Verificado contra la base (ejecución)**: 57 emitidas con saldo ($27,78 M), 62 pagadas sin saldo, 1 parcial con saldo. Ninguna factura con estado guardado contradictorio con el saldo calculado.

### Compras — UNA regla escrita, SIETE implementaciones (riesgo estructural)
| # | Dónde | Cómo cuenta la NC | "pagada" sin pago |
|---|---|---|---|
| 1 | `public.fc_compra_pagado` (`20261011120000:22`) | `greatest(total_acreditado, mov NC)` | da saldo |
| 2 | `registrar_pago_proveedor_seguro`, validación (`20261026190000:239-255`) | solo movs tipo pago (incluye NC), **ignora total_acreditado** | — |
| 3 | mismo RPC, estado final en modo OP (`20261026190000:428-450`) | igual que 2 (no usa fc_compra_pagado; el modo directo sí) | — |
| 4 | trigger `validar_saldo_aplicacion_factura_compra` (`20260925204500`) | igual que 2 | — |
| 5 | `lib/saldo-proveedores.ts:156 calcularSaldosProveedores` | max(acreditado, mov NC) | **0** (`:196`) |
| 6 | `lib/finanzas-lazza.ts:482 saldoFacturaCompra` | max(acreditado, mov NC) | **0** |
| 7 | `orden-pago-nueva.tsx:293-321` y `plan-pagos.tsx:~140-176` (inline) | igual que 2, filtra por estado guardado | excluida por estado |
| (8) | `lib/saldo-factura-compra.ts:28` | max | — | **sin uso** fuera de su test |

Hoy dan lo mismo porque toda NC deja los dos rastros (verificado: 4 facturas con total_acreditado y su movimiento NC iguales).
Divergencia real hoy: 3 facturas de Grupo LA marcadas "pagada" a mano sin pago registrado (INGA NATALIA 1100 y 550 US$, PORCEL 500.000 $):
para TS saldo 0, para la base saldo total (ver hallazgo H3).

### Cuenta corriente
- Clientes: una sola fuente (`calcularSaldosClientes`). La columna `clientes.saldo_cuenta_corriente` está muerta pero **todavía se lee** en Presupuestos (aviso de límite de crédito) — H8.
- Proveedores: `calcularSaldosProveedores` + `traerCreditosProveedores` en Lazza, vieja y Proveedores. Mismo código, mismas consultas.
- Vieja vs Lazza: mismas funciones. Única diferencia: los ajustes de clientes en la vieja pasan por `sentidoAjuste` (acepta "[Ajuste manual]" sin `ajuste_sentido`) y en Lazza solo los que tienen `ajuste_sentido` (`saldo-clientes.ts:215`). Hoy no hay ninguno de ese tipo (consulta: 0) → mismo resultado.

---

## Módulos (15 puntos cada uno)

### M1. Saldos de facturas y cuentas corrientes (lib/saldo-*, finanzas-lazza.ts, funciones de base)
1. **Función**: calcular lo que debe cada factura y el saldo por cliente/proveedor en ARS y USD por separado.
2. **Recibe**: facturas, movimientos con factura, cobro_aplicaciones, ajustes; facturas_compra con op_facturas_compra(ordenes_pago(estado)), pagos directos, movimientos NC, créditos (saldos_favor_proveedor, OP sin facturas, ajustes).
3. **De dónde**: `traerDatosSaldoClientes` y `traerCreditosProveedores` (paginados con traerTodo, filtrados por sociedad_id), `datos.ts:traerDeudas`.
4. **Operaciones**: sumas y restas puras, redondeo a centavos, NC con max(), créditos restan.
5. **Modifica**: nada (puras). Las funciones de base `lz_estado_factura_por_cobro` y los RPC sí escriben `facturas.estado` / `facturas_compra.estado`.
6. **Guarda**: nada; el estado guardado es una copia que mantienen las RPC.
7. **Dependen**: Facturas, Vencimientos, Cuentas corrientes, Cobrar, Inicio, Clientes, Proveedores, Facturación, Ventas, Ficha 360, Finanzas vieja.
8. **Depende de**: columnas total_acreditado, saldo_a_favor_cliente, factura_origen_id, ajuste_sentido; que las RPC dejen los dos rastros de cada NC.
9. **Errores posibles**: NC con un solo rastro (solo total_acreditado) → las RPC de pago permiten pagar de más; factura "pagada" sin pago → TS y base discrepan.
10. **Si falla una operación**: son lecturas; si una consulta falla, Lazza tira error y la vieja muestra lista vacía con aviso (B8).
11. **Si otro módulo cambia datos**: Compras (cargar FC, NC), Facturación (NC venta), Personalización (FC manual) alteran total_acreditado/estado; el cálculo se recompone en cada carga (no hay cache).
12. **Pruebas**: test-saldo-clientes, test-saldo-proveedores, test-finanzas-lazza, test-saldo-factura-compra (OK).
13. **Problemas reales**: H3 (pagada sin pago: TS≠base), H8 (columna muerta leída).
14. **Riesgos**: H1 (siete implementaciones del saldo de compra; tres en la base ignoran total_acreditado).
15. **Confiabilidad**: **alta** en ventas (una regla, verificada contra datos); **media** en compras (correcta hoy pero repartida en 7 lugares).

### M2. Finanzas Lazza — Facturas, Vencimientos, Cuentas corrientes, Inicio (datos.ts, facturas-lazza.ts)
1. Una fila por factura con saldo, estado visible (vencida/parcial/cheque en cartera), docs (OP/recibo), totales; CC por entidad con vencido y BCRA.
2. Sociedad, lado, hoy.
3. Supabase (lecturas, paginadas por id).
4. Arma filas, estado (`estadoFactura`), filtros, selección para pagar/cobrar (`prepararSeleccion`: un proveedor y una moneda, avisa y nunca frena).
5. Vencimientos edita `fecha_vencimiento` y días de CC de la entidad (`vencimientos.tsx:183,200,214`), con sociedad_id.
6. facturas / facturas_compra / clientes / proveedores.
7. Inicio (tarjetas), Cobrar, Pagar (abre OP), Resumen de cuenta.
8. M1, recibos (`traerRecibos`), echeqs recibidos sin acreditar, `opsPorFactura`.
9. Si falla el vínculo con vendedor, reintenta sin él (`datos.ts:211`). Los cheques y recibos fallan "suave" (catch → []).
10. Lecturas: no deja nada a medias. La edición de vencimientos en lote (`:214`) es un update por factura sin transacción (puede quedar parcial; inocuo).
11. Una factura "Cobrada" con cheque sin acreditar se muestra "Cheque en cartera/depositado" (bien pensado: no da por cobrado hasta el banco).
12. test-facturas-lazza, test-finanzas-lazza (OK).
13. Ninguno funcional encontrado.
14. Compras: depende del estado guardado "pagada" (H3).
15. **Alta**: usa la misma fuente que CC, paginado, filtrado por sociedad.

### M3. Cobrar / cobro masivo / saldo a favor del cliente / recibos
1. Elegir cliente y facturas, registrar el cobro (medios, retenciones sufridas, cheques), aplicar saldo a favor, diferencia a CC.
2. Facturas tildadas, medios, retenciones, OP del cliente leída por IA (plan).
3. `cobrar.tsx:traerFacturasCliente/cobradoDe`, `cobro-masivo-liquidacion.tsx`.
4. `aplicar_saldo_favor_cliente` (RPC 1) y luego `registrar_cobro_masivo_seguro` o `registrar_cobro_masivo_diferencia_cc` (RPC 2), con request_key idempotente.
5. movimientos, cobro_aplicaciones, echeqs (cartera), facturas.estado, recibos; saldo a favor: parte el movimiento de crédito.
6. Base, todo vía RPC security definer con candado por cliente (`pg_advisory_xact_lock`).
7. Facturas/CC (saldo), Recibos, Cheques, Retenciones sufridas, IVA (retenciones de IVA), Bancos/extracto.
8. M1 (`cobradoPorFactura`), `lz_cobrado_factura`.
9. Dos RPC en dos transacciones (H6). Saldo a favor parcial: reescribe `monto` del crédito original (queda solo en la descripción).
10. Si RPC 2 falla después de RPC 1, el saldo a favor ya quedó aplicado; la pantalla lo avisa y el reintento no lo reaplica (`sfAplicadoRef`). Si se cierra la ventana, queda la factura parcialmente cancelada con el crédito (contablemente correcto) y el cobro sin registrar.
11. Anular un cobro anula solo el saldo a favor que generó (trigger `lz_anular_a_favor_de_cobro`).
12. test-saldo-favor-cliente, test-cobro-reparto, test-cobros-cheques-atomicos (no corrida), test-recibos.
13. Ninguno con datos (aplicaciones nunca superan el movimiento: 0 casos).
14. H6; "Revisar" de diferencias se guarda en una pantalla que solo existe en la vieja (`cobro-masivo-liquidacion.tsx:491`).
15. **Alta**: RPC atómicas, idempotentes, candado por cliente, validaciones en base.

### M4. Pagar / Orden de pago (orden-pago-nueva.tsx + RPC)
1. OP a proveedor con facturas, NC, retención Ganancias, medios (transferencia, cheques propios, endoso de cartera), pago directo parcial, US$ pagado en pesos.
2. Proveedor, facturas tildadas y "A pagar", NC, medios, comprobantes (IA).
3. Supabase: facturas_compra pendientes, op_facturas_compra, movimientos, ordenes_pago del mes, retencion_config.
4. RPC `registrar_pago_proveedor_seguro` / `_con_nc` / `registrar_op_usd_en_pesos`: valida, numera, inserta OP, aplicaciones, movimiento pago y retención, saldo a favor, cheques; marca facturas pagadas. Después, aparte: anota la retención congelada (update) y sube adjuntos.
5. ordenes_pago, op_facturas_compra, movimientos, saldos_favor_proveedor, echeqs, facturas_compra.estado, pago_solicitudes, op_notas_credito_compra.
6. Base.
7. CC proveedores, Facturas compras, Retenciones/SICORE/certificado, Cheques, Bancos, Plan de pagos.
8. M1 (saldo inline), retencion-conceptos, certificado-retencion, `lz_cheque_libre_para_op`.
9. Validación de saldo en la base ignora total_acreditado (H1). Retención: fórmula duplicada (H4). Anotación de retención fuera de la transacción (H5).
10. La saga contable es una sola transacción con `request_key` (reintento = misma OP). Anotación y adjuntos pueden fallar sin romper la OP (se avisa).
11. Anular OP: revierte NC, reabre Plan de pagos, recalcula estado con `fc_compra_pagado`; NO toca cheques (regla de Augusto).
12. test-op-validation, test-op-annulment, test-op-echeqs, test-op-money-rounding, test-op-parcial (solo esta corrida), test-cheque-comprobante-op.
13. Ninguno con datos (OP anuladas con movimiento vivo: 0; OP vivas sin movimiento: 0; saldos a favor de OP anuladas: 0).
14. `lz_cheque_libre_para_op` reconoce el cheque creado por la OP comparando `op.created_at = e.created_at` (heurística por igualdad de timestamp) (`20261026190000:34`). Permiso: `registrar_pago_proveedor_seguro` deja pasar a un usuario SIN filas en user_sociedades a cualquier sociedad (`:85-95`); `_con_nc` y `aplicar_saldo_favor_cliente` exigen membresía. Hoy todos los usuarios tienen sociedad (consulta: 0 sin sociedad).
15. **Alta** en la transacción principal; **media** por la duplicación de reglas de saldo y retención.

### M5. Plan de pagos (plan-pagos.tsx, lib/plan-pagos.ts)
1. Armar lote de pagos por proveedor con retención RG 830 del mes, Excel para el banco, registrar cada pago (misma RPC que la OP).
2. Facturas pendientes en pesos, NC disponibles, acumulado mensual, config de retención.
3. Supabase (facturas paginadas con `range`, resto sin paginar acotado por proveedor).
4. Inserta pagos_lotes + pagos_lote_items (con borrado compensatorio si falla el segundo), luego por renglón RPC de pago con `it.request_key` estable.
5. pagos_lotes, pagos_lote_items, y lo de M4.
6. Base.
7. CC proveedores, Retenciones, SICORE.
8. `calcularRetencionGanancias` (lib), M4 RPC.
9. Retención calculada al armar el plan y guardada; se usa tal cual al pagar días después (H7). La OP del plan NO anota la retención congelada (H5). `pagos_lote_items.update(cambios)` sin revisar error (`plan-pagos.tsx:406`).
10. Si la RPC salió bien y falla el update del renglón, el renglón queda "pendiente"; el reintento usa la misma request_key → replay, no duplica (bien). Lote sin renglones: se borra (compensación manual, no transacción).
11. Anular la OP reabre el renglón con clave nueva (base).
12. No hay test propio de plan-pagos (sí de calcularRetencionGanancias vía retencion-conceptos/certificado indirectamente).
13. H5 (sin anotar retención) es error funcional estático para pagos futuros (hoy 0 pagos de plan con retención).
14. H7; paginación con `order("fecha")` sin desempate por id (`plan-pagos.tsx:125`): con más de 1000 facturas pendientes podría saltear/duplicar filas (hoy hay < 20).
15. **Media**.

### M6. Retenciones Ganancias, SICORE y certificados (practicadas y sufridas)
1. Calcular retención RG 830 (mínimo por concepto, escala honorarios, art. 29), listar practicadas/sufridas, TXT SICORE, certificado PDF, cargar certificados sufridos con IA.
2. OP / pagos directos con base y retención; movimientos retencion_* de clientes; certificados_retencion.
3. `listas.tsx:FinanzasLazzaRetenciones` (paginado), `app/api/sicore/route.ts` (con token del usuario y control de membresía).
4. Puras (armarRetenciones, detalleRetencion, armarLineaSicore); escrituras: concepto del proveedor (`listas.tsx:678`), certificados_retencion insert/anular (soft).
5. proveedores.concepto_retencion_ganancias/alicuota, certificados_retencion.
6. Base y bucket `certificados`.
7. IVA (retenciones de IVA a cuenta), contador (TXT/Excel).
8. M4/M5 (columnas base_retencion_ganancias, retencion_ganancias_*), retencion_config.
9. Fórmula duplicada OP vs Plan (H4). Plan sin anotar (H5). Practicadas: no hay doble conteo (la OP lleva el monto; el movimiento `retencion_ganancias` con proveedor se ignora; el pago directo se cuenta por su movimiento `pago`).
10. Cargar certificado: se confirma de a uno, nunca se guarda solo; quitar = anulado (no borra).
11. Editar el concepto del proveedor no cambia OP viejas si están anotadas (verificado: 47 OP con retención, 0 sin anotar).
12. test-certificado-retencion, test-sicore-linea, test-retencion-conceptos, test-certificado-sufrido (OK las 3 primeras).
13. H5.
14. H4 (diferencia de redondeo en honorarios), H7.
15. **Alta** para lo ya registrado; **media** para pagos futuros por Plan de pagos.

### M7. Saldo a favor de proveedores (saldo-favor-proveedor.tsx, RPC aplicar_saldo_favor_proveedor)
1. Aplicar anticipos/excedentes de OP a una factura que llega después.
2. Factura, lista de OP y montos.
3. lib/saldo-favor-proveedor (pura), RPC.
4. Una transacción: vincula OP→factura, recalcula lo que queda a favor, marca pagada con `fc_compra_pagado`.
5. op_facturas_compra, saldos_favor_proveedor, facturas_compra.estado.
6. Base.
7. CC proveedores (créditos), Facturas.
8. Misma regla que `creditosProveedor` (bruto de OP sin facturas + saldo disponible).
9. Validación de saldo por `fc_compra_pagado` (la buena). Candado por proveedor compartido con los pagos.
10. Todo o nada.
11. Anular la OP origen anula su saldo a favor (trigger) y recalcula facturas.
12. test-saldo-favor-proveedor (no corrida).
13. Ninguno.
14. `monto_original = greatest(monto_original, v_queda)` pierde el original histórico en algunos casos (cosmético).
15. **Alta**.

### M8. Cheques (cheques.tsx, cheques-banco.tsx, cheques-reportes.tsx, cheques-tercero.tsx)
1. Cartera, emitidos, estados según el banco (Excel / reporte eCheq), rechazos.
2. echeqs, extracto_movimientos (cheque_id), OP (medios_pago), recibos.
3. traerTodo filtrado por sociedad.
4. `rechazar_cheque_recibido` (RPC), `aplicar_reporte_echeqs` (RPC), updates directos `echeqs` con guarda `.eq("estado", de)` (`cheques-banco.tsx:82`), edición de datos (`cheques-tercero.tsx:73`).
5. echeqs.
6. Base.
7. Bancos (cartera/comprometido), Facturas (cheque sin acreditar), Caja.
8. Regla de Augusto: solo el banco mueve cheques; anular OP/cobro no los toca.
9. Updates de estado desde Excel uno por uno (sin transacción) → puede quedar a medias si se corta; la guarda por estado hace que reaplicar sea seguro.
10. Ver 9.
11. Cheques de una OP anulada siguen "entregado/endosado" y suman en "comprometido" hasta que el banco diga otra cosa (por diseño).
12. test-cheques-banco, test-cheques-estado-banco, test-cheques-lazza, test-cheques-filtro, test-cheques-plazo (no corridas).
13. Ninguno con datos (cheques vivos con cobro anulado: 0).
14. Bajo.
15. **Alta/media**.

### M9. Bancos, saldos de cuentas, movimientos, carga diaria (bancos.tsx, lib/saldo-cuentas.ts, nuevo-movimiento, ajuste-manual)
1. Saldo por cuenta (saldo del banco + movimientos del CRM posteriores), cheques, préstamos, tarjetas; carga manual.
2. cuentas_financieras, movimientos, echeqs, pases del extracto.
3. Supabase.
4. Puras + escrituras directas: `cuentas_financieras.saldo_banco` (`bancos.tsx:108`), prestamo_cuotas, tarjeta_resumenes, movimientos manuales (`nuevo-movimiento.tsx:72`, `ajuste-manual.tsx:47`).
5. Las tablas citadas.
6. Base.
7. Inicio, Caja, Reportes.
8. `clasificarMovimiento`, `montoCuentaDeOp`.
9. Saldo "según banco" cargado a mano con fecha = hoy: lo de hoy en adelante suma; lo cargado después con fecha anterior no (por diseño "desde el corte"). Retenciones y NC no mueven banco (bien).
10. Escrituras simples de una fila.
11. Gastos sin movimiento no restan en bancos (H2).
12. test-saldo-cuentas (OK), test-bancos-lazza, test-movimientos-banco.
13. H2 (4 gastos sin movimiento).
14. `prestamo_cuotas.update` solo por id (`bancos.tsx:134`, depende de RLS).
15. **Media/alta**.

### M10. Extracto BBVA y conciliación (extracto-bbva.tsx, aplicar_cruces_extracto)
1. Importar extracto, clasificar líneas, cruzarlas con movimientos y cheques, reglas.
2. Archivo del banco, cruces propuestos (IA/reglas/match por monto ±3 días).
3. `importar_extracto_bbva`, `aplicar_cruces_extracto` (lotes de 150), `completar_cheques_emitidos`.
4. Por línea: deshace lo anterior, marca movimiento conciliado, cheque cobrado, estado de línea y del extracto.
5. extracto_movimientos, movimientos.conciliado/cuenta_id, echeqs, extractos_bancarios.
6. Base.
7. Bancos, Cheques (único lugar que pasa a "cobrado"), Facturas (cheque acreditado).
8. `lz_puede_operar_finanzas`, `canMatchBankMovement`.
9. Un movimiento solo puede cruzar UNA línea (se rechaza el segundo): un cobro que el banco parte en dos líneas no se puede conciliar entero. "solo_pendiente" evita pisar a otra persona (bien).
10. Cada lote de 150 es una transacción; si falla uno a mitad de varios lotes, quedan aplicados los anteriores (reaplicables).
11. Anular un movimiento conciliado: lo maneja gestionar_cobro.
12. test-extracto-match (OK), test-extracto-bbva, test-extracto-csv, test-movimientos-bbva.
13. Ninguno.
14. `extracto-bbva.tsx:149` actualiza descripciones de líneas con guarda por valor viejo (ok).
15. **Alta**.

### M11. Gastos (gastos.tsx)
1. Gastos del mes (fijos y eventuales), débitos automáticos, VEP adjunto.
2. Borrador del usuario, gastos_fijos.
3. Supabase.
4. Alta: `insert gastos_manuales` y DESPUÉS `insert movimientos` (dos pasos, sin transacción). Edición: update gasto + `gestionar_cobro(editar)` por cada pago. Borrar: `gestionar_cobro(anular)` y luego **DELETE físico** de gastos_manuales.
5. gastos_manuales, movimientos, gastos_fijos.
6. Base y bucket comprobantes.
7. Bancos (egreso), Reportes (resultado), IVA (VEP), Caja.
8. `cargar_debitos_automaticos` (RPC).
9. H2: si falla el movimiento queda gasto sin pago (solo un toast). Si falla anular el pago, igual borra el gasto (`gastos.tsx:208-213`) → el pago queda vivo y huérfano (FK ON DELETE SET NULL).
10. Ver 9.
11. Si el pago ya está cruzado con el banco y se cambia el monto, avisa (bien).
12. test-gastos-lazza, test-gasto-fijo-factura (no corridas).
13. H2 confirmado con datos: 4 gastos sin movimiento vivo (USD 1.100, USD 800, $ 500.000, $ 1.616.059,20).
14. Borrado físico contra la regla "nunca borrar" (lo pide el usuario, pero sin papelera).
15. **Media**.

### M12. IVA, Reportes, Facturar (iva.tsx, reportes.tsx, facturar.tsx)
Revisado solo por encima (consultas de `datos.ts`: paginadas y por sociedad). Facturar escribe `presupuesto_restos_facturar.estado` y `presupuestos.estado='rechazado'` con sociedad (`facturar.tsx:210,216`). IVA toma retenciones de IVA de clientes, líneas del banco y VEP de gastos (`datos.ts:113`). Confiabilidad **no evaluada a fondo** (ver No cubierto). Pruebas: test-finanzas-lazza cubre ivaDelMes/reporteBasico (OK).

### M13. Finanzas vieja (/finanzas-vieja, oculta)
1. Pantalla anterior; sigue viva para Revisar, extractos viejos, correo, caja proyectada.
2-6. Mismas tablas; saldos con las mismas libs (M1). Escrituras: `anular_orden_pago_segura`, `gestionar_cobro`, `conciliar_extracto_movimiento`, `rechazar_cheque_recibido`, `anular_factura_compra`, y `handlePagarOP` (`page.tsx:1814-1846`) que hace updates directos en cadena (OP → pagada, cada FC → pagada si |pagado−total|<1) **sin transacción y sin `fc_compra_pagado`** (ignora pagos directos y NC).
7. Links viejos (`finanzas-destino.ts`), aviso de Revisar.
8. Mismas libs.
9-10. handlePagarOP puede dejar la OP pagada y algunas FC sin actualizar si se corta; tolerancia de $1.
11. Igual que Lazza.
12. Indirectas (libs).
13. Ninguno con datos (todas las OP se crean "pagada" por RPC, el botón casi no aplica).
14. Código paralelo de 6.600 líneas que sigue escribiendo.
15. **Media** (lecturas alta; escrituras legacy baja).

---

## Hallazgos detallados

### H1 — El saldo de una factura de compra se calcula en 7 lugares; 3 de la base ignoran `total_acreditado` (riesgo estructural, medio, estático)
- **Síntoma**: hoy ninguno visible.
- **Causa raíz**: `fc_compra_pagado` es la regla única declarada, pero `registrar_pago_proveedor_seguro` (`20261026190000:239-255` validación y `:428-450` estado en modo OP) y el trigger `validar_saldo_aplicacion_factura_compra` (`20260925204500`) recalculan a mano solo con movimientos `pago` + OP; `orden-pago-nueva.tsx:293-321` y `plan-pagos.tsx` también. TS tiene otras dos (`saldo-proveedores.ts:156`, `finanzas-lazza.ts:482`) más una sin uso (`saldo-factura-compra.ts:28`).
- **Consecuencia**: si alguna vez una NC deja solo `total_acreditado` (sin movimiento con nota_credito_compra_id: cargas viejas, script, corrección manual), la pantalla de OP muestra saldo de más, la base deja pagar de más y no marca "pagada"; CC dice otra cosa. Además, el mismo RPC usa una regla en modo directo y otra en modo OP.
- **Solución**: usar `fc_compra_pagado` en el RPC (validación y estado) y en el trigger; exponer una vista/RPC de solo lectura `saldo_facturas_compra(sociedad)` y que OP y Plan la lean; borrar `lib/saldo-factura-compra.saldoFacturaCompra` o hacer que `finanzas-lazza` la reutilice. Agregar un chequeo diario "total_acreditado ≠ suma de movimientos NC".
- **Esfuerzo**: M.

### H2 — Gastos: alta en dos pasos y borrado que deja pagos huérfanos (error funcional, medio, ejecución)
- **Síntoma**: 4 gastos sin pago en Movimientos: Natalia Inga oct (US$ 1.100), Alquiler oct (US$ 800), Leandro Porcel oct ($ 500.000), Compra crédito fiscal IVA FC 00005-00019878 ($ 1.616.059,20).
- **Causa raíz**: `gastos.tsx:182-190` inserta gasto y movimiento por separado (si el segundo falla solo hay un toast); `gastos.tsx:208-213` borra el gasto aunque falle anular su pago. (Los 4 casos pueden venir también de una carga por script del 15/10; el código permite que vuelva a pasar.)
- **Consecuencia**: el egreso no resta en Bancos ni en la caja; o queda un pago vivo sin gasto que lo explique.
- **Solución**: RPC `guardar_gasto` / `borrar_gasto` que hagan gasto+movimiento en una transacción y no borren si no se pudo anular; soft delete. Revisar a mano esos 4 casos con Augusto (Inga y Porcel coinciden con facturas de compra "pagadas" sin pago: H3).
- **Esfuerzo**: S/M.

### H3 — Facturas de compra "pagada" sin pago registrado: TS dice saldo 0, la base dice deuda total (riesgo, bajo, ejecución)
- **Síntoma**: 3 facturas de Grupo LA (INGA NATALIA 00002-00000145 US$ 1.100 y 00002-00000140 US$ 550; PORCEL LEANDRO 0001-00000415 $ 500.000), nota "Pagada por transferencia desde el Banco Galicia (Augusto 18/10)".
- **Causa raíz**: regla `estado === "pagada" → saldo 0` solo en TS (`saldo-proveedores.ts:196`, `finanzas-lazza.ts:483`); `fc_compra_pagado` no la tiene.
- **Consecuencia**: hoy ninguna (OP solo toma pendiente/recibida). Si alguien anula una OP o una NC sobre esas facturas, la base las vuelve a "pendiente" por saldo total. El egreso no está en Bancos.
- **Solución**: registrar el pago real (o un movimiento "pago sin cuenta") y quitar la excepción; o documentar la excepción también en la base.
- **Esfuerzo**: S.

### H4 — Retención de Ganancias calculada con dos fórmulas (riesgo, medio, estático)
- **Causa raíz**: `orden-pago-nueva.tsx:518-584` (inline: % de `pctRetencion` redondeado a 2 decimales × base acumulada) vs `lib/plan-pagos.ts:65 calcularRetencionGanancias` (usa `retencionEscala` directa). La base del mes también se arma dos veces (`orden-pago-nueva.tsx:359-383`, `plan-pagos.tsx:225-238`) y una tercera en `certificado-retencion.pagosAnteriores`.
- **Consecuencia**: en honorarios (escala) la OP y el Plan pueden retener distinto por centavos/pesos; cualquier cambio de RG 830 hay que hacerlo en dos lugares.
- **Solución**: que la OP use `calcularRetencionGanancias` y una función única `acumuladoMensual(proveedor, mes)`.
- **Esfuerzo**: S.

### H5 — Las OP del Plan de pagos no anotan la retención congelada (error funcional, medio, estático)
- **Síntoma**: futuro: el certificado y el TXT SICORE de esas OP se recalculan con el concepto de hoy del proveedor.
- **Causa raíz**: solo `orden-pago-nueva.tsx:889,991` hace `update(opRetencionAnotada())`; `plan-pagos.tsx:386-406` no. Y en la OP se hace como update aparte, fuera de la transacción del RPC.
- **Consecuencia**: si se edita el concepto del proveedor, cambian certificado/TXT de OP ya pagadas (lo que la mejora H quería evitar). Hoy 0 pagos de plan con retención; 47 OP con retención, todas anotadas.
- **Solución**: pasar las 4 columnas como parámetros del RPC (que las guarde en el mismo insert); mientras, hacer el mismo update en plan-pagos.
- **Esfuerzo**: S.

### H6 — Cobro con saldo a favor en dos transacciones (riesgo, bajo, estático)
- **Causa raíz**: `cobro-masivo-liquidacion.tsx:420-455` llama `aplicar_saldo_favor_cliente` y después `registrar_cobro_masivo_*`.
- **Consecuencia**: si la segunda falla y el usuario abandona, queda aplicado el crédito sin el cobro. Mitigado con aviso y `sfAplicadoRef`.
- **Solución**: un RPC que reciba `p_saldo_favor` y haga todo junto.
- **Esfuerzo**: M.

### H7 — Plan de pagos usa la retención calculada al armar el plan (riesgo, medio, estático)
- **Causa raíz**: `pagos_lote_items.retencion_monto/base_retencion` se guardan en `guardarPlan` (`plan-pagos.tsx:322-336`) y se mandan tal cual al pagar (`:386-391`); solo avisa si cambia el mes.
- **Consecuencia**: si entre el armado y el pago se hizo otra OP al mismo proveedor en el mes, se retiene de menos (o de más); el TXT SICORE sale con montos que no cumplen el art. 26.
- **Solución**: recalcular retención y base al registrar el pago (o al menos comparar con el acumulado actual y avisar la diferencia).
- **Esfuerzo**: S.

### H8 — `clientes.saldo_cuenta_corriente` (columna muerta) todavía se lee (riesgo, bajo, ejecución)
- **Causa raíz**: `presupuestos-lista.tsx:311,3225` (aviso "Límite de crédito excedido") y `lib/supabase/queries/clientes.ts:43 getClienteStats` (sin uso) leen la columna que nadie actualiza; 24 clientes la tienen con valores viejos (suma −$220,7 M).
- **Consecuencia**: hoy nula (ningún cliente con límite de crédito). Si Augusto carga límites, el aviso en Presupuestos no se va a disparar (o saltará mal).
- **Solución**: usar `superaLimiteCredito` + `traerSaldosClientes` (como Facturación) o el hook `use-saldos-clientes`.
- **Esfuerzo**: S.

### H9 — Permiso del RPC de pagos más laxo que el resto (riesgo, bajo, estático)
- `registrar_pago_proveedor_seguro` (`20261026190000:85-95`) solo exige membresía si el usuario tiene alguna fila en user_sociedades; `_con_nc`, `aplicar_saldo_favor_cliente` exigen siempre. Hoy todos los perfiles tienen sociedad. Solución: misma condición que `_con_nc` (S).

### H10 — Finanzas vieja sigue escribiendo con lógica propia (deuda, bajo, estático)
- `handlePagarOP` (`finanzas-vieja/page.tsx:1814-1846`): updates encadenados sin transacción, tolerancia $1, ignora pagos directos y NC. Solución: quitar el botón o llamar a una RPC; plan de retiro de la vieja (Revisar, correo, caja proyectada a Lazza) (M).

### Otros menores (mejora)
- `facturas.total_acreditado` con 4 decimales en 6 NC de venta (p. ej. 1086.7736): el `max(0, …)` lo tapa; redondear al guardar.
- `plan-pagos.tsx:125` pagina por fecha sin desempate por id.
- `saldo_a_favor_cliente` parcial: `aplicar_saldo_favor_cliente` reescribe el `monto` del crédito original (el histórico queda solo en texto).
- `lz_cheque_libre_para_op` depende de `op.created_at = e.created_at` para saber que el cheque lo creó la OP.

## Bien hecho (verificado)
- Ventas: una sola regla de saldo (TS y base equivalentes) usada en todas las pantallas; datos reales sin contradicciones estado/saldo.
- RPC de pagos y cobros atómicas, idempotentes (`request_key`, `pago_solicitudes`), con candado por proveedor/cliente y validaciones de sociedad.
- Anular OP: revierte NC (movimiento y total_acreditado), reabre Plan de pagos, recalcula con `fc_compra_pagado`; anular cobro anula el saldo a favor que generó (trigger).
- Integridad verificada con datos: 0 OP anuladas con movimiento vivo, 0 OP vivas sin movimiento, 0 saldos a favor de OP anuladas, 0 aplicaciones mayores a su cobro, 0 cheques en cartera de cobros anulados.
- Lecturas de Finanzas Lazza paginadas con `traerTodo` y orden estable por id; siempre filtran por sociedad_id.
- Retención congelada (mejora H) aplicada a las 47 OP con retención.
- Conciliación con "solo_pendiente" para no pisar a otra persona; cheques "cobrado" solo por el banco.
- Las 12 pruebas puras de finanzas corridas pasan.

## Conexiones con otros módulos
| Desde | Hacia | Dato | Fuente de verdad | Compatible |
|---|---|---|---|---|
| Facturación (ARCA) | Finanzas Facturas/CC | facturas, total_acreditado de NC | facturas + lz_cobrado_factura | sí |
| Cobros (RPC) | CC clientes / Facturas | cobrado por factura | movimientos + cobro_aplicaciones | sí |
| Compras Lazza (carga FC/NC) | CC proveedores / OP | saldo factura compra | fc_compra_pagado (declarada) vs 6 copias | dudoso (H1) |
| OP / Plan | Retenciones / SICORE | base y retención, régimen congelado | ordenes_pago.retencion_* | dudoso (H5, H7) |
| Gastos | Bancos / Caja | egreso | movimientos.gasto_manual_id | no (H2) |
| Extracto BBVA | Cheques / Bancos / Facturas | cheque cobrado, conciliado | aplicar_cruces_extracto | sí |
| Finanzas (CC clientes) | Presupuestos (límite de crédito) | saldo del cliente | calcularSaldosClientes vs clientes.saldo_cuenta_corriente | no (H8) |
| Finanzas vieja | Finanzas Lazza | saldos CC | mismas libs | sí (ajustes legacy: hoy 0) |
| Saldo a favor proveedor | CC proveedores | créditos | saldos_favor_proveedor + OP sin facturas | sí |
| Personalización (FC manual) | CC proveedores | facturas_compra | facturas_compra | sí (no revisado a fondo) |
