# Traspaso — chat "Resto del CRM" (16/10/2026)

Chat general del CRM (lo que no es Compras, Remitos, Transportes, Web ni Finanzas, que tienen chat propio).
Antes de seguir, leé `CLAUDE.md` y `docs/ESTADO.md` (las primeras entradas son de hoy).

## Objetivo
Que Augusto y los chicos trabajen sin trabas: arreglar lo que falla, simplificar pasos y dejar todo publicado y probado.

## Terminado y PUBLICADO
| Qué | Versión / commit |
|---|---|
| Compras nueva: buscador (OC, PR, cliente, proveedor, artículo) + filtros Atrasadas / Llegó una parte | V1.1.497 (a6ff3e7) |
| Foto del remito del proveedor (Compras nueva > Esperando): IA lee, carga lo recibido, avisa al vendedor, Deshacer. Tabla `oc_remitos` (migración `20261016150000_oc_remitos` CORRIDA) | V1.1.497 |
| Carga de factura: junta el desglose por talle (`lib/factura-desglose-talles.ts`) | V1.1.497 |
| Cualquier vendedor edita cualquier PR: migración `20261016180000_presupuestos_editar_todos` CORRIDA (rollback en `supabase/rollback/`) | 76bd304 (solo base) |
| Enviar Factura: el solicitante del PR viene marcado en "Para" y `email_enviado_a` guarda lo que salió de verdad (Facturación y Ventas) | V1.1.498 (58d8fb1) |
| Cargar factura: "Compré otra cosa" ya no falla con "null value in column codigo" | V1.1.505 (b3c013d) |
| Facturas: línea chica gris "✉ 16/10 · mail" en Facturación y en Facturas de venta; "Verificar" corrige `email_enviado_a` con Resend (`lib/envio-factura-texto.ts` + prueba) | V1.1.510 (b35758b), en producción desde V1.1.512 |

## Datos cargados o corregidos (con OK de Augusto)
- Factura Nexo A 0003-00005284 ($685.828) → OC-2026-1229, por aprobar. OC con 2 cajas porta toma; envío $90.000 como costo interno del PR-2026-1176. **Falta: Augusto aprueba y hace la OP.**
- Factura Montagne 00123-00008159 ($445.137,50) → OC-2026-1263, por aprobar. Ya está bien: **no volver a cargarla.**
- VAL ARG FC A 0007-00000083 ($309.151,92, Mercado Libre) → pagada con BBVA Visa ·1582.
- 20 facturas de Corteva: `email_enviado_a` corregido con lo real de Resend.
- OC-2026-1259 (Mollon): se volvió atrás la prueba del remito (0/1000, enviada).
- Mollon: OC-2026-1258 (stock propio) y OC-2026-1259 (cliente) son a propósito, no duplicadas.

## Menú (PUBLICADO en V1.1.513, commit b3bf5b4)
- Oportunidades, Stock y Personalización ocultos; "Importaciones" nuevo, con avión, oculto (`sidebar.tsx` campo `oculto`; `app/(crm)/importaciones/page.tsx` "Próximamente").
- **Falta verlo en producción** (hoy va por V1.1.517) con el usuario de Augusto, sin guardar: que esos 4 no estén en el menú, que /importaciones diga "Próximamente" y la versión de abajo. El 17/10 se abrió el login en el navegador de la app pero no llegó a entrar (cambio de cuenta).

## Sin publicar
- Nada. Retenciones TXT SICORE + Excel salió en V1.1.541 (20/10). Pendiente: cargar concepto "servicios" a los proveedores que corresponda (hoy todo sale 78 bienes; Augusto lo deja para más adelante).
Nada. "Se sacan 3 IA" salió en V1.1.532; "Sin datos inventados" sale en la tanda V1.1.534 (19/10, junto con Remitos y Transportes).
- El cambio local en `crm/app/tsconfig.json` NO es de este chat (no se publica).

## Pendiente / próximo paso (17/10)
1. ~~Corteva: reenviar a seedspayables~~ → Augusto 17/10: "ya está ok, no hay que cambiar nada". CERRADO.
2. **Asistente dentro del CRM que hace cosas — Etapa 1 PUBLICADA en V1.1.520 (17/10), migración corrida, Hacer + Deshacer probados en producción con la nota de Nexo (quedó como estaba). Lo único que falta: Etapa 2.** Antes: (detalle y archivos en ESTADO, entrada "ASISTENTE QUE HACE COSAS — ETAPA 1"). Falta: (a) Augusto corre `supabase/migrations/20261017100000_ia_acciones.sql` en el SQL Editor; (b) publicar cuando lo pida; (c) primera prueba real de "Hacer" + "Deshacer" con él en producción; (d) Etapa 2.
3. ~~OP de Nexo~~ → HECHA por Augusto: OP-000066 (16/10), eCheq BBVA 90017386 $678.972 al 31/10 (ret. Ganancias 2 %), mail enviado; FC 0003-00005284 pagada. Ojo: OC-2026-1229 sigue "enviada" con 0/1 llegó (si la mesa ya llegó, marcar Llegó).
4. Informe para el equipo ACTUALIZADO: `Claude outputs/informe-equipo-novedades-17-10-2026.md` (12 puntos, al día con V1.1.517). Falta que Augusto lo lea y lo mande él.
4b. **Mayúsculas solo cuando hace falta** (A + B + C) PUBLICADO en V1.1.520 y visto en producción (Proveedores) (ver ESTADO, entrada "MAYÚSCULAS"). Falta publicar y mirarlo en producción; la corrección de datos viejos en la base (opción D) quedó descartada por ahora.
5. Probar la foto del remito del proveedor con un remito REAL. Ojo (19/10): esa foto vive solo en Compras nueva (`compras-nueva/page.tsx`, tabla `oc_remitos`); Compras Lazza no la tiene. Preguntarle a Augusto si la prueba sigue valiendo o si la quiere en Compras Lazza (eso sería del chat de Compras).
6. ~~Ver el menú en producción~~ → visto 17/10 en V1.1.520 con el usuario de Augusto: OK.

## Decisiones de Augusto
- Cada tema en su chat. En este no se relayan preguntas ni avisos de los otros.
- Publicar de a un chat por vez. Ahora se publica todo junto, en una sola tanda y desde un solo chat.
- Cualquiera puede abrir y editar cualquier presupuesto ("nadie se va a equivocar").
- Oportunidades, Stock, Personalización e Importaciones se desarrollan más adelante: ocultos.
- Factura de cliente ya emitida: no se toca. Lo de más se ajusta en la OC.

## Errores y avisos conocidos
- La lectura "sin IA" del PDF en Cargar factura trae los renglones de la OC y no cuadra: hay que usar "Leer con IA". Lo está rediseñando el chat de Compras.
- El servidor local da 500 cuando varios chats lo usan a la vez (cache `.next` rota en Windows). Se prueba en producción sin guardar.
- La clave de Resend de `.env.local` no es válida (la buena está solo en Vercel). Para consultar envíos se usa `/api/email/status` desde el CRM en producción.
- Cuidado con publicar: si el `git push` es rechazado, no hay que publicar en Vercel (ya pasó: se pisaron versiones).

## Scripts útiles (solo lectura)
`crm/app/scripts/lectura/oc-esperando.cjs`, `oc-una.cjs OC-XXXX`, `sql.cjs "select …"`.

## Prompt para seguir en un chat nuevo
```
Sos el chat de Resto del CRM. Leé CLAUDE.md, docs/traspaso/resto-crm.md y las primeras entradas de docs/ESTADO.md. Todo está publicado hasta V1.1.534 (Sin datos inventados, Se sacan 3 IA, Asistente Etapa 1). Etapa 2 del asistente en pausa. Pendiente: que yo lea Claude outputs/informe-equipo-novedades-17-10-2026.md y probar la foto del remito del proveedor con uno real (ojo: hoy está solo en Compras nueva, no en Compras Lazza). Saludame corto y preguntame qué seguimos. No publiques ni toques la base sin mi OK.
```
