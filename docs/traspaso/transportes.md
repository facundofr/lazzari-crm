# Traspaso — chat Transportes (actualizado 27/10/2026)

## Estado 29/10/2026 (V1.1.630)
- Publicado: factura de Transportes con tipo `transporte`; Liquidar → **Factura manual** solo para transportistas con el tilde **No nos factura** (Catálogo transportistas); sin subida de factura con IA (las facturas van en Compras). Migraciones corridas: `20261029120000`, `130000` (columna `no_factura`), `140000` (José Rodríguez proveedor), `150000` (borra Nuevo Plus Ultra).
- Falta: que Augusto tilde en el catálogo quién no factura. Abiertas: Speed 7/10, montos de Hero R-1070/R-1086, condición de IVA de José Rodríguez, "otro desplegable" de ¿Quién lo lleva?.

## Estado 27/10/2026 (chat retomado con la cuenta nueva)
- Se retomó el chat: se leyeron CLAUDE.md, la memoria, ESTADO y este traspaso. **No se tocó código, base ni archivos (solo este traspaso y una línea en ESTADO).** Nada para publicar ni migraciones de Transportes sin correr.
- Se le mandaron a Augusto estas 5 preguntas y **sigue sin contestar ninguna**:
  1. Viaje de Speed del 7/10 sin monto y liquidado: ¿dejarlo así o cargarle el monto? (antes de cargarlo, mostrarle qué se cambia y esperar su OK).
  2. Monto de Hero R-1070 y R-1086 (cargar cuando lo pase).
  3. Confirmar Monotributo de Mateo Perrone con su factura.
  4. José Rodríguez (Rosario): CUIT o DNI para darlo de alta como proveedor con el tilde "Transporte" (pasos para Augusto; el trigger crea el transportista).
  5. "Poneme el otro desplegable" en "¿Quién lo lleva?": ¿lo resolvió el buscador de V1.1.543?
- Archivos de este chat sin commitear: solo `docs/traspaso/transportes.md` y la entrada de Transportes en `docs/ESTADO.md` (que tiene cambios de otros chats). Van con la próxima tanda; no hace falta deploy.

## Estado 26/10/2026 (cambio de cuenta de Claude)
- **Este chat no tiene nada a medio hacer, ni código ni migraciones sin correr ni nada sin publicar.** No se tocó código ni base.
- Última tarea (solo lectura): el viaje de SPEED BUSINESS (Credifin) del 7/10 que figuraba "sin monto" y "liquidado" a la vez. Es un viaje sin remito, ligado a la factura de transporte del 10/9 por $30.997,66 (pagada); el viaje quedó con costo vacío. Las facturas pueden cubrir varios viajes, así que no se le puso monto. Se le preguntó a Augusto si se lo carga o se deja así (sin respuesta).
- Los otros viajes de Speed en octubre: 2 del 2/10 de remito (facturas pagadas $38.813,23 y $27.190,56), 2 cancelados y 2 de remito sin liquidar (20/10 y 22/10). Los de remito no aparecen en el contador.
- Pendientes de siempre: Hero R-1070 y R-1086 sin monto (esperar a Augusto), confirmar Monotributo de Mateo Perrone con su factura, José Rodríguez sin ficha.

## Objetivo del chat
Solo Transportes del CRM: transportistas, envíos y fletes (los que trabajan para Lazzari y los que cobra un proveedor en su factura),
"en camino" con días y transportista, y la carga de facturas de tipo Transporte.

## Lo que hizo ESTE chat
**Nada de código.** Se abrió y saludó a Augusto. También confirmó en el código que la E y lo de "Fletes del mes" NO están hechos: `transportes/page.tsx` tiene solo las pestañas "viajes" y "catalogo", y no hay liquidación ni reporte en ningún lado.
Coordinó con el chat Remitos. Quedó esperando que Augusto elija por cuál arrancar.
(Eso fue el 1er chat. Después se hizo la pantalla nueva: ver abajo.) Producción va por **V1.1.534** (19/10/2026).

## Lo que ya existe sobre transportes (hecho en otros chats, según `docs/ESTADO.md`)
- **Publicado V1.1.446:** "Envío interno 🔒" en el PR (flete que paga Lazzari y no se cobra al cliente). Columna `presupuestos.costo_envio_interno`
  (migración `20261014160000` CORRIDA, vuelta atrás en `supabase/rollback/`). Baja ganancia y margen; nunca va al PDF, total, IVA ni factura.
  `lib/presupuesto-margen.ts`, `lib/envio-detectar.ts` (prueba `scripts/test-envio-detectar.ts`). En `cargar-factura-oc.tsx` el renglón de envío de
  la factura del proveedor se puede repartir a los PR.
- **Publicado V1.1.492 — Remitos nueva (prueba):** pestaña "En camino" con días y semáforo (amarillo ≥3, rojo ≥10), "¿Quién lo lleva?" (transportista),
  Entregado / Parcial, foto del remito; la IA (`api/remitos/instruccion`) puede cargar transportista. Eso es del chat **Remitos**.
- **Publicado V1.1.505:** carga de factura simple: el envío se reparte por plata entre renglones; bandeja de facturas con opción de flete (chat Compras).
- **Carga de facturas de compra:** fila "Tipo": Compra / **Transporte** / Servicio-gasto / Solo IVA (`lib/factura-tipo.ts`, prueba `scripts/test-factura-tipo.ts`).
- **Retenciones:** transporte y fletes 0,25 % / mínimo $67.170, código SICORE 095 (`lib/retencion-conceptos.ts`, `lib/sicore-linea.ts`).
  Las 12 fichas de transportistas ya tienen concepto "transporte" (verificado 13/10). Retenciones solo Lazzari (Grupo LA no retiene).
- Pantalla Transportes: compacta, tabla con `pageSize` fijo.

## Cómo quedan los viajes de "¿Quién lo lleva?" (chat Remitos, V1.1.515, lógica en `lib/remito-entrega.ts`)
- Con transportista: fila en `transportes` de tipo "externo", siempre con transportista_id y remito_id, estado "solicitado", moneda ARS, destino "domicilio, localidad". Si no se sabe el costo, queda **null (nunca 0)**.
- Lo llevan ellos: tipo "interno", transportista "Propio (lo llevamos nosotros)", transportista_id null.
- Si se cambia el transportista, se corrige el mismo viaje. Si pasa a retira/no sé, el viaje queda "cancelado" (solo si estaba solicitado).
- Para llegar a la venta: `transportes.remito_id` → `remitos.presupuesto_id`. Remitos prometió avisar antes de cambiar los estados o de sumar presupuesto_id.
- Para la liquidación: excluir los viajes cancelados y los internos; los de costo null se muestran como "sin costo" para completarlos.
- Memoria de Augusto: un remito hecho cuenta como entregado. No proponer estados ni avisos de "sin entregar".

## 18/10/2026 — datos corregidos en la base (CORRIDOS, con vuelta atrás en `supabase/rollback/`)
- `20261018120000_comisionista_ingrid_martin.sql`: Julio Cernuda = **INGRID MARTIN** (ella factura, CUIT 27256231498). La ficha LZ de Ingrid tiene ahora el banco de Julio (la cuenta es de él), el mail julioarturocernuda@gmail.com, el nombre de fantasía "Julio Cernuda", rubro Transporte y es_transportista. La ficha "Julio Arturo Cernuda" queda con la nota NO USAR. El transportista "JULIO CERNUDA" tiene el CUIT y el mail de Ingrid. La FC C 00002-87 de Ingrid NO se carga (ya está pagada).
- `20261018123000_transportista_credifin_speed.sql`: el transportista "Credifin" pasa a **SPEED BUSINESS (Credifin)**, CUIT 30686978350; sus 10 viajes, renombrados.
- `20261018124500_transportista_conte_datos.sql`: el transportista CONTE queda con su razón social, CUIT 33539819149 y mail Contepergamino@gmail.com. La FC A 0039-3547 ya estaba cargada y pagada.
- `20261019150000_transportistas_desde_proveedores.sql` (CORRIDA 19/10, con OK de Augusto): **regla nueva: todo transportista se carga primero como proveedor y se tilda "Transporte"**. Un trigger (`sync_transportista_desde_proveedor`) en `proveedores` crea o activa la fila de `transportistas` (por CUIT, o por nombre si no tiene CUIT); al destildar, la deja inactiva. No pisa el nombre que ya usan. Se tildaron Cáceres, Conte, Speed, Álvarez (el transportista quedó con DNI 4693136) y la Cooperativa Sinpostre (= TRANSPORTE GUTIERREZ, mismo CUIT); Nuevo Plus Ultra entró a la lista. José Rodríguez sigue en la lista sin ficha de proveedor.
- `20261019160000_rapido_plus_ultra.sql` (CORRIDA 19/10): Nuevo Plus Ultra (CUIT 30710320531, sin uso) queda inactivo con la nota NO USAR, y su transportista también inactivo. **Rapido Plus Ultra S. A.** (CUIT 30717750701, LZ) entra a la lista de transportistas.
- Pregunta abierta de Augusto: "poneme el otro desplegable" en "¿Quién lo lleva?" (no se entendió: ¿buscador escribiendo, otro campo?). Volver a preguntar.
- **José Álvarez:** queda con DNI 4693136, no factura (se le liquida).
- `20261018130000_proveedor_mateo_perrone.sql` (CORRIDA): proveedor nuevo en Lazzari **MATEO PERRONE MUISES** ("Encomiendas Mateo"): CUIT 20452221951, Monotributo (a confirmar con su factura), alias Encomiendasmateo, caja de ahorro, Mateomuises72@gmail.com, transportista, retención por transporte. El transportista "MATEO PERRONE" quedó con ese CUIT y mail. No estaba en Grupo LA.
- **José Rodríguez (Rosario):** sin datos ni viajes.
- Precios faltantes: quedan SIN precio por decisión de Augusto (18/10): 4 viajes de Conte, 14 de Álvarez, 3 de Cáceres, 2 de Mateo.
- Comisionistas que importan hoy: Cernuda/Ingrid (Bs. As., lleva y trae), Álvarez (internos Pergamino, precio fijo por viaje), Cáceres, Mateo, Rodríguez (Rosario).

## PANTALLA SIMPLE (contador) — EN CÓDIGO 19/10, SIN PUBLICAR (reemplaza a la de V1.1.534)
Augusto (19/10): "solo quiero… tipo un contador, por transportista, marcarle la cantidad de viajes… corte mensual… monto a cada viaje… todo editable… liquidar un viaje o más".
- Mes ◀ ▶. Renglón por transportista: − viajes +, "$ a todos" (pisa los montos de los viajes del mes sin liquidar), total, Liquidar (tildados o todos los pendientes del mes; misma ventana de factura / liquidación interna).
- Clic en el nombre: viajes del mes (fecha, monto, nota editables; ✕ cancela, no borra). El − cancela el último sin liquidar. El + usa hoy (o el último día si se mira otro mes).
- **Viajes de remitos NO aparecen ni suman** (decisión de Augusto): quedan solo en Remitos. Por eso Cáceres R-1038/1078/1079/1080 (si tienen remito_id) ya no figuran en Transportes.
- **Nada toma monto solo**, salvo el + de José Álvarez: arranca con su fijo $3.000 (`20261019230000_alvarez_precio_fijo.sql`, CORRIDA, con rollback). Al liquidar ya no se rellenan montos.
- Se sacaron: anotador por día, grilla, historial con filtros, "$ fijo x viaje" editable.
- Archivos: `transportes/page.tsx`, `lib/transportes-anotador.ts`, `scripts/test-transportes-anotador.ts`. tsc 0, hooks OK. Falta verla en el navegador (pide login).

## PANTALLA ANTERIOR (anotador) — PUBLICADA en V1.1.534, reemplazada por la simple (commit d158623, 19/10/2026, verificada en producción)
Archivos: `src/app/(crm)/transportes/page.tsx` (reescrita: se fue el formulario "Nuevo viaje", el cuadro de internos y "+ Parada"; quedan el catálogo y la ventana "Enviar factura a pagos"), `src/lib/transportes-anotador.ts` + `scripts/test-transportes-anotador.ts` (OK).
Migración `20261019170000_transportistas_precio_viaje_fijo.sql` (+ rollback) **CORRIDA 19/10 con OK de Augusto.**
tsc 0 y hooks OK. Resumen de sep/oct calculado sobre datos reales (solo lectura) OK. Vista en local 19/10 sin guardar: anotador, resumen, historial y grilla OK, sin errores en consola (no se apretó + ni Enviar a pagos porque guardan). "Liquidar" sin precio dice "(sin precio)". TRANSPORTE HERO aparece en el resumen pero no está en el catálogo (nombre viejo). Remitos cambió `lib/remito-entrega.ts` (publicado también en V1.1.534): cancela o corrige el viaje siempre que no esté liquidado; si está liquidado, avisa "corregilo en Transportes".
Al liquidar: los viajes sin precio toman el fijo; el total sale con el precio fijo. Los viejos con remito_id también muestran "Remito".

### Correcciones pendientes (Augusto las va pasando; NO ejecutar hasta que diga "ejecutá")
- a. Viaje de Cáceres con fecha 2/10 (R-2026-1038, del 29/9, cargado a mano por Jerónimo el 5/10, ya pagado con FC 00002-678): pasarlo al 29/9 para que no figure en octubre.
- b. Cáceres R-2026-1078/1079/1080 (15/10, Termo Córdoba, Junín): los cargaron a mano el 15/10, 2 o 3 minutos después de los remitos, con el botón viejo de Remitos (sin usuario). Augusto dice que Cáceres no viajó en octubre: preguntar quién los llevó o si se cancelan.
- c. Regla de Augusto: nunca asignar nada solo. Pedirle a Remitos que "¿Quién lo lleva?" arranque en "Todavía no sé" (hoy propone el de la sucursal o el último del cliente).

### Plan (referencia)
Es un anotador interno, no tiene que coincidir nada. Los chicos cargan todo y ven todo (precios incluidos).
**Cambio 19/10 (decisión de Augusto): los viajes de "¿Quién lo lleva?" entran DIRECTO al historial** con leyenda "Remito R-…" (no queda el "+"/pendiente).
Si en el remito se cambia o se saca el transportista, el viaje se actualiza solo (se corrige o se cancela).
1. **Viajes del día:** fecha de hoy con flechas, y un renglón por transportista con − número +. Cada + guarda un viaje anotado. Si ya hay viaje de remito de ese transportista ese día, avisa "ya hay uno de remito" (sin trabar, para no contarlo dos veces).
2. **Historial de viajes:** remito + anotados juntos; filtros (transportista, desde/hasta, remito/anotado, liquidado sí/no). TODO editable en la tabla (fecha, transportista, precio, cliente, destino, notas). Los datos extra se ven chicos y en gris. Solo queda trabado lo liquidado y enviado a Pagos. Los viajes cancelados no se cuentan.
3. **Precio:** Álvarez con precio fijo por viaje (automático); los demás, precio por viaje editable que sugiere el último. Los que no tienen precio quedan sin precio.
4. **Resumen del mes** por transportista (viajes, total) con **"Liquidar"**: usa la ventana actual de "Enviar factura a pagos" (factura leída por la IA, o liquidación interna sin factura).
5. **Vista Lista ↔ Grilla del mes** (transportistas × días); se recuerda la última que se usó.
6. Opcional (Augusto no contestó): listita "Remitos sin transporte definido" ("Todavía no sé"), solo aviso.
7. Catálogo de transportistas igual (salen de Proveedores con el tilde "Transporte"). **Sin formulario de "Nuevo viaje".**
8. **Base, aditiva + vuelta atrás (mostrarla y esperar OK):** solo `transportistas.precio_viaje_fijo`. "De remito" = el viaje tiene remito_id (no hace falta columna nueva). No se pierde nada de lo cargado.
9. El "−" solo quita viajes anotados sin datos ni factura; los de remito se cambian desde el remito o se editan en el historial.
10. **Coordinar con Remitos** (`lib/remito-entrega.ts` es de ellos): hoy, al sacar el transportista, el viaje se cancela solo si está "solicitado". Hay que cancelarlo siempre que no esté liquidado (sin factura_compra_id); si ya está liquidado, avisar y no tocarlo.
11. Lógica pura en `lib/` con prueba.
Descartado: resumen por WhatsApp al transportista y carga por IA.

## Decisiones de Augusto (20/10/2026) — pisan las del 12/10
- "¿Quién lo lleva?" es **solo información para el remito**: no va a ningún lado (no suma a margen, fletes ni Transportes).
- El "Envío interno" del PR es **un ítem más del PR**, como cualquier otro: no hace nada diferente.
- Los transportes se llevan **solo desde el contador nuevo** de Transportes.
- Margen antes/después del flete (por venta, por cliente o total del mes): **DESCARTADO** por Augusto (20/10). Se hizo la franja del total del mes y él pidió sacarla: no quedó nada en el código.
- Hero y Victor Masson (Cruz del Sur): Augusto les tildó "Transporte" en Proveedores (20/10).
- **Migración `20261020160000_transportes_recuperar_viajes_remito.sql` (+ rollback) — CORRIDA 20/10 por Augusto y verificada (5 copias, Julio renombrado, originales de remito intactos); falta commitear en la próxima tanda:** renombra JULIO CERNUDA → "JULIO CERNUDA (Ingrid Martin)" (y sus 12 viajes) y copia al contador 5 viajes de remito (los originales no se tocan): R-1038 Cáceres $14.000 con fecha 29/9 y liquidado; R-1079 y R-1080 Cáceres $4.500 c/u; R-1070 y R-1086 Hero sin monto. R-1078 NO va (decisión de Augusto). Resuelve las correcciones a y b.

## Decisiones de Augusto (12/10/2026)
- **A — OK:** el viaje se arma desde el remito ("¿Quién lo lleva?").
- **E — OK:** liquidación del mes de cada transportista armada sola.
- **B — DESCARTADA:** salida con varias paradas. C y D no elegidas.
- Cada viaje atado a su venta (por remito o eligiéndola). Renglón "Envío/flete/traslado/entrega" del PR = flete cobrado explícito.
- ~~En la venta: margen antes y después del flete real; reporte "Fletes del mes" por cliente.~~ (DESCARTADO 20/10)
- Sin campo "flete incluido" por ahora (no hay monto fijo; el flete es proporcional y a veces va metido en los precios; algunos clientes no quieren ver "Envío").

## Pendiente / próximo paso (actualizado 20/10/2026)
Resuelto: a y b (migración 20261020160000), c (V1.1.543), Hero y Victor Masson (revisado 20/10, solo lectura: un solo transportista cada uno, con CUIT, activo, en Lazzari; Hero tiene sus 2 viajes; las fichas de Grupo LA no tienen el tilde y no hace falta).
- **Estado 22/10:** este chat no tiene nada a medio hacer ni archivos sin commitear. La migración `20261020160000` (+ rollback) y este traspaso se subieron en el commit 77ffca9 (push a main, sin deploy: no cambia código). Producción en V1.1.544; la próxima versión que se publique es 1.1.545 (revisar contra origin/main). No hay migraciones de Transportes sin correr.
- La entrada de Transportes en `docs/ESTADO.md` (20/10) sigue sin commitear junto con entradas de otros chats: va con la próxima tanda.
- Augusto preguntó qué es "Liquidado" (22/10): se le explicó (viaje ya pasado a Pagos con factura o liquidación interna; queda trabado). Ofrecido sin respuesta: mirar (solo lectura) el viaje de SPEED BUSINESS de octubre que figura "sin monto" y "liquidado" a la vez (probablemente liquidado con factura y el viaje en $0) y decirle de qué factura es.
- Captura de octubre (22/10): 35 viajes · $198.500,03. Sin monto: Julio/Ingrid 3, José Rodríguez 2, Hero 2, Pluscargo Rosario 1, Speed 1, Cargas Mayo 1.
- Hero R-1070 y R-1086 sin monto: cargarlo cuando Augusto lo pase.
- Pregunta abierta: "poneme el otro desplegable" en "¿Quién lo lleva?" (¿lo resolvió el buscador de V1.1.543?).
- José Rodríguez (Rosario): en la lista sin ficha de proveedor ni datos. Mateo Perrone: confirmar Monotributo con su factura.
- Leer `docs/ARQUITECTURA.md` antes de tocar código.

## Migraciones pendientes / errores conocidos
Todas las migraciones de Transportes están corridas y commiteadas (la última, `20261020160000`, en 77ffca9). Ningún error conocido propio.

## Prompt para seguir en un chat nuevo
```
Sos el chat de Transportes del CRM Lazzari. Leé CLAUDE.md, la memoria (MEMORY.md y sus archivos), docs/traspaso/transportes.md (sección "Pendiente") y las primeras entradas de docs/ESTADO.md. Si docs/traspaso/memoria/ existe, leé también esa memoria. La pantalla Transportes es el contador simple (V1.1.543); "¿Quién lo lleva?" es solo dato del remito. El margen antes/después del flete está DESCARTADO: no lo propongas. Nunca asignes nada solo. No toques la base ni publiques sin mi OK.
```
