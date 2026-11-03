# Cierre 03/11/2026 — chat de revisión de tanda y auditoría (hacía de "Resto del CRM")

Este chat hizo: la revisión de qué había para publicar (02/11), la auditoría completa (`docs/auditoria-optimizacion-finanzas/`, 11 documentos + `trabajo/`), el reparto de P01–P12 y de la Etapa 2 a los chats, y acá mismo P01 (campana), P05 (Inicio), P12 y P11.

## 1. A medias o sin publicar

Todo está en la copia de trabajo **`C:\Users\lazza\lz-campana`** (worktree detached, sacado de origin/main V1.1.656, **sin commit**). `node_modules` es un enlace a `C:\Users\lazza\lazzari\crm\app\node_modules` y `.env.local` es una copia; los dos están ignorados por git. Para ver todo: `git -C C:\Users\lazza\lz-campana diff` y `git -C C:\Users\lazza\lz-campana status`.

| Qué | Archivos | Probado |
|---|---|---|
| **P01 Campana**: el número cuenta TODOS los sin leer (antes, los últimos 30; Augusto en Lazzari: 168) y muestra 99+; "Marcar todas leídas" marca todos (de a 100); las preferencias se traen una vez; con la pestaña escondida no consulta (tampoco la verificación de mails) y al volver trae enseguida (`useRefrescarAlVolver`); al cambiar de pantalla reusa lo traído hace menos de 25 s | `src/components/layout/header.tsx` | tsc 0, hooks OK, test-lib OK. **No visto en pantalla** (el local pide login); el conteo se verificó en la base, solo lectura |
| **P05 Margen bajo en el Inicio**: franja con los avisos de `notificaciones` (tipo `margen_bajo`, sin leer), uno por PR, con link `/presupuestos?selected=`, "N veces" y botón **Visto** (marca `leida` de todos los de ese PR; RLS `notif_update` lo permite al super_admin). Hoy en Lazzari: 8 PR en vez de 13 avisos | `src/components/tablero-inicio.tsx`, `src/lib/tablero-inicio.ts` (`avisosMargenBajo`), `scripts/test-tablero-inicio.ts` | Prueba pura OK. No visto en pantalla; los datos se verificaron en la base |
| **P12 Un solo cliente de Supabase** en el navegador: login, header, sidebar y auth-context usan el de `lib/supabase/client` (con `as unknown as SupabaseClient`, porque los tipos generados son viejos) y `useUser` va con `useMemo`. Verificado que el arreglo de mayúsculas NO cambia las razones sociales de las sociedades | `src/app/login/page.tsx`, `src/components/layout/sidebar.tsx`, `src/lib/auth-context.tsx`, `header.tsx` | tsc 0, hooks OK. **Hay que probarlo en producción**: salir, entrar sin F5, mirar un nombre en Clientes y cambiar de sociedad |
| **P11 Registro de migraciones**: `scripts/db/migrar.cjs` anota cada archivo corrido en `lz_migraciones_corridas` en la misma transacción; script nuevo `scripts/db/verificar-migraciones.cjs` (solo lectura) | `scripts/db/migrar.cjs`, `scripts/db/verificar-migraciones.cjs`, `supabase/migrations/20261103090000_lz_migraciones_corridas.sql` + rollback + `scripts/db/pruebas/lz_migraciones_corridas.sql` | Migración **YA CORRIDA** el 03/11 con OK de Augusto (tabla con RLS y 0 políticas, ya se anotó a sí misma). Falta publicar los scripts y la migración en el repo |
| Entrada en `docs/ESTADO.md` de la copia, arriba de todo: "CAMPANA Y MARGEN BAJO EN EL INICIO…" | `docs/ESTADO.md` (en la copia) | — |

**Ojo al publicar:** desde que se hizo la copia, origin/main cambió `tablero-inicio.tsx`, `lib/tablero-inicio.ts` y `test-tablero-inicio.ts` (2 commits cada uno; está en V1.1.663). Hay que hacer fetch + merge de origin/main en la copia y resolver, después tsc, check-hooks, test-lib, subir la versión y publicar. `header.tsx`, `sidebar.tsx`, `auth-context.tsx`, `login/page.tsx` y `migrar.cjs` no cambiaron en origin.

En la carpeta de notas de este chat hay un `finanzas-tanda-a.patch` del 30/10 que **no hizo este chat**. No sé si sigue sin publicar: revisarlo contra origin/main antes de usarlo.

## 2. Esperan un OK de Augusto

- Publicar lo de la sección 1. Augusto dijo "junto con la tanda": no publicar suelto.
- Propuesta del chat Agente de IA (P09, anotada en su ESTADO): "¿Pasamos a esfuerzo high las 6 rutas que leen plata de documentos (certificados, VEP, documento impositivo, conciliar compra, leer remito, lista de precios)?"
- Del roadmap (`09-roadmap-implementacion.md` §2), siguen abiertas: 3 (¿el administrativo cobra, paga y factura desde Finanzas?, P15), 4 (¿VEP, Visa, cuotas BNA y ventas por facturar en el Cashflow como "estimado"?, P17), 7 (¿ocultar Listas de precios en Proveedores?, P39) y 8 (historial de cambios: ¿útil en las tablas de plata o se apaga?, P19). **No preguntar la 5 (Barraza)**: Augusto pidió no revisar datos viejos.

## 3. Esperan a otra persona

- PR-2026-1270 (Corteva, dos remitos de Jerónimo sin factura): espera la respuesta de Jerónimo (lo sigue Ventas y facturación).

## 4. Avisos para el chat CRM

- **Decisiones del 02/11** (en la memoria): los cheques de Martín F. **suman** en "a cubrir" en todas las pantallas; Sanitarios ($ 219.548) ya está resuelto (devolvieron la plata; figura el ajuste del 28/10); P06 (estado de OC) "no por ahora".
- **Tareas repartidas y en qué quedaron**, según lo que informó cada chat:
  - P03, Ventas: **publicado** en V1.1.658; el cron no vence PR con remito, publicado en V1.1.661.
  - P02, P04 (OP), P24, P08, P23, P10 y P07, Finanzas Lazza: **hechos, sin publicar**, en su copia `fz2`. P08: 51 OP recalculadas, 0 diferencias. P07: la tarjeta Bancos pasa de $ 3,48 M a $ 23,55 M, igual que el Inicio. **P02 tiene que estar publicado antes del 10/11** (Cobranzas reclamaría a quien ya pagó).
  - P01 (trigger) y P05 (título), Presupuestos: migración de avisos sin repetidos **corrida**; el título del margen bajo está en su copia `pub-avisos`, sin publicar.
  - P04 (carga de la factura), Compras: no confirmado.
  - P16 (IIBB del Cashflow) y el Cashflow con la cuenta nueva de cheques, Contabilidad de Nati: no confirmado.
  - P09 (precios de IA), Agente IA: **hecho, sin publicar**. Octubre real: US$ 19,53 (antes mostraba 65,48).
- **Primera corrida de `verificar-migraciones.cjs`** (03/11): 5 funciones vivas distintas de su último archivo (`conciliar_extracto_movimiento`, `anular_liquidacion_fx`, `registrar_pago_tarjeta_factura_compra`, `aplicar_reporte_echeqs`, `presupuesto_estado_alert`; esta última por la migración de Presupuestos del 02/11) y 2 que están en el repo pero no en la base (`bloquear_mismo_registro_factura_en_op`, `sincronizar_proveedor_transportista`). Sin revisar todavía.
- **Migraciones que están solo en la carpeta vieja** `C:\Users\lazza\lazzari` y no en el repo: `20261023120000_vincular_fravida_eslingar`, `20261030201000_pago_tarjeta_usa_fc_compra_pagado` (ya está viva en la base), `20261102120000_dividir_remito` y `20261015120000_productos_prueba_borrar` (**stock: no tocar sin aviso de Augusto**).
- La carpeta `C:\Users\lazza\lazzari` está ~65 versiones atrás de origin/main y tiene cambios viejos sin commit: **nunca publicar desde ahí**.
- La auditoría completa con todas las propuestas (P01–P46), la matriz y el roadmap está en `docs/auditoria-optimizacion-finanzas/`, en la carpeta vieja y sin commit. Conviene subirla al repo.
