# Cierre del chat "Ventas y facturación" (03/11/2026)

## 1. A medias o sin publicar
Nada. El último arreglo ("el control diario ya no vence un PR con remito", `api/cron/presupuestos-vencimiento/route.ts`) se publicó en V1.1.661 el 03/11 (commit b7626b5, deploy dpl_ELw4Wg7XCnTJLRs9FV4Aawjp7CSu, Ready en producción). Se nota recién en la próxima corrida del control diario.
- Queda la copia limpia `vf2` (worktree en `C:\Users\lazza\AppData\Local\Temp\claude\C--Users-lazza-lazzari\8a3e35f8-b15f-4b2b-8049-efbdbd74ab01\scratchpad\vf2`, en b7626b5, sin cambios pendientes; tiene `.env.local`, `.vercel` copiado y junction a node_modules). Se puede borrar (sacar la junction antes de borrar).

## 2. Espera un OK de Augusto
Nada abierto. Lo que dejó para más adelante, sin pregunta pendiente:
- Clientes con datos raros ("para otro momento", 03/11): "CONSUMIDOR FINAL" con CUIT 1 y RI, Emanuel Benítez (999), Cin Geoghegan (644), Mandolino Monotributo con DNI.

## 3. Espera a otra persona
- PR-2026-1270 (Corteva): lo maneja Jero. No se factura todavía y NO se aprieta No facturar; queda en Facturar como recordatorio. Si al cerrar la venta se hace un PR nuevo, el 1270 (con los remitos) se saca con No facturar. No volver a preguntar.
- Cargar OC en la ventana de factura (V1.1.616): falta que alguien guarde una OC real y ver un PR sin OC (hoy no hay).

## 4. Avisos para el chat CRM
- ARCA: nunca probar facturas, NC ni remitos desde la compu local. No borrar nada de ARCA.
- Clientes con DNI: siempre factura manual (X), nunca ARCA.
- Diferencia de centavos de IVA CRM/ARCA: a Augusto no le interesa; no proponerla.
- FA 15-90 sin mandar: Augusto ya lo resolvió.
- Mails de facturación del cliente: se sugieren para la factura, no al mandar el PR.
- En la carpeta principal, `scripts/test-fce-ui.cjs` está modificado por otro chat: no publicarlo (la prueba está retirada en `scripts/retiradas` desde V1.1.621).
- Detalle completo del tema en `docs/traspaso/ventas-facturacion.md`.
