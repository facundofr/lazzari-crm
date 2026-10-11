# CLAUDE.md — CRM Lazzari

Guía para Claude Code en este repositorio. Leela entera antes de tocar nada.
El estado actual del proyecto (qué está hecho, qué falta publicar y qué está pendiente) está en `docs/ESTADO.md`.

## El negocio

**Lazzari Soluciones Industriales** vende **ropa de trabajo, EPP (elementos de protección personal) y seguridad industrial** en Argentina:
calzado de seguridad, indumentaria, guantes, protección respiratoria, visual, auditiva y craneana, trabajo en altura, etc.
También hace **personalización** (bordado y estampado de logos de clientes) con talleres externos.
(No vende válvulas ni cañerías: eso estaba mal en la versión anterior de este archivo.)

Opera con dos sociedades:
- **Lazzari**: id `eee2a3c8-fe6c-494d-bd2f-7a5d8067d021`, color `#FF4500`, punto de venta 15, CUIT 20379309128.
- **Grupo LA**: id `fee94607-747a-4e87-ba24-aff9032f7a56`, color `#2563EB`, punto de venta 10, CUIT 30719396042.

Toda consulta que lee o escribe datos filtra por `sociedad_id` (`sociedadActiva` de `useUser()`).

## Quién es el usuario y cómo trabajar con él

- **Augusto** (dueño) maneja el sistema. **No es programador.** Manu, el desarrollador anterior, ya no trabaja en el proyecto.
- Hablale en **español rioplatense**, corto y claro. Cuando tenga que hacer algo, dale **pasos literales, uno por uno** (qué abrir, qué pegar, qué apretar).
- Trabaja en **Windows**. Repositorio: `C:\Users\lazza\lazzari`, app en `crm\app`. En PowerShell se usa `npx.cmd` y `vercel.cmd`.
- Los cambios van **directo a producción**, en **tandas**. **No le pases los comandos para publicar hasta que él lo pida**: se acumulan los cambios y él carga todo junto.
- Cuando algo haya que hacerlo en otro chat, **pasale directamente el prompt** listo para pegar.
- Quiere todo **prolijo**: probado, sin romper nada, sin perder datos.

## Reglas que no se rompen (textuales de Augusto)

1. **"Nada me puede frenar… Todo lo que propone el sistema o la IA es una sugerencia… La IA nunca me puede trabar."**
   - Nunca bloquear a un vendedor ni a una operación: **avisar y notificar**. Ejemplo: margen mínimo 15 %, BCRA en rojo, muestras con más de 30 días → aviso, nunca bloqueo.
2. **Claves y secretos:**
   - Nunca pedirle que mande o muestre claves de API ni el contenido de `.env.local`: **"No me mandes nunca el contenido completo del .env.local"**.
   - Nunca mostrar la `service_role` de Supabase.
   - No compartir secretos por WhatsApp.
3. **ARCA / AFIP:**
   - **"No borres nada de arca, deja"**.
   - Las variables de ARCA viven solo en Vercel.
   - **Nunca** probar facturación, notas de crédito ni remitos desde la compu local.
4. **La compu local se conecta a la base de datos REAL.** Probar sin guardar, salvo que la prueba sea guardar a propósito.
5. **Base de datos:**
   - Cambios siempre **aditivos** (agregar, no borrar), cada migración con su **script de vuelta atrás** en `supabase/rollback/`.
   - Las migraciones las corre Augusto en el **SQL Editor de Supabase**; dale el archivo y los pasos.
6. **Vercel:**
   - No tocar Redeploy, Delete ni Settings.
   - No apretar "Crear base de datos".
7. **Listas de precios:**
   - **"Las listas se actualizan solo en el chat de listas. Vos tomás siempre el último catalogo_crm.csv de esa carpeta"**: `G:\Unidades compartidas\02 - LAZZARI\CRM - COSTO VENTA\catalogo_crm.csv` (separado por `;`; columnas `proveedor;codigo;descripcion;moneda;costo;margen;precio_venta;codigo_interno;marca;rubro`).
   - Nunca editar precios a mano en el CRM.
8. **Versión:** cada cambio que se publica incrementa el último número en `crm/app/src/lib/app-version.ts`.

## Comandos (desde `crm/app`)

```bash
npm run dev                 # servidor local (ojo: base REAL)
npx tsc --noEmit            # chequeo de tipos: tiene que dar 0 errores antes de publicar
node scripts/check-hooks.mjs  # orden de hooks de React (lo corre el build)
npm run build               # build de producción (ESLint no frena el build)
```

Tests puntuales en `crm/app/scripts/test-*.{mjs,cjs}` (se corren con `node`). Las funciones puras de `src/lib` se pueden probar con `npx tsx`.

**Publicar (solo cuando Augusto lo pide), en este orden:**
1. Si hay migración nueva: correrla en el SQL Editor de Supabase.
2. `npx.cmd tsc --noEmit`.
3. Commit y push:
   ```
   git add src supabase scripts vercel.json
   git commit -m "..."
   git push
   ```
4. Desde `crm\app`, correr `vercel.cmd --prod`.

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
                    ordenes-compra (Compras), personalizacion, remitos, transportes, finanzas,
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
- **Personalización**:
  - Los talleres son proveedores con `es_personalizador`.
  - Se registran trabajos, logos por cliente y la liquidación mensual (con factura o con liquidación interna, que genera una "FC Manual").
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

## Cómo trabajar bien acá

- Antes de cambiar algo, leé el código que lo rodea y respetá cómo está hecho.
- Toda lógica de cálculo (plata, retenciones, matching, oportunidades) va en `src/lib` como funciones puras, con una prueba rápida.
- Antes de dar algo por terminado: correr `npx tsc --noEmit` y `node scripts/check-hooks.mjs`, y probar en local **sin guardar** contra la base real.
- Proponé mejoras continuas: velocidad, que se vean todos los números, menos clics. Siempre como sugerencia y explicando el beneficio en una línea.
- Al terminar una tanda, actualizá `docs/ESTADO.md`.

## Forma de trabajo para ahorrar uso
- Leer solo los archivos necesarios para cada tarea.
- Antes de cambios grandes, proponer un plan y esperar mi OK.
- Correr solo los tests relacionados con lo que cambiaste.
- No crear ramas ni PRs ni cambiar de rama sin que yo lo pida.
- Al terminar cada tarea, anotar en docs/ESTADO.md qué se hizo.

## Avisos de /clear y /compact
Augusto no sabe cuándo usar estos comandos. Vos decidís y le avisás.
- Cuando termines una tarea y ya esté anotada en docs/ESTADO.md,
  escribí al final de tu respuesta, en un bloque de código,
  exactamente lo que tiene que hacer. Por ejemplo:
    👉 Paso 1: escribí esto y apretá Enter:
    /clear
    👉 Paso 2: después pegá esto:
    Lee docs/ESTADO.md. Tarea: [la próxima tarea pendiente, ya escrita por vos]
- Si una tarea se está haciendo muy larga y conviene resumir, escribí:
    👉 Escribí esto, apretá Enter y después seguí normal:
    /compact
- Si no hace falta ninguno de los dos, no digas nada.
