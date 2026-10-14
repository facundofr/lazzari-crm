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
**Ayuda (botón violeta abajo a la derecha):** muestra la guía de la pantalla donde estás y tiene un buscador ("¿Qué necesitás hacer?") que es gratis. Atajos: **Resumen de hoy**, **Stock bajo**, **Mis pendientes**, **Clientes dormidos**, **Top facturado**. Si la guía no alcanza, **¿No alcanza? Preguntarle a la IA**: responde con la guía y con los datos que tu usuario puede ver; solo consulta, no carga ni cambia nada. Tiene un tope de gasto por mes (US$ 5); al llegar, queda la búsqueda gratis.

### Dashboard — /dashboard — todos
**Para qué sirve:** resumen del día: facturado del mes, presupuestos activos, conversión, margen promedio, últimos PR, alertas, mejores clientes, actividad.
**Cómo se hace:** 1) **Nuevo PR** arma un presupuesto rápido; **Clientes** va a la lista. 2) **Pendientes** (admin y administrativo) lleva a la lista de cosas abiertas. 3) **Ver en Reportes** para gráficos e historia.
**Ojo:** admin y administrativo ven "¿Cubro los gastos fijos?" (vendido neto del mes vs objetivo, ganancia vs fijos, "¿Cuánto me falta vender?"). El dólar del alquiler se carga ahí y queda solo en esa compu. El "Margen promedio" de arriba se calcula distinto que el del recuadro.

### Pendientes — /pendientes — todos
**Para qué sirve:** junta lo que hay para hacer y para responder, por área (Pagos, Cobros, Compras y proveedores, Gastos fijos, Bancos y créditos, Sistema, Decisiones).
**Cómo se hace:** 1) Arriba, "Atrasos que cuenta el sistema" (facturas vencidas, OC sin factura, PR en Solicitud, extracto sin cruzar; solo lo que tu rol ve). 2) **Ir** lleva a la pantalla donde se resuelve. 3) Escribí en **Respuesta** (se guarda al salir). 4) Tildá para marcar hecho; **Ver hechos** / **Ver abiertos**. 5) "Agregar un pendiente…", elegí área y "Para hacer"/"Para responder", **Agregar**. 6) **Copiar respuestas** copia lo abierto con tus respuestas.

### Calendario — /calendario — todos (viewer solo mira)
**Para qué sirve:** agenda de visitas, seguimientos, entregas y reuniones.
**Cómo se hace:** 1) **Nuevo evento**: Título, Tipo, Fecha inicio, Cliente, Responsable, "Quién puede verlo" → **Crear Evento**. 2) A la derecha, "Próximos 14 días y vencidos"; ✓ lo completa. 3) En el detalle, **Editar** o **Eliminar**. 4) Filtros por tipo, usuario y público/privado.
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
**Para qué sirve:** armar, enviar y seguir los presupuestos (PR).
**Cómo se hace:** 1) **Nuevo PR** → cliente → **Agregar item**, **Lista de costos** o **Repetir presupuesto anterior** → **Crear Presupuesto**. 2) Pedido largo: **Cotización express (IA)** (Excel, PDF, imagen o mensaje) → **Armar cotización** → revisá → **Agregar … al presupuesto**. 3) Si todavía no se cotiza: **Crear como Solicitud**, después **Convertir**. 4) Enviar: **Descargar PDF**, **Enviar por email**, **Copiar resumen** (para WhatsApp). 5) Estado: Solicitud, Pendiente, Aprobado, Rechazado (dentro: Rechazado o Postergado, con motivo). 6) **Seguimiento**: PR sin respuesta por colores, con **Llamar**.
**Ojo:** margen mínimo 15 % = aviso, se guarda igual. **Ganancia / Margen** descuenta 7 % de gastos (2 % si es manual sin ARCA): rojo < 15 %, ámbar < 20 %; es interno. **+ Envío interno 🔒**: flete que paga Lazzari, baja la ganancia, nunca sale en el PDF. Aprobar sin costos avisa (**Aprobar de todos modos**) y después ofrece enviar las OC. Aprobado: **+ Cargar OC** del cliente y **Ver en Ventas**. "Facturado" lo pone la factura. Los recuadros son del mes en curso; "Todos" no muestra facturados.

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

### Compras: órdenes — /ordenes-compra — admin, administrativo, vendedor
**Para qué sirve:** armar, mandar y recibir OC (los vendedores compran pero no pagan).
**Cómo se hace:** 1) Al aprobar un PR se arma una OC por proveedor ("¿enviamos la OC al proveedor?"); renglones sin proveedor: **Más ▾ → Ítems sin proveedor** (o **Stock propio**). 2) A mano: **Nueva OC**, "Vincular a PR (opcional)", **Importar cotización**. 3) Enviar: **WhatsApp**, **Mail con PDF**, **Copiar**, **PDF** (queda pedida; **deshacer**). 4) Recibir: "Recepcion de mercaderia" → **Recibir ahora** o **Marcar todo recibido** → **Registrar recepcion**. 5) Si no entrega el resto: **Cerrar saldo** (**Reabrir saldo**).
**Ojo:** la OC va al contacto de Ventas del proveedor, nunca a administración. "Pago que pide el proveedor" (**Indicar**): si falta, aviso amarillo, no bloquea. Mercado Libre: se tilda **Ya pagada con tarjeta** (Visa), sin OP. Filtros: Abiertas, A reclamar, Con diferencia, Por recibir, Por facturar, Por pagar.

### Compras: facturas del proveedor — /ordenes-compra (y Finanzas → Pagar) — admin, administrativo, vendedor
**Para qué sirve:** cargar facturas de proveedores y cruzarlas con sus OC.
**Cómo se hace:** 1) Varias: **Cargar facturas (IA)** → subí PDF o imágenes → **Cargar las N listas** o **Confirmar las que cierran** (**Segundo plano** para seguir trabajando). 2) De a una: **Carga manual**: lee primero el **QR de ARCA** y si no hay, el texto del PDF, sin IA ("Leído del QR de ARCA" / "Leído del texto del PDF (revisá)"); **Leer con IA** aparte lee también los artículos. Si el CUIT no es de un proveedor cargado, queda escrito en el buscador → **Crear proveedor nuevo**. 3) La OC se elige sola; **cambiar / sumar otra**. Si trae de más: **Actualizar OC a N**, **Agregar a OC-xxx**, **Crear OC nueva**, **Solo en la factura**. 4) "¿Cómo se paga?": **Va a orden de pago** o "Ya pagada…" → **Guardar y enviar para aprobación**. 5) Diferencias: **Ajustar OC a la factura** (ajusta el costo del PR; **Deshacer ajuste**) o **Cerrar: no entrega el resto**. 6) **Más ▾ → Conciliar un proveedor (IA)**: **Es este, OK**, **Aceptar precio**, **A reclamar**, **Fuera de OC**.
**Ojo:** que el total diga "✓ igual al PDF"; si no, revisá el IVA (**Usar IVA 21 % en todo**). Flete del proveedor que no está en la OC: el cuadro violeta lo suma como costo interno 🔒 del PR (el cliente no lo ve). Avisos de costo o margen no bloquean.

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
Se ordena en 5 grupos: **Hoy, Cobrar, Pagar, Cheques, Deudas**. Abre en la última pestaña usada. **Nuevo movimiento** carga un cobro o pago suelto. Vendedor y viewer ven "No tenés acceso a Finanzas".

### Hoy → Cuentas
Cuánta plata hay y qué está comprometido; arriba "¿Cubro los gastos fijos?". Tarjetas: Disponible, Cheques en cartera, Comprometido en cheques emitidos, A cobrar, A pagar, Deudas (tocá para ir). **Ver movimientos**, **Nueva cuenta** / **Editar cuenta**. **Ojo:** sin el extracto del día, el saldo es el del sistema.

### Hoy → Movimientos
Todos los cobros y pagos (Pendiente, Conciliado, Anulado). **Conciliar** / **Desconciliar**, **Editar**, **Anular**. **Ojo:** mejor Anular que Eliminar. Los que vienen de una factura de compra no se editan acá.

### Hoy → Extractos
1) **Elegir Excel** ("Detalle_mov_cuenta" del BBVA; varios a la vez, no duplica). 2) **Guardar N líneas** (antes no guarda nada). 3) "Cruce automático" → **Aplicar N cruces**. 4) "Para revisar" → **Resolver** (qué es y con qué movimiento va; "Todavía no está cargado"; "Recordar: cuando el concepto diga…"). 5) **Deshacer** por línea. **Ojo:** lo que está en el banco y no en el sistema se carga en Facturación (cobros) u Órdenes de pago (pagos) y se cruza con "Aplicar cruces". Cheque devuelto → se rechaza en Cheques. SIRCREB = pago a cuenta de IIBB (para el contador).

### Hoy → Revisar
Lo que dejaste con dudas y lo que encuentra el sistema (fechas futuras, cheques vencidos en cartera, extracto sin cruzar). **Dejar para revisar** desde un cheque, factura, cobro o línea del extracto ("Recordarme el"); **Agregar** suelto; **Abrir**, **Posponer**, **Resuelto** (**Marcar resuelto**); "Ver resueltos" → **Volver a pendiente**. Nunca frena.

### Hoy → Informes y Objetivos
Informes: BCRA clientes y BCRA proveedores. Objetivos: consulta de objetivos (monto, período, asignado, activo).

### Cobrar → Facturas de venta (Facturación ARCA)
1) **Emitir factura**: tipo, cliente, ítems; dólares → **Traer BNA**; **Con ARCA** o **Manual (sin CAE)**. 2) Desde Ventas "Para facturar" abre lo mismo. 3) En la factura: **Registrar cobro**, **Emitir Nota de Crédito** (si estaba pagada queda a favor), **Anular comprobante** (solo sin CAE). **Ojo:** facturar solo en el sistema publicado, nunca en una compu de prueba. FCE pide CBU y SCA/ADC. Divisa o billete sale de la ficha: Corteva, Synthon y Aerolíneas se facturan en ARS o USD **divisa**, nunca billete.

### Cobrar → CC Clientes y cobro masivo
1) Cliente → **Realizar cobro**. 2) Tildá facturas → **Continuar a liquidación**. 3) Medios de pago y retenciones; **Adjuntar OP y leer con IA**; USD: **Divisas** o **Billetes** y cotización. 4) Si faltan pesos: "Saldo en la factura más nueva" o "Diferencia a la cuenta corriente (las facturas quedan pagadas)". 5) "Dejar en Revisar: diferencia a confirmar". 6) **Confirmar cobro**. **Ojo:** con diferencia se confirma igual. Si sobra, queda a favor. La diferencia a CC no aparece en USD. **Ajuste manual** corrige saldo sin mover caja.

### Cobrar → Recibos y Vencimientos
Recibos: historial de cobros, **PDF** del recibo. Vencimientos: saldos abiertos por fecha (desde Cobrar lo que hay que cobrar, desde Pagar lo que hay que pagar).

### Pagar → Facturas de compra
**Cargar facturas (IA)** o **Carga manual** (ver Compras). "¿Cómo se paga?": "Va a orden de pago", "Ya pagada con [tarjeta]", "Ya pagada por otro medio (sin OP)". **Ver pendientes** para aprobar. **Ojo:** pagada con tarjeta → baja la deuda con el proveedor y sube la de la tarjeta.

### Pagar → Órdenes de pago
1) **Nueva OP** → proveedor → tildá facturas (las NC se descuentan). 2) **Ret. Ganancias**: %, monto, acumulado del mes, mínimo (editable). 3) **Agregar medio**: Transferencia, Cheque propio, E-Cheq, Cheque tercero, Efectivo, Tarjeta. 4) **Pagar parcial** o **Crear Orden de Pago**. 5) **Generar comprobante**, **Certificado**, **Marcar pagada**, **Enviar**. 6) Varios proveedores: **Plan de pagos**. **Ojo:** solo Lazzari retiene; **Grupo LA no es agente de retención**. Mínimo bienes $224.000 en el mes, servicios/transporte $67.170. No se retiene a monotributistas, facturas C ni excluidos. El parcial recorta la factura más nueva.

### Pagar → CC Proveedores
Deuda por proveedor: **Crear OP**, **Ajuste manual** (no mueve caja), **Exportar CSV**.

### Pagar → Gastos
Gastos sin factura de proveedor (impuestos con VEP, débitos, sueldos). **Nuevo gasto**; **Leer VEP / impuesto (IA)** completa y adjunta (no guarda solo); "Es el pago del gasto fijo"; **Crear gasto**.

### Pagar → Gastos fijos
**Nuevo gasto** (descripción, categoría, monto, moneda). "Proveedor que lo factura" → avisa "Falta la factura de [mes]"; sin proveedor espera el pago en Gastos ("Falta pagar [mes]"). "Vence el día". "Monto automático SICORE" = retenciones de Ganancias de las OP del mes anterior. Se desactivan sin borrar.

### Pagar → Retenciones (SICORE)
Desde/Hasta → **CSV**, **Excel** o **SICORE** (archivo para el aplicativo).

### Cheques → Cheques
**Registrar cheque** (Recibido/Emitido, Físico/E-Cheq). En cartera: **Endosar**, **Depositar**, **Cobrado**, **Rechazar** (motivo → **Rechazar cheque**). Depositado que volvió: "¿Vino rechazado?". **Ojo:** rechazar anula el cobro (queda registro), la factura vuelve a pendiente y deja un aviso.

### Cheques → Cheques Martín F.
Cheques propios que cubre Martín Fernández: **Copiar mensaje para mandarle**, **Cubrió ✓**. La campana avisa 3 días antes.

### Deudas → Créditos
Líneas de crédito: usado, disponible, vencimiento, TNA (consulta).

---

## Sistema

### Reportes — /reportes — todos (Comisiones: admin y administrativo)
Pestañas: Analisis comercial, Compras vs ventas, Comisiones, Ranking por Articulo, Libro IVA. "Moneda": Original, Todo en ARS, Todo en USD.

### Configuración — /configuracion — super_admin, admin, administrativo
**Usuarios** (solo super_admin: **Invitar usuario**, rol, quitar acceso). **Integraciones** (ARCA, banco, mail, IA). **Comisiones** (super_admin y admin: **Nueva regla de comisión**). **Retenciones** (mínimos y tasas). **Fechas de cheque** (días del mes en que se centralizan los cheques emitidos; la OP los propone).

### Papelera — /papelera — todos
Lo eliminado: buscá y **Restaurar** (solo presupuestos). Facturas, OP y remitos anulados quedan como historial.
