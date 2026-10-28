# 04 — Auditoría de integraciones

Detalle completo en [trabajo/agente-5-integraciones.md](trabajo/agente-5-integraciones.md) (externas) y [trabajo/agente-7-flujos-y-fuentes-de-verdad.md](trabajo/agente-7-flujos-y-fuentes-de-verdad.md) (internas). Ningún servicio externo se llamó durante la auditoría.

## 1. Integraciones externas

| Integración | Dónde | Confiabilidad | Qué pasa si falla a mitad de camino | Hallazgos |
|---|---|---|---|---|
| **ARCA WSFE (FA/FB/NC)** | `app/api/facturacion/route.ts`, `lib/arca-wsfe-node.ts` | media | Hay reserva por intento, lock por punto de venta y un solo intento a WSFE. La **NC** se puede reanudar completa. La **factura común** no: si ARCA autoriza y falla el guardado, el PV queda trabado y el PR se marca facturado igual | H13, H12, H31, H64 |
| **ARCA WSFECRED (FCE)** | `lib/arca-wsfecred-node.ts`, `test:fce` | media/alta | test:fce simula ARCA y pasa 10 de 11 pruebas. No se revisó línea por línea | — |
| **Padrón ARCA (CUIT)** | `app/api/cuit-lookup` | media | Nunca bloquea. Pero baja la seguridad TLS de todo el proceso y devuelve datos de depuración al navegador | H90 |
| **Anthropic (IA)** | `app/api/parse-*`, `ai*`, `conciliar-compra`, `finanzas/*`, `compras/*`, agente de mail | media | **Ninguna ruta de IA guarda datos de negocio sola**: todo vuelve a la pantalla para que lo revise una persona. El JSON que devuelve se valida poco. `parse-cobro` y `parse-lista-precios` no tienen modelo de respaldo. `ai-presupuesto` lee el catálogo sin sesión, así que la IA nunca ve precios | H35, H90 |
| **Modo Hacer del asistente** | `lib/ia-acciones*.ts` | alta | Campos acotados, revalida contra la base antes de guardar, historial y Deshacer que no pisa cambios posteriores (test OK) | — |
| **BCRA** | `app/api/cron/bcra`, `lib/bcra-server.ts` | alta | Incremental, paginado, no pisa un informe bueno con un error y solo avisa. Duplica alertas si se refresca a mano en el mismo mes | — |
| **BNA / DolarAPI** | `app/api/cron/cotizacion`, `app/api/cotizacion-bna`, `lib/bna-historical.ts`, `lib/invoice-exchange-rate.ts` | media | El cron falla cerrado y no pisa la cotización manual. Pero **la tabla `cotizaciones_dolar` acepta escritura del rol anónimo** y hay dos reglas distintas para elegir la cotización de una factura. La emisión ARCA re-verifica contra BNA en vivo, lo que limita el daño | H01, H37 |
| **Resend (mail)** | `app/api/email/send` | media | El remitente y las URLs de adjuntos los decide el navegador. Los adjuntos que fallan se omiten sin aviso. El envío y el registro no son atómicos | H38 |
| **Gmail + agente de mail** | `app/api/cron/agente-mail`, `lib/agente-mail-server.ts` | media | Hoy está apagado. Tiene tope diario e idempotencia por `gmail_message_id`. Un error transitorio deja el mail como procesado (no reintenta) y calcula el saldo de factura con una fórmula propia | H28, H90 |
| **Storage** | buckets `facturas-compra`, `comprobantes`, etc. | **baja** | 5 buckets públicos; `facturas-compra` con INSERT/UPDATE/SELECT para el rol público; el anónimo puede listar 99 comprobantes y 153 facturas de compra. Sin límite de tamaño ni de tipo | H04 |
| **Crons de Vercel** | `vercel.json`, `app/api/cron/*` | media | Funcionan hoy. Tres de los cuatro (agente-mail, bcra, presupuestos-vencimiento) **fallan abiertos** si faltara `CRON_SECRET`; solo cotización falla cerrado. El aviso de 5 días de PR nunca se crea por la deduplicación por título | H36, H70 |

### Resiliencia en general
- **Timeouts y reintentos**: las rutas de IA dependen del `maxDuration` de Vercel, que no se pudo ver. Solo algunas tienen modelo de respaldo, y ninguna reintenta sola.
- **Errores silenciosos**: hay adjuntos de mail que se omiten, truncado de la lista de precios que se ignora en pantalla y el agente de mail que marca procesado ante un error.
- **Idempotencia**: está bien en cobros, OP, NC, BCRA, agente de mail y cotización. Falta en la factura común (recuperación) y en las operaciones armadas en el navegador (ver 07).

## 2. Integraciones internas (módulo ↔ módulo)

Las conexiones entre módulos se relevaron y contrastaron. De **100 conexiones** que listaron los agentes, **34 son incompatibles** (reglas o fuentes distintas para el mismo dato), **34 dudosas** y **32 compatibles**. La tabla completa está en [08-matriz-dependencias.md](08-matriz-dependencias.md).

Las conexiones internas más frágiles:

| Conexión | Problema | Hallazgo |
|---|---|---|
| PR → OC (al aprobar) | Se arma en el navegador, sin transacción ni idempotencia por proveedor | H44 |
| PR editado → OC / remitos | Renglones borrados y recreados, se pierde el `presupuesto_item_id` | H06, H07, H56 |
| PR rechazado → OC | No se propaga | H09 |
| Factura de compra → Finanzas / OP / Plan | El saldo se calcula en 7 lugares con criterios distintos | H17, H18, H19 |
| Factura de venta → NC / agente de mail / asistente / Cta. Cte. del cliente | Hay 5 consumidores que no usan la regla única `lz_cobrado_factura` | H08, H28 |
| Movimiento anulado → extracto bancario | La línea del banco no se libera | H15 |
| Factura ARCA → base | El total guardado difiere del autorizado en 20 de 120 casos (±1–2 centavos) | H12 |
| OP → retención congelada | Las OP del Plan de pagos no la anotan | H25 |

## 3. Lo que está bien en integraciones
- Emisión ARCA con reserva, lock por PV, número tomado de ARCA y re-verificación de la cotización contra BNA en vivo.
- La NC tiene reanudación completa.
- `/api/remito` falla cerrado sin pedir tickets WSAA.
- La IA nunca guarda sola. La conciliación de compras y la clasificación de líneas validan la respuesta contra listas cerradas.
- Las facturas se leen por QR o texto en el navegador antes de usar IA (`lib/leer-factura-local.ts`).
