# Traspaso — chat "Diseño CRM" (creado 29/10/2026)

Chat nuevo, armado a pedido de Augusto el 29/10/2026. Antes de seguir, leé `CLAUDE.md` y las primeras entradas de `docs/ESTADO.md`.

## Qué le toca a este chat
Augusto (29/10): "quiero que trabajes como un ingeniero en sistemas, que me ayuda a optimizar toda la parte visual del CRM: la vista, el orden, los espacios, los tamaños y los diseños".
Cómo se ven y se usan las pantallas:
- Pantallas compactas, procesos cortos, menos clics, que se vean todos los números.
- Consistencia: desplegables (Select de `ui/input` para opciones cortas, Autocompletar para listas largas), botones, colores por sociedad (Lazzari `#FF4500`, Grupo LA `#2563EB`), moneda escrita igual en todos lados.
- Revisiones de diseño de cualquier pantalla, con mockup o captura antes de cambiar.

## Reglas de este chat
- Proponer y mostrar antes de cambiar (mockup o captura). Cambios grandes: plan y OK de Augusto.
- Augusto (29/10): "no pases el prompt a ningún otro chat, todo lo que sea de diseño lo hacés vos". Este chat cambia el diseño de cualquier pantalla (solo cómo se ve: no la lógica ni la base). Antes de tocar el archivo de otra pantalla, fijarse que origin/main no tenga cambios nuevos ahí y publicar solo lo de diseño.
- Los PDF (remitos, PR, facturas, OC, OP, recibos) también son de este chat. PDF con tablas largas ARREGLADO y PUBLICADO en V1.1.625 (commit 1f162ce): `lib/pdf-cortes.ts` corta por renglón (antes el avoid-all de html2pdf desarmaba las tablas). Verificado en producción: remito 0018-00000123 en 2 hojas. Falta el rediseño visual de los PDF junto con el resto.
- **Propuesta 2 en prueba (29/10): PUBLICADA en V1.1.626.** Copia de trabajo: worktree `scratchpad/diseno-wt` del chat (sobre origin/main 1f162ce = V1.1.625), servidor `crm-diseno` (puerto 3009) en `.claude/launch.json`. Interruptor "Diseño nuevo (prueba)" arriba de Configuración, solo super_admin, se guarda en la compu (localStorage `lazzari-diseno-nuevo`; clase `diseno-nuevo` en `<html>`; la letra Geist se baja solo si está prendido). Con el interruptor apagado el CRM queda igual que antes (verificado). Prendido: menú oscuro flotante con cambio de sociedad (la barra de arriba ya no muestra el botón de sociedad), barra sin franja con título grande, buscador grande y botón principal negro, fondo claro tipo papel, `ui/card` y `ui/data-table` con sombra suave y encabezados sin mayúsculas (clases `dn-*` en `globals.css`). Clientes: 4 tarjetas (Saldo en pesos con el color de la sociedad, Saldo en dólares, Crédito otorgado, Clientes en N provincias), iniciales de color, CUIT con guiones (`textoDocumentoConGuiones` en `lib/documento-cliente.ts`, con prueba), saldo en negrita si no es 0, nombre hasta 380 px con "…". El "8 pend." de la lista son facturas pendientes, no PR (el boceto decía PR por error). Archivos: theme-context, globals.css, sidebar, header, (crm)/layout, ui/card, ui/data-table, configuracion/page, clientes/page, components/diseno-nuevo-interruptor.tsx, lib/documento-cliente.ts y su prueba. NO subir `tsconfig.json` (lo cambia el servidor local). Ojo al probar con el navegador de la app escondido: las transiciones quedan congeladas y el menú parece blanco (no es un error).
- Augusto quiere un CRM moderno, "que no parezca del año 2000". Hablarle simple y relajado.
- No publicar ni tocar la base sin su OK. Publicar solo lo de este chat, desde una copia limpia de `origin/main` (procedimiento en `docs/traspaso/resto-crm.md`, "Cómo publica este chat"). Nunca `git stash` ni cambiar de rama.

## Mockup de usabilidad (estado al 29/10)
https://claude.ai/artifact/52FyWtMbDzthkqKKtdprBT — navegable, 4 pantallas. **Solo diseño, nada implementado.**
1. Inicio "Mi día" (sugerido para empezar).
2. Presupuestos con avance de la venta.
3. Nuevo proveedor en pasos.
4. Orden de pago con resumen fijo.

Augusto todavía no eligió cuál implementar. Ojo con los dueños: Presupuestos → chat Presupuestos; Nuevo proveedor → Compras; Orden de pago → Finanzas Lazza. "Mi día" (inicio) no tiene dueño todavía: sería de este chat.

## Dashboard y Muestras
Ocultas del menú (siguen existiendo por link). Augusto (28–29/10): "todavía no" se borran. No tocar hasta que él diga.
- Dashboard: es el único lugar donde se ve Actividad reciente (`activity_log`), Top clientes, conversión y CoberturaFijos; `/pendientes` redirige a `/dashboard`. Si se hace "Mi día", conviene decidir qué de esto pasa ahí antes de borrarlo.
- Muestras: 0 envíos cargados en la historia.

## Material de referencia
- `docs/traspaso/auditoria-ux-finanzas.md` y `auditoria-ux-impuestos-cheques-cc.md` (26/10): auditorías UX de Finanzas. 12 arreglos rápidos publicados en V1.1.594; el resto (mejoras estructurales) es del chat de Finanzas Lazza.
- `docs/traspaso/menu-pantallas-sacadas.md`: links a pantallas sacadas del menú.

## Pendiente
0. **Menú en una sola lista (29/10), PUBLICADO en V1.1.622.** Augusto: orden Clientes, Proveedores, Presupuestos, Compras, Remitos, Transportes, Facturas, Correos, Calendario, Finanzas, y "una sola lista" (sin títulos Inicio/Vender/Comprar/Entregar/Plata). Solo `components/layout/sidebar.tsx`; permisos y ocultas iguales. tsc 0, hooks OK. Augusto "Sí, cambialos": en el menú dice **Compras** (antes Compras Lazza) y **Correos** (antes Correos enviados); el título dentro de cada pantalla no se tocó.
1. **Rediseño general (29/10), esperando el OK de Augusto.** Relevamiento: 5 tamaños de letra distintos, 53 de 76 tablas hechas a mano (solo 23 usan `ui/data-table`), 52 ventanas a mano (sin `ui/modal`), montos sin una función común. Antes y después de Clientes, página para comparar: https://claude.ai/artifact/JLT7hDf4VSZoZTDxxHTDJz (fuente `docs/traspaso/diseno-crm/propuesta-clientes.html`): Hoy, Propuesta 1 (sobria), 2 (moderna con menú lateral oscuro) y 3 "2026" (sin menú lateral, barra flotante arriba, caja de IA al frente, bloques grandes). Augusto pidió "rompé el molde, año 2026". El lienzo viejo (https://claude.ai/artifact/VoCuy7r4qyhgBYqGnDCbdg) no lo podía ver bien. Si le gusta: primero el marco común (menú, barra de arriba, tarjetas de números, tabla y botones en `components/ui` y `layout`), así cambian todas las pantallas a la vez, y después pantalla por pantalla.
