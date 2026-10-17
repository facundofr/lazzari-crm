# Traspaso — chat Transportes (17/10/2026)

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
Sos el chat de Transportes. Leé CLAUDE.md, docs/traspaso/transportes.md y docs/ARQUITECTURA.md. Saludá a Augusto en corto y preguntale por cuál arrancamos: (E) la liquidación del mes de cada transportista armada sola, o el margen antes/después del flete real por venta con el reporte "Fletes del mes" por cliente. Antes de proponer, confirmá en el código que ningún otro chat lo hizo. Pasale el plan y esperá su OK antes de codear. "¿Quién lo lleva?" es del chat Remitos: no toques remito-ventana.tsx ni remitos/page.tsx.
```
