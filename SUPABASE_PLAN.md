# PLAN MAESTRO — Supabase para Lazzari CRM

**Proyecto:** LAZZARI (`ycuzszzskqatlegtbgbq`)
**Region:** us-west-2
**Fecha:** 19 May 2026

---

## ARQUITECTURA GENERAL

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                       │
│  Auth UI  │  CRM Pages  │  Realtime Listeners  │  Storage UI   │
└─────┬──────────┬──────────────┬───────────────────┬─────────────┘
      │          │              │                   │
      ▼          ▼              ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SUPABASE PLATFORM                           │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │   AUTH    │  │ POSTGRES │  │ REALTIME  │  │ STORAGE  │       │
│  │          │  │          │  │          │  │          │       │
│  │ - Email  │  │ - 25+    │  │ - Alertas│  │ - PDFs   │       │
│  │ - Magic  │  │   tablas │  │ - Stock  │  │ - Listas │       │
│  │   Link   │  │ - RLS    │  │ - Presupu│  │ - Factur │       │
│  │ - Invite │  │ - Triggers│ │ - Notific│  │ - Extrac │       │
│  │   Only   │  │ - Views  │  │          │  │          │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                                                 │
│  ┌──────────────────────────┐  ┌───────────────────────┐       │
│  │     EDGE FUNCTIONS       │  │   PG CRON (futuro)    │       │
│  │                          │  │                       │       │
│  │ - AFIP (WSFE)            │  │ - Vencimiento PRs     │       │
│  │ - Email (PR/FC)          │  │ - Alertas automáticas │       │
│  │ - IA (OCR facturas)      │  │ - Conciliación        │       │
│  │ - PDF generation         │  │ - Backup              │       │
│  └──────────────────────────┘  └───────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## FASE 1: SCHEMA DE BASE DE DATOS

### 1.1 Extensiones necesarias

```sql
-- Ya instaladas: uuid-ossp, pgcrypto
-- Habilitar:
- moddatetime     -- auto-update de updated_at
- pg_trgm         -- busqueda fuzzy (LIKE, trigrams) para clientes/productos
- unaccent        -- busqueda sin acentos (cafe = café)
```

### 1.2 Tablas del sistema (15 tablas core + 12 tablas de items/detalle)

#### CAPA 1 — Auth y Usuarios

```
profiles
├── id (uuid, FK → auth.users)
├── full_name (text)
├── email (text)
├── role (enum: super_admin, admin, vendedor, administrativo, viewer)
├── avatar_url (text)
├── active (boolean, default true)
├── created_at / updated_at
```

**Decisión clave:** No crear tabla `users` propia. Usar `auth.users` de Supabase + tabla `profiles` con trigger on_auth_user_created. Esto nos da login, magic links, password reset, MFA gratis.

**Flujo de invitación:** Solo super_admin/admin pueden invitar. Se usa `supabase.auth.admin.inviteUserByEmail()` desde Edge Function. Al aceptar, el trigger crea el profile.

#### CAPA 2 — Entidades principales

```
clientes                              proveedores
├── id (uuid, PK)                     ├── id (uuid, PK)
├── type (enum: empresa, persona)     ├── razon_social (text)
├── razon_social (text)               ├── cuit (text, UNIQUE)
├── cuit (text, UNIQUE)               ├── condicion_iva (enum)
├── condicion_iva (enum)              ├── email (text)
├── email (text)                      ├── telefono (text)
├── telefono (text)                   ├── direccion (text)
├── direccion (text)                  ├── localidad (text)
├── localidad (text)                  ├── provincia (text)
├── provincia (text)                  ├── rubro (text)
├── cp (text)                         ├── forma_pago (text)
├── lista_precio (text)              ├── dias_cuenta_corriente (int)
├── dias_cuenta_corriente (int)       ├── limite_credito (numeric)
├── forma_pago (text)                ├── saldo_cuenta_corriente (numeric)
├── limite_credito (numeric)          ├── notas (text)
├── saldo_cuenta_corriente (numeric)  ├── activo (boolean)
├── notas (text)                      ├── created_at / updated_at
├── activo (boolean)                  └── created_by (uuid, FK → profiles)
├── assigned_to (uuid, FK → profiles)
├── created_at / updated_at
└── created_by (uuid, FK → profiles)

cliente_sucursales                    cliente_contactos / proveedor_contactos
├── id (uuid, PK)                     ├── id (uuid, PK)
├── cliente_id (FK → clientes)        ├── entity_id (uuid) -- cliente o proveedor
├── nombre (text)                     ├── entity_type (enum: cliente, proveedor)
├── direccion, localidad, etc.        ├── nombre, cargo, email, telefono
└── telefono                          ├── principal (boolean)
                                      └── created_at
```

**Por qué tablas separadas para sucursales y contactos:** Evita arrays JSON. Permite buscar contactos cross-entity, filtrar por principal, y escalar sin límite.

#### CAPA 3 — Productos y Listas de Precios

```
productos
├── id (uuid, PK)
├── codigo (text, UNIQUE) -- VAL-001, CAÑ-015
├── nombre (text)
├── categoria (text) -- FK futuro a tabla categorias
├── proveedor_id (uuid, FK → proveedores, NULLABLE)
├── precio_costo (numeric)
├── moneda_costo (enum: USD, ARS)
├── unidad (text) -- u, m, kg, l
├── iva (numeric) -- 21, 10.5, 27, 0
├── stock (integer, default 0)
├── stock_minimo (integer, default 0)
├── activo (boolean)
├── created_at / updated_at
└── search_vector (tsvector, GENERATED) -- full-text search

listas_precios
├── id (uuid, PK)
├── nombre (text)
├── proveedor_id (uuid, FK → proveedores)
├── moneda (enum: USD, ARS)
├── vigencia_desde (date)
├── vigencia_hasta (date)
├── estado (enum: vigente, vencida, borrador)
├── archivo_origen (text) -- path en Storage
├── notas (text)
├── created_at / updated_at
└── created_by (uuid, FK → profiles)

lista_precios_items
├── id (uuid, PK)
├── lista_id (uuid, FK → listas_precios, ON DELETE CASCADE)
├── codigo (text)
├── descripcion (text)
├── categoria (text)
├── unidad (text)
├── precio (numeric) -- precio de lista
├── descuento (numeric) -- % descuento
├── precio_neto (numeric, GENERATED: precio * (1 - descuento/100))
└── producto_id (uuid, FK → productos, NULLABLE) -- match con catálogo
```

**Decisión clave — Listas de precios:** Los items de lista tienen su propio `codigo` y `descripcion` porque vienen del proveedor y no siempre matchean 1:1 con nuestro catálogo. El campo `producto_id` es opcional y se llena cuando se vincula manualmente o por matching automático.

#### CAPA 4 — Presupuestos (el corazón del negocio)

```
presupuestos
├── id (uuid, PK)
├── numero (text, UNIQUE) -- PR-2026-0049 (auto-generado)
├── cliente_id (uuid, FK → clientes)
├── fecha (date)
├── vencimiento (date)
├── estado (enum: borrador, pendiente, aprobado, rechazado, postergado, vencido)
├── motivo_rechazo (text)
├── markup_general (numeric) -- % default para items
├── subtotal (numeric)
├── iva (numeric)
├── total (numeric)
├── moneda (enum: USD, ARS)
├── observaciones (text)
├── enviado_at (timestamptz)
├── respondido_at (timestamptz)
├── created_by (uuid, FK → profiles)
├── created_at / updated_at
└── version (integer, default 1) -- para historial de versiones

presupuesto_items
├── id (uuid, PK)
├── presupuesto_id (uuid, FK → presupuestos, ON DELETE CASCADE)
├── producto_id (uuid, FK → productos, NULLABLE)
├── codigo (text)
├── descripcion (text)
├── categoria (text)
├── cantidad (numeric)
├── unidad (text)
├── precio_costo (numeric) -- congelado al momento de crear
├── markup_porcentaje (numeric)
├── precio_venta (numeric, GENERATED)
├── subtotal (numeric, GENERATED)
├── iva_porcentaje (numeric) -- 21, 10.5, etc
├── iva (numeric, GENERATED)
├── total (numeric, GENERATED)
└── orden (integer) -- para mantener orden de filas
```

**Decisión clave — Precios congelados:** `precio_costo` se copia al crear el item (no es FK). Así cuando reabren un PR viejo, ven el costo original, no el actual. Esto es CRITICO para el negocio.

**Decisión clave — Numeración:** Secuencia por año: `PR-{año}-{seq:4}`. Implementada con función PG + trigger before insert.

#### CAPA 5 — Facturación

```
facturas
├── id (uuid, PK)
├── tipo (enum: FA, FB, FC, NCA, NCB, NCC, NDA, NDB, NDC)
├── punto_venta (integer)
├── numero (integer)
├── cliente_id (uuid, FK → clientes)
├── presupuesto_id (uuid, FK → presupuestos, NULLABLE)
├── fecha (date)
├── cae (text) -- de AFIP
├── cae_vencimiento (date)
├── subtotal (numeric)
├── iva (numeric)
├── total (numeric)
├── estado (enum: emitida, pagada, anulada, vencida)
├── pdf_url (text) -- path en Storage
├── created_at
└── created_by (uuid, FK → profiles)

factura_items
├── id (uuid, PK)
├── factura_id (uuid, FK → facturas, ON DELETE CASCADE)
├── descripcion (text)
├── cantidad (numeric)
├── precio_unitario (numeric)
├── iva_porcentaje (numeric)
├── subtotal (numeric)
└── orden (integer)
```

#### CAPA 6 — Remitos

```
remitos
├── id (uuid, PK)
├── numero (text, UNIQUE) -- R-2026-0012
├── cliente_id (uuid, FK → clientes)
├── presupuesto_id (uuid, FK → presupuestos, NULLABLE)
├── factura_id (uuid, FK → facturas, NULLABLE)
├── fecha (date)
├── cae (text)
├── estado (enum: pendiente, entregado, parcial)
├── observaciones (text)
├── pdf_url (text)
├── created_at
└── created_by (uuid, FK → profiles)

remito_items
├── id (uuid, PK)
├── remito_id (uuid, FK → remitos, ON DELETE CASCADE)
├── producto_id (uuid, FK → productos, NULLABLE)
├── descripcion (text)
├── cantidad (numeric)
├── unidad (text)
└── orden (integer)
```

#### CAPA 7 — Ordenes de Compra

```
ordenes_compra
├── id (uuid, PK)
├── numero (text, UNIQUE) -- OC-2026-0033
├── proveedor_id (uuid, FK → proveedores)
├── fecha (date)
├── fecha_entrega_estimada (date)
├── estado (enum: borrador, enviada, confirmada, recibida_parcial, recibida, cancelada)
├── subtotal (numeric)
├── iva (numeric)
├── total (numeric)
├── moneda (enum: USD, ARS)
├── presupuesto_origen_id (uuid, FK → presupuestos, NULLABLE)
├── observaciones (text)
├── created_by (uuid, FK → profiles)
├── created_at / updated_at

orden_compra_items
├── id (uuid, PK)
├── orden_id (uuid, FK → ordenes_compra, ON DELETE CASCADE)
├── producto_id (uuid, FK → productos, NULLABLE)
├── codigo (text)
├── descripcion (text)
├── cantidad (numeric)
├── cantidad_recibida (numeric, default 0)
├── unidad (text)
├── precio_unitario (numeric)
├── subtotal (numeric)
└── orden (integer)
```

#### CAPA 8 — Finanzas

```
movimientos
├── id (uuid, PK)
├── tipo (enum: cobro, pago, cheque_emitido, cheque_recibido, transferencia, efectivo)
├── cliente_id (uuid, FK → clientes, NULLABLE)
├── proveedor_id (uuid, FK → proveedores, NULLABLE)
├── factura_id (uuid, FK → facturas, NULLABLE)
├── descripcion (text)
├── monto (numeric)
├── fecha (date)
├── conciliado (boolean, default false)
├── extracto_movimiento_id (uuid, FK, NULLABLE) -- link con extracto
├── created_at
└── created_by (uuid, FK → profiles)

extractos_bancarios
├── id (uuid, PK)
├── banco (text)
├── cuenta (text)
├── periodo (text)
├── fecha_upload (timestamptz)
├── archivo (text) -- path en Storage
├── total_creditos (numeric)
├── total_debitos (numeric)
├── estado (enum: procesando, parcial, conciliado)
├── created_at
└── created_by (uuid, FK → profiles)

extracto_movimientos
├── id (uuid, PK)
├── extracto_id (uuid, FK → extractos_bancarios, ON DELETE CASCADE)
├── fecha (date)
├── descripcion (text)
├── referencia (text)
├── monto (numeric)
├── tipo (enum: credito, debito)
├── match_factura_id (uuid, FK → facturas, NULLABLE)
├── match_cliente_id (uuid, FK → clientes, NULLABLE)
├── match_proveedor_id (uuid, FK → proveedores, NULLABLE)
├── estado (enum: matcheado, pendiente, ignorado)
└── created_at

lineas_credito
├── id (uuid, PK)
├── entidad (text) -- nombre del banco o proveedor
├── tipo (enum: bancaria, proveedor)
├── proveedor_id (uuid, FK → proveedores, NULLABLE)
├── monto_total (numeric)
├── monto_utilizado (numeric)
├── monto_disponible (numeric, GENERATED: monto_total - monto_utilizado)
├── moneda (enum: USD, ARS)
├── tasa (numeric, NULLABLE) -- solo bancarias
├── vencimiento (date)
├── estado (enum: activa, vencida, suspendida)
├── notas (text)
├── created_at / updated_at
└── created_by (uuid, FK → profiles)
```

#### CAPA 9 — Sistema (audit, alertas, config)

```
activity_log
├── id (uuid, PK)
├── user_id (uuid, FK → profiles)
├── action (text) -- create, update, delete, login, export
├── module (text) -- clientes, presupuestos, etc.
├── entity_id (uuid, NULLABLE)
├── entity_type (text) -- tabla afectada
├── details (text)
├── metadata (jsonb) -- datos extra (IP, user-agent, diff)
├── created_at (timestamptz, default now())

alertas
├── id (uuid, PK)
├── type (enum: vencimiento_pr, stock_bajo, cc_vencida, cheque_proximo, seguimiento, oc_pendiente)
├── title (text)
├── description (text)
├── entity_id (uuid, NULLABLE)
├── entity_type (text)
├── module (text)
├── user_id (uuid, FK → profiles, NULLABLE) -- NULL = para todos
├── read (boolean, default false)
├── created_at (timestamptz)

configuracion
├── id (uuid, PK)
├── key (text, UNIQUE) -- empresa_nombre, empresa_cuit, punto_venta, etc.
├── value (jsonb)
├── updated_at
└── updated_by (uuid, FK → profiles)

numeracion_secuencias
├── id (uuid, PK)
├── tipo (text, UNIQUE) -- presupuesto, factura, remito, orden_compra
├── prefijo (text) -- PR, FA, R, OC
├── anio (integer)
├── ultimo_numero (integer, default 0)
└── updated_at
```

---

## FASE 2: ENUMS (tipos PostgreSQL)

```sql
-- Todos los enums centralizados
CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'vendedor', 'administrativo', 'viewer');
CREATE TYPE client_type AS ENUM ('empresa', 'persona');
CREATE TYPE condicion_iva AS ENUM ('RI', 'Monotributo', 'Exento', 'CF');
CREATE TYPE moneda AS ENUM ('USD', 'ARS');
CREATE TYPE pr_status AS ENUM ('borrador', 'pendiente', 'aprobado', 'rechazado', 'postergado', 'vencido');
CREATE TYPE comprobante_type AS ENUM ('FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC');
CREATE TYPE factura_status AS ENUM ('emitida', 'pagada', 'anulada', 'vencida');
CREATE TYPE remito_status AS ENUM ('pendiente', 'entregado', 'parcial');
CREATE TYPE oc_status AS ENUM ('borrador', 'enviada', 'confirmada', 'recibida_parcial', 'recibida', 'cancelada');
CREATE TYPE movimiento_tipo AS ENUM ('cobro', 'pago', 'cheque_emitido', 'cheque_recibido', 'transferencia', 'efectivo');
CREATE TYPE extracto_mov_tipo AS ENUM ('credito', 'debito');
CREATE TYPE extracto_mov_estado AS ENUM ('matcheado', 'pendiente', 'ignorado');
CREATE TYPE extracto_estado AS ENUM ('procesando', 'parcial', 'conciliado');
CREATE TYPE linea_credito_tipo AS ENUM ('bancaria', 'proveedor');
CREATE TYPE linea_credito_estado AS ENUM ('activa', 'vencida', 'suspendida');
CREATE TYPE lista_estado AS ENUM ('vigente', 'vencida', 'borrador');
CREATE TYPE alerta_tipo AS ENUM ('vencimiento_pr', 'stock_bajo', 'cc_vencida', 'cheque_proximo', 'seguimiento', 'oc_pendiente');
CREATE TYPE contacto_entity_type AS ENUM ('cliente', 'proveedor');
```

---

## FASE 3: ROW LEVEL SECURITY (RLS)

### Principios:
1. **Todo bloqueado por default** — RLS enabled en TODAS las tablas
2. **Profiles determina acceso** — El rol viene de `profiles.role`
3. **Vendedores solo ven lo suyo** — Filtro por `assigned_to` o `created_by`
4. **Viewers solo lectura** — Sin INSERT/UPDATE/DELETE

### Políticas principales:

```
profiles:
  - SELECT: authenticated users (todos ven perfiles para mostrar nombres)
  - UPDATE: solo su propio perfil o admin+

clientes:
  - SELECT: todos los roles ven todos (necesario para presupuestos)
  - INSERT: admin, vendedor, administrativo
  - UPDATE: admin, vendedor (solo sus asignados), administrativo
  - DELETE: solo admin+

presupuestos:
  - SELECT: admin/administrativo ven todos, vendedor solo los suyos (created_by)
  - INSERT: admin, vendedor
  - UPDATE: admin (todos), vendedor (solo suyos en estado borrador/pendiente)
  - DELETE: admin (solo borradores)

facturas / remitos:
  - SELECT: admin, administrativo, viewer
  - INSERT: admin, administrativo
  - UPDATE: admin, administrativo
  - DELETE: solo super_admin (anulación)

movimientos / extractos / lineas_credito:
  - SELECT: admin, administrativo
  - INSERT: admin, administrativo
  - UPDATE: admin, administrativo
  - DELETE: solo admin

proveedores / listas_precios:
  - SELECT: todos
  - INSERT: admin, administrativo
  - UPDATE: admin, administrativo
  - DELETE: admin

activity_log:
  - SELECT: admin+
  - INSERT: via trigger (no directo)

alertas:
  - SELECT: filtrado por user_id o NULL (globales)
  - UPDATE: solo marcar como read el propio usuario
```

---

## FASE 4: TRIGGERS Y FUNCIONES

### 4.1 Auto-profile on signup
```
trigger: on_auth_user_created
→ Crea fila en profiles con datos del invite
→ Asigna rol default (viewer) o el que vino en metadata del invite
```

### 4.2 Auto-timestamps
```
trigger: handle_updated_at (en TODAS las tablas con updated_at)
→ Usa moddatetime para auto-setear updated_at = now()
```

### 4.3 Numeración automática
```
function: generate_document_number(tipo, prefijo)
→ SELECT ultimo_numero + 1 FROM numeracion_secuencias WHERE tipo = $1 AND anio = extract(year from now())
→ INSERT si no existe el año, UPDATE si existe
→ RETURN '{prefijo}-{anio}-{seq:04d}'
→ Se usa FOR UPDATE para evitar race conditions

trigger: before INSERT en presupuestos, facturas, remitos, ordenes_compra
→ Llama a generate_document_number() si numero IS NULL
```

### 4.4 Vencimiento automático de PRs
```
function: check_presupuestos_vencidos()
→ UPDATE presupuestos SET estado = 'vencido' WHERE estado = 'pendiente' AND vencimiento < CURRENT_DATE
→ INSERT en alertas por cada PR que vence

pg_cron: ejecutar diariamente a las 00:00 (futuro, requiere plan pro o Edge Function con cron)
```

### 4.5 Stock bajo — alertas automáticas
```
trigger: after UPDATE en productos (columna stock)
→ IF NEW.stock <= NEW.stock_minimo AND NEW.stock > 0 → INSERT alerta stock_bajo
→ IF NEW.stock = 0 → INSERT alerta URGENTE
```

### 4.6 Recalculo de saldo CC
```
function: recalcular_saldo_cliente(cliente_id)
→ SUM movimientos WHERE cliente_id = $1 GROUP BY tipo
→ UPDATE clientes SET saldo_cuenta_corriente = resultado

trigger: after INSERT/UPDATE/DELETE en movimientos
→ Llama a recalcular_saldo_cliente si cliente_id IS NOT NULL
→ Llama a recalcular_saldo_proveedor si proveedor_id IS NOT NULL
```

### 4.7 Audit log automático
```
function: log_activity()
→ INSERT en activity_log con TG_TABLE_NAME, TG_OP, OLD/NEW diff
→ Se aplica a tablas críticas: clientes, presupuestos, facturas, remitos, ordenes_compra
```

### 4.8 Auto-estado en OC
```
trigger: after UPDATE en orden_compra_items (cantidad_recibida)
→ Si TODOS los items tienen cantidad_recibida >= cantidad → estado = 'recibida'
→ Si ALGUNOS tienen cantidad_recibida > 0 → estado = 'recibida_parcial'
```

---

## FASE 5: VIEWS (consultas optimizadas)

```sql
-- Dashboard KPIs
v_dashboard_kpis
→ ventas_mes, ventas_mes_anterior, tasa_conversion, presupuestos_activos, etc.

-- Presupuestos con nombre de cliente y vendedor
v_presupuestos_completos
→ JOIN presupuestos + clientes + profiles (created_by)

-- Facturas pendientes de cobro
v_facturas_pendientes
→ facturas WHERE estado = 'emitida' con dias_vencida calculado

-- Stock con alerta
v_stock_alertas
→ productos WHERE stock <= stock_minimo

-- Cuenta corriente de clientes
v_cuenta_corriente_clientes
→ clientes + SUM(movimientos) agrupado

-- Cuenta corriente de proveedores
v_cuenta_corriente_proveedores
→ proveedores + SUM(movimientos) agrupado

-- Comparador de precios entre proveedores
v_comparador_precios
→ lista_precios_items agrupado por codigo, pivoteado por proveedor
```

---

## FASE 6: INDEXES

```sql
-- Busqueda de clientes
CREATE INDEX idx_clientes_razon_social_trgm ON clientes USING gin (razon_social gin_trgm_ops);
CREATE INDEX idx_clientes_cuit ON clientes (cuit);
CREATE INDEX idx_clientes_assigned_to ON clientes (assigned_to);

-- Busqueda de productos
CREATE INDEX idx_productos_codigo ON productos (codigo);
CREATE INDEX idx_productos_search ON productos USING gin (search_vector);
CREATE INDEX idx_productos_categoria ON productos (categoria);
CREATE INDEX idx_productos_proveedor ON productos (proveedor_id);

-- Presupuestos
CREATE INDEX idx_presupuestos_cliente ON presupuestos (cliente_id);
CREATE INDEX idx_presupuestos_estado ON presupuestos (estado);
CREATE INDEX idx_presupuestos_fecha ON presupuestos (fecha DESC);
CREATE INDEX idx_presupuestos_created_by ON presupuestos (created_by);
CREATE INDEX idx_presupuestos_vencimiento ON presupuestos (vencimiento) WHERE estado = 'pendiente';

-- Facturas
CREATE INDEX idx_facturas_cliente ON facturas (cliente_id);
CREATE INDEX idx_facturas_estado ON facturas (estado);
CREATE INDEX idx_facturas_fecha ON facturas (fecha DESC);

-- Movimientos
CREATE INDEX idx_movimientos_cliente ON movimientos (cliente_id);
CREATE INDEX idx_movimientos_proveedor ON movimientos (proveedor_id);
CREATE INDEX idx_movimientos_fecha ON movimientos (fecha DESC);
CREATE INDEX idx_movimientos_conciliado ON movimientos (conciliado) WHERE conciliado = false;

-- Activity log
CREATE INDEX idx_activity_log_created ON activity_log (created_at DESC);
CREATE INDEX idx_activity_log_module ON activity_log (module);

-- Alertas
CREATE INDEX idx_alertas_user ON alertas (user_id) WHERE read = false;

-- Listas de precios
CREATE INDEX idx_listas_precios_proveedor ON listas_precios (proveedor_id);
CREATE INDEX idx_listas_precios_estado ON listas_precios (estado);
CREATE INDEX idx_lista_items_codigo ON lista_precios_items (codigo);

-- Ordenes de compra
CREATE INDEX idx_oc_proveedor ON ordenes_compra (proveedor_id);
CREATE INDEX idx_oc_estado ON ordenes_compra (estado);
```

---

## FASE 7: STORAGE BUCKETS

```
Buckets:
├── documentos/
│   ├── facturas/          -- PDFs generados de facturas
│   ├── remitos/           -- PDFs generados de remitos
│   ├── presupuestos/      -- PDFs generados de PRs
│   └── ordenes-compra/    -- PDFs de OCs
│
├── listas-precios/        -- Archivos Excel/PDF originales de proveedores
│   └── {proveedor_id}/
│
├── extractos/             -- Archivos de extractos bancarios
│   └── {banco}/
│
└── avatars/               -- Fotos de perfil de usuarios

Políticas:
- documentos: lectura para authenticated, escritura para admin/administrativo
- listas-precios: lectura todos, escritura admin/administrativo
- extractos: solo admin/administrativo
- avatars: lectura todos, escritura solo el propio usuario
```

---

## FASE 8: REALTIME

### Canales a suscribir:

```
1. alertas → INSERT → Notificación en header bell icon
2. presupuestos → UPDATE (estado) → Actualizar dashboard y lista de PRs
3. productos → UPDATE (stock) → Alertas de stock bajo en tiempo real
4. movimientos → INSERT → Actualizar dashboard de finanzas
```

Solo habilitamos Realtime en las tablas que realmente lo necesitan para no sobrecargar.

---

## FASE 9: EDGE FUNCTIONS (futuro cercano)

```
1. invite-user          -- Invitar usuario con rol específico
2. generate-pdf         -- Generar PDF de PR/FC/Remito/OC
3. send-email           -- Enviar PR por email al cliente
4. afip-facturar        -- Conectar con WSFE para obtener CAE
5. ocr-factura-compra   -- IA para extraer datos de FC proveedor (imagen/PDF → datos)
6. conciliar-extracto   -- Matching automático extracto vs movimientos
7. check-vencimientos   -- Cron diario: PRs vencidos, listas vencidas, alertas
```

---

## FASE 10: PLAN DE EJECUCION

### Migración 001 — Foundation (HACER AHORA)
- Extensiones (moddatetime, pg_trgm, unaccent)
- Todos los ENUMs
- Tabla profiles + trigger on_auth_user_created
- Tabla configuracion + numeracion_secuencias
- Función handle_updated_at

### Migración 002 — Entidades core
- clientes + cliente_sucursales + contactos
- proveedores
- productos (con search_vector)

### Migración 003 — Listas de precios
- listas_precios + lista_precios_items
- Indexes de búsqueda

### Migración 004 — Presupuestos
- presupuestos + presupuesto_items
- Función generate_document_number
- Trigger de numeración automática

### Migración 005 — Facturación y remitos
- facturas + factura_items
- remitos + remito_items

### Migración 006 — Ordenes de compra
- ordenes_compra + orden_compra_items
- Trigger auto-estado recepción

### Migración 007 — Finanzas
- movimientos
- extractos_bancarios + extracto_movimientos
- lineas_credito
- Trigger recalculo saldo CC

### Migración 008 — Sistema
- activity_log + trigger audit
- alertas + trigger stock bajo
- Trigger vencimiento PRs

### Migración 009 — RLS
- Habilitar RLS en TODAS las tablas
- Crear todas las políticas

### Migración 010 — Views e indexes finales
- Todas las views del dashboard
- Indexes de performance

### Migración 011 — Seed data
- Configuración empresa (nombre, CUIT, punto venta)
- Usuario admin inicial
- Datos de ejemplo (opcional, para demo)

---

## FASE 11: INTEGRACION FRONTEND

### Estructura de archivos a crear:

```
crm/app/src/lib/
├── supabase/
│   ├── client.ts          -- createBrowserClient()
│   ├── server.ts          -- createServerClient() para Server Components
│   ├── middleware.ts       -- Auth middleware
│   ├── types.ts           -- Types generados automáticamente
│   └── queries/
│       ├── clientes.ts    -- CRUD clientes
│       ├── presupuestos.ts
│       ├── productos.ts
│       ├── proveedores.ts
│       ├── facturas.ts
│       ├── remitos.ts
│       ├── ordenes-compra.ts
│       ├── finanzas.ts
│       ├── alertas.ts
│       └── dashboard.ts   -- KPIs y stats
```

### Paquetes npm necesarios:

```
@supabase/supabase-js    -- Cliente principal
@supabase/ssr            -- Server-side rendering helpers
```

### Flujo de auth:

```
1. /login → Email + password (o magic link)
2. Middleware verifica sesión en cada request
3. Si no hay sesión → redirect a /login
4. Si hay sesión → cargo profile con rol
5. Sidebar se filtra según rol
6. Cada query pasa por RLS automáticamente
```

---

## RESUMEN DE TABLAS (27 total)

| # | Tabla | Items/Detalle | Relación |
|---|---|---|---|
| 1 | profiles | - | auth.users |
| 2 | clientes | sucursales, contactos | assigned_to → profiles |
| 3 | proveedores | contactos | - |
| 4 | productos | - | proveedor_id → proveedores |
| 5 | listas_precios | lista_precios_items | proveedor_id → proveedores |
| 6 | presupuestos | presupuesto_items | cliente_id, created_by |
| 7 | facturas | factura_items | cliente_id, presupuesto_id |
| 8 | remitos | remito_items | cliente_id, presupuesto_id, factura_id |
| 9 | ordenes_compra | orden_compra_items | proveedor_id, presupuesto_origen_id |
| 10 | movimientos | - | cliente/proveedor/factura |
| 11 | extractos_bancarios | extracto_movimientos | - |
| 12 | lineas_credito | - | proveedor_id |
| 13 | activity_log | - | user_id |
| 14 | alertas | - | user_id |
| 15 | configuracion | - | - |
| 16 | numeracion_secuencias | - | - |
| 17 | contactos | - | polimórfica (cliente/proveedor) |
| 18 | cliente_sucursales | - | cliente_id |

---

## PRIORIDAD DE EJECUCION

```
AHORA (esta sesión):
  → Migraciones 001-011 ejecutadas en Supabase
  → Seed data con los mock-data actuales
  → Instalar @supabase/supabase-js + @supabase/ssr
  → Crear client.ts + types generados
  → Conectar primera página (dashboard) a datos reales

PRÓXIMA SESIÓN:
  → Login page + middleware auth
  → CRUD completo de clientes
  → CRUD presupuestos con cálculos
  → Storage para listas de precios

FUTURO CERCANO:
  → Edge Functions (PDF, email, AFIP)
  → Realtime subscriptions
  → IA features (OCR, análisis)
