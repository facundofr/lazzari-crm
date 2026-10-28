# Auditoría integral — Agente 5: Integraciones externas e IA

Fecha: 28/10/2026. Auditoría de SOLO LECTURA (no se modificó código, no se llamó a ningún servicio externo, solo SELECT en la base con `scripts/lectura/sql.cjs`).

## Alcance revisado

**Configuración y entrada**
- `crm/app/vercel.json` (7 crons), `src/middleware.ts`, `src/lib/supabase/middleware.ts` (qué rutas son públicas).

**Crons**
- `src/app/api/cron/cotizacion/route.ts`, `cron/bcra/route.ts`, `cron/agente-mail/route.ts`, `cron/presupuestos-vencimiento/route.ts`.

**Cotización dólar**
- `src/app/api/cotizacion-bna/route.ts`, `src/lib/bna-historical.ts`, `src/lib/invoice-exchange-rate.ts` (lo usa también `api/facturacion/route.ts:428`).

**BCRA**
- `src/app/api/bcra/route.ts`, `api/bcra/preview/route.ts`, `src/lib/bcra-server.ts`, `src/lib/bcra.ts` (parcial).

**Agente de mail (Gmail)**
- `src/lib/agente-mail-server.ts`, `src/lib/agente-mail.ts`, `api/agente-mail/ejecutar/route.ts`.

**IA (Anthropic)**
- `api/ai/route.ts`, `api/ai/acciones/route.ts`, `src/lib/ia-acciones-server.ts`, `src/lib/ia-acciones.ts`, `src/lib/ia-tope.ts`, `src/lib/ia-uso.ts`, `src/components/uso-ia-config.tsx`.
- `api/parse-factura-compra`, `parse-cobro`, `parse-oc`, `parse-lista-precios` (y su uso en `app/(crm)/proveedores/page.tsx:552-680`), `parse-vep`, `parse-certificado-retencion`, `parse-documento-impositivo` (por grep), `leer-oc-cliente`, `normalizar-oc`, `cotizacion-express`, `ai-presupuesto` (y su uso en `components/presupuestos/presupuestos-lista.tsx:913-960`), `conciliar-compra` + `src/lib/purchase-matching-ai.ts`, `finanzas/clasificar-lineas` (y `components/finanzas-para-confirmar.tsx:280-340`), `finanzas/asistente` (parcial), `compras/*`, `presupuestos/*`, `remitos/leer-foto`, `finanzas/leer-resumen-tarjeta` (por grep: modelos, maxDuration, escrituras).

**Email / Resend**
- `api/email/send/route.ts`, `api/email/status/route.ts`, `api/email/config/route.ts`, `src/lib/email.ts`, `components/email-compose-modal.tsx:150-185`.

**CUIT**
- `api/cuit-lookup/route.ts` (padrón A5/A13 de ARCA; solo lectura del código, no se llamó).

**Storage**
- Buckets y políticas de `storage.objects` (consulta SELECT a `storage.buckets` y `pg_policies`).

**Lectura sin IA (navegador)**
- `src/lib/leer-factura-local.ts` (cabecera), `src/lib/preparar-foto.ts`.

**Tablas consultadas (solo SELECT)**: `cotizaciones_dolar`, `pg_policies` (cotizaciones_dolar, ia_uso, agente_mail_procesados, cliente_bcra_informes, alertas, lista_precios_items, listas_precios, clientes, storage.objects), `storage.buckets`, `pg_indexes`, `facturas`, `cobro_aplicaciones`, `movimientos`, `extracto_movimientos`, `configuracion`, `agente_mail_procesados`, `ia_uso`, `clientes`, `proveedores`, `cliente_bcra_informes`, `proveedor_bcra_informes`, `presupuestos`, `alertas`.

**Pruebas corridas (puras, leídas antes)**
- `npx.cmd tsx scripts/test-agente-mail.ts` → `OK agente-mail`.
- `npx.cmd tsx scripts/test-ia-acciones.ts` → `test-ia-acciones OK`.
- NO se corrieron `scripts/test-bna-historical.cjs` (hace `curl` al BNA, línea 21) ni `scripts/test-invoice-exchange-rate.cjs` (línea 44 usa `fetch` real): tocan red externa.

**Datos de contexto (producción, 28/10/2026)**
- `configuracion.agente_mail_activo`: no existe la fila → el agente de mail está APAGADO.
- `agente_mail_procesados`: 210 filas, 0 con error.
- `facturas` 2026 en estados emitida/parcial/vencida/pagada: 136 (total 154).
- `cotizaciones_dolar`: 104 filas, 0 manuales; el cron escribe todos los días hábiles (CRON_SECRET está configurado en Vercel, porque el cron de cotización exige la clave y escribe).
- BCRA del mes: 182/208 clientes y 808/832 proveedores con informe no gris.
- Presupuestos activos: 50. Alertas de presupuestos: 375.
- `ia_uso` del mes: 348 filas.
- Movimientos de cobro DIRECTOS (con `factura_id`, sin `cobro_aplicaciones`, no anulados): 24 (23 de facturas `pagada`, 1 `anulada`).

---

## Módulo 1 — Crons y autenticación de rutas

1. **Función**: correr tareas programadas (Vercel Cron) y proteger las rutas `/api/*`.
2. **Qué recibe**: GET de Vercel con `Authorization: Bearer <CRON_SECRET>`.
3. **De dónde**: `vercel.json` (cotización 14 y 21 UTC lun-vie; presupuestos-vencimiento 12 UTC diario; bcra 10:30 UTC diario; agente-mail 11:30, 15:30 y 19 UTC lun-vie).
4. **Operaciones**: el middleware marca `/api/cron/*` y `/api/cotizacion-bna` como públicas (`src/lib/supabase/middleware.ts:35,43-45`) → cada ruta valida su propio secreto.
5. **Qué modifica**: según cada cron (ver módulos 2-5).
6. **Dónde guarda**: `cotizaciones_dolar`, `alertas`, `presupuestos.estado`, `cliente_bcra_informes`, `proveedor_bcra_informes`, `agente_mail_*`, `notificaciones`, `ia_uso`.
7. **Quién depende**: Facturación (cotización), Presupuestos (estado vencido), campana de avisos, Mail y cobros.
8. **De qué depende**: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, servicios externos.
9. **Errores posibles**: secreto faltante; servicio externo caído; tiempo agotado (60 s).
10. **Si falla**: cada cron devuelve 500 y se ve en logs de Vercel; no hay reintento automático (el siguiente horario recupera, salvo presupuestos que es diario).
11. **Si otro módulo cambia sus datos**: no aplica.
12. **Pruebas**: no hay pruebas de autenticación de crons.
13. **Problemas reales**: comportamiento INCONSISTENTE ante `CRON_SECRET` vacío. `cron/cotizacion/route.ts:71` falla cerrado (`!cronSecret || ...` → 401). En cambio `cron/agente-mail/route.ts:16`, `cron/bcra/route.ts:20` y `cron/presupuestos-vencimiento/route.ts:119-125` fallan ABIERTOS (`if (cronSecret && ...)`): sin la variable, cualquiera en Internet puede dispararlos (la ruta es pública por middleware). Hoy la variable está puesta (el cron de cotización escribe todos los días), así que es riesgo latente.
14. **Riesgos**: si alguien borra/renombra `CRON_SECRET` en Vercel, 3 crons quedan abiertos: agente-mail gasta IA (tope US$ 1,5/día), presupuestos-vencimiento cambia estados de PR, BCRA consulta en masa. `presupuestos-vencimiento` además cae a la clave anónima si falta la service role (`:26-29`), y entonces no hace nada sin avisar (RLS devuelve 0 filas).
15. **Confiabilidad**: **media** — funciona hoy, pero la protección depende de una variable y tres de cuatro rutas no fallan cerradas.

## Módulo 2 — Cotización del dólar (BNA)

1. **Función**: guardar y servir la cotización BNA divisas/billetes; dar la cotización para facturas en USD.
2. **Recibe**: `modalidad`, `fecha`, `fecha_factura`, `force` (GET `/api/cotizacion-bna`); el cron no recibe nada.
3. **De dónde**: pantallas (13 usos de `/api/cotizacion-bna`), `facturacion-content.tsx:673`, `api/facturacion/route.ts:428` (`getInvoiceExchangeRate`).
4. **Operaciones**: scraping de `bna.com.ar/Cotizador/HistoricoPrincipales` (timeout 10 s), parser `parseBnaHistorical` (toma la fila con fecha ≤ objetivo), respaldo DolarAPI/Bluelytics solo billetes del día, upsert en `cotizaciones_dolar` (`onConflict fecha,tipo`).
5. **Modifica**: `cotizaciones_dolar`.
6. **Dónde guarda**: `cotizaciones_dolar` (fuente `BNA histórico v2` = verificada, `dolarapi`, `bluelytics`, `dolarapi_cron`; `es_manual`).
7. **Quién depende**: Facturación (tipo de cambio de facturas USD → plata y ARCA), Presupuestos (dólar del PR), Finanzas.
8. **Depende de**: BNA (HTML sin contrato), DolarAPI, Bluelytics, RLS de `cotizaciones_dolar`.
9. **Errores**: BNA cambia el HTML (parser por regex) → `null`; feriados; BNA devuelve fecha vecina.
10. **Si falla**: cron → 502/500; la API cae al último valor verificado (≤ 7 días en facturas) o pide carga manual (503). Bien resuelto.
11. **Si otro módulo cambia sus datos**: una fila `es_manual = true` tiene prioridad en el caché de `/api/cotizacion-bna` (`isTrustedBnaCache`) pero NO en `getInvoiceExchangeRate`, que va primero al BNA y solo usa la base si el BNA falla.
12. **Pruebas**: `scripts/test-bna-historical.cjs`, `scripts/test-invoice-exchange-rate.cjs` (no corridas: usan red).
13. **Problemas reales**:
    - **RLS abierta a anónimos** (consultado en `pg_policies`): `cotiz_insert_anon` (INSERT, with_check `true`) y `cotiz_update_anon` (UPDATE, `true`) para el rol `anon`. La clave anónima es pública (va en el JavaScript del navegador). Cualquiera puede insertar o pisar una cotización, incluso con `es_manual = true` y `fuente = 'BNA histórico v2'`, que el sistema trata como "confiable". La migración `20261012170000_cerrar_tablas_sin_login.sql:8` dejó esto a propósito porque "la carga automática del dólar la usa sin login", pero el cron ya escribe con la service role (`cron/cotizacion/route.ts:77`), así que la excepción ya no hace falta para el cron.
    - Paradoja de permisos: el usuario logueado NO tiene política UPDATE (solo `cotiz_insert`), así que el upsert de `/api/cotizacion-bna` hecho con sesión falla en silencio (`console.warn`, `:146`) cuando la fila ya existe; el anónimo sí puede.
    - Dos reglas para "qué cotización vale": `/api/cotizacion-bna` sin `fecha_factura` usa día hábil anterior y prioriza caché/manual; `getInvoiceExchangeRate` usa día calendario anterior y prioriza el BNA en vivo sobre una carga manual. Una cotización cargada a mano para corregir un error del BNA no se respeta al facturar mientras el BNA responda.
    - Respaldo DolarAPI en `/api/cotizacion-bna:196-206` hace upsert sin mirar `es_manual` ni si ya hay valor verificado (solo se llega ahí con `force=1` o sin caché confiable): puede pisar billetes del día.
14. **Riesgos**: manipulación del tipo de cambio de facturas USD desde Internet; dependencia de scraping HTML.
15. **Confiabilidad**: **media** — la lógica de fuentes es cuidadosa y el cron anda, pero la tabla está abierta a escritura anónima.

## Módulo 3 — Cron de vencimiento de presupuestos y avisos

1. **Función**: avisos de seguimiento de PR (3/5/7 días), marcar PR vencidos, avisos de cheques que cubre un tercero y recordatorios de Finanzas > Revisar.
2. **Recibe**: nada (GET del cron).
3. **De dónde**: Vercel 12 UTC diario.
4. **Operaciones**: lee `presupuestos` activos, `alertas` existentes, `echeqs`, `finanzas_revisar`; inserta `alertas`; `update presupuestos set estado='vencido'`.
5. **Modifica**: `presupuestos.estado`, `alertas`.
6. **Dónde**: idem.
7. **Quién depende**: Presupuestos (lista y filtros por estado), campana.
8. **Depende de**: service role (si falta, cae a anon y no hace nada).
9. **Errores**: inserción de alertas falla → igual marca vencidos (no es grave).
10. **Si falla**: 500; al día siguiente reintenta (idempotente por dedupe de alertas y por filtro de estado).
11. **Si otro módulo cambia sus datos**: si alguien cambia `vencimiento` de un PR ya `vencido`, el cron no lo revive (solo mira activos).
12. **Pruebas**: ninguna.
13. **Problemas reales**: el aviso de 5 días nunca se crea: `SEGUIMIENTO_DIAS` usa el mismo `title` "Seguimiento PR" para 3d y 5d (`:34-35`) y el dedupe es `title|entity_id` (`:196`), así que después del de 3 días el de 5 queda como duplicado. Bajo impacto (es un aviso).
    - Consulta de presupuestos y alertas sin paginar (`:149-152`, `:166-170`): hoy 50 PR activos y 375 alertas; si las alertas de esos PR superan 1000 filas, el dedupe falla y se duplican avisos.
14. **Riesgos**: `today` en UTC (`:129`) y vencimiento `T23:59:59` en hora del servidor (UTC): corriendo a las 12 UTC no hay desfase práctico.
15. **Confiabilidad**: **alta** para el estado vencido; **media** para los avisos.

## Módulo 4 — BCRA (Central de Deudores)

1. **Función**: informe mensual por cliente/proveedor con semáforo y aviso si empeora.
2. **Recibe**: `{ sociedad_id, cliente_id | proveedor_id }` (POST `/api/bcra`), `cuit` (GET preview).
3. **De dónde**: ficha del cliente/proveedor, cron diario.
4. **Operaciones**: 3 llamadas a `api.bcra.gob.ar` (deudas, históricas opcional, cheques) con timeout 12 s; si falla el certificado reintenta con `rejectUnauthorized: false` solo contra ese host (`bcra-server.ts:13-45`); upsert `onConflict (cliente_id|proveedor_id, mes)`; alerta si empeoró.
5. **Modifica**: `cliente_bcra_informes`, `proveedor_bcra_informes`, `alertas`.
6. **Dónde**: idem (índices únicos por entidad+mes confirmados).
7. **Quién depende**: Presupuestos y Facturación (aviso, nunca bloquea), ficha 360.
8. **Depende de**: API pública del BCRA.
9. **Errores**: BCRA caído → semáforo gris; no pisa un informe bueno del mes con un error (`:105-109`). Bien.
10. **Si falla**: el cron reintenta los grises al día siguiente; presupuesto de 50 s con 3 en paralelo; sigue donde quedó. Idempotente.
11. **Si otro módulo cambia sus datos**: cambiar el CUIT de un cliente en el mes no fuerza nueva consulta (el informe del mes ya está "listo").
12. **Pruebas**: no encontré test de `bcra.ts`.
13. **Problemas reales**: cada "Actualizar" manual en el mismo mes, si el resultado es peor que el mes anterior, inserta OTRA alerta (no hay dedupe en `bcra-server.ts:114-127`). Hoy hay 0 alertas BCRA. Menor.
14. **Riesgos**: el reintento sin validar certificado permite que un intermediario falsee el semáforo (datos públicos, solo aviso). Aceptable y documentado.
15. **Confiabilidad**: **alta**.

## Módulo 5 — Agente de mail y cobros (Gmail + IA)

1. **Función**: leer la casilla administracion@ (Gmail API, solo lectura), clasificar con Haiku 4.5, extraer datos de pagos y cruzarlos con facturas abiertas y entradas del banco. Solo sugiere.
2. **Recibe**: nada (cron) o `{ ids }` / `{ releer }` (botón "Revisar ahora").
3. **De dónde**: cron 3 veces por día hábil; `api/agente-mail/ejecutar` (roles super_admin/admin/administrativo).
4. **Operaciones**: token OAuth con refresh token; lista hasta 600 ids `in:inbox after:2026/10/01`; filtra ya procesados; por mail: clasificación, lectura de adjuntos (texto con pdfjs, visión hasta 10 por corrida), cruce `cruzarPago`; tope diario US$ 1,5; 25 mails por corrida; 30 s de presupuesto.
5. **Modifica**: `agente_mail_procesados`, `agente_mail_corridas`, `notificaciones`, `ia_uso`. "Volver a leer" BORRA filas de `agente_mail_procesados` (`ejecutar/route.ts:29,32`).
6. **Dónde**: idem; `gmail_message_id` único (índice confirmado).
7. **Quién depende**: Finanzas > correo (`finanzas-correo.tsx`), asistente de Finanzas (`finanzas/asistente/route.ts:147-152`).
8. **Depende de**: `GMAIL_*`, `ANTHROPIC_API_KEY`, service role, interruptor `configuracion.agente_mail_activo` (hoy apagado: sin fila).
9. **Errores**: Gmail sin autorización; IA saturada; PDF ilegible.
10. **Si falla un mail**: se guarda una fila "No se pudo leer este mail" con `error` y el `gmail_message_id` queda marcado como visto (`agente-mail-server.ts:292-297`): un error transitorio (IA saturada) no se reintenta solo; hay que usar "Volver a leer". Si falla el insert, corta la corrida (`:299`, `:307`).
11. **Si otro módulo cambia sus datos**: el cruce usa una foto de facturas y del extracto al inicio de la corrida (aceptable).
12. **Pruebas**: `scripts/test-agente-mail.ts` (corrida: OK).
13. **Problemas reales**:
    - **Otra fórmula de saldo de factura**: `cargarFacturasAbiertas` (`:129-145`) calcula `total − Σcobro_aplicaciones − total_acreditado`, sin restar cobros directos (`movimientos.factura_id` sin aplicación) y sin excluir aplicaciones de movimientos anulados. La regla oficial es `cobradoPorFactura` + `saldoFacturaVenta` de `src/lib/saldo-clientes.ts:80-111`. Hoy hay 24 cobros directos; 23 de facturas en estado `pagada`, y `cruzarPago` marca `cobrada` también por `estado === "pagada"` (`agente-mail.ts:133`), así que hoy el efecto práctico está tapado; para pagos parciales directos el saldo saldría mal.
    - `.limit(3000)` en facturas (`:132`): Supabase corta en 1000 sin avisar y sin `order`; hoy son 136. `extracto_movimientos` `.limit(1000)` sin orden (`:151`).
    - Dos corridas a la vez (cron + botón) chocan con el índice único: la segunda corta con error tras gastar IA en ese mail. Menor.
14. **Riesgos**: el modelo sugiere "Cargar el cobro de …" sobre un saldo calculado distinto al de Cuentas corrientes; precios por modelo fijos en el código (`agente-mail.ts:28-31`).
15. **Confiabilidad**: **media** — bien diseñado (solo sugiere, tope de gasto, idempotente por id), pero con fórmula de saldo propia. Hoy apagado.

## Módulo 6 — IA de lectura de documentos (parse-*, leer-*)

1. **Función**: leer PDF/fotos (facturas de compra, cobros/OP, OC de clientes, listas de precios, VEP, certificados, documentos impositivos, remitos, resúmenes de tarjeta) y devolver JSON.
2. **Recibe**: `FormData` con archivo(s) o base64.
3. **De dónde**: Compras, Finanzas, Proveedores, Presupuestos, Remitos.
4. **Operaciones**: una llamada a Anthropic (streaming si `max_tokens` grande), limpieza de PDF, extracción del JSON entre la primera `{` y la última `}`, `JSON.parse`.
5. **Modifica**: solo `ia_uso` (registro informativo). No guardan datos de negocio: el guardado lo hace la pantalla, después de que la persona revisa.
6. **Dónde**: `ia_uso`.
7. **Quién depende**: carga de facturas de compra, cobros, OP, listas de precios de proveedores, retenciones.
8. **Depende de**: Anthropic; modelos: Opus 5.5 con respaldo Sonnet 5.5 (factura-compra, vep, certificado, documento-impositivo, leer-foto, resumen-tarjeta); SOLO Opus 5.5 sin respaldo (`parse-cobro:160`, `parse-lista-precios:117`); Haiku 4.5 (`parse-oc:101`, `leer-oc-cliente:32`).
9. **Errores**: JSON truncado por `max_tokens`; archivo grande (> 4,5 MB de cuerpo en Vercel); IA saturada.
10. **Si falla**: 422/500 y la persona reintenta; nada queda a medias en la base.
11. **Si otro módulo cambia sus datos**: no aplica.
12. **Pruebas**: `test-purchase-invoice-parser.cjs`, `test-lectura-factura-pdf.ts`, `test-documento-impositivo.ts`, `test-certificado-*.ts` (no corridas en esta auditoría salvo las indicadas arriba).
13. **Problemas reales**:
    - Validación del JSON de la IA casi nula en el servidor (no hay esquema; `parse-factura-compra` solo normaliza números de comprobante con `normalizeInvoiceNumbers`). Depende 100 % de la revisión en pantalla.
    - Solo `parse-lista-precios` mira `stop_reason === "max_tokens"` (y "repara" el JSON cortando el último renglón, `:144-155`, devolviendo `truncated: true`), pero la pantalla que lo usa (`proveedores/page.tsx:562-575`) ignora `truncated`: se guarda una lista con renglones de menos sin aviso. En el resto, un corte por `max_tokens` aparece como "Probá con una imagen más clara".
    - `parse-cobro` y `parse-lista-precios` no tienen modelo de respaldo, a diferencia del resto.
    - Guardado de "Cargar lista con IA" en dos pasos sin transacción (`proveedores/page.tsx:641-668`): si falla el insert de renglones queda una lista `vigente` vacía. Además esta vía carga precios en `listas_precios` desde un PDF, cuando la regla del negocio es que los precios salen solo del `catalogo_crm.csv` (hoy hay 0 renglones en listas vigentes, así que el circuito casi no se usa).
14. **Riesgos**: sin límite de gasto en estas rutas (solo el chat de Ayuda y el agente de mail tienen tope); cualquier usuario logueado puede disparar Opus 5.5 sin límite.
15. **Confiabilidad**: **media** — nunca guardan solos (bien), pero la validación es superficial y el manejo de truncado es desparejo.

## Módulo 7 — IA de sugerencia (conciliación, presupuestos, compras, finanzas)

1. **Función**: equivalencias factura↔OC (`conciliar-compra`), presupuesto desde mensaje/imagen (`ai-presupuesto`), cotización express, normalizar OC, instrucciones de compras/precios, clasificar líneas del banco.
2. **Recibe**: JSON del cliente.
3. **De dónde**: Compras (conciliación), Presupuestos, Finanzas > Para confirmar.
4. **Operaciones**: llamada a IA; validación posterior en algunos.
5. **Modifica**: nada en el servidor (salvo `ia_uso`); la pantalla guarda sugerencias (`finanzas_propuestas`) o renglones.
6. **Dónde**: `finanzas_propuestas`, `finanzas_registro` (desde el cliente, `finanzas-para-confirmar.tsx:321-330`).
7. **Quién depende**: Compras, Presupuestos, Finanzas.
8. **Depende de**: Anthropic; `ai-presupuesto` depende de `lista_precios_items`.
9. **Errores**: IA caída.
10. **Si falla**: `conciliar-compra` cae a la similitud de palabras (muy bien: `route.ts:42-49`); `clasificar-lineas` prueba el siguiente modelo.
11. **Si otro módulo cambia sus datos**: no aplica.
12. **Pruebas**: `test-purchase-matching*.cjs`, `test-conciliacion-preguntas.ts`, `test-finanzas-propuestas.ts`.
13. **Problemas reales**:
    - **`/api/ai-presupuesto` lee el catálogo SIN SESIÓN**: crea el cliente de Supabase con la clave anónima y cookies vacías (`ai-presupuesto/route.ts:22-26`). Las políticas de `lista_precios_items`, `listas_precios` y `clientes` son solo para `authenticated` (consultado), así que RLS devuelve 0 filas: la IA nunca ve el catálogo ni el cliente. Los renglones vuelven con `precio_costo: 0` y la pantalla arma precios de venta en 0 (`presupuestos-lista.tsx:934-936`). Además el catálogo real ya no está en `listas_precios` (0 renglones vigentes). Error funcional (estático).
    - Bien hecho: `leerRespuestaConciliacion` (`purchase-matching-ai.ts:47-68`) valida cada equivalencia contra los grupos enviados y la IA no decide cantidades ni talles; `clasificar-lineas` filtra ids y valores contra listas cerradas (`:66-76`).
    - `finanzas-para-confirmar.tsx:284` marca las líneas como "ya preguntadas" antes de la llamada: si la tanda falla no se vuelve a preguntar en esa sesión (menor).
14. **Riesgos**: `conciliar-compra` con hasta 400 renglones y `max_tokens: 4000` puede truncarse en los tres modelos y caer a heurística (avisa).
15. **Confiabilidad**: **alta** para conciliación y clasificación; **baja** para `ai-presupuesto`.

## Módulo 8 — Asistentes (Ayuda IA, modo "Hacer", asistente de Finanzas) y control de gasto

1. **Función**: chat de Ayuda (Haiku, solo consulta, tope US$ 5/mes); modo "Hacer" (solo super_admin, Opus 5.5 → propone cambios con antes/después, se confirman con botón, con Deshacer); asistente de Finanzas (consulta).
2. **Recibe**: `messages`, `pantalla`, `sociedadId`, `modo`; `op: hacer|deshacer|lista`.
3. **De dónde**: panel de Ayuda, Finanzas.
4. **Operaciones**: herramientas `query_database`/`count_records` con la sesión del usuario (RLS) y filtro de sociedad; `proponer_cambio`/`proponer_contacto`; `hacerPropuesta` vuelve a validar contra la base antes de guardar; registra en `ia_acciones`.
5. **Modifica**: campos acotados (`CAMPOS_EDITABLES`, `ia-acciones.ts:8-22`: datos de contacto, notas, CBU/alias de proveedor, `orden_compra_items.cantidad_recibida`), `contactos`, `ia_acciones`, `ordenes_compra.estado` (recalculado con `estadoPorRecibido`, la misma regla que `compras-lazza-llego.tsx`).
6. **Dónde**: idem.
7. **Quién depende**: Compras (estado de OC por lo recibido), Pagos (CBU/alias del proveedor).
8. **Depende de**: Anthropic, RLS.
9. **Errores**: tope; IA caída (Hacer cae a Sonnet).
10. **Si falla**: el cambio y el registro en `ia_acciones` no son atómicos: si falla el registro, avisa "Hecho, pero no quedó en el historial" y no se puede deshacer desde la lista (`ia-acciones-server.ts:165-168`). El update de `cantidad_recibida` y el recálculo de estado de la OC tampoco son atómicos.
11. **Si otro módulo cambia sus datos**: Deshacer respeta lo que alguien cambió después (`planDeshacer`). Muy bien.
12. **Pruebas**: `scripts/test-ia-acciones.ts` (corrida: OK), `test-ayuda.ts`.
13. **Problemas reales**:
    - El tope mensual usa precios de Haiku fijos (`ia-tope.ts:8-9`) y solo cuenta `funcion = chat_ia`; hay TRES tablas de precios distintas (`ia-tope.ts`, `agente-mail.ts:28-31` que no conoce Opus/Sonnet 5.5 y cae a precio de Sonnet 4.5, `uso-ia-config.tsx:15-19`). El costo que ve Augusto en Configuración > Uso de IA es una estimación con precios escritos a mano que no se actualizan solos.
    - La consulta del tope (`ai/route.ts:147-148`) no pagina (corte de 1000 filas); con Haiku llegar a 1000 filas es casi llegar al tope, impacto bajo.
    - `ia_uso` acepta INSERT de cualquier usuario logueado (`ia_uso_insert` with_check `true`): se puede "llenar" el tope a mano (menor).
    - `count_records` no maneja `in`/`is` como `query_database` (`:237-239`), resultados inconsistentes en conteos con esos filtros (menor).
    - El modo "Hacer" puede cambiar CBU/alias/titular de un proveedor: dato sensible para pagos; queda en `ia_acciones` con Deshacer y solo lo usa super_admin. Bien acotado.
14. **Riesgos**: el `select` lo arma la IA y puede incluir relaciones de tablas fuera de `MODULO_TABLA` (por ejemplo `clientes(*, facturas(*))`); RLS sigue protegiendo, pero el control por módulo se saltea.
15. **Confiabilidad**: **alta** para el modo Hacer (revalida, deshace, campos acotados); **media** para el control de gasto.

## Módulo 9 — Email (Resend)

1. **Función**: enviar documentos (factura, OP, recibo, resumen, PR, remito, OC) con PDF adjunto y consultar estado de entrega.
2. **Recibe**: `to[]`, `subject`, `bodyHtml`, `pdfBase64`, `pdfFilename`, `documentType`, `userEmail`, `extraAttachments[{url}]`.
3. **De dónde**: `email-compose-modal.tsx`, `compras-nueva/page.tsx:315`.
4. **Operaciones**: valida mails con regex, decide remitente (administracion@ para documentos administrativos; si no, el `userEmail` que manda el navegador), baja adjuntos extra desde URLs (timeout 15 s, errores silenciosos), envía con Resend.
5. **Modifica**: nada en la base (el registro del envío lo hace la pantalla en `onSuccess`, después).
6. **Dónde**: Resend.
7. **Quién depende**: Facturación, Finanzas, Compras, Remitos, Presupuestos.
8. **Depende de**: `RESEND_API_KEY`, dominio verificado.
9. **Errores**: Resend rechaza; adjunto extra que no baja (se omite sin avisar).
10. **Si falla**: el mail sale pero si falla `onSuccess` (registro en la base) no queda constancia del envío (`email-compose-modal.tsx:176`). Un adjunto extra (comprobante) que no se pudo bajar se omite y el mail sale igual sin avisar (`send/route.ts:87`).
11. **Si otro módulo cambia sus datos**: no aplica.
12. **Pruebas**: `test-checklist-email-credit.mjs`, `test-envio-*.ts` (no revisadas a fondo).
13. **Problemas reales**:
    - `from` lo decide el navegador (`userEmail`, `send/route.ts:67-68`) y `documentType`: cualquier usuario logueado puede mandar como cualquier casilla del dominio verificado.
    - `extraAttachments[].url` se baja desde el servidor sin validar el host (`:82`): cualquier URL (SSRF acotado a usuarios logueados).
    - El HTML del cuerpo no se escapa (`email-compose-modal.tsx:163`).
14. **Riesgos**: envío doble si se reintenta tras un timeout de red (sin clave de idempotencia).
15. **Confiabilidad**: **media**.

## Módulo 10 — Búsqueda de CUIT (padrón ARCA)

1. **Función**: datos fiscales por CUIT o DNI (A5 con respaldo A13), probando con los certificados de las dos sociedades en paralelo.
2. **Recibe**: `cuit` (7-8 o 11 dígitos).
3. **De dónde**: alta de clientes/proveedores.
4. **Operaciones**: WSAA + SOAP padrón, timeouts 12 s, `Promise.any`.
5. **Modifica**: nada.
6. **Dónde**: —
7. **Quién depende**: alta de clientes y proveedores (condición IVA, domicilio).
8. **Depende de**: certificados `ARCA_*` en Vercel.
9. **Errores**: certificado sin acceso a A5; WSAA "ya posee TA válido" (hipótesis: con DNI se piden hasta 8 tickets por consulta: 4 CUIT × 2 sociedades × A5/A13).
10. **Si falla**: 503 y carga manual. No bloquea.
11. —
12. **Pruebas**: ninguna encontrada.
13. **Problemas reales**: baja el nivel de seguridad TLS de TODO el proceso (`tls.DEFAULT_CIPHERS += ":@SECLEVEL=0"`, `cuit-lookup/route.ts:7-9`) al cargarse el módulo; si la función comparte proceso con otras rutas, sus conexiones salientes también quedan con cifrados débiles permitidos. Devuelve `debug` con mensajes internos al navegador (`:411`, `:425`).
14. **Riesgos**: los mismos certificados que la facturación.
15. **Confiabilidad**: **media**.

## Módulo 11 — Storage (archivos)

1. **Función**: guardar PDF de facturas de compra, comprobantes, certificados, presupuestos, fotos de productos.
2. **Recibe**: archivos desde el navegador.
3. **De dónde**: Compras, Finanzas, Retenciones, Presupuestos.
4. **Operaciones**: upload/download con la clave del navegador.
5. **Modifica**: `storage.objects`.
6. **Dónde**: buckets `certificados`, `comprobantes`, `facturas-compra`, `presupuestos`, `productos`.
7. **Quién depende**: envío de mails con adjuntos, conciliación, retenciones.
8. **Depende de**: políticas de `storage.objects`.
9. **Errores**: archivo subido y registro no guardado → archivo huérfano (no revisado en detalle).
10. —
11. —
12. **Pruebas**: ninguna.
13. **Problemas reales** (consultado en `storage.buckets` y `pg_policies`):
    - Los 5 buckets son `public = true`: cualquiera con el link baja el archivo sin login (certificados de retención, comprobantes de pago, facturas de compra).
    - `facturas-compra`: políticas para el rol `public` (incluye anónimo): `auth insert facturas-compra` (INSERT), `auth update facturas-compra` (UPDATE) y `public read facturas-compra` (SELECT). Con la clave anónima se puede listar, subir y reemplazar PDFs de facturas de compra.
    - `comprobantes`: `Public read comprobantes` para `anon` (SELECT) → se pueden listar todos los comprobantes.
    - Sin límite de tamaño ni tipos de archivo (`file_size_limit` y `allowed_mime_types` nulos).
    - Ningún filtro por sociedad en las políticas.
14. **Riesgos**: exposición de datos fiscales y bancarios de clientes/proveedores; reemplazo de un PDF de respaldo de una factura de compra sin rastro.
15. **Confiabilidad**: **baja** (en seguridad; funcionalmente anda).

## Módulo 12 — Lectura local sin IA (navegador)

1. **Función**: leer QR de ARCA o el texto del PDF de una factura en el navegador; achicar fotos antes de subir.
2-8. Recibe el `File`, devuelve la misma forma que `/api/parse-factura-compra`; usa `pdfjs-dist` y `jsqr`; no toca la base. Lo usan `compras-nueva`, `remitos`, `cargar-factura-oc`, `compras-lazza-factura`.
9-10. Si no encuentra lo mínimo devuelve `null` y se cae a la IA.
12. `test-factura-sin-ia.ts`, `test-lectura-factura-pdf.ts`.
13. Sin problemas encontrados. Ahorra IA y no manda el archivo afuera. **Bien hecho.**
15. **Confiabilidad**: **alta**.

---

## Hallazgos detallados

### H1 — Cotizaciones del dólar escribibles por cualquiera (rol anónimo)
- **Severidad**: alto · **Tipo**: riesgo estructural · **Certeza**: estático (políticas leídas en `pg_policies`).
- **Evidencia**: políticas `cotiz_insert_anon` (INSERT, `true`) y `cotiz_update_anon` (UPDATE, `true`) sobre `cotizaciones_dolar` para `{anon}`; `20261012170000_cerrar_tablas_sin_login.sql:8` dejó la excepción; `cron/cotizacion/route.ts:77` ya usa service role; `isTrustedBnaCache` (`bna-historical.ts:14-16`) confía en `es_manual = true`.
- **Síntoma**: ninguno visible hoy (0 filas manuales).
- **Causa raíz**: la excepción para el cron sin login quedó después de pasar el cron a la service role.
- **Consecuencia**: con la clave anónima (pública) alguien puede cargar un dólar falso marcado como manual o "BNA histórico v2"; lo toman presupuestos y, si el BNA no responde, la facturación de facturas en USD.
- **Solución**: migración aditiva que quite `cotiz_insert_anon` y `cotiz_update_anon` (rollback que las vuelva a crear) y agregar `cotiz_update` para `authenticated` con los mismos roles que `cotiz_insert`; que `/api/cotizacion-bna` escriba con service role o no escriba.
- **Esfuerzo**: S.

### H2 — Storage público y con escritura anónima en facturas-compra
- **Severidad**: alto · **Tipo**: riesgo estructural · **Certeza**: estático (`storage.buckets`, `pg_policies` de `storage.objects`).
- **Evidencia**: 5 buckets `public = true`; políticas `auth insert facturas-compra` / `auth update facturas-compra` / `public read facturas-compra` con rol `{public}`; `Public read comprobantes` con `{anon}`.
- **Síntoma**: los links de archivos abren sin login.
- **Causa raíz**: buckets creados como públicos al inicio y políticas genéricas sin rol.
- **Consecuencia**: exposición de comprobantes, certificados y facturas; un anónimo puede listar y reemplazar PDFs de facturas de compra.
- **Solución**: (1) quitar las políticas `{public}`/`{anon}` de escritura y listado; (2) pasar los buckets a privados y servir con `createSignedUrl` (requiere tocar los lugares que usan `getPublicUrl` y los adjuntos del mail, que hoy bajan por URL pública). Hacerlo en dos tandas: primero políticas (S), después privados (M).
- **Esfuerzo**: M.

### H3 — `ai-presupuesto` consulta el catálogo sin sesión: la IA nunca ve precios ni cliente
- **Severidad**: medio · **Tipo**: error funcional · **Certeza**: estático.
- **Evidencia**: `api/ai-presupuesto/route.ts:22-26` (`createServerClient` con `getAll: () => []`), consultas `:29-39` y `:51-55`; políticas de `lista_precios_items`, `listas_precios`, `clientes` solo para `authenticated`; `presupuestos-lista.tsx:934-936` arma `precio_venta` desde `precio_costo`. Además 0 renglones en listas vigentes.
- **Síntoma**: "Generar con IA" en un PR devuelve renglones con costo 0 y "No encontrado en catálogo".
- **Causa raíz**: cliente Supabase anónimo + catálogo migrado a otra fuente (catálogo CSV).
- **Consecuencia**: el vendedor completa todo a mano; precios en 0 si no revisa (el margen mínimo avisa).
- **Solución**: usar `createSupabaseServer()` (sesión) y leer la misma fuente de catálogo que la Cotización express / lista de costos, con `traerTodo` o búsqueda por palabras.
- **Esfuerzo**: S/M.

### H4 — CRON_SECRET: tres crons fallan abiertos
- **Severidad**: medio · **Tipo**: riesgo estructural · **Certeza**: estático.
- **Evidencia**: `cron/agente-mail/route.ts:16`, `cron/bcra/route.ts:20`, `cron/presupuestos-vencimiento/route.ts:119-125` (`if (cronSecret && …)`), contra `cron/cotizacion/route.ts:71` (falla cerrado); `/api/cron/*` público en `lib/supabase/middleware.ts:35`.
- **Síntoma**: ninguno hoy (la variable existe).
- **Causa raíz**: patrón copiado distinto en cada ruta.
- **Consecuencia**: si la variable falta, cualquiera dispara vencimientos de PR, gasto de IA o consultas BCRA masivas.
- **Solución**: una función `exigirCronSecret(req)` en `src/lib` que falle cerrado, usada por los 4 crons; en `presupuestos-vencimiento` no caer a la clave anónima.
- **Esfuerzo**: S.

### H5 — Tercera y cuarta fórmula de "saldo de factura de venta"
- **Severidad**: medio · **Tipo**: riesgo estructural · **Certeza**: estático (y dato: 24 cobros directos sin aplicación).
- **Evidencia**: `agente-mail-server.ts:129-145` y `finanzas/asistente/route.ts:60-75` calculan `total − Σcobro_aplicaciones − total_acreditado`; la regla oficial `saldo-clientes.ts:80-111` además suma cobros directos (`movimientos.factura_id`) y excluye movimientos anulados.
- **Síntoma**: hoy tapado por `estado === "pagada"` (los 23 cobros directos válidos son de facturas pagadas); aparecería con cobros directos parciales o aplicaciones de cobros anulados.
- **Causa raíz**: cada módulo nuevo reescribió la cuenta en vez de usar `cobradoPorFactura` + `saldoFacturaVenta`.
- **Consecuencia**: el agente o el asistente pueden decir "cargá el cobro" de algo ya cobrado o informar deuda distinta a Cuentas corrientes.
- **Solución**: que ambos usen `cobradoPorFactura`/`saldoFacturaVenta` (traer movimientos con `factura_id` y aplicaciones con `movimientos(anulado)`), con prueba en `scripts/`.
- **Esfuerzo**: S.

### H6 — Dos reglas para la cotización de una factura; la manual no manda al facturar
- **Severidad**: medio · **Tipo**: riesgo estructural · **Certeza**: estático.
- **Evidencia**: `invoice-exchange-rate.ts:17-31` (BNA en vivo primero, día calendario anterior) vs `api/cotizacion-bna/route.ts:21-26,175-178` (día hábil anterior, caché/manual primero); `api/facturacion/route.ts:428`.
- **Síntoma**: si Augusto carga a mano una corrección, la factura igual toma el BNA en vivo.
- **Causa raíz**: dos caminos escritos en momentos distintos.
- **Consecuencia**: diferencia de tipo de cambio entre lo que muestra la pantalla y lo que se factura en casos límite.
- **Solución**: en `getInvoiceExchangeRate`, mirar primero si hay fila `es_manual` para la fecha objetivo; unificar "día anterior" en una función pura con prueba.
- **Esfuerzo**: S.

### H7 — Lista de precios con IA: truncado ignorado y guardado en dos pasos
- **Severidad**: bajo · **Tipo**: error funcional · **Certeza**: estático.
- **Evidencia**: `parse-lista-precios/route.ts:144-169` devuelve `truncated`; `proveedores/page.tsx:562-575` no lo mira; `:641-668` inserta lista y luego renglones sin transacción.
- **Síntoma**: lista guardada con menos renglones sin aviso, o lista vigente vacía si falla el segundo insert.
- **Causa raíz**: falta de chequeo y de RPC atómica.
- **Consecuencia**: precios faltantes de un proveedor (hoy casi sin uso: 0 renglones vigentes).
- **Solución**: mostrar aviso si `truncated`; borrar la lista (o marcarla borrador) si falla el insert de renglones; evaluar si este botón debe seguir existiendo dado que los precios salen del catálogo CSV.
- **Esfuerzo**: S.

### H8 — Sin tope de gasto en la mayoría de las rutas de IA y precios escritos a mano en 3 lugares
- **Severidad**: bajo · **Tipo**: mejora · **Certeza**: estático.
- **Evidencia**: tope solo en `ai/route.ts:147-156` (chat_ia) y `agente-mail.ts:32` (diario); precios en `ia-tope.ts:8-9`, `agente-mail.ts:28-31`, `uso-ia-config.tsx:15-19`; `registrarUsoIA` guarda tokens crudos (sin caché) en todas las demás rutas.
- **Consecuencia**: el costo mostrado es aproximado y no hay corte si una pantalla entra en bucle.
- **Solución**: una sola tabla de precios en `src/lib/ia-tope.ts` y un tope mensual global "aviso" (no bloqueo, según regla 1) que notifique a Augusto.
- **Esfuerzo**: S.

### H9 — Email: remitente y adjuntos decididos por el navegador
- **Severidad**: bajo · **Tipo**: riesgo estructural · **Certeza**: estático.
- **Evidencia**: `api/email/send/route.ts:62-71` (`userEmail` del body), `:79-88` (fetch a cualquier URL, errores silenciosos).
- **Consecuencia**: un usuario puede enviar como otra casilla del dominio; un comprobante que no baja se omite sin avisar.
- **Solución**: tomar el mail del perfil en el servidor (`createSupabaseServer` + `profiles.email`); aceptar solo URLs del Storage propio; devolver en la respuesta qué adjuntos no se pudieron agregar.
- **Esfuerzo**: S.

### H10 — Agente de mail: un error transitorio deja el mail como "procesado"
- **Severidad**: bajo · **Tipo**: mejora · **Certeza**: estático.
- **Evidencia**: `agente-mail-server.ts:292-297` guarda la fila con `error` y el id queda en `yaVistos` en la próxima corrida (`:191-197`).
- **Consecuencia**: si la IA estaba saturada, el mail queda "No se pudo leer" hasta que alguien aprieta "Volver a leer".
- **Solución**: en la próxima corrida, reprocesar automáticamente filas con `error` y `visto_at` nulo (máximo 1 reintento).
- **Esfuerzo**: S.

### H11 — Aviso de 5 días de presupuestos nunca se crea
- **Severidad**: bajo · **Tipo**: error funcional · **Certeza**: estático.
- **Evidencia**: `cron/presupuestos-vencimiento/route.ts:34-35` (mismo título) + dedupe `:196`.
- **Solución**: dedupe por `tag` (guardarlo en la alerta) o títulos distintos.
- **Esfuerzo**: S.

### H12 — `cuit-lookup` baja la seguridad TLS del proceso
- **Severidad**: bajo · **Tipo**: riesgo estructural · **Certeza**: riesgo.
- **Evidencia**: `api/cuit-lookup/route.ts:7-9`.
- **Solución**: pasar `ciphers: "DEFAULT:@SECLEVEL=0"` solo al agente HTTPS de las llamadas a AFIP (o al cliente de la librería), no al default global; no devolver `debug` al navegador.
- **Esfuerzo**: S.

### H13 — Documentación desactualizada de integraciones
- **Severidad**: bajo · **Tipo**: mejora · **Certeza**: estático.
- **Evidencia**: `docs/ARQUITECTURA.md` dice "modelos Sonnet y Haiku" (hoy Opus 5.5 con respaldo Sonnet 5.5), no lista el cron de agente-mail ni el bucket `productos`, ni las variables `GMAIL_*`.
- **Solución**: actualizar el documento.
- **Esfuerzo**: S.

---

## Conexiones con otros módulos

| Desde | Hacia | Dato | Fuente de verdad | ¿Compatible? | Nota |
|---|---|---|---|---|---|
| cron/cotizacion, /api/cotizacion-bna | Facturación (`api/facturacion:428`) | tipo de cambio | `cotizaciones_dolar` + BNA en vivo | dudoso | Facturación prioriza BNA en vivo sobre lo manual; la tabla es escribible por anónimos (H1, H6). |
| /api/cotizacion-bna | Presupuestos / Finanzas | dólar del día | `cotizaciones_dolar` | sí | Caché confiable = manual o "BNA histórico v2". |
| agente-mail | Finanzas > correo, asistente de Finanzas | sugerencias de cobro | `agente_mail_procesados` | sí | Solo sugiere; no registra cobros. |
| agente-mail | Cuentas corrientes | saldo de factura de venta | `saldo-clientes.ts` (`cobradoPorFactura`) | no | Fórmula propia sin cobros directos ni anulados (H5). |
| finanzas/asistente | Cuentas corrientes | saldo de factura | `saldo-clientes.ts` | no | Misma fórmula paralela (H5). |
| cron/bcra, /api/bcra | Presupuestos, Facturación, ficha 360 | semáforo BCRA | `cliente_bcra_informes` / `proveedor_bcra_informes` | sí | Solo aviso, nunca bloquea. |
| cron/presupuestos-vencimiento | Presupuestos | estado `vencido` | `presupuestos.estado` | sí | No vence aprobados. |
| cron/presupuestos-vencimiento | Finanzas | aviso de cheques de tercero y Revisar | `echeqs.cubre_tercero`, `finanzas_revisar` | sí | Dedupe por entidad. |
| ia-acciones (modo Hacer) | Compras | estado de la OC por recibido | `estadoPorRecibido` (`compras-recepcion.ts`) | sí | Misma regla que "Llegó" de Compras Lazza. |
| ia-acciones (modo Hacer) | Pagos | CBU/alias del proveedor | `proveedores` | sí | Con historial y Deshacer; solo super_admin. |
| ai-presupuesto | Presupuestos | catálogo y costo | catálogo CSV / lista de costos | no | Lee `lista_precios_items` sin sesión → vacío (H3). |
| parse-lista-precios | Proveedores > listas | precios de proveedor | `catalogo_crm.csv` (regla 7) | dudoso | Vía paralela de precios por IA (H7). |
| conciliar-compra | Compras (conciliación) | equivalencias factura↔OC | `purchase-matching.ts` + `proveedor_equivalencias` | sí | IA validada; cantidades y talles por reglas fijas. |
| finanzas/clasificar-lineas | Finanzas > Para confirmar | clasificación de líneas del banco | `finanzas_propuestas` | sí | Valida ids y valores; queda como propuesta. |
| parse-* | Compras / Finanzas / Retenciones | datos leídos de PDF | pantalla (revisión humana) | sí | No guardan solos. |
| email/send | Facturación, Finanzas, Compras, Remitos | constancia de envío | registro que hace cada pantalla en `onSuccess` | dudoso | Mail enviado y registro no atómicos (módulo 9). |
| Storage | Email (adjuntos), Compras, Retenciones | archivos | buckets públicos | dudoso | Públicos; facturas-compra escribible por anónimo (H2). |
| ia_uso | Configuración > Uso de IA, tope de Ayuda | costo de IA | `ia_uso` + precios en código | dudoso | Tres tablas de precios distintas (H8). |

## Bien hecho

- Ninguna ruta de IA guarda datos de negocio por su cuenta: todo vuelve a pantalla para revisión (regla "la IA sugiere").
- Modo "Hacer": campos acotados, revalidación contra la base antes de guardar, historial `ia_acciones` y Deshacer que no pisa cambios posteriores.
- `conciliar-compra`: la IA solo decide equivalencias, validadas contra los grupos enviados; respaldo por similitud si la IA falla.
- `clasificar-lineas`: filtra ids y clasificaciones contra listas cerradas.
- BCRA: no pisa un informe bueno con un error; cron incremental, paginado con `traerTodo`, con presupuesto de tiempo.
- Cron de cotización: falla cerrado, no pisa manuales, no usa DolarAPI en feriados, guarda la fecha real que publicó el BNA.
- Agente de mail: interruptor de encendido, tope diario de gasto, idempotencia por `gmail_message_id` único, solo lectura de Gmail.
- Lectura de facturas en el navegador (QR de ARCA / texto) antes de usar IA.
