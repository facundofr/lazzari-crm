# Cierre 03/11/2026 — chat Transportes

(Pedido relayado por el chat Consultas, "por pedido de Augusto". No se tocó nada más: ni ESTADO.md, ni código, ni commit.)

## 1. Lo que tengo a medias o sin publicar
**Nada de código ni de base queda sin publicar.** Todo lo de Transportes está en origin/main y en producción (último deploy mío: V1.1.643, 30/10/2026, "Ready"; origin/main ya va por V1.1.663). Todas las migraciones de Transportes están CORRIDAS por Augusto y verificadas (con rollback en `crm/app/supabase/rollback/`):
`20261029120000` (Mateo Perrone Monotributo confirmado), `20261029130000` (`transportistas.no_factura`), `20261029140000` (José Rodríguez proveedor, CUIT 20313644074), `20261029150000` (borra Nuevo Plus Ultra), `20261029160000` (`transportistas.destinos`), `20261030150000` (FC Pluscargo 14/10 a tipo transporte), `20261030151000` (rubro Transporte unificado en los 17 transportistas), `20261030160000` (Comisiones Serger con el tilde Transporte).

Lo publicado desde que se retomó el chat (27/10): tipo `transporte` en la factura de Transportes (V1.1.630); ¿Nos factura? Sí/No en el Catálogo (V1.1.631); columna Destinos + buscador (V1.1.633); pestaña Facturas de solo lectura (V1.1.638); botón **Cargar factura** con la misma ventana de Compras Lazza (`tipoInicial="transporte"`) y aviso en Compras si el proveedor es transportista (V1.1.642); fuera la palabra "Liquidado", renglón "Facturado" para quien no factura (V1.1.643). Las pruebas fueron `tsc` 0 y hooks OK; **ninguna pantalla se vio en el navegador** (pedía login): Augusto las usó en producción.

Copias de trabajo: las publiqué desde copias limpias de origin/main en `%TEMP%` (`pub`, `pub2`…`pub6`, ya borradas salvo `pub2` y `pub6`, que Windows no dejó borrar por "Permission denied": son basura, no tienen nada sin publicar).

## 2. Lo que espera un OK de Augusto
- **Condición de IVA de José Rodríguez:** quedó cargada como Monotributo "a confirmar". Pregunta: "¿Qué condición de IVA tiene José Rodríguez? Pasame su factura y la dejo confirmada."
- **"El otro desplegable" en ¿Quién lo lleva?** (pantalla de Remitos): ¿lo resolvió el buscador de V1.1.543? Sin respuesta de Augusto; puede darse por cerrado si no lo menciona.
- **Que los transportistas que no facturan estén en "No":** en el Catálogo, ¿José Álvarez, José Rodríguez y los demás quedaron en No? Todos arrancaron en Sí; sin ese cambio no aparece el botón Factura manual.
- **Aviso de Remitos "Ese viaje ya se liquidó al transportista…"** (`lib/remito-entrega.ts`, `AVISO_LIQUIDADO`): Augusto pidió sacar "liquidado" de Transportes; ese mensaje es de Remitos y no se tocó. Pregunta: "¿Querés que ese aviso diga 'facturado' en vez de 'liquidó'?"

## 3. Lo que espera a otra persona
Nada.

## 4. Avisos para el chat CRM
- **Decisiones de Augusto (memoria `transportes-sin-montos-ni-liquidado`):** Transportes es solo un contador de viajes. Las facturas se cargan con **Cargar factura** (misma ventana de `components/compras-lazza-factura.tsx`; si se cambia una, cambia la otra), sin atar viajes. Los transportistas que facturan no llevan montos (Hero R-1070 y R-1086 vienen con la factura; el viaje de Speed del 7/10 se deja sin monto: **no volver a preguntarlo**). **Factura manual** solo para los que no facturan, una vez a fin de mes; esos viajes pasan a un renglón **Facturado**. La palabra "Liquidado" no va más. "¿Quién lo lleva?" es solo un dato del remito: no mezclar Remitos con Transportes. Nunca asignar nada solo.
- **Tipo de factura:** Gastos, Reportes y Contabilidad cuentan Transportes solo con `facturas_compra.tipo = 'transporte'`. El flete no va en el PR ni genera OC.
- **La carpeta `C:\Users\lazza\lazzari` está desactualizada y con basura mía.** Está muy atrás de origin/main, tiene `crm/app/src/app/(crm)/transportes/page.tsx` modificado (una versión vieja mía, NO usarla) y copias sin seguimiento de migraciones que **ya están en origin/main** (`20261029120000`, `130000`, `140000`, `150000`, `160000`, `20261030150000`, `151000`, `160000_comisiones_serger` y sus rollbacks). Un `git pull` o merge ahí puede fallar por "untracked files would be overwritten". Antes de trabajar: trabajar desde una copia limpia de origin/main, o borrar esas copias duplicadas (son idénticas a las de origin) y revertir ese `page.tsx`. No lo hice yo para no tocar la carpeta compartida.
- Para publicar yo usé una copia limpia de origin/main en `%TEMP%` con `node_modules` enlazado por "junction" (`mklink /J`). **Al borrar la copia, sacar primero el enlace con `rmdir node_modules`**; borrar con `--force` sin sacarlo puede vaciar el `node_modules` real.
- Datos: la ficha de Pluscargo, Comisiones Serger, José Rodríguez y Mateo Perrone ya tienen el tilde Transporte. Nuevo Plus Ultra (ex firma de Rápido Plus Ultra) está borrado.
