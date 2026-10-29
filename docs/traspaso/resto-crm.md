# Traspaso — chat "Resto del CRM" (actualizado 27/10/2026)

Chat general del CRM: todo lo que no es Compras, Remitos, Transportes, Web ni Finanzas, que tienen chat propio.
Antes de seguir, leé `CLAUDE.md` y las primeras entradas de `docs/ESTADO.md`.

## Cómo publica este chat (importante)
La carpeta `C:\Users\lazza\lazzari` tiene cambios a medio hacer de otros chats y suele estar atrasada respecto de `origin/main`.
Por eso este chat **no publica desde la carpeta**: arma una copia limpia y publica solo lo suyo.
1. `git fetch` y `git worktree add --detach <scratchpad>/pubN origin/main`.
2. Aplicar ahí solo los cambios de este chat (`git diff HEAD -- archivo | git apply`, o editar directo en la copia).
3. Subir la versión en `crm/app/src/lib/app-version.ts` y anotar en `docs/ESTADO.md`.
4. Para `tsc`: junction `crm/app/node_modules` → la de la carpeta principal; sacarla (`rmdir`) antes del deploy.
5. Commit, `git push origin HEAD:main` (si lo rechaza, NO se publica), copiar `crm/app/.vercel`, `vercel.cmd --prod --yes`, esperar Ready.
6. `git worktree remove --force` y prune.
Solo cuando Augusto lo pide.

## Publicado en esta etapa (23–26/10)
| Qué | Versión / commit |
|---|---|
| Ficha 360 sin "Ir a Muestras"; Ayuda sin Dashboard/Muestras/Ventas/Reportes (35 secciones, editado en `docs/GUIA-USO.md` + `node scripts/guia-a-ts.mjs`); textos "Ventas" → "Finanzas Lazza → Facturar" | V1.1.560 (d73d953) |
| Editar un PR en cualquier estado (también facturado). Al guardar, las OC se actualizan en su lugar: conserva lo recibido, queda "Recibida parcial" si falta (10→11 = falta 1), renglón nuevo se agrega, el sacado se borra solo si no llegó nada | V1.1.560 |
| Configuración > Usuarios: llave por usuario para cambiar mail y/o contraseña; Invitar usuario con contraseña opcional (se crea activo, sin mail). Solo super admin (`/api/users` PATCH, `/api/invite` POST) | V1.1.563 (a8e2a6f) |
| Nuevo proveedor: botones CUIT / DNI (`proveedor-form-modal.tsx`) | V1.1.563 |
| Solicitud solo con texto ya no da "Datos incompletos para crear el presupuesto": el texto queda como renglón a cotizar | V1.1.576 (3472068) |

## PUBLICADO 27/10 en V1.1.589 (commit 44d3767, Vercel Ready): Resto a facturar (factura parcial de un PR)
- Ojo: en la carpeta principal siguen como cambios locales (idénticos a lo publicado) `emitir-factura-modal.tsx`, `facturar.tsx`, `lib/resto-facturar.ts`, el test y las migraciones del resto; si un `git merge origin/main` se queja por esos archivos, son iguales a main y se pueden descartar (con OK de Augusto).
- Visto en producción 27/10 (sin guardar): fila "PR-2026-1218 · resto" de Synertech, US$ 1.671,84 / 2.022,93, "Resto a facturar", con Facturar y No facturar. Detalle menor: el pie cuenta el resto como "3 PR".
- Si al facturar un PR se sacan renglones o se baja la cantidad, la ventana pregunta abajo: **Dejar a facturar** (marcado) / **No facturar**. No frena.
- Lo que queda sale en Finanzas > Facturas > Facturar como fila "PR-… · resto" con Facturar (solo lo que falta) y No facturar.
- Archivos SOLO de este chat: `crm/app/src/lib/resto-facturar.ts` (nuevo), `crm/app/scripts/test-resto-facturar.ts` (nuevo, OK),
  `crm/app/src/components/facturacion/emitir-factura-modal.tsx`, `crm/app/src/components/finanzas-lazza/facturar.tsx`,
  migraciones `20261026200000_presupuesto_restos_facturar.sql` y `20261026201000_resto_synertech_pr1218.sql` (+ rollback).
- Migraciones **YA CORRIDAS** (26/10, OK de Augusto). Synertech PR-2026-1218: resto pendiente 800 N95 + 12 suspensiones H700 = USD 2.022,93.
- tsc 0, hooks OK, prueba `test-resto-facturar.ts` OK.
- Falta: cartel "Resto a facturar" dentro del PR (`presupuestos-lista.tsx`: trabajar sobre origin/main, la copia local está vieja) y restos en la bandeja "Para facturar" de Ventas. Opcional: que el pie de Facturar diga "2 PR · 1 resto".

## PUBLICADO 27/10 en V1.1.590 (commit 538aedb, Vercel Ready, versión vista en producción): PDF del PR salía sin los cambios después de editar (aviso de Seba)
- Falta que Seba pruebe: editar un precio, guardar y descargar el PDF (no se probó porque implica guardar).
- Causa: al guardar la edición se recarga la lista, pero el panel abierto (`selected`) seguía con los datos viejos y el botón PDF usa esos.
- Arreglo: efecto en `presupuestos-lista.tsx` que, al recargar la lista, actualiza el PR abierto (ya en main; el parche quedó de referencia en `docs/traspaso/parches/pdf-pr-despues-de-editar.patch`). tsc 0, hooks OK.
- OJO: el `presupuestos-lista.tsx` de la carpeta principal está VIEJO (le falta el arreglo de V1.1.576 y el de V1.1.590). No publicar ese archivo desde la carpeta.

## Aviso pasado al chat de Compras (27/10, no es de este chat)
En Compras Lazza > Cargar factura, a los de Compras les aparece "Aplicar saldo a favor: $ … (OP-…)" (`compras-lazza-factura.tsx` ~495) y no les tiene que aparecer. Se le dio a Augusto este prompt para el chat de Compras:
```
Aviso de Augusto: en Compras Lazza > Cargar factura, a los de Compras les aparece el recuadro "Aplicar saldo a favor: $ … (OP-…)" (compras-lazza-factura.tsx, línea ~495). A ellos no les tiene que aparecer. Que lo sigan viendo solo los que manejan Finanzas (admin / super admin / quien tenga Finanzas Lazza); confirmame con qué permiso lo separás antes de tocar. Si no se muestra, la factura va a Pagos como siempre y el saldo a favor queda para que Finanzas lo aplique después. Probá en local sin guardar, tsc y hooks, y no publiques hasta que te diga.
```
Recomendación dada: que el saldo a favor lo aplique Finanzas al pagar. Augusto no confirmó todavía.

## Consultas resueltas 26/10 (solo lectura)
- Cobro de la OP 18722 de Del Sol: todavía no cargado. FA 65/67/68 emitidas; la FA 68 ya tiene atado el saldo a favor y debe 1.836.717,86.
- X 0000-00000011 del PR-2026-1022 ($ 5.284.860, fecha 21/10): guardada bien.
- Saldo a favor con NC sueltas: no hace falta, hoy no hay ninguna NC suelta.

## Hecho en datos (con OK de Augusto)
- Natalia Inga (ningalazzari@gmail.com, administrativo, ve las dos sociedades): activada con contraseña el 23/10 y ya entró. Augusto le va a cambiar la contraseña desde la llave (la actual es débil).

## Otros temas resueltos
- Anthropic API sin crédito: Augusto activó los 140 US$/mes del plan Team (Claude Console > Facturación). Ese crédito caduca el 12/11/2026: ese día mirar que se renueve. La recarga automática quedó desactivada (decisión de Augusto).
- Mockup de usabilidad (4 pantallas, navegable): https://claude.ai/artifact/52FyWtMbDzthkqKKtdprBT — Inicio "Mi día", Presupuestos con avance de la venta, Nuevo proveedor en pasos, Orden de pago con resumen fijo. Solo diseño, nada implementado. Augusto todavía no eligió cuál implementar (sugerido: empezar por "Mi día").
- Contabilidad (libro mayor, diario, estado de resultados, cashflow) y plan de cuentas: se pasó al chat de **Finanzas Lazza**. No se toca acá.

## Auditoría integral (28/10, solo documentación)
Informes en `docs/auditoria-integral/` (empezar por `01-resumen-ejecutivo.md`). Plan en tandas en `09-plan-de-correccion.md` (0 pruebas, 1 seguridad en la base, 2 plata que da mal, 3 fuentes de verdad, 4 PR↔Compras, 5 RPC, 6 mudanza de pantallas viejas). Nada implementado: Augusto elige la tanda.

## Pendiente
00. Auditoría: Tanda 1 Parte A HECHA (migración 20261028120000_seguridad_cerrar_anonimo corrida 28/10 y verificada en producción). Parte B hecha en la carpeta, sin publicar (ver ESTADO): migración 20261028130000 ya corrida (3/3 true); falta publicar el código cuando Augusto lo pida. Parte C (RLS por sociedad) DESCARTADA por ahora: Augusto 28/10 "cualquier usuario puede ver las dos sociedades, cada uno con su categoría". Tampoco cerrar facturas_compra/transportes por rol: los vendedores cargan la mayoría. Parte D y Tanda 2 (Cta. Cte. del cliente y CUIT de proveedores) HECHAS EN LA CARPETA, SIN PUBLICAR: ver la primera entrada de ESTADO del 28/10. 20261028140000 (CUIT) ya corrida 28/10. PUBLICADO V1.1.598 (commit 6a70d6b). Ojo: los archivos de este chat siguen como cambios locales en la carpeta, iguales a main (si un merge se queja, son iguales y se pueden descartar con OK). Falta: 20261028150000 (archivos privados) CORRIDA y verificada 28/10. Tanda 1 de seguridad TERMINADA (C descartada). Tanda 0 (freno de pruebas) PUBLICADA en V1.1.599 (commit 7c5c692); Vercel corre test:lib en cada build. Prompt de las 4 pruebas de Finanzas pasado a Augusto. Tanda 4 (PR ↔ Compras) PUBLICADA en V1.1.600, migración 20261028170000 corrida. Falta probar en producción editar un PR real (abrir, editar, guardar lo hace Augusto o con su OK). Prompts de la Tanda 3 pasados a Augusto para Finanzas y Compras. NC desde la ficha: se le pasó prompt a Finanzas. Lo de Finanzas de la Tanda 2 (H15, H19, H20, H22, H23) se le pasó a Augusto como prompt para el chat de Finanzas Lazza. Avisado: Manu (admin, ya no trabaja) sigue activo; José solo tiene Lazzari en user_sociedades.
0a. Auditoría Tanda 7 PUBLICADA en V1.1.604: H41 (se sacó Consumo de `clientes/page.tsx`, código sin uso), H39 (migración `20261028185000_dashboard_conversion_ganados.sql` CORRIDA 28/10, conversión con estados ganados), H43 (margen NETO único en lista, ventana, aviso al guardar y Presupuestos nuevo; sin dólar no calcula) y H42 (cada renglón de OC guarda su moneda; una OC por proveedor, sin importar el total). H35 (se sacó el panel Generar con IA, sin uso) y H38 (remitente del mail desde el servidor) PUBLICADOS en V1.1.606; falta probar mandando un PR por mail. Con esto la parte de este chat de la Tanda 7 queda hecha (H40, H46, H70 siguen en la Tanda 7 general). Para Compras: "Enviar OC al proveedor" muestra el total de la OC, que mezcla monedas.
0b. Registro de envíos del PR por mail PUBLICADO en V1.1.607 (tabla presupuesto_envios, migración 20261028200000 corrida 28/10): cada envío queda con cuándo, quién y a quién; sobre en la lista y "Enviado por mail" en el PR. Verificado 28/10 con un envío real (PR-2026-1285 a augusto@).
0d. Tanda 7 H40, H46 y H70 PUBLICADOS en V1.1.610 (commit 061cb41); migración 20261028220000 CORRIDA 28/10 y verificada 3/3. Duplicar PR probado en producción 28/10 (PR-2026-1286, quedó en la Papelera), ensayada sin guardar 3/3 OK. Augusto: sacar los avisos de seguimiento a los aprobados; los 274 avisos viejos sin sociedad quedan como están.
0c. Correos enviados PUBLICADO en V1.1.608 (tabla mails_enviados, migración 20261028210000 corrida 28/10): todos los mails del CRM con estado verificado en Resend, aviso de rebote en la campana, pantalla /correos en el menú. El PR lee sus envíos de ahí (presupuesto_envios queda sin uso). Verificado 28/10: PR-2026-1285 figura Entregado.
0. Resto a facturar ya publicado (V1.1.589): sumar el cartel en el PR y la bandeja de Ventas. Que Seba pruebe el PDF del PR (V1.1.590).
1. **Clientes con DNI** (Augusto: "hacelo después"): mismo botón CUIT / DNI en la carga de clientes. Antes, revisar qué depende del CUIT del cliente (ficha, BCRA, CUIT repetido, factura con ARCA) y avisarle qué cambia.
   - Revisado 28/10 (solo lectura, sin código): el formulario ya acepta DNI de 7-8 números (22 clientes con DNI). ERROR: `api/facturacion` manda DocTipo 80 (CUIT) con el DNI en Factura B → ARCA la rechazaría; tiene que ir DocTipo 96 (nunca pasó: esos clientes solo tienen X). El aviso de repetidos (`avisos-alta-cliente.tsx`) solo busca CUIT de 11. BCRA solo con CUIT (bien). Sin migración. Plan propuesto a Augusto, esperando OK. Augusto 28/10: "a los clientes con dni no le podemos hacer fact con arca, le hacemos fact manual sin arca" → en vez de DocTipo 96: la ventana de factura abre en manual (X) con aviso si el cliente tiene DNI. PUBLICADO 28/10 en V1.1.612 (ver ESTADO). Falta mirar en producción la ventana de factura con un cliente con DNI, sin emitir.
2. Elegir del mockup qué pantalla implementar.
3. Probar en producción la edición de un PR facturado (el de la moneda de costo mal cargada) y mirar que la OC quede bien.
4. Viejos: leer y mandar `Claude outputs/informe-equipo-novedades-17-10-2026.md`; foto del remito del proveedor (hoy solo en Compras nueva, no en Compras Lazza); concepto "servicios" en proveedores para retenciones; Etapa 2 del asistente en pausa.

## Decisiones de Augusto
- Cada tema en su chat; acá no se relayan avisos de otros chats.
- Publicar solo cuando él lo pide, y solo lo de este chat.
- "Mi contraseña" para cada usuario: NO (está bien como está).
- Cualquiera puede editar cualquier presupuesto, en cualquier estado.

## Scripts útiles (solo lectura)
`crm/app/scripts/lectura/sql.cjs "select …"`, `oc-esperando.cjs`, `oc-una.cjs OC-XXXX`.

## Prompt para seguir en un chat nuevo
```
Sos el chat de Resto del CRM. Leé CLAUDE.md, docs/traspaso/resto-crm.md, las primeras entradas de docs/ESTADO.md y docs/auditoria-integral/01-resumen-ejecutivo.md y 09-plan-de-correccion.md. La seguridad (Tanda 1) quedó terminada y publicada en V1.1.598 (28/10). Saludame corto y preguntame si seguimos con la Tanda 0 (pruebas que frenen la publicación) o la Tanda 4 (PR ↔ Compras). No publiques ni toques la base sin mi OK.
```
