# Traspaso — chat "Diseño CRM" (creado 29/10/2026)

Chat nuevo, armado a pedido de Augusto el 29/10/2026. Antes de seguir, leé `CLAUDE.md` y las primeras entradas de `docs/ESTADO.md`.

## Qué le toca a este chat
Cómo se ven y se usan las pantallas:
- Pantallas compactas, procesos cortos, menos clics, que se vean todos los números.
- Consistencia: desplegables (Select de `ui/input` para opciones cortas, Autocompletar para listas largas), botones, colores por sociedad (Lazzari `#FF4500`, Grupo LA `#2563EB`), moneda escrita igual en todos lados.
- Revisiones de diseño de cualquier pantalla, con mockup o captura antes de cambiar.

## Reglas de este chat
- Proponer y mostrar antes de cambiar (mockup o captura). Cambios grandes: plan y OK de Augusto.
- El código de cada pantalla es de su chat (Finanzas Lazza, Compras, Remitos, Transportes, Presupuestos, Ventas y facturación, Web). Si un cambio de diseño toca una de esas pantallas: avisarle a Augusto y pasarle el prompt listo para ese chat, salvo que él diga que lo haga este chat.
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
1. Que Augusto elija: qué pantalla del mockup implementar primero, o una revisión de diseño de alguna pantalla.
