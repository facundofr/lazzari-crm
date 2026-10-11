# Reportes y Dashboard: revisión y propuesta

Fecha: 09/10/2026. Es la base para la idea 6 de `IDEAS-PROXIMAS.md` ("Reportes y Dashboard de cero").
Nada de esto se programa hasta que respondas las preguntas de la sección D.

**Ya arreglado en esta tanda (sin publicar):**
- **Libro IVA:** las notas de crédito restan, las compras anuladas no cuentan y los totales salen separados en pesos y en dólares.
- **Gráficos y rankings:** el mes sale bien (las facturas del día 1 ya no caen en el mes anterior) y las NC no se restan dos veces.
- **Sin corte de 1000 filas:** las consultas traen todas las filas.

---

## A. Lo que hay hoy

Referencias: ✅ correcto · ⚠️ con errores o engañoso · ❌ no sirve.

### Dashboard

| Qué muestra | ¿Está bien? | ¿Sirve? |
|---|---|---|
| **Facturado este mes**, en ARS y USD, contra el mes anterior | ✅ (arreglado). Incluye IVA | Sí, pero mezcla IVA con venta |
| **Presupuestos activos, tasa de conversión, margen promedio** | ⚠️ Salen de una función vieja de la base que no está en el código: no se puede verificar cómo calcula | Dudoso |
| **Cobertura de gastos fijos** | ⚠️ Compara lo facturado **con IVA** contra los gastos fijos, y solo en pesos | La idea sirve; el número, no |
| **Objetivos** | ⚠️ El objetivo de cada vendedor se mide contra lo facturado por **toda la empresa** | No como está |
| **Facturación mensual** (6 meses) | ✅ (arreglado). Solo pesos | Sí |
| **Presupuestos por estado** (torta) | ✅ Cuenta todos los PR desde el inicio | Poco: no dice nada del mes |
| **Últimos 5 presupuestos** | ⚠️ Los PR en USD se muestran con signo de pesos | Poco |
| **Alertas** | ✅ | Sí |
| **Top 5 clientes** | ✅ (arreglado: 12 meses, NC restadas y ARS/USD por separado) | Sí |
| **Actividad reciente** | ✅ | Poco |

### Reportes

| Pestaña | ¿Está bien? | ¿Sirve? |
|---|---|---|
| **Análisis comercial**: facturación mensual, PR por estado, métricas, motivos de rechazo y ranking de clientes | ✅ en lo principal (arreglado). Los **motivos de rechazo** se adivinan buscando palabras ("precio", "plazo") en los últimos 20 rechazos | Ranking y facturación, sí; el resto, poco |
| **Compras vs ventas** (24 meses) | ✅ las sumas (arreglado). ⚠️ El "margen PR" usa el costo cargado al cotizar, no el costo real de la compra | Parcial |
| **Comisiones** | ❌ Aplica 3 % sobre la venta + 10 % sobre el margen, un número fijo que no es regla del negocio. Además, suma costos en USD como si fueran pesos | No. Hay que reemplazarla (idea 1) |
| **Ranking por artículo** (12 meses) | ✅ (arreglado: NC restan y USD pasado a pesos). ⚠️ Agrupa por descripción escrita, no por código: "Botín X 42" y "BOTIN X T42" cuentan como dos artículos | Sirve con cuidado |
| **Libro IVA** | ✅ (arreglado). ⚠️ No separa por alícuota (21 % / 10,5 %), ni lo exento o no gravado, y no sale en el formato del Libro IVA Digital de ARCA | Sirve para controlar, no para presentar |

**Selector "Todo en ARS / USD":** usa un dólar que se escribe a mano (por defecto, 1200). Conviene reemplazarlo por el dólar BNA del día o por la cotización de cada factura.

---

## B. Propuesta de Dashboard nuevo

La idea: **abrir el sistema y saber cómo está el negocio en 10 segundos.** Todo en ARS y USD por separado, con el equivalente al dólar BNA del día al lado. Cada número se puede tocar para ver el detalle.

### Para el dueño (Augusto)

1. **Posición del día:** caja y bancos en ARS y en USD, y el total equivalente al dólar BNA. → Sabés con cuánta plata contás hoy.
2. **Por cobrar y por pagar a 7 y a 30 días**, más lo vencido. → Ves si vas a tener que salir a buscar plata.
3. **Ventas del mes: facturado contra cobrado**, sin IVA, contra el mes anterior y el mismo mes del año pasado. → Facturar no es cobrar.
4. **Margen real del mes**: venta sin IVA menos el costo de compra real de lo vendido, en $ y en %. → Sabés si se gana plata, no solo si se vende.
5. **Top 5 clientes y top 5 rubros o marcas del mes.** → Sabés de quién y de qué depende el negocio.
6. **Presupuestos abiertos**: cantidad, monto y tasa de conversión de los últimos 90 días. → Lo que puede entrar.
7. **Alertas**: BCRA en rojo, cheques que vencen, muestras con más de 30 días, OC sin recibir y margen bajo. Avisan, nunca frenan. → Lo que necesita tu atención hoy.
8. **Compras por recibir**: OC abiertas y mercadería pendiente por proveedor. → Evitás quedarte sin stock prometido.

### Para el vendedor

Sus presupuestos abiertos y por vencer, su tasa de conversión, sus ventas del mes y su objetivo (medido con **sus** ventas), sus clientes dormidos u oportunidades, y sus muestras en la calle. → Sabe a quién llamar hoy.

### Para administración

Cobranzas del día y de la semana, cheques en cartera y por depositar, pagos a proveedores de la semana (Plan de pagos), facturas de compra sin conciliar y facturas de venta sin enviar. → La lista de tareas del día.

---

## C. Propuesta de Reportes

Cada reporte se filtra por fechas, sociedad y moneda, y se exporta a Excel.

| Reporte | Beneficio |
|---|---|
| **Ventas por cliente** (con evolución contra el año anterior) | Ves quién crece y quién se te está yendo |
| **Ventas por rubro y por marca** (calzado, guantes, respiratoria…) | Sabés qué líneas empujar y cuáles negociar |
| **Ventas por vendedor** (facturado y cobrado) | Es la base de las comisiones reales (idea 1) |
| **Margen por factura, cliente, rubro y vendedor** | Encontrás los clientes o productos que venden mucho y dejan poco |
| **Ranking de artículos por código interno** | Ves de verdad qué se vende, sin duplicados por cómo se escribió la descripción |
| **Compras por proveedor y por rubro** | Te da fuerza para negociar precios y plazos |
| **Evolución del precio de costo por artículo y por proveedor** | Detectás aumentos antes de que te coman el margen |
| **Aging de cobranzas**: deuda por cliente a 0-30, 31-60, 61-90 y más de 90 días | Sabés a quién reclamar primero |
| **Aging de pagos a proveedores** | Ordenás los pagos sin sorpresas |
| **Libro IVA ventas y compras por alícuota**, exportable al formato de ARCA | Le ahorrás trabajo al contador y evitás errores |
| **Retenciones y percepciones** sufridas y practicadas | Controlás los saldos a favor |
| **Presupuestos: conversión y motivos de rechazo** (con motivo elegido de una lista) | Sabés por qué se pierden ventas |
| **Personalización**: trabajos y costo por taller y por cliente | Controlás lo que cobran los talleres |
| **Resultado del mes** (idea 2: margen − gastos − comisiones) | Es el número para el pago a José |

---

## D. Preguntas para Augusto

1. **¿Qué querés ver primero al entrar?** Elegí hasta 4:
   a) posición del día · b) por cobrar y por pagar · c) ventas del mes · d) margen real · e) presupuestos abiertos · f) alertas · g) compras por recibir.
2. **¿El Dashboard cambia según quién entra?**
   a) Sí: uno para dueño, otro para vendedor y otro para administración · b) Uno solo para todos, que oculta la plata a los vendedores.
3. **¿Las ventas se miden con o sin IVA?**
   a) Sin IVA (recomendado para margen y comisiones) · b) Con IVA, como se factura.
4. **¿"Ventas del mes" es lo facturado o lo cobrado?**
   a) Facturado · b) Cobrado · c) Los dos, uno al lado del otro (recomendado).
5. **¿Con qué dólar se pasa todo a pesos?**
   a) BNA divisa del día · b) BNA billete del día · c) La cotización de cada factura.
6. **¿Lazzari y Grupo LA se ven por separado o también sumados?**
   a) Separados · b) Separados, más una vista "las dos juntas".
7. **¿Qué reportes usás hoy en Excel?** Mandame uno de ejemplo y lo replico tal cual.
8. **¿Qué le pasa al contador hoy?** ¿Le mandás el Libro IVA del CRM o lo arma él? ¿Le sirve en Excel o lo necesita en el formato de ARCA?
9. **La pestaña Comisiones de hoy (3 % + 10 %), ¿la escondemos** hasta tener las reglas de la idea 1?
   a) Sí, la escondemos (recomendado) · b) La dejamos con un cartel "ejemplo, no es regla".
10. **¿Qué margen te preocupa?**
    a) Avisar debajo del 15 % (como ahora) · b) Otro número · c) Uno por rubro.
