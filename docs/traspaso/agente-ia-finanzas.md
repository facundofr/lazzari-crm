# Traspaso — chat "Finanzas" (actualizado 19/10/2026)

Para una sesión nueva sin el historial. Leer antes `CLAUDE.md`, la memoria (`C:\Users\lazza\.claude\projects\C--Users-lazza-lazzari\memory\MEMORY.md` y sus archivos) y, en `docs/ESTADO.md`, las entradas **"FINANZAS LAZZA"** (arriba de todo). Lo de más abajo en este archivo es el trabajo del banco del 16-17/10.

## Finanzas Lazza (pantalla nueva `/finanzas-lazza`, solo super_admin) — estado al 19/10/2026
Todo publicado; producción en V1.1.539. Finanzas vieja sigue en el menú (no se reemplaza hasta que Augusto apruebe).
- **Tanda 1 — V1.1.526:** Reportes (mes), IVA (débito/crédito), Vencimientos. Solo lectura.
- **Tanda 2 — V1.1.527:** inicio con 14 tarjetas; Facturas (`components/facturas-consulta.tsx` modo `completa`), Cuentas corrientes (una sola, clientes y proveedores), Vencimientos con filtros y orden, OP, Recibos, Retenciones, Movimientos, Objetivos.
- **Tanda 3 — V1.1.528** (migración `20261019120000_finanzas_lazza_bancos.sql`, corrida): Bancos (cuentas, tarjetas con resumen leído por IA, préstamos debo/me deben), Cheques (en fecha, por estado, 4 semanas, pestaña Martín F., Subir Excel del banco). Correcciones 1 (Descargar/Enviar OP, Guardar y enviar), 2 (CC en una moneda según la ficha), 3 (editar vencimiento y días de pago), 5 (columna OP en facturas de compra).
- **V1.1.529:** lector de los 6 Excel de eCheq del BBVA en "Subir Excel del banco".
- **Cobrar — V1.1.530 y V1.1.531:** `components/finanzas-lazza/cobrar.tsx` abre las MISMAS ventanas de Finanzas (`cobro-masivo-liquidacion` $ y `FxSettlementDialog` US$). Tarjeta Cobrar en el inicio + atajos en CC, Vencimientos, Facturas y Recibos. Arrastrar/pegar comprobante (OP, transferencia, cheque, retención) en las ventanas de cobro.
- **Pagar — V1.1.532:** la ventana Nueva OP salió de `finanzas/page.tsx` a `components/orden-pago-nueva.tsx` (código movido tal cual; la usan las dos pantallas). Tarjeta Pagar (`components/finanzas-lazza/pagar.tsx`) + Pagar en CC, Vencimientos y "Nueva OP" en Órdenes de pago. Sin probar: OP en US$ y pago parcial directo.
- Lógica pura en `src/lib/finanzas-lazza.ts`, `cheques-lazza.ts`, `bancos-lazza.ts`; pruebas `scripts/test-finanzas-lazza.ts`, `test-cheques-lazza.ts`, `test-bancos-lazza.ts` (con `npx tsx`).
- Servidor local propio: `.claude/launch.json` → "crm-finanzas" (puerto 3005).

### Próximo
- **Gastos (Tanda 4, 20/10, migración corrida; publicado V1.1.544):** `components/finanzas-lazza/gastos.tsx` + `lib/gastos-lazza.ts`; migración `20261020150000_gastos_grupos_debito_automatico.sql` CORRIDA. Detalle en ESTADO ("FINANZAS LAZZA › GASTOS (TANDA 4)").
- **V1.1.540 (20/10):** Anular OP (y "Anular y pagar de nuevo"), N° de OP en un renglón, "Marcar pagada con tarjeta" en la ficha de compra. Publicado y probado.
- **Facturas (19/10, PUBLICADO V1.1.539 y probado en producción):** `components/finanzas-lazza/facturas.tsx` reemplaza Pagar, Cobrar y Vencimientos (una fila por factura, Ventas | Compras, Pendientes/Vencidas/Todas, tildar → Pagar/Cobrar (n), Cobrada/Pagada con con Ver/Descargar/Enviar, Enviar recibo por mail). Detalle en ESTADO ("FINANZAS LAZZA › FACTURAS").
- **Sacar Finanzas vieja (19/10):** lista de lo que falta en Lazza entregada a Augusto (Gastos, Para confirmar/Extracto, movimientos y cheques a mano, caja proyectada, BCRA, líneas de crédito, exportar, acceso para admin/administrativo). Ocultar = `oculto: true` en `components/layout/sidebar.tsx` línea ~77; los links a /finanzas siguen andando. Orden propuesto: Facturas → Gastos → Banco → cheques/movimientos → acceso → ocultar.
- **Saldos iniciales (recomendación, sin OK):** fecha de corte sugerida 31/07/2026, Excel del sistema anterior (cliente/proveedor, CUIT, moneda, saldo); cuidado con no duplicar los cobros del sistema anterior ya cargados (Del Sol).
- **V1.1.538 (19/10, publicada y probada):** corrección de Recibos (columna Banco); Resumen de cuenta completo en la ficha de CC + Excel/PDF; Pagar sin facturas abre en "Pago a cuenta". Nada sin publicar.
- **Tanda 4:** (19/10: propuestos 7 grupos de gastos, espera respuesta de Augusto; ver ESTADO) Gastos con todas las variantes + recibos numerados (1 recibo = 1 cobro con su N°, con migración aditiva + rollback) + Descargar (PDF, `generateReciboPDF`) y Enviar recibos por mail (corrección 4). Diseñar con Augusto antes de tocar.
- **Tanda 5:** Facturar nuevo (no le gusta la de Ventas). A diseñar con Augusto.
- Corrección 6 (formato/exportación de retenciones, SICORE v9.0): espera al contador.
- Propuesta sin OK: "Subir Excel del banco" que acepte los 6 juntos y los reconozca solo (ver ESTADO, "EXCEL DE eCHEQ DEL BBVA").

### Pendientes de Augusto (datos)
- **Del Sol:** cobros de las OP 18326 y 18368 cargados el 19/10 (ver ESTADO "DEL SOL: 6 OP CRUZADAS"). FA 16-18: Augusto confirmó que no es venta repetida. Nada pendiente.
- **11 cheques propios con fecha pasada sin debitar** ($ 23.712.482,92 al 19/10): 6 el banco los da ACTIVO (el que lo recibió no lo cobró), 5 no salen en el Excel (trae solo 100).
- **~30 líneas del banco sin cruzar** (orden de trabajo más abajo, "A medias / próximo paso exacto").

### Reglas de este chat
- Cargar solo lo **literalmente exacto**; lo dudoso se pregunta. Nunca inventar ni asignar solo.
- No tocar la base ni publicar sin OK de Augusto. Para publicar: `crm/app/scripts/publicar-limpio.sh`; si falla el push, no publicar en Vercel; fijarse antes que otro chat no esté publicando (`C:\Users\lazza\lz-pub-auto`).
- Reusar las ventanas de Finanzas (misma pieza, no copia). Pantallas compactas. Desplegables con `Select` de `components/ui/input`.

## Prompt para seguir en un chat nuevo
```
Sos el chat de Finanzas del CRM Lazzari. Leé CLAUDE.md, mi memoria (C:\Users\lazza\.claude\projects\C--Users-lazza-lazzari\memory\MEMORY.md y sus archivos) y docs/traspaso/agente-ia-finanzas.md (sección "Finanzas Lazza"); para detalle, las entradas "FINANZAS LAZZA" de docs/ESTADO.md. Todo publicado hasta V1.1.532 (producción en V1.1.534). Próximo: Tanda 4 (Gastos con variantes + recibos numerados con migración + Descargar/Enviar recibos) y Tanda 5 (Facturar nuevo, a diseñar conmigo). Pendientes míos: Del Sol eCheq 3644 en cartera sin cobro, 11 cheques propios con fecha pasada sin debitar, ~30 líneas del banco sin cruzar. Solo cargar lo literalmente exacto. No toques la base ni publiques sin mi OK. Saludame corto y preguntame por cuál seguimos.
```

---

# Trabajo del banco (16-17/10/2026)

Leer también, en `docs/ESTADO.md`, la parte **"FINANZAS — TRASPASO A CHAT NUEVO (16/10/2026, noche)"** y las notas "BANCO 16/10/2026 (tandas 3 y 4)".

## Objetivo
Dejar al día las finanzas de **Lazzari**: cada línea del banco BBVA (CC 091-312483/1 y CA 091-339549/3) cruzada con su cobro, pago o gasto, con notas literales. También simplificar la pantalla Finanzas. Grupo LA no se tocó.

## Terminado y publicado (todo en producción, hasta **V1.1.501**)
- **V1.1.495**
  - Notas literales al confirmar (`src/lib/finanzas-notas.ts`, prueba `scripts/test-finanzas-notas.ts`).
  - Botón "Sist. anterior" en Para confirmar.
- **V1.1.496–499: Caja proyectada de 4 semanas**
  - Archivos: `lib/caja-proyectada.ts`, `components/finanzas/caja-proyectada.tsx`.
  - Pestañas nuevas "Clientes a cobrar", "Pagar por semana" y "Préstamos".
  - Los préstamos BNA 1 (Luis María Lazzari, cuotas 3 y 4 atrasadas) y BNA 2 (Andrés Leguizamo, al día) **no entran en la caja** (`en_caja=false`).
- **V1.1.499–500: bandeja "Para confirmar"**
  - Lee el resumen PDF del BBVA (`lib/resumen-bbva.ts`) y el CSV de ARCA "Mis comprobantes recibidos" (`lib/arca-recibidos.ts`). Prueba: `scripts/test-resumen-bbva.ts`.
  - Guarda quién es la contraparte de cada línea (columna `extracto_movimientos.contraparte`).
  - Reconoce débitos automáticos como gastos fijos y facturas ARCA de proveedores.
  - Tolera 1 centavo de diferencia y los acentos mal codificados.
- **V1.1.501:** los CUIT propios (20379309128 y 30719396042) nunca se toman como proveedor ni como cliente (`CUITS_PROPIOS` en `lib/finanzas-propuestas.ts`).

## Publicado 17/10/2026: V1.1.517 (commit 39e7fb4) — Finanzas unificada
- Menú: **Hoy** (Resumen · Para hacer[Revisar/Correo]) · **Cobros** (Clientes · Facturas de venta) · **Pagos** (Proveedores · Facturas de compra · Órdenes de pago · Gastos[Gastos/Gastos fijos] · Próximas semanas) · **Tesorería** (Banco[Para confirmar/Extracto y reglas] · Cheques[Todos/Martín F.] · Movimientos[Todos/Recibos de cobro]) · **Informes** (Riesgo BCRA/Retenciones/Objetivos/Créditos y préstamos). 23 → 13 pestañas, ninguna pantalla perdida.
- **Clientes** (`cc_clientes`) junta Por cliente + CC + Vencimientos de venta; **Proveedores** (`cc_proveedores`) junta CC + Vencimientos de compra. Saldo, vencido (días), próximo vencimiento, último cobro/pago, nos debe/le debemos + neto, condición; botón "Por vencimiento"; clic = ficha.
- Nombres viejos (`cobrar_clientes`, `vencimientos`) abren la nueva (`UNIFICADAS`/`tabReal` en `lib/finanzas-grupos.ts`); las demás pantallas son `vistas` de una pestaña (mismas pantallas de antes).
- Probado en producción sin guardar (21 pantallas OK). Test: `npx tsx scripts/test-finanzas-grupos.mjs`.
- Servidor local propio: `.claude/launch.json` → "crm-finanzas" (puerto 3005, `NEXT_DIST_DIR=.next-finanzas`). Si varios chats corren `npm run dev` en la misma carpeta se pisan (500 en todo).
- `scripts/publicar-limpio.sh` corregido: saca el enlace a node_modules antes de borrar la copia.

## Hecho y SIN publicar
Nada. (Las cargas de datos del banco fueron directo en la base; detalle en ESTADO.md.)

## Revisión cobros/pagos (16/10/2026)
- Bancos OK. Corregidos con OK: cuenta de 3 movimientos (Termo cobro 05/10 → BBVA; Ret. Ganancias Termo 14/10 y liquidación BNA septiembre → sin cuenta), cobro Thiago X-8 con nota "pagó por Mercado Pago", gasto "Sueldo Augusto — septiembre 2026".
- Tabla cobrar/pagar factura por factura entregada (ver ESTADO "TABLA COBRAR/PAGAR LAZZARI"). Speed Business duplicada: Augusto dice que está bien, no tocar.
- Para revisar: Cargill saldo CC $ 355.341,31 vs vencido $ 780.863,17 (crédito $ 425.521,86 sin aplicar a factura).

## Migraciones
Las dos las corrió Augusto, con "Success":
- `20261016170000_prestamos_cuotas.sql`
- `20261016180000_extracto_contraparte.sql`

Sus rollbacks están en `crm/app/supabase/rollback/` con el mismo nombre. **No hay migraciones pendientes.**

## A medias / próximo paso exacto
Quedan unas 30 líneas del banco sin cruzar. El orden de trabajo está en ESTADO.md (puntos 1 a 5):
1. **Transferencias inmediatas sin nombre:** Augusto manda capturas de la app BBVA Móvil. No están en Net Cash: ahí ya se leyeron las 44 que había.
2. **Tarjeta Visa Electron ****9347:** 4 "Pagos de servicios" por $ 6,4 M y $ 750.000 en efectivo. Hay que preguntar qué son.
3. **CUIT sin nombre**, Fernández, Prisina y el débito de $ 637.
4. **Muni Pergamino y Pascale:** dejados para después.
5. **Certificados que faltan:** Corteva 13/10, Chacraservicios y Cargill. También revisar Del Sol: el cheque 3968 y la posible FA 16-18 duplicada.

**Saldos a recordar:**
- Villafañez: se le deben **$ 7.302.633,73**. Son los 3 eCheqs anulados 90017190, 90017191 y 90017193 ($ 9.302.633,73) menos 2 pagos de $ 1.000.000.
- Corteva FA 15-12: cobrada el 13/10. La NC 15-2 anula la FA 15-8, no la 15-12.

## Cómo se carga (patrones que funcionaron)
- **Cobro o pago del sistema anterior:**
  - un `movimientos` transferencia/pago, con `cuenta_id` del banco y `conciliado=true`;
  - las retenciones, cada una en su `movimientos`, **siempre con `cuenta_id` null**;
  - después `extracto_movimientos` → `estado='matcheado'`, `clasificacion`, `match_movimiento_id` y `nota` literal.
- **Gasto:** `gastos_manuales` (categoría) + `movimientos` pago con `gasto_manual_id` + cruce de la línea. Personales → `clasificacion='personal'`.
- **Factura que está en el CRM:** usar la RPC `registrar_cobro_masivo_seguro` desde el navegador con la sesión de Augusto (dev local, cookie `sb-…-auth-token`). En dólares, pasar `tipo_cambio` en medios y retenciones. Después cruzar con `aplicar_cruces_extracto`.
- La restricción `tiene_contraparte` de `movimientos` exige cliente, proveedor o gasto.

## Decisiones de Augusto
- Cargar solo lo **literalmente exacto**. Lo dudoso se pregunta.
- **Gastos personales:** como gasto, categoría "Personales". Ya están: FONDEO, alquiler Perincioli, su mamá Patricia Alvarez, Fabiana, ARBA (patente) y Federación Patronal (seguro del auto).
- **Débitos automáticos:** como gastos fijos, categoría "Débitos automáticos". Quedan ahí la luz (2 suministros) y Flow.
- Augusto **no es proveedor**: se borró en Lazzari.
- Prefiere trabajar en el chat ("del sistema no entiendo").
- **Corregir errores y simplificar** sin esperar que lo pida.
- Corteva no deja saldo a favor: cada pago es de una factura.
- No publicar por ahora: Augusto junta los 6 chats y publica en una sola tanda.

## Errores conocidos / ojo
- Hay cobros cargados por otros con `cuenta_id` null. Ejemplo: FB 15-5 y 15-6 de la Muni, que se arreglaron al cruzarlas.
- Algunos cobros viejos no se pueden editar (trigger): hay que anular y volver a registrar con la RPC.
- El cliente "PIERREFITTE ROCIO" se dio de alta el 16/10. Verificar que no exista otro con otro nombre.

## Ideas para después
- Botón en Para confirmar para subir las capturas de BBVA Móvil, que la IA lea a quién fue cada transferencia.
- Avisar cuando un cobro de factura queda sin cuenta de banco.
