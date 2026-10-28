# 09 — Plan de corrección

Ordenado por **riesgo, impacto y dependencias**, no por facilidad. Nada de esto está implementado: cada tanda necesita el OK de Augusto. Las migraciones van con rollback y las corre él en el SQL Editor.

Esfuerzo relativo: **S** = menos de un día de trabajo con IA; **M** = 1 a 3 días; **L** = una semana o más.

## Resumen del orden

| Tanda | Qué | Por qué primero | Hallazgos | Esfuerzo |
|---|---|---|---|---|
| 0 | Red de pruebas mínima | Sin esto, cada arreglo de las tandas siguientes puede romper otra cosa sin que nadie lo vea | H16, H49 | S–M |
| 1 | Cerrar el acceso anónimo y separar por sociedad en la base | Hoy hay datos de facturas, presupuestos y comprobantes legibles desde afuera | H01, H02, H03, H04, H05, H36, H62 | M |
| 2 | Arreglos de plata que se ven o se mandan al cliente | Errores que hoy dan números incorrectos | H08, H15, H19, H22, H23, H20, H24 | S–M |
| 3 | Una sola fuente de verdad por regla de plata | Corta la causa de que "el error se mude" (C1, C2) | H17, H18, H28, H29, H12, H25, H26, H27, H37, H30 | M |
| 4 | Ventas ↔ Compras: renglones estables y venta caída | El circuito más usado (PR → OC → remito → factura) | H06, H07, H56, H09, H44, H45, H10, H50 | M–L |
| 5 | Operaciones a medias en el navegador → RPC | Datos que quedan a medias | H13, H11, H14, H31, H21, H48, H59 | M |
| 6 | Pantallas viejas en solo lectura (mudanza) | Evita que los arreglos no lleguen a la copia vieja | H61, H47, H51 | M |
| 7 | Indicadores y detalles | Bajo riesgo | H39, H41, H42, H43, H32, H33, H35, H38, H40, H46, H57, H58, H64, H70, H80, H83, H90 | S cada uno |

---

## Tanda 0 — Red de pruebas mínima (antes de tocar nada)

- **Problema:** fallan 13 de las 23 pruebas de regresión y ninguna corre al publicar. Los tipos de la base están viejos (H16, H49).
- **Solución:**
  1. Agregar un comando `test:lib` que corra solo las pruebas puras de `src/lib` (hoy pasan) y sumarlo al `build`, para que si falla una no se publique.
  2. Revisar las 14 pruebas rotas una por una: reescribir como prueba de `lib` las que valen y retirar las que solo leían texto de archivos.
  3. Regenerar `database.types.ts` (`supabase gen types`).
- **Alternativa:** solo el paso 1, que ya da el 80 % del beneficio.
- **Riesgo:** bajo. No toca datos ni pantallas.
- **Criterio de aceptación:** `npm run build` falla si se rompe una regla de saldo, y `tsc` da 0 errores con los tipos nuevos (puede destapar errores reales, que hay que listar y no tapar con `as any`).

## Tanda 1 — Seguridad en la base

- **Problema:** la clave anónima (pública por diseño) permite leer vistas de facturas y presupuestos, escribir la cotización, ejecutar funciones `security definer` y listar archivos (H01–H04). Las tablas viejas no separan por sociedad en RLS (H05).
- **Solución**, en migraciones chicas, cada una con rollback y prueba de lectura:
  1. Quitar las políticas `anon` de `cotizaciones_dolar`. La ruta `/api/cotizacion-bna` pasa a escribir con service role.
  2. `security_invoker = on` en las 7 vistas.
  3. `revoke execute … from anon` en las funciones `security definer`, y chequeo de rol/sociedad dentro de `increment_stock`, `delete_presupuesto_safe` y `change_pr_operator`.
  4. Storage: sacar las políticas de escritura y listado para `public`/`anon`. En un segundo paso, buckets privados con URL firmada (hay que ajustar `getPublicUrl` y los adjuntos de mail).
  5. RLS por sociedad en las tablas de plata viejas (`facturas_compra`, `facturas`, `factura_items`…), empezando por las de plata. Bloquear la edición de `factura_items` de comprobantes con CAE.
  6. `exigirCronSecret()` único que falle cerrado en los 4 crons (H36).
- **Riesgo:** **medio**. Una política mal hecha puede dejar a un usuario sin ver sus datos. Por eso se hace de a una, con rollback y probando en producción con un usuario de cada rol.
- **Dependencias:** ninguna, pero conviene tener la Tanda 0.
- **Criterio de aceptación:** con la clave anónima, las vistas y las funciones devuelven "permiso denegado". Un usuario de Grupo LA no ve facturas de compra de Lazzari.

## Tanda 2 — Plata que hoy da mal

| Hallazgo | Arreglo | Esfuerzo |
|---|---|---|
| H08 Cta. Cte. del cliente con NC como deuda (y se manda al cliente) | Armarla con `traerDatosSaldoClientes` + `saldoFacturaVenta` | S |
| H15 Anular cobro o borrar gasto deja la línea del banco conciliada | Que `gestionar_cobro`, el borrado de gasto y el rechazo de cheque liberen `match_movimiento_id`. Listar los casos actuales para que Augusto decida | S |
| H19 Factura de compra "pagada" sin pago | Decidir con Augusto si "pagada por otro medio" se registra como ajuste. Alinear Finanzas y la base | S |
| H22, H23, H20 Casos de datos (pago de más de $219.548, factura de Speed Business pagada dos veces, gastos de Inga/Porcel duplicados) | **Revisar con Augusto caso por caso, no corregir solo.** Después, bloquear que el total se edite después de pagar (aviso) | S |
| H24 Proveedores duplicados por CUIT con guiones | Normalizar el CUIT al guardar y avisar si se repite. La unión de duplicados, con OK | S |

**Criterio de aceptación:** la Cta. Cte. de un cliente con NC da el mismo saldo que Finanzas > Cuentas corrientes.

## Tanda 3 — Una sola fuente de verdad por regla

- **Problema:** C1 y C2 (ver [07](07-causas-raiz.md)).
- **Solución:**
  - Saldo de factura de compra: una función en `lib` y su gemela SQL (`fc_compra_pagado`), usadas por la OP, el Plan de pagos, Finanzas, el trigger validador (que hoy ignora las NC) y la RPC de tarjeta (que cuenta dos veces la NC, H18).
  - Saldo de factura de venta: que la RPC de NC, el agente de mail y el asistente usen `lz_cobrado_factura` / `saldoFacturaVenta`.
  - Saldo a favor del cliente: un solo tipo de registro (H29).
  - Total de factura: que `recalcular_factura` no toque comprobantes con CAE (H12).
  - Retención: que la OP y el Plan usen `calcularRetencionGanancias` y que las OP del Plan anoten la retención congelada (H25–H27). Antes, ver con el contador que no haya nada presentado que rectificar.
  - Cotización: una sola regla con prueba (H37).
  - Límite de crédito: dejar de leer `saldo_cuenta_corriente` (H30).
- **Prueba clave:** "casos de oro" (factura con NC, pago parcial, pagada por otro medio, en US$) que comparen todas las implementaciones que queden.
- **Riesgo:** medio. Cambia números que la gente ve. Hay que mostrarle a Augusto un antes/después de los saldos (solo lectura) antes de publicar.

## Tanda 4 — Ventas ↔ Compras

1. **H06/H07/H56:** `actualizar_presupuesto_atomico` que actualice por id y copie todas las columnas. Después, re-atar los 35 renglones de OC y los 47 de remito sueltos (propuesta para revisar, sin asignar solo).
2. **H09:** función "venta caída" que, al rechazar o no facturar, **avise** y proponga cancelar las OC no pedidas o destinar lo recibido. Revisar los 4 casos actuales (≈ $19,1 M).
3. **H44/H45:** RPC `aprobar_presupuesto` atómica e idempotente por proveedor. Restaurar un PR no genera OC si no está aprobado.
4. **H10/H50:** estado de mercadería calculado desde los renglones, que suba y baje. Dejar de leer los ejes viejos.

**Riesgo:** alto. Es el circuito más usado, así que se hace de a un paso y probando en local sin guardar.

## Tanda 5 — Operaciones a medias → RPC

- **H13:** recuperación de la factura común igual a la de la NC.
- **H11:** editar OC.
- **H14:** dividir remito.
- **H31:** anular/revertir factura sin CAE.
- **H21:** alta y baja de gasto.
- **H48/H59:** Llegó, pago con tarjeta y personalización.

Mismo patrón que cobros y OP. ⚠️ H13 toca facturación: se prueba **solo** con los simuladores de `test:fce`, nunca desde la compu local contra ARCA.

## Tanda 6 — Mudanza de pantallas viejas

`finanzas-vieja`, `finanzas`, `ordenes-compra`, la carga masiva vieja y `cargar-factura-oc` pasan a solo lectura o redirigen a la nueva. Primero un inventario de qué hace cada una que la nueva no hace. No se borra nada. El stock (H47) no se toca sin aviso de Augusto.

## Tanda 7 — Indicadores y detalles

- Tasa de conversión del dashboard (H39) y Consumo del cliente (H41) con los estados ganados únicos.
- OC con costos mezclados ARS/US$ (H42) y margen con una fórmula (H43).
- FA/FB con la misma regla (H32).
- Transporte como servicio (H33).
- La IA del presupuesto con sesión (H35).
- Remitente del mail desde el servidor (H38).
- El resto de los bajos.

---

## Esfuerzo total para estabilizar

| Tandas | Esfuerzo relativo |
|---|---|
| 0 + 1 + 2 (lo urgente) | ≈ 1,5 a 2 semanas de trabajo con IA, en tandas chicas |
| 3 + 4 + 5 (lo estructural) | ≈ 3 a 4 semanas |
| 6 + 7 | ≈ 2 semanas, sin apuro |

No hace falta reescribir el sistema. Son arreglos localizados sobre una base que en lo más delicado (cobros, OP, emisión ARCA) ya está bien hecha.
