# Estado del proyecto — CRM Lazzari

Actualizado: 09/10/2026 · Versión publicada: **V1.1.412** (en curso: V1.1.413)

## 0. Arreglo urgente V1.1.411 (publicado, solo código, sin migración)

- **Oportunidades:** el vendedor del cliente se lee de `clientes.assigned_to`. Antes leía `vendedor_id`, que no existe, y la pantalla no cargaba.
- **Avisos (toast):** el objeto `toast` ahora es estable (`useMemo`). Antes, si una carga fallaba, el aviso se repetía sin parar en Oportunidades, Muestras, Personalización y Papelera.
- **Ficha 360 → Cobros:** ahora muestra todos los medios de cobro (transferencia, efectivo, cheque, retenciones, etc.). Antes buscaba solo el tipo "cobro" y faltaban la mayoría.
- **Cron BCRA:** trae clientes e informes de a páginas, así no quedan clientes sin revisar si hay más de 1000.
- Revisado: las columnas que usan las pantallas nuevas existen en la base. Se verificó solo leyendo.

## 0.c V1.1.413 (sin migración)

- **Alta de cliente:** las sucursales se cargan en el mismo alta y se guardan junto con el cliente.
- **Reportes y Dashboard:**
  - El libro IVA resta las NC, excluye las compras anuladas y separa ARS de USD.
  - Los meses salen sin el corrimiento por zona horaria.
  - No hay listados cortados en 1000 filas.
  - Se sacaron los datos de ejemplo.
  - Lógica en `lib/reportes-comprobantes.ts`.
- **Diagnóstico financiero** completo en `DIAGNOSTICO-FINANCIERO.md`; propuestas de Reportes y Dashboard en `PROPUESTA-REPORTES-DASHBOARD.md`.
- **Correcciones financieras A MEDIAS** (Finanzas, Ventas, Compras: 3 migraciones y varios archivos):
  - Se cortaron por el límite de uso.
  - Están guardadas en `git stash` ("correcciones financieras a medias"). **No están publicadas.**
  - Para retomarlas: `git stash list` / `git stash apply`. Revisar todo antes de usar; hay un test roto (`scripts/test-saldo-factura-compra.ts`).

## 0.b V1.1.412 (publicada)

**Programado (falta publicar):**
- **Compras → OC:**
  - Se sacó el candado "Edición bloqueada".
  - Si la OC tiene factura, el botón Editar sale en amarillo, avisa y deja editar.
- **Proveedores → lista:**
  - Sin la fila de tarjetas de arriba.
  - Buscador, pestañas rápidas (Todos / Con deuda / Transportes / Talleres / Inactivos) y Exportar en una línea.
  - Columnas: Proveedor (con nombre de fantasía, CUIT y chip Transporte/Taller), Contacto (copiar y WhatsApp), Localidad, Saldo a pagar con total abajo, y Última compra.
  - Filas finas y botones al pasar el mouse.
  - **Saldo arreglado:** antes leía `proveedores.saldo_cuenta_corriente`, que nadie actualizaba (de ahí los -$66 M). Ahora se calcula igual que la cuenta corriente de Finanzas (`lib/saldo-proveedores.ts`).
- **Proveedores → alta:**
  - Secciones, CUIT primero y botones fijos abajo.
  - "¿Es transporte o taller?" con una sola opción.
  - Email de facturación + celular, con "+ email" y "+ celular" (se guardan en `contactos`).
  - Talles especiales y tolerancia se editan en Compras → Limpieza de OC.
  - IA de papeles impositivos.
- **Clientes → alta:**
  - Secciones y CUIT primero.
  - Email de cobranzas.
  - Aviso de duplicados en las dos sociedades.
  - Semáforo BCRA en vivo sin guardar (`/api/bcra/preview`).
  - Vendedor = el que lo crea.
  - IA de papeles impositivos.
- **Buscador (Autocompletar):**
  - Muestra resultados recién con 2 letras, como máximo 8, con el CUIT al lado.
  - Ojo: en Limpieza de OC ya no aparecen arriba los proveedores con pendientes al hacer clic.
- **Nombre de fantasía:**
  - Al guardar una factura de un proveedor existente, si no tenía nombre de fantasía, lo guarda solo.
  - Si tenía otro distinto, avisa y no lo pisa (`lib/nombre-fantasia.ts`).

**Pendiente, próximas tandas:**
0. **Cheque vs echeq:**
   - Hoy hay 3 criterios distintos: en Facturación "echeq" se guarda como cheque_recibido con una tilde; en Finanzas se usa tipo_cheque físico/echeq; la IA de cobros decide sola.
   - Unificar en "Cheque" con variante Físico / Electrónico, visible y editable en todas las pantallas.
   - Reglas claras para la IA (ID digital o la palabra ECHEQ = electrónico; si no se puede saber, "a confirmar" en amarillo).
   - Falta que Augusto diga dónde se confunde y pase un ejemplo.
0.b **Retenciones (A5 del diagnóstico):** comparar contra el archivo de Netegia que va a pasar Augusto, después de los arreglos financieros.
1. Alta de cliente: cargar sucursales en el mismo alta (hoy solo al editar); se guardan junto con el cliente.
2. "Para revisar" (idea 8): necesita mandar OC, clientes y proveedores a la Papelera, así que lleva migración.
3. Lista de costos dentro de Proveedores y listas centralizadas (idea 9).
4. Comisiones (idea 1) y Torneo (idea 7): faltan respuestas de Augusto.

## 0. Arreglo urgente V1.1.411 (publicado, solo código, sin migración)

- **Oportunidades:** el vendedor del cliente se lee de `clientes.assigned_to`. Antes leía `vendedor_id`, que no existe, y la pantalla no cargaba.
- **Avisos (toast):** el objeto `toast` ahora es estable (`useMemo`). Antes, si una carga fallaba, el aviso se repetía sin parar en Oportunidades, Muestras, Personalización y Papelera.
- **Ficha 360 → Cobros:** ahora muestra todos los medios de cobro (transferencia, efectivo, cheque, retenciones, etc.). Antes buscaba solo el tipo "cobro" y faltaban la mayoría.
- **Cron BCRA:** trae clientes e informes de a páginas, así no quedan clientes sin revisar si hay más de 1000.
- Revisado: las columnas que usan las pantallas nuevas existen en la base. Se verificó solo leyendo.

## 0.b En curso: V1.1.412 (sin publicar)

**Ya aplicado:**
- **Compras → OC:** se sacó el candado "Edición bloqueada". Si la OC tiene factura, el botón Editar sale en amarillo y avisa que la factura y los pagos no cambian, pero deja editar.

**Correcciones anotadas, sin aplicar (Augusto avisa cuándo):**
1. Buscador desplegable (`components/ui/autocompletar.tsx`, ej. Personalización → Logos por cliente): no le gusta que se abra la lista entera. Falta que elija el estilo nuevo.
2. Eliminar una OC con facturas vinculadas: hoy no se puede. Va al circuito "Para revisar" (idea 8 de IDEAS-PROXIMAS.md). Caso típico: se equivocaron de número de OC y la quieren corregir.
3. Proveedores → Nuevo proveedor: por defecto es de mercadería (no se marca nada). Solo si es transporte o taller se marca, y **una sola opción** (no las dos).
4. Rediseño de las ventanas de alta de **proveedor y cliente** (mismo criterio en las dos):
   - CUIT primero, con ARCA autocompletando.
   - Secciones con título y botones Guardar/Cancelar fijos abajo.
   - Espacios parejos, 3 columnas en pantallas anchas y tildes corregidas.
   - Proveedor:
     - Sacar "Talles especiales" del alta. Se sigue usando en Compras: definir dónde se edita.
     - Pedir **email de facturación** y **celular**, con "+ email" y "+ celular" para agregar más (no necesariamente de facturación).
     - Dejar retención de Ganancias y exclusión.
     - **IA que lee archivos impositivos del proveedor** (constancia de inscripción, certificado de exención de IVA o de retención) y completa los datos.
   - **Nombre de fantasía:** es importante, porque las listas de proveedores usan ese nombre.
     - CUIT, razón social y nombre de fantasía tienen que quedar siempre relacionados.
     - Si no se carga, no pasa nada: al cargar una factura de ese proveedor, la IA lo detecta y lo guarda sola (hoy solo lo hace al dar de alta un proveedor nuevo).
     - Augusto va a contar después otro tema que depende de esto.
   - Probablemente requiere migración aditiva para los emails y celulares extra del proveedor (los clientes ya usan la tabla `contactos`).
5. **Proveedores → lista:**
   - Sacar la fila de tarjetas de arriba (Proveedores / Deuda CC / Crédito total / Listas vigentes / Listas vencidas).
   - Rediseño estético y funcional propuesto, pendiente de OK.
   - Revisar el posible error: la tarjeta "Deuda CC" dice -$66 millones, pero todos los saldos de la tabla dan $0,00.

## 1. Tanda anterior publicada (V1.1.410)

Todo está en `C:\Users\lazza\lazzari\crm\app`: los tipos chequeados sin errores y el orden de hooks verificado.

**Migración (ya corrida):**
`crm/app/supabase/migrations/20261010100000_compras_pagos_personalizacion_muestras_bcra.sql`
- La vuelta atrás está en `crm/app/supabase/rollback/` con el mismo nombre.
- Se probó en una base de prueba: aplica bien, se puede volver a correr sin romper nada y la vuelta atrás funciona.

| Tema | Qué hace |
|---|---|
| **Ordenar OC abiertas** (Compras) | La IA vincula cada renglón escrito a mano con el artículo de la lista del proveedor y su talle; vos aprobás. Reglas por proveedor: talles especiales y tolerancia de precio. Cerrar o reabrir el saldo de una OC (sugerido si tiene más de 60 días o le queda menos del 15 %). |
| **Un solo circuito de facturas de compra** | La carga masiva manda cada factura a la conciliación por renglón si el proveedor tiene OC con renglones; si no, a la carga simple. Memoria de equivalencias por proveedor. Talles especiales ("T. ESP") repartidos entre talles grandes. |
| **Compras en 3 ejes** | Pestañas Por recibir / Por facturar / Por pagar / Completas. Cada OC muestra mercadería, factura y pago por separado. |
| **Plan de pagos** (Finanzas) | Junta lo pendiente por proveedor, calcula la retención de Ganancias RG 830 del mes, arma el resumen bancario (CUIT, CBU, alias, forma de pago), exporta a Excel y carga los comprobantes en masa con IA para registrar cada pago. |
| **Personalización** (menú nuevo) | Talleres de bordado y estampado, trabajos por cliente con prendas y costos, logos por cliente, liquidación mensual con factura o liquidación interna imprimible. |
| **Muestras** (rehecho) | Renglones libres o tomados de la lista de costos, valor opcional, Devolvió / Se la quedó / Baja-regalo con fecha, estados En el cliente / Parcial / Devuelto / Cerrado, aviso a los 30 días y valor en la calle. Los envíos viejos se siguen viendo. |
| **Ficha 360 del cliente** | La pestaña "Historial" pasa a ser "Ficha 360": todo lo cotizado con renglones, ganado o perdido, conversión, ticket promedio, frecuencia, artículos con último precio y rango, facturas, cobros, muestras, BCRA y oportunidades. |
| **Oportunidades** (menú nuevo) | A quién llamar y qué ofrecerle: recompra, temporada, volver a cotizar, complementarios y clientes dormidos. Filtro por vendedor. |
| **Informe BCRA** | Central de Deudores (gratis, sin clave): semáforo por cliente, deuda en bancos, cheques rechazados e historial de 24 meses. Se actualiza solo todos los meses (cron diario que avanza de a tandas) o con "Actualizar ahora". Si un cliente empeora, deja un aviso en la campanita. En presupuestos y facturación muestra un aviso, nunca bloquea. |

Para que el BCRA se actualice solo, en Vercel tienen que existir `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET`. Son solo nombres: **no mandes los valores a nadie**. Si no están, el botón "Actualizar ahora" y "Actualizar pendientes" funcionan igual.

## 2. Pendiente (próximas tandas)

El detalle de cada idea (comisiones, margen de José, ordenar pantallas, app de José, IA en la web) y sus preguntas abiertas está en **`IDEAS-PROXIMAS.md`**.

- **Archivo para BBVA Net Cash**: falta que Augusto pase el formato (layout) del banco. El botón ya está en el Plan de pagos, desactivado.
- **Cheques**: importar al CRM (Finanzas → cheques) los del "Flujo de Fondos" desde el 01/01/2026.
  - Ya están preparados en `C:\Users\lazza\lazzari\ideas\cheques_desde_2026.csv`. Son 695 cheques: 683 emitidos y 12 recibidos.
  - Hay 5 cheques con año de emisión "2925" en la planilla original: corregir.
  - Los 15 de Martín Fernández van marcados aparte.
- **Lista de costos en el CRM**: sumar fotos, rubro y marca, y las reglas comerciales de cada proveedor. Las listas se siguen actualizando solo en el chat de listas, con `catalogo_crm.csv` (16.482 artículos).
- **Ideas nuevas de Augusto**: se desarrollan primero por escrito, sin aplicar cambios.
- Centro de alertas unificado.
- Descuento visible en el PDF del presupuesto.
- Filtro por moneda en facturas de venta.
- Revisar las migraciones viejas de Manu que puede que no estén corridas (por ejemplo `es_transportista` en proveedores; la migración nueva ya la asegura).
- Seguridad: rotar la clave de Anthropic y activar MFA en Supabase y Vercel.

## 3. Cómo publicar (solo cuando Augusto lo pida)

1. Supabase → SQL Editor → pegar y correr la migración nueva del punto 1.
2. En PowerShell, desde `C:\Users\lazza\lazzari\crm\app`:
   ```
   npx.cmd tsc --noEmit
   git add src supabase scripts vercel.json
   git commit -m "V1.1.410: compras, plan de pagos, personalización, muestras, ficha 360, oportunidades y BCRA"
   git push
   vercel.cmd --prod
   ```
3. Probar en producción: Compras → Ordenar OC abiertas · Finanzas → Plan de pagos · Personalización · Muestras · un cliente → Ficha 360 → Actualizar BCRA · Oportunidades.
