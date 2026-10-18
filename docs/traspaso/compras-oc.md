# Traspaso: Compras (Compras Lazza + Compras nueva)

Actualizado el 17/10/2026 para seguir desde otra cuenta sin el historial del chat. Producción va por V1.1.517 (la de Finanzas).

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

## 18/10: FC 0014-73759 cargada + arreglo IVA/percepciones (SIN PUBLICAR)
- Cargada por Claude el 18/10 14:05 (OK de Augusto) desde el CRM local con V1.1.523 (producción no deja tomar el PDF de la compu): OC-2026-1241 facturada, transferencia a 60 días, vence 15/12, PDF guardado, costos del PR-1247 sin cambios.
- Error encontrado: el QR solo trae el total y la pantalla hacía IVA = total − neto → la percepción de IIBB (4 %) quedaba sumada al IVA (73759 y 73760).
- Programa: `ivaYPercepciones` en `lib/compras-lazza.ts` (con prueba): IVA = neto × alícuota y lo que sobra son percepciones (en el encabezado: "+ percep. (calculada)"); si sobra de menos (10,5 %) queda como antes. Usada en `compras-lazza-factura.tsx` (FC y NC).
- Datos: `supabase/migrations/20261018150000_iva_percepciones_segutecnica.sql` (vuelta atrás en `supabase/rollback/`): 73759 IVA 102.976,65 + perc. 19.614,60; 73760 IVA 212.982 + perc. 40.568. El total no cambia. **Corrida por Augusto el 18/10 y verificada.**

## Próximos pasos
1. **Mirar con Augusto la PRIMERA factura que se guarde con Compras Lazza**: que la OC quede facturada (o parcial), el costo en el PR, Pagos, el PDF y Observar si correspondía. Todavía no se guardó ninguna real con este botón, y la lectura con IA tampoco se probó.
2. Cuando Compras Lazza esté probada: proponer ocultar del menú "Compras nueva" y "Compras" (que sigan andando por link).
3. En pausa (Augusto: "dejalo como está"): Deshacer de una factura guardada. Si se retoma: solo para "me equivoqué al cargarla"; si el proveedor la anula, va con su NC, no con Deshacer.
4. Sin definir con Augusto: artículo parecido pero distinto, talle cambiado y curva de talles en el PR.

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
Sos el chat de Compras del CRM Lazzari. Leé CLAUDE.md, docs/traspaso/compras-oc.md y en docs/ESTADO.md la entrada "COMPRAS LAZZA". Compras Lazza está publicada (V1.1.516) y su migración ya está corrida; el "+" de la columna Factura y "Sacar factura" salieron en V1.1.519; no queda nada sin publicar. Saludá a Augusto en corto y preguntale si ya cargaron la primera factura (o usaron "Sacar") con Compras Lazza para revisarla juntos (OC, costo en el PR, Pagos, Observar). No publiques nada sin que lo pida y ojo con lz-pub-auto (enlace a node_modules).
```
