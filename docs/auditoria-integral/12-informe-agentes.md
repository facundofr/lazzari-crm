# 12 — Informe de agentes

La auditoría se hizo con **9 agentes**: 8 por área, en paralelo, y 1 revisor cruzado. Todos trabajaron en **solo lectura**: sin cambios de código, consultas a la base solo con SELECT dentro de transacciones de solo lectura, sin llamar a ARCA, BCRA, Resend, Anthropic ni a otros servicios externos, y sin levantar el servidor.
Total: 103 hallazgos crudos → 62 consolidados (51 confirmados, 11 probables). Los números que faltan en la serie H01…H90 son hallazgos que se fusionaron con otros.

## A1 Comercial

- **Notas completas (15 puntos por módulo):** [trabajo/agente-1-comercial.md](trabajo/agente-1-comercial.md)
- **Hallazgos crudos:** 18 (alto 3, medio 8, bajo 7)
- **Módulos revisados:** Presupuestos (lista, crear/editar, estados, OC); Armar presupuesto con IA; Ventas (bandeja); Clientes; Ficha 360; Oportunidades; Muestras; Personalización; Pendientes; Calendario; Dashboard; Cron vencimiento de PR; BCRA en clientes
- **Lo que encontró bien hecho:**
  - Alta y edición de PR por RPC atómicas con validación en base y filtro por sociedad con for update
  - Totales del PR recalculados por triggers desde los renglones (una sola fuente)
  - lib/saldo-clientes.ts: regla única de saldo, paginada y con test; la usan la lista de clientes, la Ficha 360 y Ventas
  - lib/ventas-documentos.ts (regla B7) y el nuevo get_dashboard_kpis con pendiente de cobro por saldo real y monedas separadas
  - Ficha 360 y Oportunidades paginan con traerTodo y lotes de 150 ids
  - BCRA y avisos de margen siempre avisan y nunca bloquean (regla 1 de Augusto)
  - Borrado de PR lógico; el permanente va por RPC que rechaza si hay facturas, remitos u OC
  - Lista de PR protegida contra respuestas tardías de otra sociedad (fetchPRSeq)
  - Tests puros de las libs comerciales: 11 corridos, todos OK
- **No cubierto:**
  - presupuestos-lista.tsx completo (4870 líneas): no se revisaron en detalle PDF, envío por mail, panel de OC del cliente ni el asistente-pr
  - Ruta /api/ai y /api/presupuestos/seguimiento-mensaje (IA, no se llamaron)
  - cotizacion-express y catalogo-picker más allá de sus escrituras
  - RLS de las tablas comerciales (permisos por rol/vendedor)
  - Facturación y remitos del lado de sus propias pantallas (cómo devuelven el PR a otro estado al anular)
  - Campana/header de alertas: cómo filtra alertas sin sociedad_id
  - Alta/edición de clientes en detalle (validaciones de CUIT, duplicados entre sociedades)
  - Comportamiento real en el navegador (no se levantó el servidor dev)

## A2 Compras

- **Notas completas (15 puntos por módulo):** [trabajo/agente-2-compras.md](trabajo/agente-2-compras.md)
- **Hallazgos crudos:** 12 (alto 3, medio 5, bajo 4)
- **Módulos revisados:** Lista de OC y estados (compras-lista-oc + lib/oc-lista); Llegó / recepción (compras-lazza-llego, compras-recepcion, Compras nueva); Cargar factura Compras Lazza; Editar/anular OC Compras Lazza + mover renglones (oc-sin-proveedor); Nueva OC a mano; Saldo de factura de compra / CC proveedores; Ejes factura/pago de OC y cerrar saldo; Carga masiva / conciliación / cargar-factura-oc (circuito viejo); Proveedores; Lista de costos / Importaciones; Compras vieja (ordenes-compra, oculta)
- **Lo que encontró bien hecho:**
  - guardar_conciliacion_compra: valida rol, sociedad y proveedor; duplicado por número normalizado + tipo con pg_advisory_xact_lock; aviso de facturado de más que no traba; todo en una transacción.
  - anular_factura_compra: no borra, guarda archivo de la anulación, avisa pagos y NC y recalcula OC.
  - validar_saldo_aplicacion_factura_compra: trigger con FOR UPDATE que impide aplicar más que el total de la factura.
  - NC de compra por registrar_nota_credito_compra_v2 con request_key idempotente e índice único.
  - cerrar_saldo_oc con permisos y aviso automático al vendedor del PR.
  - Lógica pura separada y probada (compras-lazza, compras-recepcion, oc-lista, saldo-proveedores, lista-costos): 8 suites corridas, todas OK.
  - Listados grandes con traerTodo y filtro por sociedad_id (lista de OC, saldos de proveedores, vencimientos).
  - Llegó deshace lo ya escrito si un renglón falla; Nueva OC cancela (no borra) si fallan los renglones.
  - APIs de compras protegidas por el middleware (sesión obligatoria).
- **No cubierto:**
  - Lectura completa de ordenes-compra/page.tsx (4031 líneas), cargar-factura-oc.tsx y conciliacion-compras.tsx: solo grep de escrituras y rangos del guardado.
  - Tests de matching (test-purchase-matching*.cjs, test-factura-vs-oc*.ts, test-cargar-factura.ts) no corridos.
  - RPC ajustar_oc_a_factura, deshacer_ajuste_oc, diagnostico_diferencia_oc, registrar_factura_compra_con_oc_extra, registrar_nota_credito_compra_v2 y aplicar_saldo_favor_proveedor no leídas en detalle.
  - Rutas IA de compras (parse-factura-compra, compras/*, conciliar-compra) no probadas; solo se verificó la exigencia de sesión.
  - Creación automática de OC al aprobar un PR (pertenece a Presupuestos).
  - Envío de OC por mail (enviar-oc-proveedor, oc-envio).

## A3 Finanzas

- **Notas completas (15 puntos por módulo):** [trabajo/agente-3-finanzas.md](trabajo/agente-3-finanzas.md)
- **Hallazgos crudos:** 10 (medio 5, bajo 5)
- **Módulos revisados:** Saldos de facturas y cuentas corrientes (lib/saldo-*, finanzas-lazza.ts, fc_compra_pagado, lz_cobrado_factura); Finanzas Lazza: Facturas, Vencimientos, Cuentas corrientes, Inicio; Cobrar / cobro masivo / saldo a favor del cliente / recibos; Pagar / Orden de pago (orden-pago-nueva + RPC seguro/con_nc/usd, anular); Plan de pagos; Retenciones Ganancias, SICORE y certificados; Saldo a favor de proveedores; Cheques (cartera, banco, reportes eCheq); Bancos / saldo-cuentas / movimientos manuales; Extracto BBVA y conciliación; Gastos; IVA, Reportes, Facturar; Finanzas vieja (/finanzas-vieja)
- **Lo que encontró bien hecho:**
  - Saldo de factura de venta: una sola regla, equivalente en TS (cobradoPorFactura/saldoFacturaVenta) y en la base (lz_cobrado_factura), usada por todas las pantallas. Verificado contra datos reales sin contradicciones.
  - Las RPC de pagos y cobros son atómicas e idempotentes (request_key, pago_solicitudes), tienen candado por proveedor o cliente y validan la sociedad.
  - La anulación de OP revierte las NC (movimiento y total_acreditado), reabre el Plan de pagos con clave nueva y recalcula el estado con fc_compra_pagado. Anular un cobro anula el saldo a favor que generó (trigger).
  - Integridad verificada en la base: 0 OP anuladas con movimiento vivo, 0 OP vivas sin movimiento, 0 saldos a favor de OP anuladas, 0 aplicaciones mayores a su cobro y 0 cheques en cartera de cobros anulados.
  - Las lecturas de Finanzas Lazza están paginadas con traerTodo, con orden estable por id, y siempre filtran por sociedad_id.
  - Retención congelada (mejora H): las 47 OP con retención están anotadas.
  - La conciliación (aplicar_cruces_extracto) deshace el cruce anterior, valida que sea 1 a 1 y no pisa a otra persona (solo_pendiente).
  - La factura no aparece como Cobrada mientras el cheque no se acreditó en el banco.
  - Las 12 pruebas puras de finanzas corridas pasan.
- **No cubierto:**
  - IVA (ivaDelMes) y Reportes en detalle
  - Facturar (resto-facturar) en detalle
  - Importación del extracto BBVA (importar_extracto_bbva y el parser lib/extracto-bbva.ts de 760 líneas)
  - registrar_op_usd_en_pesos y liquidaciones FX en detalle
  - registrar_cobro_masivo_seguro y rechazar_cheque_recibido por dentro
  - RLS de las tablas financieras
  - Préstamos y tarjetas de Bancos
  - Pruebas no corridas: test-cobros-cheques-atomicos, test-op-*.mjs, test-cheques-*, test-gastos-lazza, test-saldo-favor-proveedor

## A4 Facturación y logística

- **Notas completas (15 puntos por módulo):** [trabajo/agente-4-facturacion-logistica.md](trabajo/agente-4-facturacion-logistica.md)
- **Hallazgos crudos:** 13 (alto 3, medio 5, bajo 5)
- **Módulos revisados:** Emisión ARCA (POST /api/facturacion); Notas de crédito de venta; Facturación masiva; Comprobante X / manual; Anular/revertir/eliminar factura; Remitos; Stock; Transportes; Papelera; Consulta de facturas
- **Lo que encontró bien hecho:**
  - Anti-duplicado fiscal sólido: clave durable por intención (localStorage + Web Locks entre pestañas), reserva en base antes de WSFE, lock por punto de venta y hash del payload. Hace un solo intento a FECAESolicitar y toma el número de ARCA (FECompUltimoAutorizado), no de la base. Datos: 0 duplicados y 0 intentos trabados.
  - assertSafeFiscalEnvironment impide que preview u homologación usen la base productiva. La ruta usa la sesión del usuario (RLS), nunca service_role.
  - Las NC de venta se registran con una RPC atómica, idempotente y reanudable después del CAE. Antes de una NC MiPyME se valida el tipo de origen y el estado de la FCE en el Registro.
  - La FCE verifica en ARCA la obligación y el monto mínimo, valida CBU y plazo, y no emite si no puede verificar.
  - delete_manual_invoice está bien protegida: sin CAE, anulada, sin movimientos, remitos ni NC.
  - Anular un remito no lo borra: cancela los viajes no liquidados y avisa por los liquidados. Editar un remito inserta los renglones nuevos antes de borrar los viejos. Crear un remito compensa si fallan los renglones.
  - En Transportes no se puede editar el costo si ya está liquidado, y la liquidación compensa si falla.
  - Consulta de facturas y Facturación paginan con traerTodo y filtran por sociedad. saldo-clientes.ts centraliza el saldo de clientes.
  - Los 9 tests puros del área pasan (ruta fiscal con mocks, NC, FCE, invoice-intent, remitos, transportes).
- **No cubierto:**
  - test-fiscal-emission-sql.cjs no se corrió: necesita PGlite externo.
  - No se verificó contra ARCA cuál de los dos totales es el real en cada comprobante (prohibido llamar ARCA). Se tomó el total enviado y guardado en fiscal_emission_attempts.
  - No se revisaron en detalle lib/arca-wsfecred-node.ts, invoice-exchange-rate.ts, factura-pdf/pdf-templates (salvo el QR) ni el envío de facturas por mail (Resend).
  - No se revisaron los cobros (registrar_cobro_seguro) ni las aplicaciones: son de otra área. Solo se miraron en lo que tocan a NC y saldo.
  - No se leyeron completos remitos-armado.ts ni remito-entrega.ts; se confiaron a sus tests, que pasan.
  - No se revisaron leer-foto de remitos (IA) ni el detalle de cai_config (vencimiento y rango del CAI).
  - Grupo LA: casi sin datos (1 FA, 1 remito), así que el comportamiento multi-sociedad está verificado solo por código.

## A5 Integraciones e IA

- **Notas completas (15 puntos por módulo):** [trabajo/agente-5-integraciones.md](trabajo/agente-5-integraciones.md)
- **Hallazgos crudos:** 13 (alto 2, medio 4, bajo 7)
- **Módulos revisados:** Crons y autenticacion de rutas; Cotizacion dolar BNA; Cron presupuestos-vencimiento; BCRA; Agente de mail (Gmail+IA); IA de lectura de documentos (parse-*, leer-*); IA de sugerencia (conciliar-compra, clasificar-lineas, ai-presupuesto, etc.); Asistentes y control de gasto IA; Email Resend; CUIT lookup (padron ARCA); Storage; Lectura local sin IA (QR/texto, preparar-foto)
- **Lo que encontró bien hecho:**
  - Ninguna ruta de IA guarda datos de negocio sola: todo vuelve a pantalla para revision humana.
  - Modo Hacer: campos acotados (CAMPOS_EDITABLES), revalidacion contra la base antes de guardar, historial ia_acciones y Deshacer que no pisa cambios posteriores (test-ia-acciones OK).
  - conciliar-compra: la IA solo decide equivalencias, validadas contra los grupos enviados (purchase-matching-ai.ts:47-68), con respaldo por similitud de palabras.
  - clasificar-lineas: filtra ids y clasificaciones contra listas cerradas antes de devolver.
  - BCRA: no pisa un informe bueno con un error, cron incremental con traerTodo y presupuesto de tiempo, indice unico por entidad y mes.
  - Cron de cotizacion: falla cerrado sin CRON_SECRET, no pisa manuales, no usa DolarAPI en feriados, guarda la fecha real publicada por el BNA.
  - Agente de mail: interruptor de encendido (hoy apagado), tope diario de gasto, idempotencia por gmail_message_id unico, Gmail solo lectura (test-agente-mail OK).
  - Lectura de facturas en el navegador por QR de ARCA o texto antes de usar IA (leer-factura-local.ts).
  - /api/remito falla cerrado sin pedir tickets WSAA ni emitir nada.
- **No cubierto:**
  - api/facturacion, api/sicore, api/invite, api/users (fuera del area o de otros agentes).
  - Detalle linea por linea de parse-vep, parse-certificado-retencion, parse-documento-impositivo, remitos/leer-foto, compras/leer-remito, finanzas/leer-resumen-tarjeta, compras/instruccion, compras/sugerir-proveedor, presupuestos/asistente, instruccion-precios, seguimiento-mensaje, cotizacion-express, normalizar-oc (solo revisados por grep: modelo, maxDuration, escrituras).
  - Pantallas que suben a Storage y si dejan archivos huerfanos cuando falla el guardado del registro.
  - Configuracion real de Vercel (plan, maxDuration efectivo, presencia de variables mas alla de inferir CRON_SECRET por el cron que escribe).
  - Pruebas test-bna-historical.cjs y test-invoice-exchange-rate.cjs no corridas porque usan red externa.
  - Comportamiento real de WSAA con multiples tickets en cuit-lookup por DNI (hipotesis, no se llamo a ARCA).
  - Precios vigentes de los modelos de Anthropic (no se verificaron; solo se senala que estan escritos a mano en 3 lugares).

## A6 Base y seguridad

- **Notas completas (15 puntos por módulo):** [trabajo/agente-6-base-y-seguridad.md](trabajo/agente-6-base-y-seguridad.md)
- **Hallazgos crudos:** 16 (critico 1, alto 4, medio 7, bajo 4)
- **Módulos revisados:** Autenticación y sesión (middleware, auth-context, lib/supabase); Gestión de usuarios (api/users, api/invite, triggers profiles); RLS y aislamiento por sociedad; Funciones SECURITY DEFINER / RPC; Vistas; Storage; Rutas API (autorización); Integridad (constraints, triggers, FKs, saldos); Migraciones y rollback
- **Lo que encontró bien hecho:**
  - RLS activado en las 113 tablas de public y event trigger rls_auto_enable para tablas nuevas.
  - profiles y user_sociedades protegidos por triggers: nadie puede subirse el rol ni agregarse sociedades.
  - api/users y api/invite verifican super_admin en el servidor; las bajas desactivan sin borrar.
  - RPC de plata nuevas atómicas, idempotentes (request_key con índice único), con rol+sociedad y search_path fijo; funciones internas con EXECUTE revocado.
  - Facturación ARCA: authorizeFacturaRequest (rol + membresía) y reserva fiscal única por punto de venta; test-facturacion-auth-date.cjs OK.
  - Estado de facturas de venta 100% coherente con lo cobrado (0 discrepancias).
  - anon no ve ninguna fila de facturas y no tiene CREATE en public.
  - Listados grandes paginados con traerTodo; solo activity_log y catalogo_costos superan 1000 filas.
  - test-saldo-factura-compra.ts OK: la regla de saldo de FC del front coincide con fc_compra_pagado.
- **No cubierto:**
  - No se probó ninguna escritura (anon ni usuario): H1, escrituras de H2 y subida de H8 son estáticos.
  - No se revisaron las 176 migraciones una por una (solo la de duplicados de FC).
  - No se auditó el cuerpo completo de las RPC grandes de pagos, cobros y NC más allá de sus permisos.
  - No se comparó en detalle el saldo de proveedores contra la regla de Finanzas Lazza (solo la columna vieja).
  - Rutas IA: solo autorización, no contenido de prompts/respuestas.
  - Políticas de tablas de catálogo/configuración menores no revisadas una por una.

## A7 Flujos y fuentes de verdad

- **Notas completas (15 puntos por módulo):** [trabajo/agente-7-flujos-y-fuentes-de-verdad.md](trabajo/agente-7-flujos-y-fuentes-de-verdad.md)
- **Hallazgos crudos:** 12 (alto 2, medio 7, bajo 3)
- **Módulos revisados:** Presupuesto y renglones (PR); Facturación de venta (ARCA); Cobros, recibos y retenciones sufridas; Notas de crédito de venta y anulaciones; Cuenta corriente clientes (lib/saldo-clientes); Remitos / entrega; OC proveedor, recepción y estados; Facturas de compra y conciliación; Órdenes de pago, retención Ganancias y saldo a favor proveedor; Cheques (echeqs); Conciliación bancaria (extractos); Cuenta corriente proveedores
- **Lo que encontró bien hecho:**
  - Cobros: toda la plata de clientes pasa por RPC atómicas con una sola regla (lz_cobrado_factura); registrar_cobro y registrar_cobro_masivo no están otorgadas a authenticated, solo los wrappers _seguro con permisos. Estados de 120 facturas de venta = recomputación (0 diferencias).
  - Pagos a proveedores: registrar_pago_proveedor_seguro es idempotente (request_key), serializa por proveedor (pg_advisory_xact_lock), bloquea las facturas, valida saldo por trigger y mete la cartera de cheques en la misma transacción.
  - Emisión ARCA: reserva idempotente y bloqueo de reemisión cuando ARCA autoriza y el guardado local falla (reconciliation_required).
  - Saldos de clientes y proveedores en TS: implementación única, paginada con traerTodo, filtrada por sociedad y con pruebas (test-saldo-clientes, test-saldo-proveedores, test-finanzas-lazza, test-saldo-favor-cliente: OK).
  - OC: estado_facturacion y estado_pago coinciden con la recomputación (11/11 por asignaciones, 187 OC no canceladas).
  - Retención de Ganancias: monto en la OP = movimiento de retención en las 90 OP vigentes; saldo a favor de OP cuadra (bruto = aplicado + saldo).
  - Las 17 RPC de plata revisadas usan auth.uid() y controlan la sociedad.
  - Pago de más en cobros: queda como ajuste crédito atado al cobro de origen (si se anula el cobro, se anula solo).
- **No cubierto:**
  - Cálculo de la base mensual de retención RG 830 (pagos anteriores del mes) y uso de monto_bruto después de aplicar saldo a favor: no verificado en profundidad (área de impuestos).
  - Stock y recepción física (por regla de memoria: no tocar stock sin aviso); solo se revisó auto_estado_oc.
  - Personalización (talleres, liquidaciones) más allá del vínculo con presupuesto_items (0 filas).
  - Liquidaciones FX (liquidar_documentos_fx, aplicaciones_fx) y OP en US$ pagadas en pesos: solo se constató que 15 movimientos tienen liquidacion_fx_id.
  - registrar_pago_proveedor_con_nc, registrar_op_usd_en_pesos, crear_nota_credito_manual_venta(_multiple), aplicar_cruces_extracto, conciliar_extracto_movimiento: no leídos completos.
  - Pantallas finanzas-vieja (490 KB) y compras-nueva: no revisadas en detalle.
  - Límite de 1000 filas fuera de los flujos de saldo (se verificó que link tables y saldos usan traerTodo o filtros por id).
  - Tests que tocan rutas, base o ARCA (fce, fiscal, cobros-cheques-atomicos, remitos): no corridos.
  - No se verificó en producción el comportamiento de la UI (sin servidor dev, por reglas de la auditoría).

## A8 Arquitectura y QA

- **Notas completas (15 puntos por módulo):** [trabajo/agente-8-arquitectura-y-qa.md](trabajo/agente-8-arquitectura-y-qa.md)
- **Hallazgos crudos:** 9 (alto 2, medio 4, bajo 3)
- **Módulos revisados:** Organización de carpetas y pantallas viejas/nuevas; Capa de datos y tipos (cliente Supabase, database.types, as any); Lógica de negocio en lib vs componentes; Suite de pruebas scripts/test-*; Controles de publicación (tsc, check-hooks, build); Migraciones y rollback
- **Lo que encontró bien hecho:**
  - npx tsc --noEmit da 0 errores (en 24 s) y check-hooks da 0 errores en 361 archivos; el build exige los dos.
  - 143 de 168 archivos de src/lib tienen al menos un test. Los 8 tests puros que se corrieron (saldos, finanzas-lazza, compras-lazza, op-parcial, retenciones) pasan.
  - Las operaciones de plata críticas ya están en RPC atómicas con request_key idempotente: cobros, OP, anulaciones, NC y guardar_conciliacion_compra.
  - traerTodo() para el límite de 1000 filas se usa en 45 archivos. Las consultas de proveedores revisadas filtran por sociedad_id.
  - Desde el 10/10/2026, cada migración tiene su rollback.
  - test:fce simula https y Supabase y nunca toca ARCA; 10 de sus 11 tests pasan.
  - lib/finanzas-destino.ts traduce los links viejos con una función pura y probada.
  - Los encabezados de los archivos tienen comentarios con fecha y motivo de las decisiones de Augusto.
- **No cubierto:**
  - RLS y permisos reales de las RPC.
  - Los aproximadamente 120 test-* que no se corrieron (se corrieron 42).
  - Rutas API de servidor y crons en detalle.
  - Revisión línea por línea de finanzas-vieja, presupuestos-lista (además modificado sin commitear por otro chat) y clientes.
  - Rendimiento en el navegador (no se levantó el servidor dev).

## Revisor cruzado

- **Notas completas:** [trabajo/revision-cruzada.md](trabajo/revision-cruzada.md)
- Consolidó duplicados, trató de refutar cada hallazgo alto y los medios estáticos abriendo el código y la base, y contrastó las conexiones entre módulos.

### Contradicciones entre agentes y cómo se resolvieron

- Total de facturas vs ARCA: A4 dice 20/120 totales distintos; A7 dice 'total igual en todos, difiere el IVA en 24/145'. Verificado: el total guardado difiere del ImpTotal enviado en 20/120. A7 queda refutado en el total; ambos coinciden en la causa (trigger recalcular_factura).
- Saldo de factura de venta: A3 afirma 'una sola regla'; A4/A7 (RPC de NC), A5 (agente-mail, asistente) y A1 (pestaña Cta. Cte., Consumo) muestran fórmulas distintas. El núcleo (saldo-clientes = lz_cobrado_factura) es único, pero 5 consumidores no lo usan.
- Estados de OC: A7 los da por confiables ('coinciden con la recomputación'); A2 encontró OC con estado de mercadería incorrecto (4 visibles). A7 solo comparó estado_facturacion/estado_pago.
- Saldo a favor del cliente: A3 califica Cobrar/saldo a favor como confiabilidad alta; A7 muestra dos definiciones y $59.500,24 de una NC que no se puede aplicar. A7 confirmado.
- Gastos sin pago: A3 los atribuye al alta en dos pasos; los datos muestran que 3 de 4 se crearon a propósito sin movimiento (migraciones de gastos fijos pedidas por Augusto). Solo 1 queda sin explicar.
- Severidad de la cotización escribible por anon: A6 crítico vs A5 alto → alto (la emisión ARCA re-verifica contra BNA en vivo).
- Severidad de crons fail-open: A5 medio vs A6 bajo → bajo. Severidad de email/send: A5 bajo vs A6 medio → bajo (remitente fijo en documentos administrativos).
- Prueba de saldo de FC: A6 la lista como 'bien hecho' (test-saldo-factura-compra coincide con fc_compra_pagado), pero A2/A8 muestran que esa función no la usa ninguna pantalla: la prueba protege código muerto.
- Severidad del saldo de FC duplicado: A8 alto vs A2/A3/A7 medio → medio (0 casos hoy).
- Facturación ARCA: A7 confiabilidad alta vs A4 media; A4 tiene razón por la falta de recuperación de facturas comunes y el total distinto.
- Paginación: A6/A8 dicen que los listados grandes usan traerTodo; A1/A4 encuentran consultas sin paginar en presupuestos, ventas, remitos y stock. Ambos ciertos en su alcance (Finanzas pagina, comercial/logística no).
- Límite de crédito con columna vieja: A3 bajo vs A6/A7 medio → bajo (ningún cliente tiene límite cargado).
- Detalles menores: A2 cita lib/oc-lista.ts:412-435 pero el archivo tiene 101 líneas (lógica en 39-42); A6/A8 cuentan 50 migraciones sin rollback, el conteo da 49 (176 vs 127).
