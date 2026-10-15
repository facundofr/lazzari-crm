# Para seguir trabajando desde otro usuario de Claude (traspaso, 16/10/2026)

Augusto se quedó sin límite de uso. Este archivo es para que otra persona (Jerónimo, Sebastián) siga con **una sesión nueva de Claude Code**.

## 1. Cómo abrir la sesión (pasos literales)

1. Cerrá la sesión de Augusto en la app de Claude (menú de tu usuario → **Cerrar sesión**).
2. Entrá con tu usuario (jeronimo@lazzari.com.ar o sebastian@lazzari.com.ar).
3. Pestaña **Code** → elegí la carpeta **`C:\Users\lazza\lazzari`** (la misma de siempre). Mismo repositorio, mismo proyecto.
4. Pegá el prompt de abajo y apretá Enter.

> Si lo hacen desde **otra compu**: hace falta clonar el repositorio (`git clone`), instalar con `npm install` en `crm\app` y que **Augusto** les cargue el archivo `.env.local` (nunca por WhatsApp ni por mail) y los permisos de Vercel. Sin eso no se puede probar ni publicar.

## 2. Prompt para pegar

```
Leé CLAUDE.md, docs/CONTINUAR.md, docs/ESTADO.md (las primeras 60 líneas) y docs/CORRECCIONES.md.
Soy [Jerónimo / Sebastián], sigo el trabajo de Augusto. Tarea: [lo que quieras hacer, ej. "probar el Asistente IA del editor de PR con el Excel EPP 26-27 y el PR 1203 y corregir lo que falle"].
```

## 3. Reglas que no se rompen (resumen de CLAUDE.md)

- Español rioplatense, corto, **un paso por vez**. La IA nunca frena a un vendedor: solo avisa.
- Base de datos: cambios **aditivos**, con vuelta atrás en `supabase/rollback/`; explicar y esperar OK antes de correr nada. Nunca mostrar claves ni `.env.local`.
- ARCA: nunca probar facturación, NC ni remitos electrónicos desde la compu local.
- Cada cambio publicado sube el último número de `crm/app/src/lib/app-version.ts`.
- **Publicar siempre desde una copia limpia** para no subir trabajo sin terminar de otros chats: `bash crm/app/scripts/publicar-limpio.sh "mensaje" archivo1 archivo2 …` (rutas desde la raíz del repo; copia solo esos archivos desde `origin/main`, sube la versión, corre `tsc`, commitea, empuja y hace `vercel --prod`).
- Antes de tocar nada: `git status` (ver si hay cambios de otro chat) y `git fetch`.

## 4. Qué se hizo el 16/10 (versiones 1.1.466 a 1.1.490)

Detalle completo en `docs/CORRECCIONES.md` (cada punto con su versión). Resumen:

- **Presupuestos nuevo** (`/presupuestos-nuevo`, casilla por usuario, prendida para Augusto, Jero y Seba): pestañas Presupuestos / Seguimiento / Armar. Seguimiento con vistas Lista, Por vendedor y Por cliente, filtros, mensaje con IA y resultados (tabla `presupuesto_seguimiento`, ya creada).
- **Asistente IA del editor de PR** (botón "Asistente IA"): chat con Opus 5.5 (`components/presupuestos/asistente-pr.tsx`, `api/presupuestos/asistente`): adjuntar Excel/PDF/foto, preguntas con botones, "mantené el precio del PR 1203", mejores costos respetando marcas, margen editable, deshacer. Ve todos los PR aprobados/facturados.
- **Compras nueva**: reclamo de lo que falta (sin precios), desplegable de proveedores sin repetidos.
- **Facturas de compra**: conciliación más simple, cartel "Asignar proveedor y conciliar" para renglones de OC sin proveedor/Mercado Libre, tolerancia de precio 1 %, PDF con basura antes de `%PDF-` (Fujiwara) ya se lee.
- **Remitos**: buscador, filtros, columnas N° PR / N° OC / N° Remito, tipo real (CAI / manual / ARCA), muestra = manual, PR manual sin CAI, detalle con pendiente por renglón.
- Las pantallas Presupuestos, Ventas y Seguimiento se actualizan solas al volver a la pestaña.

## 5. Pendientes (en orden de importancia)

1. **Probar con datos reales** (casi todo se publicó sin probarlo en pantalla): Asistente IA con el Excel EPP 26-27 (PR-2026-1246, Corteva Seeds) y el PR 1203; conciliación de las facturas de Nexo (FA 0003-00005284) y VAL ARG; remitos de PR manual, ARCA y muestra.
2. **Vincular la FA de VAL ARG** (0007-00000083, $ 309.151,92, guardada sin OC) con la OC-2026-1215: hoy se hace con el cartel violeta al conciliar; si se hace a mano, **pedir OK a Augusto** (cambia datos reales).
3. **Envío como costo del PR** (`costo_envio_interno`) desde la conciliación de facturas (hoy queda "fuera de OC").
4. **Compras de Mercado Libre**: Augusto define cómo marcarlas (proveedor = vendedor real que factura, nunca "Mercado Libre").
5. **Agente "Comprador"** de Compras nueva: Augusto todavía tiene que contar qué tiene que hacer.
6. **Mandar presupuestos y mails desde la casilla de cada vendedor** (Google Workspace: autorización de administrador una sola vez; se conectan la semana del 19/10).
7. **Preguntas de la IA** (motor común: tablas `ia_preguntas`, `ia_mensajes`, `ia_aprendizajes`) y segunda etapa del Asistente (más conversacional, con memoria).
8. **Remitos**: un solo "Remitar" para el PR y para Remitos (las reglas ya coinciden; es solo de comodidad).
9. Ideas: leer la respuesta del cliente y aprobar solo; pedirle precio al proveedor por mail; aprender de PR ganados y perdidos.

## 6. Cosas a saber

- La tarea semanal `sugerencias-ia-semanales-crm` (lunes 9:00, solo lectura, escribe `docs/SUGERENCIAS-IA.md`) corre en la app de **Augusto**: si se cambia de usuario no se ejecuta.
- Las casillas "Prueba: Presupuestos nuevo" y "Compras nueva" se prenden en Configuración → Usuarios (solo super admin).
- La memoria de Claude está en `C:\Users\lazza\.claude\projects\C--Users-lazza-lazzari\memory\`: la ve cualquier sesión abierta con esa carpeta en esta compu.
