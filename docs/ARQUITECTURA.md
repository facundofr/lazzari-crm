# Arquitectura y circuitos — CRM Lazzari

Sacado de CLAUDE.md para que gaste menos uso. Leer antes de tocar código.

## Arquitectura

- **Next.js 15 (App Router) + React 18 + TypeScript + Tailwind 4.** Las APIs de Next 15 pueden diferir de lo que conocés: ver `crm/app/AGENTS.md`.
- **Supabase**:
  - Auth, Postgres con RLS y funciones `security definer` para operaciones de plata, Storage.
  - Proyecto `ycuzszzskqatlegtbgbq`.
- **Vercel**:
  - Root `crm/app`.
  - Crons en `vercel.json`: cotización BNA, vencimiento de presupuestos, BCRA diario.
- **IA**: `@anthropic-ai/sdk`, con modelos Sonnet y Haiku de respaldo. Se usa para leer facturas, OC, comprobantes y listas, conciliar compras, cotización express y ordenar OC.

### Carpetas clave (`crm/app/src`)

```
app/(crm)/          módulos: clientes, proveedores, presupuestos, muestras, oportunidades, ventas,
                    compras-lazza (Compras), remitos, transportes, finanzas,
                    facturacion, reportes, dashboard, calendario, stock, configuracion, papelera
app/api/            rutas de servidor (IA, ARCA, BCRA, crons, email)
components/         componentes grandes (conciliacion-compras, cargar-factura-oc, plan-pagos,
                    limpieza-oc, clientes/ficha-360, clientes/bcra-card, presupuestos/cotizacion-express)
components/ui/      Badge, Card, Modal, DataTable, SmartFilters, Toast, Input, Autocompletar
lib/                lógica pura y testeable (purchase-matching, plan-pagos, oportunidades, bcra,
                    catalogo-busqueda, paginar, utils, types, app-version)
supabase/migrations + supabase/rollback   (en crm/app)
```

### Patrones del código

- Páginas `"use client"`: cargan datos en `useEffect` y muestran tabla + panel lateral.
- Tablas que no están en los tipos generados: `(supabase as any).from("tabla")`.
- **Supabase devuelve como máximo 1000 filas por consulta**: para listados grandes usar `traerTodo()` de `lib/paginar.ts`.
- Mutaciones: siempre revisar `{ error }` y avisar si falla.
- Monedas ARS/USD en todo el sistema: `formatCurrency(monto, moneda)`; fechas con `formatDate()`.
- Badges: `default | success | warning | danger | info | purple | orange | outline`.
- `useEffect` con dependencias primitivas (`x?.id`), no objetos.
- Archivos grandes (finanzas 490 KB, presupuestos, facturación, clientes): editar con cambios puntuales o scripts Python, nunca reescribirlos enteros. Respetar los finales de línea CRLF donde existan.
- Buscadores: usar campos donde se escribe y filtra (`Autocompletar`), no desplegables largos.
- Donde se carga un monto, poner la ✨ que lo autocompleta.

### Circuitos importantes

- **Compras**:
  - Estados en tres ejes: mercadería, factura y pago.
  - Facturas de compra: un solo circuito. La carga masiva manda a conciliación por renglón cuando hay OC con renglones; si no, va a la carga simple.
  - Memoria de equivalencias por proveedor en `proveedor_equivalencias`.
  - Talles especiales y tolerancia de precio por proveedor.
  - "Cerrar saldo" de OC.
- **Pagos**:
  - Las órdenes de pago usan las RPC seguras `registrar_pago_proveedor_seguro` y `registrar_pago_proveedor_con_nc`, con `request_key` idempotente.
  - El **Plan de pagos** (`pagos_lotes`) calcula la retención de Ganancias RG 830 por mes acumulado y arma el resumen bancario, que se exporta a Excel.
  - Los comprobantes se cargan en masa con IA.
- **Personalización**: la pantalla se borró el 29/10/2026 (nunca se usó; `/personalizacion` redirige a Compras Lazza).
  - Los talleres siguen siendo proveedores con `es_personalizador` (filtro Talleres en Proveedores). Las tablas `personalizacion_*` se borraron (migración 20261029180000; estaban vacías).
- **Muestras**:
  - Renglones libres o tomados de la lista de costos, con valor opcional.
  - Cada renglón termina como Devolvió, Se la quedó o Baja/regalo.
  - Estados: En el cliente / Devolución parcial / Devuelto / Cerrado, con aviso a los 30 días.
- **Clientes**:
  - **Ficha 360** (pestaña del cliente): presupuestos con renglones, artículos con precios, facturas, cobros, muestras, BCRA y oportunidades.
  - Página **Oportunidades**: recompra, temporada, reactivar, complementarios y dormidos.
- **BCRA**:
  - Central de Deudores, API pública sin clave.
  - Se guarda un informe por cliente y por mes en `cliente_bcra_informes`, con semáforo.
  - Si un cliente empeora, deja aviso en `alertas`.
  - En presupuestos y facturación muestra un aviso, nunca bloquea.

### Variables de entorno (solo nombres; los valores nunca se piden ni se muestran)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (solo servidor/crons), `ANTHROPIC_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, variables `ARCA_*` (solo en Vercel).

### Storage

Buckets: `certificados`, `comprobantes`, `facturas-compra`, `presupuestos`.

