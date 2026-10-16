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
- 15/10/2026 (mismo chat): OK de Augusto: "Ok corré la migración y publicá. Ok armá el asistente".
  - Migración 20261016120000 CORRIDA (probada antes con --probar) y **V1.1.479 PUBLICADA** (commit 04d77a1, Ready).
  - Extractos: `Movimientos (17).xls` (caja de ahorro) cierra pero ya estaba todo cargado; mostró que el mismo renglón viene con otro texto en cada formato de Excel → se iba a duplicar. Arreglado: la huella es fecha + importe + saldo (`lineasNuevas`/`huellaLinea` en lib/extracto-bbva.ts, prueba en test-extracto-bbva.mjs). `Movimientos (16).xls` (cuenta corriente) NO cierra por $ 793.925,51: el Excel "Movimientos" omite impuestos del 14/10 (los mismos que faltaban en el 15). **Para la cuenta corriente pedir el "Detalle_mov_cuenta" del 09/10 a hoy.**
  - **Asistente de Finanzas** (V1.1.480): botón flotante en Finanzas (solo admin/administrativo) → chat con Opus 5.5 (`api/finanzas/asistente`, herramientas: estado_caja, cobranzas, lineas_banco con totales de impuestos por subtipo, correos_agente, leer_correos_ahora (corre el agente de mail), gastos_fijos, movimientos, registro, sugerir_boton). Solo lee; lo único que ejecuta es la lectura de correos. Se le adjunta el Excel del banco (verifica y carga sin duplicar) y queda en el Registro. Conversación guardada en la compu (localStorage). Probado en local con datos reales: respuesta completa en ~40 s (saldos, cheques de la semana, impuestos de septiembre $ 12.166.341,89, avisos de acuerdo y FCI).
  - Pendiente: probar "leer correos" en producción (en local no están las claves de Gmail); que el asistente pueda confirmar renglones de la bandeja desde el chat (hoy manda a la pestaña).
- 15/10/2026: Augusto: las compras de Mercado Libre desde hoy llegan a administracion@lazzari.com.ar → el agente de correo las va a leer (hoy las clasifica como factura/aviso de proveedor). Siguiente paso posible: que el agente las cruce con las OC de Mercado Libre y con el débito del banco/tarjeta.
- 15/10/2026 noche (chat "Agente IA + Finanzas", retomado desde la app). Extractos CC cargados con OK de Augusto:
  - BBVA Empresas: el "Movimientos" omite los débitos del día (SIRCREB/ley 25.413 de hoy: $ 869.561,82) → su saldo calculado hacia atrás no cierra. El "Detalle_mov_cuenta" con rango largo viene SIN columna de saldo (solo Fecha/Concepto/Sucursal/Importe): **no arrastrarlo a Extractos**, la huella no coincide y duplicaría todo (falta soportarlo en `lineasNuevas`: comparar sin saldo cuando el Excel no lo trae).
  - CC 312483/1: 64 renglones 13–15/10 con saldos calculados hacia atrás desde el saldo del banco $ 33.113.330,71 (control: fin 14/10 = $ 41.273.948,73, igual al Detalle con saldo). 01/09–09/10 coincide renglón por renglón (522/522). Salto conocido de $ 75.636,31 entre el 09/10 (CRM −1.575.636,31) y el 13/10 (−1.500.000,00): impuesto "IMPUESTO LEY 09/10/26" listado el 14/10 que el banco ya había descontado en el saldo del 09/10.
  - CC 318933/7: 5 renglones (09/09–14/10), saldo $ 54.797,36 al 14/10.
  - Para confirmar (Augusto: "confirmalo, no me hagas doble cheque"): confirmados 60 renglones seguros desde el navegador con su sesión (cheques debitados, impuestos, comisiones, pases entre cuentas, FCI, Visa, OP ya cargadas, cobro Termo Córdoba que cierra exacto con el mail). NO confirmados a propósito: cobro Corteva (TC 1.597,47 vs factura 1.507,5 y "otra retención" de $ 506.317,66 sin detalle) y los "Cobro (falta cargarlo)" / "Pago a X (falta la orden de pago)": confirmarlos solo clasifica la línea y no registra el cobro/pago en la CC. Quedan 130: 35 seguros (esos), 29 Revisar, 66 Sin resolver. Ojo: el navegador del panel descarta los confirm() → para cobros hay que aceptar el diálogo.
  - Sueldos (OK de Augusto, comprobantes BBVA): los gastos "Sueldo X — octubre 2026" (gastos fijos) SON el sueldo de septiembre pagado el 02/10 (nota agregada, no se crearon duplicados). Pagados con sus líneas: Jero (CUIT 20372644606), Mari (CUIT 27339634578; el sistema lo proponía como Pereyra) y Seba ("Transferencia inmediata"). Extras 07/10 cargados como gastos nuevos y pagados: Mari y Jero $ 589.100 (premio agosto 400.000 + monotributo 61.100 + OS 128.000), Seba $ 400.000 (premio agosto). Anotado en finanzas_registro.
  - Porcel y Natalia Inga: hasta octubre los pagaba Grupo LA desde Galicia CC 78656613 (09/10: Porcel $ 500.000, Natalia $ 1.705.000); desde ahora Lazzari. HECHO: los gastos de octubre de Porcel y Natalia pasaron a Grupo LA (fecha 09/10, nota con el comprobante); en los gastos fijos de Lazzari quedó la nota "desde noviembre lo paga Lazzari" (en octubre Lazzari los puede mostrar pendientes). Extras renombrados "Premio agosto + Monotributo + Mutual". Los $ 500.000 que salieron de Lazzari (10/09, 23/09, 28/09 ×2, 09/10) NO son Porcel: sin identificar.
  - Cobros: el Excel "Movimientos" (hoja Históricos, columna 9) trae el NOMBRE/CUIT del pagador → 30 de 41 cobros sin nombre identificados (ver lista en el chat). La bandeja proponía mal varios por "única combinación" (Barraza era Corteva Agriscience $ 15,99 M; Corteva era Logística Casadei; Cargill 14/09 era Corteva). Cruzados con recibos ya cargados (importe exacto): Termo 25/09 $ 278.605,78 y Todd 08/09 $ 215.599,87 (ambos recibos cargados como "efectivo"). Corregido Termo 14/10 (estaba cruzado con la retención de Ganancias: **bug en confirmarUno, toma ids[0]; arreglar para tomar el movimiento "transferencia"**).
  - Corteva 14/10 ($ 15.830.875,48): aviso ACH + certificado 15/10 = 5 facturas (FCEA 15-2, FA 15-13, FCEA 15-3 en USD a TC 1.512,50; FA 16-6 y 16-7 en ARS), retenciones IIBB 236.281,57 + Ganancias 270.036,09. La base no deja cobrar USD y ARS juntos → 2 cobros del mismo renglón. HECHO con OK de Augusto: recibo USD (neto 14.988.785,96 + IIBB 223.713,08 + Gan 255.672,10) cruzado con el renglón; recibo ARS (neto 842.089,52 + IIBB 12.568,49 + Gan 14.363,99) marcado conciliado a mano (nota en el renglón). Las 5 facturas quedaron "pagada". Retenciones repartidas en proporción al bruto.
  - Notas literales (pedido de Augusto): los 58 renglones confirmados hoy sin nota quedaron con texto claro (Ley 25.413 sobre débitos/créditos, SIRCREB con fecha de acreditaciones, IVA 21 % sobre comisión, comisión, cheque N° + a quién se entregó, OP + proveedor, FCI, Visa, pases entre cuentas). Las retenciones de los cobros ya tenían tipo, cliente y facturas en la descripción. **HECHO 16/10 (sin publicar, ver ESTADO): PEDIDO DE AUGUSTO (15/10): que la bandeja escriba esta nota literal sola al confirmar cada renglón (misma lógica que el script de hoy, pasarla a `src/lib` con prueba), para tener a fin de mes un informe bien detallado de cada cosa (impuestos por tipo, retenciones, IVA, comisiones, cheques, pagos).** Va junto con el arreglo de `confirmarUno` (ids[0]).
  - Quedan sin cargar (falta info): resto de cobros de septiembre (Corteva Seeds/Agriscience $ 230 M+, Cargill, Synthon, Soenergy, Limagrain, Chacraservicios, Casadei, Soychu, Muni Pergamino): pagan facturas del sistema viejo (PV 8/9) o sin aviso. Pedir a cada cliente el detalle de la OP, o cargar las facturas viejas.
  - Avisos del agente de correo: solo desde el 02/10; los de septiembre pagan facturas PV 8/9 (sistema viejo) que no están en el CRM.
  - Se guardó con script (service role; la función `importar_extracto_bbva` exige usuario logueado), mismo formato que la función. Extracto CC: `a2496373-5fdd-4efa-9b6a-281c7a8859df`. Todos los renglones quedan "pendiente" para Para confirmar.
- 15/10/2026 tarde. Augusto: "la IA no cierra sola, quiero ver propuestas y yo decido" (se mantiene la regla: todo es propuesta). Pidió ordenar Finanzas de verdad e integrar "Mail y cobros". HECHO (V1.1.486):
  - Menú en 4 grupos que responden una pregunta: **Hoy** (Resumen · Para confirmar · Correo), **Cobrar** (Facturas de venta · Recibos), **Pagar** (Cheques · Facturas de compra · Órdenes de pago · Gastos), **Bancos** (Extractos · Movimientos). Lo de consulta en "Más" (Créditos y préstamos, Cheques Martín F., CC, Vencimientos, Gastos fijos, Retenciones, Revisar, Informes, Objetivos). Se fue el grupo "Cheques y créditos" (las "dos pestañas de créditos").
  - **Cheques** arranca en "Pendientes (a pagar y en cartera)": 116 de 375; el historial en "Todos (historial)" (`ESTADO_PENDIENTES` en lib/cheques-filtro.ts).
  - **Correo** (Finanzas > Hoy, `components/finanzas-correo.tsx` + `lib/correo-finanzas.ts`, prueba `scripts/test-correo-finanzas.ts`): reemplaza la pantalla "Mail y cobros" (la dirección vieja redirige; sale del menú lateral). Cada mail dice en qué quedó HOY: pago avisado → Cobrado / En el banco ✓ / Para confirmar (botón a la bandeja) / Falta extracto / No llegó; factura de proveedor → Cargada ✓ / Sin cargar (botón a Facturas de compra); facturas nuestras reenviadas por clientes no cuentan como "sin cargar". Lo resuelto se pliega solo ("archivar los N"). Reclamos de cobranza abajo, con los clientes que avisaron un pago en gris ("esperá").
  - "Para hacer hoy" del Resumen suma los avisos del correo y manda las líneas del banco a Para confirmar. El Asistente conoce la pestaña Correo.
  - Pendiente (tanda 2, a pedido): caja de 4 semanas con el día en que no alcanza; Cobrar con un renglón por cliente; Pagar como línea de tiempo por semana.
