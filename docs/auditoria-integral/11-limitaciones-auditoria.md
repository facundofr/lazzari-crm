# 11 — Limitaciones de la auditoría

## Reglas que se respetaron (y lo que dejaron afuera)
- **Solo lectura.** No se modificó código, esquema, migraciones ni configuración. Lo único que se escribió es esta carpeta `docs/auditoria-integral/`.
- **Base real, solo SELECT**, dentro de transacciones de solo lectura. **No se probó ninguna escritura**, ni como anónimo ni como usuario. Por eso los problemas de escritura anónima (H01, la subida al Storage de H04) están confirmados leyendo las políticas, no ejecutándolos. La lectura anónima de vistas (H02) sí se confirmó.
- **No se llamó a ARCA**, ni a BCRA, BNA, DolarAPI, Anthropic, Resend ni Gmail. El total "real" de cada factura se tomó de lo enviado y guardado en `fiscal_emission_attempts`.
- **No se levantó el servidor ni se abrió ninguna pantalla.** Todo lo de "la pantalla muestra X" se dedujo del código y de los datos, no se vio.

## Cobertura

| Área | Cobertura | Lo que no se revisó |
|---|---|---|
| Comercial | alta | `presupuestos-lista.tsx` completo (PDF, envío por mail, panel de OC del cliente, asistente-pr), `/api/ai` y seguimiento-mensaje, alta de clientes en detalle, RLS por vendedor, la campana de alertas |
| Compras | media-alta | `ordenes-compra/page.tsx`, `cargar-factura-oc.tsx` y `conciliacion-compras.tsx` completos (solo sus guardados), RPC de ajuste de OC y de NC de compra, envío de OC por mail; pruebas de matching sin correr |
| Finanzas | media | IVA, Reportes y Facturar en detalle, importación del extracto BBVA (parser de 760 líneas), OP en US$ pagadas en pesos y liquidaciones FX, cobro masivo, rechazo de cheque por dentro, préstamos y tarjetas, `finanzas-vieja` línea por línea |
| Facturación y logística | media-alta | `arca-wsfecred-node.ts`, PDF de la factura, envío de factura por mail, lectura de remitos con IA, CAI. Grupo LA casi no tiene datos (1 factura, 1 remito), así que lo multi-sociedad se verificó solo por código |
| Integraciones e IA | media | Varias rutas de IA solo por grep (modelo, escrituras): parse-vep, certificados, documento impositivo, leer-foto, sugerir-proveedor, normalizar-oc, entre otras. Archivos huérfanos del Storage. Configuración real de Vercel |
| Base y seguridad | media-alta | Las 176 migraciones una por una, el cuerpo completo de las RPC grandes de pago, cobro y NC, y las tablas menores de configuración |
| Flujos | alta en venta y compra | Base mensual de retención RG 830 en profundidad, personalización (0 datos), liquidaciones FX, stock (0 productos) |
| Arquitectura y QA | media | Se corrieron 42 de unas 160 pruebas; las que tocan base, red o ARCA no se corrieron. Rendimiento en el navegador |

## Contexto que hay que tener en cuenta
- **Hay cambios sin publicar en la carpeta** de otros chats (por ejemplo, `presupuestos-lista.tsx` modificado y migraciones nuevas sin commitear). La auditoría leyó el estado de la carpeta. Algunas referencias de línea pueden no coincidir con lo que está en producción.
- **Módulos sin uso real** (stock con 0 productos, personalización sin datos, muestras casi sin uso, agente de mail apagado): sus problemas son riesgos para cuando se usen, no daños actuales.
- Las cifras de datos (por ejemplo "4 OC de PR rechazados ≈ $19,1 M" o "20 de 120 facturas con total distinto") son **de hoy, 28/10/2026**.
- Un agente citó mal un rango de líneas (`oc-lista.ts:412-435`, cuando el archivo tiene 101 líneas). El revisor lo corrigió (la lógica está en 39-42). Puede haber otros desvíos menores de líneas; los archivos y funciones citados sí se verificaron.

## Nivel de confianza

| Conclusión | Confianza |
|---|---|
| Hay problemas estructurales reales (reglas copiadas, dos fuentes de verdad, multi-paso sin transacción) | **Alta**: muchos ejemplos independientes, confirmados por varios agentes y por el revisor cruzado |
| Los 51 hallazgos confirmados | **Alta** en que existen; **media** en la severidad exacta de algunos medios |
| Los 11 probables | **Media**: hace falta validarlos con datos o con Augusto (por ejemplo, si un pago doble fue a propósito) |
| Exposición por clave anónima | **Alta** en la lectura (ejecutada); **alta** en la escritura según las políticas, pero no ejecutada |
| Lo que está bien hecho (cobros, OP, emisión ARCA, IA que no guarda sola) | **Alta** |
| Cobertura de "todos los módulos" | Se identificaron todos los módulos visibles (86 módulos y submódulos). La profundidad varía según la tabla de arriba |
