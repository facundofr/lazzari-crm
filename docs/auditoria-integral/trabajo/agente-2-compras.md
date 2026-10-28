# Auditoría integral — Agente 2: Compras

Fecha: 28/10/2026. Auditoría de **solo lectura**: no se modificó código ni base. Consultas a la base solo con SELECT dentro de transacción READ ONLY.

## Alcance revisado

**Pantallas**
- `src/app/(crm)/compras-lazza/page.tsx` (la que está en el menú)
- `src/app/(crm)/compras-nueva/page.tsx` (oculta del menú, sigue por link)
- `src/app/(crm)/ordenes-compra/page.tsx` (vieja, 4031 líneas, oculta, sigue por link) — revisada por grep de escrituras y por rangos
- `src/app/(crm)/proveedores/page.tsx` (saldos y alta rápida)
- `src/app/(crm)/importaciones/page.tsx` (cartel "próximamente", sin lógica)

**Componentes**
- `compras-lista-oc.tsx`, `compras-lazza-llego.tsx`, `compras-lazza-factura.tsx`, `compras-lazza-oc.tsx`, `compras-lazza-nueva-oc.tsx`, `compras-lazza-facturas-oc.tsx` (no se importa en ningún lado)
- `cargar-factura-oc.tsx` (rangos del guardado), `cargar-factura-simple.tsx` (grep), `conciliacion-compras.tsx` (grep), `carga-masiva-global.tsx`, `carga-masiva-facturas-compra.tsx` (grep), `proveedor-form-modal.tsx` (guardado), `lista-costos/*` (solo lectura)

**lib**
- `compras-lazza.ts`, `compras-recepcion.ts`, `oc-lista.ts`, `saldo-factura-compra.ts`, `saldo-proveedores.ts`, `oc-sin-proveedor.ts` (asignarRenglonesAProveedor), `pago-tarjeta.ts`, `finanzas-lazza.ts` (solo `saldoFacturaCompra`)

**Base (definiciones vivas leídas con pg_get_functiondef / pg_policies / pg_trigger)**
- RPC: `guardar_conciliacion_compra`, `anular_factura_compra`, `cerrar_saldo_oc`, `fc_compra_pagado`, `registrar_pago_tarjeta_factura_compra`, `lz_actualizar_fact_pago_oc`, `lz_recalcular_totales_oc`, `increment_stock`
- Triggers: `auto_estado_oc` (orden_compra_items), `recalcular_oc`, `lz_trg_fact_pago_oc` (facturas_compra y factura_compra_ocs), `lz_trg_saldo_cerrado_oc`, `validar_saldo_aplicacion_factura_compra`, `recalcular_saldo_proveedor`, `audit_trigger_func`
- Tablas: `ordenes_compra`, `orden_compra_items`, `facturas_compra`, `facturas_compra_items`, `factura_compra_ocs`, `factura_compra_asignaciones`, `factura_compra_anulaciones`, `op_facturas_compra`, `proveedores`, `proveedor_equivalencias`, `oc_remitos`
- FKs, índices únicos y políticas RLS de esas tablas.

**Pruebas corridas (puras, leídas antes):** `test-compras-lazza.ts`, `test-compras-recepcion.ts`, `test-oc-lista.ts`, `test-saldo-factura-compra.ts`, `test-saldo-proveedores.ts`, `test-lista-costos.ts`, `test-oc-sin-proveedor.ts`, `test-reemplazo-oc.ts` → **todas OK**. Además un script propio en el scratchpad (no en el repo) que llama a `estadoOC`, `ejePago`, `saldoFacturaCompra` (dos versiones) para confirmar hallazgos.

**Volumen de datos (para el límite de 1000 filas):** 191 OC, 491 renglones de OC, 139 facturas de compra (135 Lazzari, 4 Grupo LA), ~400 proveedores por sociedad. Hoy nada roza el límite; las listas grandes ya usan `traerTodo`.

---

## Contexto clave del proceso actual

- Desde el **19/10** la factura de compra **ya no se ata a la OC** (Compras Lazza). La OC solo controla "que llegue todo". Datos: de 30 OC creadas desde el 19/10, solo 1 tiene `estado_facturacion`; de 32 facturas cargadas desde el 19/10, solo 1 está vinculada a OC.
- Por eso los ejes "factura" y "pago" de la OC (`estado_facturacion`, `estado_pago`) **quedaron congelados** para las OC nuevas. Los siguen leyendo Compras nueva (oculta), Ventas (oculta, "pagada con tarjeta"), Finanzas vieja y el prompt de la IA (`api/ai/route.ts:73`).
- Siguen vivas por link tres pantallas del mismo proceso (Compras Lazza, Compras nueva, Compras vieja) y la carga masiva global (se abre desde Compras nueva, Compras vieja y Finanzas vieja) que **sí** ata facturas a OC y actualiza costos del PR.

---

## Módulo 1 — Lista de OC y estados (`compras-lista-oc.tsx` + `lib/oc-lista.ts`)

1. **Función:** listar todas las OC de la sociedad con estado de mercadería (Por pedir/Pedido/Parcial/Completo), factura y pago (solo Compras nueva), atrasadas, filtros, copiar para WhatsApp, marcar Pedido.
2. **Recibe:** `sociedadId`, modo `lazza`.
3. **De dónde:** `ordenes_compra` + `orden_compra_items` embebidos, `factura_compra_ocs` y `facturas_compra.orden_compra_id` (en tandas de 100), `profiles`.
4. **Operaciones:** lectura con `traerTodo` (paginada, bien), cálculo en cliente con `estadoOC`, `ejeFactura`, `ejePago`, `ocTerminada(Lazza)`, `ocAtrasada`. Escribe `pedido/pedido_at/pedido_via/pedido_por` y la fecha de pedido.
5. **Modifica:** solo `ordenes_compra.pedido*`.
6. **Guarda:** `ordenes_compra`.
7. **Dependen:** Compras Lazza, Compras nueva.
8. **Depende de:** que `ordenes_compra.estado` y `orden_compra_items.cantidad_recibida` estén alineados; de `estado_facturacion`/`estado_pago` mantenidos por la base.
9. **Errores posibles:** `estadoOC` da "completo" si `estado='recibida'` aunque no haya llegado nada (confirmado: 4 OC). Suma total de cantidades en vez de renglón por renglón.
10. **Si falla:** muestra el error; la marca Pedido avisa con toast. Sin escrituras a medias.
11. **Si otro módulo cambia datos:** mover renglones entre OC (`asignarRenglonesAProveedor`) no recalcula `estado` → la lista muestra mal.
12. **Pruebas:** `test-oc-lista.ts` (OK). No prueba el caso "estado recibida sin nada llegado".
13. **Problemas reales:** H1 (OC "Completo" sin mercadería), H8 (eje pago distinto a la base).
14. **Riesgos:** OC fuera de "En curso" que en realidad faltan → nadie reclama la mercadería.
15. **Confiabilidad: media.** La lectura y filtros están bien hechos (paginado, sociedad), pero el estado de mercadería confía primero en una columna que se desincroniza.

## Módulo 2 — Llegó / recepción (`compras-lazza-llego.tsx`, `lib/compras-recepcion.ts`, recepción con foto en Compras nueva, recepción vieja)

1. **Función:** marcar lo que llegó (Completo / Parcial / Corregir). Compras nueva: foto del remito con IA. Vieja: recepción con suma de stock.
2. **Recibe:** OC (id, número), cantidades tipeadas o leídas.
3. **De dónde:** `orden_compra_items` de la OC.
4. **Operaciones:** `armarRecepcion` (pura, tope en lo pedido), update por renglón de `cantidad_recibida` (valor absoluto calculado con lo leído al abrir), luego update de `ordenes_compra.estado` con `estadoPorRecibido`. Rollback manual si un renglón falla.
5. **Modifica:** `orden_compra_items.cantidad_recibida`, `ordenes_compra.estado`; la vieja además `productos.stock` vía `increment_stock`; Compras nueva `oc_remitos`.
6. **Guarda:** esas tablas.
7. **Dependen:** lista de OC (estado), presupuestos (alertas de cierre), stock (solo pantalla vieja).
8. **Depende de:** trigger `auto_estado_oc` (que también escribe `estado`).
9. **Errores posibles:** dos personas marcando a la vez → la última pisa (escribe valor absoluto, no suma). En Corregir no se revisa el error del update de estado (`compras-lazza-llego.tsx:62`). `auto_estado_oc` nunca vuelve una OC a "enviada" (solo sube).
10. **Si falla:** Llegó deshace los renglones ya escritos (bien). Si falla el estado, avisa.
11. **Si otro módulo cambia datos:** editar la OC en Compras Lazza recalcula estado; mover renglones a otra OC no.
12. **Pruebas:** `test-compras-recepcion.ts` (OK).
13. **Problemas reales:** estado guardado en dos lugares (cliente + trigger) — causa de H1. Recepción vieja suma stock y la nueva no (H11).
14. **Riesgos:** concurrencia (bajo uso hoy).
15. **Confiabilidad: media.** Lógica pura bien probada; la persistencia no es atómica y el estado se escribe desde dos lados.

## Módulo 3 — Cargar factura de compra en Compras Lazza (`compras-lazza-factura.tsx`)

1. **Función:** cargar FC / NC / "Sin factura" del proveedor a su cuenta corriente, sin OC. Lectura local (QR/texto) o IA. Pago: "Va a Pagos" o "Pagada con Visa".
2. **Recibe:** PDF/foto o carga a mano, proveedor, forma y plazo de pago, nota.
3. **De dónde:** `leerFacturaLocal`, `/api/parse-factura-compra`, `proveedores` de la sociedad.
4. **Operaciones:** RPC `guardar_conciliacion_compra` (sin asignaciones, sin costos) → luego, desde el cliente, sube el PDF y hace `update estado='pendiente'` o `registrarPagoTarjeta`. NC: `registrar_nota_credito_compra_v2` con `request_key`.
5. **Modifica:** `facturas_compra`, `facturas_compra_items`, `movimientos` (Visa), Storage `facturas-compra`, `proveedores.email/cbu/alias`.
6. **Guarda:** esas tablas.
7. **Dependen:** Finanzas (vencimientos, cuentas corrientes, OP, IVA compras), Proveedores (saldo).
8. **Depende de:** `guardar_conciliacion_compra` (control de duplicado con advisory lock, bien), `registrar_pago_tarjeta_factura_compra`.
9. **Errores posibles:** el guardado son 2-3 pasos: si se corta después del RPC la factura queda en `pendiente_aprobacion` (Finanzas igual la cuenta como deuda, por eso el impacto es bajo). `subtotal` se guarda del texto del neto y `total` de la factura: pueden no cerrar (sin control). El chequeo de duplicado de la ventana usa su propia normalización (`compras-lazza-factura.tsx:210`) distinta de `duplicadosComprobanteCompra`, pero la base hace el control real.
10. **Si falla:** RPC atómico; el PDF y el pago fallan "suave" con aviso.
11. **Si otro módulo cambia datos:** proveedor duplicado por CUIT con formato distinto → `find` toma el primero (H6).
12. **Pruebas:** `test-compras-lazza.ts` (neto, IVA/percepciones, NC, vencimiento) OK.
13. **Problemas reales:** ninguno grave propio; hereda H5 (regla de saldo de la tarjeta) y H6.
14. **Riesgos:** el fallback de `registrarPagoTarjeta` (`lib/pago-tarjeta.ts:48-51`) marca pagada y luego inserta el movimiento en dos pasos (solo si falta la RPC; hoy existe).
15. **Confiabilidad: alta.** El dato de plata pasa por RPC con control de duplicado y permisos.

## Módulo 4 — Editar / anular / reactivar OC (`compras-lazza-oc.tsx`) y mover renglones (`lib/oc-sin-proveedor.ts`)

1. **Función:** editar renglones, cantidades, precios, moneda, proveedor de toda la OC o por artículo (los que cambian de proveedor se mueven a otra OC), operador; pasar costo y proveedor al PR; anular y reactivar.
2. **Recibe:** OC, renglones editados, proveedor(es).
3. **De dónde:** `ordenes_compra`, `orden_compra_items`, `presupuesto_items`, `proveedores`, facturas vinculadas.
4. **Operaciones (todas desde el navegador, una por una, sin transacción):** 1) borra renglones, 2) actualiza renglones, 3) inserta nuevos, 4) actualiza encabezado (estado, totales), 5) mueve renglones a otra OC o crea OC nueva, 6) actualiza proveedor y costo en el PR.
5. **Modifica:** `orden_compra_items` (DELETE físico), `ordenes_compra`, `presupuesto_items`.
6. **Guarda:** esas tablas.
7. **Dependen:** lista de OC, presupuestos (costo/margen), facturación vieja (asignaciones).
8. **Depende de:** triggers `recalcular_oc` (totales), FKs con `ON DELETE CASCADE` hacia `factura_compra_asignaciones` y `lz_oc_ajustes`.
9. **Errores posibles:** corte a mitad → OC con renglones borrados y el resto sin actualizar; PR sin el costo nuevo (se avisa). Borrar un renglón que tiene asignaciones de una factura vieja las borra en cascada sin recalcular `estado_facturacion`. Mover renglones no recalcula el `estado` de ninguna de las dos OC ni el `orden_compra_id` de las asignaciones.
10. **Si falla:** muestra el error del paso, pero lo anterior ya quedó escrito (no hay vuelta atrás).
11. **Si otro módulo cambia datos:** si otra persona editó la OC entre que se abrió y se guardó, se pisa (no hay control de versión).
12. **Pruebas:** `test-compras-lazza.ts` cubre `totalesOc`, `renglonesPrDeOc`, `prDeRenglones`, `monedaRenglonOc`. La persistencia no tiene prueba.
13. **Problemas reales:** H1 (origen confirmado: las 5 OC desalineadas vienen de "renglones pasados al cambiarles el proveedor", 20/10), H3.
14. **Riesgos:** pérdida de renglones si falla la red a mitad; borrado en cascada de asignaciones.
15. **Confiabilidad: media-baja.** Hace mucho (OC + otra OC + PR) sin transacción.

## Módulo 5 — Nueva OC a mano (`compras-lazza-nueva-oc.tsx`)

1-6. Crea `ordenes_compra` (estado `enviada`, `pedido` falso → "Por pedir") y luego sus renglones. Si fallan los renglones, cancela la OC (no la borra) y avisa.
7. Lista de OC. 8. Trigger `oc_auto_numero`, `recalcular_oc`.
9-10. Compensación correcta; IVA fijo 21 % por renglón.
11. —. 12. `monedaNuevaOc` probada.
13. Ninguno. 14. Bajo. 15. **Alta.**

## Módulo 6 — Saldo de factura de compra / cuenta corriente de proveedores (`lib/saldo-factura-compra.ts`, `lib/saldo-proveedores.ts`, `lib/finanzas-lazza.ts#saldoFacturaCompra`, `fc_compra_pagado`, `registrar_pago_tarjeta_factura_compra`, `validar_saldo_aplicacion_factura_compra`)

1. **Función:** cuánto falta pagar de cada factura y por proveedor.
2-3. **Recibe:** facturas, OP vigentes, pagos directos, movimientos de NC, créditos a favor; filtrado por `sociedad_id` y con `traerTodo` (bien).
4. **Operaciones:** fórmula "total − max(total_acreditado, NC por movimientos) − pagos directos con retención − OP vigentes".
5-6. Solo cálculo (las RPC sí validan y escriben).
7. **Dependen:** Finanzas (vencimientos, CC, OP), Proveedores (columna saldo), pago con tarjeta, trigger que impide pagar de más.
8. **Depende de:** `facturas_compra.estado` ("pagada") en algunas versiones y en otras no.
9. **Errores posibles:** hay **cinco** implementaciones de la misma regla con dos diferencias reales (H4 y H5).
10. —
11. Si alguien marca "pagada" a mano sin pago, unas pantallas la ven saldada y otras con saldo (3 facturas hoy).
12. **Pruebas:** `test-saldo-factura-compra.ts`, `test-saldo-proveedores.ts` (OK). Ninguna compara las cinco versiones entre sí.
13. **Problemas reales:** H4, H5.
14. **Riesgos:** pagar dos veces una factura "pagada a mano" (el trigger la deja porque para la base tiene saldo).
15. **Confiabilidad: media.** Las versiones principales coinciden; difieren en casos borde que hoy existen en los datos.

## Módulo 7 — Ejes factura y pago de la OC (`lz_actualizar_fact_pago_oc`, `guardar_conciliacion_compra`, `anular_factura_compra`, `cerrar_saldo_oc`)

1. **Función:** marcar la OC facturada/parcial y pagada según sus facturas; "Cerrar saldo" la da por terminada sin recibir/facturar todo y avisa al vendedor.
2-3. Disparados por triggers en `facturas_compra` y `factura_compra_ocs`, y por las RPC.
4. Cálculo por asignaciones (cantidades) o, sin asignaciones, por suma de totales ≥ 99 % del total de la OC.
5-6. `ordenes_compra.estado_facturacion`, `estado_pago`, `medio_pago`, `pagada_at`; `alertas`.
7. Compras nueva, Ventas, Finanzas vieja, IA.
8. `facturas_compra.estado = 'pagada'` (no el saldo calculado).
9. No hay trigger en `factura_compra_asignaciones`: si se borran en cascada (H3) el eje no se recalcula. El código cliente `ejePago` dice "ok" con una factura parcial pagada; la base exige "facturada" o saldo cerrado (H8).
10. Atómico (triggers dentro de la transacción).
11. Desde el 19/10 las facturas no se atan → estos ejes quedan en "falta" para siempre en OC nuevas (H7).
12. `test-oc-lista.ts` cubre el lado cliente.
13. H7, H8.
14. Pantallas ocultas muestran OC "sin facturar / sin pagar" que sí están pagadas.
15. **Media.** Correcto en la base para el circuito viejo; desactualizado para el circuito nuevo.

## Módulo 8 — Carga masiva / conciliación por renglón / cargar factura con OC (`carga-masiva-*`, `conciliacion-compras.tsx`, `cargar-factura-oc.tsx`, `cargar-factura-simple.tsx`)

1. **Función:** circuito viejo: varias facturas con IA, cruce renglón por renglón contra OC, equivalencias, tolerancia y talles especiales, actualización de costo en OC y PR.
2-3. PDFs, OC del proveedor, `proveedor_equivalencias`.
4. `conciliacion-compras` y `cargar-factura-simple` usan `guardar_conciliacion_compra` (atómico). `cargar-factura-oc` tiene tres caminos: NC por RPC (atómico), factura+OC extra por RPC (atómico) y **un camino con inserts sueltos** (`cargar-factura-oc.tsx:1380-1415`: factura, después renglones, después vínculos) sin control de duplicado en la base.
5-6. `facturas_compra`, items, asignaciones, `factura_compra_ocs`, `orden_compra_items.precio_unitario`, `presupuesto_items` (costo/margen), `proveedor_equivalencias`.
7. Finanzas, Presupuestos (margen), Compras.
8. Proveedor (talles, tolerancia).
9. Camino de inserts sueltos: si fallan los renglones queda la factura sin renglones; puede duplicar.
10. Con RPC: nada a medias. Sin RPC: a medias.
11. Contradice la regla nueva "la factura no se ata a la OC": sigue disponible desde pantallas ocultas y Finanzas vieja (H9).
12. Muchos tests de matching (`test-purchase-matching*.cjs`, `test-factura-vs-oc*.ts`, `test-cargar-factura.ts`): no corridos aquí salvo los listados arriba.
13. H9.
14. Dos formas de cargar la misma factura con efectos distintos sobre el costo del PR.
15. **Media.**

## Módulo 9 — Proveedores (`proveedores/page.tsx`, `proveedor-form-modal.tsx`)

1. Alta/edición, ficha, saldo por proveedor, última compra, lista de costos (solo ver), reglas.
2-3. Formulario, ARCA (consulta CUIT), lectura de constancia.
4. Insert/update directo; saldos con `calcularSaldosProveedores` (paginado, por sociedad).
5-6. `proveedores`, `contactos`.
7. Todas las compras, Finanzas, Transportes, Personalización.
8. Índice único `(cuit, sociedad_id)`.
9. **El CUIT se guarda tal como se tipea** (`proveedor-form-modal.tsx:313-320`, `proveedores/page.tsx:604`) → el índice único no detecta "30-54676404-0" vs "30546764040". Confirmado: 2 pares duplicados en Lazzari (Nestlé, Andrés Fernández). Si `traerCreditosProveedores` falla, los saldos se muestran sin créditos y sin aviso (`page.tsx:337`). Sin sociedad activa la consulta de proveedores no filtra (`page.tsx:250`).
10. Errores de guardado se muestran.
11. Facturas buscan el proveedor por dígitos del CUIT → puede elegir el duplicado vacío.
12. `test-proveedor-nombre.ts`, `test-saldo-proveedores.ts`.
13. H6.
14. Cuenta corriente partida en dos proveedores.
15. **Media.**

## Módulo 10 — Lista de costos / Importaciones

- Lista de costos (`components/lista-costos/*`): solo lectura de `catalogo_costos` vía `traerListaCompleta`, filtros y semáforo. Sin escrituras. `test-lista-costos.ts` OK. **Confiabilidad alta** (solo muestra).
- Importaciones: pantalla vacía ("próximamente"). Nada que auditar.

## Módulo 11 — Pantalla vieja de Compras (`ordenes-compra/page.tsx`) — oculta pero accesible

- Borra OC físicamente (`page.tsx:947-960`, `2104-2107`) — contrario a "nada se borra" (sí revisa que no tenga facturas).
- Recepción suma stock con `increment_stock` por lo **tipeado**, aunque el renglón se tope en lo pedido (`page.tsx:1010-1022`): si se recibe de más, el stock sube de más. `increment_stock` es `security definer` sin control de rol ni sociedad y recibe `integer` (cantidades con decimales se truncan).
- Marca "recibida" escribiendo estado directo.
- **Confiabilidad: baja**, pero está fuera del menú.

---

## Hallazgos detallados

### H1 — OC que figuran "Completo" / "Terminadas" sin que haya llegado nada (error funcional, alto, ejecución)
- **Síntoma:** OC-2026-1251, 1275, 1278, 1281 tienen `estado='recibida'` con todos sus renglones en 0 recibido; aparecen como "✔ Completo" y en la pestaña "Terminadas" de Compras Lazza. OC-2026-1283 tiene todo recibido y `estado='enviada'`.
- **Evidencia:** consulta a la base (5 OC); `lib/oc-lista.ts:412-417` (`estadoOC` devuelve "completo" si `oc.estado === "recibida"` antes de mirar los renglones); confirmado corriendo `estadoOC` con esos datos → "completo", `ocTerminadaLazza` → true. Origen: `lib/oc-sin-proveedor.ts:92` mueve renglones (`update orden_id`) sin recalcular el estado de la OC de origen ni de destino; el trigger `auto_estado_oc` solo corre con `UPDATE OF cantidad_recibida` y nunca baja el estado. Las 5 OC tienen la nota "renglones pasados … al cambiarles el proveedor en la OC" del 20/10.
- **Causa raíz:** el estado de mercadería vive en dos lugares (`ordenes_compra.estado` y `orden_compra_items.cantidad_recibida`) y lo escriben tres actores (cliente, trigger, RPC vieja); la vista confía primero en la columna.
- **Consecuencia:** mercadería que nadie reclama; la OC sale de "En curso".
- **Solución estructural:** que `estadoOC` derive SIEMPRE de los renglones (la columna solo para "cancelada" y `saldo_cerrado`), y un trigger único que recalcule `estado` en INSERT/DELETE/UPDATE de `orden_id` y `cantidad_recibida` (subir y bajar). Script de corrección de las 5 OC (con rollback). Esfuerzo **S/M**.

### H2 — RLS de compras sin control de sociedad ni de rol en facturas de compra (riesgo estructural, alto, estático)
- **Evidencia:** `pg_policies`: `facturas_compra` SELECT/UPDATE/DELETE con `qual = true` e INSERT `with_check = true` para cualquier `authenticated`; `factura_compra_ocs` ALL `true`; `orden_compra_items` y `proveedores` SELECT `true`; `proveedores_update` sin chequeo de sociedad. `op_facturas_compra` FK `ON DELETE CASCADE` desde `facturas_compra`.
- **Síntoma potencial:** un usuario vendedor/viewer (o un error de código sin `.eq("sociedad_id")`) puede leer, cambiar o **borrar** facturas de compra de cualquier sociedad; al borrar, se borran en cascada los vínculos con las OP (el pago queda como "anticipo").
- **Causa raíz:** la separación por sociedad y por rol depende solo del filtro del cliente. Hay `delete()` directos de `facturas_compra` en Finanzas vieja (`finanzas-vieja/page.tsx:2391`), Personalización (`:745`) y Transportes (`:509`).
- **Consecuencia:** integridad de saldos de proveedores y de OP.
- **Solución:** políticas con `lz_es_de_sociedad(sociedad_id)` y rol (como `op_facturas_compra`), DELETE solo para super_admin (o ninguno: anular), FK de `op_facturas_compra` a `RESTRICT`. Migración aditiva con rollback. Esfuerzo **M**.

### H3 — Editar OC en Compras Lazza: varios pasos sin transacción y borrados en cascada (riesgo estructural, alto, estático)
- **Evidencia:** `components/compras-lazza-oc.tsx:147-273` (DELETE renglones → UPDATE → INSERT → UPDATE encabezado → mover a otra OC → UPDATE PR), sin RPC. FK `factura_compra_asignaciones.orden_compra_item_id ON DELETE CASCADE` y `lz_oc_ajustes ON DELETE CASCADE`. No hay trigger en `factura_compra_asignaciones` que recalcule `estado_facturacion`. `asignarRenglonesAProveedor` (`lib/oc-sin-proveedor.ts:92`) cambia `orden_id` pero no `factura_compra_asignaciones.orden_compra_id` (hoy 0 desalineadas, verificado).
- **Consecuencia:** un corte de red deja la OC a medias (renglones ya borrados); sacar un renglón con factura vieja borra la asignación sin aviso; el costo del PR puede quedar distinto al de la OC.
- **Solución:** RPC `guardar_oc_lazza` que haga todo en una transacción (y recalcule estado), con control de versión (`updated_at`); al sacar renglones, "cantidad 0 / anulado" en vez de DELETE, o RESTRICT si tiene asignaciones. Esfuerzo **M/L**.

### H4 — "Pagada a mano" sin pago: unas pantallas la ven saldada y otras con deuda (error funcional, medio, ejecución)
- **Evidencia:** 3 facturas FC C (`00002-00000145`, `0001-00000415` por $ 500.000, `00002-00000140`) con `estado='pagada'` y ningún pago/OP (nota "Pagada por transferencia desde el Banco Galicia de Grupo LA"). `lib/saldo-proveedores.ts:186` y `lib/finanzas-lazza.ts:483` → saldo 0. `fc_compra_pagado` (base), `lib/saldo-factura-compra.ts:270` y el trigger `validar_saldo_aplicacion_factura_compra` → saldo = total. Corrido: `saldoFacturaCompra` (lib) = 500000, `saldoFacturaCompra` (finanzas-lazza) = 0. El comentario de `saldo-factura-compra.ts:2` dice "misma regla que la base y Finanzas" y no es cierto en este caso.
- **Consecuencia:** se puede pagar de nuevo (la base lo permite), y además el pago real hecho desde Grupo LA no figura en ninguna cuenta (pago entre sociedades sin registrar).
- **Solución:** una sola fuente: `fc_compra_pagado` (o vista `v_saldo_factura_compra`) usada por todas las pantallas; "pagada" debe salir de un pago registrado (o de un ajuste explícito con su movimiento). Registrar esos 3 pagos con su movimiento/ajuste. Esfuerzo **M**.

### H5 — El pago con tarjeta suma dos veces el crédito de una NC (riesgo, medio, estático)
- **Evidencia:** `registrar_pago_tarjeta_factura_compra` suma movimientos tipo pago **incluidos** los de NC (`nota_credito_compra_id` no se excluye) **más** `total_acreditado`. `fc_compra_pagado` y `anular_factura_compra` toman el **mayor** de los dos. Datos: las 4 facturas con NC tienen ambos rastros iguales (ej. 0002-00036697: 1.673.248,98 en las dos).
- **Consecuencia:** si se paga con Visa una factura con NC aplicada, el importe del pago sale de menos (por el doble crédito) y la factura igual queda "pagada" → deuda real escondida.
- **Solución:** que la RPC use `fc_compra_pagado`. Esfuerzo **S**.

### H6 — Proveedores duplicados por CUIT con formato distinto (error funcional, medio, ejecución)
- **Evidencia:** índice `proveedores_cuit_sociedad_key (cuit, sociedad_id)`; el alta guarda el CUIT como se tipea (`proveedor-form-modal.tsx:313-335`, `proveedores/page.tsx:604`). En Lazzari: NESTLE (`30546764040` y `30-54676404-0`), ANDRES ALBERTO FERNANDEZ (`20252946358` y `20-25294635-8`). `compras-lazza-factura.tsx:203` busca por dígitos con `.find` → toma el primero que venga.
- **Consecuencia:** facturas y OC repartidas entre dos fichas; saldo partido.
- **Solución:** guardar solo dígitos (normalizar en el form y con CHECK/índice sobre `regexp_replace(cuit,'\D','','g')`), y unir los duplicados con un script revisado. Esfuerzo **S**.

### H7 — Ejes factura/pago de la OC quedaron sin alimentar desde el 19/10 (riesgo estructural, medio, ejecución)
- **Evidencia:** 30 OC desde el 19/10, 1 con `estado_facturacion`; 32 facturas desde el 19/10, 1 vinculada. Siguen leyendo esos ejes: `compras-lista-oc.tsx:359-360` (Compras nueva), `ventas/page.tsx:79`, `finanzas-vieja/page.tsx:5655`, prompt de `api/ai/route.ts:73`; `lz_trg_saldo_cerrado_oc` usa la idea de "sin facturar".
- **Consecuencia:** las pantallas ocultas y la IA dicen "falta factura / falta pagar" en OC ya facturadas y pagadas.
- **Solución:** decidir y documentar: o se retiran esos ejes de todas las pantallas/IA, o se infiere "facturada" por proveedor+PR. Esfuerzo **S** (retirar) / **M** (inferir). Lo decide Augusto.

### H8 — Eje "Pago" de la OC calculado distinto en el cliente y en la base (error funcional, bajo, ejecución)
- **Evidencia:** `lib/oc-lista.ts:430-435`: si todas las facturas vinculadas están pagadas → "ok", aunque la OC esté facturada en parte. `lz_actualizar_fact_pago_oc` exige además `facturada` o `saldo_cerrado`. Corrido: OC con `estado_facturacion='parcial'` y una factura pagada → `ejePago = ok`.
- **Consecuencia:** en Compras nueva una OC puede pasar a "Terminada" (llegó + factura "ok" por saldo cerrado… o mostrar pago ok) distinto de lo que dice la base.
- **Solución:** usar solo `estado_pago` de la base. Esfuerzo **S**.

### H9 — Dos circuitos de carga de facturas vivos con efectos distintos; uno sin control de duplicado (riesgo estructural, medio, estático)
- **Evidencia:** Compras Lazza: sin OC y sin tocar costos. Carga masiva (`carga-masiva-global.tsx`, abierta desde Compras nueva, Compras vieja y Finanzas vieja): ata a OC y actualiza costo de OC y PR. `cargar-factura-oc.tsx:1380-1415` inserta factura, renglones y vínculos por separado y sin el control de duplicado de la base (solo aviso en el cliente, `duplicadosComprobanteCompra`). Hay un duplicado real en la base: proveedor SPEED BUSINESS S.A., `FC A 4240-00004929` cargada dos veces (10/09, transportes, viajes 07/09 y 10/09), ambas "pagadas" por $ 29.379,32 cada una — puede ser un pago doble (cargadas desde Transportes, que también inserta directo).
- **Consecuencia:** facturas duplicadas o a medias; costos del PR que cambian o no según por dónde se cargó.
- **Solución:** todas las cargas por RPC con el control de duplicado (también Transportes y Personalización); retirar la carga masiva de las pantallas ocultas o adaptarla a la regla "sin OC". Revisar el caso Speed Business con Augusto. Esfuerzo **M**.

### H10 — Llegó: escritura por valor absoluto sin control de concurrencia (riesgo, bajo, estático)
- **Evidencia:** `compras-lazza-llego.tsx:81` escribe `cantidad_recibida = c.despues` calculado con lo leído al abrir; igual en Compras nueva (`page.tsx:514`). En Corregir no se revisa el error del cambio de estado (`compras-lazza-llego.tsx:62`).
- **Consecuencia:** dos personas marcando la misma OC → se pierde una recepción.
- **Solución:** RPC `registrar_recepcion_oc(oc, [{item, suma}])` que sume en la base y recalcule estado. Esfuerzo **S**.

### H11 — Recepción en la pantalla vieja suma stock de más y la nueva no toca stock (riesgo, bajo, estático)
- **Evidencia:** `ordenes-compra/page.tsx:1010-1022`: tope en lo pedido para `cantidad_recibida` pero `increment_stock(qtyRecibida)` con lo tipeado; `increment_stock` es `security definer` sin control de rol/sociedad y parámetro `integer`. Compras Lazza "Llegó" no mueve stock (por diseño).
- **Consecuencia:** stock distinto según la pantalla usada (memoria: "Stock: no tocar sin aviso").
- **Solución:** sacar el link a la recepción vieja o igualarla; control de permisos en `increment_stock`. Esfuerzo **S**.

### H12 — Código muerto y lógica duplicada (mejora, bajo, estático)
- `components/compras-lazza-facturas-oc.tsx` no se importa en ningún lado (y además recalculaba `estado_facturacion` desde el cliente, en paralelo a la base).
- `lib/saldo-factura-compra.ts`: `saldoFacturaCompra` / `canceladoFacturaCompra` no los usa ningún componente (solo `duplicadosComprobanteCompra`), pero hay un tercer `saldoFacturaCompra` en `lib/finanzas-lazza.ts` con otra regla (H4).
- `proveedores.saldo_cuenta_corriente`: lo sigue recalculando el trigger `recalcular_saldo_proveedor` en cada movimiento (sin excluir anulados), pero nadie lo lee. Gasto inútil y dato engañoso.
- Pantalla vieja borra OC físicamente (`ordenes-compra/page.tsx:947-960`).
- **Solución:** borrar el componente muerto, unificar el saldo, eliminar el trigger viejo (migración aditiva: `drop trigger` con rollback). Esfuerzo **S**.

---

## Lo que está bien hecho

- `guardar_conciliacion_compra`: valida rol y sociedad, proveedor de la sociedad, duplicado por número normalizado + tipo con `pg_advisory_xact_lock` (no se duplica con doble clic), aviso de facturado de más que no traba, todo en una transacción.
- `anular_factura_compra`: no borra, guarda archivo de la anulación (`factura_compra_anulaciones`), avisa pagos y NC, recalcula OC. Permiso por `lz_puede_operar_finanzas`.
- `cerrar_saldo_oc` con permiso y sociedad; el trigger avisa al vendedor del PR.
- `validar_saldo_aplicacion_factura_compra`: trigger con `FOR UPDATE` que impide aplicar más que el total de la factura (OP y pagos directos).
- NC de compra por `registrar_nota_credito_compra_v2` con `request_key` idempotente e índice único.
- Lógica pura separada y probada (`compras-lazza.ts`, `compras-recepcion.ts`, `oc-lista.ts`, `saldo-proveedores.ts`): 8 suites corridas, todas OK.
- Listados grandes con `traerTodo` y filtro por `sociedad_id` (lista de OC, saldos de proveedores, vencimientos de Finanzas).
- "Llegó" deshace los renglones ya escritos si uno falla; "Nueva OC" cancela (no borra) si fallan los renglones.
- APIs de compras protegidas por el middleware (sesión obligatoria).

## Conexiones con otros módulos

| Desde | Hacia | Dato | Fuente de verdad | ¿Compatible? | Nota |
|---|---|---|---|---|---|
| Compras Lazza (cargar factura) | Finanzas (vencimientos, CC, OP) | factura de compra y su saldo | `facturas_compra` + `fc_compra_pagado` | dudoso | Finanzas usa su propio cálculo ("pagada" = 0) — H4 |
| Pago con tarjeta | Finanzas / CC | saldo cancelado | `fc_compra_pagado` | no | RPC tarjeta suma NC dos veces — H5 |
| Llegó / editar OC | Lista de OC | estado de mercadería | renglones (`cantidad_recibida`) | no | la lista confía en `ordenes_compra.estado` — H1 |
| Mover renglones (oc-sin-proveedor) | OC origen/destino | estado y asignaciones | renglones | no | no recalcula estado — H1, H3 |
| Facturas/OP | OC (ejes factura/pago) | `estado_facturacion`, `estado_pago` | triggers `lz_actualizar_fact_pago_oc` | dudoso | sin vínculo desde 19/10 — H7 |
| OC (ejes) | Ventas, Finanzas vieja, IA | OC pagada / facturada | `ordenes_compra.estado_pago` | dudoso | datos congelados — H7 |
| Carga masiva / conciliación | Presupuestos | costo y margen del renglón del PR | `guardar_conciliacion_compra` | sí | solo por ese circuito; Compras Lazza no toca costos |
| Editar OC (Compras Lazza) | Presupuestos | proveedor y costo del renglón | cliente, sin transacción | dudoso | puede quedar distinto si falla a mitad — H3 |
| Proveedores | Compras / Finanzas / Transportes | identidad del proveedor | `proveedores` (cuit único) | no | CUIT sin normalizar → duplicados — H6 |
| Transportes / Personalización | Facturas de compra | factura de compra | inserts directos | no | sin control de duplicado — H9 |
| Recepción vieja | Stock | stock de productos | `increment_stock` | no | Lazza no mueve stock; vieja suma de más — H11 |
| Cerrar saldo OC | Presupuestos (alertas) | aviso al vendedor | trigger `lz_trg_saldo_cerrado_oc` | sí | — |

## No cubierto

- Lectura completa de `ordenes-compra/page.tsx` (4031 líneas), `cargar-factura-oc.tsx` (2487) y `conciliacion-compras.tsx` (1127): solo grep de escrituras y rangos del guardado.
- No se corrieron los tests de matching (`test-purchase-matching*.cjs`, `test-factura-vs-oc*.ts`, etc.).
- RPC `ajustar_oc_a_factura`, `deshacer_ajuste_oc`, `diagnostico_diferencia_oc`, `registrar_factura_compra_con_oc_extra`, `registrar_nota_credito_compra_v2`, `aplicar_saldo_favor_proveedor`: no leídas en detalle.
- Rutas IA (`api/parse-factura-compra`, `api/compras/*`, `api/conciliar-compra`): solo se verificó que exigen sesión (middleware); no se probaron.
- Flujo de aprobación de PR → creación automática de OC (está en Presupuestos).
- Envío de OC por mail (`enviar-oc-proveedor.tsx`, `lib/oc-envio.ts`).
