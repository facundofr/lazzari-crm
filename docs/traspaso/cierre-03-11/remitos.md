# Cierre 03/11 — Remitos

Sin pendientes.

## 1. A medias o sin publicar
Nada. Remitos está publicado y verificado en producción hasta la V1.1.546 (anular remito en vez de borrar; "¿Quién lo lleva?" con buscador, arranca en "Todavía no sé" y corrige/cancela el viaje si no está liquidado). Este chat no tocó código desde que se retomó.

## 2. Espera un OK de Augusto
Nadie lo pidió; no hacer sin su OK:
- "¿Querés poder BORRAR un remito de verdad? Hoy solo se anula y queda tachado."
- "¿Querés que al anular un remito el PR vuelva de remitido a aprobado?"

## 3. Espera a otra persona
Nada. Idea suelta: probar la foto del remito firmado con una foto real de un cliente.

## 4. Avisos para el chat CRM
- Remitos con CAI NUNCA se prueban desde local (gastan número real de ARCA; van 77 de 5000). Pruebas solo Sin CAI, en un PR de Augusto, avisándole cuál antes de guardar, y después borrar con un SQL (en pantalla ya no se puede borrar).
- La compu local usa la base REAL.
- Remito hecho = entregado: no proponer estados ni avisos de "sin entregar". Un remito se anula, no se borra.
- Nunca asignar solo (transporte arranca en "Todavía no sé"), nunca inventar, nunca bloquear (avisos amarillos).
- Desplegables con el Select de components/ui/input (o Autocompletar si la lista es larga).
- Quedan sin uso en la base: `profiles.prueba_remitos_nueva`, tabla `remito_respuestas`, columna `remitos.estado`. No borrar.
- `vercel --prod` a veces da "Not authorized": reintentar desde copia limpia. Si falla el push, no hacer vercel --prod.
- Detalle completo: docs/traspaso/remitos.md.
