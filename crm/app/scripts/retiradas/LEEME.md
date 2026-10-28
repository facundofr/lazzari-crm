# Pruebas retiradas (28/10/2026, auditoría integral, Tanda 0)

Estas 13 pruebas no controlaban cuentas: buscaban un **texto exacto dentro del código de las pantallas** (por ejemplo,
que en `finanzas-vieja` estuviera escrita la línea `rpc("registrar_pago_proveedor_seguro"`). Cuando las pantallas se
mudaron a Finanzas Lazza y Compras Lazza, ese texto cambió de lugar y empezaron a fallar aunque todo anduviera bien.
No corrían en ningún lado, así que nadie se enteraba.

No se borraron: quedan acá como registro de qué se quiso cuidar en su momento. Lo importante ya lo cubren las pruebas
de cuentas de `src/lib` que corren antes de cada publicación (`scripts/test-lib.mjs`).

| Prueba | Qué cuidaba |
|---|---|
| test-extracto-csv.mjs | Que el extracto del banco se leyera con el parser de producción |
| test-op-validation.mjs | Que la OP y el pago directo compartieran la validación fiscal |
| test-op-money-rounding.mjs | Redondeo del monto bruto de la OP |
| test-direct-payment.mjs | Que el pago directo usara la RPC segura `registrar_pago_proveedor_seguro` |
| test-op-echeqs.mjs | Que la OP con eCheq usara la RPC segura |
| test-presupuesto-post-create.mjs | Recarga del PR después de crearlo |
| test-presupuesto-exact-price.mjs | Que al editar un PR se conserven los precios exactos |
| test-fc-edit-guards.cjs | Controles al editar una factura de compra |
| test-own-stock-purchase-orders.mjs | OC de stock propio (además le falta un archivo que ya no existe) |
| test-latest-operational-fixes.mjs | Columnas de la OC impresa (ancho de "Código") |
| test-financial-ledger-ui.mjs | Que la CC de clientes saliera de comprobantes reales |
| test-transport-invoice-upload.mjs | Carga de factura de transporte con viajes externos del mes |
| test-provider-bank-payment-terms.mjs | Plazos de pago del proveedor (`sumarDiasISO`) |

Si alguna de estas reglas vuelve a importar, conviene escribirla como prueba de una función de `src/lib`
(no buscando texto en una pantalla) y sumarla a la lista de `scripts/test-lib.mjs`.
