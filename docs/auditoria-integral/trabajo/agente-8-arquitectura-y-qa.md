# Agente 8 — Arquitectura general y QA / regresiones

Auditoría de SOLO LECTURA, 28/10/2026. No se modificó ningún archivo del repo (salvo este). Base consultada solo con `scripts/lectura/sql.cjs` (transacción READ ONLY).

## Alcance revisado

- `docs/ARQUITECTURA.md`, `crm/app/package.json`, `next.config.ts`, `tsconfig.json` (modificado sin commitear por otro chat: agrega `.next-compras`, `.next-finanzas`, `.next-transportes`), `vercel.json`.
- Rutas `src/app/(crm)/*` (29 módulos). Pantallas duplicadas: `finanzas` / `finanzas-lazza` / `finanzas-vieja`; `ordenes-compra` / `compras-nueva` / `compras-lazza`; `presupuestos` / `presupuestos-nuevo`; `facturas`, `consulta-facturas`.
- `src/components/layout/sidebar.tsx` (líneas 65-77), `src/app/(crm)/layout.tsx`.
- Capa de datos: `src/lib/supabase/client.ts`, `database.types.ts`, `fetch-mayusculas.ts`, `lib/paginar.ts`.
- Reglas de plata duplicadas: `lib/saldo-factura-compra.ts`, `lib/finanzas-lazza.ts:476-491` y `:843`, `lib/saldo-clientes.ts:80-112`, `lib/plan-pagos.ts:65-88`, `lib/retencion-conceptos.ts`, `components/orden-pago-nueva.tsx:282-345, 510-580`, `components/plan-pagos.tsx:118-180`, `components/compras-lazza-llego.tsx:48-100`, `app/(crm)/ordenes-compra/page.tsx:1003-1050`, `components/cargar-factura-oc.tsx:228, 1300-1320, 1618-1630`, `lib/pago-tarjeta.ts`.
- QA: los 162 `scripts/test-*`, `scripts/check-hooks.mjs`, `scripts/README.md`, scripts `test:regressions` y `test:fce` de `package.json`.
- Migraciones: `supabase/migrations` (176) vs `supabase/rollback` (127).
- Tablas consultadas (SELECT): `facturas_compra`, `movimientos`, `op_facturas_compra`, `aplicaciones_fx`, `proveedores`, `sociedades`, `cuentas_financieras`, `pg_stat_user_tables`, función `fc_compra_pagado`.

## Qué se corrió (evidencia de ejecución)

| Qué | Resultado |
|---|---|
| `npx.cmd tsc --noEmit` | **0 errores** (24 s). |
| `node scripts/check-hooks.mjs` | **0 errores**, 28 warnings de `eslint-disable` sin uso; 361 archivos. |
| Los 23 scripts de `npm run test:regressions`, uno por uno | **10 pasan, 13 fallan** (detalle abajo). Como el script los encadena con `&&`, `npm run test:regressions` se corta en el 4.º (`test-extracto-csv.mjs`). |
| Los 11 scripts de `npm run test:fce`, uno por uno (todos simulan https/Supabase; ninguno llama a ARCA) | **10 pasan, 1 falla** (`test-sociedad-pdf.cjs`). |
| 8 tests puros nuevos con `npx.cmd tsx` (saldo-factura-compra, saldo-clientes, saldo-proveedores, finanzas-lazza, compras-lazza, facturas-lazza, op-parcial, retencion-conceptos) | **8/8 pasan**. |

Fallan en `test:regressions`:
`test-extracto-csv.mjs`, `test-op-validation.mjs`, `test-op-money-rounding.mjs`, `test-direct-payment.mjs`, `test-op-echeqs.mjs`, `test-presupuesto-post-create.mjs`, `test-presupuesto-exact-price.mjs`, `test-fc-edit-guards.cjs`, `test-own-stock-purchase-orders.mjs` (`Cannot find module './proveedor-nombre'`), `test-latest-operational-fixes.mjs`, `test-financial-ledger-ui.mjs`, `test-transport-invoice-upload.mjs`, `test-provider-bank-payment-terms.mjs` (`No se encontró sumarDiasISO`).

Causa principal: 12 tests leen como texto `src/app/(crm)/finanzas/page.tsx` y buscan con regex funciones como `handleRegistrarPagoParcialDirecto`. El commit `99d0967` (23/10, "mudanza") movió las 6.600 líneas de la vieja Finanzas a `finanzas-vieja/page.tsx` y dejó en `finanzas/page.tsx` la nueva (156 líneas). Los tests siguen apuntando a la ruta vieja. Otros fallan porque el código cambió de forma (presupuestos, transportes) y el test de texto ya no encuentra la frase exacta.

---

## Módulo A — Organización de carpetas y pantallas (viejas vs nuevas)

1. **Función:** dar las pantallas del CRM. Hay 29 carpetas en `app/(crm)`; varias son versiones paralelas del mismo proceso.
2. **Recibe:** sesión (`useUser()`: perfil, rol, `sociedadActiva`), parámetros de URL (`?tab=`, `?seccion=`, `?factura=`).
3. **De dónde:** `UserProvider` en `app/(crm)/layout.tsx`; links internos y de la campana (`lib/finanzas-destino.ts`).
4. **Operaciones:** cada página lee con el cliente de Supabase del navegador y escribe directo a tablas o por RPC.
5. **Modifica:** según pantalla. Escrituras directas contadas: `finanzas-vieja` 42 + 13 RPC; `ordenes-compra` 44 + 8 RPC; `compras-nueva` 15 + 0 RPC; `cargar-factura-oc.tsx` 26 + 3 RPC.
6. **Dónde guarda:** Postgres de Supabase (mismas tablas para la pantalla vieja y la nueva).
7. **Quién depende:** usuarios; los tests de texto de `scripts/` dependen de rutas de archivo concretas.
8. **Depende de:** `sidebar.tsx` para ocultar (`oculto: true` en líneas 65 y 67), `finanzas-destino.ts` para traducir links viejos.
9. **Errores posibles:** el mismo proceso hecho desde la pantalla vieja (oculta pero accesible por link) sigue otra regla (ver H3); un arreglo hecho en la nueva no llega a la vieja.
10. **Si falla una operación:** depende de la pantalla; las viejas tienen secuencias sin transacción (ver H5).
11. **Si otro módulo cambia sus datos:** al compartir tablas, lo que escribe la vieja lo lee la nueva con otra regla (ej. estado de OC sin mover stock / con stock).
12. **Pruebas:** casi todas las de pantallas son de texto (regex sobre el código fuente), y apuntan a archivos que ya cambiaron (ver H1).
13. **Problemas reales:** 3 pantallas de Compras y 2 de Finanzas activas en producción en paralelo. `finanzas-vieja` sigue en uso real (extractos, Revisar, Correo: `lib/finanzas-destino.ts:2`; `cobro-masivo-liquidacion.tsx:491` manda a `/finanzas-vieja?tab=revisar`).
14. **Riesgos:** archivos enormes que no se pueden revisar enteros: `finanzas-vieja/page.tsx` 6.615 líneas (443 KB), `presupuestos-lista.tsx` 4.870 (293 KB, además modificado sin commitear por otro chat), `ordenes-compra/page.tsx` 4.031, `clientes/page.tsx` 3.062, `facturacion-content.tsx` 2.656, `cargar-factura-oc.tsx` 2.487. El control de acceso por rol está repetido a mano en cada página y difiere: `finanzas/page.tsx:81` permite super_admin y administrativo; `finanzas-vieja/page.tsx:3246` deja pasar también `admin`; `compras-lazza/page.tsx` no chequea rol. Ocultar en el menú no impide entrar por URL.
15. **Confiabilidad: media.** Las pantallas nuevas están mejor armadas (lógica en lib, RPC), pero conviven con las viejas que escriben las mismas tablas con otras reglas.

## Módulo B — Capa de datos y tipos (cliente Supabase, tipos generados, `as any`)

1. **Función:** acceso a la base desde el navegador y el servidor.
2. **Recibe:** consultas de todas las pantallas.
3. **De dónde:** `lib/supabase/client.ts` (`createBrowserClient<Database>` con `fetchConMayusculas`), `lib/supabase/server.ts`.
4. **Operaciones:** select/insert/update/rpc; el `fetch` envuelto cambia mayúsculas al leer y al guardar en 7 tablas (`fetch-mayusculas.ts:11-13`).
5. **Modifica:** el texto de `razon_social`, `nombre_fantasia`, `descripcion`, etc. en la respuesta (todas las tablas que lo traigan) y en lo que se guarda en `clientes, proveedores, contactos, presupuesto_items, orden_compra_items, remito_items, muestra_envio_items`.
6. **Dónde guarda:** Postgres.
7. **Quién depende:** todo el front.
8. **Depende de:** `database.types.ts` (último cambio 08/10/2026, commit `0d425f8`).
9. **Errores posibles:** columnas o tablas mal escritas que TypeScript no detecta porque el cliente está casteado a `any`.
10. **Si falla:** cada pantalla maneja su `{ error }`; hay lugares que lo ignoran (ej. `compras-lazza-llego.tsx:62`).
11. **Si otro módulo cambia datos:** una columna renombrada en una migración no rompe `tsc` en ningún archivo que use `as any`.
12. **Pruebas:** `test-mayusculas.ts`, `test-texto-mayusculas.ts` (lib). No hay prueba de tipos contra el esquema real.
13. **Problemas reales:** `database.types.ts` tiene 34 tablas; las migraciones crean al menos 61 tablas que no figuran (ej. `recibos`, `pagos_lotes`, `certificados_retencion`, `cuentas_financieras`, `op_notas_credito_compra`, `saldos_favor_proveedor`). Incluso `proveedores` en los tipos no tiene `sociedad_id` (por eso hay 77 `"sociedad_id" as any`). Resultado: **550 `supabase as any`** en 109 archivos, 158 alias `db = supabase as any` en 84 archivos y ~1.800 `any` en total. El `tsc` con 0 errores no protege las consultas.
14. **Riesgos:** un error de nombre de columna en una consulta solo se ve en producción. El `fetch` que cambia mayúsculas sólo corre en el navegador: el servidor (rutas API, crons) lee los nombres sin transformar, así que comparar un nombre leído en el cliente con uno leído en el servidor puede dar distinto (hipótesis, no se encontró un caso concreto).
15. **Confiabilidad: media-baja** en cuanto a detección automática de errores; el patrón está documentado y se usa de forma consistente.

## Módulo C — Lógica de negocio: lib vs componentes (reglas duplicadas)

1. **Función:** cálculos de plata (saldos, retenciones, estados).
2. **Recibe:** filas de facturas, OP, movimientos, configuración de retenciones.
3. **De dónde:** consultas de cada pantalla.
4. **Operaciones:** funciones puras en `src/lib` (168 archivos; 143 con al menos un test) y, en algunos casos, el mismo cálculo escrito inline en el componente.
5. **Modifica:** nada (cálculo); el resultado se manda a RPC o se muestra.
6. **Dónde guarda:** lo que se guarda lo deciden las RPC (`registrar_pago_proveedor_seguro`, etc.).
7. **Quién depende:** Finanzas, OP nueva, Plan de pagos, Compras Lazza, Proveedores.
8. **Depende de:** que todas las pantallas usen la misma función.
9. **Errores posibles:** la misma factura muestra saldos distintos según pantalla.
10. **Si falla:** n/a (cálculo).
11. **Si otro módulo cambia datos:** una forma nueva de cancelar deuda (ej. FX, tarjeta, NC con `total_acreditado`) hay que agregarla en 4-5 lugares.
12. **Pruebas:** buenas en lib (`test-saldo-*`, `test-finanzas-lazza.ts`, `test-retencion-conceptos.ts` pasan). Los componentes que tienen la copia inline (`orden-pago-nueva.tsx`, `plan-pagos.tsx`) no tienen prueba.
13. **Problemas reales:** ver H2 (saldo de factura de compra con 5 implementaciones) y H4 (retención en OP vs plan de pagos).
14. **Riesgos:** divergencias silenciosas al agregar un caso nuevo.
15. **Confiabilidad: media.** La dirección es correcta (lib + tests), pero las copias inline siguen siendo la fuente que usan las pantallas de pago.

## Módulo D — Suite de pruebas (`scripts/test-*`)

1. **Función:** detectar regresiones.
2. **Recibe:** el código fuente (como texto o importando de `src/lib`).
3. **De dónde:** `scripts/`; se corren a mano con `node` / `npx tsx`.
4. **Operaciones:** 162 scripts. 153 importan de `src/lib` (prueban funciones puras: tipo útil). 55 usan `readFileSync` para leer código fuente/migraciones y verificar con regex que "el handler llama a tal RPC" (tipo frágil).
5. **Modifica:** nada (todos los revisados son puros o simulan red/DB).
6. **Dónde guarda:** nada.
7. **Quién depende:** el proceso de publicar (en teoría).
8. **Depende de:** rutas y textos exactos del código.
9. **Errores posibles:** falsos rojos (fallan porque se movió un archivo) y falsos verdes (pasan aunque la lógica esté mal porque solo buscan una frase).
10. **Si falla:** nadie se entera: **ningún test corre en el build ni en CI** (`build` = `check:hooks` + `next build`; no hay `.github/`). `scripts/README.md` dice "Ejecutar `npm run test:regressions`, luego `npm run build`" pero la publicación de `CLAUDE.md` solo exige `tsc`.
11. **Si otro módulo cambia:** el test de texto se rompe aunque el comportamiento esté bien, o sigue verde aunque se rompa el comportamiento.
12. **Pruebas existentes:** ver tabla de ejecución arriba.
13. **Problemas reales:** H1 (13/23 de regresiones y 1/11 de FCE en rojo; `test:regressions` como comando no sirve hoy). Componentes críticos sin ninguna prueba: `orden-pago-nueva.tsx` (es hoy la pantalla de OP), `compras-lazza-factura.tsx`, `compras-lazza-llego.tsx`, `remito-ventana.tsx`, `presupuestos-lista.tsx`, `conciliacion-compras.tsx`. Libs sin test: `oportunidades`, `bcra`, `purchase-matching-ai`, `recibo-numero`, `paginar`, `invoice-number-parser`, `conciliacion-compras-analisis`, entre 25.
14. **Riesgos:** las RPC de plata (SQL) solo se "prueban" buscando texto en el archivo de migración; nunca se ejecutan contra una base de prueba.
15. **Confiabilidad: media** para la lógica pura de lib (buena cobertura, pasa); **baja** para el comando de regresiones y para los flujos completos de pantalla + RPC.

## Módulo E — Controles antes de publicar (tsc, check-hooks, build)

1. **Función:** frenar una publicación rota.
2. **Recibe:** el código.
3. **De dónde:** `npm run build` en Vercel y `npx tsc --noEmit` a mano.
4. **Operaciones:** `check-hooks.mjs` (solo la regla `rules-of-hooks`), `next build` (con type check; `eslint.ignoreDuringBuilds: true`).
5-6. **Modifica / guarda:** nada.
7. **Quién depende:** todo despliegue.
8. **Depende de:** tipos (ver Módulo B).
9. **Errores posibles:** pasa con errores de columnas, reglas o RPC.
10. **Si falla:** frena el deploy (bien).
11. n/a.
12. Ambos corridos: 0 errores.
13. **Problemas:** no incluye ningún test de comportamiento.
14. **Riesgos:** sensación de seguridad ("tsc 0 errores") mayor a la real.
15. **Confiabilidad: alta** en lo que mide, **baja** en lo que deja afuera.

## Módulo F — Migraciones y rollback

1. **Función:** cambios de esquema y RPC.
2-3. Archivos SQL en `crm/app/supabase/migrations`, corridos a mano por Augusto.
4-6. DDL y funciones en Postgres.
7. Todas las RPC de plata.
8. Orden manual de ejecución.
9. Una migración corrida a medias o no corrida (no hay tabla de control de versiones del esquema propia; se confía en la memoria).
10. Rollback manual.
11. Las pantallas tienen "respaldo" si falta la función (`pago-tarjeta.ts:43-49`, `traerTarjetas`): si la RPC no existe hace la operación directa, sin transacción.
12. Tests de texto sobre SQL (`test-fx-settlements-sql.cjs`, `test-fiscal-emission-sql.cjs`).
13. 50 migraciones sin script de vuelta atrás, todas anteriores al 10/10/2026 (época Manu); desde el 10/10 todas tienen rollback (bien).
14. El código con "si no existe la función, hacelo directo" mantiene vivos caminos sin transacción.
15. **Confiabilidad: media-alta** desde octubre.

---

## Hallazgos detallados

### H1. Las pruebas de regresión están rotas y no corren solas (ejecución)
- **Síntoma:** `npm run test:regressions` falla en el 4.º script; corriendo uno por uno, 13 de 23 fallan. `test:fce` también falla (`test-sociedad-pdf.cjs`: espera `@/lib/utils` y ahora se importa `./observaciones-cliente`).
- **Causa raíz:** son tests que leen el código como texto y buscan frases exactas; la mudanza de Finanzas (commit `99d0967`, 23/10) movió el código a `finanzas-vieja/page.tsx` y 12 tests siguen leyendo `finanzas/page.tsx`. Ningún test corre en el build ni en CI, así que nadie lo notó.
- **Consecuencia:** hoy no hay red de seguridad para OP, pago directo, e-cheqs, redondeo, NC de compra, extractos: un cambio que rompa esas reglas se publica sin aviso. Y la OP real ahora está en `components/orden-pago-nueva.tsx`, que no tiene ningún test.
- **Solución estructural:** (1) separar los tests en "puros de lib" (rápidos, estables) y descartar o reescribir los de texto; (2) un solo comando `npm run test:lib` que corra todos los `test-*.ts` puros; (3) meterlo en `build` (antes de `next build`) para que un rojo frene el deploy; (4) reapuntar o borrar los 13 tests rotos (decidir caso por caso con Augusto).
- **Esfuerzo:** M.

### H2. El saldo de una factura de compra se calcula en 5 lugares con reglas distintas (estático + datos)
- **Evidencia:**
  - `lib/saldo-factura-compra.ts:23-30` (`saldoFacturaCompra`): total − (OP + directos + max(total_acreditado, NC movs)). No mira `estado`. **Solo la usa su test** (ningún componente la importa; `cargar-factura-oc.tsx:14` importa solo `duplicadosComprobanteCompra`).
  - `lib/finanzas-lazza.ts:482-491` (otro `saldoFacturaCompra`, mismo nombre, otra firma): devuelve 0 si `estado === "pagada"`; separa NC de directos.
  - SQL `fc_compra_pagado(p_factura_id, p_sociedad_id)` (migraciones `20261011120000`, `20261026190000`): no mira `estado`.
  - `components/orden-pago-nueva.tsx:294-318`: total − (OP + todos los movimientos `pago`, incluidos los de NC); **ignora `total_acreditado`**; filtra facturas por `estado in (pendiente, recibida)`.
  - `components/plan-pagos.tsx:133-176`: igual que la OP (ignora `total_acreditado`).
- **Datos (SELECT):** hoy no hay ninguna factura con `total_acreditado` mayor que sus movimientos de NC (0 casos), así que la diferencia OP/plan vs Finanzas no se ve todavía. Sí hay 3 facturas de Grupo LA en `estado='pagada'` con 0 pagado en cualquier tabla (`00002-00000145` USD 1.100, `00002-00000140` USD 550, `0001-00000415` $ 500.000); la nota explica que se marcaron a mano el 18/10 ("en Grupo LA se pagó todo"). Finanzas las muestra en 0 (mira `estado`), `fc_compra_pagado` las cuenta como deuda pendiente.
- **Consecuencia:** el día que una NC quede solo en `total_acreditado` (o se agregue otra forma de cancelar), la OP y el Plan de pagos ofrecerán pagar más de lo que Finanzas dice que se debe. `estado` y saldo calculado son dos fuentes de verdad.
- **Solución:** una sola función de lib (la de `saldo-factura-compra.ts`, que ya tiene test y copia la regla SQL), usada por Finanzas, OP nueva y Plan de pagos; definir explícitamente si `estado='pagada'` manda o no, y alinear `fc_compra_pagado` con eso. Renombrar para no tener dos `saldoFacturaCompra`.
- **Esfuerzo:** M.

### H3. Recepción de OC: la pantalla vieja mueve stock, la nueva no (estático)
- **Evidencia:** `ordenes-compra/page.tsx:1014-1028` actualiza `cantidad_recibida` y llama `rpc("increment_stock")` por renglón; `compras-lazza-llego.tsx:48-100` y `compras-nueva` (encabezado: "No mueve stock") solo actualizan `cantidad_recibida` y `estado`. Estados calculados con código propio en la vieja (`:1039-1043`, no vuelve a "enviada") y con `lib/compras-recepcion.ts:55 estadoPorRecibido` en la nueva.
- **Consecuencia:** si alguien entra a `/ordenes-compra` por link (sigue accesible), el stock se mueve; desde Compras Lazza no. Stock inconsistente según la puerta. (Augusto pidió no tocar stock sin aviso: no se propone cambiarlo, solo cerrar la puerta vieja.)
- **Solución:** que las rutas ocultas sean de solo lectura o redirijan, y que la recepción tenga una única RPC.
- **Esfuerzo:** S (bloquear) / M (RPC única).

### H4. Retención de Ganancias: OP y Plan de pagos con dos implementaciones (estático)
- **Evidencia:** `lib/plan-pagos.ts:65-88 calcularRetencionGanancias` (usa `retencionEscala` exacta para honorarios) vs `components/orden-pago-nueva.tsx:510-580` (inline; usa `pctRetencion`, que para honorarios redondea la alícuota efectiva a 2 decimales en `lib/retencion-conceptos.ts:66`, y la multiplica).
- **Consecuencia:** para honorarios, la retención del Plan de pagos y la de la OP pueden diferir unos pesos; cualquier cambio normativo hay que hacerlo en dos lugares. Hoy comparten `reglaPorConcepto`/`pctRetencion`, lo cual limita la divergencia.
- **Solución:** que la OP llame a `calcularRetencionGanancias`.
- **Esfuerzo:** S.

### H5. Operaciones de varios pasos sin transacción en pantallas activas (estático)
- **Evidencia:**
  - `compras-lazza-llego.tsx:55-62` (Corregir): actualiza renglones uno por uno sin deshacer si falla uno; el cambio de estado de la OC (línea 62) no revisa el error. `guardar()` (:79-85) sí deshace a mano, pero los valores se calculan con la lista leída al abrir (`c.despues`): dos personas/pestañas (o la IA de remitos de `compras-nueva`) pueden pisarse.
  - `cargar-factura-oc.tsx:1315` inserta la factura como `"pagada"` cuando se eligió tarjeta y **después** registra el pago (`:1623-1629`); si falla, queda pagada sin movimiento (avisa). Si la tarjeta elegida no está en la lista cargada (`tarjetaElegida` undefined) queda pagada sin movimiento **y sin aviso**.
  - `lib/pago-tarjeta.ts:43-49`: si la RPC no existe, pone `pagada` y después inserta el movimiento por separado.
  - `scripts/README.md` "Bloqueantes" 3 y 4 ya reconocen que OP + reserva de cheques y el guardado de factura de compra no son una transacción.
- **Consecuencia:** facturas/OC en estados a medias que nadie ve.
- **Solución:** mover estas secuencias a RPC atómicas (como ya se hizo con cobros, OP y `guardar_conciliacion_compra`); quitar los "respaldos" directos cuando la RPC ya está corrida en producción.
- **Esfuerzo:** M.

### H6. Tipos generados desactualizados → `as any` masivo (estático)
- **Evidencia:** ver Módulo B (34 tablas en tipos vs ≥61 faltantes; 550 `supabase as any`).
- **Consecuencia:** `tsc` en 0 no garantiza que las consultas sean válidas; un nombre de columna mal escrito llega a producción.
- **Solución:** regenerar `database.types.ts` (`supabase gen types`), sacar los `as any` de a módulo, empezando por plata (OP, cobros, facturas de compra).
- **Esfuerzo:** M (regenerar S; limpiar L).

### H7. Archivos gigantes y pantallas duplicadas vivas (estático)
- **Evidencia:** Módulo A punto 14. `finanzas-vieja` sigue siendo necesaria para extractos/Revisar/Correo.
- **Consecuencia:** cada arreglo en la nueva puede faltar en la vieja; los archivos no entran en una lectura de la IA y se editan "a ciegas" por partes.
- **Solución:** terminar la mudanza de lo que falta (extractos, Revisar, Correo) a componentes chicos; después dejar las viejas en solo lectura o redirigir.
- **Esfuerzo:** L.

### H8. Control de acceso por pantalla repetido y distinto (estático)
- **Evidencia:** `finanzas/page.tsx:81`, `finanzas-vieja/page.tsx:3246`, `ordenes-compra/page.tsx:254`, `compras-lazza/page.tsx` sin chequeo; el menú (`sidebar.tsx`) solo oculta.
- **Consecuencia:** reglas de quién ve qué distintas para el mismo dato; la seguridad real queda en RLS (no auditada aquí).
- **Solución:** una tabla de permisos por ruta en un solo lugar (`lib/types.ts ROLE_PERMISSIONS` ya existe) aplicada en el layout.
- **Esfuerzo:** S-M.

### H9. Migraciones viejas sin rollback (estático)
- 50 de 176, todas anteriores al 10/10/2026. Desde entonces se cumple la regla. **Mejora**, esfuerzo S (documentar), no urgente.

---

## Por qué un cambio en una parte rompe otra sin que nadie se entere (resumen con evidencia)

1. **Misma regla copiada:** saldo de factura de compra (H2), retención (H4), recepción (H3). Se arregla una copia y la otra sigue igual.
2. **Tipos ciegos:** con `supabase as any` (H6), renombrar una columna o cambiar una RPC no da error de compilación en ningún lado.
3. **Tests de texto:** 55 tests verifican que el código "diga" cierta frase. Mover un archivo (mudanza 23/10) los rompió a todos; cambiar la lógica sin cambiar la frase los deja en verde.
4. **Nada corre los tests:** ni el build ni ningún CI. El rojo existe desde el 23/10 y nadie lo vio.
5. **Pantallas viejas accesibles:** escriben las mismas tablas con otra regla.

## Estrategia de pruebas realista (dueño no programador + IA)

1. **Un único semáforo:** `npm run test:lib` que corre solo los `test-*.ts` puros (hoy ~100, pasan y tardan segundos) y se agrega al `build`. Si está rojo, Vercel no publica. Augusto no tiene que hacer nada distinto.
2. **Regla para la IA:** toda regla de plata nueva o modificada va en `src/lib` con su test; en el componente solo se llama. Prohibido copiar fórmulas en componentes (agregarlo a `CLAUDE.md`).
3. **Reparar o jubilar los 14 tests rotos:** los que verifican pantallas viejas, reemplazarlos por tests de la función de lib equivalente.
4. **"Casos de oro" de plata:** 10-15 casos reales anonimizados (una factura con NC, una OP parcial con retención, un cobro en USD) en un archivo JSON y un test que compruebe que *todas* las funciones de saldo dan lo mismo para cada caso. Así se detecta H2 automáticamente.
5. **Chequeo diario de consistencia (solo lectura):** una consulta SELECT que compare `estado` vs saldo calculado de facturas de compra/venta y mande al `pendientes` las diferencias (ej. las 3 de Grupo LA). Es detección, no bloqueo (regla 1 de Augusto).
6. **Regenerar tipos** después de cada migración (un comando, lo corre la IA).
7. **Prueba manual guiada sin guardar** solo para lo que no se puede automatizar (ARCA), con checklist corto.

## Conexiones con otros módulos

| Desde | Hacia | Dato | Fuente de verdad | Compatible | Nota |
|---|---|---|---|---|---|
| Finanzas (nueva) `lib/finanzas-lazza.ts:482` | OP nueva `orden-pago-nueva.tsx:317` | saldo factura de compra | `fc_compra_pagado` (SQL) / ninguna única | dudoso | Ignoran `total_acreditado` en OP; hoy 0 casos afectados |
| Finanzas (nueva) | Plan de pagos `plan-pagos.tsx:176` | saldo factura de compra | idem | dudoso | idem |
| `facturas_compra.estado` | `fc_compra_pagado` | factura pagada | dos fuentes | no | 3 facturas Grupo LA pagadas sin rastro de pago |
| Plan de pagos `lib/plan-pagos.ts:65` | OP nueva `:510-580` | retención Ganancias | lib vs inline | dudoso | honorarios con redondeo distinto |
| Compras vieja `ordenes-compra:1014` | Compras Lazza `compras-lazza-llego.tsx` | recepción / stock | `orden_compra_items.cantidad_recibida` | no | la vieja mueve stock, la nueva no |
| `saldo-clientes.saldoFacturaVenta` | `finanzas-lazza.facturasACobrar:843` | saldo factura de venta | lib | sí | misma fórmula copiada (riesgo de divergir futuro) |
| Tests `scripts/test-*` | `finanzas/page.tsx` | handlers de OP/pago | archivo movido | no | 12 tests apuntan al archivo equivocado |
| `database.types.ts` | todo el front | esquema | migraciones | no | 61+ tablas faltantes |

## Bien hecho

- `tsc` y `check-hooks` en 0 errores; el build los exige.
- Cobertura alta de funciones puras: 143 de 168 archivos de `src/lib` tienen al menos un test; los 8 corridos pasan.
- Plata crítica ya en RPC atómicas con `request_key` idempotente (cobros, OP, anulaciones, NC, conciliación de compra).
- `traerTodo()` para el límite de 1000 filas, usado en 45 archivos; volúmenes actuales chicos (mayor tabla operativa `presupuesto_items` ≈ 957; proveedores 834 entre las dos sociedades) y las consultas de proveedores revisadas filtran por `sociedad_id`.
- Desde el 10/10/2026 toda migración trae su rollback.
- Las pruebas fiscales (`test:fce`) simulan https/Supabase y no tocan ARCA.
- `lib/finanzas-destino.ts` traduce los links viejos de forma pura y probada.
- Comentarios con fecha y motivo de cada decisión de Augusto en los encabezados.

## No cubierto

- RLS y seguridad de las RPC (otro agente).
- Corrida de los ~140 tests restantes (solo se corrieron 42).
- Rutas API de servidor y crons en detalle.
- Revisión línea por línea de `finanzas-vieja`, `presupuestos-lista`, `clientes`.
- Rendimiento real en navegador (no se levantó servidor).
