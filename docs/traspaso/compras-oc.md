# Traspaso: Compras (Compras Lazza + Compras nueva)

29/10/2026: pantallas viejas borradas (V1.1.617) y Llegó / Editar OC todo junto (V1.1.618, migraciones corridas). 27/10/2026: última de Compras V1.1.591 (sin saldo a favor en Cargar factura). 26/10/2026: revisado en la base. Actualizado el 26/10/2026 para seguir desde otra cuenta sin el historial del chat. Producción va por V1.1.559 o más (la última de Compras es la V1.1.559, commit a02069f).

## 29/10: Compras nueva, Compras (vieja) e Importaciones BORRADAS (PUBLICADO en V1.1.617)
- Detalle en docs/ESTADO.md (entrada "COMPRAS — PANTALLAS VIEJAS BORRADAS"). Las 3 direcciones redirigen a /compras-lazza; se borraron la carga masiva vieja, cargar-factura-oc y demás ventanas sin uso, y las rutas api/compras/* y api/conciliar-compra. Personalización queda (oculta). Publicado desde una copia limpia de origin/main (worktree detached en el scratchpad, ya borrado).

## 29/10: Tanda 5 (H11, H48): Llegó y Editar OC todo junto (PUBLICADO en V1.1.618; migraciones CORRIDAS 29/10)
- Detalle en docs/ESTADO.md ("COMPRAS — TANDA 5, H11 y H48"). Migraciones `20261029170000_llegada_oc_atomica` y `20261029171000_guardar_oc_lazza` (con rollback y prueba en scripts/db/pruebas; `--probar` OK). Pantallas `compras-lazza-llego.tsx` y `compras-lazza-oc.tsx` con respaldo: sin migración guardan como antes.
- Publicado desde una copia limpia de origin/main (ya borrada).
- Falta: Personalización (liquidar en una sola transacción) solo si Augusto decide que la pantalla sigue.

## 27/10: sin "Aplicar saldo a favor" en Cargar factura (PUBLICADO en V1.1.591, commit 492b4c8, Vercel Ready)
- Augusto: la ventana es solo para cargar facturas. Se sacó la casilla de `components/compras-lazza-factura.tsx`, junto con todo lo que la acompañaba. El saldo a favor va en la cuenta corriente y al pagar: se lo pasé al chat Agente de IA de Finanzas (lo hace y publica él). tsc 0, hooks OK. Publicado solo ese archivo + versión, con una copia del script en una carpeta nueva (`lz-pub-compras3`, ya borrada). No se probó en pantalla: la primera vez, que Augusto mire que no aparezca la casilla verde.

## 26/10: revisión en la base (solo lectura, chat Compras retomado en la cuenta nueva)
- Desde el 23/10 se cargaron 10 facturas con Compras Lazza (todas Lazzari): Nadia FC C 0001-31 (IVA 0, bien), Prisina 0005-5801 y 5802, **Silvana María García "SIN FACTURA 23/10/2026"** (FC Manual, IVA 0, sin PDF: la carga a mano sin factura anda guardando), Comisiones Serger 0004-26653, De Pascale 0021-14764 (con percepciones), TKW 00002-37329/37330/37331 y Segufer 00042-103951 (en USD, US$ 479,94). Las otras 9 tienen PDF: subir un PDF real anda. No se puede saber desde la base si se usó "Leer con IA".
- Detalle (no se tocó): `condicion_pago` y `dias_pago` siguen quedando vacíos; el eCheq/transferencia y los días van solo en las notas.
- **Cambio de proveedor por artículo: anduvo en muchos casos el 19-20/10**, también el de OC vieja vacía → `cancelada` ("Vacía: sus renglones pasaron a …": OC-2026-1256 → Segufer, OC-2026-1193 → Mastroianni). Próximos pasos 1: cerrado.
- Falta preguntarle a Augusto: si usaron "Leer con IA" y si algo no le gustó.

## Lo nuevo del 22-23/10 (TODO PUBLICADO; nada pendiente de publicar de Compras)
- **Facturas de compra mal cargadas (22/10)**: se comparó cada factura con su PDF. Corregidas en la base: Nornes 0004-00026223 ($638.713,45), Sanitarios San Martín 0007-00024709 ($804.129,86) y Mollon 0003-00017481 (IVA 21 %, $73.810). Migraciones **corridas** y subidas al repo en la V1.1.557: `20261022120000_corregir_importes_facturas_compra`, `20261022130000_ajuste_pagos_nornes_sanitarios`, `20261022140000_sanitarios_devolucion` (con rollback). No se tocó ninguna OP pagada. Nornes se pagó con OP-000082; Sanitarios devolvió $216.913,48 y su cuenta quedó en 0 (los $994,31 de diferencia no se cargaron, decisión de Augusto). Augusto no cambia nada con el contador (retenciones de ganancias: Sanitarios +$3.628,89, Nornes −$251,25 aprox.). Fujiwara 0002-00002816 verificada: bien. Quedan sin verificar 4 facturas sin PDF (2 SIN FACTURA, Mediglove, Grupo Turbión) y las anteriores al 15/09 sin PDF.
- **V1.1.557 / V1.1.558 / V1.1.559 (Compras Lazza → Cargar factura)**: `components/compras-lazza-factura.tsx`. Ahora **Cargar factura abre directo una ventana de renglones** (código, descripción, cantidad, precio unitario, dto %, IVA % por renglón; neto, IVA, percepciones y total armados solos y editables). Arriba: **Subir factura (PDF o foto)** (lo lee el sistema: QR/texto; completa proveedor por CUIT, tipo, número, fecha y totales; sin renglones deja uno con el neto) y **Leer con IA** (trae también los renglones; deshabilitado sin archivo). Tipo **Sin factura (manual)** para proveedores que no facturan (tipo_comprobante `FC Manual`, número `SIN FACTURA dd/mm/aaaa` con (2), (3) si se repite, IVA 0; mismo formato que las 2 del 30/09). Se sacó la pantalla vieja de subir archivo. Del pago para abajo igual que antes (Pagos/Visa/saldo a favor, nota para Finanzas, NC sin pago).
- **Factura C sin IVA (V1.1.559)**: la FC C de Nadia Martínez entró con IVA 21 % porque el QR trae solo el total y `facturaDesdeDatos` suponía 21 % (neto = total/1,21). Arreglo: FC C y NC C → IVA 0 (`lib/factura-compra-leida.ts`, `ivaYPercepciones` con 0 % en `lib/compras-lazza.ts`, tipo C y Sin factura sin IVA en la ventana con aviso), y `api/parse-factura-compra` le dice a la IA que la C no discrimina IVA. Prueba en `scripts/test-compras-lazza.ts`. Informe en `docs/traspaso/informe-compras-factura-c-nadia.md`.
- **Probado en producción sin guardar**: abre directo, FC C → IVA 0, Sin factura sin IVA, sacar/agregar renglones. **NO probado**: subir un PDF real (el navegador de la app no sube archivos), Leer con IA, ni guardar una carga a mano. La primera vez, hacerlo con Augusto.
- **Sin publicar de Compras**: solo docs sin commitear (`docs/ESTADO.md`, `docs/GUIA-USO.md` con la línea de Cargar a mano) y `lib/asistente-guia-datos.ts` sin regenerar (tiene cambios de otro chat): el chat que publique la guía corre `node scripts/guia-a-ts.mjs`.
- Reglas de Augusto: publicar solo mis archivos con `scripts/publicar-limpio.sh` (ver ⚠️ más abajo); no inventar: lo ambiguo se pregunta; si el navegador de la app no tiene sesión, Augusto inicia sesión él (yo no cargo contraseñas).


## Publicado
- **V1.1.506 / V1.1.512**: Compras nueva → pestaña OC (`components/compras-lista-oc.tsx`, `lib/oc-lista.ts`) y "Cargar factura" con cruce por renglón (`components/cargar-factura-simple.tsx`, `lib/cargar-factura.ts`). Sigue andando igual.
- **V1.1.516 (commit e6aa50b, verificada en producción): Compras Lazza**, pantalla aparte `/compras-lazza`. En el menú solo la ven los que tienen la casilla "Prueba: Compras nueva". Augusto la pidió MUY simple y permisiva: es para que los chicos carguen las facturas y saber más o menos cuánto se gasta por PR.
  - **Lista de OC**: la misma de Compras nueva (`compras-lista-oc.tsx` con la opción `lazza`) + 📋 Copiar para WhatsApp + botón **Llegó** en cada OC + marca 👁 **Observar** (clic → nota + "Ya está bien") + filtro Observar. Las OC se arman solas al aprobar el PR, como siempre.
  - **Llegó** (`components/compras-lazza-llego.tsx`): [Completo] o [Parcial] por artículo (arranca en lo que falta); "Corregir cantidades" si se marcó de más. Solo guarda `cantidad_recibida` y el estado. NO hace remito de recepción y NO avisa al vendedor (Augusto: no).
  - **Cargar factura** (`components/compras-lazza-factura.tsx`, cálculos en `lib/compras-lazza.ts`, prueba `scripts/test-compras-lazza.ts`):
    - La lee el SISTEMA (QR de ARCA o texto, sin IA). "Leer artículos con IA" es opcional.
    - Proveedor por CUIT. Muestra sus OC con detalle, más [OC sin proveedor] y [OC de otros proveedores] (pregunta "¿seguro?" y si pasa toda la OC o solo algunos artículos).
    - El envío / logística siempre se suma a la OC (con varias, repartido por plata).
    - Compara el neto (sin envío) contra las OC; hasta ±1 % coincide.
    - **Factura parcial**: si en la OC llegó algo sin facturar, se ata y se compara solo contra eso; el resto queda abierto para la próxima factura.
    - No coincide con 1 OC: [Sumar la diferencia a la OC] / [Pasar igual → Observar]. Con varias OC: diferencia sin definir → Observar. Más de 5 %: aviso + "Dejar algo anotado".
    - El precio de un artículo se actualiza (OC y PR) solo si es seguro: mismo código, mismo nombre + talle o parecido ≥ 90, y único.
    - Pago como antes: Pagos o Visa. Si va a Pagos: "Para Pagos" [Transferencia] [eCheq] a __ días + nota → va como primera línea de las notas de la factura.
    - Si al proveedor le falta el email o el CBU/alias, lo recuerda y deja guardarlo en el proveedor.
    - Guarda con `guardar_conciliacion_compra` (sin equivalencias).
  - **Migración** `supabase/migrations/20261016200000_compras_lazza_observar.sql` (columnas `observar` y `observar_nota` en `facturas_compra` y `ordenes_compra`; vuelta atrás en `supabase/rollback/`). **Ya corrida por Augusto y verificada.**
  - `lib/oc-sin-proveedor.ts`: `asignarRenglonesAProveedor` tiene la opción `conRecibido`.

## Publicado en V1.1.519 (17/10, commit da11dd2, verificado en producción; sin migración)
- Columna **Factura** de Compras Lazza: **"+"** siempre (también en OC ya facturadas: una OC puede tener varias facturas). Abre Cargar factura "de la OC-…" con esa OC ya tildada; si es de otro proveedor o sin proveedor, pregunta "¿seguro?". Si ya estaba facturada entera, la trae igual y ofrece [Sumar a la OC] / [Pasar igual]. Si no queda ningún renglón, se ata con un renglón en $0.
- **✔ / ½** abre las facturas de la OC (`components/compras-lazza-facturas-oc.tsx`) con **"Sacar"** (cargada por error):
  - la factura queda ANULADA con `anular_factura_compra` (solo administración);
  - se borran los renglones de envío/diferencia que esa factura sumó;
  - los costos que cambió vuelven al anterior en la OC y en el PR (`costoPrAnterior`; solo si nadie los cambió después; queda nota en el PR);
  - se recalcula facturada / en parte;
  - si estaba pagada o con OP: avisa y pregunta.
  - NUNCA se confirmó un "Sacar" real: la primera vez, mirarlo con Augusto.
- Archivos: `crm/app/src/components/compras-lista-oc.tsx`, `crm/app/src/app/(crm)/compras-lazza/page.tsx`, `crm/app/src/components/compras-lazza-factura.tsx`, `crm/app/src/components/compras-lazza-facturas-oc.tsx` (nuevo), `crm/app/src/lib/compras-lazza.ts`, `crm/app/scripts/test-compras-lazza.ts`.

## Publicado en V1.1.521 (17/10; prueba, tsc 0 y hooks OK)
- Cargar factura de Compras Lazza → "Para Pagos": al elegir los días, el **vencimiento de la factura = fecha de la factura + esos días** (ej. FC del 16/10 "a 60 días" → 15/12) y al lado de los días se ve "vence dd/mm". Sin días queda el vencimiento que trae la factura; con Visa no cambia. Función `vencimientoPorDias` en `lib/compras-lazza.ts` (con prueba en `scripts/test-compras-lazza.ts`), usada en `components/compras-lazza-factura.tsx`.
- Primeras facturas reales para revisar: Segutécnica 0014-73759 ($612.956,25 → OC-2026-1241, OC en USD: no compara) y 0014-73760 ($1.267.750 → OC-2026-1246, +3,4 % por talles grandes 48-56; 13 pantalones OMBÚ). Pago transferencia a 60 días.

## Publicado en V1.1.522 (17/10)
- **Arreglo "numeric field overflow"** al guardar una factura en pesos contra una OC en dólares (FC Segutécnica 0014-73759 → OC-2026-1241 / PR-1247, costos en US$): `guardar_conciliacion_compra` tomaba el precio de la OC (US$ 0,23) como pesos y el margen del PR daba 230.000 % (columna numeric(5,2)). Ahora, con OC en otra moneda, `p_aceptar_costos = false` (no toca costos de OC ni PR) y el envío solo se suma a OC de la misma moneda (si no hay, queda anotado en la factura). Pendiente de fondo: que la función use la moneda de la OC (migración), para que también actualice el costo del PR en esos casos.
- Encabezado de Cargar factura: muestra **neto + IVA** (pedido de Augusto) y, en chico, "+ percep. … = total …".
- FC 0014-73760 (OC-2026-1246) se guardó el 17/10 21:47 con la versión vieja en pantalla: quedó sin vencimiento: corregido el 18/10 a 15/12/2026 con `supabase/migrations/20261018090000_datos_segutecnica.sql` (también puso el CBU de Segutécnica 0170486420000000018344, Banco Francés, en Lazzari y Grupo LA; vuelta atrás en `supabase/rollback/`; sin commitear: subirlo con la próxima tanda). Falta cargar la 0014-73759 (OC-2026-1241); en PR-1247 el protector auditivo se vende a $529,58 y cuesta $918 (y vino el 1110 con cordón).

## Revisión 18/10 (solo lectura)
- FC 0014-73759 **todavía NO está cargada** (no hay ninguna factura con ese número). OC-2026-1241 (USD 342,31, PR-2026-1247): recibida completa, sin facturar, pago pendiente. Neto de la FC ≈ $506.575 → equivale a ~$1.480 por dólar: razonable.
- FC 0014-73760 / OC-2026-1246: OK (facturada, venc. 15/12, PDF, nota de diferencia 3,42 %). Ojo: en las notas dice "eCheq a 60 días", pero `condicion_pago` y `dias_pago` quedaron vacíos (el traspaso decía transferencia).
- Al cargar la 73759: como la OC es en USD, NO va a actualizar el costo del PR-1247 (arreglo de V1.1.522). El protector auditivo (cuesta $918, se vende a $529,58) hay que mirarlo a mano con Augusto.
- Ocultar del menú: es poner `oculto: true` en `src/components/layout/sidebar.tsx` (siguen andando por link). Ojo: "Compras Lazza" usa el permiso `compras_nueva`; si se oculta "Compras" antes de darle esa casilla a todos los que compran, se quedan sin ninguna entrada de Compras.

## Publicado en V1.1.523 (18/10, commit 7b33756, verificada en producción): Cargar factura simple + Compras nueva fuera del menú
- Augusto: "solo quiero que le carguen la factura a la OC y listo… la coincidencia no me interesa". En `components/compras-lazza-factura.tsx`:
  - Se sacó la comparación entera (neto, envío, Coincide/Diferencia, Sumar la diferencia, aviso 5 %, Observar automático) y el botón "Leer artículos con IA" (queda "Leer con IA" solo si el sistema no la puede leer).
  - Guarda con `p_aceptar_costos: false` y las asignaciones a precio de OC: **no toca ningún costo** (ni OC ni PR). La OC queda facturada / en parte. Si la OC ya no tiene nada pendiente, se ata con un renglón en $0 (como antes).
  - Pago igual (Pagos: transferencia/eCheq a __ días con vencimiento; o Visa). Email del proveedor si falta (siempre); CBU/alias si falta y va a Pagos.
  - **"Nota para Finanzas (opcional)"** siempre visible: queda en las notas de la factura ("Nota para Finanzas: …").
  - La marca 👁 Observar manual de la lista de OC sigue.
- `components/layout/sidebar.tsx`: "Compras nueva" con `oculto: true` (sigue andando por link `/compras-nueva`).
- El plan del dólar (pasar FC en pesos a OC en USD) quedó DESCARTADO: ya no se actualizan costos desde Compras Lazza. Sin migración.
- **Factura sin OC**: se carga igual; el cartel dice "Sin OC: la factura va directo a la cuenta corriente de …". Varias OC: se tildan todas.
- **NC sin OC** (Augusto 18/10: "todo va directo a la cc del proveedor"): si el comprobante es nota de crédito (`tipoNotaCredito` en `lib/compras-lazza.ts`, con prueba), no muestra OC ni forma de pago; guarda con `registrar_nota_credito_compra_v2` (la misma de Finanzas) sin aplicar a ninguna factura → queda como crédito del proveedor (estado `recibida`), con la "Nota para Finanzas" y el PDF. La nota de débito sigue sin cargarse acá.
- tsc 0, hooks OK, `scripts/test-compras-lazza.ts` OK. Probado en local SIN guardar con el PDF de la FC 0014-73759: se lee, aparece OC-2026-1241, sin comparación, nota para Finanzas, vence 15/12. La NC no se probó con un PDF real (no había ninguno a mano).

## 18/10: FC 0014-73759 cargada + arreglo IVA/percepciones (publicado en V1.1.524, commit 79ebbfa, verificado en producción)
- Cargada por Claude el 18/10 14:05 (OK de Augusto) desde el CRM local con V1.1.523 (producción no deja tomar el PDF de la compu): OC-2026-1241 facturada, transferencia a 60 días, vence 15/12, PDF guardado, costos del PR-1247 sin cambios.
- Error encontrado: el QR solo trae el total y la pantalla hacía IVA = total − neto → la percepción de IIBB (4 %) quedaba sumada al IVA (73759 y 73760).
- Programa: `ivaYPercepciones` en `lib/compras-lazza.ts` (con prueba): IVA = neto × alícuota y lo que sobra son percepciones (en el encabezado: "+ percep. (calculada)"); si sobra de menos (10,5 %) queda como antes. Usada en `compras-lazza-factura.tsx` (FC y NC).
- Datos: `supabase/migrations/20261018150000_iva_percepciones_segutecnica.sql` (vuelta atrás en `supabase/rollback/`): 73759 IVA 102.976,65 + perc. 19.614,60; 73760 IVA 212.982 + perc. 40.568. El total no cambia. **Corrida por Augusto el 18/10 y verificada.**

## 18/10: Abrir y editar la OC desde Compras Lazza (publicado en V1.1.525, commit 76a6c5f)
- El número de la OC en la lista abre `components/compras-lazza-oc.tsx`. Se edita: proveedor (Cambiar → buscador), entrega estimada, observaciones, renglones (código, descripción, cantidad, precio; agregar/sacar). Lo llegado se muestra, no se edita (eso es "Llegó").
- Guardar recalcula totales (PR manual = sin IVA) y el estado por lo llegado. Proveedor nuevo → renglones de la OC y del PR de origen (A). Costo cambiado → PR si es la misma moneda (B). `renglonesPrDeOc` y `totalesOc` en `lib/compras-lazza.ts` (con prueba).
- Avisos (no traba): OC con factura cargada (la factura no cambia de proveedor), sacar un renglón que ya llegó.
- Probado en local sin guardar y en producción solo abrir (OC-2026-1260, sin guardar). Falta: primera edición real con Augusto (mirar la OC y el PR después).

## 19/10: PLAN ACORDADO con Augusto: PUBLICADO en V1.1.533 (19/10, commit 45ee155, verificado en producción sin guardar; migración 20261019180000 CORRIDA y verificada). Todo en Compras Lazza
Cómo quedó (diferencias con el plan):
- 6: NO se tocó `presupuestos/page.tsx`. La moneda del renglón sale de `orden_compra_items.moneda`; si está vacía, del `costo_moneda` del renglón del PR (por `presupuesto_item_id`, que ya se guarda al aprobar); si no, de la OC (`monedaRenglonOc`). La migración agrega la columna y la llena desde el PR. Sin migración la pantalla anda igual (la moneda se ve y pasa al PR, pero no queda guardada en la OC).
- 8: se reusa `asignarRenglonesAProveedor` (OC SIN PEDIR del proveedor nuevo, mismo PR y misma moneda de OC; si no hay, OC nueva; la vacía queda `cancelada`). Confirmación con la lista de artículos antes de guardar. Solo artículos que ya estaban (los nuevos van con el proveedor de la OC).
- El total de la OC se sigue guardando en la base (otras pantallas), no se muestra.
- La columna Factura y Pago solo se sacó en Compras Lazza; Compras nueva queda igual. `compras-lazza-facturas-oc.tsx` ya no se usa (no se borró).
- Probado en local SIN guardar: lista (Op/Ven, Completo en verde, 55 en curso / 108 terminadas), OC-2026-1250 (moneda por artículo, Cambiar proveedor de un artículo → "pasa a otro proveedor"), Cargar factura abre. NO probado: leer una factura real, guardar.
Plan original:
Idea: las OC quedan independientes de las facturas de compra; la OC solo controla que llegó todo. Regla: NUNCA INVENTAR (lo que no se habló, queda igual).
**Lista de OC** (`components/compras-lista-oc.tsx` con `lazza`, `lib/oc-lista.ts`)
1. Sacar columnas Factura y Pago (y el "+").
2. "Terminada" = llegó todo (sin factura ni pago).
3. Columna Llegó: cuando llegó todo, el botón dice "Completo" (verde) y se puede seguir tocando para corregir; si no, como hoy.
4. "Persona" → "Op/Ven": iniciales del operador (gris, `presupuestos.created_by`) y del vendedor (naranja, `vendedor_id`), como en Presupuestos; si es la misma persona, una sola vez; OC sin PR → solo quien creó la OC. Filtro de personas busca por los dos.
5. Copiar pedido (`textoCopiarOC`): solo "Pedido:" + cantidad × artículo. Sin proveedor, sin número de OC ni pedido de poner la OC en remito/factura. Nada de PDF.
**La OC** (`components/compras-lazza-oc.tsx`)
6. Moneda por artículo, sin subtotal/IVA/total a la vista. Migración aditiva: columna `orden_compra_items.moneda` (null = la de la OC; con rollback). Al aprobar el PR (`presupuestos/page.tsx`, ~1849/1980/2047/2105) cada renglón copia `costo_moneda` del PR. ⚠️ presupuestos/page.tsx tiene cambios de otro chat sin publicar: publicar solo nuestra parte. El total en la base queda (otras pantallas lo leen); Augusto: "sacalo igual" (no mostrarlo).
7. Precio editado en la OC → PR, con su moneda (usar `presupuesto_item_id` si está; si no, `renglonesPrDeOc`).
8. Proveedor: de toda la OC ("Cambiar" de arriba, queda como está) Y por artículo. Al guardar, el renglón pasa a una OC abierta del nuevo proveedor del mismo PR o a una OC nueva; si la vieja queda vacía se anula (no se borra). ANTES de guardar se muestra qué va a pasar y lo confirma la persona (nunca asignar solo). El proveedor cambia en el PR. Si el renglón ya tenía llegado: aviso, no traba.
**Cargar factura** (`components/compras-lazza-factura.tsx`)
9. Ya no se elige OC: siempre a la cc del proveedor (camino "Sin OC" que ya existe). Lo ya vinculado no se toca. NC ya funciona (falta probar con una real).
10. Mientras busca el proveedor por CUIT: "Buscando proveedor…" (hoy sale un instante el cartel falso "no está cargado").
11. Mostrar tipo y número, neto, IVA, percepciones y total. Artículos solo si se leyó con IA; si no: "Para ver los artículos, tocá Leer con IA" (opcional).
12. "¿Cómo se paga?" arranca sin ninguna marcada; para guardar hay que elegir "Va a Pagos" o "Ya pagada con Visa" (si no, la pregunta en rojo "Elegí cómo se paga").
Al final: prueba en `scripts/test-compras-lazza.ts` (texto copiado, OC destino del renglón), tsc, hooks, local SIN guardar, ESTADO.md. No publicar hasta que Augusto lo pida.

## 19/10: Estado Por enviar ⇄ Enviada con un clic (PUBLICADO en V1.1.535, commit bb88840, Vercel Ready; sin migración)
- Augusto: "En el estado por enviar o enviada dejame que lo actualice yo con un click. Y ponele la fecha de la cual lo pedí."
- `components/compras-lista-oc.tsx` (solo con `lazza`): el cartel del Estado es un botón cuando está en "Por enviar" o "Enviada". Clic en Por enviar → Enviada con la fecha de hoy (`pedido`, `pedido_at`, `pedido_via: "manual"` y `pedido_por`, los mismos campos de "Enviar al proveedor"). Clic en Enviada → vuelve a Por enviar y borra la fecha. "Enviada" muestra la fecha (ej. "Enviada 19/10/2026"). Parcial y Completo no cambian. Compras nueva queda igual.
- tsc 0, hooks OK. NO probado en pantalla (local y producción piden iniciar sesión): la primera vez, que Augusto mire que el clic cambia el estado y aparece la fecha.

## 19/10: "Por pedir" / "Pedido", fecha editable y sin Observar (PUBLICADO en V1.1.542)
- Augusto: "En la columna enviado cambialo por pedido y dejame editar la fecha en que se pidió" (y "Por enviar" → "Por pedir"). Después: "Hay que sacar el observar".
- `components/compras-lista-oc.tsx` (solo con `lazza`): `ESTADO_LAZZA_LABEL` → "Por pedir" / "Pedido" (estado, filtro y avisos). Lápiz ✏️ al lado de "Pedido dd/mm/aaaa": calendario (hasta hoy); al elegir el día guarda `pedido_at` = ese día 12:00 de Argentina. Esc o salir sin elegir no cambia nada.
- Observar fuera de Compras Lazza: sin cartel 👁, sin filtro "Observar" y sin la ventana "Ya está bien" (`app/(crm)/compras-lazza/page.tsx`). Las columnas `observar`/`observar_nota` quedan en la base (no se borra nada).
- tsc 0, hooks OK. NO probado en pantalla (el local pide iniciar sesión): la primera vez, mirar con Augusto que el lápiz cambie la fecha.

## 19-20/10: Todo en Compras Lazza, "Compras" fuera del menú (PUBLICADO en V1.1.542, commit b6b285b, verificado en producción; sin migración)
- Augusto: quedarse solo con Compras Lazza. Se relevó qué había solo en las pantallas viejas; eligió (19/10): sacar los accesos directos, NO avisar al vendedor cuando llega, NO juntar pedidos ni "sin stock", Mariana tiene que ver Compras Lazza, poder cambiar el operador; "el resto lo que vos digas".
- **Nueva OC a mano** (`components/compras-lazza-nueva-oc.tsx`, botón en `compras-lazza/page.tsx`): sin PR; proveedor opcional, entrega, observaciones, artículos con moneda. Queda "Por pedir", operador = quien la crea. La moneda de la OC = la que más se repite (`monedaNuevaOc` en `lib/compras-lazza.ts`, con prueba). Si fallan los artículos, la OC se cancela (no queda vacía).
- **Anular / Reactivar** (abriendo la OC, `compras-lazza-oc.tsx`): cancelada con nota "Anulada el … por …"; avisa si llegó algo o tiene factura; el PR no se toca. Pestaña **Anuladas** en la lista (`compras-lista-oc.tsx`, solo con `lazza`); Reactivar vuelve al estado por lo llegado.
- **Operador**: desplegable al abrir la OC (guarda `ordenes_compra.created_by`). En la lista, Op = el de la OC; si no tiene, el que cargó el PR (antes siempre el del PR; solo 5 OC de 154 cambian lo que muestran).
- Accesos directos sacados: Remitos "OC vinculada" (queda el número, sin link), Ventas "Compras a proveedor" (queda la sección, sin link), Pendientes "OC sin factura del proveedor" (sacada).
- Guía de ayuda: `docs/GUIA-USO.md` (dos secciones nuevas de Compras Lazza) → `node scripts/guia-a-ts.mjs` → `lib/asistente-guia-datos.ts`; `/compras-lazza` con módulo `ordenes_compra` en el script.
- Textos: casilla de Configuración "Compras Lazza" (antes "Prueba: Compras nueva"; misma columna `prueba_compras_nueva`), aviso al aprobar PR "están en Compras Lazza, Por pedir".
- `sidebar.tsx`: "Compras" (/ordenes-compra) con `oculto: true` (sigue por link).
- **Falta (Augusto)**: tildarle la casilla "Compras Lazza" a Mariana en Configuración → Usuarios (si no, se queda sin compras en el menú).
- tsc 0, hooks OK, `test-compras-lazza.ts` OK. NO probado en pantalla (el local pide iniciar sesión): al publicar, mirar Nueva OC, Anular/Reactivar y Operador.
- 20/10 (pedido en este chat, va en la misma V1.1.542): ficha de factura de compra (`facturas-consulta.tsx` → `FichaFacturaCompra`, usada en Finanzas Lazza → Facturas): botón **Pagar** arriba (props `pagable`/`onPagar`: abre la misma ventana de pago, `finanzas-lazza/facturas.tsx`) y "¿Ya se pagó con tarjeta?" abajo, con "¿Estás seguro?".
- Verificado en producción (solo abrir, sin guardar): Nueva OC, pestaña Anuladas (1), lápiz de la fecha, menú solo con "Compras Lazza", ficha con Pagar arriba y tarjeta abajo.
- **20/10: probado de verdad en producción (OK de Augusto)** con la OC de prueba **OC-2026-1271** (sin proveedor, "Prueba - no pedir", 1 × $1, obs. "Prueba de Claude (20/10): no pedir. Queda anulada."): Nueva OC ✔ (Por pedir, Op = AL), Operador → Sebastian ✔ (lista "S", al reabrir sigue Sebastian), Anular ✔ (confirmación "¿Anulás OC-2026-1271?…", pestaña Anuladas 1→2, nota "Anulada el 20/10/2026 por Augusto Lazzari"), Reactivar ✔ (vuelve a En curso como Por pedir, con nota "Reactivada…"), y anulada otra vez: **queda en Anuladas a propósito**. En la pestaña Anuladas el cartel decía "Por pedir": **arreglado y PUBLICADO en V1.1.543 (commit 2678dc0, Vercel Ready; verificado en producción 20/10 sin guardar: OC-2026-1271 en Anuladas muestra "Anulada" rojo, no clicable, sin lápiz)**: con `lazza` y `estado = cancelada` el estado es un cartel fijo rojo "Anulada" (sin el clic Por pedir⇄Pedido ni el lápiz de fecha), en `components/compras-lista-oc.tsx`; tsc 0, hooks OK. (El navegador de la app de Claude cierra solo el `confirm()` del navegador: para probar Anular ahí hay que aceptarlo con JS; a la gente le anda normal.)
- **Pendiente: mediados de noviembre 2026**: si nadie usó "Compras" (/ordenes-compra) ni "Compras nueva" por link, proponer borrar su programa (no los datos). Augusto/Seba 20/10: dejarla oculta un mes.
- Quedó sin pasar a propósito: facturas atadas a OC (diferencias, cerrar saldo, conciliar), stock al recibir (en pausa), mail/WhatsApp con PDF (se usa Copiar), aviso al vendedor, juntar pedidos / sin stock, PDF de la OC, totales y KPIs.

## Próximos pasos
1. **Primera factura real con V1.1.533: cargada por Augusto, "pasó bien" (19/10).** Falta la **primera OC donde cambie el proveedor de un artículo**: que el renglón pase a la OC correcta (o nueva), la vieja vacía quede cancelada y el PR cambie de proveedor.
   - **Primer caso real revisado 19/10 (solo lectura): ANDUVO BIEN.** El 19/10 14:50 en OC-2026-1215 (PR-2026-1217, sin proveedor, ya pedida) se pasó "LOCTITE LB 771 ANTI SEIZE NICKEL 454GR" (1 u, $254.930, ya llegado 1) a Rafada S.A.:
     - Fue a una **OC nueva OC-2026-1270** (bien: la única OC abierta de Rafada, OC-2026-1046, es de otro PR). Lo llegado viajó con el renglón; quedó `recibida` (Completo). Nota: "Proveedor real Rafada S.A.: renglones pasados desde OC-2026-1215…".
     - En el PR el artículo quedó con proveedor Rafada S.A.; costo igual ($254.930 ARS).
     - OC-2026-1215 quedó con los otros 11 artículos (no se canceló, bien) y su total ya no cuenta el Loctite ($1.585.548,26 = 1.310.370,46 + IVA). OC-2026-1270: $308.465,30 = 254.930 + IVA.
     - Sin facturas atadas a ninguna de las dos.
     - Detalle chico (no se tocó): el aviso "ya figuraba como pedida: revisá con el proveedor anterior" que arma `asignarRenglonesAProveedor` no se muestra en `compras-lazza-oc.tsx` (solo usa `ocDestino`). Acá no importaba (OC-1215 no tenía proveedor). Falta ver un caso donde la OC vieja quede vacía (que quede `cancelada`).
2. Cuando Compras Lazza esté probada: proponer ocultar del menú "Compras nueva" y "Compras" (que sigan andando por link).
3. En pausa (Augusto: "dejalo como está"): Deshacer de una factura guardada. Si se retoma: solo para "me equivoqué al cargarla"; si el proveedor la anula, va con su NC, no con Deshacer.
4. Sin definir con Augusto: artículo parecido pero distinto, talle cambiado y curva de talles en el PR.

- Protector auditivo del PR-1247 ($918 costo / $529,58 venta): Augusto (19/10) "dejalo así, no pasa nada". Cerrado.

## ⚠️ Cuidado al publicar
- `C:\Users\lazza\lz-pub-auto` y `C:\Users\lazza\lz-pub-lazza` tienen adentro un enlace (junction) al node_modules REAL. `crm/app/scripts/publicar-limpio.sh` hace `rm -rf` de lz-pub-auto: eso puede borrar el node_modules.
- Antes de usar el script, con el OK de Augusto, sacar solo el enlace: `cmd //c "rmdir C:\Users\lazza\lz-pub-auto\crm\app\node_modules"`. La otra opción es usar una copia del script que apunte a una carpeta nueva (así se publicó la V1.1.516).
- Publicar solo cuando Augusto lo pida, con SOLO los archivos de Compras. Si el push es rechazado, no publicar en Vercel.

## Decisiones de Augusto
- Nada traba: avisar, nunca bloquear.
- Muy simple, pocos clics; "no quiero inventar" (lo dudoso no se toca).
- El error del proveedor (cobró más caro) no le interesa: solo el aviso de más del 5 %.
- No hablar de temas de otros chats en este chat.

## Prompt para seguir en un chat nuevo
```
Sos el chat de Compras del CRM Lazzari (siempre en Compras Lazza). Leé CLAUDE.md, la memoria (MEMORY.md y sus archivos), docs/traspaso/compras-oc.md (arriba: lo del 26-27/10) y en docs/ESTADO.md las entradas "COMPRAS LAZZA: SIN APLICAR SALDO A FAVOR", "COMPRAS LAZZA: REVISIÓN EN LA BASE" y "UNA SOLA VENTANA + FACTURA C SIN IVA". La última de Compras es la V1.1.591 (Cargar factura sin la casilla de saldo a favor: el saldo a favor en CC y al pagar lo hace el chat Agente de IA de Finanzas). No queda nada de Compras sin publicar. Ya está comprobado en la base que subir PDF real, Sin factura manual y cambiar proveedor por artículo andan. Preguntale a Augusto si usaron "Leer con IA" y cómo anduvo, y que confirme que la casilla verde ya no sale. Para publicar usé una copia de publicar-limpio.sh con carpeta nueva (lz-pub-compras3), firma Opus y al final `git update-ref` + `git restore --staged` en vez de `git reset`. Pendientes: revisar las 4 facturas sin PDF; a mediados de noviembre proponer borrar el programa de Compras y Compras nueva si nadie las usó. Nunca inventes. No publiques sin su OK; para publicar usá crm/app/scripts/publicar-limpio.sh con solo tus archivos (ojo con lz-pub-auto: enlace a node_modules) y si falla el push no publiques en Vercel.
```
