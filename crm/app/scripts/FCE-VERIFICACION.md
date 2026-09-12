# FCE - alcance de la versión 1.1.290

## Publicación autorizada sin homologación

El usuario pidió explícitamente publicar y validar en producción en lugar de continuar homologación. La 1.1.289 fue publicada el 12/09/2026 (Vercel READY). La 1.1.290 corrige la clasificación de sesión ausente como indisponibilidad en middleware, detectada en la comprobación posterior. No se emitieron comprobantes fiscales de prueba. El certificado de homologación quedó separado y no fue activado en producción.

Supabase: el usuario informó ejecución exitosa; ambas firmas RPC respondieron permission denied a solicitudes anónimas, confirmando existencia y restricción de acceso. Esto no reemplaza una prueba funcional con usuario autenticado. El archivo local de migración fue reemplazado por `su` durante la gestión manual; la copia íntegra está en el historial y en `scripts/fiscal-emission-migration-recovery.sql`. No sobrescribir cambios del usuario.

## Verificado el 12/09/2026

- Autenticación productiva WSFECRED con los certificados existentes de Lazzari y Grupo LA.
- Consulta real, solo lectura, CUIT receptor 30641405554 para 2026-09-12: obligado, mínimo ARS 5.549.862 (ambos emisores).
- Consulta real de historial Grupo LA tipo 201, PV 1, número 2: PendienteRecepcion y Recepcionado. No se modificó su estado.
- Pruebas offline de la ruta POST/GET real: sociedad/rol, elección común/FCE, umbral, datos obligatorios y bloqueo de notas comunes contra FCE.
- Serialización contrastada con WSDL oficial; CBU, SCA/ADC, vencimiento, tipo A/B, cotización hasta seis decimales y un único intento de FECAESolicitar.
- Pruebas del formulario, respuestas obsoletas, redondeos, PDF, fecha por PV y filtro de ventas. Build y suite general verificados antes del despliegue.

## Implementado

Selección automática por consulta del receptor, fecha e importe, con repetición del control en servidor. FCE A/B exige CBU válida y vencimiento no anterior a hoy, y selección SCA/ADC. Conserva el snapshot técnico en nota_interna con marcador ARCA_FCE_V1 (sin migración); llega al PDF con importes en letras y leyenda vigente. Registro FCE solo lectura desde el detalle, independiente del estado contable de cobro. No se fuerza FCE ante errores de consulta ni se interpreta un error como 'no obligado'.

## Límites explícitos, no marcar como resueltos

- No se emitió una FCE real ni una FCE en homologación: no había certificado separado de homologación configurado. Las pruebas de emisión fueron con respuestas simuladas.
- No se implementaron aceptación, rechazo, cesión ni cancelación en WSFECRED. Las notas FCE se bloquean con indicación de resolver por el portal; nunca convertirlas a notas comunes. El régimen jurídico de esos flujos exige implementación y pruebas separadas.
- Reserva durable implementada en código y migración aditiva. Claves persistentes en navegador; reserva atómica por sociedad/clave y bloqueo de PV mientras haya intento incierto; respuesta ARCA guardada antes de escritura local. Pruebas de ruta simulada y SQL real en PostgreSQL embebido. Ver estado de aplicación y autorización de publicación arriba; homologación no realizada.
- Recuperación de intentos inciertos requiere conciliación contra ARCA por administrador; no hay liberación automática ni por vencimiento. El ledger conserva solicitud y respuesta, pero no constituye prueba de CAE: verificar siempre contra ARCA. La interfaz de conciliación automática no está implementada.
- El snapshot FCE usa una columna existente de nota interna, no una tabla fiscal inmutable. Debe migrarse a campos dedicados con reserva transaccional cuando haya acceso de migración. CLI Supabase sin sesión en esta revisión.
- La elección asume el encuadre actual de estas sociedades como emisores MiPyME para operaciones locales normales; excepciones documentadas y cambios de habilitación requieren revisión, no override indiscriminado.
- El plazo de aceptación está fijado en 21 días para el período normativo verificado; se bloquea emisión FCE posterior al 31/10/2026 hasta revisar vigencia normativa.
- Prueba visual productiva limitada: la sesión accesible del navegador mostró perfil genérico y 0 ventas; no se comprobó el caso del cliente con su sesión completa. El filtro tiene cobertura offline y actualiza por realtime/foco.

## Ejecución

`npm run test:fce`, `npm run test:regressions`, `npm run build`.

`node scripts/check-wsfecred-readonly.cjs` usa certificados existentes y SOLO consultas. `--history` consulta el documento histórico citado; nunca emite ni acepta.

Fuentes: https://servicioscf.afip.gob.ar/facturadecreditoelectronica/documentos/Manual_Desarrollador_WSFECRED_v2.0.0.pdf ; https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf ; WSDL productivos oficiales ; Ley 27.440 y Resolución 219/2025 actualizadas.
