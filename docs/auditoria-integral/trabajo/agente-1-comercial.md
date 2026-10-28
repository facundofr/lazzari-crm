# Auditoría integral — Agente 1: Comercial

Fecha: 28/10/2026. Auditoría de **solo lectura** (no se tocó código ni base; solo SELECT en transacción READ ONLY con `scripts/lectura/sql.cjs`).
Ojo: `components/presupuestos/presupuestos-lista.tsx` tiene cambios sin commitear de otro chat; se auditó la copia de trabajo.

## Alcance revisado

**Pantallas**: `app/(crm)/presupuestos/page.tsx` (Armar presupuesto con IA + pestaña lista), `presupuestos-nuevo/page.tsx` (solo redirige), `clientes/page.tsx` (3062 líneas, por rangos), `ventas/page.tsx`, `oportunidades/page.tsx`, `muestras/page.tsx`, `personalizacion/page.tsx`, `pendientes/page.tsx`, `calendario/page.tsx`, `dashboard/page.tsx`.

**Componentes**: `components/presupuestos/presupuestos-lista.tsx` (4870 líneas, por rangos: carga, crear/editar, estados, OC, borrar/restaurar/duplicar), `seguimiento-ia.tsx`, `cotizacion-express.tsx`, `catalogo-picker.tsx`, `oc-cliente-bloque.tsx` (escrituras), `components/clientes/ficha-360.tsx`, `bcra-card.tsx` (uso), `components/ventas/fichas-relevamiento.tsx` (escrituras).

**Lib**: `ventas-etapas.ts`, `ventas-documentos.ts`, `resto-facturar.ts`, `saldo-clientes.ts`, `oportunidades.ts`, `presupuesto-margen.ts`, `presupuesto-ia.ts` (margen), `dolar-presupuesto.ts`, `bcra-server.ts`.

**Server**: `api/cron/presupuestos-vencimiento/route.ts`, `api/cron/bcra/route.ts`.

**Base (definiciones leídas en vivo)**: RPC `crear_presupuesto_atomico`, `actualizar_presupuesto_atomico`, `delete_presupuesto_safe`, `change_pr_operator`, `generate_document_number`, `get_dashboard_kpis` (2 sobrecargas); triggers `calcular_totales_presupuesto_item`, `recalcular_presupuesto`, `presupuesto_estado_alert`, `presupuesto_auto_numero`, `recalcular_oc` → `lz_recalcular_totales_oc`; FKs hacia `presupuestos` y `presupuesto_items`. Tablas: presupuestos, presupuesto_items, ordenes_compra, orden_compra_items, facturas, remitos, remito_items, alertas, muestra_envios(+items), personalizacion_*, clientes, eventos, presupuesto_restos_facturar.

**Pruebas corridas** (puras, leídas antes): test-ventas-etapas, test-ventas-documentos, test-resto-facturar, test-saldo-clientes, test-presupuesto-ia, test-presupuesto-margen, test-dolar-presupuesto, test-pendientes, test-presupuesto-seguimiento, test-presupuesto-ayudas, test-muestras-delivery → **todas OK**. test-presupuesto-exact-price.mjs y test-presupuesto-post-create.mjs → **FALLAN** (buscan código en `presupuestos/page.tsx`, que se mudó a `presupuestos-lista.tsx`). Script propio en scratchpad que llama `margenPR` y `margenSobreCosto` (puras).

Datos de referencia (28/10): 243 PR (234 Lazzari, 9 Grupo LA; 51 eliminados), 957 renglones de PR; estados vivos: facturado 119, pendiente 37, rechazado 25, vencido 7, aprobado 2, solicitud 1. Crecimiento ~100–140 PR/mes.

---

## Módulo 1 — Presupuestos (lista + crear/editar + estados) — `presupuestos-lista.tsx`

1. **Función**: lista de PR de la sociedad, alta/edición, cambio de estado, aprobar (genera OC), duplicar, borrar lógico/restaurar/borrar permanente, PDF/mail/WhatsApp, margen.
2. **Recibe**: cliente, vendedor, renglones (costo, moneda de costo, markup, descuento, IVA, proveedor, stock propio), moneda/TC, modalidad (A/B/manual).
3. **De dónde**: formulario, lista de costos (`catalogo_costos` vía catalogo-picker), `lista_precios_items`, dólar guardado (BNA).
4. **Operaciones**: RPC `crear_presupuesto_atomico` / `actualizar_presupuesto_atomico` (atómicas); `update presupuestos.estado`; generación de OC en el navegador (`generateOCsFromPresupuesto`, línea 1909); sincronización de OC al editar (`syncOCsFromPR`, 1811).
5. **Modifica**: presupuestos, presupuesto_items, ordenes_compra, orden_compra_items, notificaciones.
6. **Guarda**: Postgres (Supabase); totales recalculados por triggers.
7. **Dependen**: Ventas, Facturación (facturas.presupuesto_id), Remitos (remito_items.presupuesto_item_id), Compras (orden_compra_items.presupuesto_item_id, lz_oc_ajustes.pr_item_id), Personalización (personalizacion_items.presupuesto_item_id), Ficha 360, Oportunidades, Dashboard.
8. **Depende de**: clientes, proveedores, lista de costos, cotización BNA, profiles.
9. **Errores posibles**: OC parciales; pérdida de vínculos de renglón al editar; columnas ignoradas por la RPC; mezcla de monedas en OC.
10. **Si falla una operación**: crear/editar el PR es atómico (bien). Aprobar NO: primero cambia el estado y después crea OC una por una; si una falla, el PR queda aprobado con OC incompletas y re-aprobar no las completa (sale en `existingOCs.length > 0`, línea 1938).
11. **Si otro módulo cambia sus datos**: Facturación pasa el PR a `facturado`; Compras puede mover renglones de OC; al editar el PR esos vínculos se pierden (ver H1).
12. **Pruebas**: test-presupuesto-ayudas/margen/ia/dolar OK; dos tests de fuente desactualizados (fallan).
13. **Problemas reales**: H1, H2, H3, H5, H6, H8, H10, H11.
14. **Riesgos**: H4 (OC parciales), H13 (1000 filas), H14 (doble aprobación).
15. **Confiabilidad: media**. Alta/edición atómicas y con validación en base, pero la cadena PR→OC es de varios pasos en el cliente y la edición rompe los vínculos por renglón.

## Módulo 2 — Armar presupuesto con IA — `presupuestos/page.tsx`

1. Lee el pedido (texto/foto/PDF/Excel), propone artículo, proveedor y precio, crea el PR.
2. Texto/archivo del vendedor; cliente; dólar guardado.
3. Vendedor, lista de costos, historial de PR ganados del cliente (`cargarHistorial`, 162).
4. RPC `crear_presupuesto_atomico` (464) + update no crítico de columnas IA (470–475).
5. presupuestos, presupuesto_items, catalogo_proveedores, proveedores.nombre_fantasia.
6. Base.
7. Lista de PR (abre con ?selected).
8. IA (/api), lista de costos, dólar.
9. Columnas IA quedan vacías si falla el segundo paso (aceptado como "solo informativo").
10. PR creado igual; datos IA se pierden (no crítico).
11. Al editar el PR en la lista, `actualizar_presupuesto_atomico` borra y reinserta renglones y pierde `pedido_texto`, `catalogo_id`, `proveedor_sugerido_id`, `ia_confianza`, `ia_nota` (H1).
12. test-presupuesto-ia OK.
13. `cargarHistorial` no excluye PR eliminados (bajo).
14. —
15. **Confiabilidad: alta** para crear (atómico, avisa sin frenar).

## Módulo 3 — Ventas (bandeja) — `ventas/page.tsx` + `lib/ventas-etapas.ts`

1. Bandejas Esperando OC / Facturar / Entregar / Cobrar / Terminadas de PR aprobados/facturados.
2. PR aprobados+facturados, facturas, remitos, OC por PR.
3. Base, con realtime sobre presupuestos y facturas.
4. Lectura; escribe solo `estado = rechazado` ("No facturar", 338).
5. presupuestos.estado.
6. Base.
7. Augusto/vendedores para el día a día.
8. `saldo-clientes` (cobrado por factura, paginado con traerTodo) → misma regla que Finanzas (bien).
9. `etapaVenta` toma UNA factura vigente (la última no anulada); con resto a facturar habrá 2+ facturas por PR (hoy 0 casos) y el saldo/estado de cobro ignoraría las anteriores. Restos pendientes (`presupuesto_restos_facturar`, hoy 1) no aparecen en la bandeja Facturar.
10. "No facturar" no cancela OC (H3).
11. Si Facturación anula y re-factura, la vigente cambia: bien.
12. test-ventas-etapas OK.
13. H3; H12 (una factura por PR).
14. Lista de PR sin paginar (hoy 121).
15. **Confiabilidad: media-alta**.

## Módulo 4 — Clientes — `clientes/page.tsx`

1. ABM de clientes, sucursales, contactos, relevamiento; pestañas Ficha 360, Actividad, Cta. Cte., Consumo.
2. Datos del cliente, sucursales, contactos.
3. Formulario.
4. Varias escrituras sueltas (cliente, luego sucursales, luego contactos) sin transacción (1223–1343).
5. clientes, cliente_sucursales, contactos, fichas_relevamiento.
6. Base.
7. Todo el sistema.
8. saldo-clientes (lista, bien), facturas.
9. Pestaña **Cta. Cte.** con otra regla de saldo (H2). **Consumo** mide solo PR en estado `aprobado` (H7).
10. Alta de cliente: si falla una sucursal/contacto, el cliente queda creado igual (bajo).
11. —
12. test-saldo-clientes OK (la lib; la pestaña no la usa).
13. H2, H7.
14. —
15. **Confiabilidad: media** (la lista y la Ficha 360 están bien; la pestaña Cta. Cte. no).

## Módulo 5 — Ficha 360 — `components/clientes/ficha-360.tsx`

1. Vista 360 de solo lectura (PR, artículos, facturas, cobros, muestras, BCRA, oportunidades).
2. cliente + sociedad.
3. Base, paginado con `traerTodo` y lotes de 150 ids (bien).
4. Solo lectura.
5. Nada.
6. —
7. Clientes.
8. saldo-clientes, ventas-documentos (B7), oportunidades.
9. No filtra `eliminado` en presupuestos (cotizados/abiertos incluyen eliminados). Cobros `.limit(300)`.
10. Muestra error.
11. —
12. libs probadas.
13. Bajo: eliminados en KPIs.
14. —
15. **Confiabilidad: alta**.

## Módulo 6 — Oportunidades — `oportunidades/page.tsx` + `lib/oportunidades.ts`

1–8. Lee PR, renglones y facturas de 3 años (paginado), calcula recompra/temporada/reactivar/complementario/dormido. Solo lectura. Solo sugiere.
9. No excluye PR eliminados: un PR eliminado en estado vencido/rechazado/postergado puede salir como "Volver a cotizar" (hoy hay 41 vencidos + 1 rechazado eliminados).
12. Sin test propio de `calcularOportunidades` (no hay `test-oportunidades`).
15. **Confiabilidad: media-alta** (es sugerencia).

## Módulo 7 — Muestras — `muestras/page.tsx`

1. Envíos de muestras a clientes; renglones Devolvió / Se la quedó / Baja.
2–6. muestra_envios + muestra_envio_items; alta en 2 pasos con borrado compensatorio (201–218); `resolver` lee-modifica-escribe con cantidades del navegador (236).
7. Ficha 360 (muestras abiertas).
9. "Se la quedó" (`cantidad_vendida`) no genera ni vincula PR/factura: solo un toast "armale el presupuesto" (247). Nada lo lista después para cobrar. Eliminar es borrado físico con cascada (258).
10. Alta: compensa borrando el encabezado.
11. —
12. test-muestras-delivery OK (chequea fuente).
13. Hoy 0 envíos: sin impacto.
14. Muestras vendidas sin cobrar (H15, mejora).
15. **Confiabilidad: media**.

## Módulo 8 — Personalización — `personalizacion/page.tsx`

1. Trabajos de bordado/estampado con talleres, logos, liquidación mensual (con factura o interna → "FC Manual").
4. Editar trabajo = update cabecera + **delete de renglones + insert** (317–327): si el insert falla en una edición, los renglones quedan borrados (solo compensa en alta). Liquidar: 3–4 escrituras con compensación manual (721–746); el update de trabajos no exige `liquidacion_id is null` (dos liquidaciones simultáneas podrían tomar los mismos trabajos).
5. personalizacion_trabajos/items/liquidaciones, facturas_compra, personalizacion_logos.
7. Finanzas (FC Manual a pagar).
11. Al editar el PR, `personalizacion_items.presupuesto_item_id` queda en NULL (H1).
13. Hoy 0 trabajos: sin impacto.
14. H9.
15. **Confiabilidad: media**.

## Módulo 9 — Pendientes — `pendientes/page.tsx`

Tareas por usuario y sociedad; cuenta atrasos con `count` head (sin límite de 1000, bien). Escrituras simples con chequeo de error. "Facturas de venta vencidas" usa `estado in (emitida, parcial, vencida)` (otra fuente que el saldo real, pero hoy los estados coinciden con lo cobrado: 57 emitidas sin cobros, 1 parcial). test-pendientes OK. **Confiabilidad: alta**.

## Módulo 10 — Calendario — `calendario/page.tsx`

Eventos por sociedad (21 filas, sin paginar), alta/edición/borrado físico, aviso al asignado. Update de evento por id sin filtro de sociedad (bajo). **Confiabilidad: alta** (bajo impacto).

## Módulo 11 — Dashboard — `dashboard/page.tsx` + RPC `get_dashboard_kpis(p_sociedad_id)`

1. KPIs, facturado por mes (paginado, NC negativas, B7 — bien), top clientes, alertas, actividad, gastos fijos, objetivos.
9. **Tasa de conversión mal** (H6). `presupuestos_activos` cuenta eliminados. `margen_promedio` usa `markup_general` (default 30) de PR `aprobado` (casi no hay: pasan a facturado) — solo es respaldo de `margenMes`.
13. H6, H11 (alertas sin sociedad no se ven).
15. **Confiabilidad: media** (facturación y cobranzas bien; conversión mal).

## Módulo 12 — Cron de vencimiento de PR

Marca `vencido` y crea alertas de seguimiento. No excluye eliminados (crea alertas de PR borrados). La deduplicación por prefijo de título hace que la alerta de 5 días ("Seguimiento PR") nunca se cree porque comparte título con la de 3 días. Consulta de alertas existentes con `.in(prIds)` sin paginar. **Confiabilidad: media-alta** (bajo impacto).

## Módulo 13 — BCRA en clientes

`bcra-server.ts` + cron paginado + aviso al aprobar PR (`avisoBCRARojo`, 2219, `void`, nunca frena). Respeta la regla "avisar, nunca bloquear". Guarda un informe por cliente y mes (upsert), alerta con `sociedad_id`. **Confiabilidad: alta**.

---

## Hallazgos detallados

### H1 — Editar un PR borra y recrea todos sus renglones: se cortan los vínculos con OC, remitos y personalización, y se pierden columnas
- **Tipo/severidad**: error funcional · alto · certeza: estático + datos.
- **Evidencia**: RPC `actualizar_presupuesto_atomico` (en vivo): `delete from presupuesto_items where presupuesto_id = …` y luego `insert` con lista fija de columnas (sin `precio_lista`, `descuento_porcentaje`, `entregado`, `facturado`, `pedido_texto`, `catalogo_id`, `proveedor_sugerido_id`, `ia_confianza`, `ia_nota`). FKs `orden_compra_items.presupuesto_item_id`, `remito_items.presupuesto_item_id`, `personalizacion_items.presupuesto_item_id`, `lz_oc_ajustes.pr_item_id` → `ON DELETE SET NULL`. Llamada en `presupuestos-lista.tsx:1608`; luego `syncOCsFromPR` (1811) busca `presupuesto_item_id` que ya no existen y cae a coincidencia por código/descripción.
- **Datos**: 35 de 463 renglones de OC vivas con PR de origen tienen `presupuesto_item_id` NULL; 47 de 364 renglones de remito con PR también.
- **Síntoma**: tras editar un PR aprobado, la cantidad remitida por renglón se calcula por "descripción + orden" (frágil, `presupuestos-lista.tsx:1180`); si Compras movió un renglón a otro proveedor, la sincronización puede volver a agregarlo a la OC del proveedor original (doble pedido). La info de la IA se pierde.
- **Causa raíz**: la edición atómica se implementó como reemplazo total en vez de upsert por id.
- **Consecuencia**: pendientes de remitir/comprar mal calculados, posibles compras duplicadas, trazabilidad perdida.
- **Solución estructural**: que la RPC reciba el `id` de cada renglón existente y haga update/insert/delete por diferencia (borrar solo los que no vienen y no están referenciados), copiando todas las columnas. Agregar test.
- **Esfuerzo**: M.

### H2 — Pestaña "Cta. Cte." del cliente: muestra NC como deuda y usa el total, no el saldo
- **Tipo/severidad**: error funcional · alto · certeza: estático + datos.
- **Evidencia**: `clientes/page.tsx:828-835` (`facturas` con `estado = 'emitida'`, sin filtrar tipo), total adeudado 2495-2500 suma `f.total`; "Copiar CC" / "Enviar CC" (1439-1459) mandan ese listado al cliente por mail. Badge de la tabla (874-890) igual.
- **Datos**: 16 NC en estado `emitida` (13 clientes) aparecen como "Facturas pendientes de cobro" y suman al "Total adeudado". Ej.: NCB $1.347.041,25 con su factura anulada. La factura `parcial` (1) no aparece. No descuenta cobros parciales ni `total_acreditado`.
- **Causa raíz**: la pestaña quedó con la regla vieja por `estado`; la lista y la Ficha 360 ya usan `lib/saldo-clientes` (B3).
- **Consecuencia**: el estado de cuenta que se envía al cliente puede reclamarle plata que no debe.
- **Solución**: armar la pestaña con `traerDatosSaldoClientes` + `saldoFacturaVenta` por factura (excluir NC, incluir `parcial`, mostrar saldo).
- **Esfuerzo**: S.

### H3 — Rechazar / "No facturar" / perder un PR no avisa ni cancela sus OC
- **Tipo/severidad**: riesgo estructural · alto · certeza: estático + datos.
- **Evidencia**: `doEstadoChange` (2201) solo hace algo extra al aprobar; `ventas/page.tsx:338` (No facturar → rechazado) y `seguimiento-ia.tsx:190` (perdido) actualizan solo `presupuestos.estado`. Solo `handleDelete` (2325) ofrece cancelar OC y solo a admin.
- **Datos**: 4 OC vivas de PR rechazados, todas `recibida` y `pagada` (OC-2026-1155, 1117, 1133, 1173; ≈ $19,1 M ARS). Tres de esos PR tenían factura que se anuló.
- **Causa raíz**: el estado del PR no se propaga a Compras; no hay regla única de "venta caída".
- **Consecuencia**: mercadería comprada y pagada sin venta asociada y sin aviso; queda fuera de Ventas y de los informes.
- **Solución**: función única "cerrar venta" (RPC o lib) que al rechazar un PR con OC vivas avise y proponga cancelar las no pedidas o pasar lo recibido a stock/otra venta (aviso, nunca bloqueo). Revisar estos 4 casos con Augusto.
- **Esfuerzo**: M.

### H4 — Aprobar un PR genera las OC en el navegador, de a una y sin transacción; si queda a medias no se completa
- **Tipo/severidad**: riesgo estructural · medio · certeza: estático.
- **Evidencia**: `doEstadoChange` (2209) actualiza el estado primero; `generateOCsFromPresupuesto` (1909) inserta encabezado y renglones por proveedor con `continue` ante errores; el chequeo de duplicados (1931-1940) sale si ya existe cualquier OC del PR, así que re-aprobar no crea la del proveedor que falló. Encabezados con renglones fallidos de proveedor con id no se borran (2030-2035, a diferencia de stock propio y sin proveedor).
- **Consecuencia**: PR aprobado con proveedores sin OC (no se compra) o OC vacía.
- **Solución**: RPC `aprobar_presupuesto(p_id)` que en una transacción cambie estado y arme las OC (con idempotencia por proveedor).
- **Esfuerzo**: M.

### H5 — Restaurar un PR eliminado le crea OC aunque no esté aprobado
- **Tipo/severidad**: error funcional · medio · certeza: estático.
- **Evidencia**: `handleRestore` (2379) llama `generateOCsFromPresupuesto(id)` siempre; esa función no mira el estado. Los eliminados hoy: 9 pendientes, 41 vencidos, 1 rechazado, 1 aprobado.
- **Consecuencia**: restaurar un pendiente crea OC "enviada" a proveedores por una venta no confirmada.
- **Solución**: generar OC solo si el PR está `aprobado` (o preguntar).
- **Esfuerzo**: S.

### H6 — Dashboard: la tasa de conversión cuenta solo PR en estado "aprobado" (los ganados pasan a "facturado")
- **Tipo/severidad**: error funcional · medio · certeza: ejecución (SQL).
- **Evidencia**: `get_dashboard_kpis(p_sociedad_id)` → `count(*) filter (where estado = 'aprobado') / (aprobado + rechazado)`; se muestra en `dashboard/page.tsx:486`. `lib/oportunidades.ts` define `ESTADOS_GANADOS = [aprobado, facturar, facturado, remitido, entregado]`.
- **Datos (Lazzari, últimos 3 meses)**: aprobado 2, facturado 118, rechazado 25 → el tablero muestra ≈ 7,4 %; la conversión real es ≈ 82,8 %. `presupuestos_activos` además cuenta PR eliminados.
- **Solución**: usar la misma lista de estados ganados/perdidos en la RPC y excluir `eliminado`.
- **Esfuerzo**: S (migración aditiva con rollback).

### H7 — Clientes > Consumo: solo suma PR en estado "aprobado" y el "total facturado" mezcla monedas, anuladas y NC
- **Tipo/severidad**: error funcional · medio · certeza: estático + datos.
- **Evidencia**: `clientes/page.tsx:600-641` (`eq("estado", "aprobado")`; facturas sin filtro de estado/tipo/moneda, `sum(total)`).
- **Consecuencia**: categorías de consumo casi vacías (solo 2 PR en aprobado) y "total facturado" inflado (anuladas y NC suman, US$ + $ mezclados).
- **Solución**: usar `ESTADOS_GANADOS` y `totalVentasNeto` por moneda (como Ficha 360).
- **Esfuerzo**: S.

### H8 — OC con costos en pesos y dólares mezclados suman como pesos
- **Tipo/severidad**: error funcional · medio · certeza: ejecución (SQL).
- **Evidencia**: `generateOCsFromPresupuesto` (1990-1992) y `syncOCsFromPR` (1893-1895): si hay monedas mixtas la OC queda en ARS y suma `precio_unitario` sin convertir; el trigger `lz_recalcular_totales_oc` tampoco convierte.
- **Datos**: OC-2026-1242 (recibida): 30 × US$ 4,24 + 1 × $ 35.000 → total $ 42.503,91 (el renglón en dólares se contó como $ 127).
- **Solución**: separar OC por moneda de costo también para proveedores (como ya se hace con stock propio, `groupOwnStockItemsByCurrency`) o avisar al armar.
- **Esfuerzo**: S/M.

### H9 — Margen mínimo 15 %: tres fórmulas distintas
- **Tipo/severidad**: riesgo estructural · medio · certeza: ejecución.
- **Evidencia**: `presupuestos-lista.tsx:400` `MARGEN_MINIMO` + aviso al guardar (1499-1504: `(neto/costo − 1)`), `presupuesto-ia.ts:5,13` `margenSobreCosto` (igual), `presupuesto-margen.ts:12,36` `margenPR` (descuenta 7 % ARCA / 2 % manual y flete interno).
- **Ejecución**: venta 120 / costo 100 → aviso al guardar y IA: 20 % (no avisa); lista y panel: 11,6 % (rojo).
- Además `convertirCostoPR` sin TC devuelve el costo sin convertir: costo US$ 100 en PR en pesos sin TC da margen 139.400 % (3 PR así en la base).
- **Solución**: una sola función de margen en `lib/presupuesto-margen.ts` usada por guardar, IA y lista; sin TC devolver "sin dato" en vez de mezclar monedas.
- **Esfuerzo**: S.

### H10 — Descuento por renglón y descuento general nunca se guardan
- **Tipo/severidad**: error funcional · bajo · certeza: estático + datos.
- **Evidencia**: el cliente manda `precio_lista`, `descuento_porcentaje` (1572-1574) y `descuento_general_porcentaje` (1588, 1640) pero las RPC no los incluyen en el insert/update. Datos: 0 renglones con descuento o precio de lista, 0 PR con descuento general.
- **Consecuencia**: el importe queda bien (se guarda el precio neto) pero al reabrir el PR desaparece el descuento (PDF y edición lo muestran como precio sin descuento).
- **Solución**: agregar esas columnas a ambas RPC (migración aditiva + rollback).
- **Esfuerzo**: S.

### H11 — Las alertas "PR aprobado / rechazado" del trigger se guardan sin sociedad
- **Tipo/severidad**: error funcional · bajo · certeza: ejecución (SQL).
- **Evidencia**: `presupuesto_estado_alert()` inserta en `alertas` sin `sociedad_id`; el Dashboard filtra `eq("sociedad_id", …)`. Datos: 274 alertas con `sociedad_id` NULL (247 "PR aprobado", 27 "PR rechazado"), 165 sin leer. El texto dice "$" aunque el PR esté en US$.
- **Solución**: agregar `NEW.sociedad_id` y la moneda en el trigger.
- **Esfuerzo**: S.

### H12 — Ventas asume una sola factura por PR
- **Tipo/severidad**: riesgo estructural · medio · certeza: riesgo.
- **Evidencia**: `ventas-etapas.ts` `vigente = facturasOrdenadas.find(...)` (solo la última); `resto-facturar.ts` y `emitir-factura-modal.tsx:437` ya permiten facturar el resto en otra factura del mismo PR. Hoy 0 PR con 2 facturas vigentes y 1 resto pendiente. Los restos no entran en la bandeja Facturar.
- **Consecuencia**: cuando se use el resto, lo cobrado/saldo de la primera factura deja de verse en Ventas.
- **Solución**: sumar saldo de todas las facturas no anuladas del PR y mostrar restos pendientes como "Facturar".
- **Esfuerzo**: S/M.

### H13 — Consultas sin paginar que se van a acercar a 1000 filas
- **Tipo/severidad**: riesgo estructural · medio · certeza: riesgo.
- **Evidencia**: lista de PR `fetchPresupuestos` (990, hoy 234; ~120/mes → ~6 meses), `remito_items` y `presupuesto_items` con `.in(...)` en `fetchRemitidoIds` (1156, 1165; remito_items ya 363 en 2 meses), facturados (1124), Ventas (168-190), `muestra_envios`, alertas del Dashboard sin `limit`. Además `.in()` con cientos de UUID arma URLs largas.
- **Consecuencia**: estados "parcial/total" o facturados incorrectos sin error visible.
- **Solución**: `traerTodo` + lotes de 150 ids (como Ficha 360) o vistas/RPC que devuelvan el estado ya calculado.
- **Esfuerzo**: S.

### H14 — Doble aprobación puede crear OC duplicadas
- **Tipo/severidad**: riesgo · bajo · certeza: hipótesis.
- **Evidencia**: chequeo de OC existentes en el navegador (1931) sin bloqueo ni restricción única en base.
- **Solución**: idempotencia en la RPC de aprobación (H4).
- **Esfuerzo**: incluido en H4.

### H15 — Duplicar PR copia fecha, vencimiento y marcas viejas; renglones sin chequeo de error
- **Tipo/severidad**: error funcional · bajo · certeza: estático.
- **Evidencia**: `handleDuplicate` (2276-2318): `...rest` copia `fecha`, `vencimiento`, `eliminado`, `listo_para_facturar`, `motivo_rechazo`, `costo_envio_interno`, `ia_*`, `created_by`; el insert de renglones no revisa `error` (2314) y no usa la RPC atómica.
- **Consecuencia**: el duplicado sale con fecha vieja y vencido (el cron lo pasa a "vencido" al día siguiente) o sin renglones si falla el segundo paso.
- **Solución**: duplicar vía `crear_presupuesto_atomico` con fecha de hoy y vencimiento nuevo.
- **Esfuerzo**: S.

### H16 — Tests de presupuestos desactualizados
- **Tipo**: mejora · bajo · certeza: ejecución.
- **Evidencia**: `scripts/test-presupuesto-exact-price.mjs` y `test-presupuesto-post-create.mjs` fallan porque leen `presupuestos/page.tsx`; el código vive en `presupuestos-lista.tsx`.
- **Solución**: apuntarlos al archivo nuevo.
- **Esfuerzo**: S.

### Menores (sin hallazgo propio)
- Ficha 360, Oportunidades, cron de vencimiento y `cargarHistorial` no excluyen PR eliminados.
- PR panel: aviso "Límite de crédito excedido" usa `clientes.saldo_cuenta_corriente` (columna que nadie actualiza, B3) en `presupuestos-lista.tsx:3225`; hoy ningún cliente tiene límite, así que no se ve.
- Cron: alerta de 5 días nunca se crea (mismo título que la de 3 días).
- Muestras "Se la quedó" no queda en ninguna lista para facturar (mejora; hoy 0 muestras).
- Personalización: edición de trabajo borra renglones antes de insertar (si falla, se pierden) y liquidar no exige `liquidacion_id is null` (hoy 0 trabajos).
- `change_pr_operator` es SECURITY DEFINER y solo valida rol, no pertenencia a la sociedad (bajo).

## Lo que está bien hecho
- Alta y edición de PR en RPC atómicas con validación en base (cantidad > 0, descripción, no negativos, máx. 500 renglones) y filtro por sociedad (`for update`).
- Totales del PR recalculados por triggers desde los renglones (una sola fuente).
- `lib/saldo-clientes.ts`: regla única de saldo (NC aplicadas, cobros, aplicaciones sin doble conteo, ajustes, monedas separadas), paginada, con test; usada por lista de clientes, Ficha 360 y Ventas.
- `lib/ventas-documentos.ts` (regla B7) y `get_dashboard_kpis` nuevo (pendiente de cobro con saldo real, NC negativas, sociedad).
- Ficha 360 y Oportunidades paginan con `traerTodo` y lotes.
- BCRA y márgenes: siempre avisan, nunca bloquean (regla 1 de Augusto).
- Borrado de PR lógico; borrado permanente por RPC que rechaza si hay facturas, remitos u OC.
- Lista de PR protegida contra respuestas tardías de otra sociedad (`fetchPRSeq`).

## Conexiones con otros módulos
| Desde | Hacia | Dato | Fuente de verdad | ¿Compatible? | Nota |
|---|---|---|---|---|---|
| Presupuestos | Compras (OC) | renglones a comprar | presupuesto_items → orden_compra_items.presupuesto_item_id | dudoso | se corta al editar el PR (H1); monedas mezcladas (H8) |
| Presupuestos | Remitos | cantidad remitida por renglón | remito_items.presupuesto_item_id | dudoso | 47 renglones sin vínculo; respaldo por descripción+orden |
| Presupuestos | Personalización | renglón personalizado | personalizacion_items.presupuesto_item_id | dudoso | SET NULL al editar el PR |
| Facturación | Presupuestos | estado facturado | presupuestos.estado='facturado' + facturas.presupuesto_id | sí | hoy 119/119 coinciden |
| Presupuestos (rechazo) | Compras | venta caída | presupuestos.estado | no | no se propaga; 4 OC pagadas de PR rechazados (H3) |
| Facturación/Finanzas | Ventas | saldo por factura | lib/saldo-clientes | sí | misma regla |
| Facturación/Finanzas | Clientes > Cta. Cte. | deuda del cliente | facturas.estado='emitida' | no | incluye NC, ignora parciales (H2) |
| Presupuestos | Dashboard | conversión | get_dashboard_kpis | no | solo cuenta 'aprobado' (H6) |
| Presupuestos (trigger) | Alertas/Dashboard | aviso aprobado/rechazado | alertas | no | sin sociedad_id (H11) |
| Facturación (resto) | Ventas | resto a facturar | presupuesto_restos_facturar | dudoso | Ventas no lo muestra (H12) |
| Lista de costos | Presupuestos | costo y moneda | catalogo_costos / catalogo_proveedores | sí | — |
| BCRA | Presupuestos/Clientes | semáforo | cliente_bcra_informes | sí | aviso al aprobar, nunca bloquea |
| Muestras | Facturación | prendas que se quedó el cliente | muestra_envio_items.cantidad_vendida | no | no hay vínculo ni lista para cobrar |
