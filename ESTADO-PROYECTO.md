# Estado del proyecto — CRM Lazzari

Actualizado: 09/10/2026 · Versión en la compu: **V1.1.410** (todavía **sin publicar**)

## 1. Listo en la compu, falta publicar (tanda grande)

Todo está en `C:\Users\lazza\lazzari\crm\app`: los tipos chequeados sin errores y el orden de hooks verificado.

**Antes de publicar hay que correr en Supabase:**
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
