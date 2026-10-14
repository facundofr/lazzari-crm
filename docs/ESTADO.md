# Estado del proyecto — CRM Lazzari

**TANDA "PENDIENTES 9 PUNTOS" (14/10/2026, chat "Pendientes 9 puntos"; Augusto dio OK a todo; puntos 1 a 8b HECHOS en código; NADA PUBLICADO; coordinar cada vercel --prod con el chat "CRM", que publicó V1.1.452 → la próxima es 1.1.453 o la que siga).**
- **HECHO en código (sin commit, tsc 0, hooks OK, pruebas OK):** (a) `lib/factura-vs-oc.ts` `controlIva` devuelve `renglones21` (renglones con IVA < 21 % que pasados a 21 % dan justo); `cargar-factura-oc.tsx`: el aviso "No cuadra con el PDF" nombra ese renglón y trae botón "Poner 21 % a ese renglón". Caso NEXO A0003-00005284 (todavía no guardada): envío $90.000 leído con IVA 0 % → diferencia $18.900 (prueba en `scripts/test-factura-vs-oc.ts`). (b) `lib/numero-ar.ts` + `scripts/test-numero-ar.ts` (parseNumeroAR "1.000"=1000, formatCantidad, avisosRenglon): creado y ya ENCHUFADO en presupuestos (punto 3).
- **HECHOS 1 a 8b (14/10, mismo chat, SIN COMMIT y SIN PUBLICAR; tsc 0, hooks OK, test-numero-ar y test-factura-vs-oc OK, guía actualizada y `guia-a-ts --check` OK):**
  1. `cargar-factura-oc.tsx`: el renglón de envío ya no sale en amarillo ("no está en la OC"); un solo recuadro violeta con la elección de OC chiquita adentro (Agregar a OC-xxx / OC nueva / Solo en la factura).
  2. Lectura sin IA + OC con artículos: se precargan los renglones de la OC (tempId `oc-<id>`, emparejados a su línea, una vez por archivo; IVA 0 si es nota de pedido) + aviso "Ítems traídos de OC-xxx: corregí solo lo que cambió" y diferencia contra el neto leído. ⚠️ Toma la cantidad TOTAL de la OC (si ya hubo una factura parcial, corregir a mano). SIN PROBAR con un PDF real (no se cargó ninguna factura).
  3. Cantidad del PR: `NumInput miles` (parseNumeroAR: "1.000" = mil, "2,5"); aviso amarillo en el renglón por decimales (en cualquier unidad) o precio 0. Probado en local (1.000 → 1000; 2,5 → aviso).
  4. Detalle del PR: franja (ítems · total · ganancia · margen · sin costo · con aviso), botón "Ocultar costos" (localStorage `lz-pr-ocultar-costos`; oculta P. Costo, Markup y Margen real), avisos en el renglón, cantidades con punto de miles, tarjetas en celular, pantalla completa recordada (`lz-pr-fullscreen`). Probado en local con PR-2026-1102.
  5. Seguimiento: renglones apretados (días con color, N°, estado, cliente, vendedor, enviado, subtotal, motivo, select, Llamar) y chips chicos. Probado.
  6. Botón Vencido al lado de Pendiente (rojo si hay) + franja roja "X vencidos (últimos 30 días) · montos sin IVA → Ver" (usa `vencimiento`). Probado: 13 vencidos.
  7. `puedeEliminarPR`: admin cualquiera; vendedor solo `created_by` suyo y no aprobado/facturar/facturado. Pide motivo (prompt, puede ir vacío; Cancelar no hace nada) y anota en `notas_internas` "[fecha] Eliminado por X: motivo"; OC vinculadas solo las ofrece cancelar al admin. Papelera muestra el motivo. Sin migración (RLS presupuestos_update ya lo permite). SIN PROBAR eliminando (guardaría).
  8. Solicitud: botones "✨ Armar con IA" (abre Cotización express con el texto, prop `textoInicial`) y "Elegir productos (como en un PR)" (muestra Items; se guardan con buildItemRows). Placeholder corregido (decía válvulas). Probado en local hasta abrir la express con el texto.
  8b. `api/cotizacion-express`: "extraer" devuelve `preguntas` (nunca inventa) y acepta `respuestas`; modo nuevo `ajustar` (agregar/cambiar/quitar/preguntas/resumen); "elegir" respeta `proveedor_preferido` por línea. Pantalla: fase "preguntas" (Seguir con mis respuestas / Seguir sin responder) y en la revisión el casillero "Decile a la IA qué cambiar" + Aplicar (re-busca y re-elige solo lo nuevo o cambiado; preguntas de ajuste con "Responder y aplicar"). SIN PROBAR con IA real (cada llamada anota en ia_uso y cuesta ≈ US$ 0,01): probar en producción.
- **PUBLICADO V1.1.453 (14/10, commit 925c22d):** solo los archivos de esta tanda. Los cambios del chat "CRM" (dólar de referencia en Gastos fijos, Stock en el menú, migración 20261014210000 SIN CORRER) quedaron AFUERA a pedido de ese chat: se publicó desde una copia limpia del commit (git worktree temporal, ya borrado). **Siguen sin commit en la carpeta; ⚠️ un `vercel --prod` desde `crm\app` los subiría: antes, correr esa migración o publicar desde copia limpia.**
- **V1.1.454 (14/10 noche, Claude con OK de Augusto "hacé todo vos"):** (1) migración 20261014210000_gasto_fijo_dolar_referencia CORRIDA por Claude (la que había pegado Augusto no había quedado: la columna no existía); (2) migración de datos 20261014240000_alquiler_dolar_referencia (+ rollback): Alquiler US$ 800 con dólar $1.545 (blue), verificado; (3) commit de dólar de referencia en Gastos fijos + Stock en el menú + migraciones Bogado 220000/230000 (ya corridas); (4) ventanas de detalle PR y OC compactas (presupuestos/page.tsx: panel @container max-w-3xl, título en una línea, botones solo ícono si es angosto, datos 2/3/4 columnas, tabla text-xs, tarjetas en panel angosto; ordenes-compra/page.tsx: max-w-3xl y tablas text-xs). tsc 0, hooks OK, test-cobertura-fijos OK.
- **Probado en producción sin guardar (sidebar V1.1.453; sigue en 208 PR):** franja "13 vencidos" OK. **8b OK:** express con "10 botines y 20 anteojos" → preguntó talle y tipo de anteojo; con "talle 42 / incoloro" eligió DPS talle 42 y anteojo incoloro; "agregame 15 pares de guantes de nitrilo talle 9" → agregó la línea (3 líneas, US$ 371,05) y preguntó marca (Responder y aplicar / Dejar así). Se canceló sin agregar. **9 OK** (responde; IA del mes US$ 0,02 de 5), **pero ⚠️ hallazgo:** "¿cuántos vencidos de los últimos 30 días?" → dijo 1 (PR-2026-1165 Corteva $0, 22/09) mientras la franja dice 13: la IA filtra por estado "vencido" y la franja por fecha `vencimiento`. Pendiente: enseñarle en la guía/prompt qué es "vencido" (PR pendiente con vencimiento pasado). Revisar también PR-2026-1165 (total $0).

Actualizado: 14/10/2026 · Publicadas esta noche, en dos deploys seguidos y verificadas desde afuera (login 200, encabezados de seguridad activos): **V1.1.442** (commit 98c866e) y **V1.1.443** (commit 99b3a77). Detalle de V1.1.428 a V1.1.441: `git log` (este archivo quedó atrasado en esa parte). **Chequeadas con sesión en producción (14/10):** sidebar dice V1.1.443; Configuración → Integraciones muestra Email "Conectado" (Resend, plan gratis), Banco "Por archivo" y ARCA WSFE "Producción — PV 10"; filtro de moneda en Facturación OK (USD muestra solo la factura en dólares, Pesos 0, Todas vuelve); PDF de PR-2026-1252 se genera bien (PDF válido de 146 KB, se interceptó la descarga, no se guardó nada).

**PDF Y VENTANAS DE DETALLE (14/10/2026, chat "Diseño PDF", SOLO MUESTRAS, NADA EN CÓDIGO):** Augusto quiere optimizar todos los PDF (presupuesto, factura/NC, remito, OC, recibo, OP) con **los mismos datos de hoy y la misma línea visual en todos**. Talles agrupados: DESCARTADO (confunde, cada ítem tiene su precio). Muestras en `Claude outputs/PR-2026-1246 HOY|NUEVO|MODERNO.pdf` (armadas fuera del CRM con Edge; copia de trabajo en el scratchpad: `pdf-nuevo.ts`). El PR de 28 ítems pasa de 4 a 2 hojas (renglones por hoja 30/46 en vez de 12; hojas 2+ con franja fina: logo, sociedad, cliente, número, fecha, página). Diseño moderno: barra de color, número grande, Fecha/Válido hasta/Estado, cliente en bloque gris suave, tabla sin rayas, total en color. **Augusto (14/10): "por ahora lo dejo así, no me gustó" → diseño SIN CAMBIOS. Después pidió SOLO: mayúsculas donde hacen falta (títulos del PDF + descripciones) y más renglones por hoja, con encabezado completo en todas las hojas.** **PUBLICADO V1.1.449** (mayúsculas + más renglones; PR Corteva 28 ítems: 4→3 hojas, probado imitando html2pdf): `src/lib/texto-mayusculas.ts` (`mayusculasNecesarias`, solo tramos todo en mayúscula; marcas del catálogo; probado sobre 665 descripciones reales: cambian 465; falta sumar IRAM/Plus/etc. y la prueba `scripts/test-texto-mayusculas.ts`), falta enchufarlo en `pdf-templates.ts` y sacar `text-transform: uppercase` de títulos. Ventanas de detalle (solo espacios, className): PUBLICADO V1.1.448 en facturacion-content.tsx y presupuestos/page.tsx (verificado: diff solo de clases); OC, remitos y consulta-facturas: commit 85a7efa (SIN DEPLOY todavía, va en el próximo); Finanzas FC ya estaba compacta. ⚠️ El deploy de V1.1.449 (15:09) probablemente subió también cambios SIN COMMITEAR del otro chat ("Margen del mes" en Dashboard, margen real en el detalle del PR, onMargen en cobertura-fijos): tsc 0 y build Ready; avisado el chat "CRM" para que los commitee y chequee. Regla: coordinar cada vercel --prod entre chats (sube la carpeta tal cual).
**V1.1.450 y V1.1.451 (14/10, chat "Diseño PDF", publicadas y probadas en producción: buscador "1203" abre PR-2026-1203, PDF de OP-000058 se arma, Oportunidades sin BCRA):** OC, remito y consulta de facturas compactos; Oportunidades sin riesgo BCRA (queda en Finanzas > Informes); buscador de arriba abre el PR elegido (`?selected=` + evento `lz-abrir-pr` en header.tsx/presupuestos) y el cliente (`/clientes?id=`); sacado "Motivos de rechazo recientes" de Presupuestos (el motivo sigue en el detalle); Consulta de facturas > compra: sección "Órdenes de pago" con PDF de cada OP y certificado de retención (`lib/orden-pago-pdf.ts`). Punto 13 (margen real) lo hizo el chat "CRM" (salió en V1.1.449).
**LISTA NUEVA de Augusto (14/10, pasada en limpio; HECHOS 1, 2, 5, 7, 8, 9, 13; FALTAN 3 envío doble, 4 ítems sin IA → tomar los de la OC, 6 Seguimiento compacto, 10 vendedores eliminan PR, 11 Solicitud→PR, 12 Vencidos visibles):** ver la respuesta del chat "Diseño PDF" — envío doble en carga de factura, ítems sin IA, sacar riesgo BCRA de Oportunidades, Seguimiento compacto, descargar OP desde facturas de compra, buscador que abra el PR, sacar "Motivos de rechazo recientes", vendedores eliminan PR, Solicitud→PR más fácil, Vencidos más visibles, margen promedio del Dashboard. Ventanas de detalle (PR, OC, remito, FV, FC, emitir factura): ideas aprobables = descripción corta, tarjetas en celular, botón ocultar costos, avisos precio 0 / cantidad rara, franja de resumen, renglones apretados, recordar pantalla completa. **Hallazgo ⚠️:** en Cantidad del PR (`NumInput`, presupuestos/page.tsx) punto y coma son decimal: "1.000" queda 1 sin aviso; las cantidades se muestran con punto (29.9). Propuesto (sin OK): "1.000" = mil, aviso amarillo por decimales en UN / precio 0, mostrar con coma. Ortografía: recomendado NO pasar a mayúsculas automático; corregir en catálogo/ítems.

**AYUDA DEL CRM (ex asistente ✨) — 14/10/2026, chat "Pendientes", EN CÓDIGO, SIN PUBLICAR (va como V1.1.447 o la que siga; coordinar con el otro chat). Augusto eligió la opción B: guía gratis + IA con tope.**
- **Guía de uso:** `docs/GUIA-USO.md` (39 secciones, todas las pantallas y pestañas de Finanzas, sacadas del código real). Es la ÚNICA fuente: al cambiar una pantalla se edita ahí y se corre `node scripts/guia-a-ts.mjs` (genera `src/lib/asistente-guia-datos.ts`; `--check` controla que esté al día). **Regla: cada tanda que cambia una pantalla actualiza su sección.**
- **Botón Ayuda** (`components/layout/ai-widget.tsx`, ícono salvavidas): sin IA y sin gasto muestra "En esta pantalla" (en Finanzas detecta la pestaña por ?tab= o la última usada), buscador por palabras/frases/siglas (NC, OP, OC…) con botón **Ir** (`lib/ayuda-busqueda.ts`, prueba `scripts/test-ayuda.ts`), atajos sin IA (Resumen de hoy y Stock bajo con consultas fijas; links a Pendientes, Oportunidades, Reportes). Cada rol ve solo las secciones de sus módulos (ROLE_PERMISSIONS).
- **"¿No alcanza? Preguntarle a la IA"** (`api/ai/route.ts` reescrito): SOLO CONSULTA (se sacaron insert_record/update_record), consulta con la SESIÓN del usuario (antes usaba la clave pública sin sesión: con las tablas cerradas no veía datos), tablas permitidas según el módulo del rol, filtra por la sociedad activa, conoce la guía de su rol (system con caché) y la pantalla actual. Negocio corregido (antes decía "válvulas, caños, bombas"). **Tope US$ 5/mes** (`lib/ia-tope.ts`, calculado sobre ia_uso funcion chat_ia; se guardan tokens equivalentes con caché). Sin migración.
- Probado en local: Finanzas → Órdenes de pago muestra su sección; "como cargo una nota de credito" → Facturas de venta primero; Resumen de hoy (3 PR nuevos en Lazzari); pregunta real "¿Cuántos presupuestos aprobados hay sin facturar…?" → 6 PR correctos en 17 s, costo ≈ US$ 0,017 (11.750 + 1.842 tokens entrada equivalentes, 611 salida). Después se le prohibió responder con tablas (el panel no las muestra). tsc 0, hooks OK.
- Sugerencia: pasar a `claude-haiku-5-5` (10 veces más barato que Haiku 4.5) cuando Augusto quiera; hay que probarlo (piensa por defecto).

**DECISIONES DE AUGUSTO Y PENDIENTES (14/10/2026, cierre del chat):** (a) FA 0015-00000066 verificada en la base: PO 9900098904 - SES 2026/1011106066 en observaciones, OC cliente, neto $293.998,84, total $355.738,60, fecha 14/10, CAE 86417671388996. (b) La edición del PR que rehace la OC (syncOCsFromPR) se DEJA DE LADO por ahora; diseño propuesto si se retoma: no tocar OC con recepción/factura/enviada, preguntar (OC complementaria recomendada si sube la cantidad; actualizar si baja; avisar al proveedor), nunca bloquear. (c) Cheques recibidos 211/3587: DEJAR DE LADO por ahora. (d) El dólar del alquiler ya está cargado, pero Augusto quiere que NO esté en el Dashboard/Hoy sino en Finanzas > Gastos fijos, al lado del pago del alquiler (hoy es un casillero del recuadro que se guarda por compu en localStorage lz-dolar-fijos). Propuesta: columna aditiva en gastos_fijos (dólar de referencia) + el recuadro lo lee de ahí; hace falta migración con OK. (e) STOCK: la pantalla /stock YA EXISTE (productos con stock, mínimo, costo, 46 productos reales de septiembre; recepcionar una OC suma stock con la RPC increment_stock si el renglón tiene producto_id) pero NO está en el menú lateral (solo hay link en el header y en alertas). Idea pedida: que lo que sobra de una OC al recepcionar se pueda mandar a stock propio, y que el stock se use en PR nuevos (renglones stock_propio / OC interna). A definir con Augusto antes de tocar nada. (f) Sigue pendiente: probar la pregunta de refacturar con la primera NC real; mirar PR-2026-1146 (US$ 26.233 aprobado 16/09 sin facturar); Augusto manda FA 66 y NC 7 a Corteva; línea 29/09 TRANSF. INM COE sin clasificar; agenda ARCA (recordatorios sí/no); probar una pregunta a la IA en producción.
**PUBLICADA V1.1.452 (14/10/2026, commit 42d0974, vercel --prod Ready, sidebar dice V1.1.452):** facturado del mes único sin IVA (Dashboard y Finanzas dan lo mismo: $11.969.904,09 / US$ 8.515,05), Falta facturar en el recuadro de gastos fijos, pregunta de refacturar tras una NC total (sin probar con NC real: la primera NC real es la prueba) y observaciones del PR precargadas en la factura. Chequeado en producción el Dashboard. Salió solo lo de esta tanda: los 3 archivos del otro chat (factura-vs-oc.ts, cargar-factura-oc.tsx, test-factura-vs-oc.ts) se apartaron con git stash y se devolvieron; siguen SIN commitear y su próximo número es 1.1.453.
**BOGADO: FB 8 Y FB 9 ANULADAS, OC PASADAS A LOS PR NUEVOS (14/10/2026, hecho con OK de Augusto, en producción):** NCB 0015-00000003 (CAE 86417708025893, $2.166.904,30) anula FB 0015-00000008 y NCB 0015-00000004 (CAE 86417708523325, $42.173,18) anula FB 0015-00000009; PR-2026-1215 y PR-2026-1252 quedaron Rechazados (motivo "NC total, no se vuelve a facturar"). **La pregunta de refacturar tras NC total (V1.1.452) funcionó con la primera NC real.** Migración de datos 20261014220000_bogado_oc_a_pr_nuevos (+ rollback, corrida): OC-2026-1221 (Mariana SA) -> PR-2026-1253; OC-2026-1239 y 1240 (Macro Blanco = ABRAHAM MIZRAHI) -> PR-2026-1254. Facturas de compra y pagos siguen colgados de sus OC. PR-1253/1254 pasados a Aprobado por migración de datos 20261014230000 (+ rollback, corrida; no por pantalla porque aprobar genera OC duplicadas): listos para facturar desde Ventas, 1 y 2 OC cada uno. PENDIENTE: OC-1221 dice 5 zapatos/30 botines y el PR 3/31 (FC de Mariana trae 28 botines + 3 zapatos, faltan 3 botines por una factura nueva); costos del PR-1253/1254 difieren por centavos de la OC (botín 28275,00 vs 28275,80; pantalón 11487,00 vs 11487,60). Pedido de Augusto: poder hacer este arreglo (pasar OC/facturas de un PR a otro) desde el sistema.
**DÓLAR DEL ALQUILER EN GASTOS FIJOS + STOCK EN EL MENÚ (14/10/2026, en código, SIN PUBLICAR, tsc 0, hooks OK; falta OK para correr la migración):** (1) Migración `20261014210000_gasto_fijo_dolar_referencia.sql` (+ rollback): columna aditiva `dolar_referencia` en `gastos_fijos`. En Finanzas > Gastos fijos, al editar un gasto en US$ aparece "Dólar para pasarlo a pesos" y la lista muestra "× dólar X = $Y" (o aviso ámbar si falta). `cobertura-fijos.tsx` ya no tiene el casillero (localStorage lz-dolar-fijos queda solo de respaldo de lectura hasta que se cargue en Gastos fijos); `lib/cobertura-fijos.ts` usa el dólar propio de cada gasto (prueba ampliada). El recuadro no falla si la migración no está (lee con select *). (2) Sidebar: "Stock" en el grupo Entregar (módulo `stock`, ya existía en permisos). (3) Sobrante de OC → stock propio y descuento al vender: A DEFINIR con Augusto (nada tocado). Para publicar: versión (el otro chat tiene 1.1.453), coordinar vercel --prod, git add src supabase scripts docs.
**FACTURADO / VENDIDO / FALTA FACTURAR + NC PREGUNTA + OBSERVACIONES DEL PR (14/10/2026, en código y commiteado, SIN DEPLOY propio; pedido de Augusto):** (1) `lib/facturado-mes.ts` (prueba `scripts/test-facturado-mes.ts`): UNA cuenta de "Facturado del mes" = facturas − NC, SIN IVA (subtotal), pesos y dólares separados, factura anulada + su NC desaparecen juntas (regla B7). La usan la tarjeta del Dashboard y la de Finanzas > Facturas de venta (antes cada una con otra regla y con IVA: $14,44 M vs $14,05 M y US$ 10.303 vs 5.333); ahora las dos dan lo mismo ($11.969.904,09 / US$ 8.515,05 con "Facturas − NC" abajo; `StatCard` tiene `detail`). El "vs. mes anterior" compara contra el mismo tramo (1 al día de hoy) del mes anterior. La tarjeta Objetivos del Dashboard compara contra el neto. (2) Recuadro "¿Cubro…?": bajo "Vendido en el mes" ahora dice "Falta facturar $X (vendido y aún sin factura, de cualquier mes)" = PR aprobados o en facturar de cualquier fecha, sin IVA, US$ al TC del PR (hoy $58 M, casi todo el PR-2026-1146 de US$ 26.233 aprobado el 16/09). Esquema: Facturado (tarjeta) / Vendido y Falta facturar (recuadro). (3) Al emitir una NC TOTAL que deja la factura anulada y el PR en "facturar" (`facturacion-content.tsx`), la ventana de éxito pregunta "¿Se vuelve a facturar el PR-xxxx?": Sí = queda en Ventas; No = el PR pasa a Rechazado (motivo "NC total, no se vuelve a facturar") con nota interna y deja de contar como venta. Muestra las OC del PR (no las toca: si no se recibió, cancelarla; si se recibió, ver devolución/stock). Es solo una pregunta, envuelta en try/catch (la NC ya está emitida); NO probada con una NC real (no se emiten NC de prueba): primer uso real = prueba. (4) `emitir-factura-modal.tsx`: el campo Observaciones de la factura viene precargado con las observaciones del PR (sin los renglones automáticos de costo/margen), editable; evita olvidar PO/SES. Pendiente aparte: editar un PR por pantalla rehace sus OC (syncOCsFromPR) y borra recepción/vínculo con la factura del proveedor (Augusto aún no dijo si se arregla).
**MARGEN SIEMPRE ACTUALIZADO + FA 66 (14/10/2026, en código, SIN PUBLICAR; la parte de datos ya está aplicada):** (1) FA 0015-00000066: se agregó en observaciones "PO 9900098904 - SES 2026/1011106066" (migración de datos 20261014200000 + rollback, corrida, solo texto libre). Causa: al emitir desde Ventas el campo Observaciones de la factura no toma las observaciones del PR (solo las muestra como "Obs. PR"); en la FA 37 se había escrito a mano. Propuesta pendiente: precargar ese campo con las observaciones del PR. (2) Dashboard: la tarjeta "Margen promedio" era el promedio del markup cargado en PR aprobados (no se movía con los costos); ahora muestra "Margen del mes" = ganancia/venta neta real del mes, el mismo número del recuadro de gastos fijos (CoberturaFijos avisa por onMargen); sin recuadro (roles sin acceso) queda la tarjeta vieja. (3) Detalle del PR: "Markup general X%" (dato fijo cargado al crear) se reemplazó por "Margen real (ganancia)" calculado con costos y precios de hoy (margenPR, incluye envío interno): PR-1120 da 76,4% · $118.461,07. Probado en pantalla local. tsc 0, hooks OK. Archivos: dashboard/page.tsx, cobertura-fijos.tsx, presupuestos/page.tsx.
**CORTEVA PR-2026-1120 REFACTURADO (14/10/2026, hecho con OK de Augusto):** el cliente reclamó que se le cotizó $293.998,84 neto (cafetera) y se facturó $248.526,61 (FA 0015-00000037). Se emitió NC total NCA 0015-00000007 (CAE 86417669611913), se corrigió el precio del PR con la migración de datos 20261014190000_corregir_precio_pr_1120 (+ rollback; no por pantalla porque editar el PR rehace la OC y borra la recepción) y se emitió FA 0015-00000066 por $355.738,60 (CAE 86417671388996) con fecha 14/10 (ARCA no dejó el 13/10: mínimo 14/10), desde Ventas > Re-facturar, con PO 9900098904 - SES 2026/1011106066 de las observaciones del PR. No se envió mail al cliente (lo manda Augusto). OC al proveedor intacta (recibida, $154.957,85). Regla: una NC total sobre factura sin cobros anula la factura y deja el PR en "facturar" (se puede re-facturar desde Ventas); si no se re-factura, el PR sigue contando como venta. PENDIENTE (Augusto dijo que sí): al emitir una NC total, preguntar si se vuelve a facturar; si no, pasar el PR a Rechazado con nota interna. HALLAZGO: editar un PR por pantalla rehace sus OC (syncOCsFromPR) aunque tengan recepción o factura.
**PUBLICADA V1.1.447 (14/10/2026, commit b265e97, vercel --prod Ready):** Ayuda del CRM con IA (otro chat) + Finanzas > Hoy más corta. Chequeado en producción: sidebar V1.1.447, Finanzas muestra el recuadro de gastos fijos y el detalle plegado, botón Ayuda presente. Falta probar una pregunta a la IA en producción.
**PENDIENTES CENTRALIZADOS + CARGA MANUAL SIN IA (14/10/2026, chat "Pendientes", PUBLICADO en V1.1.446 commit c545f8e; coordinado con el chat del envío interno):**
- **Pantalla `/pendientes`** (menú Inicio → Pendientes; el botón "Pendientes" del Dashboard ahora lleva ahí con el número de abiertos): agrupada por área (Pagos, Cobros, Compras y proveedores, Gastos fijos, Bancos y créditos, Sistema, Decisiones), cada renglón "para hacer" o "para responder", botón **Ir** a la pantalla, casilla **Respuesta** (se guarda al salir) y **Copiar respuestas** (texto para pegarle a Claude). Arriba "Atrasos que cuenta el sistema" (extracto sin cruzar, OC sin factura, FC vencidas sin pagar, FV vencidas sin cobrar, PR en Solicitud; solo lo que el rol puede ver) y lo abierto en Finanzas → Revisar. Sin la migración muestra "Falta correr la migración" y no rompe (probado en local). `lib/pendientes.ts` (prueba `scripts/test-pendientes.ts`), `components/presupuestos/pendientes-widget.tsx` (ahora es solo el botón), `components/layout/sidebar.tsx`.
- **Migraciones CORRIDAS (14/10, con OK de Augusto; verificado 61 pendientes abiertos y MARIANA SA resuelto):** `20261014170000_pendientes_respuesta_area_link.sql` (columnas `respuesta`, `area`, `link`, `tipo` en `pendientes`) y `20261014170100_datos_pendientes_centralizados.sql` (área/link a los 9 que había + 52 pendientes nuevos sacados de este archivo + marca Resuelto "alta MARIANA SA" en finanzas_revisar). Las dos con vuelta atrás en `supabase/rollback/`. Correr en ese orden.
- **Carga manual sin IA** (`cargar-factura-oc.tsx`, usada en Compras → Carga manual y en Finanzas): al subir PDF o foto, primero lee el **QR de ARCA** (`lib/factura-qr-arca.ts`) y si no hay, el **texto del PDF con reglas fijas** (`lib/factura-texto.ts`: CUIT del emisor, tipo, número —descarta PED/remito/OC y usa el nombre del archivo si hace falta—, fecha, vencimiento, total, neto, IVA por cuenta neto×(1+%)=total, CAE). Todo en el navegador (`lib/leer-factura-local.ts`), sin mandar el archivo. Cartel "Leído del QR de ARCA" / "Leído del texto (revisá)" + avisos; botón aparte **"Leer con IA"** (también si no se pudo leer). Si el CUIT no es de un proveedor cargado, queda escrito en el buscador. Librerías nuevas: `pdfjs-dist` ^6.4.299 y `jsqr` ^1.4.0 (package.json y package-lock.json modificados). Ojo técnico: pdfjs se dibuja con `intent: "print"` porque si no espera requestAnimationFrame y se traba con la pestaña oculta.
  Pruebas: `scripts/test-factura-sin-ia.ts` (datos inventados) y `scripts/test-lectura-factura-pdf.ts <pdf...>` (PDF reales, solo lectura): 9 de 9 facturas de Descargas bien (3 con QR). En pantalla local sin guardar: QR en 2,2 s (todo completo, total "igual al PDF"); texto en 3,7 s (proveedor encontrado por CUIT; con IVA mezclado avisa revisar IVA). tsc 0, hooks OK.
- Al publicar: subir versión (coordinar número con el otro chat) y hacer git add también de package.json / package-lock.json.

**ALESSO RESUELTO (14/10/2026, hecho por Claude desde Extractos con la sesión de Augusto, con su pedido "atalo a la transferencia"):** las dos líneas de $1.000.000 quedaron como Personal con nota, sin crear regla "Recordar": transferencia del 01/10 ("Transferencia inmediata") y depósito del 06/10 ("DEPOSITO CHEQUE 48HS. Nro:62245658"). El cheque 14588139 del CSV NO se cargó en echeqs (el extracto dice otro número, 62245658). La línea del 29/09 "TRANSF. INM COE" $1.000.000 sigue sin clasificar (no tocar sin que Augusto diga qué es). Cheques recibidos 211 (Punto Espacios → FA 16-3) y 3587 (Del Sol → FA 16-18 neto de retención): NO cargados todavía; faltan fecha de recepción real, N° de certificado de la retención y confirmar cómo se endosaron a Bruno Francione. 3414 Del Sol: queda como está (Augusto: "dejalo").
**FINANZAS > HOY MÁS CORTA (14/10/2026, en código, SIN PUBLICAR, probada en pantalla local, sin migración; carta blanca de Augusto "optimizar sin perder efectividad"):** `cuentas-financieras.tsx`: tabla de cheques propios semana por semana plegada (queda el próximo rescate), cada cuenta muestra nombre y saldo y el resto va en "Ver detalle", aviso de cobros/pagos sin cuenta en una línea; `resumen-economico.tsx`: a primera vista Tengo / Debo / Posición neta y el detalle por renglón plegado ("Ver detalle: qué tengo y qué debo"; los renglones clickeables siguen adentro). Alto de la pantalla en local: de unos 6.000 px a unos 3.800. Sigue visible: recuadro de gastos fijos, resumen, alerta roja "Hoy tenés que cubrir la cuenta". Para publicar: versión 1.1.447 (o la que siga si el otro chat publica antes) y git add solo cuentas-financieras.tsx, resumen-economico.tsx y ESTADO.md.
**PUBLICADA V1.1.446 (14/10/2026, commit c545f8e, vercel --prod Ready, sidebar dice V1.1.446):** todo lo de abajo marcado "sin publicar" (envío interno del PR + reparto desde la factura de compra, recuadro "¿Cubro los gastos fijos?" en Finanzas > Hoy y Dashboard, Dashboard sin gráficos repetidos, Objetivos arreglado y objetivo $120 M) y lo del otro chat (Pendientes, lectura de facturas por QR/texto sin IA, pdfjs-dist y jsqr) salió junto. Chequeado en producción con sesión: Finanzas > Hoy muestra el recuadro (Grupo LA: "sin gastos fijos cargados", correcto), /pendientes carga. Falta probar en producción con Lazzari: recuadro con datos, Objetivos, campo Envío interno del PR y carga manual de factura. Migraciones del otro chat 20261014170000/170100 corridas por ellos. Cheques 2026: NO cargados (decisión: los 331 emitidos son historial anterior al corte; faltan 3 recibidos y Alesso, a mano).
**ENVÍO INTERNO EN EL PR (14/10/2026, EN CÓDIGO, SIN PUBLICAR y SIN CORRER LA MIGRACIÓN; Augusto eligió la opción 1):** flete que paga Lazzari y NO se le cobra al cliente. Migración `20261014160000_pr_costo_envio_interno.sql` (+ vuelta atrás en `rollback/`): 1 sola columna en `presupuestos` (`costo_envio_interno`, simplificada el 14/10: el detalle va a `notas_internas`), aditiva. Código: `lib/presupuesto-margen.ts` (`costoEnvioInterno` suma al costo → baja ganancia y margen; prueba ampliada), campo "Envío interno 🔒" en el cuadro de totales del PR (entra en el margen neto) y columna Ganancia/Margen de la lista y del recuadro Pendiente; se guarda con un update aparte (`guardarEnvioInterno`, sin tocar las funciones atómicas; si la columna no existe avisa y no frena). Nunca va al PDF, WhatsApp, total, IVA ni factura (columna aparte, no es renglón). `lib/envio-detectar.ts` (prueba `scripts/test-envio-detectar.ts`) reconoce envío/flete/transporte/traslado/despacho/logística/encomienda, etc. tsc 0, hooks OK, tests OK. **HECHO también en `cargar-factura-oc.tsx` (sin probar en pantalla):** si la factura del proveedor trae un renglón que no está en la OC y es envío/flete (`esRenglonEnvio`), aparece un cuadro violeta "Envío del proveedor … sumarlo como costo interno de los presupuestos 🔒" (tildado por defecto): reparte el neto (sin IVA) entre los PR de las OC elegidas, proporcional al subtotal de cada OC (`lib/envio-reparto.ts`, prueba `scripts/test-envio-reparto.ts`: los centavos van a la OC mayor, la suma da exacta), con montos editables y aviso si no suman. Al guardar la factura (ya guardada, nunca frena) suma a `costo_envio_interno` de cada PR (convertido a la moneda del PR), anota en `notas_internas` "[fecha] FC …: envío $X" (historial, no se pisa). OC sin PR: queda solo en la factura y se avisa. El envío igual sigue entrando a la OC/factura como siempre (lo que se le debe al proveedor no cambia). **Solo el envío que cobra el proveedor; el transporte que trabaja para Lazzari corre por Transportes (regla de Augusto).** Limitación: si se anula la factura, el envío interno del PR no se descuenta solo (queda anotado en la nota). OC que consolidan varios PR: hoy van a "sin PR" (solo factura).
**MIGRACIÓN `20261014160000` CORRIDA por Claude con OK de Augusto (14/10/2026), verificada: columna creada, 212 presupuestos en 0.** En el PR el casillero "Envío interno 🔒" solo se ve si hay monto cargado; si no, un link chico "+ Envío interno". **Falta:** (1) (hecho) migración; (2) probar en pantalla (cargar el envío en un PR; factura con envío); (3) subir versión al publicar. Hallazgo aparte (NO pedido por Augusto, no tocar): al editar un PR, `syncOCsFromPR` rehace las OC aunque tengan recepción o factura.
**FINANZAS > HOY: RECUADRO "¿Cubro los gastos fijos?" HECHO EN CÓDIGO (14/10/2026, sin publicar, sin migración, probado en pantalla local con Lazzari y Grupo LA, sin guardar):** `components/cobertura-fijos.tsx` + `lib/cobertura-fijos.ts` (prueba `scripts/test-cobertura-fijos.ts`), arriba de la pestaña Cuentas de `finanzas/page.tsx`. Tres bloques: vendido del mes (neto sin IVA; PR aprobado/facturar/facturado del mes, US$ al TC de cada PR) contra el objetivo; ganancia (`margenPR`, con envío interno) ÷ gastos fijos con barra; cuánto falta vender (= falta de ganancia ÷ margen del mes) y proyección a fin de mes. Dólar del alquiler: casillero que se guarda solo en la compu (localStorage `lz-dolar-fijos`). Avisa PR sin costo / sin TC. Octubre Lazzari con dólar de prueba 1500: ganancia $3.812.851 de $5.878.200 = 65 %, faltan $8,47 M de venta. **Falta:** que Augusto cargue el objetivo $120.000.000 (neto) en Finanzas > Objetivos (la tabla `objetivos` está vacía) y el dólar del alquiler; Dashboard (reemplazar la tarjeta vieja de cobertura, que usa facturado ÷ fijos) y Reportes (sacar lo repetido) NO hechos. Ojo: `tsc` hoy da 1 error en `scripts/test-lectura-factura-pdf.ts` (del otro chat, pdfjs-dist), no mío. Coordinado con el otro chat (Pendientes + lectura de facturas): no toca Finanzas/Dashboard/Reportes; versión que sigue: 1.1.446.
**DASHBOARD ORDENADO (14/10/2026, en código, sin publicar, probado en pantalla local sin guardar):** `dashboard/page.tsx`: arriba va el mismo recuadro `CoberturaFijos` (admin y administrativo); la tarjeta vieja de cobertura (facturado ÷ fijos) se quitó y quedó solo como "Gastos fijos por pagar" (avisos de pago/factura que faltan; no aparece si no hay avisos); el objetivo general ya no se repite en la tarjeta Objetivos para admin/administrativo (quedan los individuales); se sacaron los gráficos "Facturación mensual" y "Presupuestos por estado" (idénticos a Reportes > Comercial) y se dejó un link "Ver en Reportes"; import de recharts eliminado. **Reportes no se tocó** (queda como dueño de lo histórico/comparativo: facturación mensual, PR por estado, métricas con mes anterior, rankings, comisiones, libro IVA). Visto: el Dashboard muestra "Margen promedio 40 %" (markup) y el recuadro nuevo 24,4 % (ganancia sobre venta, con 7 %/2 % de gastos): conviene renombrar uno para que no confunda (sugerencia, sin OK). Quedan avisos de lint por variables sin uso (`ventasPorMes`, `presupuestosPorEstado`, `totalGastosFijos`), inofensivos.
**OBJETIVO DE VENTAS CARGADO (14/10/2026, con pedido de Augusto "ponelo vos"): migración `20261014180000_objetivo_ventas_mensual.sql` CORRIDA y verificada** (+ vuelta atrás). `objetivos` no tenía `sociedad_id` y Finanzas > Objetivos y el Dashboard filtraban por esa columna y por una relación `profiles:usuario_id` que no existe (error 400: por eso la tabla estaba vacía y la pantalla no andaba). Se agregó la columna y se cargó "Ventas del mes (neto, sin IVA)": $120.000.000 por mes + IVA, Lazzari, desde 01/10/2026 hasta nuevo aviso. Código: Finanzas y Dashboard traen `objetivos` sin la relación y los nombres desde `profiles`; el recuadro "¿Cubro…?" filtra por sociedad. Probado en pantalla: Objetivos lista el objetivo (200) y el recuadro muestra "13 % del objetivo". Dólar del alquiler de Augusto: $1.545 (blue); se escribe una vez en el recuadro (se guarda en esa compu). Sueldos de octubre: pagos (dato de Augusto).
**Cheques recibidos sin cobro cargado (14/10, solo lectura):** 211 Punto Espacios $619.580,50 = FA 16-3 exacta; 3587 Del Sol $1.348.076,59 = FA 16-18 ($1.370.733,34) menos retención Ganancias 2 % sobre el neto (1,6529 %), exacto al centavo; 3414 Del Sol $12.532.078,86 no coincide con facturas abiertas del CRM (suman $6,7 M): serían del sistema anterior; ninguno tiene cobro en movimientos. Alesso: depósito 06/10 (extracto "Nro:62245658", el CSV dice 14588139) y transferencia 01/10 "Transferencia inmediata" de $1.000.000 (línea b59220d3): ambas sin clasificar; resolver como Personal con nota. Agenda ARCA de Augusto (14/10): SICORE y DDJJ retenciones/percepciones HOY 14/10; Anticipos Ganancias y Bienes Personales 15/10; IVA 23/10; Autónomos 12/11.
**Plan acordado con Augusto (14/10/2026), sin hacer:** Finanzas > Hoy: recuadro "¿Cubro los fijos?" (ganancia del mes ÷ gastos fijos; cuánto falta vender = fijos ÷ margen promedio; disponible vs fijos pendientes del mes), ventas del mes contra objetivo $120.000.000 + IVA (neto), "Para hacer hoy" y el resto plegado. Reportes: sacar lo repetido con Dashboard (pestaña Comercial vs KPIs; Totales por moneda). Fijos por ahora: sueldos y alquiler (Augusto pasa más). Papelera: pausada, sin respuesta.

**PUBLICADO 14/10/2026 en V1.1.445 (junto con "Carga manual" del otro chat): lista de Presupuestos.** `presupuestos/page.tsx`, `lib/presupuesto-margen.ts` (prueba `scripts/test-presupuesto-margen.ts`): 1) columna **Ganancia / Margen** por PR (7 % de gastos si es PR A o B, 2 % si es manual sin ARCA; rojo < 15 %, ámbar < 20 %, "—" si no tiene costos; ordenable); 2) en el recuadro PENDIENTE, la ganancia total de lo pendiente; 3) "Todos" no muestra los facturados (siguen en el botón Facturado y al buscar); 4) los montos de Pendiente / Aprobado / Facturar / Facturado son SOLO del mes corriente (por fecha del PR), con la etiqueta "Montos de <mes>". Probado en pantalla en local (sociedad con 8 PR). tsc 0, hooks OK. Sin migración.
**MIGRACIÓN CORRIDA por Claude con OK de Augusto (14/10/2026), verificada (11 de 11 controles OK; 0 PR con costos/márgenes en observaciones): `20261014140000_pr_costos_a_notas_internas.sql`** (+ vuelta atrás en `supabase/rollback/`). Respalda y mueve a `notas_internas` los renglones automáticos de `observaciones` de 14 presupuestos (16 renglones) y cambia `guardar_conciliacion_compra` y `ajustar_oc_a_factura` (definiciones vivas, solo ese cambio) para que escriban en `notas_internas`. Probada contra la base real con `migrar.cjs --probar` (deshace todo): 11 controles OK, y la vuelta atrás también OK. Pruebas: `scripts/db/pruebas/pr_costos_a_notas_internas*.sql`.

**URGENTE 14/10/2026 (V1.1.444, arreglo de fuga): costos y márgenes en el PDF del cliente.** Al cargar una factura de proveedor con otro costo, el sistema anotaba "[fecha] FC ...: costo X → Y (margen A% → B%)" en `presupuestos.observaciones`, que se IMPRIME en el PDF del presupuesto y en el texto para el cliente. Hecho: 1) `lib/observaciones-cliente.ts` saca esos renglones automáticos del PDF (`generatePresupuestoPDF`) y del texto de WhatsApp/copiar (prueba `scripts/test-observaciones-cliente.ts`); 2) `cargar-factura-oc.tsx` ahora escribe esas leyendas del PR en `notas_internas`, no en `observaciones`. **PENDIENTE (con migración y OK de Augusto):** las funciones SQL de ajuste de OC (`20261012180000_oc_diferencias.sql` y conciliación de compras) siguen escribiendo en `observaciones`, y hay que mover lo ya escrito a `notas_internas`. Afectados al 14/10 (lectura `scripts/lectura/pr-obs-margenes.cjs`): PR-2026-1157, 1227, 1215, 1183, 1039, 1198, 1175. Hasta correr esa migración, el PDF ya está protegido por el filtro.

Leer esto primero en cada chat nuevo. Detalle de las ideas futuras: `IDEAS-PROXIMAS.md`.
Detalle de los errores financieros (A1…E): `DIAGNOSTICO-FINANCIERO.md`.
Versiones anteriores de este archivo: historial de git (`ESTADO-PROYECTO.md`).

---

## 1. Terminado y publicado

- **V1.1.410** (con migración ya corrida `20261010100000_compras_pagos_personalizacion_muestras_bcra.sql`):
  Ordenar OC abiertas con IA, un solo circuito de facturas de compra, Compras en 3 ejes (mercadería / factura / pago),
  Plan de pagos con retención RG 830 y Excel, Personalización, Muestras rehecho, Ficha 360, Oportunidades e informe BCRA.
  Para que el BCRA se actualice solo, en Vercel tienen que existir `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET` (solo nombres).
- **V1.1.411:** arreglos de Oportunidades (vendedor = `clientes.assigned_to`), aviso en bucle, cobros en Ficha 360 y paginado del cron BCRA.
- **V1.1.412:** OC sin candado (avisa en amarillo), lista de proveedores nueva con saldo real (`lib/saldo-proveedores.ts`),
  altas de proveedor y cliente rediseñadas con IA de papeles impositivos, buscador nuevo (2 letras, máx. 8) y nombre de fantasía automático.

## 2. Publicado el 11/10/2026 (V1.1.413), con las 3 migraciones ya corridas

Guardado en el commit `04c8b7f` (11/10/2026). Chequeo de tipos: 0 errores. Orden de hooks: OK. Tests de saldos, tipos de movimiento,
ventas, precio de factura, reportes y NC: todos OK.

- **Alta de cliente:** sucursales en el mismo alta.
- **Reportes y Dashboard:** libro IVA resta NC, sin anuladas, ARS y USD separados; meses sin corrimiento por zona horaria; sin cortes de 1000 filas; sin datos de ejemplo (`lib/reportes-comprobantes.ts`).
- **Correcciones financieras** (códigos de `DIAGNOSTICO-FINANCIERO.md`):
  - Ya en el código: A1 (Factura B con IVA, `lib/precio-factura.ts`), A6 (rechazar cheque), A8 (NC manual de venta en un paso),
    A9a (SICORE pide rol y sociedad), B1, B3, B4, B5, B6, B7, B8, B9, B12, C4, D2, D3.
  - En las migraciones: A2, A4, A7, A9b, B9, B10, C1, C2, C3, D3.
- **3 migraciones nuevas, YA corridas el 11/10/2026** (cada una con su vuelta atrás en `crm/app/supabase/rollback/`):
  1. `20261011100000_finanzas_correcciones.sql`
  2. `20261011110000_ventas_correcciones.sql`
  3. `20261011120000_compras_correcciones.sql`
  Se corren en ese orden en el SQL Editor de Supabase **antes** de publicar el código.

- **"Finish Finanzas fixes" terminado** (11/10/2026, en `finanzas/page.tsx`, también dentro de V1.1.413):
  - **A3:** anular una NC de compra usa `anular_nota_credito_compra_v2`.
  - **A7:** anular una factura de compra usa `anular_factura_compra()` (pide motivo opcional y muestra los avisos de pagos).
    "Eliminar" factura: si tiene pagos o NC aplicadas, recomienda anular; si Augusto insiste, elimina igual (avisa, no frena).
  - **B10:** el alta de gasto manual guarda `gasto_manual_id` en su pago; editar el gasto actualiza el pago (vía `gestionar_cobro`);
    eliminar el gasto anula su pago (queda el registro).
  - ⚠️ Necesita la migración `20261011100000_finanzas_correcciones.sql` corrida **antes** de publicar (si no, anular facturas y crear gastos dan error).
  - Chequeos: tipos 0 errores, hooks OK, tests de saldos, pago directo, anulación OP y edición FC OK.
    Fallan 6 tests de texto viejos (`financial-ledger-ui`, `op-echeqs`, `op-money-rounding`, `op-validation`,
    `pr-pagination-and-op-duplicates`, `purchase-credit-note`): **ya fallaban antes** de este cambio; quedan para revisar.
  - **Arreglo 11/10/2026:** la regla `tiene_contraparte` de `movimientos` (creada a mano en la base, no estaba en el repo) pedía cliente o proveedor,
    y rechazaba el pago de los gastos sin proveedor. Migración `20261011130000_movimientos_contraparte_gasto.sql` (con vuelta atrás):
    también acepta `gasto_manual_id`. No necesita cambio de código ni publicar.
  - **Arreglo 2 (11/10/2026):** otra regla hecha a mano, `monto_positivo` (monto > 0), hacía fallar **todas** las anulaciones
    (cobros, OP, NC de compra, pagos de gastos), porque anular deja el monto en 0. Migración `20261011140000_movimientos_anulados_reglas.sql`
    (con vuelta atrás): un movimiento anulado puede quedar en 0 y sin contraparte. Las 3 reglas CHECK de `movimientos` hoy son:
    `monto_positivo`, `tiene_contraparte` y `movimientos_ajuste_sentido_check`.
  - **V1.1.414:** el error al borrar un gasto muestra el texto real (antes "[object Object]").
  - No se probó en local: las funciones nuevas no existen en la base hasta correr la migración, y probar anulaciones implica guardar.

El `git stash` "correcciones financieras a medias" es una copia **vieja** de este trabajo. No usarlo.

## 3. Publicado el 11/10/2026 (V1.1.414, commit bf8c19d), migración 20261011150000 ya corrida — cobros con cheque

- **Código:** `lib/fecha-cobro.ts` (prueba `scripts/test-fecha-cobro.mjs`): el cobro va con la fecha en que se recibe; con cheque es hoy y
  la fecha del cheque queda en el cheque. Aviso (no bloqueo) si la fecha del cobro es futura. Aplicado en `cobro-masivo-liquidacion.tsx`
  y en el cobro simple de `facturacion-content.tsx`. En Finanzas > Cheques: "Rechazar" también para cheques depositados/cobrados,
  y "Eliminar" pasó a "Anular" (no borra).
- **Migración** `20261011150000_cobros_fecha_conciliado_nc_multiple.sql` (con vuelta atrás; respaldo en `lz_respaldo_correcciones`):
  fechas reales de los 3 cobros, cheque 00000131 con cliente, cheques atados a su cobro, NC 0015-00000005 de DEL SOL atada a FA 0015-00000039
  (antes figuraba como saldo a favor y restaba ventas), cobros nuevos nacen "pendientes de conciliar", función
  `crear_nota_credito_manual_venta_multiple` + tabla `nota_credito_venta_aplicaciones`.
- **Después de publicar:** Augusto rechaza los cheques 00000074 y 00000176 de Barraza desde Finanzas > Cheques.
  Cuando venga rechazado el 00000131: rechazarlo y correr `crm/app/supabase/operaciones/20261011_nc_barraza_0001_00000025.sql`
  (NC A 0001-00000025, CAE 86416795481784, $26.954.340,91, anula FA 15-10, 15-19 y 15-30).
- Chequeos: tipos 0 errores, hooks OK, tests fecha-cobro, cobros/cheques y saldo-clientes OK. Probado en producción con sesión 14/10: filtro y PDF OK.

## 3b. Publicado el 11/10/2026 (V1.1.415), migraciones 20261011160000 y 20261011170000 ya corridas

- Finanzas > Cheques: buscador (número, cliente, banco o importe), filtros por tipo y fecha de pago, "Limpiar filtros",
  cantidad y total de lo filtrado (`lib/cheques-filtro.ts`, prueba `scripts/test-cheques-filtro.mjs`).
- Rechazar cheque: modal con desplegable de motivos y "Otro…" para escribirlo (antes era una ventanita de texto).
- Augusto rechazó los cheques 00000074 y 00000176 de Barraza (11/10/2026).
- Factura con cheque rechazado se ve como **"Cheque rechazado"** (rojo) mientras siga sin cobrar, en Facturación (con filtro)
  y en CC Clientes (`lib/estado-factura-venta.ts`, prueba `scripts/test-estado-factura-venta.mjs`). En CC Clientes los cobros anulados dicen "Anulado".
- **Migración ya corrida (11/10/2026):** `20261011160000_facturas_cheque_rechazado.sql` (columnas `cheque_rechazado_at/_motivo`,
  marca FA 15-10 y 15-30 de Barraza, y `rechazar_cheque_recibido` las completa). Con vuelta atrás.
- Campana: las alertas del módulo "finanzas" se muestran siempre (las de Barraza existían, pero Augusto tiene apagado "seguimiento").
- **Cuentas y extractos, etapa 1 (hecha; migración ya corrida 11/10/2026, 10 cuentas verificadas):** `20261011170000_cuentas_financieras.sql` (+ vuelta atrás):
  tabla `cuentas_financieras` (solo super_admin/admin/administrativo), `cuenta_id` en movimientos y extractos_bancarios,
  trigger `lz_cuenta_sugerida_movimiento` (cuenta sugerida según el medio para lo nuevo; si falla, guarda sin cuenta)
  y carga de las 10 cuentas de Lazzari con saldos al 31/08/2026. Pestaña **"Cuentas"** primera y por defecto en Finanzas
  (`components/cuentas-financieras.tsx`): totales (disponible, cheques en cartera/depositados, comprometido en emitidos con vencimientos),
  aviso de movimientos sin cuenta desde el corte, acuerdo de la CC, editar/crear cuentas. Cálculo en `lib/saldo-cuentas.ts`
  (prueba `scripts/test-saldo-cuentas.mjs`). Sin la migración, la pestaña muestra "Falta correr la migración" (no rompe nada).
  Recuadro **"Sugerencias"** arriba (pedido de Augusto): CC en negativo → "Rescatá $X del FCI" para dejarla en 0 (redondeo a $1.000);
  en la CC principal también cubre los cheques propios a debitar en 7 días; si el FCI no alcanza, dice cuánto falta (`sugerenciasCuentas`).
  Es real recién con el extracto del día (etapa 2). Ideas siguientes: avisarlo en la campana; sugerir suscribir al FCI el sobrante.

## 3c. Publicado el 11/10/2026 (V1.1.416), migración 20261011180000 ya corrida — Cuentas y extractos, etapa 2

- **Migración ya corrida (11/10/2026):** `20261011180000_extractos_bbva.sql` (+ vuelta atrás en `rollback/`). Aditiva:
  columnas en `extracto_movimientos` (cuenta, saldo, clave sin duplicar, clasificación, cheque, cuenta contraria, nota),
  `saldo_banco`/`saldo_banco_fecha` en `cuentas_financieras`, tabla `extracto_reglas` ("Recordar"), `cubre_tercero`/`cubierto_at` en `echeqs`,
  y las funciones `importar_extracto_bbva`, `aplicar_cruces_extracto` (también deshace) y `completar_cheques_emitidos`.
  Sin la migración, Extractos y "Cheques Martín F." muestran "Falta correr la migración" (no rompe nada).
- **Finanzas > Extractos** (`components/extracto-bbva.tsx`, lógica en `lib/extracto-bbva.ts`, prueba `scripts/test-extracto-bbva.mjs`):
  subir el .xls del BBVA tal cual (cuenta por número del encabezado, solo desde el corte, no duplica, avisa saltos de saldo, resumen antes de guardar);
  cruce automático (cheques propios por número, cheque acreditado por importe, devueltos, impuestos/comisiones/SIRCREB, FCI, entre cuentas,
  efectivo, tarjetas, cobros y pagos por importe + fecha + CUIT); "Para revisar" con botones, candidatos y "Recordar"; cobros/pagos "a cargar"
  que se cruzan solos cuando se cargan; totales mensuales de gastos e impuestos del banco (1a); deshacer por línea.
  "Completar cheques emitidos": sube la planilla o los eCheq, agrega solo los que faltan (pagos desde 01/08 o sin pagar), completa números de
  cheques "CHQ-…", marca Martín, y pasa a debitados los que el banco pagó antes del corte y el CRM tenía "a pagar".
  Simulado con los Excel reales: de 522 líneas de la CC desde 01/09, 391 se clasifican solas sin mirar el CRM (161 cheques, impuestos, FCI…).
- **Cuentas:** con extracto, el saldo es el del banco + lo del CRM posterior ("Según el banco al…"); los pases a FCI/efectivo mueven esas cuentas.
  `lib/saldo-cuentas.ts` (prueba ampliada).
- **Finanzas > Cheques Martín F.** (`components/cheques-tercero.tsx`): pendientes, próximo débito, aviso (≤3 días), "Ya cubrió", copiar mensaje,
  agregar/sacar por N°. La campana avisa 3 días antes (cron diario `presupuestos-vencimiento`, módulo finanzas).
- **Pasos de Augusto después de publicar:** 1) Extractos → "Completar cheques emitidos" con `Cheques_Lazzari.xlsx` + los 3 eCheqs emitidos.
  2) Subir los Excel "(3)" (CC) y "(2)" (CA) del 11/10 → Guardar. 3) "Aplicar cruces". 4) Revisar el resto
  (Alesso: depósito 06/10 y transferencia 01/10 de $1.000.000 → Personal, nota "Juan Pablo Alesso").
- Chequeos: tipos 0 errores, hooks OK, tests extracto-bbva, saldo-cuentas y cheques-filtro OK. No probado en pantalla (necesita la migración).
- **Hecho por Augusto (11/10/2026):** "Completar cheques emitidos" → 339 cheques agregados (13 ya estaban; Martín marcado).
  Extractos guardados: CC 522 líneas y CA 41 (saldos al 09/10: −$1.575.636,31 y $295.614,01). Cruce: 435 automáticos
  (impuesto 168, cheque propio 161, gasto bancario 59, FCI 15, pago 9, entre cuentas 6, tarjeta 5, cobro 5, intereses 3, devuelto 2, acreditado 2)
  → **aplicados por Augusto (11/10/2026)**. Quedan **128 para revisar** (los resuelve él de a poco).
- **Próximo: conciliar cobros con las OP de clientes** (las OP llegan al Gmail **administracion@lazzari.com.ar**; conector de Gmail, solo lectura). 45 entradas al banco desde 01/09 parecen cobros (≈ $242.015.105,87; solo 5 cruzaron):
  lista en `Claude outputs/entradas_banco_sin_cobro_sept_oct_2026.csv` (cuenta;fecha;concepto;importe; "PAGO A PROVEEDORES OP.n" = OP del cliente vía BBVA).
  Augusto manda las OP de clientes (facturas + retenciones + neto) → armar por OP: cliente, facturas, retenciones y la línea del banco que le corresponde,
  para que él cargue el cobro (Facturación) y después "Aplicar cruces" lo enganche solo. No cargar cobros desde el chat.
  Idea de mejora: en "Para revisar", sugerir facturas abiertas del cliente cuyo saldo (neto de retenciones) coincida con la entrada.
  **Hecho 11/10/2026 (leyendo el Gmail de administracion@ en el navegador de la app, solo lectura):** tabla en
  `Claude outputs/cobros_identificados_gmail_sept_oct_2026.csv`: 15 cobros EXACTOS ($186.532.340,43: Corteva Seeds x8, Corteva Agriscience 40,6M,
  Synthon x2, Limagrain x2, Soychu, Adecco) con facturas y retenciones; 9 PROBABLES ($13,1M: SO Energy/Termocórdoba y Pedro Peregrini, PDF escaneados);
  03/09 $15.989.281,41 dudoso (¿Corteva Agriscience pago 31/08?, no cierra) y 4 sin aviso ($20M, incluye 29/09 $15.994.806,07).
  **Segunda búsqueda (por monto, Gmail lee los PDF escaneados):** 27 CONFIRMADOS ($232.993.760,33), incluidos SO Energy/Termocórdoba,
  Criper SA, Pedro Peregrini y Corteva Agriscience 03/09 y 29/09. Quedan: 15/09 $1.394.525,00 (solo en la doc de IVA de agosto del contador)
  y 11/09 $1.255.728,47 (sin rastro).
  **Resueltos con el home banking (11/10/2026):** 15/09 $1.394.525,00 = Logística Casadei SRL (30716804840); 11/09 $1.255.728,47 = Chacraservicios SRL (30708583819).
  → Los 29 ingresos del CSV tienen cliente.
  **Cobros aplicados por Claude en el CRM (11/10/2026, con OK de Augusto):** Corteva Seeds FA 16-1 ($294.483,93 + Gan 5.023,18 cert 4824 + IIBB 4.395,28 cert 6005, 07/10);
  SO Energy FA 15-6 (US$796,24 a TC 1530: $1.184.971,58 + Gan 15.656,33 cert 2590 + IIBB 17.619,29 cert 991, 05/10); Limagrain FA 16-5 (US$301,47 a TC 1520:
  $448.512,85 + IIBB 6.627,39 RB 25897 + Gan 3.094,16 RG 16589, 07/10; dif. cambio −$3.014,70 informativa). Las 3 quedaron "Pagada".
  Ya estaban pagadas: Termocórdoba FA 15-2/15-4/15-7, Criper 16-4, Peregrini 15-27, Chacraservicios 16-2 ($568.558,20 del 25/09). Adecco 05/10 = FA 8-667 (sistema anterior).
  "Aplicar 3 cruces" falló: "Anulá y registrá nuevamente la liquidación" (trigger `proteger_movimiento_fx` solo dejaba cambiar `conciliado`
  en movimientos de liquidaciones USD; el cruce también pone cuenta_id/conciliado_at/conciliado_por). No se guardó nada (todo o nada).
  **Arreglo:** migración `20261011190000_fx_conciliar_cuenta.sql` (+ vuelta atrás): permite esos 3 campos. Sin cambios de código ni publicar.
  **Hecho (11/10/2026):** migración corrida y "Aplicar 3 cruces" aplicado por Augusto.
  **Error a revisar:** "Registrar cobro" de FA 16-1 mostraba "Saldo pendiente $0,00" estando impaga (la CC sí la debía).
- **Idea de Augusto (11/10/2026) — tipo de cambio de cobros en USD:** se cancela con el TC que usó el cliente (pesos ÷ USD); se compara con BNA del día anterior al pago
  (divisa o billete según el cliente, dato en la ficha); si la diferencia supera un % (sugerido 2 %) → aviso "pedir actualización al cliente", nunca frena.
  Además: que el CRM guarde todos los días hábiles la cotización BNA divisa y billete (ya existe el cron `/api/cron/cotizacion`, revisar D1).
  Siguiente: Augusto carga esos cobros en Facturación (los que no estén) y aprieta "Aplicar cruces".

## 4. Pendiente (próximas tandas)

**Tanda V1.1.425 (13/10/2026) — Punto 6: PERMISOS POR ROL. PUBLICADA (commit db0e841). Migraciones 20261013100000 y 20261013110000 CORRIDAS: Mariana ya es administrativo. Falta: que Mariana y un vendedor la prueben (si algo falla, hay rollback).**
- **Cómo trabaja Lazzari (Augusto):** él ve y hace todo. Mariana = administrativa (plata y compras). Los vendedores también compran
  (pedidos, OC, mandarlas, recibir mercadería, cargar facturas de proveedores), llevan muestras, transportes y personalización, y NO pagan.
  Todos ven, crean, editan y eliminan clientes y proveedores; eliminar pide motivo que queda guardado. Manu: NO desactivarlo por ahora.
- **Migración 1 `20261013100000_permisos_por_rol.sql`** (+ vuelta atrás, probada): escribir órdenes de pago, aplicaciones de cobros, eCheqs,
  saldos de caja, movimientos, retenciones y plantillas de mail = solo super_admin/admin/administrativo (leer sigue igual). Gastos manuales:
  crear también vendedores (factura "solo IVA"). Rol administrativo: gastos fijos, crear presupuestos, notificaciones, configuración, plantillas.
  Tabla nueva `registros_eliminados` + funciones `eliminar_cliente` / `eliminar_proveedor` (con historial → se desactiva, sin historial → se borra;
  siempre guarda copia, motivo, quién y cuándo). `registrar_factura_compra_con_oc_extra` acepta vendedores (antes los trababa).
  No se tocó: CAI de remitos (`next_cai_number` escribe `cai_config` con el usuario; es de ARCA), muestras, transportes, personalización, numeración.
  Las 7 funciones de plata ya pedían administración (`lz_puede_operar_finanzas`). Prueba: `scripts/db/pruebas/permisos_por_rol.sql` (35 de 35 OK).
- **Migración 2 `20261013110000_mariana_administrativa.sql`** (+ vuelta atrás): Mariana pasa a administrativa. Correrla DESPUÉS de publicar.
- **App:** `components/eliminar-con-motivo.tsx` (ventanita) en Clientes y Proveedores; proveedores: vendedores crean/editan/eliminan;
  `ROLE_PERMISSIONS` (vendedor: clientes y proveedores completos; administrativo: crear/eliminar clientes, eliminar proveedores, Configuración,
  sin borrar presupuestos); Finanzas: el administrativo puede lo que antes era "solo administrador" (borrar movimientos, ajustes manuales);
  Dashboard: cobertura de gastos fijos también para administrativo; Configuración: pestaña Comisiones solo super_admin/admin.
  tsc 0 errores, hooks OK, probado en local sin guardar (ventanita en Clientes y Proveedores, aviso "Falta correr la migración", Configuración).
- **Pantalla nueva "Facturas"** (`/consulta-facturas`, menú debajo de Ventas, todos los roles; módulo `consulta_facturas`): SOLO LECTURA.
  De venta: buscar (cliente, CUIT, número, PR, OC del cliente), detalle con renglones, CAE y envío, "Ver / bajar PDF" y "Reenviar al cliente"
  (mail con el PDF; la marca de envío la guarda la función nueva `marcar_factura_enviada`, en la migración 1). De compra: buscar (proveedor,
  CUIT, número, OC), detalle con renglones, todas sus OC y "Ver factura del proveedor" (archivo). No emite, no cobra, no paga, no anula.
  No se tocó Facturación (ARCA). Datos del emisor del PDF en `lib/emisor-sociedad.ts` (copia de `emisorData` de Facturación: si cambian, cambiar los dos).
  Probado en local sin guardar ni enviar (101 de venta / 82 de compra en Lazzari; PDF, ventanita de mail cancelada, detalle de compra).
  Prueba de la base: 39 de 39 OK (el vendedor ve las facturas, no las puede cambiar, sí marcar el envío).
- **Para publicar, en orden:** correr migración 1 → publicar V1.1.425 → correr migración 2 → Mariana prueba (si algo no le anda: vuelta atrás 2).
- **Calendario por rol:** queda para más adelante (pedido de Augusto). Hoy un administrativo solo edita/borra sus propios eventos.
- Sugerencia futura: mostrar los clientes/proveedores eliminados (con motivo) en la Papelera.

**Tanda V1.1.418 (12/10/2026) — PUBLICADA (commit 6d75961), migraciones 20261012100000 y 20261012110000 ya corridas por Augusto. Plan y estudio: `docs/ESTUDIO-Y-PLAN-12-10-2026.md`.**
- **Pestaña Revisar** (Finanzas > Hoy): `components/finanzas-revisar.tsx`, lógica `lib/revisar-finanzas.ts` (prueba `scripts/test-revisar-finanzas.mjs`).
  A) lo anotado (tabla nueva `finanzas_revisar`: motivo, nota, "Recordarme el", Resuelto con nota, Posponer, Volver a pendiente; no se borra nada);
  B) lo que encuentra el sistema (movimientos con fecha futura, cheques recibidos en cartera vencidos hace +3 días, líneas del extracto sin cruzar).
  Botón "Dejar para revisar" (`components/dejar-revisar.tsx`) en: detalle de cheque, orden de pago, factura de compra, factura de venta y cada línea "Para revisar" del extracto.
  La campana avisa el día de "Recordarme el" (cron `presupuestos-vencimiento`). Sin la migración muestra "Falta correr la migración" y no rompe.
  **Migración nueva:** `20261012100000_finanzas_revisar.sql` (+ vuelta atrás). Aditiva, una tabla, sin DELETE.
- **Cobro masivo con diferencia** (`cobro-masivo-liquidacion.tsx`, reparto en `lib/cobro-reparto.ts`, prueba `scripts/test-cobro-reparto.mjs`):
  Confirmar ya no se traba; cuadro amarillo con cómo queda cada factura (más vieja primero, el saldo queda en la más nueva); antes de guardar avisa y pregunta;
  casilla "Dejar en Revisar" (tildada) anota la diferencia. Las facturas se mandan a la base ordenadas de la más vieja a la más nueva.
  Probado en local SIN guardar con Del Sol (eCheq $6.210.728,30 vs 5 facturas $6.463.222,05): FA 15-54 queda con $252.493,75.
  **Función de la base leída (12/10/2026):** `registrar_cobro_masivo` reparte EN PROPORCIÓN al "saldo" que recibe y la última se lleva el resto
  (copia en `supabase/diagnostico/registrar_cobro_masivo_actual.sql`). Por eso la pantalla manda a cada factura lo que le toca y deja afuera las que no reciben nada
  (`facturasParaRegistrar`, simulado en la prueba): **no hace falta migración** para dejar el saldo en la más nueva. Si sobra plata, la base se lo aplica a la última (queda a favor en la CC).
  Ojo: la base solo acepta facturas "emitida" o "parcial" (una "vencida" da error al cobrar en masa). Revisar.
  **"Diferencia a la cuenta corriente" (OK de Augusto 12/10, HECHO en código):** en el cobro masivo con faltante (solo facturas en pesos) se elige
  "Saldo en la factura más nueva" o "Diferencia a la cuenta corriente": las facturas quedan pagadas y la diferencia queda como deuda suelta del cliente.
  **Migración nueva:** `20261012110000_cobro_diferencia_cc.sql` (+ vuelta atrás): función `registrar_cobro_masivo_diferencia_cc` (llama a la segura de siempre con un
  renglón "ajuste" que cierra las facturas y graba un ajuste `ajuste_sentido = 'debito'` en la CC; todo junto; doble clic no duplica). Sin la migración avisa y se usa la otra opción.
  **Saldo de clientes unificado:** `lib/saldo-clientes.ts` ahora suma los ajustes de CC sin factura (débito = deuda, crédito = a favor). Antes solo Finanzas > CC Clientes los sumaba;
  el listado de Clientes, Facturación y Ficha 360 no (daban otro número si había ajustes manuales). Prueba `test-saldo-clientes.ts` ampliada.
  Probado en local SIN guardar (Del Sol): las dos opciones se ven y explican bien.
  ⚠️ Si sobra plata, la base se lo suma a la última factura y hoy NO se ve como saldo a favor (el saldo por factura no baja de 0). El cartel ahora lo dice; queda en Revisar. Resolver más adelante.
  **Respuestas de Augusto para "Liquidar servicios":** internos = independientes, se les paga por viaje; liquidación mensual pero a veces piden cobrar antes (liquidar cuando quiera);
  sin adelantos; pagos variados (transferencia, eCheq, efectivo); algunos sin CUIT; el flete a veces se le cobra al cliente, pero mezclado en los precios o con un renglón "Envío"
  (no sirve "facturar el flete"). El flete es proporcional, no hay monto fijo por entrega; algunos clientes no quieren ver "Envío".
  **Acordado (12/10):** cada viaje atado a su venta (por remito o eligiéndola); renglón "Envío/flete/traslado/entrega" del presupuesto = flete cobrado explícito;
  en la venta: margen antes y después del flete real (si el flete estaba metido en los precios, se ve si el precio lo cubrió); reporte "Fletes del mes" por cliente.
  Sin campo de "flete incluido" por ahora (no hay monto fijo); se suma solo si hace falta.
- Visto de paso: en "Cobro masivo — Selección de facturas" de Del Sol aparece la **NCA 0015-5** ($1.242.839,98) como pendiente de cobro (no debería listar NC). Revisar.
- **Decisiones de Augusto sobre mejoras (12/10/2026)** — lista en el chat:
  Transportes: **A** (el viaje se arma desde el remito: "¿Quién lo lleva?") y **E** (liquidación del mes armada sola) = OK; **B** (salida con varias paradas) DESCARTADA; C y D no elegidas.
  Pidió más info de: 2 (Esperando OC del cliente), 3 (margen real por venta), 4 (presupuestos que se enfrían), 5 (proyección de caja 30/60/90), 6 (un solo número de plata disponible), 12 (bandeja única de avisos), 15 (pruebas viejas).
  Le sirven: 7 (cobros sugeridos desde el extracto), 9 (cobro masivo con facturas vencidas), 11 (Mercado Libre → Visa), 13 (ficha "cómo paga"), 14 (Finanzas más rápida), 16 (anular en vez de borrar).
  10 (retención Ganancias por tipo): espera al contador el martes 13/10. 17 (seguridad): proponerlo más adelante.
- **Clientes que piden OC para facturar (dato de Augusto 12/10/2026):** Synthon, Corteva Agriscience, Corteva Seeds, Adecco, Termocórdoba, SO Energy.
  Del Sol manda OC pero no es imprescindible. (Cargar la marca "Pide OC para facturar" cuando se haga el punto 2; lleva migración.)
- **Presupuestos que se enfrían (punto 4), gustos de Augusto:** mensaje amigable ("Hola Juan, ¿cómo estás? ¿Pudiste ver el PR N° …?");
  estados Aprobado / Rechazado (no "ganado/perdido"); dentro de Rechazado, opción "Postergado". No pide adelantos a clientes.
- **Margen real por venta (punto 3):** más adelante; revisar los "costos" que Augusto ya puso al armar un PR y ordenarlos.
- **Prioridad de Augusto (12/10/2026): ARREGLAR LO ROTO primero**, de a un tema por vez y a fondo, empezando por las funciones viejas de Manu.
  Paso 1 HECHO: Augusto corrió `supabase/diagnostico/todas_las_funciones.sql`; el resultado está en
  `C:\Users\lazza\Downloads\Supabase Snippet Untitled query (5).csv` (98 funciones + triggers, una sola fila; leerlo por partes, pesa 270 KB).
  **PRÓXIMO:** comparar esas funciones con `crm/app/supabase/migrations`, listar las hechas a mano y lo roto (ordenado por gravedad, en palabras simples)
  y arreglar de a un tema por vez con OK de Augusto. Ya conocidos: `registrar_cobro_masivo` no acepta facturas "vencida"; el pago de más se pierde
  (no queda a favor); Caja/Balance (`get_balance_projection`) y Dashboard (`get_dashboard_kpis`) calculan distinto que Cuentas; 13 de 59 pruebas fallan.
  **Paso 2 HECHO (12/10/2026): comparación.** 99 funciones en la base: 63 iguales al repo, 3 con diferencias menores, 36 hechas a mano (no están en el repo).
  Diferencias: `crear_presupuesto_atomico` en la base graba como operador el `created_by` que manda la pantalla (el repo usa el usuario logueado);
  `conciliar_extracto_movimiento` y `anular_liquidacion_fx` = solo formato / la base es más estricta (OK).
  Ojo: `registrar_cobro` y `registrar_cobro_masivo` (de Manu) SIGUEN EN USO: las llaman `registrar_cobro_seguro` / `registrar_cobro_masivo_seguro`.
  Lista de lo roto entregada a Augusto, por gravedad: 1) `handle_new_user` toma el rol que manda quien se registra (si el registro público
  de Supabase está abierto, cualquiera entra como super_admin); 2) `registrar_cobro_masivo` reparte proporcional, el pago de más queda dentro de la última
  factura (no a favor), rechaza "vencida", usa el saldo que manda la pantalla, liga todas las aplicaciones al primer medio, moneda de la última factura;
  `registrar_cobro` también rechaza "vencida"; 3) trigger `recalcular_oc` pone IVA 21 % fijo a toda la OC en cada cambio de renglón (también al recibir):
  rompe OC de PR manual (IVA 0) y renglones al 10,5 %; 4) `get_balance_projection` (Finanzas → Balance) no cuenta facturas "parcial"/"vencida",
  usa el total y no el saldo, ignora el vencimiento real; 5) `get_dashboard_kpis` suma ARS + USD juntos y NC como venta, "pendiente de cobro" solo "emitida";
  6) funciones con permiso total sin chequear sociedad/rol (`increment_stock`, `change_pr_operator`, `registrar_cobro*` directas, `get_*` con sociedad vacía);
  7) menores: `auto_estado_oc` revive OC canceladas, alertas sin sociedad (`check_stock_bajo`, `presupuesto_estado_alert`), `generate_document_number`
  con dos versiones (la de 2 datos es una trampa), `next_cai_number` gasta el número aunque el remito falle, saldos guardados en
  `clientes/proveedores.saldo_cuenta_corriente` mal calculados (la app no los usa). **Esperando OK de Augusto para arreglar de a uno, empezando por el 1.**
  **Punto 1 (usuarios) HECHO EN CÓDIGO, SIN PUBLICAR (V1.1.419), con OK de Augusto:** Augusto es el único super_admin y el único que invita/maneja usuarios.
  Hallazgos: "Allow new users to sign up" estaba PRENDIDO en Supabase (se le pidió apagarlo); la regla `profiles_update_own` dejaba que cualquiera
  se cambie el rol; los admin podían invitar y cambiar roles. Migración `20261012120000_usuarios_solo_superadmin.sql` (+ rollback): `handle_new_user`
  siempre "viewer", disparadores que solo dejan al super_admin (o al servidor/SQL Editor) cambiar rol/activo/email y `user_sociedades`.
  Código: `/api/invite` y `/api/users` solo super_admin; dar de baja ya NO borra el usuario (solo inactivo + bloqueado); Configuración muestra
  la gestión de usuarios solo al super_admin. Laura: tiene 1 movimiento y 15 actividades → baja sin borrar con
  `supabase/diagnostico/baja_laura_12_10_2026.sql` (+ vuelta atrás). **12/10/2026: Augusto apagó el registro público, corrió la migración
  20261012120000 (Success) y la baja de Laura (listo).** José Alvarez es vendedor que NO usa el sistema (solo para asignarle PR y ventas):
  se propuso bloquearle solo la entrada (sin tocar su ficha); falta OK. Falta que diga qué hacer con Manu.
  **OK de Augusto a todo (12/10/2026).** Scripts listos para que los corra: `diagnostico/bloquear_entrada_jose_12_10_2026.sql` (solo entrada),
  `diagnostico/baja_manu_12_10_2026.sql` (baja sin borrar), `diagnostico/laura_pasar_a_mariana_y_borrar_12_10_2026.sql` (su movimiento y
  actividad pasan a Mariana con marca `pasado_de` y se BORRA el usuario; sin vuelta atrás). Pedido: "nadie que yo no invite entra, ni a mirar":
  migración `20261012130000_usuarios_nuevos_inactivos.sql` (+ rollback; usuario nuevo nace inactivo, la invitación del CRM lo activa) y
  middleware: sin ficha o inactivo → afuera. Probado en local: Configuración carga con Augusto.
  **CORRIDO por Augusto (12/10/2026):** José bloqueado (vendedor, activo, entrada bloqueada hasta 2126), Laura borrada (15 actividades a Mariana),
  migración 20261012130000 OK. **Manu NO se dio de baja (decisión de Augusto: que pueda entrar por si hace falta);** `baja_manu_12_10_2026.sql` queda sin usar.
  Roles según Augusto: Jero y Seba vendedores, Mariana administradora (falta confirmar si en la base es "admin" o "administrativo"
  con `diagnostico/estado_usuarios.sql`), rol de Manu sin confirmar.
  **PUNTO 1 TERMINADO.** El código (api/invite, api/users, configuración, middleware) sale en la próxima publicación (V1.1.419).
  **Punto 2 (cobros) HECHO EN CÓDIGO, SIN PUBLICAR (V1.1.419), con OK de Augusto (12/10/2026; pago de más → saldo a favor en la CC del cliente).**
  Migración `20261012140000_cobros_corregidos.sql` (+ rollback que deja las funciones de Manu textuales): reescribe `registrar_cobro` y
  `registrar_cobro_masivo` con los mismos parámetros (las `_seguro` y `registrar_cobro_masivo_diferencia_cc` no cambian). Ahora: acepta "vencida";
  lo cobrado se calcula como `gestionar_cobro` (sin anulados ni dobles) con la ayuda nueva `lz_cobrado_factura`; el masivo calcula el saldo real
  y reparte de la más vieja a la más nueva, **cada medio y cada retención con sus propias `cobro_aplicaciones`** (antes todo al primer medio:
  si rebotaba otro cheque la factura seguía pagada); **pago de más = movimiento `ajuste` con `ajuste_sentido='credito'`** atado al cobro por la
  columna nueva `movimientos.cobro_origen_id`; disparador `lz_anular_a_favor_de_cobro`: si ese cobro se anula o se borra, el saldo a favor se anula solo.
  No se mezclan ARS y USD (error claro). **USD masivo:** la pantalla ahora manda `tipo_cambio` en medios y retenciones; los movimientos quedan en ARS
  y lo aplicado en USD (antes grababa los pesos como dólares). Sin TC → error claro. Cobro simple: lo que sobra también queda a favor.
  Pantalla: textos de "sobran" (masivo, Revisar y cobro simple) dicen que queda a favor. Probado en un Postgres de juguete (PGlite) con datos
  inventados: 10 casos OK (justo, de menos, de más, cheque rebotado, borrado, vencida, USD, mezcla, diferencia a CC, doble clic, vuelta atrás).
  tsc 0, check-hooks OK, test-cobro-reparto y test-cobros-cheques-atomicos OK. Finanzas carga en local.
  **Orden al publicar: primero la migración 20261012140000, después el código** (si no, un cobro masivo en USD daría "falta el tipo de cambio").
  **Falta que Augusto corra (solo lectura):** `supabase/diagnostico/cobros_revisar_12_10_2026.sql` → lista cobros viejos atados a un solo medio,
  facturas cobradas de más (sobrante escondido), cobros USD grabados en pesos y cuántas facturas tienen "vencida" en la base. Con eso se decide
  qué corregir de lo viejo, de a uno y con OK.
  **Resultado de la revisión (12/10/2026):** 0 cobros USD en pesos, 0 facturas cobradas de más, 0 "vencida" en la base. 2 cobros con las
  retenciones colgadas del medio: DEL SOL cheque 3881 (30/09, $3.677.887,22 aplicado $3.739.700,45) y TERMO CORDOBA transferencia
  (05/10, $181.135,41 aplicado $186.340). Script listo, ESPERANDO OK: `diagnostico/corregir_cobros_atados_12_10_2026.sql` (+ `_vuelta_atras`):
  pasa cada retención a su propia aplicación sin cambiar lo cobrado por factura; se corta sin cambiar nada si no coincide al centavo;
  respaldo en `lz_respaldo_correcciones`. Probado en PGlite (corrige, 2.ª vez no hace nada, vuelta atrás deja igual).
  **CORRIDO por Augusto con OK (12/10/2026):** 5 renglones, todos con monto = aplicado (DEL SOL cheque + Ganancias; TERMO transferencia +
  Ganancias $2.509,59 + IIBB $2.695). **PUNTO 2 TERMINADO.** Falta solo publicar (migración 20261012140000 primero, después el código).
  **Resumen económico en Finanzas → Hoy → Cuentas (12/10/2026, pedido de Augusto, V1.1.419 sin publicar, sin migración):** se sacaron los botones
  "Caja" (saldo inicial a mano, repetía las cuentas) y "Balance" (usaba `get_balance_projection`, mal: ya no se llama). En su lugar, arriba de las
  cuentas: "Resumen: cómo estoy hoy" → Lo que tengo (disponible, cheques en cartera + depositados, a cobrar = CC clientes neto, vendido sin
  facturar = PR aprobados/facturar sin factura, apagado de entrada) − Lo que debo (cheques emitidos, a pagar = CC proveedores neto, deudas =
  `lineas_credito.monto_utilizado`) = posición neta, ARS y USD aparte + todo en pesos con BNA divisa. "Elegir qué ver": casillas guardadas en
  localStorage de la compu. Cálculo puro `lib/resumen-economico.ts` (prueba `scripts/test-resumen-economico.mjs` OK), componente
  `components/resumen-economico.tsx`, `CuentasFinancieras` acepta `resumen` (reemplaza los 4 recuadros). Probado en local: posición neta
  $1.416.070,25 + US$ 39.774,43 (todo en pesos $61.753.880,56). Tarjetas de crédito: el sistema todavía no tiene su deuda como número
  (`deudaTarjetas` siempre 0; solo nota en la cuenta) → sumarla cuando se carguen los resúmenes. Quedan en el código (sin uso) los cálculos viejos de Caja.
  **TANDA V1.1.419 PUBLICADA (12/10/2026, commit 66166a2, vercel --prod Ready), con la migración 20261012140000 ya corrida por Augusto (Success).**
  **Punto 3 (`recalcular_oc`) HECHO Y MIGRACIÓN `20261012150000_recalcular_oc_iva.sql` CORRIDA (12/10/2026, verificado: 125 de 125 OC bien)** (rollback en `supabase/rollback/`).
  Nueva regla: IVA por renglón (`iva_porcentaje`, sin dato = 21 %, redondeo por renglón como la pantalla); PR manual → 0; OC que ya estaba
  sin IVA → sigue sin IVA; recepción (`cantidad_recibida`) no recalcula. Corrige OC de Lazzari (todas recibida), confirmado contra la factura
  del proveedor: 1160/1166/1184/1194 (PR manual) y 1112/1142/1148 (FC sin IVA) → IVA 0; 1059/1216 → IVA por renglón 10,5 %. Respaldo en
  `lz_backup_oc_iva_20261012`. OC-2026-1173 (con OK de Augusto): su factura vino al 21 % y los renglones decían 10,5 % → renglones pasan a 21 %
  (10 OC en total). Después de correrla, verificar con `node scripts/lectura/oc-iva.cjs` (tiene que dar 0 con diferencias).
  Simulación (`scripts/lectura/oc-iva-simular.cjs`): las otras 113 OC no cambian; 1104 y 1199 diferirían 3 centavos si se edita un renglón.
  No cambia la app ni la versión.
  **Punto 5 (`get_dashboard_kpis`) HECHO Y MIGRACIÓN `20261012240000_dashboard_kpis_monedas.sql` CORRIDA (12/10/2026)** (rollback = la función
  vieja copiada de la base). Ventas/facturado/cobranzas del mes y pendiente de cobro: ARS solo en las claves de siempre, USD en claves nuevas `_usd`;
  NC restan (sin anuladas ni NC de factura anulada); pendiente = saldo real por factura (total − NC aplicadas − cobrado, como Facturación);
  cobranzas sin anulados; mes según hora de Argentina. Probado antes sin guardar: coincide al centavo con `lib/reportes-comprobantes` y
  `lib/saldo-clientes` en las dos sociedades (Lazzari oct $8.881.926,69 / US$8.228,31; pendiente $48.401.672,76 / US$45.323,02).
  Dashboard en producción OK. La pantalla ya calculaba bien el facturado por su cuenta (no mostraba los números rotos), así que no cambia la app
  ni la versión. Queda la versión vieja `get_dashboard_kpis()` sin sociedad (nadie la usa; va con el punto 6).
  **Forma de trabajo nueva (12/10/2026):** las lecturas de la base las corre Claude con scripts de SOLO LECTURA en `crm/app/scripts/lectura/`
  (permiso agregado en `.claude/settings.local.json`); Augusto aprueba listas numeradas en bloque. Regla: si cambia el costo de una OC,
  se actualiza el costo en el PR de origen.
  **TANDA V1.1.420 PUBLICADA (12/10/2026, commit 2c97f12, vercel --prod Ready), con OK de Augusto ("todo"). Migración `20261012160000_oc_estados.sql` CORRIDA por Claude con `scripts/db/migrar.cjs`** (rollback en `supabase/rollback/`).
  Verificado después: pago = 56 pagadas por facturas + 12 tarjeta + 57 pendientes; facturación = 64 facturada, 4 parcial, 57 sin factura;
  IVA 125/125 bien; las 3 "recibida" con 0 ya están completas. Quedan "pendiente" con todas sus facturas pagadas solo las que están
  facturadas en parte (1062, 1088, 1180, 1199) y la cancelada 1043: es la regla (pagada = facturada completa y todo pagado).
  **Revisión de estados de OC (12/10/2026, `scripts/lectura/oc-estados.cjs`):** 125 OC: enviada 40, recibida 81, recibida_parcial 3, cancelada 1.
  `estado_facturacion` y `estado_pago` casi nunca se actualizan solos: 60 OC facturadas completas con `estado_facturacion` vacío y 61 con
  todas sus facturas pagadas pero `estado_pago` = pendiente (la pantalla de OC lo calcula bien desde las facturas, los campos guardados no).
  17 OC "enviada" ya tienen factura (nadie registró la recepción); 3 "recibida" con 0 recibido (1134, 1130, 1173); OC-1043 cancelada con
  recepción completa y factura. OC-1043: queda para que la revisen los vendedores (no se toca).
  Qué tiene la tanda: (1) migración: `estado_facturacion`/`estado_pago` de la OC se completan SOLOS con disparadores en `facturas_compra`
  y `factura_compra_ocs` (`lz_actualizar_fact_pago_oc`; pagada por facturas = `medio_pago` 'facturas', `pagada_at` = fecha de la última OP;
  tarjeta y canceladas no se tocan) + corrige todas las OC (respaldo `lz_backup_oc_estados_20261012`); `auto_estado_oc` no revive canceladas;
  OC-1130/1134/1173 recibidas completas (sin stock, son pedidos de PR); 3 centavos de OC-1104/1199. (2) Compras: filtro "A reclamar" (pagada y
  sin recibir), cartel "Pagada · reclamar", avisos de atraso (pagada > 7 días sin recibir, sin recibir > 30 días; `lib/oc-reclamos.ts`, prueba
  `scripts/test-oc-reclamos.mjs` OK); en el detalle de la OC, "Órdenes de pago" con "Descargar OP" y certificado de retención
  (`lib/orden-pago-pdf.ts`, mismo PDF que Finanzas). Editar la OC no pisa el pago automático. Probado en local sin guardar (16 a reclamar,
  OP de OC-1199 descargada). Los vendedores ya pueden leer `ordenes_pago`/`op_facturas_compra` (no hizo falta regla nueva).
  SEGURIDAD HECHO (12/10/2026, migración `20261012170000_cerrar_tablas_sin_login.sql` CORRIDA por Claude, rollback en `supabase/rollback/`):
  las reglas `public`+`true` de ordenes_pago, op_facturas_compra, cobro_aplicaciones, echeqs, email_templates, gastos_manuales y saldos_caja
  pasan a `authenticated` (sin login ya no se ve ni se toca nada: probado con `scripts/lectura/probar-anonimo.cjs`; logueado sigue igual,
  probado en local). Queda abierta a propósito `cotizaciones_dolar` (anon inserta/actualiza: la usa la carga del dólar).
  Pendiente punto 6: afinar por rol (hoy cualquier logueado puede todo en esas tablas).
  ⚠️ Augusto pegó el `.env.local` completo en el chat (12/10/2026): conviene cambiar la clave de Anthropic y, con cuidado (toca Vercel),
  la `service_role` de Supabase. La contraseña de la base ya se regeneró.
  **OC con diferencia (12/10/2026, OK de Augusto "dale 1 a 5", va en V1.1.420). Migración `20261012180000_oc_diferencias.sql` CORRIDA**
  (probada antes con `migrar.cjs --probar scripts/db/pruebas/oc_diferencias.sql`, que deshace todo). Agrega `diagnostico_diferencia_oc`,
  `ajustar_oc_a_factura` (precios de la OC × factura neta / OC neta, IVA de la factura si es 21/10,5/0, costo al PR con la misma búsqueda y
  cuenta de margen que la conciliación; guarda lo anterior en `lz_oc_ajustes`), `deshacer_ajuste_oc`, y disparador al cerrar/reabrir saldo
  (recalcula pago y avisa al vendedor del PR en `alertas`). Pantalla: filtro "Con diferencia" (hoy 4: OC-1062, 1088, 1180 por precio;
  OC-1199 faltan 2 unidades) y cartel amarillo en el detalle con "Ajustar OC a la factura" / "Cerrar: no entrega el resto" (sugerida
  marcada, `lib/oc-diferencia.ts`, prueba `scripts/test-oc-diferencia.mjs` OK) y "Deshacer ajuste". Las 4 OC NO se tocaron: las decide Augusto.
  **Acceso directo a la base (OK de Augusto):** `pg` instalado (dev); `scripts/lectura/sql.cjs` (consulta en transacción READ ONLY) y
  `scripts/db/migrar.cjs` (corre UN archivo de migración/rollback en transacción; solo con OK de Augusto; `--probar <scripts/db/pruebas/x.sql>` corre y deshace). Necesitan `SUPABASE_DB_URL` en
  `.env.local` (ya cargada; permisos en `.claude/settings.local.json`: lectura y `migrar.cjs`). Claude corre las migraciones que Augusto aprueba.
  **Carga de facturas de compra contra OC más fácil — PUBLICADO V1.1.421 (12/10/2026, commit 56b6c2f, sin migración).** OK de Augusto al plan 1-9:
  (1-3) motor `lib/purchase-matching.ts`: código tolerante (`mismoCodigo`: ceros adelante, guiones, talle pegado; nunca otro talle) y paso
  nuevo "parecido" (`puntajeParecido`: nombre hasta 50 + misma cantidad que lo pendiente 35 + precio 15/5; mínimo 40; la cantidad sola no
  alcanza, hace falta una palabra en común; siempre amarillo, se aprende al confirmar). La carga individual (`cargar-factura-oc.tsx`) usa
  las mismas reglas (y la IA igual revisa lo propuesto por parecido). (4) "Facturado de más" (`sinAsignar.tipo = "de_mas"`, amarillo) ≠ "sin OC"
  (rojo); las rojas ya no frenan el confirmar. Lo que vino sin OC o de más va a una **OC complementaria** creada y atada a la factura
  (casilla marcada; si falla el guardado, la OC queda cancelada, no se borra); "Aceptar de más en la OC-x" la deja en la misma OC.
  (5-6) conciliación: concilia sola al abrir, arranca mostrando solo lo que no cierra ("N renglones cierran solos — Ver todo"), botones
  "Es este, OK" / "Aceptar precio" / "A reclamar" (queda en notas de la FC) / "Fuera de OC" y "¿Es este? OC-x … Asignar" en las rojas.
  (7) la IA lee `referencias_oc` (N° de nuestra OC impreso en la factura) y el motor prefiere esa OC (`citaOc`, `ocPreferidas`).
  (8) carga masiva: al terminar de leer cruza sola cada proveedor (análisis en `lib/conciliacion-compras-analisis.ts`, compartido con la
  pantalla), muestra "Cierra con las OC" / "N para revisar" y el botón "Confirmar las que cierran" (abre cada una con `autoConfirmar` y la
  guarda sola si todo está en verde; las demás quedan abiertas mostrando solo lo que no cierra). Varias facturas de la misma OC: se
  reparten contra lo pendiente. (9) pruebas: `scripts/test-purchase-parecidos.cjs` y `test-purchase-matching.cjs` OK; lectura
  `scripts/lectura/probar-parecidos.cjs` con las 3 FC reales conciliadas, sin IA: 29 propuestas por parecido, 0 erradas; sin cruzar 129 → 10 u.
  tsc 0 errores, hooks OK; en local abren conciliación y carga masiva sin errores. NO probado guardando (base real): probar al publicar con una
  factura real. "Cerrar saldo" de lo que falta sigue en el detalle de la OC (no se duplicó en la conciliación).
  **Enviar OC al proveedor — PUBLICADO en la misma V1.1.421 (12/10/2026).** Pedido de Augusto:
  al aprobar un PR se propone sola la ventana `components/enviar-oc-proveedor.tsx` con sus OC con proveedor aún no pedidas (sugerencia,
  "Después" la cierra). Por OC: WhatsApp (wa.me con la OC escrita), Mail con PDF (`EmailComposeModal`), Copiar y PDF. Toma el WhatsApp
  y mail del contacto principal del proveedor (`contactos` entity_type proveedor; si no, teléfono/mail del proveedor); si falta o se
  cambia, botón "Guardar en el proveedor" (actualiza el contacto principal o crea "Compras"). Al enviar por WhatsApp o mail marca la
  OC como pedida (`pedido = true`, con "deshacer"). También botón "Enviar" en cada fila y en el detalle de Compras.
  Aviso "IMPORTANTE: por favor indicar el N° de orden de compra X en la factura (y en el remito)" en el PDF (recuadro arriba de los
  renglones), en WhatsApp/copiar y en el mail (`lib/oc-envio.ts`). Con eso la IA lee `referencias_oc` y cruza la factura con su OC.
  Probado en local: la ventana abre y arma todo sin errores; NO se envió nada.
  **V1.1.421 publicada por Augusto (12/10/2026, Vercel Ready, se ve "V1.1.421").** Probado por Claude en producción: la ventana "Enviar OC" abre
  (OC-1224 Prisina: mail cargado, WhatsApp vacío porque el proveedor no tiene teléfono, aviso del N° de OC) y se cerró SIN enviar.
  **Falta:** cargar una factura de compra real contra su OC (necesita el PDF de Augusto; guarda datos reales → avisar antes).
  **Tanda V1.1.422 (12/10/2026, OK de Augusto "Va 1 a 4") — PUBLICADA por Claude (commit 680e1f9, Vercel Ready), migración CORRIDA.**
  Probado en producción: "Abiertas 77 / Todas 125 / Completas 47", tarjeta A reclamar, y el cartel de OC-1199 dice
  "Facturado y pagado $2.340.164,27 de $2.412.764,36. Diferencia $72.600,09 (3 %). Faltan facturar 2 unidades".
  **Tanda V1.1.423 (12/10/2026) — PUBLICADA por Claude (commit 525a675, Vercel Ready) y probada en producción.**
  - **Migración `20261012200000_proveedores_lista_fantasia.sql` CORRIDA** (+ vuelta atrás): vínculo proveedor ↔ nombre en `catalogo_crm.csv`
    (`catalogo_proveedores`, las dos sociedades) y nombre de fantasía, confirmados por Augusto: Prisina, TKW, Startex, FADI, Aire Libre (AYRE LIBRE SA),
    Mediglove, Segutécnica, Segufer, BH Industrial (EUGENIO MASTROIANNI 20-08528051-2; GRUPO MASTROIANNI S.A. es otro CUIT sin movimientos),
    Iturria (COMERCIALIZADORA ITURRIA MDP), SPI (SPI SHIELD INDUSTRIAL), DPS (INDUSTRIAS DE PASCALE), Conoflex (SERENPLAS SRL).
    Se sacó "Delta Plus" de ESPACIO MARKETING (era un error: Delta Plus = **ESLINGAR**, no está cargado en el CRM).
    **Pendientes:** dar de alta Eslingar (Delta Plus) y **MARIANA SA** (Pegaso) y vincularlos; Ecoway (Augusto pasa el nombre); Fravida (sin confirmar).
  - Ordenar OC abiertas: al abrir muestra botones con los proveedores que tienen lista de costos y renglones sin ordenar (hoy: Prisina 59, Star-Tex 23,
    TKW 19, De Pascale 9, Ayre Libre 6, Mastroianni 4, Mediglove 3, Segutécnica 2, Serenplas 2; FADI ya ordenado). Se busca también por fantasía.
  - Compras: el proveedor se ve "RAZÓN SOCIAL · Fantasía" (si es distinta) y se busca por los dos (`lib/proveedor-nombre.ts`, prueba `scripts/test-proveedor-nombre.ts`).
  - **Enviar OC: solo al contacto de VENTAS** (`contactoVentas` en `lib/oc-envio.ts`, prueba `scripts/test-contacto-ventas.ts`). Nunca usa el mail del
    proveedor (es el de administración, para facturas; se muestra "Administración: x (no se usa)") ni contactos de Cobros. "Guardar en el proveedor"
    crea/actualiza el contacto "Ventas". Probado en producción con OC-1224 Prisina: campos vacíos + aviso; cerrado SIN enviar.
  - **Datos de proveedores (Excel `Claude outputs/proveedores_datos_faltantes_12_10_2026.xlsx`):** de los 51 con OC, 48 sin vendedor (WhatsApp/mail),
    27 sin mail de administración, 10 sin CBU; Prisina, FADI, Inmuovi y San Martín tienen un mail de ventas en el campo de administración.
    Augusto lo completa y Claude carga los vendedores (mostrar la lista antes de guardar).
  - **Pendientes de Augusto como checklist en Finanzas > Hoy > Revisar** (migración `20261012210000_pendientes_proveedores_augusto.sql`, corrida, con
    vuelta atrás; aviso en la campana el 13/10): Excel de vendedores, alta de Eslingar y Mariana SA, Ecoway/Fravida, CUIT de los talleres.
  - Los vendedores se cargan en Proveedores > ficha > "Contactos comerciales" (ya existía) con **Cargo = Ventas**: de ahí los toma "Enviar OC".
  **Tanda V1.1.424 (12/10/2026) — EN CURSO, código SIN PUBLICAR (en el working tree, tsc 0 / hooks OK, probado en local sin guardar):**
  - Regla de Augusto: **un mail de ADMINISTRACIÓN** (facturas, cobros y pagos = `proveedores.email` + `proveedores.telefono`) y **VENDEDORES**
    (contactos, siempre cargo "Ventas"; no se puede cargar cobros/administración como contacto). Cada mail/WhatsApp con el **nombre de la persona**
    (falta: columna nueva para el nombre de administración).
  - WhatsApp en dos casillas: característica (2 a 4 dígitos) + número sin 15, suman 10 (`lib/whatsapp-ar.ts`, prueba `scripts/test-whatsapp-ar.ts`;
    `components/ui/whatsapp-input.tsx`): en ficha, formulario de proveedor y Enviar OC. Formulario: secciones "Administración (facturas, cobros y pagos)"
    y "Comercial (vendedores…)" con "+ Agregar vendedor" (se sacaron "+ email"/"+ celular"). Ficha: "Mail/WhatsApp de administración" y sección de vendedores.
    ⚠️ La sección vieja "Comercial" (forma de pago, días CC, límite, saldo) NO se renombra ("Condiciones de pago" es otra cosa, dijo Augusto);
    propuesta: la de vendedores se llama **"Vendedores"** (esperando OK).
  - **Migración `20261012220000_proveedores_admin_comercial.sql` YA CORRIDA** (+ vuelta atrás con copia): Star-Tex (cuentascorrientes@startex.com.ar,
    nota "Administración: Belén") y Matcom (info@felemax.com) pasan el contacto "Cobros" al mail de administración y se sacan esos 2 contactos;
    Air Products y Amoblamientos Nexo → cargo Ventas; 15 WhatsApp con formato "característica número".
  - **PLAN "Cómo se le paga a cada proveedor" (pedido de Augusto 12/10, esperando OK al plan numerado del chat):**
    condición = Anticipado / Contra entrega / Cuenta corriente N días / **Escalonado de N a M días**; días 0-15-30-45-60-75-90; medios (varios + preferido):
    transferencia, eCheq, cheque físico, tarjeta, efectivo; **plazo del cheque con las mismas opciones de días**.
    **3 fechas de cheque por mes** (idea interna de Augusto, si el proveedor lo permite): ej. oct 12·21·31, nov 11·21·30, dic 11·20·30 → la OP / plan de pagos
    proponen los cheques en esas fechas. Datos que dio Augusto: **Prisina escalonado 30 a 75 días, TKW escalonado 30 a 75, Segutécnica 60 días**; el resto lo irá pasando.
    Proveedor nuevo cargado desde Compras: en la OC / carga de factura el comprador indica la condición de pago que pide el proveedor (se guarda en el
    proveedor; aviso amarillo si falta, nunca bloquea). **"Nuevo proveedor" desde la factura** (`cargar-factura-oc.tsx`, `carga-masiva-facturas-compra.tsx`)
    hoy es un formulario aparte e incompleto (forma de pago vieja, sin vendedores): usar el MISMO formulario completo que Proveedores.
    **OK de Augusto "Va 1 a 7" (12/10/2026):** 1) nombre en cada mail/WhatsApp (administración y vendedores), sección "Vendedores";
    2) bloque "Cómo se le paga" en el proveedor; 3) 3 fechas de cheque por mes en Configuración, OP/plan de pagos proponen esas fechas
    (escalonado: un cheque en cada fecha permitida dentro del rango); 4) factura calcula su vencimiento; 5) "Pago que pide el proveedor" en OC y
    carga de factura (se guarda en el proveedor; aviso, nunca bloquea); 6) "Nuevo proveedor" desde factura (individual y masiva) = MISMO formulario
    que Proveedores (extraer el modal de `proveedores/page.tsx` a `components/proveedor-form-modal.tsx`); 7) migración.
    Respuestas: **días desde la FECHA DE FACTURA**; **pronto pago: Star-Tex 5 % y DPS 5 % por pago anticipado** (DPS casi obligatorio anticipado:
    tiene CC de ~400 USD). Plazo del cheque: mismas opciones de días que la cuenta corriente (0-15-30-45-60-75-90).
    **HECHO 1/7: migración `20261012230000_proveedores_formas_pago.sql` CORRIDA** (probada antes con `--probar scripts/db/pruebas/proveedores_formas_pago.sql`;
    vuelta atrás en `rollback/`): proveedores.`administracion_nombre, condicion_pago` (anticipado|contra_entrega|cuenta_corriente|escalonado),
    `dias_pago, dias_pago_hasta, medios_pago text[], medio_pago_preferido` (transferencia|echeq|cheque|tarjeta|efectivo), `plazo_cheque_dias,
    descuento_pronto_pago`; ordenes_compra: `condicion_pago, dias_pago, dias_pago_hasta, medio_pago_preferido, plazo_cheque_dias, descuento_pronto_pago`;
    facturas_compra: `condicion_pago, dias_pago, dias_pago_hasta` (fecha_vencimiento ya existía); tabla `cheque_fechas_mes` (sociedad, mes día 1,
    dias int[]; lectura lz_es_de_sociedad, escritura lz_puede_operar_finanzas) con oct 12·21·31, nov 11·21·30, dic 11·20·30 en las 2 sociedades.
    Datos: Prisina y TKW escalonado 30-75 eCheq; Segutécnica CC 60; Star-Tex 5 %; DPS anticipado 5 %; medios pasados desde forma_pago vieja.
    **PUBLICADO V1.1.424 (commit d26c557), probado en local sin guardar y versión verificada en producción:**
    `lib/condicion-pago.ts` (+ `scripts/test-condicion-pago.ts`): texto, vencimiento desde fecha de factura, fechas de cheque permitidas
    (31 → último día del mes), cheques propuestos (CC: última fecha fija ≤ vencimiento; escalonado: una en cada fecha fija del rango, monto
    repartido; anticipado: fecha + plazo cheque), `legacyDesdePlan` mantiene forma_pago/dias_cuenta_corriente viejos al guardar.
    `components/condicion-pago-editor.tsx`; `components/proveedor-form-modal.tsx` (formulario ÚNICO: Proveedores, cargar factura y carga masiva;
    nombre de administración, "Vendedores", "Cómo se le paga" + límite de crédito); ficha muestra "Cómo se le paga" y "Vendedores".
    `components/pago-proveedor-oc.tsx` en el detalle de la OC (si el proveedor no tenía, se le guarda). Cargar factura: bloque "Pago que pide
    el proveedor", vencimiento automático (botón "Usar el calculado" si se escribió a mano), se guarda en la factura y en el proveedor si faltaba.
    Configuración → **Fechas de cheque** (`components/fechas-cheque-config.tsx`, 6 meses, avisa feriado/fin de semana y cuándo se debita).
    Plan de pagos y OP: muestran cómo se le paga y "Cheques sugeridos" (solo si el medio preferido es eCheq/cheque).
    ⚠️ Para Augusto: 12/10 es feriado, 31/10 sábado, 21/11 sábado (se debita 24/11), 20/12 domingo: revisar fechas en Configuración.
  1) Compras: filtro **"Abiertas"** por defecto (todas menos completas y canceladas; hoy 77 de 125). "Todas" y "Completas" siguen.
  2) Columnas Pago, Pedido y Factura con íconos (✓ verde, ½ azul, ✗ naranja/gris, tarjeta); el texto sale al pasar el mouse.
  3) Recibido (antes "Mercadería") solo con el punto de color (y "3/10" si es parcial); sin mail debajo del proveedor; "Copiar" solo ícono;
     títulos cortos (OC, PR); tarjeta "Recibidas completas" → **"A reclamar"** (clic filtra). A 1920 px la tabla entra entera.
  4) Cartel "OC con diferencia": sumaba la factura ENTERA aunque estuviera repartida entre varias OC (OC-1199 decía 141,8 % de más).
     **Migración `20261012190000_oc_diferencia_compartida.sql` (+ vuelta atrás; solo reemplaza `diagnostico_diferencia_oc`, no toca datos):**
     de una factura compartida cuenta lo asignado a la OC (renglones conciliados × precio de factura, con su IVA); sin renglones, reparte por total de OC.
     Probada sin guardar (`--probar scripts/db/pruebas/oc_diferencia_compartida.sql`): OC-1199 $2.340.164 de $2.412.764 (faltan 2 u, $72.600);
     las otras 10 OC con factura compartida dan $0. **CORRIDA por Claude (12/10/2026, `migrar.cjs` sin `cd` adelante, verificado).**
  **Personalización desde el PR (bordado / estampa / reflectivo) — PLAN, se hace DESPUÉS de arreglar lo roto (decisión de Augusto 12/10):**
  hoy el bordado es un renglón suelto ("BORDADOS", 37 renglones) que termina en OC a "Stock propio" (ej. OC-1197); el módulo Personalización está vacío.
  Plan: botón "+ Personalizar" en cada prenda del PR (técnica; ubicación y logo OPCIONALES — casi nunca los tiene al cotizar; cantidad de la prenda;
  quién lo hace: taller, o para reflectivo "el mismo proveedor de la prenda" = renglón extra en su OC con costo); al aprobar se arma el trabajo
  para el taller y se manda por **WhatsApp**; sugerencia (no bloqueo) si un renglón dice bordado/estampa/reflectivo. Lleva migración chica.
  Talleres a cargar: **Nora** (bordado), **Eve** y **Cordobés** (estampado); CUIT y documento los completa Augusto más adelante.
  **Permisos (12/10/2026, OK de Augusto):** Claude publica (git add/commit/push, vercel.cmd --prod) y prueba haciendo clic en el CRM.
  Nunca envía mensajes (WhatsApp/mail) ni toca nada de ARCA. Comandos sin `cd ... &&` adelante (si no, no coinciden con las reglas).
  tsc 0 errores, hooks OK, probado en local sin guardar. Visto de paso: la campana da error 400 en la consulta de `alertas` (dos `or=`), ya estaba antes.
  Ojo (menor, no se tocó): editar el monto de un medio que dejó saldo a favor (`gestionar_cobro` 'editar') no ajusta ese saldo a favor.
  Ya estaba bien: las funciones directas ya no se podían llamar desde la app (lo cerró 20260925220000); igual se vuelve a cerrar.
  Pendiente (punto 6, más adelante): las reglas de lectura de la base dejan leer a cualquier usuario logueado; con el registro cerrado,
  los bloqueos y el middleware no hay forma de que entre alguien no invitado.
  Pendiente aparte: `profiles_select_all` deja a cualquier logueado ver la lista de usuarios (menor).
- **Rescate del FCI (12/10/2026):** Augusto pidió rescatar solo lo inmediato y después aclaró que **el sistema tenía razón**: se mantiene rescatar
  **un día hábil antes** del débito (con feriado, el 13/10 se rescata el 09/10). No cambiar esta regla.
- **Control de cheques emitidos (12/10/2026):** los 126 "a pagar" del CRM ($115.297.683,61) cruzados con la lista de eCheqs "Aceptado" del home banking (100 renglones, corta ahí)
  y los Excel del 11/10: ningún monto distinto, ningún cheque de más en el banco, ninguno "pagado" en el banco que el CRM tenga a pagar. 18 ($20.783.695,95) no estaban en esos
  archivos, pero 16 se cargaron del propio listado del banco (en "Custodia" o fuera de los 100). Augusto rescató $49.200.000 del FCI a la CC el 12/10 (ref. 50001364014261012)
  para los débitos del 13/10. **Corregido con OK (SQL corrido por Augusto):** 8 cheques de "Físico" a "eCheq" (90017369/70/71/72/64/73/65 y 90000172), script en
  `supabase/diagnostico/corregir_tipo_echeqs_12_10_2026.sql`. 90017362 (Sinpostre $270.075,03) y 90017368 (Conte Hnos $34.140,75) también corregidos a eCheq (confirmado por Augusto; script `..._b.sql`, 2 filas OK). Ningún emitido queda mal como Físico.
  **Control completo con `12-10-2026-eCheqs-emitidos.xls` (400 eCheqs emitidos desde 18/05, todos los estados):** los 126 "a pagar" del CRM coinciden 126/126
  con los pendientes del banco (99 ACTIVO + 18 CUSTODIA + 9 ACTIVO_PENDIENTE) en número, monto y fecha de pago. Ninguno pagado en el banco que el CRM tenga a pagar,
  ninguno pendiente en el banco que falte en el CRM. Cheques emitidos: OK.
- **Arreglado (V1.1.418):** el cobro masivo desde Facturación listaba notas de crédito como si fueran facturas a cobrar (Finanzas ya las filtraba).
- Chequeos: tsc 0 errores, check-hooks OK, tests revisar-finanzas, cobro-reparto y finanzas-grupos OK. Versión 1.1.418.

00. **Correcciones de la conciliación BBVA (V1.1.416)** — **PUBLICADO como V1.1.417 (12/10/2026, commit f5b725c, sin migración)**; todo lo que abajo dice "sin publicar" ya está en producción. Revisión completa 12/10/2026:
   1. **"Saldo pendiente $0" (HECHO):** no era un error de datos: el cartel mostraba lo que queda DESPUÉS del cobro y el CRM precarga el total.
      Ahora dice "Saldo de la factura: X — Queda después de este cobro: Y". Además, cobrar de más ya no frena: avisa y pregunta (regla 1).
   2. **Tipo de cambio en cobros USD + BNA diaria:** HECHO en código (12/10/2026, V1.1.417 sin publicar, sin migración).
      `lib/tc-cobro-usd.ts` (prueba `scripts/test-tc-cobro-usd.mjs`) + `components/fx-settlement-dialog.tsx`:
      divisa/billete sale de la factura o de la ficha del cliente ("USD" = billete, "USD Divisa" = divisa); BNA de referencia del **día hábil anterior**
      (`diaHabilAnterior`, saltea feriados) traído solo; la factura se cancela con el TC del cliente (pesos + retenciones ÷ USD) mientras no elija otro;
      si el cliente pagó **más de 2 % abajo** del BNA → recuadro amarillo con lo que falta y "Copiar mensaje para el cliente" (nunca frena);
      si pagó arriba → verde. Probado en local sin guardar (FA 15-52 Soenergy: billete, BNA 09/10 $1.535, −2,9 % aviso / +1,3 % verde).
      **D1 revisado:** el cron guarda divisa y billete todos los días hábiles. ⚠️ Las filas viejas (fuente `BNA_cron`, hasta 09/10) están corridas un día
      (guardaban el valor del día anterior con la fecha de hoy). El CRM no las usa (solo confía en `BNA histórico v2` o cargadas a mano) y el cron nuevo ya graba bien.
      **Corregido con OK de Augusto (12/10/2026):** las 76 filas de días hábiles (19/08 a 09/10) quedaron con el histórico del BNA y fuente `BNA histórico v2`
      (39 cambiaron de valor, 37 ya coincidían). Las 3 filas de fin de semana (05/09 y 06/09, fuente `BNA`) quedaron igual: el BNA no cotiza esos días y el CRM no las usa.
      Valores anteriores en `Claude outputs/antes_cotizaciones_dolar_12_10_2026.json`.
   3. **Cuentas (HECHO en código):**
      - Efectivo = lo que dice Augusto (las extracciones no suman a la caja; "Según tu caja al ..."). FCI = saldo del banco, sin interés estimado.
      - `lib/fci-custodia.ts` (+ `scripts/test-fci-custodia.mjs`): lee el Excel de la custodia (BBVA_Comprobante_*.xls) y calcula lo que generó el FCI
        por mes con valuaciones reales. Sept (27/08→30/09) **$1.646.385,79**; oct (30/09→11/10, con el total del home banking) **$453.278,60**.
        Falta mostrarlo en el CRM (subir el Excel en la tarjeta del FCI; para guardarlo haría falta una tabla nueva → plan y OK).
      - Débitos por semana + aviso rojo de rescate 1 día hábil antes (`lib/dias-habiles.ts`, feriados 2026; ⚠️ cargar móviles 2027).
        Un cheque de sábado/feriado no figura "atrasado" (se debita el hábil siguiente).
      - **Error arreglado (V1.1.416):** una OP pagada con eCheq restaba su total de la CC el día de la OP (el trigger le pone la CC a todo "pago")
        y otra vez al debitarse el cheque. Ahora solo resta la parte en transferencias (`montoCuentaDeOp` con `ordenes_pago.medios_pago`).
        El aviso "sin cuenta" solo cuenta lo que mueve banco o caja (bajó de 78 a 15). Mejora futura: que el trigger use los medios de la OP.
      - Extracto: los pagos de OP mixtos (cheques + transferencia) cruzan por la parte en transferencia (4 líneas más cruzan solas).
   4. **Revisión de datos (solo lectura) 12/10:**
      - Cheques emitidos: los 126 "a pagar" coinciden con el banco (ACTIVO / CUSTODIA / ACTIVO_PENDIENTE) o con la planilla (12 viejos que el listado
        del banco no trae). Ninguno a cambiar. 90017077 y 90017203 (20/09) siguen activos en el banco.
      - **Aplicado en la base con OK de Augusto (12/10/2026):** Efectivo $2.561.020 al 09/10 (saldo_banco); FCI $71.480.800,70 al 11/10;
        cheque 30012626 (Fedea $2.145.833,33) "endosado" a STAR-TEX SA el 15/09 (OP-000011, con observación); cheques 90017359/60/66 a "eCheq";
        pagos OP-000038 (Inmuovi) y OP-000052 (Da Silva) a la cuenta Visa. Valores anteriores: `Claude outputs/antes_correcciones_finanzas_12_10_2026.json`.
      - **Explicado por Augusto:** OP-000043 Electronic: pagó $620.329,99 y después le avisaron que están exentos → les transfirió los $5.870,42
        retenidos el 08/10. OP-000004 Mastroianni: le anularon los eCheqs por las fechas y pagó por transferencia el 02/10 ($325.500,12).
        **Hecho con OK (12/10/2026):** retención de Electronic anulada (ya no sale en SICORE); pago nuevo de $5.870,42 del 08/10 (CC, factura 0004-00011819,
        sigue "pagada") conciliado con la línea del banco; línea del 02/10 conciliada con el pago de la OP-000004. Antes: `Claude outputs/antes_electronic_mastroianni_12_10_2026.json`.
   **SIGUIENTE:** Augusto pidió ideas para Finanzas y para ordenar Ventas (sin tareas repetidas): revisar las pantallas de Ventas/Presupuestos/Oportunidades/Facturación y proponer. Después, Augusto revisa el CSV de líneas pendientes.
      **Hecho 12/10/2026 (solo ideas, sin código):** propuesta pasada en el chat: Finanzas de 16 pestañas a 5 grupos (Hoy / Cobrar / Pagar / Cheques / Deudas),
      una sola pantalla por acción (hoy "Emitir factura" está en Ventas y en Facturación; Facturación entera está repetida en Finanzas > Fact. Ventas;
      "Cobro masivo" en Facturación y Finanzas), botón "Próximo paso" en cada operación, Presupuestos hasta Aprobado y después Ventas,
      bandeja de pendientes, proyección de caja 30/60/90 días, tarjeta ARCA a Configuración. Esperando OK y respuestas de Augusto.
      **Etapa A HECHA en código (12/10/2026, OK de Augusto; va en la V1.1.417 sin publicar, sin migración):**
      - Finanzas en 5 grupos (`lib/finanzas-grupos.ts`, prueba `scripts/test-finanzas-grupos.mjs`): **Hoy** (Cuentas, Movimientos, Extractos, Objetivos
        + botones Caja/Balance, que ahora solo salen acá) · **Cobrar** (Facturas de venta, CC Clientes, Recibos, Vencimientos) · **Pagar** (Facturas de compra,
        Órdenes de pago, CC Proveedores, Gastos, **Gastos fijos** —ya no está oculta; total en $ y US$—, Retenciones, Vencimientos) · **Cheques** (Cheques,
        Cheques Martín F.) · **Deudas** (Créditos). Vencimientos abre filtrado "a cobrar" desde Cobrar y "a pagar" desde Pagar.
        Recuerda el último grupo/pestaña en la compu (localStorage `finanzas.ultimaPestana`); los links (`?tab=`, `?factura=`) mandan sobre lo guardado.
      - `/facturacion` ya no es una pantalla aparte: lleva a Finanzas > Cobrar > Facturas de venta (quien no tiene Finanzas, p. ej. "viewer", la sigue viendo ahí).
        El buscador de arriba y Remitos abren la factura puntual (`?factura=ID`).
      - Tarjeta ARCA → Configuración > Integraciones (`components/arca-status-card.tsx`, solo consulta el estado). En Facturación queda un aviso amarillo solo si falta el certificado.
        En local siempre dice "Certificado no configurado" (normal: las variables ARCA están solo en Vercel).
      - Arreglado: links que llegan a Finanzas sin recargar (Ventas "ver factura", Proveedores "Ver cuenta corriente") abrían Cuentas; ahora abren la pestaña pedida
        y la CC del proveedor.
      - Cobro masivo: se deja en los dos lugares (Facturación y CC Clientes) porque los dos guardan con el mismo componente (`CobroMasivoLiquidacion`);
        solo cambia la ventana para elegir facturas. No es lógica repetida.
      - Probado en local sin guardar: 5 grupos, Vencimientos, recordar pestaña, `/facturacion`, link de Proveedores, Configuración. tsc 0 errores, check-hooks OK.
      - Ruido viejo en consola (no es de este cambio): dos columnas con key "cuit" en las tablas de CC Clientes/Proveedores.
      **Pantallas más compactas (12/10/2026, OK de Augusto; V1.1.417 sin publicar):** Card p-4, StatCard más baja (text-xl), Header más bajo,
      páginas `p-3 sm:p-5 space-y-4` (12 archivos), Facturación dentro de Finanzas sin doble margen. `DataTable`: filas más finas (py-2) y botones
      "Filas: 25 · 50 · 100 · Todas" (por defecto 50, se recuerda en la compu con `tabla.filas`; las tablas con `pageSize` fijo —Dashboard, Transportes— no cambian).
      Listas desplegables de clientes (`select size`) cambiadas por el buscador `Autocompletar`: Registrar cheque (Finanzas) y Facturación masiva sin OC.
      **Cheques de Del Sol (12/10/2026, pedido de Augusto):**
      - **Cargado:** eCheq 3644 $11.801.686,09 (pago 30/10) como cheque recibido de DEL SOL en cartera (sin cobro: paga FC-A 0009-405 $7.394.812,15 y
        0009-406 $4.600.666,31 del sistema anterior, total $11.995.478,46). Diferencia **$193.792,37** = retenciones a confirmar (anotado en el cheque).
        Recibidos en cartera: 3 — $25.590.065,66.
      - **Falta (REVISAR el martes 13/10):** eCheq $6.210.728,30 (pago 11/12) contra FA 16-17, 16-18, 16-16, 15-45 y 15-54 (total $6.463.222,05; diferencia
        **$252.493,75**, ¿retenciones?). No se cargó porque el cobro masivo exige "diferencia $0" (⚠️ va contra la regla 1: debería avisar y dejar seguir).
        Con los certificados de retención cuadra exacto y se carga normal. Fecha de recepción de ambos: 09/10 a confirmar (Del Sol paga a 45–60 días, los viernes).
        Recordatorio programado para el martes 13/10 9 h (tarea `recordatorio-retenciones-del-sol`).
      - Ojo: FA 16-18 ($1.370.733,34, 25/09) tiene el mismo importe que la FC-A 9-399 del sistema anterior (20/08): confirmar que no sea la misma venta facturada dos veces.
      - **Bichara (HECHO 12/10, decisión de Augusto: sin factura):** cheques físicos recibidos de MARCOS MARTIN BICHARA en cartera: 00406334 $266.000 (pago 20/10,
        firmante Borgogno Guillermo Dario) y 85983561 $290.000 (pago 23/10, firmante Alvarez Juan Carlos); datos de `ideas/cheques_desde_2026.csv`.
        Pagan una factura del sistema anterior. Fecha de recepción: REVISAR. Recibidos en cartera: 5 — $26.146.065,66.
      - **REVISAR (Augusto lo deja para después):** fecha de recepción de todos estos cheques y de los cobros con fecha futura (Barraza $10.110.492,35 y
        Del Sol $3.677.887,22). Van a la pestaña "Revisar" cuando exista.
      - **Líneas pendientes del extracto (125):** siguen en Finanzas > Hoy > Extractos (filtro "pendiente") y en el CSV; cuando exista "Revisar", se ven ahí también.
      - Pendiente de código: que el cobro masivo deje confirmar con diferencia (avisa y pregunta; lo que falta queda como saldo de la última factura).
        La función de la base `registrar_cobro_masivo` no está en el repo: antes de tocarla, leer su definición en Supabase (`select pg_get_functiondef('public.registrar_cobro_masivo'::regproc)`).
      **Datos de Augusto para cargar (12/10/2026), faltan detalles:**
      - **Crédito BNA 1 (lo paga Luis María Lazzari, papá; al día, pagó todas las vencidas):** cuenta BNA CA $ 27003971709297, titular LAZZARI AUGUSTO,
        CUIT 20-37930912-8, alias lazzariaugusto.bna. 12 cuotas de capital $300.000 ($3.600.000), sistema alemán, débito ~el 10.
        Cuota total (cuota + cargos): 1) 13/07/26 $432.874,52 · 2) 10/08 $385.261,15 · 3) 10/09 $385.814,80 · 4) 09/10 $382.216,11 ·
        5) 10/11 $362.008,11 · 6) 10/12 $358.132,60 · 7) 08/01/27 $353.149,80 · 8) 10/02 $341.523,29 · 9) 10/03 $331.004,05 · 10) 08/04 $327.405,36 ·
        11) 10/05 $315.502,04 · 12) 10/06 $308.581,48. Quedan 5 a 12: $2.697.306,73 (capital $2.400.000).
      - **Crédito BNA 2 (lo paga Andrés Leguizamo):** ⏰ **Recordarle a Augusto** que pase los detalles.
      - **Préstamo Cecilia Alvarez (tía), plata de la empresa:** US$ 25.000; US$ 10.000 están en **BAVSA** (ALyC/banco: descuenta cheques y presta;
        cargarla como cuenta en US$ y $, el $ se actualiza el martes 13/10). Sin fechas de devolución.
      - **Préstamo José Alvarez (abuelo):** US$ 18.500. US$ 8.500 se los paga Andrés Leguizamo **a Augusto** y Augusto se los da al abuelo
        (no tiene que ver con el crédito BNA). Sin fechas. Idea: "apartado" mensual sugerido para devolver a Cecilia y José sin afectar el negocio.
      - **Gastos fijos (Lazzari):** sueldos $1.500.000/mes c/u (Mariana Santinelli, Jerónimo Casadidio, Sebastián Pereyra), se pagan del 1 al 10;
        alquiler US$ 800/mes del 1 al 15, en dólares (retira efectivo → compra US$ en financiera → inmobiliaria).
        **TC del alquiler = dólar blue** (no BNA): el CRM pregunta el valor a Augusto (lo carga él), nunca toma el del banco.
      - **Cómo pagan los terceros:** papá (BNA 1) paga cuando quiere, sin cuenta fija → el cobro lo carga Augusto cuando avisa (la cuota igual figura en la proyección).
        Andrés todavía no pagó nada de los US$ 8.500 → se carga cuando Augusto avise.
      - **Estado "Facturar" de Presupuestos (dato de Augusto 12/10):** algunas empresas aprueban pero no se factura hasta que mandan su OC.
        Propuesta (esperando OK, va en la Etapa D): Presupuestos termina en Aprobado; en Ventas, si falta la OC, la operación queda "Esperando OC del cliente"
        (aviso a los X días, botón "Cargar OC" con número/fecha/PDF en los campos `oc_cliente`/`oc_cliente_fecha` que ya existen) y al cargarla pasa sola a "Lista para facturar".
        Marca opcional en la ficha del cliente "Pide OC para facturar". Facturar sin OC se puede igual: avisa y pregunta (regla 1). Reemplaza `listo_para_facturar`.
      - **Falta de Augusto:** colchón mínimo para el "apartado" (Cecilia/José) y la tabla del crédito BNA 2.
        **Pendientes de Augusto:** honorarios del contador (monto) y otros gastos fijos que va completando esta semana.
        La pestaña "G. Fijos" de Finanzas existe pero está oculta ("en revisión"); la tabla `gastos_fijos` ya tiene moneda.
      - **Regla de Augusto:** todo lo que se compra con tarjeta en Mercado Libre se paga con la Visa (la Visa es la tarjeta sugerida para lo nuevo).
      - **Faltan en el CRM (los tiene que cargar Augusto con las OP de Del Sol, etc.):** cobro con cheque Del Sol 3414 ($12.532.078,86, depositado 01/10);
        cheques en mano Del Sol 3644 ($11.801.686,09, 30/10) y 3968 ($6.210.728,30, 11/12); Bichara 00406334 ($266.000) y 85983561 ($290.000);
        recibidos y endosados: Del Sol 3587 y Punto Espacios 211 (a Bruno Francione, OP-000009), Pachamama 9919 (Prisina), Musso 2105 (BA Valores).
      - **Dudas para Augusto:** OP-000004 Mastroianni y OP-000043 Electronic están ANULADAS pero su pago sigue activo y la plata salió
        (02/10 $325.500,12 y $620.329,99); la retención de Electronic ($5.870,42) sigue activa y el 08/10 salió una transferencia por ese importe.
        OP-000038 y OP-000052 pagadas con tarjeta: ¿cuál? 21 cobros del banco son de facturas del sistema anterior (no están en el CRM): ¿cómo registrarlos?
      - Las 125 líneas pendientes del extracto, con lo que se sabe de cada una: `Claude outputs/extracto_pendiente_revision_12_10_2026.csv`.
   **Análisis de la pantalla Ventas (12/10/2026, solo ideas, esperando OK de Augusto):** `src/app/(crm)/ventas/page.tsx` (2.091 líneas, el modal de
      emitir factura ocupa ~500 y está repetido con Facturación). Problemas: 7 PR "aprobado" sin remito NO aparecen (filtro línea 379: Corteva x3, Adecco,
      Synthon con OC, Coronel Bogado, Limagrain); PR-"facturar" ya facturados (2) quedan con estado viejo; "Cobrado" solo si la factura está "pagada"
      (cobros parciales no se ven); KPIs solo cuentan (sin $ ni US$); lista de tarjetas grandes sin filtro de fechas (82 facturadas crecen sin fin);
      detalle con 4 secciones cerradas (un clic más cada una); links "Ir a"/"Registrar cobro" van a pantallas genéricas sin filtrar; vendedores sin filtrar por sociedad.
      Propuesta numerada pasada en el chat (bandeja por "qué falta", tabla compacta, montos, detalle abierto, links directos, sacar modal duplicado).
   **Ventas nueva (13/10/2026, OK de Augusto "avanzamos con todo", sin duplicados). V1.1.426 PUBLICADA 13/10 (commit 9636f47).** Probado en producción sin emitir:
      la ventana de facturar desde Ventas sale "Emitir factura ARCA", FA 0015, total igual al PR, consulta FCE y fechas OK.
      - **Una sola ventana de emitir factura** `components/facturacion/emitir-factura-modal.tsx` para Facturación (libre) y Ventas (desde PR).
        Se borró la copia de Ventas (~500 líneas) y la de Facturación. Con PR: cliente fijo, renglones y OC del PR, conversión de moneda PR→factura,
        condición de venta según el cliente (`lib/factura-condicion.ts`, prueba `scripts/test-factura-condicion.ts`), observaciones, PDF al terminar,
        y el PR pasa a "facturado". La manual va por `/api/facturacion` (antes Ventas insertaba directo en la base). ARCA status: `lib/use-arca-status.ts`.
        PDF de factura: `lib/factura-pdf.ts`.
      - **API manual X:** el comprobante X se guarda sin IVA (iva 0, renglones 0 %), como estaban todos los X. Solo rama manual; ARCA no se tocó.
      - **Arreglado:** factura X de un PR manual de cliente RI le sacaba el IVA al precio. Caso real: X 0000-00000007 de COOPERATIVA LA NUEVA LEYENDA
        (PR-2026-1189): PR $251.640, factura $207.966,96 (faltan $43.673,04). **CORREGIDA 13/10 con OK de Augusto** a $251.640 (6 x $41.940;
        migración `20261013122000_factura_x7_nueva_leyenda.sql` con vuelta atrás; antes: `Claude outputs/antes_factura_x7_nueva_leyenda_13_10_2026.txt`).
        Sin cobros, vence 28/10. **Falta (Augusto):** avisar al cliente y reenviarle el PDF corregido desde Facturación (al cliente le llegó el 28/09 con el monto viejo).
      - **Ventas** (`ventas/page.tsx`): bandejas Esperando OC / Para facturar / Para entregar / Para cobrar / Terminadas / Todas con cantidad, $ y US$
        (`lib/ventas-etapas.ts`, prueba `scripts/test-ventas-etapas.ts`); tabla compacta con saldo, días y botón "Próximo paso"; detalle con todo abierto;
        filtro de fechas; busca también por OC y factura; vendedores sacados de las propias ventas. Ahora aparecen los aprobados sin remito (antes 7 ocultos).
        Saldo real por factura (cobros parciales y NC) con `lib/saldo-clientes`. Una NC ya no cuenta como "factura vigente" (PR-2026-1062 sale "Re-facturar").
        "Cobrar" y "Emitir NC" abren Finanzas en esa factura con la ventana ya abierta (`&accion=cobro|nc` en `facturacion-content.tsx`).
        Arreglado: las OC de cada venta no se veían nunca (pedía la columna `pago`, que no existe; ahora `medio_pago`/`estado_pago`).
      - **Esperando OC:** casilla "Pide OC para facturar" en la ficha del cliente (migración `20261013120000_clientes_pide_oc.sql`, CORRIDA).
        Facturar sin OC: pregunta y deja seguir. Presupuestos: "Marcar listo para facturar" reemplazado por "Ver en Ventas" (la OC se carga en el PR).
      - **Dato corregido:** PR-2026-1148 de "facturar" a "facturado" (migración `20261013121000_pr1148_facturado.sql`, CORRIDA, con vuelta atrás).
      - Pruebas que leían el código viejo apuntan a la ventana única. tsc 0 errores, check-hooks OK. Probado en local sin guardar: bandejas, detalle,
        ventana de facturar (en local siempre sale "manual": ARCA solo en Vercel), "Cobrar" abre el cobro de esa factura, celular sin scroll horizontal.
        Fallaban ANTES de este cambio (no son de esto): `test-presupuesto-exact-price.mjs` y `test-checklist-email-credit.mjs`.
      - **⚠️ Al publicar:** la primera factura ARCA desde Ventas y desde Facturación la emite Augusto (Claude no toca ARCA) y avisa; revisar PDF y total.
   **V1.1.427 (13/10/2026, pedido de Augusto, sin migración) — ventana de emitir factura:**
      - **Tipo de dólar según la ficha del cliente** (`lib/factura-moneda.ts`, prueba `scripts/test-factura-moneda.ts`): Moneda = "$ Pesos / USD divisa / USD billete".
        Pesos siempre; el dólar que no es el de la ficha queda trabado y lo destraba solo administración (super_admin, admin, administrativo = Augusto y Mariana; ojo: Manu sigue como admin).
        El servidor (`api/facturacion`) también toma la ficha y rechaza el otro tipo si no es administración. Facturación masiva también usa la ficha.
        Clientes con "USD Divisa": Corteva Seeds, Corteva Agriscience, Synthon, Cargill (Lazzari) y Aerolíneas (Grupo LA). **Aerolíneas en Lazzari figura "ARS"**: confirmar con Augusto.
        Con "USD" (billete): Alca Agrotech, Soenergy, Termo Córdoba. Caso real: PR-2026-1204 Corteva estaba en billetes ($1.535) y divisa del 09/10 era $1.517.
      - **Cotización automática** del tipo elegido: último día hábil BNA anterior a la fecha de factura (saltea feriados), se rehace al cambiar la fecha; en manual también se trae sola.
        Leyenda en las observaciones de la factura: "Cotización BNA dólar divisa venta del dd/mm/aaaa: $ x" (también en facturación masiva).
        Arreglo en `lib/invoice-exchange-rate.ts`: el respaldo de la base salteaba la de 09/10 porque agarraba la fila no confiable del feriado 12/10 (`dolarapi_cron`); ahora busca la última confiable.
        ⚠️ El cron guardó el 12/10 (feriado) con dolarapi 1535 para divisa y billete: dato malo (no se usa para facturar). Revisar el cron (D1).
      - **No facturar antes de la OC del cliente** (`oc_cliente_fecha` del PR); "Destrabar" para administración. **Sugerencia:** "Podés facturar con fecha dd/mm (N días antes) [Usar]" = la más vieja que permiten ARCA y la OC.
        Ojo: en la captura de Augusto la OC-2026-1222 (09/10) es **OC a proveedor**, no del cliente; la regla usa la OC del cliente. Confirmar con él.
      - **Ventana compacta:** ARCA/Manual en el título, una fila Tipo/Cliente/PV/N°, OC en una línea, Moneda/Cotización/Fecha/Condición/Vencimiento en una fila, ítems finos,
        totales y botones fijos abajo. Probado en local sin guardar (PR-2026-1204): entra sin scroll en 1366x768, celular sin scroll horizontal.
      - Pruebas de texto actualizadas: fiscal-date-calendar, invoice-exchange-rate, invoice-oc-preview, fce-route. tsc 0, hooks OK. **PUBLICADA 13/10 (commit ced3c48)**; probada en producción sin emitir (PR-2026-1204: ARCA, USD divisa $1.517 del 09/10, sugerencia 09/10).
   **V1.1.428 (13/10/2026, pedido de Augusto, sin migración de estructura):**
      - Confusión aclarada: el chip rojo de la lista es la **OC del cliente** (`presupuestos.oc_cliente`); lo que se veía en la ventana de facturar era la **OC a proveedor** (`ordenes_compra.presupuesto_origen_id`). Claude no creó ni tocó OC.
        PR-2026-1146 Corteva: sin OC del cliente; la OC-2026-1178 es la compra a AYRE LIBRE (30/09).
      - Ventana de facturar: **se sacó la OC a proveedor**; siempre muestra "OC cliente: … / no cargada".
      - Ventas, panel de la derecha **compacto** (340 px, renglones finos, una línea por remito/compra, botones chicos): "OC del cliente", "Entrega", "Compras a proveedor", "Factura y cobro".
        Con el panel abierto, la tabla oculta Saldo y Días en pantallas < 1536 px (están en el panel) y el nombre del cliente va en una línea.
      - **CORRIDA 13/10/2026 con OK de Augusto (verificados los 7 en true):** `supabase/migrations/20261013130000_clientes_pide_oc_marcar.sql` (+ vuelta atrás) marca "Pide OC para facturar"
        en Synthon, Corteva Agriscience, Corteva Seeds, Adecco RRHH, Adecco Specialties, Termo Córdoba y Soenergy (hoy los 7 en false, por eso nadie aparece en "Esperando OC"). OK de Augusto dado.
        Se corre con `node scripts/db/migrar.cjs supabase/migrations/20261013130000_clientes_pide_oc_marcar.sql` (desde crm/app) cuando Augusto diga "corré la migración de pide OC".
   **LISTA NUEVA DE AUGUSTO (13/10/2026) — NO HACER NADA sin su OK; él elige el orden:**
      Ventas y presupuestos: a) sacar "Fichas de relevamiento" de Ventas; b) Personalización (bordado/estampado) dentro del presupuesto (hoy no existe ahí:
        renglón con logo, taller, costo y cantidad que sume al precio y al margen); c) PR express con "margen objetivo %" o "total aproximado" (aviso si algún renglón < 15 %).
      Oportunidades y clientes: d) estudiar mejor las oportunidades; e) preguntas por cliente para conocerlo (rubro, empleados, temporadas, quién decide, qué usa hoy)
        y con eso propuestas de venta; f) armar propuestas entre todos dentro del CRM (borrador, comentarios, versión final).
      Finanzas y riesgo: g) riesgo BCRA pasa a Finanzas; h) mismo chequeo BCRA para proveedores; i) alerta de CUIT apócrifo en facturas de proveedores:
        fuentes a confirmar: ARCA base APOC (facturas apócrifas), ARCA padrón/constancia (CUIT activo, condición IVA), ARCA constatación de comprobantes (CAE real), BCRA. Solo avisos.
      Listas de precios: j) llevar al CRM la página "Costos Lazzari" (https://claude.ai/artifact/6gMWMKDhDnYPHyVA3qiBQG: Buscar con fotos/costo/venta sugerida/$-USD-divisa,
        Comparar proveedores, Reglas por proveedor, Chat, Subir listas con aprobación), tomando siempre el último catalogo_crm.csv (regla 7). Grande: por etapas.
      IA: preguntó si la IA cobra (sí: la del CRM por uso con la clave de Anthropic en Vercel, centavos por documento; este chat va por su plan).
        Propuestas de más IA: cobros sugeridos desde el extracto, leer OC de clientes que llegan por mail, tanda de facturas de compra conciliadas solas,
        avisos con mensaje listo, chat del CRM; contador de uso de IA del mes en Configuración.
      Regla de Augusto: siempre optimizar espacios, optimizar procesos y ofrecer mejoras.
      **Respuestas de Augusto (13/10/2026), todavía sin hacer nada:** OK a, g, h, i, IA-1 (cobros desde extracto), IA-3 (facturas de compra conciliadas), IA-6 (contador).
        Desarrollar: b, d, e, f, j. c: escribir "margen 25 %" y que cotice todo con ese margen. IA-2 (OC por mail) por ahora no.
        IA-4: le expliqué (aviso + mensaje listo para copiar, nunca se manda solo). IA-5: el botón de chat IA actual responde mal; falta definir si es chat IA o interno.
        j: Augusto propone que el CRM absorba el Excel de reglas y las listas de proveedores y se actualicen en el CRM (deja de usarse catalogo_crm.csv,
        cambia la regla 7: falta su OK final y la ruta del Excel); después conectar la web al CRM para precios.
        **Segunda tanda de respuestas (13/10):** c = margen sobre el COSTO (costo 100 + 25 % = 125). j = OK para cambiar la regla 7 (por etapas: el CSV
        manda hasta que el CRM esté probado; recién ahí se cambia CLAUDE.md). IA-5 = chat con IA (que conteste con datos reales del CRM, solo lectura).
        Orden propuesto: tanda 1 = a + g + h + IA-6; tanda 2 = c; después IA-1, IA-3, i, IA-5 y lo de desarrollar (b, d, e, f, j).
      **Tanda 1 (13/10), avance, SIN PUBLICAR y sin subir versión todavía:**
        - a) HECHO: Ventas ya no muestra "Fichas de relevamiento" (solo se ocultó; el componente y la tabla `fichas_relevamiento` siguen; la pestaña Relevamiento de la ficha del cliente sigue).
        - g) HECHO: el riesgo BCRA ahora está en Finanzas > Hoy > "Riesgo BCRA" (`components/finanzas/riesgo-bcra.tsx`). Oportunidades conserva el aviso por cliente y un link a Finanzas.
        - Pedido de Augusto: en Finanzas > Hoy hay una solapa **Informes** con 3 informes: BCRA clientes, BCRA proveedores y Facturas apócrifas (esta última solo placeholder; falta confirmar fuentes ARCA, punto i).
        - h) HECHO (código): BCRA de proveedores (`proveedor_bcra_informes`), `/api/bcra` acepta `proveedor_id`, el cron mensual también recorre proveedores, alerta en la campanita si empeora. Solo aviso.
          Pendiente chico: aviso BCRA en la ficha del proveedor y en la OC (hoy solo está en Finanzas > Informes).
        - IA-6) HECHO (código): `lib/ia-uso.ts` anota cada llamada a la IA (10 funciones en `api/*`); Configuración > "Uso de IA" (solo admin) muestra llamadas, tokens y costo estimado por mes.
        - **MIGRACIÓN SIN CORRER:** `supabase/migrations/20261013150000_bcra_proveedores_y_uso_ia.sql` (+ vuelta atrás en `supabase/rollback/`). Crea `proveedor_bcra_informes` e `ia_uso`. Se corre con
          `node scripts/db/migrar.cjs supabase/migrations/20261013150000_bcra_proveedores_y_uso_ia.sql` (desde crm/app) con OK de Augusto. Hasta que se corra, "BCRA proveedores" y "Uso de IA" muestran vacío/aviso (no rompen nada).
        - tsc 0, hooks OK. Probado en local sin guardar: Informes (clientes con números reales, proveedores lista 408), Ventas sin la pestaña. **PUBLICADA 13/10 como V1.1.429 (commit d3a6c45), migración corrida y probada en producción (Uso de IA carga).
      **Tanda V1.1.430 (13/10/2026) — PUBLICADA, sin migración. Salió junto con A5 (retenciones por concepto) y el SICORE de 198 caracteres (ver más abajo):**
        - Estados del PR: el desplegable (lista, tarjeta y detalle) solo ofrece Solicitud, Pendiente, Aprobado y Rechazado (`ESTADOS_MANUALES` en `presupuestos/page.tsx`).
          "Rechazado" abre la ventanita con "Rechazado" o "Postergado" + motivo (se guarda `postergado` como siempre: Dashboard, avisos y filtros sin cambios).
          Facturado lo pone solo la emisión de la factura (también se sacó para super_admin, pedido de Augusto); Vencido lo pone el aviso diario; "Facturar" quedó del circuito anterior a Ventas.
          Los PR viejos en Facturar/Vencido se siguen viendo con su estado. Probado en local sin guardar.
        - Cotización express: si el BNA no contesta, reintenta con el último valor guardado; si tampoco hay, avisa en rojo con "reintentá" (antes quedaba colgado "Trayendo tipo de cambio BNA…").
        - tsc 0 errores, hooks OK.
      **Tanda V1.1.431 (13/10/2026) — PUBLICADA, sin migración:**
        - SICORE con el formato exacto del archivo del contador (ver punto SICORE más abajo).
        - Carga de facturas de compra: opción **"Compré otra cosa"** por renglón (`cargar-factura-oc.tsx`, cálculo en `lib/reemplazo-oc.ts`, prueba `scripts/test-reemplazo-oc.ts`).
          El renglón de la OC pasa a ser el de la factura (misma OC, sin OC nueva; recepción escalada por la equivalencia; historial en observaciones de la OC).
          En el PR cambia SOLO el costo, pasado a la unidad del PR con la equivalencia editable (ej. 5000 m ÷ 10 rollos = 500 → $504 × 500 = $252.000 por rollo);
          precio de venta igual (markup recalculado) y leyenda en observaciones del PR con lo que vino en la factura del proveedor.
          Avisos (nunca frenan, salen al guardar): PR sin facturar con costo que cambia > 5 %, markup < 15 % (con ⚠️), y PR facturado siempre informativo.
        - Ventana de carga más compacta (datos en 6 columnas, menos espacios).
        - tsc 0, hooks OK. Probado en local SIN guardar con la FC A 00005-00134131 de Espumas Pilar y OC-2026-1186 (equivalencia 500, costo PR $252.000).
      **V1.1.432 (13/10) — ventana Nueva Orden de Pago compacta:** Ret. Ganancias en una fila (%, botones y monto) con el acumulado en una línea;
        Monto manual en una línea; Resumen y Datos bancarios lado a lado; tabla de facturas, notas y pie más finos. Entra entera sin bajar.
        Botón copiar (`components/copiar-btn.tsx`) al lado del Neto a pagar (copia `3104080.00`) y en CBU, Alias y CUIT. Probado en local sin guardar.
      **Tanda V1.1.433 (13/10, PUBLICADA en producción, commit 184465e):**
        - HECHO: Medios de pago de la OP en una fila por medio (sin CUIT repetido). OP única: se sacó "+ Parcial";
          si faltan > $1 aparece "Faltan $X · Pagar parcial" (y al Crear lo arma solo y avisa en amarillo): recorta lo aplicado
          a la factura más nueva y recalcula la retención (`lib/op-parcial.ts`, prueba `scripts/test-op-parcial.ts`). Probado con Bruno Francione sin guardar.
        - HECHO y CORRIDA por Augusto (13/10): migración `20261013170000_op_tolerancia_redondeo.sql` (+ vuelta atrás):
          la OP acepta hasta $1 menos en los medios (caso Sesenta Once OP-000053: los eCheqs daban $0,01 menos y tuvo que poner $1 en efectivo; Augusto decidió dejarla así;
          esa OP quedó con $1 efectivo ficticio y crédito a favor $0,99 — Augusto decide si se limpia).
        - HECHO: "Cómo se le paga" (`condicion-pago-editor.tsx`): "Se paga a (desde factura)" y "Cheque diferido a", en 2 filas;
          "Queda así: … eCheq diferido 45 días → el proveedor cobra a los 75 días de la factura" (textoCondicionPago dice "diferido").
        - HECHO: Cargar factura sin OC: casilla "Crear una OC nueva con los artículos de esta factura" (marcada sola si el proveedor no tiene OCs);
          al guardar crea la OC (enviada, recibida, atada a la factura). Si falla, la factura queda y avisa. Casillas de la carga en una línea.
        - HECHO: ventana Nuevo/Editar proveedor compacta (4 columnas, campos h-8, límite de crédito junto al descuento, CUIT de pagos en el encabezado bancario).
        - HECHO: detalle de OP compacto (medios en filas, importes en un recuadro, botón copiar total, comprobante y certificado en una línea).
        - HECHO: IA del proveedor: "Leer papeles con IA (ARCA, CBU…)" acepta varios archivos y lee también banco, tipo y n° de cuenta, CBU, alias y titular;
          completa solo lo vacío; si la cuenta es de otro CUIT avisa en amarillo (`lib/documento-impositivo.ts`, prueba `scripts/test-documento-impositivo.ts`).
        - Probado en local sin guardar. tsc 0, hooks OK. Versión 1.1.433.
        - PENDIENTE para otra tanda: compactar detalle de factura de compra y cobro/recibo.
      **PRÓXIMA TANDA (pedida por Augusto 13/10, espera su "OK" para arrancar; todo es sugerencia/aviso, nunca bloqueo):**
        0. Dólar automático: el sistema trae del BNA divisa Y billete (venta) cada día hábil (mañana y cierre) y los guarda en la base; todas las pantallas
           leen lo guardado (nunca esperan al BNA). Presupuestos usan el CIERRE DEL DÍA HÁBIL ANTERIOR. Si el BNA falla: usa el último guardado + cartel para cargarlo a mano.
           Cada presupuesto muestra qué dólar usó ("billete $X · cierre dd/mm") y se puede cambiar a mano.
        1. OC "Sin proveedor asignado": poder elegir "Stock propio" como proveedor.
        2. PR en $ ARS con costo en US$: convertir a pesos (hoy pone 1,09 de lista = dólares como pesos). Dólar según el proveedor (ficha: cotiza en divisa o billete);
           sin proveedor → billete. Mostrar al lado del costo "US$ 0,78 × billete $X"; si se asigna proveedor después, recalcula; dólar editable por artículo.
        3. Lista de costos (ventana del PR): a) al abrir mostrar la lista completa con filtros Proveedores/Marcas/Rubros cargados (hoy abre vacía);
           b) el orden por costo no ordena bien; c) búsqueda sin tildes ni mayúsculas ("pantalon" encuentra "pantalón").
        4. Ventana de presupuestos (las 8 aprobadas): 1) datos de arriba en una fila; 2) tabla sin scroll lateral (IVA oculto salvo ≠21 %, Código+Descripción en un campo);
           3) buscar en lista de costos mientras se escribe la descripción; 4) Enter en el último artículo crea otro; 5) totales fijos abajo (subtotal, IVA, total, margen, ganancia $);
           6) margen en rojo si < 15 % (aviso); 7) último precio vendido a ese cliente por artículo; 8) "Repetir presupuesto anterior" del cliente con precios de hoy.
      **TANDA (pedido de Augusto 13/10), punto 5, hacer DESPUÉS del punto 4: simplificar "Cargar factura o nota de pedido" (cargar-factura-oc.tsx).**
        Caso de ejemplo: FC A 0003-00005284 de Amoblamientos Nexo (PDF `C:\Users\lazza\Downloads\Factura (2).pdf`) contra OC-2026-1229 (mesa 1 × 378.800 + caja porta toma 1 × 49.000 = neto 427.800).
        La factura trae mesa 1 × 378.800 + caja 2 × 49.000 + "Costo de envío" 90.000 = neto 566.800, IVA 21 % 119.028, total 685.828.
        a) BUG de la IA: leyó "Iva 0%" (es solo el título de una columna vacía) y puso IVA 0 % en la mesa y la caja y 10,5 % en el envío, con total $576.250 en vez de $685.828.
           Hay que controlar que neto + IVA + percepciones = total leído del PDF; si no da, avisar y proponer 21 %. Ojo con "IVA 0%" o "10.5%" que vienen vacíos.
        b) Proceso simple (Augusto: "los ítems son casi iguales, solo agrega el envío; ese envío se tendría que poder agregar a esa OC y listo"):
           - Una sola tabla "Factura vs. OC", cada renglón al lado del de la OC; las diferencias de cantidad o precio se marcan con color.
           - Renglón que no está en la OC (envío): tilde "Agregar a la OC" marcado por defecto.
           - Más cantidad que en la OC: "Actualizar la OC a 2" en vez de crear una OC nueva.
           - "Compré otra cosa" y "OC adicional" pasan a "más opciones".
           - Un botón: "Guardar y enviar para aprobación".
        c) Espacios: datos de la factura en una o dos filas; arriba solo las OC pendientes de ese proveedor ("Ver todas" para el resto);
           la lista de ítems detectados se pliega cuando coincide con la OC.
      **V1.1.437 (13/10, PUBLICADA) — punto 5: "Cargar factura" simple (Factura vs. OC, solo diferencias):**
        - OC elegida sola entre las pendientes del proveedor (sin facturar del todo): 1) número de OC impreso (referencias_oc), 2) nombres parecidos,
          3) precios, 4) cantidades, 5) total. Chip "OC-xxx · elegida sola · cambiar / sumar otra"; la lista de OC solo se ve al cambiar ("Ver todas" para el resto).
        - Renglones: código/nombre/memoria como antes + emparejar por PRECIO lo que el proveedor llama distinto (se aprende al guardar).
        - Solo se muestran las diferencias: más cantidad → [Actualizar OC a N] [Crear OC nueva] [Solo en la factura]; renglón que no está (envío) →
          [Agregar a OC-xxx] [Crear OC nueva] [Solo en la factura] (por defecto: a la misma OC). Precio distinto, menos cantidad y lo que no vino: info.
          "ver detalle" abre los vínculos (corregir, Compré otra cosa, IA) y la tabla de artículos (plegada cuando hay OC). Se sacó el confirm de "OC adicional".
        - Al guardar, lo de "a la misma OC" agrega el renglón / sube la cantidad en la OC (recibido si la OC ya estaba recibida completa), recalcula totales,
          deja historial en observaciones y avisa si la OC viene de un PR (el PR no se toca).
        - Control del IVA: neto + IVA + percepciones vs. total impreso; si no da, aviso amarillo y botón "Usar IVA 21 % en todo" si con eso da justo. Total "✓ igual al PDF".
          Prompt de la IA: los títulos "Iva 0%"/"IVA 10.5%" vacíos del pie no son la tasa. Cada renglón conserva su IVA de la factura.
        - Datos en 2 filas, notas + "pagada con tarjeta" en una fila, botón único "Guardar y enviar para aprobación"; factura repetida ya no traba el botón (avisa y pregunta).
        - Lógica en `lib/factura-vs-oc.ts` (pruebas `scripts/test-factura-vs-oc.ts` y `scripts/test-factura-vs-oc-guardado.ts`).
        - Probado en local SIN guardar con Nexo FC A 0003-00005284: eligió OC-2026-1229 sola, mesa y caja emparejadas, diferencias caja 2 vs 1 y envío; 21 % → $ 685.828 igual al PDF.
        - Punto 1 de la tanda probado en producción sin guardar: "Repetir presupuesto anterior" (PR-2026-1246 Corteva: 28 art., 22 con precio de hoy, 6 costo anterior) y Enter en el último renglón: OK.
      **PENDIENTE (aviso de Augusto 13/10):** Proveedores → "Con deuda" muestra 11 proveedores con $ 2.742.069,43 que NO se les debe (Bomberomania, Casella,
        Electronic, Mastroianni, Fernandez, Fravega, Garcia, Horni, Mercado Libre, Segutecnica, Terra Vita). Revisar de dónde sale el saldo (facturas pagadas sin OP / sin marcar).
        **Diagnóstico 13/10 (solo lectura):** 1 factura por proveedor, suma exacta $ 2.742.069,43. 8 están en estado "pagada" (tilde "Ya pagada con tarjeta /
        marketplace") sin ningún pago cargado y `lib/saldo-proveedores.ts` no mira el estado. BH Industrial (OP-000004) y Electronic (OP-000043): OP anuladas,
        el pago sigue activo pero suelto (sin factura). Segutécnica 0014-00073272 ($ 554.710,63, 29/09, estado "pendiente", CC 60 días) sin pago: preguntar a Augusto.
        Propuesta de arreglo esperando OK.
        **13/10 RESUELTO (en la base, con OK):** "Con deuda" queda solo Segutécnica ($ 554.710,63, deuda real, no pagada).
        - `20261013200000_datos_reactivar_op4_op43.sql` CORRIDA: OP-000004 (Mastroianni) pagada por transferencia BBVA 02/10; OP-000043 (Electronic)
          pagada $ 620.329,99 sin retención (exento; no vuelve a SICORE) + los $ 5.870,42 del 08/10 como pago directo. Copia: `Claude outputs/antes_op4_op43_13_10_2026.json`.
        - `20261013210000_datos_pagos_visa_8_facturas.sql` CORRIDA: 8 pagos con Visa ·1582 por $ 1.241.528,69 (Bomberomania, Casella, Fernández, Frávega,
          García, Horni, Mercado Libre, Terra Vita). Vuelta atrás los anula (no borra).
      **TANDA V1.1.445 (14/10, PUBLICADA junto con la lista de Presupuestos de Claude; la V1.1.444 fue el arreglo de la fuga de márgenes):**
        - Compras: botón **"Carga manual"** visible al lado de "Cargar facturas (IA)" (antes estaba escondido en "Más"; se sacó de ahí). tsc 0, hooks OK, probado en local (abre la ventana, no se guardó nada).
          Ojo: dentro de la carga manual, si se sube un PDF igual se lee con IA (`/api/parse-factura-compra`). Propuesta de lectura sin IA (QR de ARCA / texto del PDF) esperando OK.
        - Propuesta esperando OK: columna `pendientes.respuesta` + casilla para responder y botón "Copiar respuestas", y cargar ahí las preguntas abiertas para Augusto.
        - Datos bancarios y contacto de administración en "Pago que pide el proveedor" (carga de factura): lo hace Augusto en el otro chat (prompt pasado).
        - **Chequeo en producción con sesión (14/10, commit 7223289), todo OK, sin guardar nada:** 1) sidebar "V1.1.445"; 2) Compras: "Carga manual" al lado
          de "Cargar facturas (IA)", abre "Cargar factura o nota de pedido" (se cerró sin guardar); 3) Presupuestos: columna "Ganancia / Margen", cartel
          "Montos de octubre" y "Todos" con 50 renglones sin ningún facturado; 4) PDF de PR-2026-1157 (uno de los afectados) generado: PDF válido de 223 KB,
          descarga interceptada (el texto del PDF viene codificado, no se pudo leer adentro); en la base 0 presupuestos con líneas de costo en `observaciones`
          y 6 en `notas_internas` (la migración 20261014140000 las movió).
      **TANDA V1.1.443 (14/10, publicada junto con la V1.1.442 de Claude, en dos deploys seguidos) — Configuración → Integraciones con datos reales:**
        - Tarjeta Email: `/api/email/config` (nuevo, pide login, solo dice si está RESEND_API_KEY / EMAIL_FROM, nunca la clave) → "Conectado" o
          "No configurado"; muestra facturas enviadas por mail este mes y rebotadas (`facturas.email_enviado_at` / `email_estado`).
        - Tarjetas Banco CC y E-cheques: "Por archivo" con link a Finanzas → Extractos / Cheques (no hay API gratis de BBVA).
        - tsc 0 errores, hooks OK. No probado en local (pide login) → probar en producción. Falta subir app-version al publicar.
        - Seguridad revisada 14/10: el middleware (`lib/supabase/middleware.ts`) ya exige login en TODO `/api/` salvo `/api/cron/*` y
          `/api/cotizacion-bna` (probado en producción: email/send y rutas IA dan 401 sin login). Registro público en Supabase deshabilitado.
          7 tablas de `probar-anonimo.cjs` cerradas. Web lazzari.com.ar (Netlify) solo tiene HSTS.
        - **A) Prueba de TODAS las tablas sin login (OK 14/10, solo lectura):** 100 nombres (del código + migraciones), con la clave pública.
          80 cerradas, 15 dan permiso denegado/no existen, 5 abiertas: `cotizaciones_dolar` (dólar, público, se deja) y **4 vistas con datos
          reales**: v_cuenta_corriente_clientes (205), v_cuenta_corriente_proveedores (822), v_ordenes_compra_progreso (139), v_stock_alertas (46).
          Las vistas corren como su dueño y saltean el RLS. Arreglo: `20261014130000_cerrar_vistas_anonimo.sql` (revoke a `anon`; el CRM las lee
          logueado = rol authenticated, no cambia) + rollback. **CORRIDA por Augusto 14/10; re-probado: las 4 dan 401, solo queda abierta
          cotizaciones_dolar.** Ninguna pantalla usa esas 4 vistas (solo `queries/*.ts` sin importar), así que no rompe nada. Re-probar con el script (en
          el scratchpad de la sesión: lee .env.local, prueba cada tabla con limit 1 y no imprime datos). El esquema (OpenAPI) no se ve sin login. Las
          funciones `rpc` NO se probaron (podrían escribir).
        - **B) Encabezados de seguridad (`next.config.ts` → `headers()`):** X-Frame-Options SAMEORIGIN + CSP `frame-ancestors 'self'`
          (anti-recuadro), nosniff, Referrer-Policy, Permissions-Policy (cámara/mic/ubicación apagados; el CRM no los usa). Probado en local:
          login carga y devuelve los 5 encabezados. Al publicar, verificar con `curl -I https://lazzari-crm.vercel.app/login`.
          (Error local `Cannot find module './5611.js'` = caché `.next` vieja, no es de este cambio.)
        - Banco "en vivo": opciones conversadas con Augusto (preguntar al ejecutivo BBVA por API/host-to-host o envío automático de extractos).
      **V1.1.440 (14/10, PUBLICADA — un solo commit 4c41788 con lo de este chat + Lista de costos del otro chat) — gasto fijo con proveedor + Tanda 4 de pantallas compactas:**
        - `20261013231000_gasto_fijo_proveedor.sql` CORRIDA (14/10, con OK, cuando terminó la transacción de las fotos): `gastos_fijos.proveedor_id`.
        - **Gasto fijo atado al proveedor:** en Finanzas → Pagar → Gastos fijos, "Proveedor que lo factura (opcional)". Si en el mes no hay factura
          de ese proveedor (sin NC ni anuladas) → "⚠️ Falta la factura de octubre"; si la hay → "✓ Factura de octubre: $ X". También en el Dashboard
          (cuadro Cobertura de gastos fijos, link a la pestaña). Solo aviso. `lib/gasto-fijo-factura.ts` (prueba `scripts/test-gasto-fijo-factura.ts`).
          Renglones de gastos fijos más finos. Probado en local sin guardar (selector muestra AGUSTIN MUSSO).
          **FALTA de Augusto:** monto de honorarios del contador (Agustín Musso, proveedor en las 2 sociedades) y si lo paga solo Lazzari o también Grupo LA.
          Con eso se carga el gasto fijo (con su OK).
        - **Tanda 4 compacta:** Stock, Calendario, Compras (arriba y listado), Reportes (chips, gráficos más bajos), Muestras, Personalización,
          Configuración (formularios en 2-4 columnas; también arca-status-card, uso-ia-config, fechas-cheque-config), Papelera, Consulta facturas,
          y en Finanzas el detalle de factura de compra (grilla, importes en recuadro, botón copiar total nuevo) y el detalle de cobro (movimiento).
          Recibos no tiene detalle propio (solo PDF). Probado en local: Stock, Compras, Reportes, Calendario, Muestras, Personalización, Configuración, detalle FC.
        - `20261014100000_datos_gastos_fijos_lazzari.sql` CORRIDA (OK 14/10): contador Musso $ 178.200 (con proveedor), alquiler US$ 800,
          sueldos Mariana/Jero/Seba $ 1.500.000. La FC C 00001-00000556 de Musso (07/10, $ 178.200, honorarios septiembre) NO está cargada todavía.
        - **Mejoras 1, 2 y 3 HECHAS (OK 14/10):** `20261014110000_gastos_fijos_pagos_pendientes.sql` CORRIDA: gastos_manuales.gasto_fijo_id,
          gastos_fijos.dia_vencimiento y gastos_fijos.calculo ('sicore'). 1) En "Gastos", "Es el pago del gasto fijo" con sugerencia ✨ por texto
          (`sugerirGastoFijo`); Gastos fijos sin proveedor muestran "⚠️ Falta pagar octubre (vence el D)" o "✓ Pagado"; Dashboard avisa desde 5 días antes
          (solo los que tienen día de vencimiento). 2) Botón "Leer VEP / impuesto (IA)" en la ventana de Gastos (`/api/parse-vep`, `lib/vep.ts`,
          prueba `scripts/test-vep.ts`): completa descripción, monto, fecha, categoría Impuestos y el gasto fijo; adjunta el VEP; no guarda solo.
          3) Gasto fijo con "Monto automático SICORE" = retenciones de Ganancias de las OP del mes anterior (`montoSicore`).
          Pendientes: se reusó la tabla `pendientes` y el componente `components/presupuestos/pendientes-widget.tsx` (no estaba montado) → botón
          "Pendientes" en el Dashboard (admin/administrativo). `20261014120000_datos_pendientes_augusto.sql` CORRIDA: 9 pendientes de Augusto.
          Probado en local la pestaña Gastos fijos; Dashboard se prueba en producción.
          Augusto paga AUTÓNOMOS (no monotributo). "Sicreb" = SICORE. Impuestos con VEP → pestaña Gastos (categoría Impuestos), no facturas.
          Servicios con factura (luz, internet, alarma, celulares, seguros, Google Drive, Netegia [baja pedida], Claude Team, Supabase) → factura tipo Servicio/gasto.
          Falta de Augusto: montos de mutual (Jero, Mariana, Seba, Augusto), monotributo (Jero, Mariana, Seba), autónomos, seguros local/auto, celulares,
          internet, luz, alarma, Google Drive, Netegia, Claude, Supabase; IVA/CM/Seg. e Higiene aprox.; OK para 6) mant. BBVA 091-339549/3 $ 34.000/mes
          (28.099,17 + IVA, día 2); qué es cada "DEBITO DIRECTO" del BBVA (7/10 $ 263.928,17 y $ 9.689,44; septiembre 8 débitos); extractos BNA y Galicia.
          Grupo LA (contador y gastos): pendiente.
          Idea: el asistente IA del CRM tiene insert_record genérico → mejor que abra "Cargar facturas (IA)" en vez de insertar directo.
        - Incidente: un ayudante dejó vacío finanzas/page.tsx; se recuperó desde git y se reaplicaron los cambios (nada publicado ni perdido).
      **V1.1.439 (13/10, PUBLICADA) — Tanda 2 y 3:**
        - **Factura de servicio / gasto (la del contador):** en la carga de facturas de compra, fila "Tipo": Compra / Transporte / Servicio / gasto / Solo IVA
          (siempre visible, también desde Compras). Servicio no pide OC; elegís categoría (Honorarios, Alquiler, Luz/gas/internet, Mantenimiento, Software,
          Publicidad, Seguros, Otros). Se sugiere solo (✨): repite el tipo de las facturas anteriores del proveedor, o por el texto (honorarios, alquiler…).
          Va a OP como cualquier factura; monotributista / FC C: sin IVA y sin retención de Ganancias (ya lo hacía la OP). Finanzas muestra la categoría.
          `lib/factura-tipo.ts` (prueba `scripts/test-factura-tipo.ts`). Probado en local sin guardar (Carlos Cáceres → Transporte sugerido).
        - `20261013230000_factura_servicio_categoria.sql` CORRIDA (OK 13/10): `facturas_compra.categoria_gasto`.
          `20261013231000_gasto_fijo_proveedor.sql` (`gastos_fijos.proveedor_id`) SIN CORRER: con OK de Augusto, pero la base estaba bloqueada por una
          transacción larga de otro proceso (fotos del catálogo, `update catalogo_costos`) que tiene tomada `proveedores`. Correrla cuando termine.
          Después: gasto fijo atado al proveedor → aviso "falta la factura del mes de X" (falta el monto de honorarios del contador).
        - **Finanzas:** grupos y pestañas en una sola fila (antes 2 filas con tarjetas grandes).
        - **Presupuestos (listado):** estados, totales y filtros en filas finas; columnas sin cortes en 3 líneas → entran 18 PR en pantalla (antes 5).
        - **Clientes:** números en una línea, renglones más bajos. **Arreglado:** cargaba antes de saber la sociedad → mostraba los clientes de las dos
          y "No se pudo calcular el saldo" con todos los saldos en $ 0.
        - **Dashboard:** saludo en una línea, gráficos más bajos. Remitos y Transportes ya estaban compactos.
      **V1.1.438 (13/10, PUBLICADA commit be10849) — Tanda 1 (OK de Augusto "avanzá con todo"):**
        - Error de la carga masiva "No se pudieron cargar las OC" (pedía OC "pendiente", estado que no existe → "borrador"; el cartel muestra el error real).
        - **Carga masiva global** (`components/carga-masiva-global.tsx` en el layout): se abre desde Compras y Finanzas, botón "Segundo plano" deja un aviso
          abajo a la derecha que sigue leyendo/cruzando aunque cambies de pantalla; al guardar avisa (evento `lz:facturas-compra`) y las pantallas se refrescan.
          Trae sola proveedores y OC. Cerrar con facturas sin cargar pregunta antes.
        - **FC + NC juntas:** se cargan primero las FC y después las NC; la IA lee "comprobantes_asociados" de la NC; la NC trae sugerida la factura citada
          o la del mismo proveedor guardada en la tanda (✨ aviso, se puede cambiar). `lib/nc-sugerencia.ts` (prueba `scripts/test-nc-sugerencia.ts`).
        - **Compras:** barra con 1 botón "Cargar facturas (IA)" + "Más ▾" (Ordenar OC abiertas, Cargar una factura a mano, Conciliar un proveedor, Ítems sin proveedor, Consolidar).
        - **Pagada con tarjeta:** el tilde pasó a "¿Cómo se paga?" (Va a OP / Ya pagada con Visa / Master / otro medio). OC marcada con tarjeta o Mercado Libre
          sugiere Visa. Al guardar registra el pago en la cuenta de la tarjeta (saldo proveedor 0, suma deuda de tarjeta). En la conciliación con OC también:
          si todas las OC de la factura estaban pagadas con tarjeta, queda pagada con Visa. `lib/pago-tarjeta.ts` (prueba `scripts/test-pago-tarjeta.ts`).
          Red de seguridad: factura "pagada" sin pago no cuenta como deuda (`lib/saldo-proveedores.ts`). Proveedores ahora suma los mismos créditos que Finanzas.
          `20261013220000_pago_tarjeta_factura_compra.sql` CORRIDA (OK 13/10): `tarjetas_de_sociedad` y `registrar_pago_tarjeta_factura_compra`.
          Los vendedores ven/usan solo tarjetas con uso "trabajo" (la Visa, Mercado Libre de los chicos); la Mastercard (uso "mixto") es personal de
          Augusto, solo la ven admin/administrativo ("más adelante veré qué función le doy"). Probada simulando a Jerónimo y en local.
          Doble check contra el resumen de la tarjeta: cuando se haga la carga de resúmenes (etapa 3 de Finanzas).
        - **Menú agrupado:** Inicio / Vender / Comprar / Entregar / Plata; Papelera abajo con Configuración; renglones más finos. Cada rol ve lo suyo (vendedor no ve Plata).
        - **Capa 1 (todas las pantallas):** tablas (DataTable) con renglones y encabezados más finos, ventanas (Modal) con menos margen y 75 % de alto,
          filtros más bajos, números de arriba (StatCard) y encabezado más chicos. Proveedores: pestañas, buscador y tabla más compactos.
        - Campanita: ya no consulta con sociedad "undefined" (error 400 en consola).
        - Probado en local sin guardar: menú, Compras (botón + Más), segundo plano siguiendo a Finanzas, "¿Cómo se paga?" con las 2 tarjetas, Con deuda = 1.
        - SIGUIENTE: Tanda 2 = Finanzas compacta + facturas de servicio/contador (tipo "Servicio / gasto", gasto fijo atado al proveedor que espera la factura del mes).
          Tanda 3 = Presupuestos (listado), Clientes, Remitos, Transportes, Dashboard. Tanda 4 = resto.
      **IDEA (Augusto 13/10): cargar FC + NC del mismo proveedor juntas.** Hoy: Finanzas → "Cargar facturas (IA)" acepta las dos a la vez, pero se revisan
        de a una; la NC va a la carga simple y solo se puede aplicar a una factura YA guardada (si no, queda como crédito disponible para la OP).
        Propuesta: en la carga masiva, si en la misma tanda hay FC y NC del mismo proveedor, guardar primero la FC y proponer sola "Aplicar la NC a la FC …" (aviso, no traba).
      **V1.1.436 (13/10, PUBLICADA) — punto 4: las 8 mejoras de la ventana de presupuestos:**
        - Ventana más ancha (Modal size "2xl"); datos de arriba en una fila (grilla de 11, campos h-8); avisos del dólar al final en una línea.
        - Tabla sin scroll lateral: Código + Descripción en una celda (la descripción ocupa lo que sobra); IVA oculto salvo que algún renglón ≠ 21 % (botón "IVA 21 % · cambiar").
        - Descripción busca en la lista de costos al escribir (`components/presupuestos/descripcion-lista.tsx`, ↓/Enter o clic; la lista se precarga al abrir).
        - Enter en el último renglón agrega otro y pone el cursor en su descripción.
        - Pie fijo: Subtotal, IVA, Total, Margen, Ganancia y "⚠️ N art. con margen < 15 %" (aviso, no bloquea).
        - "Últ. venta" por artículo (PR aprobados/facturados del cliente, en memoria) con diferencia % y botón "usar".
        - "Repetir presupuesto anterior": últimos 12 PR del cliente; copia artículos con precio de HOY de la lista (por código); los que no están quedan con su costo anterior + aviso.
        - Lógica en `lib/presupuesto-ayudas.ts` (prueba `scripts/test-presupuesto-ayudas.ts`). Probado en local sin guardar (Corteva): fila única, búsqueda, elegir, Enter, sin scroll lateral.
        - FALTA: punto 5 (Cargar factura contra OC con control del IVA).
      **V1.1.435 (13/10, PUBLICADA) — puntos 0, 1, 2 y 3 de la tanda + PDF con TC:**
        - Dólar: `lib/dolar-presupuesto.ts` (prueba `scripts/test-dolar-presupuesto.ts`): los presupuestos leen `cotizaciones_dolar` (cierre del día hábil anterior,
          solo BNA verificado o manual), una vez por sesión; si no está, `/api/cotizacion-bna` sin force. Cron también a las 11 (14 UTC); DolarAPI no se usa en feriados.
        - PR en $: guarda billete y divisa (tipo_cambio / tipo_cambio_divisas también en PR ARS); costo "USD" × billete, "USD Divisa" × divisa; barra "Dólar para costos en US$"
          editable con "cierre dd/mm" y aviso si no está guardado; debajo del costo "× billete 1.535 = $ X". Botón de moneda: AR$ → US$ → US$ div.
          Artículo a mano en US$: al elegir proveedor toma billete/divisa de sus listas (DPS y Segufer = divisa).
        - PDF del presupuesto en US$: "Tipo de cambio: BNA divisa/billete vendedor $ X" (antes solo salía si era billete).
        - Lista de costos: trae la lista completa una vez (`traerListaCompleta`), abre con todo, filtros cargados, búsqueda sin tildes (`lib/buscar-texto.ts`), orden por costo sobre toda la lista, "Ver más".
        - OC sin proveedor: botón "Es stock propio" (observaciones "Stock propio — …").
        - FALTA de la tanda: punto 4 (las 8 mejoras de la ventana de presupuestos). Empezado: `filaListaAItem` exportado en catalogo-picker para la búsqueda en la descripción.
      **V1.1.434 (13/10, PUBLICADA y probada en producción sin guardar) — OP en pesos de facturas en US$** (Augusto: "el pago lo hago en $ siempre"):
        - Nueva OP con facturas USD: ya no salta a la ventana FX; la OP queda en $ con barra "Se paga en pesos · Dólar" (BNA divisa vendedor del día hábil
          anterior, se completa sola y es editable). Bruto = Σ round(US$ × TC) por factura (`lib/op-usd-pesos.ts`, prueba `scripts/test-op-usd-pesos.ts`, con enteros).
          Retención de Ganancias, base, medios (cheque propio, eCheq, etc.) y certificado en pesos, igual que una OP en pesos. NC en US$ se aplican en la misma OP.
          Pago parcial en US$ redondea para abajo al centavo de dólar. Saldo de facturas redondeado (ya no muestra 954,07999999).
        - Migración `20261013190000_op_usd_en_pesos.sql` (CORRIDA 13/10, + vuelta atrás): columnas ordenes_pago.cotizacion / cotizacion_fecha / moneda_documentos
          y función `registrar_op_usd_en_pesos` (número OP-0000xx normal; op_facturas_compra.monto en US$; recalcula el bruto y rechaza si no coincide).
          Probada con Segufer contra la base con ROLLBACK (crear + anular) y en local sin guardar: US$ 1.127,65 × 1.517 = $ 1.710.645,05, ret. $ 23.448,88, neto $ 1.687.196,17.
        - El PDF de la OP muestra cada factura en $ con "US$ X × TC". No hay TC original en facturas_compra: la diferencia de cambio contra la factura no se calcula.
      **Segufer (HECHO 13/10, por script con las funciones de la pantalla, OK de Augusto):** FC A 00042-00101199 (número corregido, antes "0001-") conciliada con OC-2026-1138
        (6006 y 6800; 2 × 6007 y 2 × 6200 "Fuera de OC", cliente del sistema viejo) y FC A 00042-00100558 con OC complementaria OC-2026-1234 (4 × 6007). Ambas aprobadas, SIN aceptar costos
        (la diferencia contra la OC la bonificó Segufer con NC). NC A 00042-00004630 (US$ 28,80) y 00042-00004674 (US$ 158,50) cargadas con PDF y aplicadas a su factura.
        Saldo para la OP: US$ 173,57 + US$ 954,08 = US$ 1.127,65. La OP la hace Augusto.
        Mejora propuesta (no hecha): en Facturas de compra, "en_conciliacion" se muestra como "Pendiente" (`finanzas/page.tsx` ~4405): mostrar "En conciliación" + botón Retomar.
      **Del Sol (pendiente, 13/10):** OP 0001-00017009 = eCheq 3968 $6.210.728,30 (11/12, no cargado) + ret. Ganancias cert. 11672 $99.826,69 = $6.310.554,99;
        paga FA 16-16, 16-17, 16-18, 15-45 y "FC 39" ($1.242.839,98). La FA 15-39 está ANULADA por la NCA 15-5 (emitida desde el CRM el 30/09 con CAE, sin usuario ni motivo);
        la FA 15-54 ($1.395.507,04) sigue impaga. Nada cargado todavía.
        ENCONTRADO 13/10: la 15-39 (300 bolsas + 6 carretillas) se anuló con la NCA 15-5 (30/09 18:50) y se REFACTURÓ como FA 16-17 (18:51, mismos artículos, $1.225.125).
        Del Sol paga la 16-17 Y la "39" → pagó dos veces lo mismo ($1.242.839,98 de más). La 15-54 es otra venta (detector Bosch + martillo demoledor).
        FA 16-18 ($1.370.733,34, renglón genérico "ARTICULO FERRETERIA Y ELECTRICIDAD", creada 30/09 19:17) tiene el MISMO importe que la FC-A 9-399 del sistema viejo (20/08): preguntar si es reemisión y si la 9-399 ya estaba cobrada.
        Detalle para corroborar: PDF en `C:\Users\lazza\Downloads\OP 17009 LAZZARI AUGUSTO .pdf` (escaneado, 3 hojas: remesa, certificado, eCheq Galicia LRA9FdZ685).
        Importes por factura en la OP: 16-16 $926.374,49 · 16-18 $1.370.733,34 · 16-17 $1.225.125,00 · "39" $1.242.839,98 (fecha 30/9 en la OP; en el CRM la FA 15-39 es del 25/09) · 15-45 $1.545.482,18.
        Certificado 11672: régimen 078, pago neto de IVA $5.215.334,70, no sujeto $224.000, 2 % s/ $4.991.334,70. Fecha de la OP y recepción: 09/10/2026.
        En la base no hay otra factura de $1.242.839,98 ni otra n° 39. La migración del 11/10 solo ató la NCA 15-5 a la 15-39 (ya estaba anulada; NC creada 30/09 15:50, sin usuario).
        La diferencia de $252.493,75 anotada antes salía de suponer la 15-54 en vez de la 39: con la retención la OP cierra exacta.
        Propuesta dada a Augusto (esperando OK): cobro con las 4 facturas completas y los $1.242.839,98 de la "39" a cuenta de la FA 15-54 (queda debiendo $152.667,06), y pedir a Del Sol que registre la NCA 15-5;
        o, si la NCA 15-5 era por otra cosa, revisarla antes de cargar. Sigue pendiente también: eCheq 3644 (diferencia $193.792,37, faltan certificados) y confirmar que FA 16-18 no sea la misma venta que la FC-A 9-399.
      **Próximo (pedido de Augusto 13/10):** Cotización express con un primer paso (cliente, moneda, dólar divisas y billetes del BNA editables);
        Pegaso es MARCA, la vende Mariana SA (verificar cómo figura en catalogo_costos y Proveedores). Hoy el PR trae un solo TC del BNA
        y usa el mismo para proveedores en divisa y en billete: traer los dos.
      **HOJA DE RUTA (Augusto 14/10: "guiame vos, no te olvides de nada"). Se hace EN ESTE ORDEN, una tanda por vez, publicando al final de cada una.**
        Al terminar cada tanda: tsc + hooks + prueba local sin guardar, actualizar este bloque (marcar ✅), publicar (permiso de Augusto) y darle el /clear + prompt de la siguiente.
        - **Tanda A (chicas, uso diario):** ✅/⬜ por punto
          ✅ A1 (14/10, GUARDADA con OK de Augusto). Mariana S.A. (5n): FC A 00012-00012760 ($ 1.103.989,48) + NC A 00010-00017374 ($ 55.199,47, aplicada a la FC; saldo a pagar $ 1.048.790,01) conciliadas con OC-2026-1221 (parcial: faltan 2 botines y 2 zapatos). Costo del botín $ 26.862 → $ 28.275,80 en la OC y en PR-2026-1215 (margen 35 % → 28,25 %). PDFs subidos. Script `scripts/db/cargar-mariana-sa.cjs` (sin flag prueba y deshace; `--aplicar` guarda). La OP la hace Augusto.
          ✅ A2. (5h) (V1.1.441: la OC del cliente se ve con su fecha en cada fila y la bandeja Para facturar ordena por fecha de OC, la más vieja primero; sin consultar ARCA por fila) Fecha de la OC del cliente en Ventas > Para facturar, ordenar por la que se puede facturar con fecha anterior.
          ✅ A3. (5k) (V1.1.441: `email-compose-modal.tsx` compacto: 3 contactos sugeridos + "Ver todos", mensaje plegable, botón Enviar siempre visible) Ventana "Enviar factura" compacta.
          ✅ A4. (5g) (V1.1.441: "Guardar este contacto" en el mismo modal, para factura (cliente, cargo Administración) y OP (proveedor, cargo Pagos)) "Guardar este contacto" al enviar OP y factura (reusar `guardarContacto` de enviar-oc-proveedor).
          ✅ A5. (5f) (V1.1.441: `components/presupuestos/oc-cliente-bloque.tsx` reemplaza OC + Fecha + Archivo adjunto; IA sugiere número y fecha desde el PDF en `api/leer-oc-cliente`; sin prompt del navegador) Un solo botón "OC" en el detalle del PR (número + archivo + fecha), sin prompt del navegador; IA sugiere el número desde el PDF.
        - **Tanda B (masivos con revisión):** ⬜ B1. (5i + 5c) Facturar masivo con detalle y OK. ⬜ B2. (5j) Envío masivo de OP y facturas con detalle de destinatarios.
        - **Tanda C (Finanzas):** ⬜ Cuentas y extractos etapa 1 (punto 0 de abajo, plan con OK, migración).
        - **Tanda D (plata y riesgo):** ⬜ D1. (5l) Ganancia/margen en lista de PR, 7 % facturados / 2 % manuales, reordenar márgenes. ⬜ D2. (5e) Avisos BCRA crítico. ⬜ D3. (5n mejora) NC con % aplicada a la FC al conciliar.
        - **Tanda E (diseño, con propuesta previa):** ⬜ E1. (5m) Seguimiento. ⬜ E2. (5m) Dashboard.
        - **Respuestas de Augusto (14/10):** A1 = SÍ actualizar el costo del botín a $ 28.275,80 en la OC y en el PR (la carga igual se confirma antes de guardar).
          D1: PR "manual" = documento manual, SIN ARCA (facturado por afuera del sistema electrónico) → 2 %; facturado con ARCA → 7 %.
          D2: "crítico" = situación BCRA **2 o más**.
      **PENDIENTES PARA MAÑANA (13/10, orden propuesto):**
        0. Tanda 1: Augusto da OK → correr migración, subir versión, publicar y probar en producción (Informes proveedores, Uso de IA, Ventas).
        1. Tanda 2 (c): PR express "margen 25 %" sobre el costo, aviso si algún renglón < 15 %.
        2. j) **Lista de costos, etapa 1 — DATOS CARGADOS y PANTALLAS HECHAS (14/10), SIN PUBLICAR, sin migración nueva, sin subir versión.**
           - **Pantallas (14/10, todo solo para ver, nada frena):**
             - Proveedores > pestaña **"Lista de costos"** (`components/lista-costos/lista-costos-tab.tsx`, también `/proveedores?tab=costos`): buscador sin tildes,
               filtros Proveedores/Marcas/Rubros (con semáforo), botón **Fotos sí/no** (recordado por usuario en esa compu, localStorage), foto chica → grande,
               costo, margen % (rojo si < 15 %), venta, orden por columna, "Ver más". Botón **"Márgenes y redondeo"**: 8 rubros, regla de redondeo con ejemplos y semáforo de cada lista.
             - Ficha del proveedor > **"Reglas comerciales"** (`reglas-proveedor-ficha.tsx`): vigencia con semáforo, descuentos en el costo, cómo se calcula,
               condiciones y opcionales "No incluidos en el costo". Une por `catalogo_proveedores`; si no hay vínculo, por nombre de fantasía/razón social.
             - Al cotizar (lista de costos del presupuesto, `catalogo-picker.tsx`): en cada fila punto de semáforo + ℹ️; en los seleccionados además
               "Pedir actualización", "Verificar" y chips de opcionales (ej. "+40 % excepcional").
             - **Semáforo (Augusto 14/10): 🟢 hasta 30 días, 🟡 30 a 60, 🔴 más de 60 o sin fecha.** Con fecha de vencimiento: 🟡 la última semana, 🔴 vencida.
               Lee la primera fecha del texto de vigencia ("Octubre 2026" = 1/10). Lógica en `lib/lista-costos.ts` (prueba `scripts/test-lista-costos.ts`).
             - `traerListaCompleta` ahora trae también `foto_path`. tsc 0, hooks OK. Probado en local sin guardar (Pegaso con fotos, ℹ️, márgenes, ficha Star-Tex, PR nuevo con Conoflex sin agregar).
             - Hoy en rojo: Conoflex, Fravida, Delta Plus, FADI, Segutécnica, Mediglove, Prisina (pedirles listas nuevas).
           - Migración 20261014090000_lista_costos_reglas.sql **ya corrida**. Crea:
             - `proveedor_reglas`: 17 proveedores, de la hoja "Reglas".
             - `proveedor_descuentos_opcionales`: 8 descuentos.
             - `margenes_venta`: 8 rubros.
             - `lista_costos_config`: redondeo.
             - `catalogo_cargas`: historial.
             - `catalogo_costos.foto_path` y el bucket público `productos`.
           - El descuento por pago anticipado es UN solo dato: `proveedor_descuentos_opcionales` (tipo `pago_anticipado`) y `proveedores.descuento_pronto_pago` se sincronizan por trigger en las dos sociedades.
           - Carga: `node scripts/importar-reglas-costos.cjs` (sin flags = solo resumen; `--aplicar --fotos --fotos-dir <carpeta>`). Lee el Excel sin modificarlo. Saltea filas con código roto.
           - Decisiones de Augusto (13/10):
             - "contado" = pago anticipado (transferencia). Descuentos sobre lista, en cascada, nunca duplicados.
             - Pago anticipado: DPS 5, Star-Tex 5 (pedidos > $1.750.000 + IVA), Aire Libre 3, SPI 5, Fravida 5.
             - Pegaso (Mariana S.A., vinculada): costo = lista −20 % fijo; 5 % opcional por cantidad (>6 por talle, negociable). ⚠️ La lista todavía descuenta el 5 %: Augusto lo corrige en el chat de listas.
             - Fravida: 30 % EN LUGAR del 20 % si la compra del mes supera $10 M.
             - Conoflex: 40 % excepcional en lugar del 35 %, con autorización.
           - Fotos: 3.891 subidas, sin errores; 3.608 artículos con foto (incluye inactivos).
             - Sin foto a propósito: 9 variantes con código distinto (Fravida /HB, Delta Plus M1200VC/M1300VC, Conoflex "4001-1R /4000 NE", BH ENERGY 680). Augusto: NO asignarlas a la variante parecida.
             - Sin foto: 10 de Delta Plus (archivo faltante en el zip).
           - **Después:**
             - OC: aviso + tilde "Pedir descuento por pago anticipado" y una línea en la OC al proveedor.
             - Al cargar la factura: control de si vino el descuento.
             - Al pagar (Plan de pagos / OP): aviso "pedí el X %".
             - Avisos: compras en la OC y administración al pagar.
           Lista de costos dentro del CRM (Opus para diseñar la etapa 1).
           Etapas: 1) cargar el CSV a tablas y mostrarlo en Proveedores > Lista de costo (el CSV sigue mandando), 2) Buscar/Comparar, 3) Reglas y subir listas con IA y aprobación, 4) recién ahí cambiar la regla 7.
        3. IA-1 cobros sugeridos desde el extracto; IA-3 facturas de compra conciliadas solas; i) CUIT apócrifos (confirmar fuentes ARCA); IA-5 chat con IA con datos reales (solo lectura).
        4. Desarrollar con Augusto: b (personalización en el presupuesto), d (oportunidades), e (preguntas por cliente), f (propuestas entre todos).
        5. NUEVO — Armado de presupuestos (idea base, NO definir todavía, se desarrolla con Augusto): pantalla que deja escribir y va sugiriendo productos. Prioridad: comprar barato, pero también
           ahorrar tiempo y plata de flete cuando son pocas cantidades: con poca mercadería, centralizar en la menor cantidad de proveedores; si un proveedor solo vende bulto cerrado y se necesitan pocas unidades,
           puede convenir otro con poca diferencia de precio que además cubra otro artículo del mismo PR. Ejemplo: Prisina sale más caro pero está en Pergamino (a 500 m), da cuenta corriente: para 10 pantalones conviene.
        5b. NUEVO — Motivación del equipo (idea base de Augusto, NO definir todavía): a) al aprobar un presupuesto sale un cartel felicitando a los chicos; b) una ventana del CRM siempre visible con
           frases motivadoras de vendedores que cambian día a día; c) todos ven el monto NETO de venta facturado, unificado en $ ARG (USD convertido), contra el objetivo de $120.000.000 netos, con una barra que se va cargando.
           A definir con Augusto: período de la barra (¿mensual?), de qué sociedad suma (¿Lazzari + Grupo LA o la activa?), cómo convertir USD (cotización de cada factura), quién ve qué, y si el cartel es solo para el vendedor o para todos.
        5c. NUEVO — Ventas: **botón de facturar masivo, inteligente** (hoy no hay): que calcule la mejor manera de facturar varias ventas juntas respetando las reglas ya definidas
           (tipo de dólar del cliente, no facturar antes de la OC del cliente, fecha más vieja permitida por ARCA, clientes que piden OC, etc.). Se desarrolla con Augusto; solo sugiere, nada se emite solo.
        5d. NUEVO — **Ranking por compradores y por empresas** (para preparar los regalos de fin de año): quién y qué empresa compró más, en pesos netos unificados. A definir: período (año en curso), cómo agrupar comprador/empresa.
        5e. NUEVO (Augusto 14/10, NO hacer todavía) — **Avisos BCRA de clientes en situación crítica:** avisar al vendedor cuando APRUEBA el presupuesto
           y cuando hace el REMITO; avisar a administración ANTES DE FACTURAR. Solo aviso, nunca bloquea (regla 1). A definir: desde qué situación BCRA es "crítica" (¿3 o más?).
        5f. NUEVO (Augusto 14/10, NO hacer todavía) — **Detalle del presupuesto (panel lateral al tocar un PR): ordenar y compactar.**
           Hoy "OC del cliente: + Adjuntar OC" (arriba, abre un prompt del navegador para el número) y "Archivo adjunto" (abajo) son lo mismo:
           unificar en UN botón "OC" con el número y el archivo juntos (+ fecha de la OC). Idea: al subir el PDF, leer el número de OC del archivo
           (nombre del archivo o contenido, con IA) y sugerirlo ✨. Reemplazar el prompt del navegador por un campo en pantalla.
        5g. NUEVO (Augusto 14/10, NO hacer todavía) — **"Guardar este contacto" al enviar OP o factura:** si el proveedor/cliente no tiene mail o
           WhatsApp cargado y se escribe en el momento de enviar, ofrecer "Guardar este contacto". YA EXISTE solo en "Enviar OC al proveedor"
           (`components/enviar-oc-proveedor.tsx`, `guardarContacto`): reusar esa lógica en el envío de OP (proveedor) y de factura (cliente).
        5h. NUEVO (Augusto 14/10, NO hacer todavía) — **Ventas > "Para facturar": mostrar la FECHA DE LA OC del cliente** en cada fila y relacionarla
           con la fecha posible de facturación (la más vieja que permite ARCA), ordenando primero las que se pueden facturar con fecha anterior.
           Va de la mano de 5c (facturar masivo inteligente: "no facturar antes de la OC" y "fecha más vieja permitida por ARCA").
        5i. NUEVO (Augusto 14/10, NO hacer todavía) — **Facturar masivo con revisión** (amplía 5c): pantalla con el detalle de CADA factura a emitir
           (cliente, PR, OC del cliente y su fecha, fecha de factura propuesta, moneda/TC, renglones, total) para que Augusto lo corrobore y dé el OK;
           recién con su OK se emite. Nada se emite solo.
        5j. NUEVO (Augusto 14/10, NO hacer todavía) — **Envío masivo de órdenes de pago y de facturas, con revisión:** lista con el detalle de cada envío
           (a quién: nombre, mail/WhatsApp de destino; qué documento; importe) para corroborar y dar el OK antes de mandar. Combinar con 5g
           ("Guardar este contacto" si falta el dato).
        5k. NUEVO (Augusto 14/10, NO hacer todavía) — **Optimizar la ventana "Enviar Factura"** (Finanzas > Cobrar, sobre de cada factura):
           hoy muestra ~14 contactos del cliente como botones uno abajo del otro (Corteva) y el Asunto/Mensaje/botón Enviar quedan muy abajo.
           Propuesta: campo "Para" con varios destinatarios (chips) y autocompletar; arriba solo los 2-3 sugeridos (cliente/administración, creador del PR)
           y "Ver todos" para el resto; asunto y mensaje más bajos (mensaje plegable); botón Enviar siempre visible. Misma ventana para el envío masivo (5j).
        5l. NUEVO (Augusto 14/10, NO hacer todavía) — **Ganancia y margen en la lista de Presupuestos** + incentivar cerrar los de mayor ganancia
           (ej. ordenar/destacar por ganancia). **Regla de Augusto:** el descuento del 7 % (gastos e impuestos) es para PR FACTURADOS; para presupuestos
           MANUALES descontar el 2 % para ver el margen real. YA EXISTE en parte: la ventana del PR muestra "Margen neto" descontando
           `GASTOS_PORCENTAJE` = 7 % a TODOS (`presupuestos/page.tsx` ~4447): hay que aplicar 7 % solo a facturados y 2 % a manuales
           (confirmar qué es "manual": ¿PR sin factura emitida desde el CRM / facturado por afuera?). Además reordenar dónde se muestran los márgenes en la ventana del PR.
        5m. NUEVO (Augusto 14/10, NO hacer todavía) — **Optimizar "Seguimiento"** (botón en Presupuestos) y **optimizar el Dashboard**
           (pantallas compactas, que se vean todos los números, menos clics). Antes de tocar: mirar cómo están y proponer cambios a Augusto.
        5n. NUEVO (Augusto 14/10) — **Mariana S.A. (Pegaso): FC A 0012-00012760 + NC A 0010-00017374 contra OC-2026-1221** (PDF en Descargas, 13/10). NADA cargado todavía.
           FC: 28 botines Francés × $ 29.764 + 3 zapatos × $ 26.332 = neto $ 912.388 (total $ 1.103.989,48). NC: "descuentos concedidos" = 5 % exacto
           del neto ($ 45.619,40 + IVA = $ 55.199,47), obs. "fac 12-12760". OC-2026-1221: 30 botines × $ 26.862 + 5 zapatos × $ 25.015,40 (neto $ 930.937).
           Zapato: 26.332 × 0,95 = 25.015,40 = OC exacto. Botín: 29.764 × 0,95 = 28.275,80 (la OC tiene 26.862 = dos veces −5 %). Entrega parcial (faltan 2 botines y 2 zapatos).
           Problema del CRM: la conciliación compara precio de FC contra OC renglón por renglón y no sabe aplicar una NC de descuento global (%) a la factura.
           Mejora propuesta: si la NC es descuento % sobre una FC, comparar contra la OC con el precio neto de NC. Cargar hoy: por script con OK (como Segufer).
        6. Aviso BCRA en ficha de proveedor/OC; Finanzas: análisis a fondo (punto 0 de abajo, cobros con fecha futura, etc.).
      Aviso de modelos (Augusto lo pidió): Opus para diseñar j y el armado de presupuestos; Sonnet para programar; Haiku para cambios chicos.

0. **PRÓXIMO: análisis a fondo de Finanzas** (lo más importante del CRM, pedido por Augusto 11/10/2026):
   - Cobros con eCheq guardados con **fecha futura** y ya "Conciliado": DEL SOL CONSTRUCTORA (20/11/2026, cobro $3.677.887,22 + ret. Ganancias $61.813,23)
     y cheque Galicia / BARRAZA JESICA PAOLA (16/10/2026, $10.110.492,35). Sospecha: el cobro toma la fecha de pago del eCheq en vez de la de recepción.
     Revisar cómo se arma la fecha al registrar cobros con cheque/eCheq, el impacto en caja y cómo corregir los ya cargados (sin borrar, con OK de Augusto).
   - Buscar otras reglas o datos de la base que no estén en el repo, y revisar el resto de los circuitos de Finanzas (caja, conciliación, saldos).
   - **Avance 11/10/2026:** causa encontrada en el código: al leer la OP del cliente con IA (`cobro-masivo-liquidacion.tsx` + `lib/orden-pago-plan.ts`),
     la fecha del cobro sale de `fecha_cobro` del eCheq (su vencimiento). La retención toma la misma fecha.
     Consulta de solo lectura lista para Augusto: `crm/app/supabase/diagnostico/revisar_finanzas_cobros.sql` (falta el resultado).
     Otros hallazgos: las OP nacen "conciliadas"; la caja suma cheques en cartera, cheques propios diferidos y tarjeta como plata del día;
     OC "pagada con tarjeta" no genera ningún pago; borrar un cheque es borrado físico.
   - **Resultado del diagnóstico (CSV 11/10/2026):** solo 3 movimientos con fecha futura: DEL SOL cheque 3881 + ret. Ganancias (fecha 20/11, cargados 30/09)
     y Barraza cheque 00000131 (fecha 16/10, cargado 18/09). `registrar_cobro_masivo` (hecha a mano) graba `conciliado = true` fijo;
     todos los cobros y pagos están "conciliados" y ninguno tiene línea de extracto. `saldos_caja` vacía. Cheque 00000131 sin `origen_id`
     (rechazarlo no encontraría el cobro). Funciones de finanzas hechas a mano y fuera del repo: registrar_cobro, registrar_cobro_masivo,
     recalcular_saldo_cliente/_proveedor/_for_cliente, recalcular_extracto, get_balance_projection, get_dashboard_kpis.
     El botón "Rechazar" cheque solo aparece si está "en cartera": los de Barraza 00000074 y 00000176 están "depositado".
   - **Barraza (estafa):** una sola NC hecha en ARCA anula las 3 facturas (FA 15-10, 15-19, 15-30). Orden: 1) rechazar los eCheqs (anula el cobro), 2) cargar cada NC con "NC manual" (sin ARCA) guardando el CAE en observaciones. Faltan los PDF de las NC.
     El 3er eCheq NO se rechaza todavía (decisión de Augusto): se rechaza cuando aparezca en el extracto; su NC se carga recién ahí.
   - **Idea de Augusto (11/10/2026):** Finanzas como centro de todo, enlazado con los extractos que él carga día a día:
     cuentas corrientes, cajas de ahorro, FCI, tarjetas y efectivo. Un cobro con cheque "se cobra" cuando el cheque se acredita.
   - **Datos de Augusto (11/10/2026):** Lazzari opera con **BBVA** (cuenta + tarjetas BBVA Visa y BBVA Master).
     La Master hoy la usa también para gastos personales; la idea es que Visa y Master queden solo para trabajo y lo personal vaya a Galicia.
     Falta cargar: cobros recibidos que no están en el sistema, cheques emitidos viejos (pagos e impagos del sistema viejo), eCheqs recibidos sin actualizar.
     Respuestas 11/10/2026: fecha de corte = el día en que empezó a usar el sistema (sacarla de la base); solo Lazzari/BBVA en pesos
     (Grupo LA usa Galicia pero hoy sin acceso; ignorar USD); usan FCI. Después de cargar todo, Augusto reenvía las órdenes de pago de clientes de sus mails.
   - **Plan "Cuentas y extractos" propuesto (esperando OK):** ya existen `extractos_bancarios`/`extracto_movimientos` y un cruce manual por importe exacto
     (`lib/extracto-match.ts`), sin tabla de cuentas.
     1) Cuentas (migración): tabla de cuentas (cuenta corriente, caja de ahorro, FCI, tarjeta, efectivo) con saldo al corte; `cuenta_id` en movimientos y extractos.
        **OK de Augusto (11/10/2026), con estos ajustes:** pestaña "Cuentas" primera en Finanzas, en archivo propio; `lib/saldo-cuentas.ts` con prueba.
        Saldo al corte solo para BBVA, FCI y efectivo. Cuentas automáticas: "Cheques en cartera" y "Cheques emitidos a pagar"
        (eCheq/cheque propio: el pago al proveedor queda hecho, pero la plata sale del BBVA recién cuando se debita; mostrar lo comprometido por semana y mes).
        Tarjetas Visa/Master: sin saldo al corte, van por resumen mensual, en **ARS y USD** (dos saldos; el USD se paga en pesos o en dólares, se ve en etapa 3).
        Cuenta sugerida por medio para lo nuevo (trigger, nunca frena); lo viejo queda "sin cuenta" y se asigna en la etapa 2.
        Paso 1: `supabase/diagnostico/fecha_corte_lazzari.sql` (solo lectura). Resultado: cheques desde 22/08, presupuestos 26/08,
        OC 01/09, facturas y cobros/pagos cargados desde 02/09 (alguno con fecha 22/08). **Propuesta: corte = cierre del 31/08/2026**
        (saldo al corte = saldo del extracto al 31/08; entran los movimientos con fecha desde 01/09).
        **Cuentas reales BBVA (resúmenes al 09/10/2026 en Descargas, 11/10):** CC "EPP LAZZARI" 091-312483/1 (la principal, acuerdo $1.500.000,
        debita las tarjetas; hoy −$1.575.636,31; FALTA su extracto); CC "INDU LAZZARI" 091-318933/7 ($4.797,36, sin movimientos);
        CA $ 091-339549/3 (saldo anterior 88.411,83 al ~10/09; falta el saldo al 31/08); CA U$S ignorar;
        FCI FBA Money Market Pesos (custodia 91-565772/5): 551.950,26 cuotapartes al 31/08 (calculado con el Excel de custodia y cruzado con el resumen) ≈ $97,56 M;
        Visa Signature ·1582 y Mastercard Black ·4775: resúmenes con cierre 01/10, vto 09/10, en $ y U$S; la deuda al corte sale del "saldo anterior" (cierre 01/09):
        Visa $9.792.257,37 + U$S 148,82; Master $4.402.026,27 + U$S 4.389,17. Agregar campo "acuerdo" (descubierto) a la cuenta.
        Sumar también CA U$S 091-314103/6 (U$S 14,62; Augusto la quiere incluida). Efectivo: planilla "Cierre de caja" de Augusto, arranque 08/09 $33.520
        (usar como saldo al corte). En esa planilla, "Útil – Venta/Ingreso" es un negocio por afuera (ventas tercerizadas por la empresa Útil de Camila y
        Agustín Musso, el contador, que se queda un %): ignorarlo por ahora, armarlo más adelante si Augusto lo pide.
        **Saldos al 31/08 calculados de los Excel completos (Descargas, "Detalle_mov_cuenta_11_10_2026 (2)/(3).xls", cadena de saldos verificada):**
        CC EPP LAZZARI **$10.829.781,65**; CA $ **$300.440,53**. Con esto están todos los datos de la etapa 1.
        El 09/10 la CC pagó Visa $4.694.598,40 y Master $3.201.710,17 + $4.709.743,56 (los U$S). El 25/09 hubo extracción de efectivo de $6.200.000 de la CA
        que no está en la planilla de caja (preguntar en la etapa 2).
     2) Importar extracto BBVA y cruce automático; lo que no cruza se pregunta (cobro, pago, gasto bancario, impuesto, transferencia a FCI, cheque acreditado, personal).
        **Plan etapa 2 con OK de Augusto (11/10/2026):** subir el .xls del BBVA tal cual (cuenta por encabezado, desde 01/09, sin duplicar, control de saldos);
        cruce automático (PAGO CHEQUE por número, DEPOSITO CHEQUE = cobro acreditado, DEVUELTO avisa, cobros/pagos por importe y fecha, FCI/entre cuentas/tarjetas = pases);
        "Para revisar" con botones y "Recordar"; saldo real en Cuentas. **1a:** gastos e impuestos del banco quedan clasificados en el extracto
        con totales por mes (SIRCREB aparte), sin crear movimientos. **2:** la primera subida cruza todo desde 01/09 y asigna cuenta a lo viejo.
        Antes de programar: Augusto exporta los eCheqs de todas las categorías (para cruzar los 154 PAGO CHEQUE). Excel CC = Descargas "(3)", CA = "(2)" del 11/10.
        **Datos para la etapa 2 (11/10/2026):** eCheqs exportados en Descargas (11-10-2026-eCheqs-*.xls; el banco corta en 100 filas) + planilla "Cheques_Lazzari.xlsx"
        (hoja Emitidos: 1.710 cheques desde 2022 con fecha de débito). Con eso cruzan 156 de 161 PAGO CHEQUE desde 01/09; faltan 5 de chequera física (00496361/63/64/65/66) → cruzar por importe con pagos.
        Depósito 06/10 $1.000.000 = cheque 14588139 de Alesso (efectivo prestado a un amigo): pase personal, su salida es la Transferencia inmediata del 01/10 de $1.000.000.
        **Martín Fernández:** cheques que emite Lazzari pero cubre él (hoja "Martín Fernández", 15; 6 pendientes por $15.515.936, próximo 22/10).
        Cuentan en el comprometido, pero con lista aparte con fechas para avisarle.
        Cheque acreditado en el extracto = cobro acreditado (idea de Augusto).
     3) Tarjetas Visa y Master: resumen, consumos a proveedor/gasto/"personal", pago del resumen desde la cuenta.
        **Mercado Libre (aclarado por Augusto):** todo lo de ML se paga con la Visa. Las OC se cargan con proveedor "Mercado Libre";
        a fin de mes se suben todas las facturas de ML, cada una se ata a su OC y pasa al vendedor real (dejando marcado que la compra fue por ML),
        queda pagada con tarjeta Visa (sin OP) y se cruza con el resumen de la Visa y su pago en el extracto. Ojo con compras en cuotas.
        Sugerencia: anotar el N° de compra de ML en la OC al comprar (ayuda mucho al cruce).
     4) Puesta al día: cruce del listado de eCheqs del BBVA (✅ coinciden / ➕ faltan / ✏️ estado distinto) y OP de clientes por mail.
0b. **(HECHO 14/10/2026, sin publicar, sin subir versión: solo tests)** Los 6 tests viejos ya pasan (`financial-ledger-ui`, `op-echeqs`, `op-money-rounding`, `op-validation`, `pr-pagination-and-op-duplicates`, `purchase-credit-note`).
   No faltaba ninguna función: cambiaron textos y lugares (pestañas Recibos/Vencimientos en `lib/finanzas-grupos.ts`, reporte de NC en `lib/reportes-comprobantes.ts`, formulario de proveedor en `components/proveedor-form-modal.tsx`,
   NC de compra con `registrar_nota_credito_compra_v2` y factura origen sugerida pero no obligatoria, OP con facturas en USD, pago parcial). Los botones Caja/Balance ya no existen (se sacaron el 12/10): el test ahora verifica que no estén.
1. **A5 Retención RG 830:** mínimo y escala por concepto (bienes, servicios, honorarios), unificar 224.000 vs 400.000 y no "congelar" en el Plan de pagos. Comparar con el archivo de Netegia que va a pasar Augusto y confirmar montos con el contador.
   **Respuestas del contador (13/10/2026):** valores del Anexo VIII (RG 4525) vigentes: bienes cód. 78 = 2 % y mínimo $224.000; servicios cód. 94 = 2 % y mínimo $67.170;
   transporte de carga cód. 95 = 0,25 % y $67.170; honorarios cód. 116 = escala y $67.170; no inscriptos: 10 % bienes, 25 %/28 % servicios, sin mínimo. Retención mínima $240 vigente.
   No hay padrón de ARCA que consultar (la RG 830 no cambió; si cambia, ARCA lo publica). Cálculo sobre acumulado mensual menos lo ya retenido: correcto. **Conviene separar por concepto.**
   Solo **Lazzari** retiene (Grupo LA no; `retencion_config` ya lo tiene en aplica=false). HECHO sin publicar: el valor de respaldo 400.000 pasó a 224.000 (plan-pagos.ts, plan-pagos.tsx, configuracion, finanzas).
   **A5 HECHO en código (13/10), SIN PUBLICAR, sin subir versión:** `lib/retencion-conceptos.ts` (bienes 2 % / $224.000 de la config; servicios 2 % / $67.170; transporte y fletes 0,25 % / $67.170;
   honorarios por escala / $67.170; sin concepto = bienes; otros conceptos siguen como antes). Usado en Plan de pagos (`lib/plan-pagos.ts`) y en la Orden de pago de Finanzas. No inscriptos no se retienen.
   Prueba: `scripts/test-retencion-conceptos.ts`. tsc 0, hooks OK. Sin migración (el campo `concepto_retencion_ganancias` ya existía).
   **Pendiente (lo corre Augusto en el SQL Editor):** poner concepto `transporte` a Conte, Illia, Speed Business, Transporte de Cargas Mayo, Transporte Hero y Cruz del Sur (12 filas, 2 sociedades).
   **SICORE (13/10):** el aplicativo v9.0 r24 rechazaba el TXT ("las longitudes de los registros no son todas iguales"). El CRM generaba 165 caracteres; el diseño "Estándar Retenciones Versión 9.0" es de 198 (21 campos).
   Corregido en `lib/sicore-linea.ts` + `api/sicore/route.ts` (prueba `scripts/test-sicore-linea.ts`); además códigos de régimen: transporte/fletes 095 (estaba 078), alquileres 030/031 (estaba 027).
  **13/10 (después de V1.1.430):** el contador dijo que el archivo estaba mal y mandó uno que SICORE acepta (`Downloads\cpsicore.txt`). Ajustado al suyo, SIN PUBLICAR:
  nro de comprobante = 3 espacios + 13 dígitos; impuesto " 217"; régimen sin cero adelante (" 78", " 94", " 95"); suspendidos en blanco; fecha de boletín en blanco;
  CUIT país y CUIT ordenante en ceros; cada línea termina en CRLF. Las 16 líneas del contador se regeneran idénticas. tsc 0. Falta publicar y que el contador lo importe.
  Transportistas: las 12 fichas ya tenían concepto "transporte" (verificado 13/10).
2. **Diagnóstico sin tocar:** D1 (cron cotización BNA: **revisado 14/10/2026, el código está bien**: corre lun a vie 11:00 y 18:00, no pisa cotizaciones manuales, usa fuente verificada del BNA y responde 500 si falla una escritura; falta solo mirar en Vercel > Logs que haya corrido estos días), D4 (saldo inicial de caja automático), D5 (cuentas bancarias), D6 (errores sin revisar en Plan de pagos y Finanzas), sección E.
3. **Cheque vs echeq:** unificar en "Cheque" Físico / Electrónico en todas las pantallas y reglas claras para la IA. Falta un ejemplo de Augusto.
4. **Importar cheques** desde 01/01/2026: `ideas/cheques_desde_2026.csv` (695 cheques; 5 con año "2925" a corregir; los 15 de Martín Fernández aparte).
   **14/10/2026: SCRIPT LISTO, NO CARGADO.** `scripts/db/importar-cheques-2026.cjs` (por defecto simula y deshace; solo guarda con `--aplicar`) + vuelta atrás `supabase/operaciones/20261014_importar_cheques_2026_vuelta_atras.sql` + comparador de solo lectura `scripts/lectura/cheques-2026-comparar.cjs`.
   Resultado de la simulación (Lazzari): 360 de 695 ya están; **faltan 334 ($231.865.366,24)** = 331 emitidos "cobrado" (ene–sep, anteriores al corte del extracto) + 3 recibidos (Del Sol 3414 depositado, 3587 y 211 endosados a Bruno Francione). Quedan 375 → 709. Fechas "2025" corregidas a 2026 (13, todas en fecha de débito; van en observaciones).
   Salteado a propósito: recibido 14588139 (Alesso $1.000.000) = plata personal, no cheque. Diferencias que NO toca (para decidir): emitido 496366 CSV "pendiente" / base "cobrado"; recibidos 00000176 y 00000074 con fecha de pago un día distinta (CSV 02/10 y 06/10, base 01/10 y 05/10); en la base el emitido 90017380 está duplicado.
5. **"Para revisar"** (idea 8): mandar OC, clientes y proveedores a la Papelera; lleva migración. Incluye borrar OC con facturas vinculadas.
   **14/10/2026: propuesta escrita en `docs/PROPUESTA-PAPELERA-14-10-2026.md`, ESPERANDO el OK de Augusto (no se tocó código ni base).**
6. **(HECHO en V1.1.440, según el commit)** **Lista de costos dentro de Proveedores** (idea 9): fotos (`recursos/fotos_costos.zip`), rubro, marca y reglas por proveedor.
7. **Comisiones** (idea 1) y **Torneo** (idea 7): faltan respuestas de Augusto.
8. **Archivo BBVA Net Cash:** falta el formato del banco (el botón ya está, desactivado).
9a. **(HECHO y PUBLICADO 14/10/2026, V1.1.442, commit 98c866e, sin migración)** **Descuento visible en el PDF del presupuesto:** cada renglón con descuento muestra "Precio de lista $X · Descuento Y%" (en Factura B, la lista con IVA) y al pie "Incluye descuento general del Z%". Sin descuento, el PDF queda igual que antes (PR viejos sin `precio_lista` tampoco cambian). Archivos: `lib/pdf-templates.ts`, `lib/types.ts`, `presupuestos/page.tsx` (las dos llamadas al PDF). Prueba: `scripts/test-pdf-descuento.ts`. **Filtro por moneda en facturas de venta:** desplegable "Todas las monedas / Pesos / Dólares" en Facturación (`facturacion-content.tsx`), cuenta en "X de Y". tsc 0 errores, hooks OK. Probado en producción con sesión 14/10: filtro y PDF OK.
9. Otros: propuestas de `PROPUESTA-REPORTES-DASHBOARD.md`, centro de alertas unificado, descuento visible en el PDF del presupuesto, filtro por moneda en facturas de venta, revisar migraciones viejas de Manu.
10. **Seguridad:** rotar la clave de Anthropic y activar MFA en Supabase y Vercel.

## 5. Archivos que no están en git (a propósito)

- `ideas/cheques_desde_2026.csv`: datos de cheques reales.
- `recursos/fotos_costos.zip`: 9 MB de fotos.
- `Claude outputs/`: copias de la migración de V1.1.410 (ya está en `crm/app/supabase/migrations`).
