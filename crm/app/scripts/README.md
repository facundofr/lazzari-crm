# Pruebas de regresión y aceptación pendiente

Ejecutar desde `crm/app`: `npm run test:regressions`, luego `npm run build`.
El build exige `check:hooks` aunque Next omita el lint heredado.
Las pruebas extraen los helpers/handlers reales; usan datos sintéticos y no escriben en producción.
No sustituyen las pruebas de integración autenticadas ni la revisión fiscal.

## Candidata 1.1.276 — no confundir con despliegue verificado

- Compras: reconciliación por artículo, revisión individual de carga masiva,
  conservación de recepción y guardas sobre documentos previos/múltiples OC.
- Finanzas: importes CSV con signo, moneda explícita, matching por moneda y
  dirección; RPC de conciliación atómica propuesto en migración 20260911001100.
- OP: parcial definido por factura antes de retener; medios iguales al neto;
  errores de lectura no tratados como historial cero; mes acotado; pagos
  directos incluidos; guardas de cheques y errores de adjuntos explícitos.
- Facturación: fecha real de cotización; nunca usar una posterior como histórica;
  invalidación del valor al cambiar fecha; numeración consultada por sociedad.
- WSAA: preservar fault legible, caché warm separada por sociedad/entorno.
- Remitos: retirado envío incorrecto de tipo 91 a FECAESolicitar; endpoint 501
  explícito. No se implementó todavía el circuito CAI/autoimpresión.

## Bloqueantes de aceptación que NO están resueltos

1. Migración de extractos pendiente de aplicación y prueba real con dos sesiones,
   distintos roles/sociedades y rollback. CLI sin sesión; navegador pide login.
2. Reproducir facturación autenticada y obtener diagnóstico WSAA real en el
   entorno publicado. No se ha demostrado caída de ARCA ni cruce de certificados.
3. Creación OP + reserva de cheques no es una transacción única. El CAS detecta
   conflictos pero no garantiza atomicidad con la OP ya insertada.
4. Guardado de factura de compra sigue siendo secuencia de operaciones; se
   bloquearon ambigüedades conocidas antes de escribir, no todas las fallas de red.
5. Consolidación concurrente y cascada a múltiples PR pendientes. Cambio de costo
   de una consolidada multi-PR protegido antes de escribir; no marcado completo.
6. Deuda USD y bases fiscales en ARS requieren conversión trazable, no sumar
   nominales. Los casos incompatibles se rechazan, no están implementados.
7. Validación fiscal integral retenciones/SICORE y conciliación histórica siguen
   pendientes. Esta tanda no cambia mínimos normativos ni presenta declaraciones.
8. Remitos requieren confirmar procedimiento real con cliente/contador. En
   Netegia se observó RE-R-00000-00000439 procesado, punto MANUAL (0000), con
   Facturar separado; esto no certifica validez fiscal ni todos los circuitos.
9. Seguimiento real de email entregado/rebotado sigue sin implementar.
10. Adjuntos por medio de pago requieren asignación explícita; se eliminó la
    asociación falsa por posición y se conservan adjuntos a nivel OP.
11. No existe aceptación funcional completa de los 47 pedidos del cliente.
    El PDF anterior no debe utilizarse como certificado de cierre.

No emitir documentos fiscales, anular pagos ni modificar datos históricos como
prueba sin un caso y autorización específicos. Registrar evidencia de cada
prueba real antes de marcar el pedido como verificado.
