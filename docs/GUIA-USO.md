# Guía de uso — CRM Lazzari

Guía corta de cada pantalla para el equipo. La usa también el asistente ✨ para contestar dudas.
<!-- Mantenerla al día: cada tanda que cambia una pantalla actualiza su sección acá y después corre `node scripts/guia-a-ts.mjs` desde crm/app (genera src/lib/asistente-guia-datos.ts, que usa la Ayuda). -->

**Antes de empezar**
- Arriba elegís la sociedad: **Lazzari** o **Grupo LA**. Todo lo que ves y cargás es de la sociedad elegida.
- El sistema casi nunca frena: si algo no cierra, **avisa** y te deja seguir. Lo que propone el sistema o la IA es una sugerencia.
- Para corregir, mejor **Anular** que borrar (borrar quedó para administradores).
- Cada uno ve el menú según su rol: super_admin y admin ven todo; administrativo, plata y compras; vendedor vende, compra, entrega (sin pagar); viewer solo mira.

---

## Inicio

### Buscador y Ayuda (en todas las pantallas)
**Buscador:** el cuadro "Buscar clientes, PR, facturas..." de arriba (Ctrl+K). Con 2 letras busca clientes (razón social), presupuestos (número), facturas (número) y productos (código o nombre), hasta 3 de cada uno, de la sociedad activa.
**Ayuda (botón violeta abajo a la derecha):** muestra la guía de la pantalla donde estás y tiene un buscador ("¿Qué necesitás hacer?") que es gratis. Atajos: **Resumen de hoy**, **Stock bajo**, **Mis pendientes**, **Clientes dormidos**, **Top facturado**. Si la guía no alcanza, **¿No alcanza? Preguntarle a la IA**: responde con la guía y con los datos que tu usuario puede ver; solo consulta, no carga ni cambia nada. Tiene un tope de gasto por mes (US$ 5); al llegar, queda la búsqueda gratis. **Solo Augusto (por ahora): Preguntale o pedile algo a la IA**: además de consultar, le podés pedir cambios chicos (mail, teléfono, dirección, notas o datos bancarios de un cliente o proveedor; agregar o corregir un contacto; a quién se envió una factura o su nota interna; observaciones de una OC; cuánto llegó de un renglón de OC). Te muestra **antes → después** y no guarda nada hasta que apretás **Hacer**; **Descartar** la deja sin hacer. Arriba, **Historial** ("Lo que hizo la IA") lista lo hecho con **Deshacer** (no pisa lo que alguien cambió después). No factura, no toca precios, pagos ni ARCA, y no borra.

### Dashboard — /dashboard — todos
**Para qué sirve:** resumen del día: facturado del mes, presupuestos activos, conversión, margen promedio, últimos PR, alertas, mejores clientes, actividad.
**Cómo se hace:** 1) **Nuevo PR** arma un presupuesto rápido; **Clientes** va a la lista. 2) **Pendientes** (admin y administrativo) lleva a la lista de cosas abiertas. 3) **Ver en Reportes** para gráficos e historia.
**Ojo:** admin y administrativo ven "¿Cubro los gastos fijos?" (vendido neto del mes vs objetivo, ganancia vs fijos, "¿Cuánto me falta vender?"). El dólar del alquiler se carga ahí y queda solo en esa compu. El "Margen promedio" de arriba se calcula distinto que el del recuadro.

### Pendientes — /pendientes — todos
**Para qué sirve:** junta lo que hay para hacer y para responder, por área (Pagos, Cobros, Compras y proveedores, Gastos fijos, Bancos y créditos, Sistema, Decisiones).
**Cómo se hace:** 1) Arriba, "Atrasos que cuenta el sistema" (facturas vencidas, OC sin factura, PR en Solicitud, extracto sin cruzar; solo lo que tu rol ve). 2) **Ir** lleva a la pantalla donde se resuelve. 3) Escribí en **Respuesta** (se guarda al salir). 4) Tildá para marcar hecho; **Ver hechos** / **Ver abiertos**. 5) "Agregar un pendiente…", elegí área y "Para hacer"/"Para responder", **Agregar**. 6) **Copiar respuestas** copia lo abierto con tus respuestas.

### Calendario — /calendario — todos (viewer solo mira)
**Para qué sirve:** agenda de visitas, seguimientos, entregas y reuniones.
**Cómo se hace:** 1) **Nuevo evento**: Título, Tipo, Fecha inicio, Cliente, Responsable, "Quién puede verlo" → **Crear evento**. 2) A la derecha, "Próximos 14 días y vencidos"; ✓ lo completa. 3) En el detalle, **Editar** o **Eliminar**. 4) Filtros por tipo, usuario y público/privado.
**Ojo:** "Privado" lo ven vos y el responsable. Cada uno edita lo suyo; admin edita todo.

---

## Vender

### Clientes — /clientes — todos (viewer solo mira)
**Para qué sirve:** padrón de clientes con datos, contactos, sucursales, cuenta corriente y Ficha 360.
**Cómo se hace:** 1) **Nuevo cliente** → CUIT → **Consultar ARCA** → **Crear cliente**. 2) Buscar por razón social, CUIT o email, o filtrar. 3) En el cliente: Datos, Contactos, Sucursales, Relevamiento, **Ficha 360**, Actividad, Cta. Cte. 4) Ficha 360: cotizado, ganado, conversión, última compra, saldo, oportunidades, PR, artículos, facturas, cobros y muestras en su poder. 5) Tarjeta **Central de Deudores (BCRA)**: semáforo, deuda en bancos, cheques rechazados; **Actualizar ahora**, **Ver detalle por banco**.
**Ojo:** "cliente parecido / CUIT repetido" y BCRA son avisos: se puede guardar igual. **Pide OC para facturar** lo muestra en Ventas → "Esperando OC" (no bloquea). **Eliminar** pide motivo; con historial queda desactivado.

### Oportunidades — /oportunidades — todos
**Para qué sirve:** a quién llamar y qué ofrecerle según lo que compró.
**Cómo se hace:** 1) Filtrá: Le toca reponer, Temporada, Volver a cotizar, Complementario, Cliente dormido. 2) "Buscar cliente o artículo…" o vendedor (el vendedor arranca con sus clientes). 3) Tocá el cliente para abrir su ficha.
**Ojo:** clientes con alerta BCRA salen marcados (informe en Finanzas → Informes). Muestra 200; usá filtros para el resto.

### Presupuestos — /presupuestos — todos (viewer solo mira)
**Para qué sirve:** armar, enviar y seguir los presupuestos (PR). Dos pestañas: **Presupuestos** (la lista) y **Armar presupuesto** (la IA arma el PR desde el pedido del cliente).
**Cómo se hace:** 0) Pestaña **Armar presupuesto**: pegá el mail o WhatsApp (con la firma), o arrastrá foto, PDF o Excel → **Armar presupuesto con IA**. La IA busca al cliente, elige artículo y proveedor de la lista de costos y propone el precio (el último que le cobraste si deja margen; si no, el de la lista). Si le falta un dato (talle, modelo, marca) pregunta: respondé o **Seguir sin responder**. Revisá el semáforo (Listo / Revisar / Falta), cambiá artículo con **Buscar** o el precio a mano, y usá "Decile a la IA qué cambiar" (**Deshacer** vuelve atrás). **Crear presupuesto** lo deja en la lista y lo abre. 1) **Nuevo PR** → cliente → **Agregar item**, **Lista de costos** o **Repetir presupuesto anterior** → **Crear presupuesto**. 2) Pedido largo: **Cotización express (IA)** (Excel, PDF, imagen o mensaje) → **Armar cotización** (si a la IA le falta un dato como talle, modelo o marca, pregunta: respondé o **Seguir sin responder**) → revisá; en "Decile a la IA qué cambiar" podés pedir "agregame 20 guantes nitrilo T9", "cambiá los anteojos a Segufer" o "sacá X" → **Aplicar** → **Agregar … al presupuesto**. 3) Si todavía no se cotiza: **Crear como Solicitud** → escribí lo que pide el cliente y/o **Elegir productos (como en un PR)** o **Armar con IA** → después **Convertir**. 4) Enviar: **Descargar PDF**, **Enviar por email**, **Copiar resumen** (para WhatsApp). 5) Estado: Solicitud, Pendiente, Aprobado, Rechazado (dentro: Rechazado o Postergado, con motivo). 6) **Seguimiento**: renglones apretados con días sin respuesta por colores, estado y **Llamar**. 7) Arriba, la franja roja "X vencidos (últimos 30 días)" → **Ver**; el botón **Vencido** está al lado de Pendiente. En cada PR vencido, **Extender 5 días** (vence hoy + 5). 8) En el detalle: franja con ítems, total, ganancia y margen; **Ocultar costos** (para mostrarle la pantalla al cliente) y la pantalla completa se recuerdan en la compu. 9) **Eliminar** (papelera): el admin cualquiera; el vendedor solo los suyos sin aprobar. Pide motivo (puede ir vacío) y queda en notas internas; el admin los ve en **Papelera** y los puede restaurar.
**Ojo:** margen mínimo 15 % = aviso, se guarda igual. Cantidad a la argentina: "1.000" = mil; cantidad con decimales o precio 0 = aviso amarillo, no frena. **Ganancia / Margen** descuenta 7 % de gastos (2 % si es manual sin ARCA): rojo < 15 %, ámbar < 20 %; es interno. En la ventana del PR, debajo de **Descuento general**: Subtotal · IVA · Total y abajo lo interno 🔒 (Margen · Ganancia · neto). Aprobar sin costos avisa (**Aprobar de todos modos**) y después ofrece enviar las OC. Aprobado: **+ Cargar OC** del cliente. "Facturado" lo pone la factura. Los recuadros son del mes en curso; "Todos" no muestra facturados.

### Muestras — /muestras — todos (viewer solo mira)
**Para qué sirve:** prendas que se dejan al cliente para ver.
**Cómo se hace:** 1) **Registrar entrega** → cliente, sucursal, prendas (artículo, talle, color, cantidad), **Otra prenda** → **Registrar**. 2) Al resolver, cada prenda: **Devolvió**, **Se la quedó** o **Baja / regalo**.
**Ojo:** "Se la quedó" no factura: hay que hacer el PR o la factura. "Más de 30 días en el cliente" avisa qué reclamar.

### Ventas — /ventas — todos
**Para qué sirve:** sigue cada PR aprobado hasta cobrarlo.
**Cómo se hace:** 1) Bandejas: Esperando OC, Para facturar, Para entregar, Para cobrar, Terminadas, Todas. 2) **Próximo paso** (Cargar OC / Facturar / Entregar / Cobrar). 3) En la venta: OC del cliente, entrega (remitos o **Remitar desde el PR**), compras, factura y cobro; **Cobrar** va al cobro. 4) Buscar por cliente, PR, OC o factura.
**Ojo:** sin OC del cliente igual se factura. Más de 15 días aprobado sin facturar → aviso. **Facturar** y **Cancelar venta** solo con permiso de facturación (el resto ve "La factura la emite administración"). Cancelar pasa el PR a rechazado.

### Facturas — /consulta-facturas — todos
**Para qué sirve:** consultar facturas de venta y de compra (solo lectura).
**Cómo se hace:** 1) **De venta** / **De compra**; buscar por cliente o proveedor, CUIT, número, PR u OC. 2) Venta: **Ver / bajar PDF**, **Reenviar al cliente**. 3) Compra: **Ver factura del proveedor**.
**Ojo:** acá no se emite, cobra, paga ni anula (eso es Ventas o Finanzas).

---

## Comprar

### Proveedores — /proveedores — admin, administrativo, vendedor
**Para qué sirve:** ficha de cada proveedor (fiscales, administración, vendedores, "Cómo se le paga", banco, deuda) y pestañas **Lista de costos** y **Listas de precios**.
**Cómo se hace:** 1) **Nuevo proveedor** → CUIT → **Buscar en ARCA**; **Leer papeles con IA (ARCA, CBU…)** completa lo vacío → **Crear**. 2) "Vendedores (a ellos se les mandan las OC)" → **Agregar vendedor** (mail/WhatsApp de administración solo para facturas y pagos). 3) **Cómo se le paga**: condición, "Se paga a (desde factura)", medio, "Cheque diferido a" ("Queda así: …"). 4) Deuda: filtro **Con deuda**, **Ver cuenta corriente →**. 5) **Eliminar** con **Motivo**; para pausar, **Desactivar** / **Reactivar**. 6) "¿Es transporte o taller?" para que aparezca en Transportes o Personalización.
**Ojo:** con historial no se borra, se desactiva. Días de pago desde la fecha de factura. **Lista de costos** es solo consulta: los precios vienen del catálogo, nunca se cambian a mano. Semáforo 🟢 ≤30 días, 🟡 30-60, 🔴 >60 → **Pedir actualización**. BCRA de proveedores: Finanzas → Informes (aviso).

### Compras Lazza: órdenes de compra — /compras-lazza — quien tiene la casilla "Compras Lazza"
**Para qué sirve:** controlar que llegue todo lo que se compró. Los vendedores no compran: al aprobar un PR la OC se arma sola (una por proveedor) y cae acá "Por pedir".
**Cómo se hace:** 1) Pedir: **Copiar** (artículos y cantidades, sin precios) → pegalo en el WhatsApp o mail del proveedor → tocá **Por pedir** y pasa a **Pedido** con la fecha de hoy (el lápiz ✏️ cambia la fecha). 2) Llegó: **Llegó** → **Completo** o **Parcial** por artículo; si te equivocaste, **Corregir cantidades**. 3) Abrir la OC (tocá su número): proveedor de toda la OC o de un artículo (pasa a otra OC de ese proveedor), cantidades, moneda y precio (pasan al PR), entrega estimada, **Operador**, observaciones. 4) **Nueva OC**: a mano, sin PR (stock, insumos, complementaria). 5) **Anular OC**: queda en la pestaña **Anuladas** (no se borra) y se puede **Reactivar**.
**Ojo:** la OC no lleva factura ni pago: "Terminada" = llegó todo. Filtros: persona (Op/Ven), proveedor, cliente, estado, fecha y **Atrasadas**. Nada traba: lo raro avisa.

### Compras Lazza: facturas del proveedor — /compras-lazza (y Finanzas → Pagar) — quien tiene la casilla "Compras Lazza"
**Para qué sirve:** cargar la factura o nota de crédito del proveedor: va directo a su cuenta corriente (no se ata a ninguna OC).
**Cómo se hace:** 1) **Cargar factura** → subí el PDF: lee el **QR de ARCA** o el texto, sin IA ("Buscando proveedor…" y lo encuentra por CUIT). **Leer con IA** es opcional (para ver los artículos). 2) Revisá tipo, número, neto, IVA, percepciones y total. 3) "¿Cómo se paga?": **Va a Pagos** (transferencia o eCheq a __ días: calcula el vencimiento) o **Ya pagada con Visa**. 4) **Nota para Finanzas** (opcional) → **Guardar**.
**Ojo:** si al proveedor le falta el mail o el CBU/alias, lo pide y lo guarda en su ficha. La nota de crédito queda como crédito del proveedor.

### Personalización — /personalizacion — admin, administrativo, vendedor
**Para qué sirve:** bordados y estampados en talleres externos: qué se lleva, cuánto cuesta, liquidación del mes.
**Cómo se hace:** 1) **Talleres y precios** → **Nuevo** (o marcar un proveedor como taller) y su lista por técnica. 2) **Nuevo trabajo**: taller, cliente, PR; **Traer prendas del presupuesto**; técnica, ubicación, logo. 3) Estado: En el taller → Listo parcial / Listo → Retirado; cargá **Listas** y **Fallas**. 4) Logos por cliente (técnica, ubicación, taller, último costo). 5) **Generar liquidación interna** o **Liquidar con su factura**.
**Ojo:** el costo se completa solo (✨). Liquidar es de administración. Si el taller factura, la factura se carga antes en Cargar facturas.

---

## Entregar

### Remitos — /remitos — admin, administrativo, vendedor
**Para qué sirve:** documentar entregas.
**Cómo se hace:** 1) **Nuevo remito**: **Remito R (con CAI)** o **Muestras (sin CAI)**. 2) Cliente y PR aprobado (o ítems a mano); varias sucursales → **Crear N Remitos**. 3) **Entrega parcial**, **Dividir remito**, **Marcar entregado** / **Desmarcar entregado**. 4) PDF, correo o copiar resumen. 5) Flete: **Agregar transporte** → **Crear transporte**.
**Ojo:** con transporte, el valor declarado es obligatorio. El CAI se asigna al crear. Eliminar un remito no se deshace. Si el PR ya está todo remitido, avisa.

### Transportes — /transportes — admin, administrativo, vendedor
**Para qué sirve:** viajes (camión propio o tercero) y su factura a pagos.
**Cómo se hace:** 1) **Viajes** → **Nuevo viaje**: **Interno** o **Externo**. 2) Transportista, cliente, **Remito**, destino, costo, bultos → **Crear viaje**. 3) **Enviar factura a pagos**: **Con factura del transportista** (se lee sola) o **Factura manual · sin comprobante** → **Enviar a pagos**. 4) **Catálogo transportistas** → **Nuevo transportista**.
**Ojo:** varios viajes en una factura solo si son del mismo transportista y moneda. Un viaje enviado a pagos no se borra. El pago lo hace administración.

### Stock — /stock — todos (se entra desde los avisos de stock bajo)
**Para qué sirve:** inventario propio.
**Cómo se hace:** 1) **Nuevo articulo** (código y nombre obligatorios, "Stock minimo"). 2) **Ajustar stock**: Sumar/Restar o Fijar cantidad. 3) **Ver detalle** → "Historial de precios".
**Ojo:** no queda negativo. Modifican admin y administrativo. **Stock propio** en Compras no genera OC.

---

## Plata — Finanzas (/finanzas) — super_admin, admin, administrativo
Se ordena en 4 grupos: **Hoy, Cobrar, Pagar, Cheques y créditos**, con 12 pestañas a la vista; las demás (CC Clientes, CC Proveedores, Vencimientos, Informes, Objetivos, Gastos fijos, Retenciones) están en el botón **Más** de cada grupo. Abre en la última pestaña usada. **Nuevo movimiento** carga un cobro o pago suelto. Vendedor y viewer ven "No tenés acceso a Finanzas".

### Hoy → Cuentas
Arriba 4 números: **Bancos hoy**, **Para cubrir hoy** (rescatar o transferir), **Cobros a confirmar** (entradas del banco sin cruzar) y **Pagos de esta semana** (cheques propios hasta el domingo + facturas de compra que vencen). Debajo **Para hacer hoy**: todos los avisos juntos, cada uno con **Ir**. Después "¿Cubro los gastos fijos?" y "Cómo estoy hoy" (tengo / debo / posición neta) con **Ver detalle**. Las cuentas van en una tabla (saldo hoy, según el banco y su fecha, lo sumado desde el extracto): tocá una cuenta para ver el detalle y sus movimientos; **Nueva cuenta**, lápiz = editar. **Ojo:** sin el extracto del día, el saldo es el del sistema (la fecha del banco sale en ámbar).

### Hoy → Movimientos
Todos los cobros y pagos (Pendiente, Conciliado, Anulado). **Conciliar** / **Desconciliar**, **Editar**, **Anular**. **Ojo:** mejor Anular que Eliminar. Los que vienen de una factura de compra no se editan acá.

### Hoy → Extractos
1) **Elegir Excel** ("Detalle_mov_cuenta" del BBVA; varios a la vez, no duplica). 2) **Guardar N líneas** (antes no guarda nada). 3) "Cruce automático" → **Aplicar N cruces**. 4) "Para revisar" → **Resolver** (qué es y con qué movimiento va; "Todavía no está cargado"; "Recordar: cuando el concepto diga…"). 5) **Deshacer** por línea. **Ojo:** lo que está en el banco y no en el sistema se carga en Facturación (cobros) u Órdenes de pago (pagos) y se cruza con "Aplicar cruces". Cheque devuelto → se rechaza en Cheques. SIRCREB = pago a cuenta de IIBB (para el contador).

### Hoy → Revisar
Lo que dejaste con dudas y lo que encuentra el sistema (fechas futuras, cheques vencidos en cartera, extracto sin cruzar). **Dejar para revisar** desde un cheque, factura, cobro o línea del extracto ("Recordarme el"); **Agregar** suelto; **Abrir**, **Posponer**, **Resuelto** (**Marcar resuelto**); "Ver resueltos" → **Volver a pendiente**. Nunca frena.

### Hoy → Informes y Objetivos
Informes: BCRA clientes y BCRA proveedores. Objetivos: consulta de objetivos (monto, período, asignado, activo).

### Cobrar → Facturas de venta (Facturación ARCA)
1) **Emitir factura**: tipo, cliente, ítems; dólares → **Traer BNA**; **Con ARCA** o **Manual (sin CAE)**. 2) Desde Ventas "Para facturar" abre lo mismo. 3) En la factura: **Registrar cobro**, **Anular comprobante** (solo sin CAE). 4) **Nota de crédito (NC) a un cliente**: abrí la factura → **Emitir Nota de crédito** (si estaba pagada queda a favor). **Ojo:** facturar solo en el sistema publicado, nunca en una compu de prueba. FCE pide CBU y SCA/ADC. Divisa o billete sale de la ficha: Corteva, Synthon y Aerolíneas se facturan en ARS o USD **divisa**, nunca billete.

### Cobrar → CC Clientes y cobro masivo
1) Cliente → **Realizar cobro**. 2) Tildá facturas → **Continuar a liquidación**. 3) Medios de pago y retenciones; **Adjuntar OP y leer con IA**; USD: **Divisas** o **Billetes** y cotización. 4) Si faltan pesos: "Saldo en la factura más nueva" o "Diferencia a la cuenta corriente (las facturas quedan pagadas)". 5) "Dejar en Revisar: diferencia a confirmar". 6) **Confirmar cobro**. **Ojo:** con diferencia se confirma igual. Si sobra, queda a favor. La diferencia a CC no aparece en USD. **Ajuste manual** corrige saldo sin mover caja.

### Cobrar → Recibos y Vencimientos
Recibos: historial de cobros, **PDF** del recibo. Vencimientos: saldos abiertos por fecha (desde Cobrar lo que hay que cobrar, desde Pagar lo que hay que pagar).

### Pagar → Facturas de compra
**Cargar facturas (IA)** o **Carga manual** (ver Compras). "¿Cómo se paga?": "Va a orden de pago", "Ya pagada con [tarjeta]", "Ya pagada por otro medio (sin OP)". **Ver pendientes** para aprobar. **Ojo:** pagada con tarjeta → baja la deuda con el proveedor y sube la de la tarjeta.

### Pagar → Órdenes de pago
1) **Nueva OP** → proveedor → tildá facturas (las NC se descuentan). 2) **Ret. Ganancias**: %, monto, acumulado del mes, mínimo (editable). 3) **Agregar medio**: Transferencia, Cheque propio, E-Cheq, Cheque tercero, Efectivo, Tarjeta. 4) **Pagar parcial** o **Crear Orden de pago**. 5) **Generar comprobante**, **Certificado**, **Marcar pagada**, **Enviar**. 6) Varios proveedores: **Plan de pagos**. **Ojo:** solo Lazzari retiene; **Grupo LA no es agente de retención**. Mínimo bienes $224.000 en el mes, servicios/transporte $67.170. No se retiene a monotributistas, facturas C ni excluidos. El parcial recorta la factura más nueva.

### Pagar → CC Proveedores
Deuda por proveedor: **Crear OP**, **Ajuste manual** (no mueve caja), **Exportar CSV**.

### Pagar → Gastos
Gastos sin factura de proveedor (impuestos con VEP, débitos, sueldos). **Nuevo gasto**; **Leer VEP / impuesto (IA)** completa y adjunta (no guarda solo); "Es el pago del gasto fijo"; **Crear gasto**.

### Pagar → Gastos fijos
**Nuevo gasto** (descripción, categoría, monto, moneda). "Proveedor que lo factura" → avisa "Falta la factura de [mes]" (si ya está el pago en Gastos dice "Pagado · falta la factura"); sin proveedor espera el pago en Gastos ("Falta pagar [mes]"). Gasto en US$ sin dólar propio: se calcula al dólar BNA billete del día. "Vence el día". "Monto automático SICORE" = retenciones de Ganancias de las OP del mes anterior. Se desactivan sin borrar.

### Pagar → Retenciones (SICORE)
Desde/Hasta → **CSV**, **Excel** o **SICORE** (archivo para el aplicativo).

### Cheques y créditos → Cheques
Arriba, propios a pagar y recibidos en cartera en tres cajas: **En fecha** (propios: ya llegó la fecha, el banco los puede debitar hoy, tiene que haber plata; recibidos: ya se pueden depositar), **Esta semana** (hasta el domingo) y **Más adelante**. Tocá una caja para ver esos cheques; en la lista cada uno dice "en fecha" o "esta semana". **Registrar cheque** (Recibido/Emitido, Físico/E-Cheq). En cartera: **Endosar**, **Depositar**, **Cobrado**, **Rechazar** (motivo → **Rechazar cheque**). Depositado que volvió: "¿Vino rechazado?". **Ojo:** rechazar anula el cobro (queda registro), la factura vuelve a pendiente y deja un aviso.

### Cheques y créditos → Cheques Martín F.
Cheques propios que cubre Martín Fernández: **Copiar mensaje para mandarle**, **Cubrió ✓**. La campana avisa 3 días antes.

### Cheques y créditos → Créditos
Líneas de crédito: usado, disponible, vencimiento, TNA (consulta).

---

## Sistema

### Reportes — /reportes — todos (Comisiones: admin y administrativo)
Pestañas: Analisis comercial, Compras vs ventas, Comisiones, Ranking por Articulo, Libro IVA. "Moneda": Original, Todo en ARS, Todo en USD.

### Configuración — /configuracion — super_admin, admin, administrativo
**Usuarios** (solo super_admin: **Invitar usuario**, rol, quitar acceso). **Integraciones** (ARCA, banco, mail, IA). **Comisiones** (super_admin y admin: **Nueva regla de comisión**). **Retenciones** (mínimos y tasas). **Fechas de cheque** (días del mes en que se centralizan los cheques emitidos; la OP los propone).

### Papelera — /papelera — todos
Lo eliminado: buscá y **Restaurar** (solo presupuestos). Facturas, OP y remitos anulados quedan como historial.
