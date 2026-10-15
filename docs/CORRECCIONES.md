# Correcciones pedidas por Augusto (lista viva)

Se anotan acá en el orden en que las pasa. Al arreglar una: marcarla con ✅ y la versión.

## Compras nueva

1. **16/10/2026 — Pestaña Preguntas, desplegable "Otro proveedor…" (captura).** ESTADO: ⏳ pendiente.
   - A Augusto no le gusta el desplegable.
   - **Los proveedores salen mal / repetidos.** Causa encontrada (solo lectura): cada proveedor existe una vez por sociedad (Lazzari y Grupo LA, mismo CUIT) y el selector los muestra a los dos juntos (MERCADO LIBRE x2, MERCADO ECOM x2, Mercer valve CO x2, AMERICAN COTTON x2). Tiene que mostrar solo los de la sociedad activa (`sociedad_id`).
   - Al escribir "mer" aparece "AMERICAN COTTON" (coincidencia en cualquier parte del nombre) mezclado con lo que empieza con "mer": ordenar primero lo que empieza con lo escrito, después lo que lo contiene.
   - Muchas líneas dicen "Sin sugerencias" (ej. rollo de teflón, sellador, paño de limpieza, juego de bocallaves): mejorar la sugerencia de proveedor.
   - Pendiente: ver con Augusto cómo quiere el selector (ej. lista corta con los proveedores más usados arriba y buscador).

2. **16/10/2026 — Cargar factura de compra que corresponde a una OC sin proveedor (caso FA 0007-00000083, VAL ARG, $ 309.151,92).** ⏳ pendiente.
   - Augusto: "es super complicado". La factura ya estaba guardada (15/10 09:58, "pendiente de aprobación", sin OC) porque el renglón de la OC-2026-1215 (VÁLVULA AGUJA 3000LBS … GENEBRE 2221 05, 3 × $ 85.165,82) no tiene proveedor y el cruce es por proveedor.
   - Arreglo a hacer: cuando una factura coincide (descripción/código y precio) con renglones de OC SIN proveedor, la IA propone "asignar VAL ARG a ese renglón y vincular la factura" en un solo clic, con Deshacer. Mismo caso: compras por Mercado Libre (el vendedor que factura no es ML).
   - **DECIDIDO 16/10:** en las compras de Mercado Libre el proveedor de la OC es SIEMPRE el vendedor real (el que factura). Augusto marca las compras de ML de otra manera (a definir: nota/etiqueta "Mercado Libre" + pagado con Visa) para identificarlas; no se pone "proveedor: Mercado Libre".

3. **16/10/2026 — Ventana "Carga masiva de facturas de proveedores" (captura): se superponen columnas y no se entiende.** ✅ V1.1.469: tabla de columnas fijas, proveedor y archivo cortados con "…" (nombre completo al pasar el mouse), estado en varias líneas, botones que se acomodan, ventana más ancha. Probar con facturas de proveedor de nombre largo.

4. **16/10/2026 — Presupuestos nuevo > Seguimiento (captura): mostrar vendedor y operador, y poder abrir el PR para ver qué es.** ✅ V1.1.470: cada fila muestra "Vendedor: … · Operador: …" (operador = quien cargó el PR) y el botón **Ver qué es** abre debajo los renglones (cantidad, descripción, precio), observaciones y fechas, sin salir de la pantalla; "abrir el PR completo" va al detalle de siempre.
