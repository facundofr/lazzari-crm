# 05 — Problemas confirmados

Hallazgos que el revisor cruzado abrió y **no pudo refutar**. Cada uno figura una sola vez aunque lo hayan visto varios agentes.
Certeza: *Confirmado con datos/ejecución* = se vio en la base real (solo lectura) o corriendo una prueba; *Confirmado leyendo el código* = análisis estático con referencias exactas.
Las rutas de código son relativas a `crm/app/src/` salvo que se indique otra cosa. El detalle completo de cada agente está en `trabajo/`.

| ID | Severidad | Tipo | Certeza | Título |
|---|---|---|---|---|
| H01 | alto | Riesgo estructural | estatico | Cotización del dólar escribible sin login (anon INSERT/UPDATE en cotizaciones_dolar) |
| H02 | alto | Error funcional | ejecucion | Vistas sin security_invoker legibles por anon (v_facturas_pendientes, v_presupuestos_completos, v_comparador_precios) |
| H03 | alto | Error funcional | estatico | Funciones SECURITY DEFINER ejecutables por anon sin chequeo (get_dashboard_kpis, get_balance_projection, increment_stock, check_presupuestos_vencidos) |
| H04 | alto | Riesgo estructural | estatico | Storage: 5 buckets públicos; facturas-compra con insert/update/select para rol public; comprobantes listables por anon |
| H05 | alto | Riesgo estructural | estatico | RLS de tablas de plata sin rol ni sociedad (facturas_compra ALL true; ninguna tabla vieja filtra sociedad_id; factura_items editable con CAE) |
| H06 | alto | Riesgo estructural | estatico | Editar un PR borra y recrea todos sus renglones: se cortan vínculos con OC, remitos y personalización |
| H08 | alto | Error funcional | estatico | Pestaña Cta. Cte. del cliente suma NC como deuda y usa el total en vez del saldo; se copia/envía al cliente |
| H09 | alto | Riesgo estructural | ejecucion | Rechazar / No facturar un PR no avisa ni cancela sus OC |
| H13 | alto | Riesgo estructural | estatico | Factura común autorizada por ARCA sin recuperación si falla el guardado; el PV queda trabado y el PR se marca facturado igual |
| H15 | alto | Error funcional | ejecucion | Anular un cobro o borrar un gasto deja la línea del banco conciliada contra un movimiento anulado |
| H16 | alto | Riesgo estructural | ejecucion | Pruebas de regresión rotas desde la mudanza de Finanzas y fuera del build |
| H07 | medio | Error funcional | estatico | Los RPC del PR no guardan descuento_porcentaje, precio_lista, catalogo_id, pedido_texto, ia_* |
| H10 | medio | Error funcional | ejecucion | OC que figuran Completo sin que haya llegado nada (columna estado manda sobre renglones) |
| H11 | medio | Riesgo estructural | estatico | Editar OC en Compras Lazza: varios pasos sin transacción y borrado con cascada a asignaciones |
| H12 | medio | Error funcional | ejecucion | Total guardado de la factura distinto del autorizado por ARCA (trigger recalcular_factura) |
| H14 | medio | Riesgo estructural | estatico | Dividir remito borra todos los renglones antes de reinsertar y no revisa errores |
| H17 | medio | Riesgo estructural | estatico | Saldo de factura de compra implementado en 7 lugares con criterios distintos (incluye validador que ignora NC) |
| H18 | medio | Riesgo estructural | estatico | Pago con tarjeta cuenta dos veces el crédito de una NC |
| H19 | medio | Error funcional | ejecucion | Factura de compra 'pagada' sin pago: Finanzas la da en 0 y la base como deuda total |
| H22 | medio | Error funcional | ejecucion | Factura de compra pagada de más en $219.548 (total editable después de pagar) |
| H24 | medio | Error funcional | ejecucion | Proveedores duplicados por CUIT con guiones |
| H25 | medio | Error funcional | estatico | Las OP del Plan de pagos no anotan la retención congelada |
| H28 | medio | Riesgo estructural | estatico | Saldo de factura de venta con fórmulas paralelas (NC RPC, agente-mail, asistente de Finanzas que además lista NC como deuda) |
| H29 | medio | Error funcional | ejecucion | Dos definiciones de saldo a favor del cliente (NC vs ajustes crédito) |
| H31 | medio | Riesgo estructural | estatico | Anular / revertir factura sin CAE por update directo |
| H32 | medio | Error funcional | estatico | Facturación masiva elige FA/FB con otra regla que el modal (monotributistas) |
| H39 | medio | Error funcional | ejecucion | Dashboard: tasa de conversión solo cuenta 'aprobado' |
| H41 | medio | Error funcional | estatico | Clientes > Consumo: solo 'aprobado' y total facturado mezcla monedas, anuladas y NC |
| H42 | medio | Error funcional | ejecucion | OC con costos en pesos y dólares suman como pesos |
| H43 | medio | Riesgo estructural | ejecucion | Margen mínimo 15 %: tres fórmulas y sin TC mezcla monedas |
| H44 | medio | Riesgo estructural | estatico | Aprobar un PR arma las OC en el navegador sin transacción; reaprobar no completa; doble aprobación posible |
| H45 | medio | Error funcional | estatico | Restaurar un PR eliminado le crea OC aunque no esté aprobado |
| H49 | medio | Riesgo estructural | estatico | Tipos generados desactualizados (34 tablas) y 550 'supabase as any' |
| H50 | medio | Riesgo estructural | ejecucion | Ejes factura/pago de OC sin alimentar desde 19/10 y todavía leídos (Ventas, IA, Finanzas vieja) |
| H53 | medio | Riesgo estructural | estatico | Borrar una factura de compra cascada el vínculo con la OP sin auditoría |
| H61 | medio | Mejora / deuda | estatico | Pantallas gigantes y duplicadas vivas por URL con lógica de escritura propia |
| H26 | bajo | Riesgo estructural | estatico | Retención Ganancias calculada con dos fórmulas (OP vs Plan) |
| H30 | bajo | Riesgo estructural | estatico | Presupuestos usa la columna vieja saldo_cuenta_corriente para el aviso de límite de crédito |
| H33 | bajo | Error funcional | estatico | Liquidar transporte crea la factura de compra como 'mercaderia' |
| H35 | bajo | Error funcional | estatico | ai-presupuesto lee catálogo sin sesión: la IA nunca ve precios |
| H36 | bajo | Riesgo estructural | estatico | Tres crons fallan abiertos si falta CRON_SECRET |
| H37 | bajo | Riesgo estructural | estatico | Dos reglas de cotización para facturas (cache-first vs BNA-first) |
| H38 | bajo | Riesgo estructural | estatico | email/send: remitente del navegador para PR/remitos/OC y descarga de URLs arbitrarias |
| H40 | bajo | Error funcional | ejecucion | Alertas de PR aprobado/rechazado del trigger sin sociedad |
| H46 | bajo | Error funcional | estatico | Duplicar PR copia fecha, vencimiento, eliminado e ia_*; renglones sin chequeo de error |
| H47 | bajo | Riesgo estructural | estatico | Recepción vieja mueve stock y Compras Lazza no; increment_stock sin control |
| H56 | bajo | Error funcional | estatico | Editar un PR falla en silencio al actualizar el encabezado de sus OC (estado 'pendiente' no existe en oc_status) |
| H64 | bajo | Riesgo estructural | estatico | Índice único de facturas sin sociedad_id (choca el comprobante X) |
| H70 | bajo | Error funcional | estatico | Aviso de 5 días de PR nunca se crea (dedupe por título) |
| H80 | bajo | Riesgo estructural | ejecucion | 'Conciliado' con tres fuentes y significados |
| H83 | bajo | Mejora / deuda | ejecucion | Migraciones sin registro desde 08/10, 49 sin rollback y trigger de 20261007113000 ausente |

## ALTO (11)

### H01 — Cotización del dólar escribible sin login (anon INSERT/UPDATE en cotizaciones_dolar)

- **Severidad:** ALTO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A5 Integraciones e IA, A6 Base y seguridad
- **Evidencia:** pg_policies cotiz_insert_anon/cotiz_update_anon {anon} true; middleware.ts:36 /api/cotizacion-bna pública; bna-historical.ts:14-16 confía en es_manual/fuente; facturacion/route.ts:425-433 re-verifica contra BNA en vivo (409); dolar-presupuesto.ts:75-90, cobro-masivo-liquidacion.tsx:166, fx-settlement-dialog.tsx:236 usan la tabla/ruta cache-first
- **Síntoma:** Ninguno visible hoy (0 filas manuales).
- **Causa raíz:** Excepción para el cron anónimo que quedó después de pasar el cron a service role; la confianza se basa en columnas que escribe el anónimo
- **Consecuencia:** Con la clave anon (publica) se puede cargar un dolar falso marcado como manual o 'BNA historico v2' que toman presupuestos y, si el BNA no responde, la facturacion USD.
- **Solución propuesta (del agente):** Migracion aditiva que quite cotiz_insert_anon y cotiz_update_anon (con rollback), agregar UPDATE para authenticated con los roles de cotiz_insert; /api/cotizacion-bna escribe con service role o no escribe. (esfuerzo S)
- **Verificación cruzada:** Confirmado en políticas y código. Bajado de crítico (A6) a alto: la emisión ARCA re-verifica contra BNA en vivo; el daño posible queda en presupuestos, liquidaciones FX y el respaldo cuando el BNA cae

### H02 — Vistas sin security_invoker legibles por anon (v_facturas_pendientes, v_presupuestos_completos, v_comparador_precios)

- **Severidad:** ALTO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A6 Base y seguridad
- **Evidencia:** pg_class.reloptions null en 7 de 8 vistas; has_table_privilege('anon') true en 3; A6 leyó como anon 73 y 243 filas
- **Síntoma:** Con la clave pública del navegador se listan facturas pendientes y presupuestos de clientes.
- **Causa raíz:** Vistas creadas por postgres corren como dueño y saltean RLS; grants por defecto a anon
- **Consecuencia:** Fuga de datos de clientes y montos; vendedores ven ambas sociedades.
- **Solución propuesta (del agente):** alter view ... set (security_invoker=true) y revoke select from anon; revocar las que no se usan. (esfuerzo S)
- **Verificación cruzada:** Verificado en catálogo; las vistas son legacy, revocar no rompe pantallas

### H03 — Funciones SECURITY DEFINER ejecutables por anon sin chequeo (get_dashboard_kpis, get_balance_projection, increment_stock, check_presupuestos_vencidos)

- **Severidad:** ALTO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A6 Base y seguridad, A2 Compras, A4 Facturación y logística
- **Evidencia:** has_function_privilege('anon') true, prosecdef true y sin auth.uid en el cuerpo
- **Causa raíz:** Funciones viejas sin revoke execute from anon/public
- **Verificación cruzada:** Verificado; delete_presupuesto_safe/change_pr_operator también son ejecutables por anon pero usan auth.uid (quedan en bajo)

### H04 — Storage: 5 buckets públicos; facturas-compra con insert/update/select para rol public; comprobantes listables por anon

- **Severidad:** ALTO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A5 Integraciones e IA, A6 Base y seguridad
- **Evidencia:** storage.buckets public=true sin límites; políticas 'auth insert/update facturas-compra' y 'public read facturas-compra' {public}, 'Public read comprobantes' {anon}
- **Síntoma:** Comprobantes bancarios, facturas de proveedores y certificados de retención descargables y listables por cualquiera.
- **Causa raíz:** Buckets creados públicos y políticas dadas a public/anon
- **Consecuencia:** Exposición de CBU, montos, CUIT; posibilidad de pisar PDFs de facturas de compra.
- **Solución propuesta (del agente):** Buckets privados con URLs firmadas; políticas solo authenticated (y por sociedad); eliminar políticas public/anon. Avisar que links viejos dejan de andar. (esfuerzo M)
- **Verificación cruzada:** Verificado en catálogo

### H05 — RLS de tablas de plata sin rol ni sociedad (facturas_compra ALL true; ninguna tabla vieja filtra sociedad_id; factura_items editable con CAE)

- **Severidad:** ALTO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras, A4 Facturación y logística, A6 Base y seguridad
- **Evidencia:** pg_policies facturas_compra SELECT/INSERT/UPDATE/DELETE true; factura_compra_ocs ALL true; facturas/factura_items/movimientos/presupuestos/clientes solo por rol; auth-context.tsx:103-113 sin filas = todas las sociedades
- **Causa raíz:** Aislamiento por sociedad e inmutabilidad fiscal delegados al front
- **Verificación cruzada:** Tres hallazgos consolidados (misma solución). Verificado en pg_policies y auth-context

### H06 — Editar un PR borra y recrea todos sus renglones: se cortan vínculos con OC, remitos y personalización

- **Severidad:** ALTO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial, A7 Flujos y fuentes de verdad
- **Evidencia:** actualizar_presupuesto_atomico: delete from presupuesto_items + insert de 17 columnas; FKs remito_items/orden_compra_items/personalizacion_items/lz_oc_ajustes ON DELETE SET NULL; syncOCsFromPR presupuestos-lista.tsx:1829-1867 re-ata solo por código/descripción en OC del mismo proveedor; remitos nunca se re-atan. Datos: 47/364 remito_items y 35/463 OC items sin vínculo
- **Síntoma:** Tras editar un PR, lo remitido por renglón se calcula por descripción+orden y la sincronización de OC empareja por código/descripción; se pierden pedido_texto, catalogo_id, ia_*, entregado, facturado, precio_lista, descuento_porcentaje
- **Causa raíz:** Reemplazo destructivo en vez de upsert por id, con FKs SET NULL silenciosas
- **Consecuencia:** Pendientes de remitir/comprar mal calculados, posible doble pedido si Compras movió un renglón a otro proveedor, trazabilidad perdida
- **Solución propuesta (del agente):** Que la RPC reciba el id de cada renglón y haga update/insert/delete por diferencia, copiando todas las columnas; test (esfuerzo M)
- **Verificación cruzada:** Intenté refutar con syncOCsFromPR: mitiga OC del mismo proveedor pero no renglones movidos a otro proveedor (doble pedido) ni remitos

### H08 — Pestaña Cta. Cte. del cliente suma NC como deuda y usa el total en vez del saldo; se copia/envía al cliente

- **Severidad:** ALTO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** clientes/page.tsx:827-832 estado='emitida' sin filtrar tipo; 2497-2500 suma f.total; handleCopiarCC/handleEnviarCC 1439-1459 con mailto. SELECT: 16 NC en emitida con total positivo
- **Síntoma:** 'Facturas pendientes de cobro' y 'Total adeudado' incluyen notas de crédito (ej. NCB $1.347.041,25) y no descuentan cobros parciales
- **Causa raíz:** Regla vieja por estado en vez de lib/saldo-clientes
- **Consecuencia:** Estado de cuenta enviado al cliente con deuda que no existe
- **Solución propuesta (del agente):** Construir la pestaña con traerDatosSaldoClientes + saldoFacturaVenta (sin NC, con parciales, mostrando saldo) (esfuerzo S)
- **Verificación cruzada:** Verificado código y datos

### H09 — Rechazar / No facturar un PR no avisa ni cancela sus OC

- **Severidad:** ALTO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** doEstadoChange presupuestos-lista.tsx:2201-2232 solo actúa con 'aprobado' (handleDelete 2331-2352 sí pregunta). SELECT: OC-2026-1117/1133/1155/1173 recibidas y pagadas de PR rechazados (~$19,1 M)
- **Síntoma:** La venta queda rechazada y sus compras siguen vivas sin ningún aviso
- **Causa raíz:** Estado del PR no se propaga a Compras; sin regla única de venta caída
- **Consecuencia:** Mercadería comprada y pagada sin venta asociada ni seguimiento
- **Solución propuesta (del agente):** Función única para cerrar/rechazar venta que avise y proponga cancelar OC no pedidas o destinar lo recibido (aviso, nunca bloqueo); revisar los 4 casos (esfuerzo M)
- **Verificación cruzada:** Verificado código y datos

### H13 — Factura común autorizada por ARCA sin recuperación si falla el guardado; el PV queda trabado y el PR se marca facturado igual

- **Severidad:** ALTO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A4 Facturación y logística
- **Evidencia:** route.ts:795-801 marca authorized antes del insert; 894-906 success sin id; 684-731 reanuda solo NC; índice único fiscal_emission_attempts_unresolved_pv; emitir-factura-modal.tsx:476-477 y facturacion-content.tsx:690-692 marcan PR con success:true; guardarResto(undefined). Hoy 121 completed
- **Síntoma:** La factura existe en ARCA pero no en el CRM: no suma deuda, no se cobra y no va al IVA. El punto de venta queda bloqueado y el PR queda 'facturado'.
- **Causa raíz:** Reanudación idempotente hecha solo para NC; pasos posteriores en el navegador
- **Consecuencia:** Plata y fiscal fuera del sistema hasta que alguien concilie a mano con SQL.
- **Solución propuesta (del agente):** Una RPC registrar_factura_venta_autorizada análoga a la de NC: cabecera, renglones y PR facturado en una transacción, idempotente por request_key, reintentada en el replay. La UI no debe marcar el PR si reconciliation_required. (esfuerzo M)
- **Verificación cruzada:** Consolida H2, H4 y H11 de A4. Verificado código e índice. Choca con la regla 'nada me puede frenar'

### H15 — Anular un cobro o borrar un gasto deja la línea del banco conciliada contra un movimiento anulado

- **Severidad:** ALTO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A7 Flujos y fuentes de verdad, A3 Finanzas
- **Evidencia:** gestionar_cobro no menciona extracto; desconciliar_movimiento sí. gastos.tsx:205-212 usa gestionar_cobro anular y borra el gasto. SELECT: 4 líneas 'matcheado' contra pagos [ANULADO] de sueldos/comisiones (589.100x2, 400.000, 560.000 = $2.138.200)
- **Síntoma:** El débito del banco figura conciliado pero el gasto/cobro ya no existe.
- **Causa raíz:** Dos caminos para deshacer un movimiento; solo uno libera la línea del extracto
- **Consecuencia:** La línea no vuelve a pendientes, nadie la reclasifica; banco y libros dejan de cuadrar sin aviso. Un cheque depositado y rechazado deja la acreditación explicada por un cobro anulado.
- **Solución propuesta (del agente):** En gestionar_cobro (anular/eliminar) liberar las líneas del extracto con la misma lógica de desconciliar_movimiento y avisar. Script aditivo para volver a 'pendiente' las 4 líneas, con OK de Augusto. (esfuerzo S)
- **Verificación cruzada:** Verificado función y datos; el disparador es el Borrar gasto que revisó A3

### H16 — Pruebas de regresión rotas desde la mudanza de Finanzas y fuera del build

- **Severidad:** ALTO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A8 Arquitectura y QA, A1 Comercial
- **Evidencia:** Corrí scripts/test-op-validation.mjs (puro): exit 1, AssertionError; lee src/app/(crm)/finanzas/page.tsx (hoy la pantalla nueva). 12 tests leen esa ruta. package.json build = check:hooks && next build
- **Síntoma:** npm run test:regressions se corta en el 4.º script. No hay red de seguridad para OP, pago directo, e-cheqs ni redondeo.
- **Causa raíz:** Tests que leen texto de archivos con regex, atados a la ruta, sin proceso que los corra
- **Consecuencia:** Un cambio que rompa reglas de plata se publica sin aviso. La OP real hoy está en components/orden-pago-nueva.tsx, que no tiene ningún test.
- **Solución propuesta (del agente):** Armar un comando test:lib con los tests puros de src/lib y meterlo en build antes de next build. Reescribir como tests de lib los 14 rotos, o jubilarlos, decidiendo caso por caso. (esfuerzo M)
- **Verificación cruzada:** Confirmado por ejecución

## MEDIO (25)

### H07 — Los RPC del PR no guardan descuento_porcentaje, precio_lista, catalogo_id, pedido_texto, ia_*

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial, A7 Flujos y fuentes de verdad
- **Evidencia:** Lista de columnas del insert en actualizar_presupuesto_atomico; el front las manda en presupuestos-lista.tsx:1569-1570
- **Causa raíz:** Columnas agregadas después sin actualizar los RPC
- **Verificación cruzada:** Verificado en el cuerpo del RPC

### H10 — OC que figuran Completo sin que haya llegado nada (columna estado manda sobre renglones)

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras
- **Evidencia:** oc-lista.ts:41 (no 412: el archivo tiene 101 líneas). SELECT: OC-2026-1251/1275/1278/1281 recibida con 0 recibido; 1283 enviada con todo recibido (se ve bien en Lazza)
- **Causa raíz:** Estado de mercadería guardado en dos lugares, escrito por cliente, trigger que solo sube y pantalla vieja
- **Verificación cruzada:** Confirmado; bajado de alto a medio: 4 OC de 1-3 unidades y arreglo S. A7 decía lo contrario porque solo comparó ejes de facturación/pago

### H11 — Editar OC en Compras Lazza: varios pasos sin transacción y borrado con cascada a asignaciones

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras
- **Evidencia:** compras-lazza-oc.tsx:175-251 (delete, update, insert, update encabezado, update presupuesto_items, cada uno con throw sin deshacer); FK factura_compra_asignaciones y lz_oc_ajustes ON DELETE CASCADE
- **Síntoma:** Si se corta a mitad, la OC queda con renglones borrados y el resto sin actualizar; el PR puede quedar con otro costo.
- **Causa raíz:** Operación compuesta armada en el navegador
- **Consecuencia:** Pérdida de renglones, estado_facturacion desactualizado, costos de PR distintos a la OC.
- **Solución propuesta (del agente):** RPC guardar_oc_lazza transaccional (con recálculo de estado y control de updated_at); no borrar renglones con asignaciones (RESTRICT o marca de anulado). (esfuerzo M)
- **Verificación cruzada:** Confirmado; bajado de alto a medio: el borrado es el pedido por el usuario y desde 19/10 las facturas no se atan a OC

### H12 — Total guardado de la factura distinto del autorizado por ARCA (trigger recalcular_factura)

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A4 Facturación y logística, A7 Flujos y fuentes de verdad
- **Evidencia:** SELECT: 20/120 fiscal_emission_attempts.response.factura.total (=ImpTotal, route.ts:746/799) ≠ facturas.total (ej. FA 15-30 9.220.848,57 vs ,56). recalcular_factura AFTER INSERT/UPDATE/DELETE en factura_items redondea al final y no mira cae
- **Síntoma:** El PDF y el QR muestran un importe distinto al autorizado, aparecen saldos de 0,01 y quedó un saldo_a_favor_cliente fantasma de 0,01 en la NCEA 0015-00000001.
- **Causa raíz:** Dos fuentes de verdad del total con redondeos distintos; trigger sin guarda para comprobantes con CAE
- **Consecuencia:** Hay diferencias de centavos contra ARCA (Libro IVA Digital, Mis Comprobantes), el QR no coincide, quedan facturas 'parcial' por 0,01 y créditos fantasma.
- **Solución propuesta (del agente):** El trigger no debe tocar facturas con cae (o tiene que redondear por renglón igual que ARCA, solo para X). Los importes se guardan tal como se enviaron a ARCA. Script de corrección de los 20 comprobantes con rollback, tomando el total de fiscal_emission_attempts. Una función pura única de totales con su test. (esfuerzo M)
- **Verificación cruzada:** Confirmado por ejecución; bajado de alto a medio: impacto de ±0,01/0,02. La versión de A7 'total igual en todos' queda refutada

### H14 — Dividir remito borra todos los renglones antes de reinsertar y no revisa errores

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A4 Facturación y logística
- **Evidencia:** remitos/page.tsx:526-589 update, delete, insert, next_cai_number, insert sin mirar {error}. SELECT: 2 remitos divididos, 0 remitos sin renglones
- **Síntoma:** Si un insert falla, el remito original queda sin renglones, o quedan remitos nuevos vacíos con números de CAI consumidos.
- **Causa raíz:** Operación de varios pasos en el navegador sin transacción
- **Consecuencia:** Se pierden renglones de un remito (108 de 129 tienen CAI) y el estado de entrega del PR se calcula mal.
- **Solución propuesta (del agente):** Una RPC dividir_remito en una transacción (incluye next_cai_number). Como parche: insertar antes de borrar y chequear errores en cada paso. (esfuerzo S)
- **Verificación cruzada:** Confirmado en código; bajado de alto a medio: sin daño observado y poco uso

### H17 — Saldo de factura de compra implementado en 7 lugares con criterios distintos (incluye validador que ignora NC)

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras, A3 Finanzas, A6 Base y seguridad, A7 Flujos y fuentes de verdad, A8 Arquitectura y QA
- **Evidencia:** fc_compra_pagado greatest(total_acreditado, mov NC); registrar_pago_proveedor_seguro modo OP (20261026190000:235-252) sin total_acreditado y modo directo con fc_compra_pagado (607); validar_saldo_aplicacion_factura_compra contra total; finanzas-lazza.ts:482, saldo-proveedores.ts, orden-pago-nueva.tsx, plan-pagos.tsx, saldo-factura-compra.ts (sin uso)
- **Síntoma:** Hoy ninguno: verificado que las 4 facturas con NC tienen los dos rastros iguales.
- **Causa raíz:** Regla declarada única pero recalculada a mano en RPC, trigger y pantallas
- **Consecuencia:** Si una NC deja solo total_acreditado (carga vieja, script, corrección), la OP muestra saldo de más, la base deja pagar de más y no marca pagada, y la CC dice otra cosa.
- **Solución propuesta (del agente):** Usar fc_compra_pagado en el RPC y en el trigger. Exponer una vista o RPC de lectura saldo_facturas_compra(sociedad) para OP y Plan. Unificar las funciones TS y borrar la que no se usa. Agregar un chequeo total_acreditado contra los movimientos de NC. (esfuerzo M)
- **Verificación cruzada:** Verificado en cuerpos SQL; medio (A8 alto) porque hoy 0 casos: cada NC deja los dos rastros

### H18 — Pago con tarjeta cuenta dos veces el crédito de una NC

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras
- **Evidencia:** registrar_pago_tarjeta_factura_compra líneas 28-32 suma todos los movimientos pago (sin excluir nota_credito_compra_id) + total_acreditado; fc_compra_pagado usa greatest
- **Síntoma:** Al pagar con Visa una factura con NC aplicada, el pago sale por menos y la factura queda 'pagada'.
- **Causa raíz:** RPC con fórmula propia en vez de fc_compra_pagado
- **Consecuencia:** Deuda real con el proveedor escondida.
- **Solución propuesta (del agente):** Que la RPC use fc_compra_pagado(f.id, f.sociedad_id). (esfuerzo S)
- **Verificación cruzada:** Verificado en el cuerpo de la función

### H19 — Factura de compra 'pagada' sin pago: Finanzas la da en 0 y la base como deuda total

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras, A3 Finanzas, A6 Base y seguridad, A7 Flujos y fuentes de verdad, A8 Arquitectura y QA
- **Evidencia:** SELECT: 3 de 123 pagadas con fc_compra_pagado<total (INGA 00002-145 US$1.100, 00002-140 US$550, PORCEL 0001-415 $500.000, Grupo LA). Origen: opción 'Ya pagada por otro medio (sin OP)' cargar-factura-oc.tsx:2445 → pagadaSinOP (228) → estado 'pagada' (1315) sin movimiento
- **Síntoma:** Las tres figuran pagadas en Finanzas, pero para la base deben el total, y el egreso no está en Bancos.
- **Causa raíz:** Excepción de negocio (pagada por otro medio) implementada solo en TS; la SQL no la conoce
- **Consecuencia:** Si se anula una OP o NC sobre ellas, la base las vuelve a pendiente por el total. Bancos no refleja el pago.
- **Solución propuesta (del agente):** Registrar el pago real (o un movimiento de pago sin cuenta) y eliminar la excepción, o documentarla también en la base. (esfuerzo S)
- **Verificación cruzada:** Datos confirmados; la causa que los agentes dejaron como hipótesis se encontró en el código (es por diseño)

### H22 — Factura de compra pagada de más en $219.548 (total editable después de pagar)

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A6 Base y seguridad
- **Evidencia:** SELECT: 0007-00024709 total 804.129,86, OP-000047 aplicó 1.023.677,92, total_acreditado 0; único trigger en facturas_compra lz_fact_pago_oc
- **Síntoma:** Factura 'pagada' con aplicación mayor al total y sin saldo a favor.
- **Causa raíz:** UPDATE del total sin revalidar aplicaciones (RLS true)
- **Consecuencia:** Diferencia de $219.548 sin explicar en la cuenta del proveedor.
- **Solución propuesta (del agente):** Revisar el caso con Augusto; trigger BEFORE UPDATE OF total que registre aviso en finanzas_revisar (no bloquear). (esfuerzo S)
- **Verificación cruzada:** Dato verificado; causa del cambio es hipótesis

### H24 — Proveedores duplicados por CUIT con guiones

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras
- **Evidencia:** SELECT: NESTLE 30546764040 / 30-54676404-0 y FERNANDEZ ANDRES ALBERTO 20252946358 / 20-25294635-8 en Lazzari
- **Síntoma:** Dos fichas del mismo proveedor; la factura puede ir a la ficha vacía.
- **Causa raíz:** CUIT sin normalizar burla el índice único
- **Consecuencia:** Cuenta corriente y retenciones partidas.
- **Solución propuesta (del agente):** Guardar solo dígitos, índice único sobre los dígitos, unir duplicados con script revisado por Augusto. (esfuerzo S)
- **Verificación cruzada:** Verificado en datos

### H25 — Las OP del Plan de pagos no anotan la retención congelada

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A3 Finanzas
- **Evidencia:** opRetencionAnotada solo en orden-pago-nueva.tsx:554/889/991; plan-pagos.tsx:386 llama al RPC sin anotar. Hoy 47 OP con retención, 0 sin anotar
- **Síntoma:** A futuro, el certificado y el TXT SICORE de esas OP se recalculan con el concepto de hoy del proveedor. Hoy hay 0 pagos de plan con retención y 47 OP con retención, todas anotadas.
- **Causa raíz:** Anotación fuera de la transacción del RPC y en un solo punto de entrada
- **Consecuencia:** Si se edita el concepto del proveedor, cambian el certificado y el TXT de OP ya pagadas.
- **Solución propuesta (del agente):** Pasar las 4 columnas retencion_ganancias_* como parámetros del RPC y guardarlas en el mismo insert. Mientras tanto, replicar el update en plan-pagos. (esfuerzo S)
- **Verificación cruzada:** Verificado por grep

### H28 — Saldo de factura de venta con fórmulas paralelas (NC RPC, agente-mail, asistente de Finanzas que además lista NC como deuda)

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A4 Facturación y logística, A7 Flujos y fuentes de verdad, A5 Integraciones e IA, A1 Comercial
- **Evidencia:** registrar_nota_credito_venta_autorizada 157-169 no excluye movimientos con aplicaciones (lz_cobrado_factura sí); finanzas/asistente/route.ts:60-73 sin cobros directos y sin filtrar tipo NC; agente-mail-server.ts:129-145 igual y .limit(3000)
- **Síntoma:** Hoy tapado porque cruzarPago tambien marca cobrada por estado 'pagada' (agente-mail.ts:133).
- **Causa raíz:** Cada módulo reescribió la cuenta en vez de usar saldo-clientes/lz_cobrado_factura
- **Consecuencia:** Con cobros directos parciales o aplicaciones de cobros anulados, el agente sugiere cargar un cobro ya hecho o el asistente informa deuda distinta a Cuentas corrientes.
- **Solución propuesta (del agente):** Usar cobradoPorFactura + saldoFacturaVenta en ambos, trayendo movimientos con factura_id y aplicaciones con movimientos(anulado); prueba en scripts. (esfuerzo S)
- **Verificación cruzada:** Verificado en código y SQL; hoy 0 casos de solapamiento

### H29 — Dos definiciones de saldo a favor del cliente (NC vs ajustes crédito)

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A7 Flujos y fuentes de verdad
- **Evidencia:** saldo-clientes.ts:133-138 suma saldo_a_favor_cliente de NC; saldo-favor-cliente.ts:20-23 solo ajustes crédito. SELECT: NCB 15-5 $59.500,24 y NCEA 15-1 0,01 a favor
- **Síntoma:** La CC muestra saldo a favor y 'Aplicar saldo a favor' no lo ofrece.
- **Causa raíz:** El crédito de NC queda en una columna que la herramienta de aplicar no mira
- **Consecuencia:** Se cobra de más o se arregla a mano; el crédito nunca se consume.
- **Solución propuesta (del agente):** Fuente única: al dejar saldo a favor, la NC crea también el ajuste crédito (y la CC deja de sumar la columna), o ampliar aplicar_saldo_favor_cliente para consumir NC. Script aditivo para el caso existente con OK. (esfuerzo M)
- **Verificación cruzada:** Verificado código y datos; contradice el 'alta' de A3

### H31 — Anular / revertir factura sin CAE por update directo

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A7 Flujos y fuentes de verdad, A4 Facturación y logística
- **Evidencia:** facturacion-content.tsx:705-727 update estado sin mirar cobros, NC ni PR
- **Síntoma:** Revertir deja 'emitida' una factura con cobros; anular deja cobros fuera de la CC.
- **Causa raíz:** Cambio de estado sin RPC ni recálculo
- **Consecuencia:** Estado de factura y CC incoherentes; PR no vuelve a 'facturar'.
- **Solución propuesta (del agente):** RPC anular_factura_manual que avise por cobros (pasarlos a favor), recalcule con lz_estado_factura_por_cobro y devuelva el PR; marcar PR facturado en el servidor. (esfuerzo S)
- **Verificación cruzada:** Verificado en código

### H32 — Facturación masiva elige FA/FB con otra regla que el modal (monotributistas)

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A4 Facturación y logística
- **Evidencia:** facturacion-content.tsx:660-661 solo RI→FA; factura-condicion.ts:55-57 RI y Monotributo→FA
- **Síntoma:** El mismo PR sale FB por masiva y FA por el modal.
- **Causa raíz:** Regla duplicada
- **Consecuencia:** Comprobante de tipo distinto según el camino; hay que hacer NC y reemitir.
- **Solución propuesta (del agente):** Usar tipoFacturaPorCondicionIva en la masiva. (esfuerzo S)
- **Verificación cruzada:** Verificado

### H39 — Dashboard: tasa de conversión solo cuenta 'aprobado'

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** get_dashboard_kpis(uuid) líneas 98-101; SQL del agente: 7,4 % vs 82,8 % real
- **Síntoma:** Muestra ≈ 7,4 % cuando la conversión real es ≈ 82,8 %; presupuestos_activos incluye eliminados
- **Causa raíz:** RPC no usa ESTADOS_GANADOS
- **Consecuencia:** Indicador comercial principal engañoso
- **Solución propuesta (del agente):** Usar estados ganados/perdidos únicos y excluir eliminado (migración aditiva con rollback) (esfuerzo S)
- **Verificación cruzada:** Verificado cuerpo de la RPC

### H41 — Clientes > Consumo: solo 'aprobado' y total facturado mezcla monedas, anuladas y NC

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** clientes/page.tsx:600-641
- **Síntoma:** Categorías casi vacías y total facturado inflado
- **Causa raíz:** Regla propia en vez de ESTADOS_GANADOS/totalVentasNeto
- **Consecuencia:** Información del cliente errónea para el vendedor
- **Solución propuesta (del agente):** Reusar ESTADOS_GANADOS y totalVentasNeto por moneda como la Ficha 360 (esfuerzo S)
- **Verificación cruzada:** Verificado

### H42 — OC con costos en pesos y dólares suman como pesos

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** presupuestos-lista.tsx:1893-1894 mixto→ARS; recalcular_oc no convierte; OC-2026-1242 (A1)
- **Síntoma:** Total de OC subestimado (el renglón en dólares cuenta como $127)
- **Causa raíz:** Agrupación por proveedor sin separar moneda
- **Consecuencia:** Costo de compra y deuda con proveedor mal calculados
- **Solución propuesta (del agente):** Separar OC por moneda de costo también para proveedores o avisar al armar (esfuerzo S)
- **Verificación cruzada:** Código verificado; dato por ejecución del agente

### H43 — Margen mínimo 15 %: tres fórmulas y sin TC mezcla monedas

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** presupuestos-lista.tsx:400/1499-1504, presupuesto-ia.ts, presupuesto-margen.ts (A1 lo ejecutó)
- **Síntoma:** El aviso al guardar no salta y la lista marca el PR en rojo; márgenes absurdos sin TC
- **Causa raíz:** Regla en tres lugares
- **Consecuencia:** Avisos de margen inconsistentes
- **Solución propuesta (del agente):** Una sola función de margen en lib/presupuesto-margen usada en guardar, IA y lista; sin TC devolver 'sin dato' (esfuerzo S)
- **Verificación cruzada:** Aceptado por ejecución del agente; no re-ejecutado

### H44 — Aprobar un PR arma las OC en el navegador sin transacción; reaprobar no completa; doble aprobación posible

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** doEstadoChange 2208-2232 escribe estado antes; generateOCsFromPresupuesto 1930-1939 sale si existe cualquier OC viva
- **Síntoma:** PR aprobado con proveedores sin OC u OC vacía
- **Causa raíz:** Operación multi-paso sin idempotencia por proveedor
- **Consecuencia:** Artículos vendidos que nunca se piden
- **Solución propuesta (del agente):** RPC aprobar_presupuesto que en una transacción cambie estado y arme las OC, idempotente por proveedor (esfuerzo M)
- **Verificación cruzada:** Verificado; la doble aprobación queda como hipótesis dentro del mismo hallazgo

### H45 — Restaurar un PR eliminado le crea OC aunque no esté aprobado

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** handleRestore 2379-2388; generateOCsFromPresupuesto 1919-1923 no lee estado
- **Síntoma:** Al restaurar un PR pendiente aparecen OC 'enviada' a proveedores
- **Causa raíz:** Ninguna de las dos funciones valida el estado
- **Consecuencia:** Compras de ventas no confirmadas
- **Solución propuesta (del agente):** Generar OC solo si el PR está aprobado (o preguntar) (esfuerzo S)
- **Verificación cruzada:** Verificado

### H49 — Tipos generados desactualizados (34 tablas) y 550 'supabase as any'

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A8 Arquitectura y QA
- **Evidencia:** 34 bloques Row en database.types.ts; 550 ocurrencias de 'supabase as any'
- **Síntoma:** tsc da 0 errores aunque una consulta use una columna mal escrita.
- **Causa raíz:** Tipos no se regeneran tras migraciones
- **Consecuencia:** Los errores de esquema aparecen recién en producción, y un cambio de RPC o de columna no rompe la compilación.
- **Solución propuesta (del agente):** Regenerar los tipos con supabase gen types después de cada migración y sacar los as any de a un módulo, empezando por los de plata. (esfuerzo M)
- **Verificación cruzada:** Verificado con grep; explica H56 (enum inválido no detectado)

### H50 — Ejes factura/pago de OC sin alimentar desde 19/10 y todavía leídos (Ventas, IA, Finanzas vieja)

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras
- **Evidencia:** 30 OC desde 19/10, 1 con estado_facturacion; lectores compras-lista-oc.tsx:359, ventas/page.tsx:79, api/ai/route.ts:73 (A2)
- **Síntoma:** Pantallas ocultas y la IA dicen 'falta factura/pago' en OC ya facturadas y pagadas.
- **Causa raíz:** Cambio de proceso sin retirar consumidores
- **Consecuencia:** Información falsa al consultar a la IA o pantallas por link.
- **Solución propuesta (del agente):** Decidir con Augusto: retirar esos ejes de todas las pantallas/IA o inferirlos por proveedor+PR. (esfuerzo S)
- **Verificación cruzada:** Aceptado por ejecución del agente

### H53 — Borrar una factura de compra cascada el vínculo con la OP sin auditoría

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A6 Base y seguridad
- **Evidencia:** pg_constraint: op_facturas_compra → CASCADE; movimientos → RESTRICT/NO ACTION; política DELETE true
- **Síntoma:** OP pagada que queda sin facturas.
- **Causa raíz:** Borrado físico permitido con cascada
- **Consecuencia:** El pago desaparece de la cuenta del proveedor sin rastro.
- **Solución propuesta (del agente):** DELETE solo vía RPC que exija sin OP vigente y registre en registros_eliminados; auditoría en facturas_compra y ordenes_pago. (esfuerzo S)
- **Verificación cruzada:** Verificado; un pago directo sí frena el borrado, una OP no

### H61 — Pantallas gigantes y duplicadas vivas por URL con lógica de escritura propia

- **Severidad:** MEDIO · **Tipo:** Mejora / deuda · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A8 Arquitectura y QA, A3 Finanzas, A2 Compras
- **Evidencia:** finanzas-vieja 6.615 líneas, presupuestos-lista 4.870, ordenes-compra 4.031; 3 componentes de carga de facturas de compra
- **Causa raíz:** Mudanza sin terminar
- **Verificación cruzada:** Verificado tamaños; causa transversal de varias regresiones

## BAJO (15)

### H26 — Retención Ganancias calculada con dos fórmulas (OP vs Plan)

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A3 Finanzas, A8 Arquitectura y QA
- **Evidencia:** orden-pago-nueva.tsx:536 pctRetencion (redondea alícuota de escala, retencion-conceptos.ts:65); plan-pagos.ts:85 retencionEscala exacta
- **Síntoma:** En honorarios (escala), la OP y el Plan pueden retener importes distintos por redondeo.
- **Causa raíz:** Fórmula copiada en el componente
- **Consecuencia:** Diferencias de centavos o pesos, y cualquier cambio de la RG 830 hay que hacerlo en dos lugares.
- **Solución propuesta (del agente):** Que la OP use calcularRetencionGanancias, y una función única para el acumulado mensual por proveedor. (esfuerzo S)
- **Verificación cruzada:** Verificado; diferencia de pesos solo en honorarios

### H30 — Presupuestos usa la columna vieja saldo_cuenta_corriente para el aviso de límite de crédito

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A3 Finanzas, A6 Base y seguridad, A7 Flujos y fuentes de verdad
- **Evidencia:** presupuestos-lista.tsx:311; triggers recalcular_saldo_* siguen escribiendo con otra fórmula; 0 clientes con límite
- **Síntoma:** Hoy no se ve, porque nadie tiene límite de crédito cargado.
- **Causa raíz:** Columna denormalizada no retirada
- **Consecuencia:** Cuando se carguen límites, el aviso no va a saltar o va a saltar mal.
- **Solución propuesta (del agente):** Usar superaLimiteCredito con traerSaldosClientes (como Facturación). (esfuerzo S)
- **Verificación cruzada:** Verificado; latente (sin límites cargados)

### H33 — Liquidar transporte crea la factura de compra como 'mercaderia'

- **Severidad:** BAJO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A4 Facturación y logística
- **Evidencia:** transportes/page.tsx:468
- **Síntoma:** Las próximas liquidaciones van a aparecer como compra de mercadería.
- **Causa raíz:** Valor fijo viejo
- **Consecuencia:** Reportes de gastos y filtros por tipo mal clasificados; la conciliación espera una OC.
- **Solución propuesta (del agente):** Cambiar a tipo: "transporte". (esfuerzo S)
- **Verificación cruzada:** Confirmado; bajado de medio a bajo (clasificación, sin plata)

### H35 — ai-presupuesto lee catálogo sin sesión: la IA nunca ve precios

- **Severidad:** BAJO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A5 Integraciones e IA
- **Evidencia:** ai-presupuesto/route.ts:22-26 createServerClient anon con getAll: () => []; listas vigentes = 0
- **Síntoma:** 'Generar con IA' devuelve renglones con costo 0 y 'No encontrado en catalogo'.
- **Causa raíz:** Cliente anónimo + catálogo migrado a otra fuente
- **Consecuencia:** Renglones con precio 0 si el vendedor no revisa; la funcion no aporta precios.
- **Solución propuesta (del agente):** Usar createSupabaseServer() con sesion y la misma fuente de catalogo que Cotizacion express/lista de costos, con traerTodo o busqueda por palabras. (esfuerzo S)
- **Verificación cruzada:** Confirmado; bajado de medio a bajo: no pierde datos, la función no aporta

### H36 — Tres crons fallan abiertos si falta CRON_SECRET

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A5 Integraciones e IA, A6 Base y seguridad
- **Evidencia:** agente-mail:15, bcra:20 if (cronSecret && …); presupuestos-vencimiento:119-125; cotizacion:71 falla cerrado
- **Síntoma:** Ninguno hoy (la variable existe).
- **Causa raíz:** Patrón de verificación copiado distinto
- **Consecuencia:** Sin la variable, cualquiera dispara vencimiento de PR, gasto de IA del agente o consultas BCRA masivas.
- **Solución propuesta (del agente):** Funcion unica exigirCronSecret(req) en src/lib que falle cerrado, usada por los 4 crons; no caer a anon key. (esfuerzo S)
- **Verificación cruzada:** Verificado; la variable existe hoy

### H37 — Dos reglas de cotización para facturas (cache-first vs BNA-first)

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A5 Integraciones e IA
- **Evidencia:** cotizacion-bna/route.ts:175-178 vs invoice-exchange-rate.ts:17-31; route.ts:428-431 rechaza con 409 si difieren
- **Síntoma:** Una correccion manual de la cotizacion no se aplica en la factura mientras el BNA responda.
- **Causa raíz:** Dos caminos escritos en momentos distintos
- **Consecuencia:** Diferencia entre la cotizacion que muestra la pantalla y la que se factura en casos limite.
- **Solución propuesta (del agente):** En getInvoiceExchangeRate mirar primero fila es_manual de la fecha objetivo; unificar 'dia anterior' en funcion pura con prueba; respaldo DolarAPI respeta es_manual. (esfuerzo S)
- **Verificación cruzada:** Bajado de medio a bajo: no factura mal, puede trabar en casos límite

### H38 — email/send: remitente del navegador para PR/remitos/OC y descarga de URLs arbitrarias

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A5 Integraciones e IA, A6 Base y seguridad
- **Evidencia:** email/send/route.ts:62-71 (documentos administrativos con remitente fijo; otros userEmail del body)
- **Síntoma:** Cualquier logueado puede mandar mails como otra dirección del dominio o hacer que el servidor pida URLs internas.
- **Causa raíz:** Datos de confianza tomados del cliente
- **Consecuencia:** Suplantación interna y SSRF básico.
- **Solución propuesta (del agente):** Remitente desde el perfil en servidor; permitir solo URLs del Storage propio. (esfuerzo S)
- **Verificación cruzada:** Confirmado parcial; A6 medio → bajo

### H40 — Alertas de PR aprobado/rechazado del trigger sin sociedad

- **Severidad:** BAJO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** presupuesto_estado_alert inserta sin sociedad_id; 274 alertas NULL (A1)
- **Síntoma:** Esos avisos no aparecen en el tablero; el texto dice $ aunque sea US$
- **Causa raíz:** Trigger anterior a multi-sociedad
- **Consecuencia:** Avisos perdidos
- **Solución propuesta (del agente):** Agregar NEW.sociedad_id y moneda al insert del trigger (esfuerzo S)
- **Verificación cruzada:** Verificado cuerpo

### H46 — Duplicar PR copia fecha, vencimiento, eliminado e ia_*; renglones sin chequeo de error

- **Severidad:** BAJO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial
- **Evidencia:** handleDuplicate 2294-2314
- **Síntoma:** El duplicado sale con fecha vieja y el cron lo vence al día siguiente; puede quedar sin renglones
- **Causa raíz:** Copia de fila con dos inserts sueltos
- **Consecuencia:** PR duplicados vencidos o vacíos
- **Solución propuesta (del agente):** Duplicar con crear_presupuesto_atomico, fecha de hoy y vencimiento nuevo (esfuerzo S)
- **Verificación cruzada:** Verificado

### H47 — Recepción vieja mueve stock y Compras Lazza no; increment_stock sin control

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A2 Compras, A8 Arquitectura y QA, A4 Facturación y logística
- **Evidencia:** ordenes-compra/page.tsx:1014-1028 vs compras-lazza-llego.tsx; productos = 0 filas
- **Síntoma:** El stock cambia o no según la pantalla por la que se cargó lo que llegó.
- **Causa raíz:** Dos recepciones vivas con reglas distintas
- **Consecuencia:** El stock y el estado de las OC quedan inconsistentes.
- **Solución propuesta (del agente):** Dejar las rutas ocultas en solo lectura o redirigirlas, y tener una única RPC de recepción. El stock no se toca sin el OK de Augusto. (esfuerzo S)
- **Verificación cruzada:** A8 medio → bajo: el stock no se usa

### H56 — Editar un PR falla en silencio al actualizar el encabezado de sus OC (estado 'pendiente' no existe en oc_status)

- **Severidad:** BAJO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** Revisor cruzado
- **Evidencia:** presupuestos-lista.tsx:1899 escribe estado:'pendiente'; enum oc_status = {borrador,enviada,confirmada,recibida_parcial,recibida,cancelada}; error no se revisa; totales igual se recalculan por trigger recalcular_oc, la moneda del encabezado no
- **Causa raíz:** Tipos desactualizados + 'as any' + error ignorado
- **Verificación cruzada:** Nuevo, verificado en enum y código

### H64 — Índice único de facturas sin sociedad_id (choca el comprobante X)

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A4 Facturación y logística
- **Evidencia:** facturas_tipo_punto_venta_numero_key (tipo, punto_venta, numero)
- **Síntoma:** El primer X de Grupo LA con un número ya usado por Lazzari falla con un error crudo de clave duplicada.
- **Causa raíz:** Índice anterior a multi-sociedad
- **Consecuencia:** Grupo LA no puede usar la numeración X independiente.
- **Solución propuesta (del agente):** Índice nuevo (sociedad_id, tipo, punto_venta, numero) agregado primero; después retirar el viejo. (esfuerzo S)
- **Verificación cruzada:** Verificado; solo afecta X (PV 0)

### H70 — Aviso de 5 días de PR nunca se crea (dedupe por título)

- **Severidad:** BAJO · **Tipo:** Error funcional · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** confirmado
- **Detectado por:** A1 Comercial, A5 Integraciones e IA
- **Evidencia:** cron/presupuestos-vencimiento/route.ts:34-35 mismo title 'Seguimiento PR'
- **Síntoma:** Solo llegan avisos de 3 y 7 dias.
- **Causa raíz:** Dedupe por título
- **Consecuencia:** Menos seguimiento de PR.
- **Solución propuesta (del agente):** Dedupe por tag o titulos distintos. (esfuerzo S)
- **Verificación cruzada:** Verificado

### H80 — 'Conciliado' con tres fuentes y significados

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A7 Flujos y fuentes de verdad
- **Evidencia:** 129 movimientos conciliados sin línea de banco; 134 líneas sin vínculo inverso (A7)
- **Síntoma:** No se puede saber con una consulta qué pagos pasaron por el banco.
- **Causa raíz:** Dos columnas de vínculo inversas y flag ambiguo
- **Consecuencia:** Reportes de conciliación poco confiables; base para errores como H1.
- **Solución propuesta (del agente):** Definir match_movimiento_id como fuente única, escribir ambos lados en las RPC y tratar conciliado como derivado o 'confirmado sin banco'. (esfuerzo M)
- **Verificación cruzada:** Aceptado por ejecución del agente; base de H15

### H83 — Migraciones sin registro desde 08/10, 49 sin rollback y trigger de 20261007113000 ausente

- **Severidad:** BAJO · **Tipo:** Mejora / deuda · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** confirmado
- **Detectado por:** A6 Base y seguridad, A8 Arquitectura y QA
- **Evidencia:** schema_migrations 132 filas, máx 20261008120000; 176 archivos vs 127 rollback; pg_trigger sin bloquear_mismo_registro_factura_en_op
- **Causa raíz:** Migraciones corridas a mano en el SQL Editor sin registro
- **Verificación cruzada:** Verificado (49, no 50)

