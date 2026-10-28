# Auditoría integral — Agente 4: Facturación ARCA, remitos, stock, transportes, papelera, consulta de facturas

Fecha: 2026-10-28. Auditoría de SOLO LECTURA. No se llamó a ARCA ni a ningún servicio externo; no se levantó el servidor.
Consultas a la base: solo SELECT dentro de transacción READ ONLY (`scripts/lectura/sql.cjs` y un lector equivalente read-only en el scratchpad para ver definiciones de funciones sin recortes).

## Alcance revisado

Código (`crm/app/src`):
- `app/api/facturacion/route.ts` (1078 líneas, completo).
- `lib/arca-wsfe-node.ts` (completo), `lib/fiscal-emission-guard.ts`, `lib/fiscal-environment.ts`, `lib/invoice-intent.ts`, `lib/sales-credit-note.ts`, `lib/estado-factura-venta.ts`, `lib/factura-condicion.ts` (tipo por condición IVA), `lib/saldo-clientes.ts` (cobradoPorFactura / saldoFacturaVenta), `lib/factura-tipo.ts`, `lib/pdf-templates.ts` (QR).
- `components/facturacion/emitir-factura-modal.tsx` (emisión, manual, post-emisión).
- `app/(crm)/facturacion/facturacion-content.tsx` (NC ARCA/manual, facturación masiva, anular/revertir/eliminar, fetchCobradoMap, saldos).
- `components/remito-ventana.tsx` (crear/editar remito), `app/(crm)/remitos/page.tsx` (lista, anular, dividir, foto, "Autorizar AFIP"), `app/api/remito/route.ts` (501 fijo), `app/api/remitos/leer-foto`.
- `app/(crm)/stock/page.tsx`, `app/(crm)/transportes/page.tsx` (liquidar → factura de compra), `app/(crm)/papelera/page.tsx`, `components/facturas-consulta.tsx` (consulta-facturas).

Base de datos (lectura):
- Tablas: `facturas`, `factura_items`, `fiscal_emission_attempts`, `remitos`, `remito_items`, `productos`, `transportes`, `facturas_compra`, `movimientos`, `cobro_aplicaciones`, `cai_config`, `clientes`.
- Migraciones: `20260912150000_fiscal_emission_attempts.sql`, `20261008120000_notas_credito_venta_atomicas.sql`, `20261011150000_cobros_fecha_conciliado_nc_multiple.sql` (NC manual), `20260827152000_fix_multisociedad_clients_and_factura_b.sql` (trigger `recalcular_factura`).
- Funciones vivas leídas: `reservar_emision_fiscal`, `finalizar_emision_fiscal`, `registrar_nota_credito_venta_autorizada`, `crear_nota_credito_manual_venta`, `recalcular_factura`, `remito_auto_numero`, `next_cai_number`, `increment_stock`, `check_stock_bajo`, `delete_manual_invoice`.
- Índices de `facturas`, triggers de las tablas del área, políticas RLS de `facturas`, `factura_items`, `remitos`, `remito_items`, `productos`.

Pruebas corridas (puras, leídas antes; mocks, sin red ni base) — todas OK:
`test-sales-credit-note.mjs`, `test-fce-invoice.cjs`, `test-invoice-intent.cjs`, `test-fce-route.cjs` (ruta real con ARCA y Supabase simulados), `test-estado-factura-venta.mjs`, `test-remitos-armado.ts`, `test-remitos-crear.ts`, `test-remito-entrega.ts`, `test-transportes-anotador.ts`.

Datos relevantes encontrados (lectura):
- `fiscal_emission_attempts`: 121 intentos, todos `completed` (120 con 200, 1 con 422). **Ninguno trabado** hoy.
- `facturas`: ninguna factura sin renglones; ningún duplicado (tipo, PV, número); NC siempre con `factura_origen_id`.
- **20 de 120 comprobantes autorizados** tienen `facturas.total` distinto al total autorizado por ARCA (±0,01/0,02). Ver H1.
- `productos`: 0 filas (stock no se usa). `transportes`: 132. `remitos`: 129 (128 Lazzari, 1 Grupo LA), 108 con CAI. `facturas.remito_id` y `remitos.factura_id`: 0 usos.

---

## Módulo 1 — Emisión ARCA (POST /api/facturacion: FA/FB/FCEA/FCEB/NDA/NDB y NC)

1. **Función**: valida, reserva el intento fiscal, pide CAE a WSFE y guarda la factura y sus renglones; las NC se guardan por RPC atómica.
2. **Recibe**: body JSON (tipo, cliente_id, punto_venta, items, moneda, tipo_cambio, sociedad_id, presupuesto_id, fecha, FCE cbu/transmisión, factura_origen_id, nota_credito_modo…) + header `Idempotency-Key` (UUID v4) + Bearer.
3. **De dónde**: `emitir-factura-modal.tsx` (individual desde PR o libre), `facturacion-content.tsx` (NC y facturación masiva), siempre vía `lib/invoice-intent.ts::postInvoiceIntent` (clave durable en localStorage + Web Locks entre pestañas).
4. **Operaciones**: auth + rol + membresía de sociedad → modalidad dólar por ficha → validaciones (PV permitido, fecha no futura, correlatividad local, cliente de la sociedad) → cotización BNA automática → consulta obligación FCE (WSFECRED) → para NC MiPyME consulta estado FCE → `reservar_emision_fiscal` → `crearFacturaWsfeNode` (FECompUltimoAutorizado ×N tipos + FECAESolicitar con **1 solo intento**) → `finalizar_emision_fiscal(authorized)` → insert `facturas` → insert `factura_items` → `finalizar(completed)`. NC: `registrar_nota_credito_venta_autorizada` (todo en una transacción).
5. **Modifica**: `fiscal_emission_attempts`, `facturas`, `factura_items`; en NC además `facturas` origen (`total_acreditado`, `estado`) y `presupuestos.estado='facturar'` en NC total.
6. **Guarda en**: Postgres (Supabase), con la identidad del usuario (RLS) — nunca service_role.
7. **Dependen**: Finanzas/cuentas corrientes (`lib/saldo-clientes`), cobros, IVA ventas, PDF/QR (`pdf-templates.ts`), mails, Ficha 360, reportes de facturado, consulta de facturas.
8. **Depende de**: ARCA (WSAA/WSFE/WSFECRED), BNA (cotización), `clientes`, `presupuestos`, `remitos` (FCE), certificados en env de Vercel.
9. **Errores posibles**: ARCA caído (pre-envío → 422 y se libera; envío incierto → queda bloqueado), rechazo ARCA (422, se libera), fallo al guardar en la base después del CAE, fallo de renglones.
10. **Si falla una operación**:
    - Antes de enviar a ARCA: no se reserva o se finaliza como 422 → se puede reintentar. Bien.
    - Respuesta incierta de ARCA (timeout/HTTP/SOAP Errors en FECAESolicitar): el intento queda `reserved` para siempre y **bloquea todo el punto de venta** (índice único parcial `fiscal_emission_attempts_unresolved_pv`). No hay pantalla para conciliar: solo SQL manual. Ver H3.
    - ARCA autoriza y falla el insert de `facturas` (no-NC): queda `authorized`, el PV bloqueado, y reintentar devuelve el CAE guardado **pero nunca inserta la factura** (confirmado en `test-fce-route.cjs` líneas 77-78). La NC sí tiene camino de reanudación (route.ts:685-729). Ver H2.
    - Falla el insert de `factura_items`: la factura queda sin renglones, el intento queda `authorized` (PV bloqueado, route.ts:939-940).
11. **Si otro módulo cambia sus datos**: editar `factura_items` dispara `recalcular_factura` y **reescribe subtotal/iva/total** de una factura con CAE (H1, H6). Cobros cambian `estado`. NC cambian `total_acreditado`/`estado`.
12. **Pruebas**: `test-fce-route.cjs` (ruta completa con mocks: concurrencia, replay, payload cambiado, PV lock, recuperación de NC, fallo DB), `test-fiscal-emission-sql.cjs` (PGlite, no corrido: requiere módulo externo), `test-invoice-intent.cjs`, `test-fce-invoice.cjs`, `test-fce-payload.cjs`, `test-invoice-exchange-rate.cjs`, `test-fiscal-date-guard.cjs`.
13. **Problemas reales**: H1 (totales locales ≠ ARCA en 20 comprobantes, confirmado con datos), H2 (FA autorizada sin camino de recuperación local).
14. **Riesgos**: H3 (PV bloqueado sin herramienta), H6 (RLS permite editar facturas con CAE y de otra sociedad), H9 (NC manual por API sin origen), cálculo de totales duplicado en 4 lugares (route ARCA, route manual, modal, `sales-credit-note.ts`) + trigger SQL con otra regla de redondeo.
15. **Confiabilidad: media.** El circuito anti-duplicados (clave durable, lock por PV, 1 solo intento a FECAESolicitar, guarda de entorno de prueba) es muy bueno y no hay intentos trabados ni duplicados. Pero el total guardado no siempre coincide con el autorizado y la recuperación tras "ARCA OK / base falla" solo existe para NC.

## Módulo 2 — Notas de crédito de venta (ARCA y manual)

1. **Función**: emitir NC A/B/MiPyME sobre una factura y aplicar el crédito a su saldo (o dejarlo a favor del cliente).
2. **Recibe**: factura origen, modo (total/items/amount), renglones, fecha; manual: número y PV.
3. **De dónde**: `facturacion-content.tsx` (`openNcModal`, envío línea 367 vía ARCA; manual con RPC `crear_nota_credito_manual_venta`, línea ~396-415).
4. **Operaciones**: ARCA (ver módulo 1) + `registrar_nota_credito_venta_autorizada` (insert NC + items + update origen + PR a "facturar"), todo en una transacción e idempotente por `nota_credito_request_key`.
5. **Modifica**: `facturas` (NC nueva; origen `total_acreditado`, `estado`), `factura_items`, `presupuestos.estado`.
6. **Guarda en**: Postgres.
7. **Dependen**: saldos de clientes (`saldo-clientes.ts` usa `total_acreditado` y `saldo_a_favor_cliente`), cobros, IVA, reportes.
8. **Depende de**: `movimientos` y `cobro_aplicaciones` (para calcular lo ya cobrado).
9. **Errores posibles**: RPC falla después del CAE (se reintenta con la misma clave: bien), doble conteo de lo cobrado (H5), céntimos fantasma (H1).
10. **Si falla**: la NC queda `authorized` y el reintento con el mismo formulario la completa (route.ts:685-729). Bien resuelto.
11. **Si otro módulo cambia datos**: si un cobro se carga con `movimientos.factura_id` y además con `cobro_aplicaciones` para la misma factura, la RPC lo cuenta dos veces (H5).
12. **Pruebas**: `test-sales-credit-note.mjs` (OK), `test-fce-route.cjs` (recuperación NC), `test-nc-sugerencia.ts`.
13. **Problemas reales**: NCEA 0015-00000001 dejó `saldo_a_favor_cliente = 0,01` fantasma (consecuencia de H1). NC externa NCA 0001-00000025 ($ 26.954.340,91) anula tres facturas (FA 15-10, 15-19, 15-30: 7.623.000 + 10.110.492,35 + 9.220.848,56 = 26.954.340,91) pero está atada solo a FA 15-10 con `credito_aplicado` = total (3,5× la factura). Los saldos cierran porque las tres FA tienen `total_acreditado` y estado anulada, pero el dato es engañoso para cualquier reporte "NC por factura".
14. **Riesgos**: H5; NC "total" sobre factura ya cobrada pasa la factura a `anulada` y deja todo como saldo a favor (diseño válido, pero reportes que excluyen anuladas pierden el cobro asociado); NC legacy (antes del 08/10) con `credito_aplicado = 0` aunque anularon su factura: dos semánticas conviviendo.
15. **Confiabilidad: media-alta.** Atómica e idempotente; el cálculo de "cobrado" difiere del de TypeScript.

## Módulo 3 — Facturación masiva (facturacion-content.tsx:648-702)

1. Emite FA/FB para varios PR aprobados con una fecha común.
2. Recibe PR seleccionados con renglones, fecha.
3. Desde la pantalla Facturación.
4. Por PR: cotización BNA (si USD) → `postInvoiceIntent` → si `success`, update `presupuestos.estado='facturado'` desde el navegador.
5. Modifica `facturas`, `factura_items`, `presupuestos`.
6. Postgres.
7. Dependen: PR, resto a facturar, Finanzas.
8. Depende de la ruta de emisión.
9. Errores: tipo de comprobante elegido con otra regla que el modal (H7); trata `reconciliation_required` como éxito y marca el PR facturado aunque la factura no quedó guardada; no guarda "resto a facturar".
10. Si falla el update del PR: avisa, factura queda emitida (aceptable).
11. —
12. Sin prueba específica; el propio código dice "PENDIENTE DE VERIFICAR EN PRODUCCIÓN" (línea 662).
13. H7 (monotributistas: FB en masiva vs FA en el modal).
14. Duplicación de reglas con el modal.
15. **Confiabilidad: baja-media** (sin verificar en producción, reglas propias).

## Módulo 4 — Comprobante X / factura manual (route.ts:265-389, modal `handleEmitManual`)

1. Registra un comprobante sin ARCA (talonario X, PV 0).
2. Mismo body + `manual: true`, `numero_manual`.
3. Modal de emisión (solo tipo X).
4. Validaciones → insert `facturas` → insert `factura_items` (error ignorado) → PR facturado (cliente).
5. `facturas`, `factura_items`, `presupuestos`.
6. Postgres.
7. Saldos, cobros, reportes.
8. —
9. Número repetido; renglones que no se guardan (se responde éxito igual, route.ts:374-377).
10. Sin idempotencia en el servidor (no reserva intento); un doble envío falla por el índice único (bien), pero con mensaje crudo.
11. —
12. `test-facturacion-auth-date.cjs` (no corrido).
13. —
14. H8: el índice único `facturas_tipo_punto_venta_numero_key (tipo, punto_venta, numero)` **no incluye `sociedad_id`** y el X usa PV 0 en ambas sociedades: el X N° k de Grupo LA choca con el X N° k de Lazzari. Hoy Grupo LA no tiene X. La API acepta además tipos NCA/NCB manuales sin `factura_origen_id` (H9; la UI no lo usa).
15. **Confiabilidad: media.**

## Módulo 5 — Anular / revertir / eliminar factura (facturacion-content.tsx:705-740)

1. Anular comprobante sin CAE, revertir, eliminar manual.
2. id de factura.
3. Panel de detalle; botones solo si `!cae` (líneas 1891, 1903).
4. Update directo `estado` / RPC `delete_manual_invoice` (verifica sin CAE, anulada, sin movimientos, remitos ni NC).
5. `facturas`.
6. Postgres.
7. Saldos (anulada no cuenta).
8. —
9. Anular un X con cobros: no se avisa; el cobro queda atado a una factura que no cuenta en el saldo.
10. —
11. —
12. —
13. —
14. La restricción "sin CAE" está solo en la UI; la RLS permite a admin/administrativo cambiar `estado` (o `total`) de cualquier factura, con CAE y de cualquier sociedad (H6).
15. **Confiabilidad: media** (la RPC de eliminar está bien hecha; anular/revertir son updates sueltos).

## Módulo 6 — Remitos (remito-ventana.tsx, remitos/page.tsx)

1. Crear/editar remitos (internos, muestra, con CAI), repartir por sucursal, anular, dividir, foto firmada, viaje de transporte.
2. Cliente, PR, renglones, sucursal, entrega/transporte, OC.
3. Ventana de remito (desde PR, Remitos), lista de Remitos.
4. Crear: `next_cai_number` (si CAI) → insert `remitos` (número por trigger `remito_auto_numero` → `generate_document_number`) → insert `remito_items` → si falla, delete del remito (compensación) → `guardarEntrega` (transportes). Editar: update remito → insert renglones nuevos → delete viejos. Anular: update `anulado` + cancelar viajes no liquidados. Dividir: ver H4.
5. `remitos`, `remito_items`, `transportes`, `presupuestos.oc_cliente`, `alertas`, `cai_config.ultimo_usado`, Storage `comprobantes`.
6. Postgres + Storage.
7. Estado de entrega del PR (`remitos-armado.estadoEntrega`), FCE (lista de remitos por PR, route.ts:583), Transportes, PDF.
8. `cai_config`, `cliente_sucursales`, `transportistas`.
9. Sin transacción: un fallo entre pasos deja el remito a medias (compensado en crear; no compensado en dividir).
10. Crear: si fallan los renglones se borra el remito y avisa que el número de CAI quedó usado (bien). Editar: inserta nuevos antes de borrar viejos (nunca queda vacío; puede quedar duplicado, y avisa). Dividir: **borra todos los renglones antes de reinsertar y no revisa errores** (H4).
11. Si se anula una factura o NC, el remito no cambia (correcto: "remito hecho = entregado").
12. `test-remitos-armado.ts`, `test-remitos-crear.ts`, `test-remito-entrega.ts` (todos OK, lógica pura).
13. H4.
14. Lista sin `traerTodo` (remitos/page.tsx:267-275): hoy 128 filas, se corta a 1000 en silencio. `/api/remito` responde 501 fijo pero la pantalla todavía tiene `handleAutorizarAFIP` (código muerto, sin botón visible verificado). `facturas.remito_id` y `remitos.factura_id` existen pero nadie los llena: el vínculo remito↔factura es solo por `presupuesto_id`.
15. **Confiabilidad: media** (crear/anular bien pensados; dividir es frágil).

## Módulo 7 — Stock (stock/page.tsx)

1. ABM de artículos con stock, mínimo, costo; ajuste de stock.
2. Formulario de artículo; ajuste "set" o "sumar".
3. Pantalla Stock; recepción de OC (`ordenes-compra/page.tsx:1022, 1094, 1205`) usa `increment_stock`.
4. insert/update/delete `productos`; `increment_stock` (atómico); trigger `check_stock_bajo` → `alertas`.
5. `productos`, `alertas`, `precio_historial` (trigger).
6. Postgres.
7. Widget IA (stock bajo), OC.
8. —
9. `increment_stock` hace `GREATEST(0, …)`: una salida mayor al stock se recorta a 0 en silencio. No valida sociedad (security definer, cualquier `producto_id`). Editar el artículo reescribe `stock` con el valor del formulario (pisa ajustes concurrentes). Borrado físico de artículos. Sin libro de movimientos de stock. Los remitos no descuentan stock.
10. —
11. —
12. Ninguna.
13. Ninguno hoy: **`productos` tiene 0 filas** (módulo sin uso). Por la regla "Stock: no tocar sin aviso", solo se documenta.
14. Si se empieza a usar: falta de kardex, recorte silencioso, sin vínculo con remitos.
15. **Confiabilidad: baja** (para usarlo en serio); irrelevante hoy.

## Módulo 8 — Transportes (transportes/page.tsx, lib/transportes-anotador.ts)

1. Anotador de viajes por transportista, costo, liquidación → factura de compra a pagar.
2. Viajes, costo, proveedor, comprobante (PDF) o liquidación interna.
3. Pantalla Transportes; Remitos crea viajes (`guardarEntrega`).
4. Liquidar: busca duplicado → insert `facturas_compra` → upload a Storage → update `archivo_url` → update `transportes.factura_compra_id`; si algo falla, borra la factura y el archivo (compensación).
5. `transportes`, `facturas_compra`, Storage `facturas-compra`.
6. Postgres + Storage.
7. Finanzas/Compras (cuentas a pagar, OP, IVA compras).
8. Proveedores (`es_transportista`).
9. Compensación con delete: si el delete compensatorio también falla, queda una factura huérfana sin viajes (raro).
10. Ver 9.
11. Edición de costo bloqueada si ya tiene `factura_compra_id` (`.is("factura_compra_id", null)`, líneas 320 y 347). Bien.
12. `test-transportes-anotador.ts` (OK), `test-transport-invoice-upload.mjs` (no corrido).
13. H10: la factura se crea con `tipo: "mercaderia"` (línea 470) aunque existe el tipo `"transporte"` y las 15 facturas de transporte que hay en la base tienen `tipo='transporte'` (cargadas el 07/10 por otro camino). La próxima liquidación quedará como "Mercadería".
14. Duplicado verificado solo por número + proveedor (no por tipo/PV), bien para el caso.
15. **Confiabilidad: media-alta.**

## Módulo 9 — Papelera (papelera/page.tsx)

1. Lista y recupera presupuestos eliminados (borrado lógico `eliminado=true`).
2–6. Lee `presupuestos` por `sociedad_id`; recuperar = update `eliminado=false` con filtros de sociedad y estado.
7–8. Presupuestos.
9–11. Sin paginación (pocos registros). Solo cubre presupuestos aunque el subtítulo dice "Registros eliminados".
12. —
13. Ninguno.
14. Bajo.
15. **Confiabilidad: alta** para lo que hace.

## Módulo 10 — Consulta de facturas (components/facturas-consulta.tsx)

1. Buscador unificado de facturas de venta y compra.
2–6. Solo lectura, `traerTodo` paginado, filtrado por `sociedad_id`.
7–8. Depende de `facturas`, `facturas_compra`, OP.
9–11. Muestra `facturas.total` (el local, ver H1).
12. —
13. Ninguno propio.
14. Bajo.
15. **Confiabilidad: alta.**

---

## Hallazgos detallados

### H1 — El total guardado de la factura no es el autorizado por ARCA (trigger `recalcular_factura`) — ALTO, error funcional, certeza: ejecución (datos)
- **Evidencia**: trigger `recalcular_factura_totales AFTER INSERT OR DELETE OR UPDATE ON factura_items` → `public.recalcular_factura()` (migración `20260827152000_fix_multisociedad_clients_and_factura_b.sql`) recalcula `subtotal/iva/total` sumando sin redondear por renglón y redondeando al final. La ruta (`route.ts:512-551`) y ARCA redondean el IVA **por renglón**. La NC RPC también inserta renglones después de la cabecera (migración 20261008120000 líneas 244-253) y dispara el trigger.
- **Consulta**: cruzando `fiscal_emission_attempts.response->factura->total` (= ImpTotal enviado a ARCA) con `facturas.total`: **20 de 120** comprobantes difieren en ±0,01/0,02 (p. ej. FA 0015-00000077: ARCA 1.076.208,61 vs base 1.076.208,63; FCEA 0016-00000001: 5.898,84 vs 5.898,83; NCEA 0015-00000001 igual).
- **Síntoma**: el PDF y el QR (`lib/pdf-templates.ts:592`, `importe: Number(f.total)`) muestran un importe distinto al autorizado; saldos de 0,01 que no cierran; NCEA 0015-1 dejó `saldo_a_favor_cliente = 0,01` fantasma (la RPC calculó con 5.898,84 y luego el trigger bajó el total a 5.898,83).
- **Causa raíz**: dos fuentes de verdad para el total (el cálculo enviado a ARCA y el trigger SQL) con reglas de redondeo distintas.
- **Consecuencia**: diferencias de centavos contra ARCA en Libro IVA Digital / Mis Comprobantes, QR que no coincide, facturas que quedan "parcial" por 0,01, crédito fantasma. Riesgo de que el contador tenga que explicar diferencias.
- **Solución estructural**: el total de un comprobante con CAE es inmutable y viene de lo autorizado. Cambiar el trigger para que **no toque facturas con `cae` no nulo** (o que redondee por renglón igual que ARCA y solo aplique a X); guardar `subtotal/iva/total` tal como se enviaron a ARCA. Script de corrección de los 20 comprobantes (con rollback) tomando el total de `fiscal_emission_attempts.response`. Test que compare ruta vs trigger.
- **Esfuerzo**: M.

### H2 — "ARCA autorizó y falló el guardado" solo se recupera en NC; en FA/FB/FCE/ND no — ALTO, riesgo estructural, certeza: ejecución (test con mocks)
- **Evidencia**: `route.ts:795-801` marca `authorized` antes del insert; si el insert de `facturas` falla (`route.ts:894-906`) devuelve `success:true, reconciliation_required:true` sin `id`. En el reintento con la misma clave, `route.ts:684-731` solo reconcilia si `isSalesCreditNote`; para el resto devuelve la respuesta guardada (`route.ts:730`) y **no inserta**. `test-fce-route.cjs:77-78` lo confirma: tras fallar la tabla, el reintento devuelve el CAE con `reconciliation_required:true` y nunca guarda.
- **Síntoma**: factura válida en ARCA que no existe en el CRM (no suma deuda del cliente, no se cobra, no va al IVA), y el punto de venta queda bloqueado (estado `authorized` cuenta para el índice único parcial).
- **Agravantes**: `emitir-factura-modal.tsx:476-481` y la masiva (`facturacion-content.tsx:690-693`) tratan `success:true` como éxito: marcan el PR "facturado" y `guardarResto(data.factura.id)` con `id` indefinido.
- **Causa raíz**: la reanudación idempotente se implementó solo para NC (RPC `registrar_nota_credito_venta_autorizada`); la factura común sigue con dos inserts sueltos desde la ruta.
- **Solución estructural**: RPC `registrar_factura_venta_autorizada(p_sociedad_id, p_request_key, p_factura, p_items)` análoga a la de NC: valida el intento `authorized`, inserta cabecera + renglones en una transacción, idempotente por `request_key` (columna nueva `emision_request_key` con índice único), y la ruta la reintenta en el replay igual que la NC. En la UI, no marcar PR facturado si `reconciliation_required`.
- **Esfuerzo**: M.

### H3 — Un intento incierto bloquea el punto de venta sin herramienta de conciliación — MEDIO, riesgo estructural, certeza: estático
- **Evidencia**: índice `fiscal_emission_attempts_unresolved_pv (sociedad_id, punto_venta) where state in ('reserved','authorized')` (migración 20260912150000); tabla sin acceso para `authenticated`; `crearFacturaWsfeNode` hace 1 solo intento (`arca-wsfe-node.ts:212-214`) y cualquier error de transporte o `Errors` de WSFE se trata como incierto (route.ts:765 relanza → 500, el intento queda `reserved`). Errores de `postSoap` con `result.Errors` (rechazo de cabecera, p. ej. 10016) también caen acá aunque no hubo CAE.
- **Síntoma**: "Este punto de venta tiene una emisión pendiente de conciliación con ARCA" para todos los usuarios; Grupo LA tiene un único PV (10), Lazzari tiene 15 y 16.
- **Causa raíz**: diseño fail-closed correcto, pero la única salida es SQL a mano (`scripts/fiscal-emission-migration-recovery.sql` es la migración, no un procedimiento de conciliación).
- **Consecuencia**: facturación frenada (choca con la regla 1 del negocio "nada me puede frenar") hasta que alguien con acceso a la base concilie.
- **Solución estructural**: acción de servidor "Conciliar intento" (solo admin): consulta `FECompConsultar` del número esperado; si existe con mismo importe/receptor, registra la factura (H2) y completa; si no existe, marca `completed` con 422 y libera. Distinguir en `postSoap` los `Errors` de cabecera (rechazo seguro) de fallos de transporte. Hoy no hay intentos trabados (consulta: 121 `completed`).
- **Esfuerzo**: M.

### H4 — Dividir remito borra todos los renglones antes de reinsertar y no revisa errores — ALTO, error funcional, certeza: estático
- **Evidencia**: `remitos/page.tsx:524-597` (`handleSplitSave`): update `sucursal_id` sin chequear error (526), `delete remito_items` sin chequear (529), insert de los que quedan sin chequear (539), por cada grupo `next_cai_number` + insert remito + insert items sin chequear (589). Botón visible en el detalle (`remitos/page.tsx:946`). A diferencia de `guardarEdicion` (remito-ventana.tsx:487-494), que inserta antes de borrar.
- **Síntoma**: si el insert falla (red, RLS, dato inválido), el remito original queda **sin renglones**; si falla a mitad del bucle quedan remitos nuevos sin renglones y números de CAI consumidos.
- **Causa raíz**: operación de varios pasos desde el navegador, sin transacción ni compensación.
- **Consecuencia**: pérdida de renglones de un remito (algunos con CAI ya impreso), estado de entrega del PR mal calculado (`remitos-armado` suma `remito_items`).
- **Solución estructural**: RPC `dividir_remito(p_remito_id, p_grupos jsonb)` en una transacción (incluye `next_cai_number`); como mínimo inmediato, insertar antes de borrar y chequear `{error}` en cada paso.
- **Esfuerzo**: S (parche) / M (RPC).

### H5 — La regla "cuánto se cobró de una factura" está distinta en SQL y en TypeScript — MEDIO, riesgo estructural, certeza: estático (sin casos hoy)
- **Evidencia**: `registrar_nota_credito_venta_autorizada` (migración 20261008120000:209-221) y `crear_nota_credito_manual_venta` (función viva, líneas 132-144) suman `movimientos.factura_id` + `cobro_aplicaciones` **sin excluir** los movimientos que ya tienen aplicaciones y **sin filtrar moneda**. `lib/saldo-clientes.ts:80-105` (`cobradoPorFactura`) y `facturacion-content.tsx:909-950` (`fetchCobradoMap`) excluyen los movimientos aplicados y saltean/frenan monedas distintas.
- **Consulta**: hoy 0 movimientos con `factura_id` y aplicaciones a la vez; 0 movimientos en otra moneda que su factura.
- **Consecuencia (si aparece el caso)**: la NC calcula un saldo previo menor, aplica menos y deja saldo a favor de más, o pasa la factura a "anulada/pagada" con importes que no coinciden con la cuenta corriente.
- **Solución**: una sola función SQL `cobrado_factura_venta(p_factura_id)` con la regla de `saldo-clientes.ts`, usada por las dos RPC (y exponerla para la UI).
- **Esfuerzo**: S.

### H6 — RLS de facturas/renglones/remitos sin aislamiento por sociedad ni protección de comprobantes con CAE — MEDIO, riesgo estructural, certeza: estático (políticas leídas)
- **Evidencia** (`pg_policies`): `facturas_update` USING solo rol (admin/administrativo/super_admin); `facturas_select` solo rol; `fc_items_modify` ALL solo rol; `remitos_modify`/`remito_items_modify` `can_write()`; `remitos_select` `true`. Ninguna condiciona `sociedad_id` ni `cae is null`.
- **Síntoma potencial**: cualquier admin/administrativo puede, desde el navegador, cambiar `total`, `estado` o renglones de una factura con CAE (y el trigger de H1 recalcula el total), o leer/editar datos de la otra sociedad. Los filtros por sociedad dependen de que cada pantalla los ponga (las revisadas los ponen).
- **Solución**: políticas con `sociedad_id in (select sociedad_id from user_sociedades where user_id = auth.uid())`; trigger `BEFORE UPDATE/DELETE` en `facturas` y `factura_items` que rechace cambios de importes/renglones cuando `cae is not null` (permitiendo `estado`, mails, notas por las RPC).
- **Esfuerzo**: M.

### H7 — Facturación masiva elige FA/FB con otra regla que el modal — MEDIO, error funcional, certeza: estático
- **Evidencia**: `facturacion-content.tsx:660-661` → FA solo si `condicion_iva` es RI; `lib/factura-condicion.ts:55-57` (`tipoFacturaPorCondicionIva`, usado por el modal en `emitir-factura-modal.tsx:115, 675`) → FA para RI **y Monotributo**. La ruta acepta ambos (`route.ts:481`). Hay 12 clientes Monotributo.
- **Consecuencia**: el mismo PR sale FB por masiva y FA por el modal (salvo que el PR tenga `tipo_comprobante`).
- **Solución**: usar `tipoFacturaPorCondicionIva` en la masiva.
- **Esfuerzo**: S.

### H8 — Índice único de facturas sin `sociedad_id` (choca el comprobante X entre sociedades) — BAJO, riesgo estructural, certeza: estático
- **Evidencia**: `facturas_tipo_punto_venta_numero_key UNIQUE (tipo, punto_venta, numero)`; el X usa PV 0 en las dos sociedades (`route.ts:162-163`); la validación de correlatividad filtra por sociedad (`route.ts:182-198`) así que no lo detecta. Grupo LA hoy no tiene X.
- **Consecuencia**: el primer X de Grupo LA con un número ya usado por Lazzari falla con error crudo de clave duplicada.
- **Solución**: índice nuevo `(sociedad_id, tipo, punto_venta, numero)` y luego retirar el viejo (aditivo primero).
- **Esfuerzo**: S.

### H9 — La API manual acepta NC/ND sin factura origen ni aplicación — BAJO, riesgo, certeza: estático
- **Evidencia**: `SUPPORTED_MANUAL_TYPES = {X, FA, FB, NCA, NCB, …}` (`route.ts:137`); en modo manual no se exige ni se guarda `factura_origen_id` (`route.ts:325-351`). La UI solo manda `tipo: "X"` y las NC manuales van por `crear_nota_credito_manual_venta`, así que hoy no se usa.
- **Consecuencia**: una llamada directa crearía una NC "suelta" que `saldo-clientes` toma entera como saldo a favor, sin bajar la factura.
- **Solución**: en modo manual aceptar solo `X`.
- **Esfuerzo**: S.

### H10 — Liquidar transporte crea la factura de compra como "mercadería" — MEDIO, error funcional, certeza: estático + datos
- **Evidencia**: `transportes/page.tsx:470` `tipo: "mercaderia"`; existe `"transporte"` en `lib/factura-tipo.ts:4` y en Finanzas; las 15 facturas atadas a viajes en la base tienen `tipo='transporte'`.
- **Consecuencia**: las próximas liquidaciones aparecen como compra de mercadería (filtros, reportes de gastos, conciliación con OC que espera mercadería con OC).
- **Solución**: `tipo: "transporte"`.
- **Esfuerzo**: S.

### H11 — Post-emisión hecha desde el navegador (PR facturado, resto a facturar) — BAJO, riesgo, certeza: estático
- **Evidencia**: `emitir-factura-modal.tsx:424-451, 476-478`; masiva `facturacion-content.tsx:692`.
- **Consecuencia**: si se cierra la pestaña justo después del CAE, el PR no queda "facturado" ni se guarda el resto; el PR sigue apareciendo para facturar (la masiva lo filtra por "sin factura vigente", el modal no frena: correcto por la regla 1, pero conviene avisar).
- **Solución**: hacer el cambio de estado del PR dentro de la misma RPC de registro (H2), y en el modal avisar "este PR ya tiene la factura X" (aviso, no bloqueo).
- **Esfuerzo**: S (con H2).

### H12 — Listados sin paginar: Remitos y Stock — BAJO, riesgo, certeza: estático
- **Evidencia**: `remitos/page.tsx:267-275` y `stock/page.tsx:128-134` sin `traerTodo` (tope 1000 de Supabase). Hoy 128 remitos y 0 productos.
- **Solución**: `traerTodo`.
- **Esfuerzo**: S.

### Mejoras menores (deuda)
- `route.ts:1064` `status` devuelve `production: true` fijo aunque `ARCA_PRODUCTION=false`.
- Cálculo de totales duplicado en route (ARCA y manual), modal (`emitTotals`) y `sales-credit-note.ts`: mover a una función pura única en `src/lib` y usarla también para verificar el trigger.
- `remitos/page.tsx:419-454` `handleAutorizarAFIP` contra una ruta que siempre responde 501: código muerto.
- `facturas.remito_id` / `remitos.factura_id` sin uso: o se llenan (FCE usa remitos por PR) o se documentan como obsoletas.
- NC externa NCA 0001-25 atada a una sola de las tres FA que anula: para reportes "NC por factura" conviene una tabla de aplicaciones de NC (n:m).
- `increment_stock`: valida sociedad y avisa si el resultado sería negativo en vez de recortar a 0 (cuando se use stock).

## Lo que está bien hecho
- Anti-duplicado fiscal sólido: clave durable por intención (localStorage + Web Locks entre pestañas, `lib/invoice-intent.ts`), reserva en base antes de WSFE, lock por PV, hash del payload, **un solo intento** a FECAESolicitar (no reintenta una mutación fiscal), número tomado de `FECompUltimoAutorizado` de ARCA (no de la base). Datos: 0 duplicados, 0 intentos trabados.
- `assertSafeFiscalEnvironment` impide que un preview/homologación apunte a la base productiva; la API usa la sesión del usuario, nunca service_role.
- NC: RPC atómica, idempotente y reanudable después del CAE; validación de tipo origen ↔ NC, estado de la FCE en el Registro antes de una NC MiPyME (Rechazado → solo total con anulación "S").
- FCE: verificación de obligación en ARCA, monto mínimo, CBU con dígitos verificadores, plazo; si no se puede verificar y el usuario eligió FCE, no emite.
- `delete_manual_invoice`: solo sin CAE, anulada, sin movimientos/remitos/NC.
- Anular remito no borra; cancela viajes no liquidados y avisa por los liquidados. Editar remito inserta antes de borrar.
- Transportes: edición de costo bloqueada si ya está liquidado; compensación al fallar la liquidación.
- Consulta de facturas y Facturación paginan con `traerTodo` y filtran por sociedad; `saldo-clientes.ts` centraliza el saldo de clientes.
- Buena batería de tests con mocks para la ruta fiscal (todos pasan).

## Conexiones con otros módulos

| Desde | Hacia | Dato | Fuente de verdad | ¿Compatible? | Nota |
|---|---|---|---|---|---|
| Emisión ARCA | Finanzas / saldos clientes | total de la factura | ARCA (ImpTotal) vs `facturas.total` (trigger) | No | H1: 20 comprobantes difieren en centavos |
| NC (RPC SQL) | Saldos clientes (`saldo-clientes.ts`) | cobrado por factura | dos implementaciones (SQL y TS) | Dudoso | H5: reglas distintas, sin casos hoy |
| NC | Factura origen | `total_acreditado`, `estado` | RPC atómica | Sí | NC legacy con `credito_aplicado=0`; NC externa multi-factura atada a una |
| Emisión | Presupuestos | estado "facturado" | update desde navegador | Dudoso | H11; masiva marca facturado aun con reconciliación pendiente (H2) |
| NC total | Presupuestos | estado "facturar" | RPC | Sí | dentro de la transacción |
| Emisión FCE | Remitos | números de remito del PR | `remitos.presupuesto_id` | Sí | `facturas.remito_id`/`remitos.factura_id` sin uso |
| Remitos | Estado de entrega del PR | cantidades remitidas | `remito_items` | Dudoso | H4 puede dejar remitos sin renglones |
| Remitos | Transportes | viaje del remito | `transportes.remito_id` | Sí | anular cancela no liquidados |
| Transportes | Compras/Finanzas | factura de compra de transporte | `facturas_compra.tipo` | No | H10 se guarda "mercaderia" |
| Recepción OC | Stock | cantidad recibida | `increment_stock` | Dudoso | sin sociedad ni kardex; `productos` vacío |
| Facturas | PDF/QR | importe | `facturas.total` | No | QR con total local ≠ ARCA (H1) |
| Masiva vs modal | ARCA | tipo FA/FB | `tipoFacturaPorCondicionIva` vs regla local | No | H7 monotributistas |
