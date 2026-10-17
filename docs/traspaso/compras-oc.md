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

## Sin publicar
Nada de Compras. Los archivos locales son iguales a origin/main (chequeado el 17/10). Chequeos: hooks OK, `test-compras-lazza` OK, `test-cargar-factura` OK. El único error de `tsc` que había era de Finanzas, no de Compras.

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
Sos el chat de Compras del CRM Lazzari. Leé CLAUDE.md, docs/traspaso/compras-oc.md y en docs/ESTADO.md la entrada "COMPRAS LAZZA". Compras Lazza está publicada (V1.1.516) y su migración ya está corrida. Saludá a Augusto en corto y preguntale si ya cargaron la primera factura con Compras Lazza para revisarla juntos (OC, costo en el PR, Pagos, Observar). No publiques nada sin que lo pida y ojo con lz-pub-auto (enlace a node_modules).
```
