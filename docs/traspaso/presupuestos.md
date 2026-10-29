# Traspaso — chat "Presupuestos" (creado 29/10/2026)

Chat nuevo, armado a pedido de Augusto el 29/10/2026. Antes era parte de "Resto del CRM" (`docs/traspaso/resto-crm.md`).
Antes de seguir, leé `CLAUDE.md` y las primeras entradas de `docs/ESTADO.md`.

## Qué le toca a este chat
La pantalla Presupuestos (`/presupuestos`, `crm/app/src/components/presupuestos*`, `presupuestos-lista.tsx`), Armar presupuesto con IA,
Cotización express, Solicitudes, Seguimiento, envío del PR por mail, PDF del PR, editar PR, Resto a facturar del lado del PR y duplicar PR.
Lógica pura relacionada en `src/lib`: `presupuesto-*.ts` (margen, ayudas, ia, envios, seguimiento, duplicar) y `resto-facturar.ts` (`cartelResto`).

## Cómo publica este chat
Igual que Resto del CRM ("Cómo publica este chat" en `docs/traspaso/resto-crm.md`): copia limpia de `origin/main` con `git worktree add --detach`,
solo los archivos de este chat, subir versión, ESTADO, tsc + hooks, commit, `git push origin HEAD:main` (si lo rechaza, no se publica), `vercel.cmd --prod --yes`.
Solo cuando Augusto lo pide. Nunca `git stash` ni cambiar de rama.
⚠️ El `presupuestos-lista.tsx` de la carpeta principal está VIEJO: trabajar siempre sobre origin/main.

## Lo hecho hasta hoy (en el chat Resto del CRM)
| Versión | Qué |
|---|---|
| V1.1.560 | Editar un PR en cualquier estado (también facturado); las OC se actualizan sin perder lo recibido |
| V1.1.576 | Solicitud solo con texto ya no da "Datos incompletos" |
| V1.1.589 | Resto a facturar (factura parcial de un PR) en Finanzas > Facturar |
| V1.1.590 | El PDF del PR sale con los cambios después de editar (aviso de Seba) |
| V1.1.600 | Tanda 4: renglones del PR estables al editar, venta caída avisa/cancela OC, re-aprobar, restaurar |
| V1.1.604 | Margen NETO único (lista, ventana, aviso al guardar, Presupuestos nuevo); cada renglón de OC con su moneda |
| V1.1.606 | Sacado el panel "Generar con IA" sin uso; remitente del mail lo arma el servidor |
| V1.1.607 / 608 | Registro de envíos del PR por mail; Correos enviados (`mails_enviados`, el PR lee de ahí) |
| V1.1.610 | Seguimiento: aviso de 5 días, solo el último paso, sin Papelera ni aprobados; avisos PR aprobado/rechazado con sociedad; Duplicar PR |
| V1.1.613 | Marca "resto" en la lista y cartel "Resto a facturar" adentro del PR |
| V1.1.616 | Mail del PR: Para = solicitante; sin solicitante, contactos del cliente (nunca los de facturación/pagos) |
| V1.1.623 | (chat Presupuestos) Aviso "¿El costo está en $? Pasar a $" en el PR; cartel de costo raro en Reportes; cartel correcto al editar un PR con OC |

## Pendientes (pasaron del chat Resto del CRM)
1. **PDF del PR después de editar (V1.1.590):** que Seba pruebe editar un precio, guardar y descargar el PDF. No se probó porque implica guardar.
2. **Editar un PR facturado en producción (V1.1.560 / V1.1.600): HECHO 29/10 con OK de Augusto.** El PR "de la moneda de costo mal cargada" era el PR-2026-1142 (Libus $ 36.425): ya estaba corregido por script (29/10 02:52, sin usuario) y no tiene OC, así que se probó con PR-2026-1171 (Municipalidad de Pergamino, facturado, 3 OC recibidas, 4 renglones): abrir, Editar, Guardar sin cambios. Resultado (foto antes/después de la base): las 3 OC siguen "recibida", mismos renglones (mismos id), cantidades y recibido iguales, nada borrado. Cambió solo: descripciones de MAYÚSCULAS a "Arnes alcochonado para…" en PR y OC (es la regla `lib/mayusculas.ts` de Augusto 17/10, se aplica al leer: correcto), `precio_lista` completado y el dólar del día (1560 / 1542) guardado en el PR. **Error encontrado:** el cartel dice "3 OC actualizada(s) y marcada(s) como pendiente" pero no las marca pendiente (`presupuestos-lista.tsx` ~1624, texto viejo de antes de V1.1.600). ARREGLADO 29/10 (Augusto: "Sí, arreglalo"), PUBLICADO en V1.1.623: ahora dice "Presupuesto actualizado — 3 OC actualizada(s)". Hecho en la copia limpia `pub-pr` del scratchpad de este chat (sobre origin/main bbf940d, junction de node_modules adentro: sacarla con rmdir antes del deploy). tsc 0, hooks OK.
3. **Avisos de seguimiento (V1.1.610):** revisado 29/10 en la base (solo lectura): el control del 29/10 09:40 ya corrió con la regla nueva: salió el primer "Seguimiento PR (5 días)" (PR-2026-1275), avisos solo a PR pendientes/solicitud (1273–1276), ninguno a aprobados. El "PR aprobado: PR-2026-1268" del 29/10 ya tiene sociedad. Falta solo que Augusto confirme que en la campana lo ve bien.
4. **Mail del PR (V1.1.616):** probado en local sin mandar. Falta verlo en producción con el próximo envío real (Para = solicitante, sugeridos sin facturación).
5. **Resto a facturar:** Ventas no (fuera del menú). Nada más pendiente del lado del PR.
6. ~~Mockup "Presupuestos con avance de la venta"~~: Augusto 29/10 "no me gusta, eliminalo". Boceto borrado, no se hace.

7. **Moneda del costo cruzada (29/10, PUBLICADO en V1.1.623):** aviso "¿El costo está en $? Pasar a $" en el PR y cartel de costo raro en Reportes. Detalle en ESTADO 29/10.

## Decisiones de Augusto que valen acá
- Cualquiera puede editar cualquier presupuesto, en cualquier estado.
- Avisos de seguimiento a los aprobados: NO. Los 274 avisos viejos sin sociedad quedan como están.
- Nunca frenar al vendedor: margen mínimo, BCRA, etc. solo avisan.
- Mails de facturación/pagos del cliente nunca se sugieren para el PR (salvo que ese contacto sea el solicitante).

## Prompt para seguir en un chat nuevo
```
Sos el chat de Presupuestos del CRM. Leé CLAUDE.md, docs/traspaso/presupuestos.md y las primeras entradas de docs/ESTADO.md. Saludame corto y decime qué quedó pendiente. No publiques ni toques la base sin mi OK.
```
