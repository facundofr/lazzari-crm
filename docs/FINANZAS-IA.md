# Finanzas con IA — plan y registro

Propuesta presentada por Claude el 15/10/2026 (chat "Agente IA y finanzas").
**OK de Augusto el 15/10/2026:** "necesito avanzar muchísimo con ese tema… hacé un desarrollo muy bueno y apliquémoslo, que quede registro de todo así Mariana o yo podemos chequear todo después".
Arranca el 16/10/2026, después de cargar el extracto BBVA.

## Reglas para todo
- La IA prepara, una persona confirma con un clic. Nunca traba (regla 1 de CLAUDE.md: avisa, no bloquea).
- Nada se borra: se anula. Cada carga tiene vista previa y vuelta atrás.
- Ninguna carga se guarda si los saldos no cierran.
- Nada se duplica.
- **Registro de todo** (pedido de Augusto): cada propuesta de la IA y cada confirmación queda anotada con qué propuso, con qué datos (mail, línea del banco, factura, certificado), quién confirmó/corrigió/descartó y cuándo. Mariana y Augusto lo pueden revisar en pantalla.

## Los 9 puntos
1. **Bandeja única "Para confirmar".** Una lista en lugar de las más de 20 pestañas: cada renglón es algo que la IA dejó armado (cobro, pago, línea del banco, cheque) con **Confirmar / Corregir / Descartar**. Base del rediseño de Finanzas.
2. **Cobros armados solos.** Junta mail (aviso / orden de pago), línea del banco (nombre del pagador), facturas abiertas (también en dólares) y retenciones. Deja el cobro completo: facturas, certificados, neto y saldo a favor. El cruce ya funciona; falta el botón.
3. **Retenciones al día.** Lee los certificados PDF y los guarda con su número; avisa si la retención no es la habitual de ese cliente; borrador del reclamo (ej. IVA RG 1575 de Aerolíneas).
4. **Extracto inteligente.** Cualquier Excel del banco (hecho, V1.1.464) con verificación de saldos; clasifica solas las líneas sueltas (impuestos, gastos, personal) y aprende de lo confirmado; identifica pagador por CUIT, CBU o nombre.
5. **Pagos a proveedores.** Precarga facturas de compra que llegan por mail; plan de pagos según banco y FCI; avisa descuentos por pronto pago.
6. **Caja y FCI.** Proyección de caja de las próximas semanas (cobros según cómo paga cada cliente, pagos, gastos fijos); sugiere suscribir/rescatar FCI; concilia FCI con custodia.
7. **Cobranza.** Días reales de pago por cliente, orden de reclamo, mensaje listo.
8. **Controles y avisos diarios.** Cheques y eCheqs banco vs CRM, diferencias de cotización, duplicados o montos raros, resumen diario.
9. **Preguntale a Finanzas.** Chat que responde con datos reales; solo lee.

## Etapas
- **Etapa A (más ahorro de trabajo):** 1, 2 y 4 + el registro.
- **Etapa B:** 3, 5 y 6.
- **Etapa C:** 7, 8 y 9.

## Diseño Etapa A (15/10/2026, para aprobar; nada en código todavía)

### Qué ve Augusto / Mariana
Finanzas > Hoy > pestaña nueva **"Para confirmar"** (primera del grupo, con número de pendientes en el menú). Cada renglón:

| Tipo | Qué dice | Botones |
|---|---|---|
| Cobro | "Corteva ACH pagó $ 15.830.875,48 el 14/10 → 5 facturas (FA 15-x…), retenciones $ …, neto = línea del banco ✔" + de dónde salió (mail / banco) y confianza (alta/media/baja) | **Confirmar** · Corregir · Descartar |
| Línea del banco | "Débito $ 100.607,02 'IMP. LEY 25413' → Impuesto (regla)" | Confirmar · Cambiar · Descartar |

- **Confirmar** carga el cobro completo y concilia la línea del banco en un clic.
- **Corregir** abre el formulario de cobro de siempre ya completo, para tocar lo que haga falta.
- **Descartar** pide un motivo corto (queda registrado).
- Arriba: "Confirmar todos los de confianza alta" (pide confirmación con la lista).
- Nunca traba: si algo no cierra, el renglón avisa en ámbar y se puede confirmar igual o corregir.

Pestaña **"Registro"** (para revisar después): todo lo que propuso la IA y lo que hizo cada persona, con filtros por fecha, persona, tipo y cliente; cada renglón abre el detalle (antes / después y los datos usados).

### Cómo funciona por dentro
- **Origen de las propuestas** (reusa lo que ya anda, no se rehace):
  - Al cargar un extracto (`extracto-bbva.tsx`) y en cada corrida del agente de mail (`agente-mail-server.ts`) se arman propuestas con `cruzarPago` (`lib/agente-mail.ts`) + `repartirCobro` (`lib/cobro-reparto.ts`) contra facturas abiertas y líneas de crédito pendientes.
  - Líneas sueltas del banco: `clasificarPorConcepto` (reglas) → propuesta; si ninguna regla la reconoce, la IA (modelo barato) sugiere clasificación. Al confirmar o cambiar, ofrece "Recordar" y crea la regla en `extracto_reglas` (aprende).
  - Lógica nueva en `lib/finanzas-propuestas.ts` (función pura, con prueba `scripts/test-finanzas-propuestas.ts`): arma la propuesta, evita duplicados (misma línea de banco o mismo mail = misma propuesta).
- **Confirmar un cobro** usa las funciones seguras que ya existen (`registrar_cobro_masivo_seguro`, con `request_key` = id de la propuesta → nunca se carga dos veces) y concilia la línea del banco. Si falla, no queda nada a medias y avisa.
- **Base de datos (migración aditiva, con vuelta atrás):**
  - `finanzas_propuestas`: sociedad, tipo (cobro / línea banco; después pago y cheque), origen (mail / extracto / regla / IA), cliente o proveedor, importe y moneda, línea del banco, mail, `datos` (facturas, retenciones, neto, saldo a favor), confianza, estado (propuesta / confirmada / corregida / descartada / anulada), qué se creó al confirmar, quién y cuándo.
  - `finanzas_registro` (bitácora, solo se agrega, nunca se edita ni se borra): propuesta, acción, quién (persona o "IA"), cuándo, antes / después, detalle.
- **Qué NO se toca:** las 20 pestañas actuales siguen igual (la bandeja se suma; el rediseño viene después), la pantalla Mail y cobros sigue, ARCA nada.

### Decisiones para Augusto
1. ¿Quién confirma? Propuesta: admin y administrativo (Mariana); vendedores no ven la bandeja.
2. ¿La IA clasifica líneas del banco que ninguna regla reconoce? Costo: centavos por extracto.
3. Los 5 cobros de mañana: propuesta, cargarlos con el sistema actual a primera hora (ya están identificados) para no depender de lo nuevo; la bandeja se prueba después con los siguientes.

### Orden de trabajo (con OK)
1. Migración + vuelta atrás → Augusto la corre (o Claude con su OK).
2. `lib/finanzas-propuestas.ts` + prueba.
3. Pantalla "Para confirmar" y "Registro".
4. Enganche en extractos y agente de mail.
5. Prueba en local sin guardar con el extracto del 13–15/10; tsc y hooks; publicar cuando Augusto diga.

## Orden de la pantalla Finanzas (propuesta 15/10/2026, sin extracto, sin migración; OK de Augusto el 15/10 a la noche: "te pongo ok pero para mañana… hacés todo cuando me levante". Se hace el 16/10 a primera hora; el punto 6 guarda un dato en la base: confirmarlo en el momento)
Visto en local con Lazzari: 5 grupos + 20 pestañas; "Hoy" tiene 2.100 px con 5 recuadros grandes y 4 avisos sueltos en lugares distintos (rescate FCI, "ojo extracto", 15 movimientos sin cuenta, falta dólar del alquiler) y 10 tarjetas de cuentas de 2 columnas.
1. **Hoy arriba = 4 números en una franja:** Bancos hoy · Para cubrir hoy · Cobros a confirmar · Pagos de esta semana.
2. **"Para hacer hoy":** todos los avisos sueltos juntos en una lista corta, cada uno con botón **Ir** (es la futura bandeja "Para confirmar").
3. **Cuentas en tabla compacta** (1 renglón por cuenta: nombre, saldo CRM, saldo banco y fecha, diferencia en rojo), en vez de 10 tarjetas.
4. **"¿Cubro los gastos fijos?" y "Resumen" en una sola franja chica**, con el detalle plegado.
5. **Menú de 20 a ~12 pestañas:** Vencimientos y CC quedan como filtros dentro de Cobrar / Pagar; Informes, Objetivos, Gastos fijos y Retenciones pasan a "Más"; Cheques y Créditos juntos.
6. **Dólar del alquiler:** la pantalla pide cargarlo en Gastos fijos → Editar; cargar el $ 1.545 que dio Augusto el 14/10 (con su OK) para que aparezca el porcentaje y "cuánto falta vender".

## Bitácora
- 15/10/2026: propuesta guardada en este archivo; OK de Augusto para avanzar. Próximo paso: diseño de la Etapa A (pantalla de la bandeja, botón de cobro, tabla de registro) para mostrarle antes de tocar código.
- 15/10/2026: diseño de la Etapa A escrito arriba. Esperando OK y las 3 decisiones.
- 15/10/2026 noche: propuesta de orden de la pantalla Finanzas (6 puntos) aprobada para hacer el 16/10, antes del extracto.
- 15/10/2026 noche, pedido de Augusto: "mañana con el extracto espero que puedas ordenar muchísimos cruces y no solo 5 cobros". Con el extracto del 16/10 cruzar TODO lo que se pueda (cobros, pagos a proveedores, cheques y eCheqs debitados/cobrados —9 por pasar a cobrado y 3 endosos—, impuestos y gastos bancarios, los 15 movimientos sin cuenta, transferencias entre cuentas propias), presentado como lista numerada para aprobar en bloque.
- 15/10/2026 (chat "Etapa A"): Augusto respondió las 3 decisiones: **sí, sí, sí** (confirman admin y administrativo; la IA clasifica lo que ninguna regla reconoce; primero la Etapa A y el extracto nuevo como prueba real). ETAPA A HECHA EN CÓDIGO (sin publicar, migración SIN CORRER):
  - `supabase/migrations/20261016120000_finanzas_bandeja.sql` (+ rollback): tablas `finanzas_propuestas` (sugerencias de la IA por línea y descartes) y `finanzas_registro` (bitácora, solo insert), función `pagar_gasto_desde_extracto` (paga un gasto ya cargado, ej. sueldos, con la línea del banco, todo o nada).
  - `lib/finanzas-propuestas.ts` (prueba `scripts/test-finanzas-propuestas.ts` OK): arma la bandeja. Orden: lo que cruza solo (reglas, cheques, FCI, movimientos ya cargados) → cobro por mail del agente (neto exacto, facturas y retenciones del aviso; en dólares calcula el TC) → cobro sin mail (cliente por CUIT/nombre y suma exacta, o una única combinación de facturas de un cliente con retenciones de hasta 6 %; solo facturas emitidas hasta el día del pago) → pago de gasto ya cargado (por CUIT; por importe solo del mismo mes) → pago a proveedor por CUIT ("a cargar" con el nombre) → sugerencia de la IA → sin resolver. Un movimiento se ofrece a una sola línea.
  - `api/finanzas/clasificar-lineas` (Opus 5.5, respaldo Sonnet 5.5 y Haiku): hasta 30 líneas por llamada; la pantalla manda de a 25, 4 a la vez. Clasifica impuestos con subtipo (ley 25.413, IVA, SIRCREB, percepciones, IIBB, AFIP), gastos del banco, sueldos, servicios, etc. Al confirmar con "Recordar" crea la regla (por CUIT si lo hay; nunca con conceptos genéricos como "TRANSFERENCIA").
  - Pantalla Finanzas > Hoy > **Para confirmar** (`components/finanzas-para-confirmar.tsx`): arrastrar el Excel (verifica saldos con la misma función de Extractos), resumen, "Confirmar los N seguros", grupos Seguro / Revisar / Sin resolver, Confirmar / Corregir / Descartar (con motivo), Registro con buscador. El cobro usa `registrar_cobro_masivo_seguro` con `request_key` = id de la línea (nunca se carga dos veces) y cruza la línea.
  - Prueba con datos reales (solo lectura, 121 líneas pendientes de Lazzari del 01/09 al 09/10): 16 seguras (15 pagos a proveedores por CUIT/OP), 6 cobros armados ($ 19,3 M, con retenciones estimadas → "Revisar"), 4 pagos de gastos (3 sueldos de octubre y Porcel), 94 a la IA. IA real (sin guardar): 95 líneas en 35 s, honesta (confianza baja cuando no hay datos).
  - **Hallazgo:** el Excel "Detalle_mov_cuenta" NO trae quién paga/cobra; el Excel **"Movimientos"** sí (columna Detalle con el nombre). Bajar siempre "Movimientos": la identificación de cobros mejora mucho.
  - **Para que ande:** correr la migración 20261016120000 en el SQL Editor; publicar (versión nueva).
  - Pendiente (siguiente tanda): Corregir de un cobro abre el formulario de cobro ya completo (hoy manda a Extractos); enganchar la corrida del agente de mail; GUIA-USO.md.
