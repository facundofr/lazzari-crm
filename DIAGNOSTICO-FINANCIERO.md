# Diagnóstico del circuito financiero — CRM Lazzari

Fecha: 09/10/2026 · Versión revisada: V1.1.412.

Es una revisión **solo de lectura del código**: no se tocó la base ni ARCA. Las rutas son relativas a `crm/app/`.

La confianza indica qué tan seguros estamos:
- **Alta:** se leyó y se comprobó en el código.
- **Media:** depende de algo que no está en el repo (por ejemplo, funciones viejas de la base o permisos).

---

## A. Urgentes: se pierde plata o queda mal un dato fiscal

### A1. La facturación masiva de Factura B se emite sin IVA
- **Confianza:** alta, verificado a mano.
- **Dónde:**
  - `src/app/(crm)/facturacion/facturacion-content.tsx:779` (envía precio neto);
  - `src/app/api/facturacion/route.ts:500` (la Factura B toma ese precio como final).
- **Qué pasa:** un renglón de $1.000 + IVA se factura por **$1.000 total en lugar de $1.210**. Se pierde un 17,4 % por factura.
- **Alcance:**
  - Afecta las FB de presupuestos electrónicos emitidas con la facturación masiva.
  - Además, los presupuestos manuales en FA facturan de más.
  - La facturación desde Ventas convierte bien.
- **Arreglo:** usar la misma conversión que `ventas/page.tsx:559-565`. No se puede probar en local (regla de ARCA): se prueba en producción con una factura real controlada.
- **A revisar por Augusto:** las FB emitidas con la facturación masiva desde que existe.

### A2. Anular una orden de pago a proveedor cuenta dos veces la nota de crédito
- **Confianza:** alta.
- **Dónde:** `supabase/migrations/20261007143000_anular_orden_pago_atomica.sql:170-187`.
- **Ejemplo:**
  - Factura $100.000, NC $50.000 aplicada y OP $50.000.
  - Al anular la OP, la factura queda **"pagada" debiendo $50.000**.
  - Desaparece de la OP y del Plan de pagos.

### A3. Anular una NC de compra usa la función vieja
- **Confianza:** alta.
- **Dónde:** `src/app/(crm)/finanzas/page.tsx:2978` llama a `anular_nota_credito_compra` en lugar de la v2.
- **Qué pasa:** si la NC estaba aplicada a varias facturas, las otras quedan con crédito fantasma y marcadas como "pagada".

### A4. Al pagar en dólares también se cuenta dos veces la NC
- **Confianza:** alta.
- **Dónde:** `supabase/migrations/20260912180000_fx_settlements.sql:141`.
- **Ejemplo:** factura de USD 1.000 con NC de USD 200. El saldo da 600 en lugar de 800, así que esos USD 200 nunca se pueden pagar.

### A5. Retención de Ganancias RG 830: un solo mínimo para todo
- **Confianza:** alta en el código. Los montos legales hay que confirmarlos con el contador.
- **Dónde:** `src/lib/plan-pagos.ts:63-82` y `finanzas/page.tsx:2094`.
- **Qué pasa:**
  - **Ignora el concepto del proveedor.** A servicios y talleres se les aplica el mínimo de bienes, y no hay escala para honorarios. Se retiene de menos, y Lazzari responde por lo no retenido.
  - **Los valores por defecto no coinciden:** 224.000 en un lugar y 400.000 en otro.
  - **El Plan de pagos "congela" la retención** calculada al armarlo. Si en el medio se paga otra OP al mismo proveedor, las dos aplican el mínimo completo.

### A6. Cheque rechazado: la factura sigue "pagada"
- **Confianza:** alta.
- **Dónde:** `finanzas/page.tsx:3518`.
- **Qué pasa:** "Rechazar" solo cambia el estado del cheque. El cobro sigue vigente y la deuda del cliente no reaparece.
- **Al revés tampoco anda:** anular un cobro no anula el cheque que generó. El cheque sigue "en cartera" y se puede depositar o endosar.

### A7. Eliminar o anular una factura de compra ya pagada deja la plata colgada
- **Confianza:** alta. Puede que los permisos de la base lo frenen; no se pudo ver.
- **Dónde:** `finanzas/page.tsx:2868-2878` (eliminar) y `:2980` (anular).
- **Qué pasa:**
  - Los pagos quedan sin factura y el proveedor aparece con saldo a favor.
  - Las asignaciones a la OC siguen contando, así que la factura corregida después **queda trabada** en la conciliación.

### A8. Nota de crédito manual de venta en 3 pasos sueltos y sin tope
- **Confianza:** alta.
- **Dónde:** `facturacion-content.tsx:470-519`.
- **Qué pasa:**
  - Si falla a la mitad, queda una NC sin renglones. Si reintentás, se duplica.
  - Deja hacer una NC por el total de una factura ya cobrada en parte, y la plata cobrada queda colgada.

### A9. Seguridad: datos de una sociedad visibles desde la otra
- **Confianza:** alta.
- **Dónde:**
  - `src/app/api/sicore/route.ts`: usa la clave de servicio sin chequear rol ni sociedad. Cualquier usuario logueado, incluso un vendedor, puede bajar CUIT y retenciones de la otra sociedad.
  - `gestionar_cobro`: pide rol de admin **o** pertenecer a la sociedad, cuando debería pedir las dos cosas. Un vendedor podría anular o borrar cobros.

---

## B. Números que se ven mal en pantalla

| # | Qué | Dónde | Ejemplo / efecto |
|---|---|---|---|
| B1 | **Caja del mes:** no cuenta los cobros por transferencia ni efectivo, y las retenciones que sufrimos las cuenta como egreso | `finanzas/page.tsx:3543-3559` | Un cobro de $1 M por transferencia no aparece |
| B2 | **Libro IVA:** las NC suman en vez de restar, las compras anuladas cuentan y mezcla ARS con USD | `reportes/page.tsx:474-525`, `1436-1484` | Factura de $100 k + su NC dan $200 k de débito fiscal en vez de $0 |
| B3 | **Saldo CC de clientes:** lee una columna vieja que nadie actualiza (el mismo error que ya se arregló en proveedores) | `clientes/page.tsx:106`, `facturacion-content.tsx:136` | El saldo y el aviso de límite de crédito no sirven |
| B4 | **Listados cortados a 1000 filas:** movimientos, facturas de venta, cheques, dashboard y reportes | `finanzas/page.tsx:975, 1182, 1350, 1462`, `dashboard/page.tsx:124`, `reportes` | Facturas pagadas que figuran como deuda. **Hay que arreglarlo antes de importar los 695 cheques** |
| B5 | **Pagos a cuenta y anticipos a proveedores:** no bajan la deuda en ningún lado | `lib/saldo-proveedores.ts`, `finanzas:1423` | Anticipo de $500 k y la deuda sigue entera |
| B6 | **Saldo a favor de clientes:** no se muestra en ningún lado | `finanzas:1219` | Se pierde de vista |
| B7 | **NC total restada dos veces** en Ficha 360, reportes y facturación | `facturacion-content.tsx:1614`, `reportes:292` | Las ventas aparecen más bajas |
| B8 | **Si falla una consulta, Finanzas muestra datos de ejemplo inventados** | `finanzas:1042-1053`, `1485-1494` | Números falsos que parecen reales |
| B9 | **"Ajuste manual" de cuenta corriente** entra a la caja como si fuera plata | `finanzas:3337` | Infla o achica la caja |
| B10 | **Gastos manuales:** no están atados a su pago | `finanzas:2611-2652` | Corregís un gasto de $50 k a $5 k y la caja sigue restando $50 k |
| B11 | **Gráficos de Reportes:** las facturas del día 1 caen en el mes anterior por la zona horaria, y mezclan monedas | `reportes:161-230` | |
| B12 | **Cuenta corriente de proveedor:** el detalle y el resumen no coinciden | `finanzas:3240` | |

---

## C. Cosas que traban (van contra la regla "nada me frena")

- **C1. Control de duplicados de facturas de compra.** Mira solo el número, sin el tipo de comprobante, e incluye las anuladas. Una NC 0001-00000045 queda bloqueada si existe la FC con el mismo número. Está en `cargar-factura-oc.tsx:810`.
- **C2. Chequeo de exceso en la conciliación.** Traba en vez de avisar.
- **C3. "El pago directo debe ser parcial"** en la función de pago a proveedores.
- **C4. Facturas en USD cobradas con cheque.** No hay forma de registrarlas.

---

## D. Orden y control (no pierde plata hoy, pero conviene)

- **D1. Cron de cotización BNA.**
  - Probablemente no graba, porque no tiene sesión.
  - Lo que graba no se usa.
  - Puede pisar las cotizaciones cargadas a mano.
  - Si falta `CRON_SECRET`, cualquiera lo puede disparar.
- **D2. Permisos de Finanzas.** La pantalla no chequea el rol: un vendedor que escribe `/finanzas` entra igual.
- **D3. Conciliación bancaria.** No guarda quién ni cuándo, y no se puede desconciliar.
- **D4. Saldo inicial de caja.** Se carga a mano cada mes y no pasa solo de un mes al siguiente.
- **D5. Cuentas bancarias.** No existen: no hay saldo por banco ni transferencias entre cuentas.
- **D6. Errores sin revisar.** En el Plan de pagos y en Finanzas hay escrituras que no revisan si dieron error.

---

## E. Mejoras de fondo propuestas

1. **Un solo cálculo de saldo**, por factura y por cliente o proveedor, en la base y con prueba. Lo usan todas las pantallas. Termina con los dobles conteos (A2, A3, A4, B7, B12) y hace que todas las pantallas muestren el mismo número.
2. **Una sola regla de "qué es plata"**, con su prueba: qué tipo de movimiento es ingreso, egreso o ajuste. Arregla B1 y B9 y evita que se repitan.
3. **Cuentas y bancos de verdad**: saldo por banco, transferencias internas y saldo que pasa solo de un mes al otro.
4. **Posición del día en el Dashboard**: ARS, USD, equivalente con el dólar BNA, y lo que hay por cobrar y por pagar a 7 y 30 días.
5. **Cheques atados a su cobro**: rechazarlo reabre la deuda y deja un aviso.
6. **Retención con tabla por concepto** (bienes, servicios, honorarios con escala), recalculada al momento de pagar.
7. **Prueba automática de anulaciones**: después de anular una OP, una NC o un pago en USD, el saldo vuelve exactamente al punto anterior.
