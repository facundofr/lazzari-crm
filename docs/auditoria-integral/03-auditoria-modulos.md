# 03 — Auditoría por módulo

Resumen de confiabilidad de cada módulo encontrado en el código (30 con confiabilidad alta, 46 media y 10 baja). El análisis completo de los **15 puntos** de cada módulo (qué hace, qué recibe y de dónde, qué modifica, quién depende de él, qué pasa si falla, pruebas, problemas y riesgos) está en las notas de cada agente, enlazadas abajo, para no duplicar más de 300 KB de texto.

**Confiabilidad:** *alta* = lo revisado se sostiene; *media* = funciona, pero con problemas o riesgos concretos; *baja* = hay errores que hoy dan resultados incorrectos o procesos que pueden quedar a medias.

## A1 Comercial — [notas completas](trabajo/agente-1-comercial.md)

| Módulo | Confiabilidad | Por qué |
|---|---|---|
| Presupuestos (lista, crear/editar, estados, OC) | **media** | Alta/edición atómicas por RPC, pero la edición borra y recrea renglones (corta vínculos con OC/remitos) y la cadena PR→OC es de varios pasos en el navegador |
| Armar presupuesto con IA | **alta** | Crea por RPC atómica y avisa sin frenar; solo pierde datos IA si luego se edita el PR |
| Ventas (bandeja) | **media** | Usa la regla única de saldo, pero asume una sola factura por PR, ignora restos y 'No facturar' no toca OC |
| Clientes | **media** | Lista con saldo real; pestaña Cta. Cte. y Consumo con reglas viejas y erróneas |
| Ficha 360 | **alta** | Solo lectura, paginada, saldo con lib/saldo-clientes y B7; solo incluye PR eliminados en KPIs |
| Oportunidades | **media** | Paginado y solo sugiere; no excluye PR eliminados y no tiene test propio |
| Muestras | **media** | Alta con compensación; 'Se la quedó' no se vincula a facturación; sin uso todavía |
| Personalización | **media** | Edición borra renglones antes de reinsertar y liquidación multi-paso con compensación manual; sin uso todavía |
| Pendientes | **alta** | Consultas por usuario y sociedad, conteos con head:true, errores chequeados |
| Calendario | **alta** | Simple, filtrado por sociedad, poco volumen |
| Dashboard | **media** | Facturado y pendiente de cobro bien; tasa de conversión mal calculada y alertas del trigger sin sociedad no se ven |
| Cron vencimiento de PR | **media** | Funciona, pero no excluye eliminados y la alerta de 5 días nunca se crea por la deduplicación |
| BCRA en clientes | **alta** | Paginado, un informe por mes, alerta con sociedad, nunca bloquea |

Hallazgos consolidados que tocan esta área: H06 (alto), H07 (medio), H08 (alto), H09 (alto), H16 (alto), H28 (medio), H39 (medio), H40 (bajo), H41 (medio), H42 (medio), H43 (medio), H44 (medio), H45 (medio), H46 (bajo), H57 (bajo), H58 (medio), H59 (bajo), H70 (bajo), H90 (bajo).

## A2 Compras — [notas completas](trabajo/agente-2-compras.md)

| Módulo | Confiabilidad | Por qué |
|---|---|---|
| Lista de OC y estados (compras-lista-oc + lib/oc-lista) | **media** | Lectura paginada y por sociedad bien hecha, pero estadoOC confía primero en ordenes_compra.estado, que se desincroniza (5 OC hoy). |
| Llegó / recepción (compras-lazza-llego, compras-recepcion, Compras nueva) | **media** | Lógica pura probada y rollback manual; escritura absoluta sin concurrencia y estado escrito por cliente y trigger. |
| Cargar factura Compras Lazza | **alta** | Pasa por guardar_conciliacion_compra (atómico, duplicado con advisory lock, permisos); NC con request_key. |
| Editar/anular OC Compras Lazza + mover renglones (oc-sin-proveedor) | **baja** | 6 pasos desde el navegador sin transacción, DELETE físico con cascada a asignaciones, no recalcula estado al mover renglones. |
| Nueva OC a mano | **alta** | Compensa cancelando la OC si fallan los renglones; lógica simple y probada. |
| Saldo de factura de compra / CC proveedores | **media** | Cinco implementaciones de la regla; difieren en 'pagada sin pago' y en la RPC de tarjeta (NC doble). |
| Ejes factura/pago de OC y cerrar saldo | **media** | Correcto en la base para el circuito viejo, pero sin alimentar desde el 19/10; cliente calcula pago distinto. |
| Carga masiva / conciliación / cargar-factura-oc (circuito viejo) | **media** | Conciliación por RPC atómico, pero cargar-factura-oc tiene un camino de inserts sueltos sin control de duplicado; sigue vivo desde pantallas ocultas. |
| Proveedores | **media** | CUIT sin normalizar burla el índice único: 2 pares duplicados en Lazzari. |
| Lista de costos / Importaciones | **alta** | Solo lectura; Importaciones es un cartel vacío. |
| Compras vieja (ordenes-compra, oculta) | **baja** | Borra OC físicamente, suma stock de más en recepción, increment_stock sin control de rol/sociedad. |

Hallazgos consolidados que tocan esta área: H03 (alto), H05 (alto), H10 (medio), H11 (medio), H17 (medio), H18 (medio), H19 (medio), H20 (medio), H23 (medio), H24 (medio), H47 (bajo), H48 (bajo), H50 (medio), H51 (medio), H61 (medio), H90 (bajo).

## A3 Finanzas — [notas completas](trabajo/agente-3-finanzas.md)

| Módulo | Confiabilidad | Por qué |
|---|---|---|
| Saldos de facturas y cuentas corrientes (lib/saldo-*, finanzas-lazza.ts, fc_compra_pagado, lz_cobrado_factura) | **media** | Ventas: una sola regla, TS y base equivalentes, verificada contra datos (alta). Compras: la misma regla está escrita en 7 lugares y 3 de la base ignoran total_acreditado (media). |
| Finanzas Lazza: Facturas, Vencimientos, Cuentas corrientes, Inicio | **alta** | Usan las mismas funciones que la CC, consultas paginadas con orden estable y filtradas por sociedad_id; tests OK. |
| Cobrar / cobro masivo / saldo a favor del cliente / recibos | **alta** | RPC atómicas e idempotentes con candado por cliente; el único punto débil es que el saldo a favor y el cobro van en dos transacciones (con aviso). |
| Pagar / Orden de pago (orden-pago-nueva + RPC seguro/con_nc/usd, anular) | **alta** | La saga contable es una sola transacción con request_key, y la anulación es completa. Restan las reglas de saldo y de retención duplicadas y la anotación de la retención hecha fuera de la transacción. |
| Plan de pagos | **media** | Idempotente por renglón, pero usa la retención calculada al armar el plan y no anota la retención congelada (mejora H). |
| Retenciones Ganancias, SICORE y certificados | **media** | Lo registrado está bien (47 OP anotadas, sin doble conteo). Pero la fórmula está duplicada entre OP y Plan, y los pagos futuros del Plan quedan sin congelar. |
| Saldo a favor de proveedores | **alta** | RPC todo o nada que usa fc_compra_pagado y el mismo candado que los pagos. |
| Cheques (cartera, banco, reportes eCheq) | **alta** | Solo el banco cambia los estados; los updates desde Excel tienen guarda por estado y se pueden reaplicar. Datos sin inconsistencias. |
| Bancos / saldo-cuentas / movimientos manuales | **media** | El cálculo es puro y está testeado, pero depende de que cada gasto tenga su movimiento (hoy hay 4 sin movimiento). |
| Extracto BBVA y conciliación | **alta** | aplicar_cruces_extracto deshace lo anterior, valida el cruce 1 a 1 y no pisa (solo_pendiente). |
| Gastos | **baja** | Gasto y movimiento se guardan en dos inserts separados. Al borrar se hace DELETE físico aunque falle la anulación del pago. Los datos muestran 4 gastos sin pago. |
| IVA, Reportes, Facturar | **media** | Revisado solo por encima: consultas paginadas y por sociedad, tests de ivaDelMes y reporteBasico OK. |
| Finanzas vieja (/finanzas-vieja) | **media** | Lee los saldos con las mismas libs, pero sigue escribiendo con lógica propia (handlePagarOP sin transacción). |

Hallazgos consolidados que tocan esta área: H15 (alto), H17 (medio), H19 (medio), H20 (medio), H21 (bajo), H25 (medio), H26 (bajo), H27 (medio), H30 (bajo), H61 (medio), H90 (bajo).

## A4 Facturación y logística — [notas completas](trabajo/agente-4-facturacion-logistica.md)

| Módulo | Confiabilidad | Por qué |
|---|---|---|
| Emisión ARCA (POST /api/facturacion) | **media** | El anti-duplicado es excelente: clave durable, lock por PV, un solo intento a WSFE, número tomado de ARCA; hoy hay 0 duplicados y 0 intentos trabados. Pero el total guardado difiere del autorizado en 20/120 comprobantes, y la recuperación de 'ARCA autorizó, falló la base' solo existe para NC. |
| Notas de crédito de venta | **alta** | La RPC es atómica, idempotente y se puede reanudar después del CAE. Pero 'cuánto se cobró' se calcula distinto que en TypeScript (H5), y quedan un crédito fantasma de 0,01 y una NC externa multi-factura atada a una sola factura. |
| Facturación masiva | **baja** | Elige FA/FB con otra regla que el modal (monotributistas). Marca el PR facturado aun con reconciliación pendiente. El propio código dice 'pendiente de verificar en producción'. |
| Comprobante X / manual | **media** | No tiene idempotencia en el servidor. Los renglones fallidos se ignoran. El índice único sin sociedad_id choca los X entre sociedades. La API acepta NC manuales sin factura origen. |
| Anular/revertir/eliminar factura | **media** | La RPC de eliminar está bien protegida. Anular y revertir son updates sueltos, y la regla 'sin CAE' está solo en la UI (la RLS no la exige). |
| Remitos | **media** | Crear y anular están bien compensados, y editar inserta antes de borrar. Dividir borra los renglones sin chequear errores, y la lista no pagina. |
| Stock | **baja** | No hay kardex. increment_stock recorta a 0 en silencio y no valida la sociedad. El borrado es físico y los remitos no descuentan. Hoy productos tiene 0 filas: el módulo no se usa. |
| Transportes | **media** | Tiene buena compensación y el costo queda bloqueado si ya se liquidó. La factura de compra se crea con tipo 'mercaderia' en vez de 'transporte'. |
| Papelera | **alta** | Solo recupera presupuestos con borrado lógico, filtrando por sociedad. |
| Consulta de facturas | **alta** | Es solo lectura, pagina con traerTodo y filtra por sociedad. Muestra el total local (afectado por H1). |

Hallazgos consolidados que tocan esta área: H03 (alto), H05 (alto), H12 (medio), H13 (alto), H14 (medio), H28 (medio), H31 (medio), H32 (medio), H33 (bajo), H47 (bajo), H58 (medio), H64 (bajo), H90 (bajo).

## A5 Integraciones e IA — [notas completas](trabajo/agente-5-integraciones.md)

| Módulo | Confiabilidad | Por qué |
|---|---|---|
| Crons y autenticacion de rutas | **media** | Funciona hoy (CRON_SECRET configurado), pero agente-mail, bcra y presupuestos-vencimiento fallan abiertos si falta la variable; solo cotizacion falla cerrado. |
| Cotizacion dolar BNA | **media** | Logica de fuentes cuidadosa y cron estable, pero cotizaciones_dolar acepta INSERT/UPDATE del rol anon y hay dos reglas distintas para la cotizacion de factura. |
| Cron presupuestos-vencimiento | **alta** | Estado vencido correcto e idempotente; el aviso de 5 dias nunca se crea por dedupe de titulo. |
| BCRA | **alta** | Incremental, paginado, no pisa informe bueno con error, solo avisa. Duplica alertas en refrescos manuales del mismo mes. |
| Agente de mail (Gmail+IA) | **media** | Solo sugiere, tope diario e idempotente por gmail_message_id, pero calcula saldo de factura con formula propia; hoy apagado. |
| IA de lectura de documentos (parse-*, leer-*) | **media** | No guardan solos, pero validacion del JSON minima, truncado manejado solo en listas (y la pantalla lo ignora), parse-cobro y parse-lista-precios sin modelo de respaldo. |
| IA de sugerencia (conciliar-compra, clasificar-lineas, ai-presupuesto, etc.) | **media** | Conciliacion y clasificacion validan bien; ai-presupuesto lee el catalogo sin sesion y nunca ve precios. |
| Asistentes y control de gasto IA | **alta** | Modo Hacer revalida, deshace y tiene campos acotados; el control de gasto usa tres tablas de precios a mano y solo topea la Ayuda. |
| Email Resend | **media** | Remitente y URLs de adjuntos los decide el navegador; adjuntos que fallan se omiten sin aviso; envio y registro no atomicos. |
| CUIT lookup (padron ARCA) | **media** | Nunca bloquea, pero baja SECLEVEL TLS a nivel proceso y devuelve debug al navegador. |
| Storage | **baja** | 5 buckets publicos, facturas-compra con INSERT/UPDATE/SELECT para rol public y comprobantes listables por anon, sin limites de tamano/tipo. |
| Lectura local sin IA (QR/texto, preparar-foto) | **alta** | No toca base ni red, cae a IA si no encuentra lo minimo. |

Hallazgos consolidados que tocan esta área: H01 (alto), H04 (alto), H28 (medio), H35 (bajo), H36 (bajo), H37 (bajo), H38 (bajo), H58 (medio), H70 (bajo), H90 (bajo).

## A6 Base y seguridad — [notas completas](trabajo/agente-6-base-y-seguridad.md)

| Módulo | Confiabilidad | Por qué |
|---|---|---|
| Autenticación y sesión (middleware, auth-context, lib/supabase) | **media** | Login exigido en servidor para páginas y /api; pero el aislamiento por sociedad vive en el front y la regla 'sin filas en user_sociedades' es opuesta entre front (todas) y base (ninguna). |
| Gestión de usuarios (api/users, api/invite, triggers profiles) | **alta** | Chequeo super_admin en servidor, service role solo después, bajas sin borrar, triggers lz_proteger_profiles/user_sociedades impiden escalar rol. |
| RLS y aislamiento por sociedad | **media** | RLS activa en 113 tablas y bien en tablas nuevas; tablas viejas de plata con políticas true y sin filtro sociedad_id. |
| Funciones SECURITY DEFINER / RPC | **media** | RPC de plata nuevas atómicas, idempotentes y con rol+sociedad; funciones viejas (kpis, balance, increment_stock, check_*) ejecutables por anon sin chequeo. |
| Vistas | **baja** | 7 de 8 sin security_invoker; anon lee v_facturas_pendientes y v_presupuestos_completos (confirmado). |
| Storage | **baja** | 5 buckets públicos; anon lista 99 comprobantes y 153 facturas de compra; insert/update de facturas-compra abierto al rol public. |
| Rutas API (autorización) | **media** | Facturación, SICORE, users, invite, agente-mail verifican rol en servidor; email/send sin rol con remitente libre y fetch de URLs arbitrarias; cotizacion-bna pública escribe con clave anónima; 3 crons fallan abiertos sin CRON_SECRET. |
| Integridad (constraints, triggers, FKs, saldos) | **media** | Validador de aplicación a FC existe, pero total/estado de facturas_compra editables sin control; cascadas de borrado sin auditoría; saldos denormalizados con reglas viejas. |
| Migraciones y rollback | **media** | Desde 08/10 no se registran; 50 migraciones sin rollback; un trigger de migración no existe en la base. |

Hallazgos consolidados que tocan esta área: H01 (alto), H02 (alto), H03 (alto), H04 (alto), H05 (alto), H17 (medio), H19 (medio), H20 (medio), H22 (medio), H23 (medio), H30 (bajo), H36 (bajo), H38 (bajo), H53 (medio), H62 (bajo), H83 (bajo).

## A7 Flujos y fuentes de verdad — [notas completas](trabajo/agente-7-flujos-y-fuentes-de-verdad.md)

| Módulo | Confiabilidad | Por qué |
|---|---|---|
| Presupuesto y renglones (PR) | **media** | RPC atómico y totales por trigger, pero actualizar_presupuesto_atomico borra y recrea los renglones (IDs nuevos) y no guarda columnas nuevas (descuento, precio_lista, catalogo_id). |
| Facturación de venta (ARCA) | **alta** | Emisión idempotente con bloqueo de reemisión; único defecto: el trigger recalcular_factura reescribe neto/IVA después de ARCA con otro redondeo (centavos). |
| Cobros, recibos y retenciones sufridas | **alta** | Toda la plata pasa por RPC atómicas con una sola regla (lz_cobrado_factura); estados = recomputación en 120 facturas. Falla la anulación respecto del extracto bancario. |
| Notas de crédito de venta y anulaciones | **media** | NC con su propia fórmula de cobrado; saldo a favor de NC no consumible; anular/revertir factura sin CAE por update directo sin recalcular. |
| Cuenta corriente clientes (lib/saldo-clientes) | **alta** | Implementación única, paginada, por sociedad y probada; pero convive con la columna legacy saldo_cuenta_corriente que sigue escribiéndose y que Presupuestos usa para el límite de crédito. |
| Remitos / entrega | **media** | Dependen del ID del renglón del PR; tras editar el PR quedan huérfanos y se usa heurística por descripción. |
| OC proveedor, recepción y estados | **alta** | Estados de facturación y pago coinciden con la recomputación; regla duplicada en trigger y en guardar_conciliacion_compra. |
| Facturas de compra y conciliación | **alta** | RPC atómicas; 3 FC C de Grupo LA en 'pagada' sin pago tratadas distinto por SQL y TS. |
| Órdenes de pago, retención Ganancias y saldo a favor proveedor | **alta** | Idempotente, con lock por proveedor y cartera en la misma transacción; retención OP = movimiento en 90/90. La regla de saldo del RPC ignora total_acreditado. |
| Cheques (echeqs) | **alta** | Estados por banco, un movimiento por cheque; el rechazo anula el cobro vía gestionar_cobro y hereda el problema del extracto. |
| Conciliación bancaria (extractos) | **media** | Dos vínculos inversos y flag conciliado con tres significados; anular movimientos no libera la línea del banco (4 casos reales). |
| Cuenta corriente proveedores | **alta** | Paginada y probada; dos funciones TS con el mismo nombre saldoFacturaCompra y distinta regla. |

Hallazgos consolidados que tocan esta área: H06 (alto), H07 (medio), H12 (medio), H15 (alto), H17 (medio), H19 (medio), H28 (medio), H29 (medio), H30 (bajo), H31 (medio), H80 (bajo), H90 (bajo).

## A8 Arquitectura y QA — [notas completas](trabajo/agente-8-arquitectura-y-qa.md)

| Módulo | Confiabilidad | Por qué |
|---|---|---|
| Organización de carpetas y pantallas viejas/nuevas | **media** | Hay 3 pantallas de Compras y 2 de Finanzas vivas en producción, que escriben las mismas tablas con reglas distintas. Archivos gigantes: finanzas-vieja tiene 6.615 líneas y presupuestos-lista 4.870. Lo que está oculto en el menú igual se abre por URL. |
| Capa de datos y tipos (cliente Supabase, database.types, as any) | **baja** | Los tipos son del 08/10 y tienen 34 tablas, contra 61 o más que faltan. Hay 550 'supabase as any' en 109 archivos. tsc da 0 errores, pero eso no protege las consultas. |
| Lógica de negocio en lib vs componentes | **media** | lib está bien armado y con tests, pero las pantallas de pago (OP nueva, Plan de pagos) tienen sus propias copias del saldo y de la retención. |
| Suite de pruebas scripts/test-* | **baja** | Fallan 13 de los 23 tests de test:regressions y 1 de los 11 de test:fce. Ningún test corre en el build ni en CI. Los tests puros de lib sí pasan. |
| Controles de publicación (tsc, check-hooks, build) | **media** | Dan 0 errores y frenan el deploy, pero no incluyen ninguna prueba de comportamiento. |
| Migraciones y rollback | **media** | Desde el 10/10 todas las migraciones tienen rollback. Hay 50 viejas sin rollback. Quedan respaldos que hacen la operación sin transacción cuando falta la RPC. |

Hallazgos consolidados que tocan esta área: H16 (alto), H17 (medio), H19 (medio), H26 (bajo), H47 (bajo), H48 (bajo), H49 (medio), H61 (medio), H83 (bajo), H90 (bajo).

