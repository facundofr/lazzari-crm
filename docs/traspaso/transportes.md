# Traspaso — chat Transportes (18/10/2026)

## Objetivo del chat
Solo Transportes del CRM: transportistas, envíos y fletes (los que trabajan para Lazzari y los que cobra un proveedor en su factura),
"en camino" con días y transportista, y la carga de facturas de tipo Transporte.

## Lo que hizo ESTE chat
**Nada de código.** Se abrió y saludó a Augusto. También confirmó en el código que la E y lo de "Fletes del mes" NO están hechos: `transportes/page.tsx` tiene solo las pestañas "viajes" y "catalogo", y no hay liquidación ni reporte en ningún lado.
Coordinó con el chat Remitos. Quedó esperando que Augusto elija por cuál arrancar.
No tocó archivos ni migraciones, y no deja nada sin publicar. Producción va por V1.1.517.

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

## PANTALLA NUEVA — EN CÓDIGO 19/10, SIN PUBLICAR (Augusto avisa cuándo publicar)
Archivos: `src/app/(crm)/transportes/page.tsx` (reescrita: se fue el formulario "Nuevo viaje", el cuadro de internos y "+ Parada"; quedan el catálogo y la ventana "Enviar factura a pagos"), `src/lib/transportes-anotador.ts` + `scripts/test-transportes-anotador.ts` (OK).
Migración `20261019170000_transportistas_precio_viaje_fijo.sql` (+ rollback) **CORRIDA 19/10 con OK de Augusto.**
tsc 0 y hooks OK. Resumen de sep/oct calculado sobre datos reales (solo lectura) OK. Vista en local 19/10 sin guardar: anotador, resumen, historial y grilla OK, sin errores en consola (no se apretó + ni Enviar a pagos porque guardan). "Liquidar" sin precio dice "(sin precio)". TRANSPORTE HERO aparece en el resumen pero no está en el catálogo (nombre viejo). Remitos YA cambió `lib/remito-entrega.ts` (19/10, sin publicar, va en su tanda): cancela o corrige el viaje siempre que no esté liquidado; si está liquidado, avisa "corregilo en Transportes".
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

## Decisiones de Augusto (12/10/2026)
- **A — OK:** el viaje se arma desde el remito ("¿Quién lo lleva?").
- **E — OK:** liquidación del mes de cada transportista armada sola.
- **B — DESCARTADA:** salida con varias paradas. C y D no elegidas.
- Cada viaje atado a su venta (por remito o eligiéndola). Renglón "Envío/flete/traslado/entrega" del PR = flete cobrado explícito.
- En la venta: margen antes y después del flete real; reporte **"Fletes del mes" por cliente**.
- Sin campo "flete incluido" por ahora (no hay monto fijo; el flete es proporcional y a veces va metido en los precios; algunos clientes no quieren ver "Envío").

## Pendiente / próximo paso
- Augusto tiene que elegir por cuál arrancar (todavía no contestó). Antes de codear, pasarle el plan y esperar su OK.
- Candidatos ya acordados y no hechos (confirmar antes en el código si no se hicieron en otro chat):
  1. **E** — liquidación del mes por transportista armada sola.
  2. Margen antes/después del flete real por venta + reporte "Fletes del mes" por cliente.
- Leer `docs/ARQUITECTURA.md` antes de tocar código.

## Migraciones pendientes / errores conocidos
Ninguna de este chat. Ningún error conocido propio.

## Prompt para seguir en un chat nuevo
```
Sos el chat de Transportes. Leé CLAUDE.md, docs/traspaso/transportes.md y docs/ARQUITECTURA.md. Está el "PLAN APROBADO EN IDEA" para rearmar la pantalla Transportes (anotador de viajes por día y transportista, historial editable, viajes de remitos con "+", resumen del mes con Liquidar, vista Lista/Grilla). Preguntale a Augusto si arrancamos. Antes de correr la migración, mostrásela y esperá su OK. Probá en local sin guardar y no publiques hasta que lo pida. Pendiente aparte: cargar a Mateo Perrone como proveedor (datos en el traspaso) con su OK.
```
