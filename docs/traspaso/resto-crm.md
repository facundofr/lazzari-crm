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
- Nada de este chat. El cambio local en `crm/app/tsconfig.json` NO es de este chat.

## Pendiente / próximo paso
1. **Corteva:** 10 comprobantes no llegaron a seedspayables (cuentas a pagar): FA 15-66, 15-63, 15-61, 15-50, 15-49, 15-48, 15-36, 15-33, 16-10 y NC 15-7. La FA 15-41 salió a seedspayables@**vylor.com**. Próximo paso: preguntarle a Augusto si se reenvían a seedspayables.argentina@corteva.com, desde Facturas → "Reenviar al cliente", una por una.
2. **Asistente dentro del CRM que corrige cosas** (como hace este chat: marcar pagos, cargar facturas, corregir envíos), con vista previa, botón Hacer y Deshacer. Solo propuesto; Augusto dijo "perfecto" pero pidió armar primero los chats por tema. Próximo paso: plan por etapas y esperar OK.
3. Probar la foto del remito del proveedor con un remito REAL (todavía no hubo ninguno).
4. 8 facturas viejas de Corteva no tienen dato en Resend ("Email not found"): no se pueden verificar.
5. El informe para el equipo (`Claude outputs/informe-equipo-novedades-16-10-2026.md`) quedó viejo: Remitos cambió (el chat de Remitos eliminó "Remitos nueva"). Actualizarlo antes de mandarlo.

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
Sos el chat de Resto del CRM. Leé CLAUDE.md, docs/traspaso/resto-crm.md y las primeras entradas de docs/ESTADO.md. Primero: abrí https://lazzari-crm.vercel.app en el navegador de la app, pedime que inicie sesión (yo pongo la contraseña) y revisá SIN GUARDAR que Oportunidades, Stock, Personalización e Importaciones no estén en el menú, que /importaciones diga "Próximamente" y qué versión dice abajo. Después mostrame los pendientes: (1) Corteva: 10 comprobantes que no llegaron a seedspayables + FA 15-41 que salió a @vylor.com: ¿se reenvían a seedspayables.argentina@corteva.com? (uno por uno, con mi OK); (2) plan por etapas del asistente dentro del CRM; (3) OP de Nexo (OC-2026-1229); (4) actualizar el informe para el equipo.
```
