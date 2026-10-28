# Agente 6 — Base de datos, integridad y seguridad/permisos

Auditoría de SOLO LECTURA (28/10/2026). No se modificó nada del repo salvo este archivo. Consultas a la base: solo SELECT dentro de `begin transaction read only` (mismo mecanismo que `scripts/lectura/sql.cjs`). Para probar qué ve alguien sin login se usó `set local role anon` dentro de esa transacción de solo lectura (nada se escribió, ninguna RPC que escriba fue llamada). No se llamó a ARCA, Resend, Anthropic, BCRA ni ningún servicio externo.

## Alcance revisado

- Estado REAL de la base: `pg_class` (RLS por tabla), `pg_policies` (≈300 políticas), `pg_proc` (funciones `security definer`, `search_path`, permisos EXECUTE de `anon`/`authenticated`), `pg_trigger`, `pg_constraint` (FKs y reglas de borrado), `pg_indexes` (únicos), `information_schema.role_table_grants`, vistas (`reloptions`), `storage.buckets` + políticas de `storage.objects`, `supabase_migrations.schema_migrations`.
- Código: `src/middleware.ts`, `src/lib/supabase/{middleware,server}.ts`, `src/lib/auth-context.tsx`, `src/app/api/users/route.ts`, `src/app/api/invite/route.ts`, `src/app/api/email/send/route.ts`, `src/app/api/cotizacion-bna/route.ts`, `src/app/api/cron/*/route.ts`, `src/app/api/agente-mail/ejecutar/route.ts`, `src/app/api/facturacion/route.ts` (solo autorización), `src/app/api/sicore/route.ts` (solo autorización), `src/app/api/finanzas/asistente/route.ts` (solo autorización), `src/app/api/remito/route.ts`, `src/lib/pago-tarjeta.ts`, `src/lib/bna-historical.ts`, `src/lib/invoice-exchange-rate.ts`, `src/lib/dolar-presupuesto.ts`, puntos de `finanzas-vieja/page.tsx` (borrado de FC), `clientes/page.tsx`, `presupuestos-lista.tsx`, `emitir-factura-modal.tsx`, `ordenes-compra/page.tsx` (stock).
- Migraciones: 176 en `supabase/migrations`, 127 en `supabase/rollback`; leída `20261007113000_bloquear_facturas_compra_duplicadas.sql`.
- Datos (conteos y casos puntuales, sin datos personales): estado de facturas de venta vs cobrado, facturas de compra vs pagado, duplicados de facturas de compra, saldos denormalizados de clientes, tamaños de tablas (límite 1000).
- Tests corridos (leídos antes, puros): `scripts/test-facturacion-auth-date.cjs` → OK; `scripts/test-saldo-factura-compra.ts` → OK.

---

## Módulo 1 — Autenticación y sesión (middleware + auth-context + clientes Supabase)

1. **Función**: exigir sesión en todas las páginas y `/api/*`, cortar usuarios inactivos o sin ficha, elegir sociedad activa en el front.
2. **Recibe**: cookies de Supabase Auth; `profiles.active`; `user_sociedades`.
3. **De dónde**: navegador (cookies), tablas `profiles` y `user_sociedades`.
4. **Operaciones**: `auth.getUser()`, lectura de `profiles.active`, `signOut()` si inactivo; en el front, filtra `sociedades` por `user_sociedades`.
5. **Modifica**: solo cookies de sesión.
6. **Guarda**: nada (localStorage `lazzari_sociedad_activa` en el front).
7. **Dependen de él**: todas las pantallas y rutas API (todas suponen que el middleware ya filtró login).
8. **Depende de**: Supabase Auth, `profiles`, `user_sociedades`.
9. **Errores posibles**: Supabase caído → deja pasar páginas (no APIs: 503) (`lib/supabase/middleware.ts:47-53`); error al leer `profiles` → NO corta (solo corta si no hay error, línea 70).
10. **Si falla**: con error de lectura de `profiles` un usuario dado de baja podría seguir operando hasta que se arregle; igual la RLS usa `lz_tiene_rol` que exige `active`.
11. **Si otro módulo cambia datos**: si se borra la fila de `user_sociedades` el front muestra TODAS las sociedades (`auth-context.tsx:111-113`, "sin registros → acceso a todas"; en error también todas), pero la base (`lz_es_de_sociedad`) devuelve falso para no-admin: reglas distintas front/base.
12. **Pruebas**: no hay test del middleware. `test-facturacion-auth-date.cjs` simula la autorización de facturación (OK).
13. **Problemas reales**: rutas públicas: `/api/cron/*` y `/api/cotizacion-bna` (`middleware.ts:35`). La segunda escribe en la base con la clave anónima (ver H1).
14. **Riesgos**: la restricción por sociedad vive en el front (auth-context) para la mayoría de las tablas; la base no la aplica (ver H5).
15. **Confiabilidad: media.** El login está bien resuelto en el servidor, pero el aislamiento por sociedad y por rol fino es mayormente de front.

## Módulo 2 — Gestión de usuarios (api/users, api/invite, triggers de profiles)

1. **Función**: invitar, editar rol/clave/mail y dar de baja usuarios.
2. **Recibe**: JSON con id, rol, nombre, mail, clave, sociedades.
3. **De dónde**: pantalla Configuración (solo super_admin).
4. **Operaciones**: verifica sesión y `role = super_admin` y `active` en el servidor (`users/route.ts:8-19`, `invite/route.ts:20-33`); usa service role solo después de esa verificación.
5. **Modifica**: `auth.users`, `profiles`, `user_sociedades`.
6. **Guarda**: idem. Baja = `active=false, role=viewer` + ban (`users/route.ts:91-95`), nunca borra.
7. **Dependen**: RLS entera (vía `get_my_role`, `lz_tiene_rol`, `lz_es_de_sociedad`).
8. **Depende de**: `SUPABASE_SERVICE_ROLE_KEY`, Resend (invitación).
9. **Errores**: PATCH hace 2–3 llamadas (auth, profiles, metadata) sin transacción: puede quedar mail cambiado en auth y no en profiles si falla la segunda.
10. **Si falla**: error devuelto al usuario; estado parcial posible (bajo impacto).
11. **Si otro módulo cambia datos**: los triggers `lz_proteger_profiles` y `lz_proteger_user_sociedades` impiden que un usuario se cambie rol/active/email o sus sociedades (solo super_admin o service role, `lz_puede_manejar_usuarios`). Verificado en `pg_proc`.
12. **Pruebas**: no hay test específico.
13. **Problemas reales**: ninguno grave. `profiles` SELECT `true`: todo usuario logueado ve mail y rol de todos (bajo).
14. **Riesgos**: `lz_puede_manejar_usuarios()` devuelve verdadero cuando `auth.uid()` es nulo (pensado para service role). Hoy `anon` no tiene política sobre `profiles`, así que no se puede aprovechar, pero si alguien agrega una política para `anon`/`public` en `profiles` o `user_sociedades`, el trigger dejaría pasar.
15. **Confiabilidad: alta.** Bien hecho: chequeo en servidor, service role acotado, triggers de protección en la base.

## Módulo 3 — RLS y aislamiento por sociedad

1. **Función**: que cada rol vea/escriba solo lo suyo y cada usuario solo su sociedad.
2. **Recibe**: `auth.uid()` en cada consulta del cliente.
3. **De dónde**: todas las pantallas (el front consulta tablas directo con la clave anónima + sesión).
4. **Operaciones**: 113 tablas públicas, TODAS con RLS activado (bien). Políticas por rol (`get_my_role`, `lz_tiene_rol`, `can_write`) y por sociedad (`lz_es_de_sociedad`, `lz_puede_operar_finanzas`, `user_sociedades`).
5. **Modifica**: nada (filtra).
6. **Guarda**: —
7. **Dependen**: todo el sistema.
8. **Depende de**: `profiles.role/active`, `user_sociedades`.
9. **Errores**: políticas `true` en tablas de plata (ver H4); falta de filtro por sociedad en la mayoría (H5).
10. **Si falla**: sin filtro, el front sigue mostrando bien porque filtra `.eq("sociedad_id")`, pero cualquier usuario con la consola o un error del front ve/escribe la otra sociedad.
11. **Si otro módulo cambia**: tablas nuevas (finanzas-lazza, pagos_lotes, personalización, préstamos, tarjetas) usan `lz_es_de_sociedad`/`lz_puede_operar_finanzas` (bien); tablas viejas (facturas, clientes, presupuestos, movimientos, ordenes_pago, echeqs, facturas_compra) no.
12. **Pruebas**: `scripts/lectura/probar-anonimo.cjs` (prueba lo que ve anónimo en 7 tablas, no cubre vistas, RPC ni storage).
13. **Problemas reales**:
    - `cotizaciones_dolar`: INSERT y UPDATE para `anon` con `true` (H1).
    - `facturas_compra`: SELECT/INSERT/UPDATE/DELETE `true` para cualquier logueado; `facturas_compra_items`, `factura_compra_ocs`, `numeracion_secuencias`, `cai_config`, `transportes`, `fichas_relevamiento` ALL `true` (H4).
    - SELECT `true` para todos los logueados en `ordenes_pago`, `op_facturas_compra`, `echeqs`, `cobro_aplicaciones`, `notas_credito`, `gastos_manuales`, `saldos_caja`, `retencion_config` (vendedores ven pagos, cheques y caja; la regla "vendedores solo venden").
    - Hay 1 vendedor con una sola sociedad: puede leer por API clientes/presupuestos/facturas de la otra.
14. **Riesgos**: políticas duplicadas (p. ej. `email_templates` 2×ALL, `fichas_relevamiento` dobles, `ordenes_compra` 2×SELECT) — se suman con OR; una política permisiva vieja anula una restrictiva nueva.
15. **Confiabilidad: media.** RLS existe en todas las tablas y la parte nueva está bien; la parte vieja confía en el front.

## Módulo 4 — Funciones SECURITY DEFINER / RPC de plata

1. **Función**: operaciones atómicas de plata (pagos, cobros, NC, anulaciones, conciliaciones, emisión fiscal).
2. **Recibe**: ids, `p_sociedad_id`, `p_request_key`, JSON de renglones.
3. **De dónde**: front (supabase.rpc) y rutas API.
4. **Operaciones**: ≈100 funciones `security definer`. Las de plata verifican rol y sociedad (`lz_puede_operar_finanzas`, `lz_es_de_sociedad`, `lz_tiene_rol`) y usan `request_key` idempotente (`cobro_solicitudes`, `pago_solicitudes`, `liquidaciones_fx`, `fiscal_emission_attempts` con índice único por PV pendiente).
5. **Modifica**: movimientos, ordenes_pago, op_facturas_compra, facturas, facturas_compra, echeqs, etc.
6. **Guarda**: idem.
7. **Dependen**: Finanzas Lazza, Compras Lazza, Facturación, Cobros.
8. **Depende de**: helpers de rol/sociedad.
9. **Errores**: funciones internas (`registrar_cobro`, `registrar_cobro_masivo`, `_aplicar_nc_compra`, `fc_compra_pagado`, `lz_actualizar_fact_pago_oc`…) tienen EXECUTE revocado a `authenticated` y `anon` (bien: solo se llaman desde las "seguras").
10. **Si falla**: rollback completo (son una transacción).
11. **Si otro módulo cambia**: si el front edita tablas directo (facturas_compra.total, estado) las RPC no se enteran (ver H6, H7).
12. **Pruebas**: varios `test-*` de lógica pura replican la regla (p. ej. `test-saldo-factura-compra.ts` OK).
13. **Problemas reales**: funciones ejecutables por `anon` SIN chequeo (H2): `get_dashboard_kpis()` y `get_dashboard_kpis(uuid)`, `get_balance_projection(uuid)`, `increment_stock(uuid,int)`, `check_presupuestos_vencidos()`, `check_listas_vencidas()`, `generar_recordatorios_eventos()`. `delete_presupuesto_safe` acepta cualquier rol (incluso viewer), sin chequeo de sociedad ni de estado (la política de DELETE exige admin + borrador, pero la función definer la saltea). `change_pr_operator` no verifica sociedad del usuario.
14. **Riesgos**: 14 funciones definer sin `search_path` fijo (`get_my_role`, `can_write`, `is_admin_or_above`, `audit_trigger_func`, `increment_stock`, `get_balance_projection`, `get_dashboard_kpis()`, `check_*`, `track_*`, `presupuesto_estado_alert`). Hoy `anon`/`authenticated` no tienen CREATE en `public`, así que el riesgo es bajo.
15. **Confiabilidad: media-alta** para las RPC de plata nuevas (bien hechas: atómicas, idempotentes, con permisos); **baja** para las funciones viejas expuestas a `anon`.

## Módulo 5 — Vistas

1. **Función**: consultas armadas (`v_facturas_pendientes`, `v_presupuestos_completos`, `v_cuenta_corriente_*`, `v_ordenes_compra_progreso`, `v_stock_alertas`, `v_comparador_precios`, `orden_compra_items_pendientes`).
2–3. **Recibe/de dónde**: lectura directa por PostgREST.
4. **Operaciones**: SELECT con joins.
5–6. Nada.
7. **Dependen**: `lib/supabase/queries/finanzas.ts`, `queries/proveedores.ts` (código viejo).
8. **Depende de**: facturas, presupuestos, clientes, profiles.
9. **Errores**: 7 de 8 vistas NO tienen `security_invoker` → corren como dueño y saltean la RLS.
10–11. —
12. **Pruebas**: ninguna.
13. **Problema real (H3)**: `anon` (sin login) tiene SELECT en `v_facturas_pendientes` (73 filas: tipo, número, cliente, CAE, totales, pdf_url) y `v_presupuestos_completos` (243 filas: cliente, CUIT, vendedor, mail del vendedor, totales). **Confirmado ejecutando** con `set local role anon`. Además ninguna de estas vistas tiene `sociedad_id`: mezcla las dos sociedades para cualquier logueado.
14. **Riesgos**: las vistas `v_cuenta_corriente_*` (solo authenticated) muestran saldos de ambas sociedades a vendedores.
15. **Confiabilidad: baja.**

## Módulo 6 — Storage (archivos)

1. **Función**: guardar PDF/fotos de presupuestos, comprobantes de pago, facturas de compra, certificados de retención, productos.
2–3. Suben desde el front y rutas IA.
4. **Operaciones**: upload/list/download.
5–6. Buckets `certificados`, `comprobantes`, `facturas-compra`, `presupuestos`, `productos`.
7. **Dependen**: OP (comprobantes), mails (adjuntos por URL pública), Retenciones (certificados).
8. —
9. **Errores**: los 5 buckets son **públicos** (`storage.buckets.public = true`): cualquiera con el link baja el archivo sin login.
10–11. —
12. **Pruebas**: ninguna.
13. **Problema real (H8)**: políticas `Public read comprobantes` (anon) y `public read facturas-compra` (rol public) permiten **listar** los archivos sin login: confirmado con `set local role anon` → 99 comprobantes y 153 facturas de compra visibles. `auth insert/update facturas-compra` está dado al rol `public` (incluye anon): cualquiera podría subir o pisar archivos de facturas de compra. Ningún bucket separa por sociedad.
14. **Riesgos**: certificados de retención y comprobantes bancarios (CBU, montos, CUIT) expuestos por URL.
15. **Confiabilidad: baja.**

## Módulo 7 — Rutas API (autorización en servidor)

1. **Función**: IA, ARCA, SICORE, mails, crons, cotización.
2–3. JSON del front; crons desde Vercel.
4. **Operaciones**: todas las `/api/*` (salvo `cron/*` y `cotizacion-bna`) exigen login por middleware. Facturación, SICORE, agente-mail/ejecutar, finanzas/asistente, users, invite verifican además rol (y sociedad en facturación/SICORE) en el servidor (bien).
5–6. Varias escriben en la base con la sesión del usuario (RLS aplica).
7. Front.
8. Anthropic, ARCA, Resend, BNA.
9. **Errores**:
   - `api/email/send/route.ts`: sin chequeo de rol ni de sociedad; el remitente sale de `userEmail` del body (líneas 60-67: cualquier logueado puede mandar como cualquier dirección del dominio verificado) y descarga **cualquier URL** que venga en `extraAttachments` (líneas 76-85: SSRF básico desde el servidor).
   - Rutas IA (`parse-*`, `ai-presupuesto`, `cotizacion-express`, etc.): cualquier logueado (incluido un futuro viewer) puede gastar tokens; no hay tope por usuario. Bajo.
   - Crons `agente-mail`, `bcra`, `presupuestos-vencimiento`: si `CRON_SECRET` no está cargada, quedan **abiertos** y usan service role (`if (cronSecret && …)`); `cron/cotizacion` sí falla cerrado (`!cronSecret ||`, línea 71). Riesgo bajo si la variable existe en Vercel.
   - `api/cotizacion-bna`: pública y escribe en `cotizaciones_dolar` con la clave anónima → motivo de la política anon de H1.
10. —
11. —
12. `test-facturacion-auth-date.cjs` (OK, corrido).
13. Ver H1, H9.
14. `sicore/route.ts:17` crea cliente con service role a nivel módulo con fallback a anon; se usa solo después del chequeo de rol+sociedad (correcto, pero frágil).
15. **Confiabilidad: media-alta** (las rutas de plata están bien; email y cotización flojas).

## Módulo 8 — Integridad (constraints, triggers, FKs, saldos)

1. **Función**: que los datos de plata no queden inconsistentes aunque falle el front.
2–3. Escrituras directas del front y de RPC.
4. **Operaciones**: triggers `validar_saldo_aplicacion_factura_compra` (en `op_facturas_compra` y `movimientos`), `proteger_vinculo_fx`, `lz_trg_fact_pago_oc`, `recalcular_oc`, `auto_estado_oc`, autonumeración de OC/PR/remito, `audit_trigger_func` (solo en facturas, movimientos, ordenes_compra, presupuestos, remitos).
5–6. —
7. Saldos de Finanzas, Compras, CC.
8. —
9. **Errores**:
   - No hay índice único de número de factura de compra por proveedor (decisión documentada en `20261007113000…sql`: "dos viajes de transporte" pueden tener igual número). El trigger que esa migración crea (`bloquear_mismo_registro_factura_en_op`) **no existe** en la base (el único `op_facturas_compra_orden_pago_id_factura_compra_id_key` cubre ese caso).
   - `facturas` único `(tipo, punto_venta, numero)` sin `sociedad_id` (hoy no choca porque PV 15 y 10 son distintos).
   - `presupuestos.numero`, `ordenes_compra.numero`, `remitos.numero`, `productos.codigo` únicos globales (no por sociedad).
   - Sin auditoría (`audit_trigger_func`) en `facturas_compra`, `ordenes_pago`, `op_facturas_compra`, `echeqs`.
10. —
11. **Saldos denormalizados**: `clientes.saldo_cuenta_corriente` y `proveedores.saldo_cuenta_corriente` los recalculan triggers viejos con reglas distintas a las de Finanzas (H10).
12. `test-saldo-*` (lógica pura del front).
13. Ver H6, H7, H10, H11.
14. Ver H12 (validador ignora NC).
15. **Confiabilidad: media.**

## Módulo 9 — Migraciones y rollback

1. **Función**: cambios de esquema versionados con vuelta atrás.
2–3. Archivos SQL; los corre Augusto en el SQL Editor.
4. 176 migraciones, 127 rollbacks. **50 migraciones sin rollback**, todas anteriores a ~09/10 (p. ej. `20260925223000_pagos_proveedores_atomicos.sql`, `20261007143000_anular_orden_pago_atomica.sql`, `20261009210000_catalogo_proveedores.sql`); las nuevas sí tienen.
5–6. `supabase_migrations.schema_migrations` registra 132, última `20261008120000`: desde el 08/10 las migraciones se corren a mano y no quedan registradas → no hay forma automática de saber cuáles se aplicaron.
7–8. —
9. Ejemplo de desvío: la migración `20261007113000` crea `bloquear_mismo_registro_factura_en_op`, que no está en la base.
10–11. —
12. Algunas migraciones nuevas tienen "prueba" SQL asociada (según ESTADO).
13. Desvío migraciones ↔ base real confirmado en 1 caso.
14. Backups temporales `lz_backup_*` y `lz_respaldo_correcciones` (6 tablas) quedan en `public` con RLS y sin políticas (inofensivo, ocupan lugar).
15. **Confiabilidad: media.**

---

## Hallazgos detallados

### H1 — Cualquiera sin login puede escribir la cotización del dólar (crítico)
- **Tipo / certeza**: error funcional / estático + ejecución parcial (lectura anónima confirmada: `anon` ve 104 filas; escritura NO probada a propósito).
- **Evidencia**: `pg_policies`: `cotizaciones_dolar` INSERT `{anon}` WITH CHECK `true`; UPDATE `{anon}` USING `true` WITH CHECK `true`; grants de tabla a `anon` incluyen INSERT/UPDATE/DELETE. `src/lib/bna-historical.ts:14-16` `isTrustedBnaCache` confía en `es_manual === true || fuente === BNA_VERIFIED_SOURCE`, ambas columnas que el anónimo puede escribir. Consumo: `src/lib/invoice-exchange-rate.ts:32-55` (cotización para facturas USD), `src/lib/dolar-presupuesto.ts:80`, `components/finanzas-lazza/datos.ts`, `cuentas-corrientes.tsx`.
- **Síntoma**: una cotización falsa (con `fuente` = BNA verificado o `es_manual=true`) se toma como válida.
- **Causa raíz**: `/api/cotizacion-bna` es pública y graba con la clave anónima (sin sesión), así que se abrió la tabla a `anon`.
- **Consecuencia**: facturas en USD / divisa, presupuestos y diferencias de cambio calculados con un dólar inventado; plata y ARCA.
- **Solución**: que `/api/cotizacion-bna` grabe con service role (como `cron/cotizacion`) o que no grabe; quitar las políticas `anon` de INSERT/UPDATE (y el grant). Migración aditiva de políticas + rollback.
- **Esfuerzo**: S.

### H2 — Funciones de la base ejecutables sin login (alto)
- **Tipo / certeza**: error funcional / ejecución (lecturas) + estático (escrituras).
- **Evidencia**: `has_function_privilege('anon', …)` = true y cuerpo sin chequeo de `auth.uid()`/rol: `get_dashboard_kpis(uuid)` (con `set local role anon` devolvió objeto con 17 claves: ventas, cobros, pendientes), `get_balance_projection(uuid)` (con anon devolvió 8 bandas a cobrar y 6 a pagar, con `p_sociedad_id = null` suma ambas sociedades), `increment_stock(uuid,int)` (UPDATE de `productos.stock` sin rol ni sociedad; usado en `ordenes-compra/page.tsx:1022,1094,1205`, `stock/page.tsx:423`), `check_presupuestos_vencidos()`, `check_listas_vencidas()`, `generar_recordatorios_eventos()`.
- **Síntoma**: con la URL y la clave pública (están en el JS del navegador) se leen ventas/cobranzas/deudas y se puede mover stock.
- **Causa raíz**: funciones viejas creadas sin `revoke execute … from anon, public` y sin chequeo interno.
- **Consecuencia**: fuga de información financiera; stock alterable por cualquiera.
- **Solución**: `revoke execute on function … from anon, public`; agregar `lz_es_de_sociedad(p_sociedad_id)` + `lz_tiene_rol(...)` dentro; fijar `search_path`. `get_balance_projection` ya no se usa (comentario en `components/resumen-economico.tsx:4` "calcula mal") → revocar.
- **Esfuerzo**: S.

### H3 — Vistas que saltean la RLS y se leen sin login (alto)
- **Tipo / certeza**: error funcional / ejecución.
- **Evidencia**: `pg_class.reloptions` sin `security_invoker` en 7 vistas; `anon` con SELECT en `v_facturas_pendientes` (73 filas leídas como anon), `v_presupuestos_completos` (243 filas), `v_comparador_precios` (0). Columnas incluyen `cliente_nombre`, `cliente_cuit`, `vendedor_email`, totales, `pdf_url`.
- **Síntoma**: cualquiera con la clave pública lista facturas pendientes y presupuestos con CUIT de clientes.
- **Causa raíz**: vistas creadas por `postgres` (dueño, sin RLS) con grants por defecto a `anon`.
- **Consecuencia**: fuga de datos de clientes y montos; además, vendedores ven ambas sociedades.
- **Solución**: `alter view … set (security_invoker = true)` y `revoke select … from anon`; si no se usan (solo `lib/supabase/queries/*` viejas), revocar directamente.
- **Esfuerzo**: S.

### H4 — Tablas de plata con políticas `true` para todo usuario logueado (alto)
- **Tipo / certeza**: riesgo estructural / estático.
- **Evidencia**: `facturas_compra` SELECT/INSERT/UPDATE/DELETE `true`; `facturas_compra_items`, `factura_compra_ocs`, `numeracion_secuencias`, `cai_config`, `transportes`, `fichas_relevamiento` ALL `true`; SELECT `true` en `ordenes_pago`, `op_facturas_compra`, `echeqs`, `cobro_aplicaciones`, `saldos_caja`, `gastos_manuales`, `retencion_config`.
- **Síntoma**: un vendedor puede, desde la consola, editar el total o el estado de una factura de compra, borrarla, cambiar la numeración o el CAI de remitos, y ver pagos/cheques/caja de las dos sociedades.
- **Causa raíz**: políticas viejas permisivas que nunca se cerraron (las tablas nuevas sí están bien).
- **Consecuencia**: integridad de saldos de proveedores sin garantía en la base (ver H6 y H7, que ya ocurrieron).
- **Solución**: reemplazar por `lz_es_de_sociedad(sociedad_id) and lz_tiene_rol(array['super_admin','admin','administrativo', …])`; DELETE de `facturas_compra` solo admin (o solo vía RPC de anulación). Hacerlo de a una tabla, con prueba de que Compras Lazza sigue funcionando para compradores (rol vendedor con Compras nueva).
- **Esfuerzo**: M.

### H5 — Aislamiento por sociedad solo en el front para las tablas viejas (medio)
- **Tipo / certeza**: riesgo estructural / estático + dato real.
- **Evidencia**: políticas de `facturas`, `clientes`, `presupuestos`, `productos`, `proveedores`, `movimientos`, `ordenes_compra`, `remitos`, `echeqs` no usan `sociedad_id`. Hay 1 vendedor activo con una sola sociedad en `user_sociedades`. `auth-context.tsx:111-113`: sin filas o con error → todas las sociedades (regla opuesta a `lz_es_de_sociedad`).
- **Consecuencia**: la restricción "este usuario solo ve Lazzari/Grupo LA" no es real.
- **Solución**: agregar `lz_es_de_sociedad(sociedad_id)` a las políticas de SELECT/escritura (aditivo) y alinear el front a "sin filas = ninguna" (o documentar).
- **Esfuerzo**: M.

### H6 — Factura de compra pagada de más: el total se puede editar después de pagar (medio)
- **Tipo / certeza**: error funcional / ejecución (dato) + estático (causa).
- **Evidencia**: factura de compra `e0a092d0-e059-4719-acce-378837265e9e` (0007-00024709, total 804.129,86) tiene aplicado por OP-000047 1.023.677,92 → **219.548,06 pagados de más** y `ordenes_pago.saldo_a_favor = 0`. El trigger `validar_saldo_op_factura_compra` valida solo al insertar el vínculo; `facturas_compra` no tiene trigger que revise el total al hacer UPDATE y la política UPDATE es `true`.
- **Síntoma**: saldo del proveedor negativo/raro, factura "pagada" con aplicación mayor al total, sin saldo a favor registrado.
- **Causa raíz**: cambio posterior del total (o carga distinta) sin re-validar aplicaciones.
- **Consecuencia**: diferencia de $ 219.548 sin explicar en la cuenta del proveedor.
- **Solución**: revisar el caso con Augusto (¿nota de crédito? ¿saldo a favor?). Estructural: trigger BEFORE UPDATE OF total en `facturas_compra` que AVISE (registro en `finanzas_revisar`), no que bloquee (regla 1).
- **Esfuerzo**: S (caso) / M (trigger).

### H7 — Facturas de compra "pagadas" sin ningún pago registrado (medio)
- **Tipo / certeza**: error funcional / ejecución (dato); causa = hipótesis.
- **Evidencia**: 3 facturas FC C en estado `pagada` con `fc_compra_pagado = 0`, sin OP, sin movimientos, sin liquidación FX, sin lote: `e63474af-…` (ARS 500.000), `17af302e-…` (USD 1.100), `89a24301-…` (USD 550).
- **Causa raíz posible**: `facturas_compra.estado` se puede escribir directo (política `true`) y hay caminos del front que lo hacen en dos pasos sin transacción (`lib/pago-tarjeta.ts:48-51`: primero `estado='pagada'`, después inserta el movimiento; si falla el segundo, queda pagada sin pago; `finanzas-vieja/page.tsx:1836`).
- **Consecuencia**: deuda con proveedores que no aparece; Cuentas corrientes y Plan de pagos subestiman lo que se debe ($ 500.000 + USD 1.650).
- **Solución**: que el estado de la factura de compra lo calcule solo la base (como `lz_estado_factura_por_cobro` en ventas) a partir de `fc_compra_pagado`; sacar el fallback de `pago-tarjeta.ts` (la RPC ya existe). Revisar los 3 casos con Augusto.
- **Esfuerzo**: S (casos) / M (estructural).

### H8 — Archivos (comprobantes, facturas de compra, certificados) públicos y listables sin login (alto)
- **Tipo / certeza**: error funcional / ejecución.
- **Evidencia**: `storage.buckets.public = true` en los 5 buckets; políticas `Public read comprobantes` (anon), `public read facturas-compra` (public), `auth insert facturas-compra` y `auth update facturas-compra` (rol public, o sea también anon). Con `set local role anon`: 99 objetos en `comprobantes`, 153 en `facturas-compra` visibles.
- **Consecuencia**: comprobantes de transferencias, facturas de proveedores y certificados de retención descargables por cualquiera; un anónimo puede subir o reemplazar PDFs de facturas de compra.
- **Solución**: buckets privados + URLs firmadas (`createSignedUrl`) en el front y en `email/send`; políticas por rol `authenticated`; borrar las políticas `public`/`anon`. Ojo: links ya mandados por mail dejarían de andar.
- **Esfuerzo**: M.

### H9 — `/api/email/send`: remitente libre y descarga de URLs arbitrarias (medio)
- **Tipo / certeza**: riesgo estructural / estático.
- **Evidencia**: `src/app/api/email/send/route.ts:60-67` (`fromEmail = userEmail` del body), `76-85` (`fetch(att.url)` sin validar dominio), sin chequeo de rol ni sociedad.
- **Consecuencia**: cualquier usuario logueado puede mandar mails "de" otra persona del dominio o hacer que el servidor pida URLs internas.
- **Solución**: tomar el remitente del perfil del usuario en el servidor; permitir solo URLs del Storage propio.
- **Esfuerzo**: S.

### H10 — Saldo de cuenta corriente guardado en clientes/proveedores con reglas viejas e incorrectas (medio)
- **Tipo / certeza**: riesgo estructural / ejecución.
- **Evidencia**: triggers `recalcular_saldo_cliente` (cuenta movimientos anulados, mezcla ARS y USD, no se dispara al cambiar facturas) y `recalcular_saldo_proveedor` (solo movimientos, ignora facturas y OP). Comparado con la regla real: 24 clientes con saldo guardado distinto (diferencia absoluta total $ 284 M). 82 proveedores con saldo ≠ 0. `clientes/page.tsx:905` ya lo reconoce ("no la actualiza nadie (B3)") y lo pisa con el cálculo real; pero `presupuestos-lista.tsx:311,3225` usa el saldo guardado para el aviso de límite de crédito.
- **Consecuencia**: hoy ningún cliente con diferencia tiene límite de crédito (sin efecto visible), pero el aviso de límite en Presupuestos usa un número equivocado.
- **Solución**: que Presupuestos use el mismo cálculo que `emitir-factura-modal.tsx:369` (`saldoClienteArs`); marcar la columna como obsoleta o desactivar esos triggers (con OK de Augusto).
- **Esfuerzo**: S.

### H11 — Borrar una factura de compra pagada borra en cascada su vínculo con la OP (medio)
- **Tipo / certeza**: riesgo estructural / estático.
- **Evidencia**: FK `op_facturas_compra.factura_compra_id` ON DELETE CASCADE (también `factura_compra_anulaciones`, `facturas_compra_items`, asignaciones); política DELETE `true`; `finanzas-vieja/page.tsx:2378-2396` permite "Eliminar igual" con dos confirmaciones; no hay auditoría en `facturas_compra` ni en `op_facturas_compra`.
- **Consecuencia**: la OP queda "pagada" sin facturas; el pago desaparece de la cuenta del proveedor; se borra hasta el registro de anulación. Sin rastro.
- **Solución**: DELETE solo vía RPC que exija que no tenga OP vigente (o que registre en `registros_eliminados`); auditoría con `audit_trigger_func` en `facturas_compra` y `ordenes_pago`.
- **Esfuerzo**: S.

### H12 — El validador de pagos de facturas de compra no descuenta las NC (bajo)
- **Tipo / certeza**: riesgo / estático.
- **Evidencia**: `validar_saldo_aplicacion_factura_compra` compara `aplicado + nuevo` contra `total` (sin `total_acreditado` ni crédito de NC); `fc_compra_pagado` sí suma el crédito de NC.
- **Consecuencia**: la base permite aplicar por OP el total aunque ya haya una NC aplicada → pago de más posible si el front se equivoca.
- **Solución**: usar `fc_compra_pagado` dentro del validador; como la regla 1 dice "avisar, no frenar", al menos que la RPC devuelva aviso.
- **Esfuerzo**: S.

### H13 — Mismo número de factura de compra cargado dos veces y pagado dos veces en la misma OP (medio, a verificar)
- **Tipo / certeza**: error funcional (probable) / ejecución (dato).
- **Evidencia**: `facturas_compra` `97cb7c21-…` y `606585f9-…`: mismo proveedor (transportista), FC A 4240-00004929, misma fecha 07/09, mismo total 29.379,32, cada una ligada a un viaje distinto en `transportes`; ambas pagadas por **OP-000044** (Lazzari) por 58.758,64. La migración `20261007113000` admite a propósito "dos viajes con igual número".
- **Consecuencia**: si es una sola factura por dos viajes, se pagó $ 29.379,32 de más.
- **Solución**: verificar con el PDF; estructural: aviso (no bloqueo) al cargar o pagar dos documentos con mismo proveedor+tipo+número (ya existe `duplicadosComprobanteCompra` en `lib/saldo-factura-compra`; aplicarlo también al armar la OP y en Transportes).
- **Esfuerzo**: S.

### H14 — Crons que quedan abiertos si falta CRON_SECRET (bajo)
- **Tipo / certeza**: riesgo / estático.
- **Evidencia**: `cron/agente-mail/route.ts:15`, `cron/bcra/route.ts:20`, `cron/presupuestos-vencimiento/route.ts:120` usan `if (cronSecret && …)`; `cron/cotizacion/route.ts:71` hace `if (!cronSecret || …)` (correcto).
- **Solución**: misma forma que `cron/cotizacion`.
- **Esfuerzo**: S.

### H15 — Migraciones no registradas y 50 sin rollback (mejora)
- **Tipo / certeza**: mejora / ejecución.
- **Evidencia**: `schema_migrations` llega a `20261008120000` (132 filas) contra 176 archivos; 50 migraciones sin archivo en `rollback/`; trigger de `20261007113000` ausente en la base.
- **Solución**: tabla propia `lz_migraciones_corridas` (insert al final de cada migración) o script de lectura que compare objetos esperados vs `pg_proc/pg_trigger`.
- **Esfuerzo**: S.

### H16 — `delete_presupuesto_safe` y `change_pr_operator` saltean rol/sociedad (bajo)
- **Tipo / certeza**: riesgo / estático.
- **Evidencia**: `delete_presupuesto_safe` solo exige `get_my_role() is not null` (incluye viewer), no mira sociedad ni estado y borra eventos, pendientes, fichas, NC viejas e ítems; la política DELETE de `presupuestos` pide admin + borrador. `change_pr_operator` no verifica `lz_es_de_sociedad(p_sociedad_id)`.
- **Solución**: agregar `lz_es_de_sociedad` y el rol que corresponda (aviso si no es borrador, sin frenar si Augusto lo prefiere).
- **Esfuerzo**: S.

---

## Bien hecho (confirmado)

- RLS activado en las 113 tablas de `public`; `rls_auto_enable` (event trigger) lo activa en tablas nuevas.
- `profiles`/`user_sociedades` protegidos por triggers: nadie se sube el rol ni se agrega sociedades.
- `api/users` y `api/invite`: verificación super_admin en servidor; bajas sin borrar (trazabilidad).
- RPC de plata nuevas (`registrar_pago_proveedor_seguro`, `registrar_cobro_*_seguro`, `liquidar_documentos_fx`, `registrar_nota_credito_*`, `anular_orden_pago_segura`, `guardar_conciliacion_compra`): chequeo de rol + sociedad, `request_key` idempotente con índice único, `search_path` fijo. Las funciones internas tienen EXECUTE revocado.
- Facturación ARCA: `authorizeFacturaRequest` (rol + membresía) y reserva fiscal con índice único por punto de venta pendiente (`fiscal_emission_attempts_unresolved_pv`); test corrido OK.
- Estado de facturas de VENTA coherente con lo cobrado: 0 discrepancias entre `facturas.estado` y `lz_cobrado_factura` (ARS y USD).
- `anon` no ve ninguna fila de `facturas` (RLS correcta) ni tiene CREATE en `public`.
- Paginación: solo `activity_log` y `catalogo_costos` superan 1000 filas; los listados grandes usan `traerTodo`.

## Conexiones con otros módulos

| Desde | Hacia | Dato | Fuente de verdad | ¿Compatible? | Nota |
|---|---|---|---|---|---|
| `/api/cotizacion-bna` (público) | Facturación USD, Presupuestos, Finanzas | cotización dólar | `cotizaciones_dolar` | No | escribible por anónimo (H1) |
| Compras / Finanzas vieja (front directo) | Saldo proveedor / Finanzas Lazza | estado de factura de compra | `facturas_compra.estado` vs `fc_compra_pagado()` | No | 3 pagadas sin pago, 1 pagada de más (H6, H7) |
| Cobros (RPC) | Facturas de venta | estado de factura | `lz_estado_factura_por_cobro` / `lz_cobrado_factura` | Sí | 0 discrepancias |
| Triggers de movimientos | Clientes / Presupuestos (límite de crédito) | saldo CC | `clientes.saldo_cuenta_corriente` vs cálculo real del front | No | 24 clientes distintos; Presupuestos usa el viejo (H10) |
| OP (RPC) | Facturas de compra | aplicado vs total | trigger `validar_saldo_aplicacion_factura_compra` vs `fc_compra_pagado` | Dudoso | el validador ignora NC (H12) |
| auth-context (front) | RLS | sociedades permitidas | `user_sociedades` | Dudoso | sin filas: front=todas, base=ninguna (H5) |
| Recepción de OC / Stock | Productos | stock | `increment_stock` | Dudoso | ejecutable por anónimo, sin sociedad (H2) |
| Mails (`email/send`) | Storage | adjuntos | URLs públicas de buckets | No | buckets públicos y listables (H8, H9) |
| Transportes | Facturas de compra / OP | número de factura | `facturas_compra` sin único | Dudoso | duplicado pagado 2 veces (H13) |
| Migraciones | Base real | objetos de esquema | `pg_proc`/`pg_trigger` | Dudoso | trigger ausente, registro cortado al 08/10 (H15) |

## No cubierto

- No se probó ninguna escritura (ni como anon ni como usuario) por regla de solo lectura: H1, H2 (escrituras), H8 (subida) son estáticos.
- No se revisó cada política de cada tabla de configuración/catálogo en detalle, ni las 176 migraciones una por una (solo la de duplicados).
- No se auditó el cuerpo completo de las RPC de plata grandes (pagos, cobros, NC) más allá de sus chequeos de permisos; eso corresponde a los agentes de Finanzas/Compras.
- No se comparó el saldo de proveedores contra la regla de Finanzas Lazza en detalle (solo la columna vieja).
- Rutas IA: no se revisó el contenido (prompts/respuestas), solo la autorización.
