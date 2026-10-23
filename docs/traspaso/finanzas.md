# Traspaso — chat Finanzas Lazza (22/10/2026)

## Qué hacía este chat
Pantallas de **Finanzas Lazza** (`/finanzas-lazza`, solo super_admin), que reemplaza a Finanzas vieja de a poco.
Historia completa en `docs/ESTADO.md`: buscá "FINANZAS LAZZA".

## Hecho en esta tanda (20/10), EN CÓDIGO y SIN PUBLICAR (sin commitear)
Último commit publicado que vi: V1.1.553 (2455819). Los cambios de abajo **no salieron**.
El 20/10 el chat Resto del CRM iba a publicarlos junto con lo suyo. Antes de seguir, fijate en `git log` si salieron.

1. **"No se pagó con tarjeta: volver a Pagos"**
   - Dónde: Finanzas Lazza › Facturas › Compras › ficha de una factura pagada con tarjeta. Archivo: `crm/app/src/components/facturas-consulta.tsx` (`FichaFacturaCompra`, solo +45 líneas).
   - Qué hace: anula el pago de la tarjeta con `gestionar_cobro` "anular" (no se borra) y pasa la factura a `pendiente`.
   - Probado en la base con ROLLBACK como Augusto.
   - Hoy hay 11 facturas pagadas con la Visa, por $ 1.812.403,61.
2. **Bancos en tarjetas + pestaña Préstamos + "Marcar pagada"**
   - Archivos: `crm/app/src/components/finanzas-lazza/bancos.tsx`, `crm/app/src/lib/bancos-lazza.ts` (`capitalFalta`; un BNA con todas las cuotas pagadas sigue "con cuotas") y `crm/app/scripts/test-bancos-lazza.ts` (OK).
   - Pestañas: **Cuentas y tarjetas | Préstamos**.
   - En las cuotas: capital, interés y cargos. En el préstamo: titular, cuenta, alias y sistema.
   - Botones **Marcar pagada** (con la fecha de hoy) y **Desmarcar**. Probado con ROLLBACK (BNA 2, cuota 5).
- tsc 0, check-hooks OK. **Sin migración.** Ninguno de los dos se vio en pantalla (el local pide login): al publicar, mirarlos en producción sin guardar.
- `docs/ESTADO.md` ya tiene las 2 entradas, arriba de todo, como "EN CÓDIGO, SIN PUBLICAR". Al publicar, cambiarlas a "PUBLICADO".
- Al publicar: subir la versión (`crm/app/src/lib/app-version.ts`).
- Archivos de otros chats que estaban modificados y **no son míos**: configuracion/page.tsx, bcra-card.tsx, presupuestos-lista.tsx, remito-ventana.tsx, asistente-guia-datos.ts, test-ayuda.ts, GUIA-USO.md. Tampoco van tsconfig.json ni la migración productos_prueba_borrar.

## Decisiones de Augusto del 20/10 (textuales)
- Lista de pendientes de Finanzas Lazza: "1. dejalo pendiente. 2. sigue como esta por ahora. 3. hacelo. 4. pendiente. 5. Antes de sacar finanzas, necesito extraer la parte de prestamos a 'finanzas lazza'".
  - 1 = cargar el concepto "servicios" (régimen 94) a los proveedores para el TXT de SICORE. Hoy 753 proveedores no tienen concepto y salen como 78. **Pendiente.**
  - 2 = Barraza, eCheq 131: se queda como está. (El chat del agente de mail cargó la comisión de ese cheque como gasto bancario, $ 97.869,55 del 20/10.)
  - 3 = volver atrás "pagada con tarjeta". **Hecho** (punto 1 de arriba).
  - 4 = que vos o el contador confirmen que el TXT SICORE v9.0 entra bien. **Confirmado por Augusto el 23/10: el TXT está bien.**
  - 5 = Préstamos en Finanzas Lazza. **Hecho** (punto 2 de arriba).
- Sobre Préstamos: "Dale A y B. También esto reorganicemoslo en tipo formato tarjetas… Y los prestamos en otra pestaña ahi mismo. B. boton marcar pagado si. hacelo."
- La tabla `lineas_credito` (Finanzas vieja › Líneas de crédito) está **vacía**: no había nada que pasar.
- **NO se pasó:** las cuotas de préstamos en "Caja proyectada" y "Pagar por semana" de Finanzas vieja (Finanzas Lazza no tiene esas pantallas). **DESESTIMADO el 23/10: Augusto no quiere Caja proyectada ni Pagar por semana.** No hay nada más que pasar de préstamos.
- Sacar Finanzas vieja: solo con su OK por escrito (ver memoria "No llevar a Finanzas Lazza sin preguntar").

## Chats relacionados
- "Agente de IA de Finanzas (revisa el correo)": chat aparte que pidió Augusto. Tiene su traspaso en `docs/traspaso/extracto-bbva-cheques.md` (`agente-ia-finanzas.md` es de otro chat).

## Herramienta útil
Para leer la base en solo lectura (desde `crm/app`, con `pg` y `SUPABASE_DB_URL` de `.env.local`, sin mostrar claves), abrir una transacción `begin read only` y terminarla con `rollback`.
Para probar escrituras como Augusto, en una transacción:
- `set_config('request.jwt.claims', '{"sub":"<id de Augusto>","role":"authenticated"}', true)`
- `set local role authenticated`
- y al final `rollback`.

## Prompt para pegar en el chat nuevo
```
Lee CLAUDE.md, docs/ESTADO.md y docs/traspaso/finanzas.md. Tarea: seguimos con Finanzas Lazza. Primero fijate con git log si ya se publicaron "No se pagó con tarjeta: volver a Pagos" y "Bancos en tarjetas + pestaña Préstamos" (archivos facturas-consulta.tsx, finanzas-lazza/bancos.tsx, lib/bancos-lazza.ts, scripts/test-bancos-lazza.ts). Si no salieron, avisame y esperá a que yo pida publicar. Después mostrame los pendientes de Finanzas Lazza y esperá mi OK.
```
