// ARCHIVO GENERADO por scripts/guia-a-ts.mjs desde docs/GUIA-USO.md — NO EDITAR A MANO.
// Para cambiar la guía: editar docs/GUIA-USO.md y correr `node scripts/guia-a-ts.mjs` (desde crm/app).

export interface SeccionGuia {
  id: string;
  grupo: string;
  titulo: string;
  /** Pantalla a la que corresponde (para "Ir" y para saber dónde está el usuario). */
  ruta: string | null;
  /** Módulo de permisos (ROLE_PERMISSIONS). null = la ven todos. */
  modulo: string | null;
  texto: string;
}

export const GUIA_SECCIONES: SeccionGuia[] = [
  {
    "id": "antes-de-empezar",
    "grupo": "General",
    "titulo": "Antes de empezar",
    "ruta": null,
    "modulo": null,
    "texto": "**Antes de empezar**\n- Arriba elegís la sociedad: **Lazzari** o **Grupo LA**. Todo lo que ves y cargás es de la sociedad elegida.\n- El sistema casi nunca frena: si algo no cierra, **avisa** y te deja seguir. Lo que propone el sistema o la IA es una sugerencia.\n- Para corregir, mejor **Anular** que borrar (borrar quedó para administradores).\n- Cada uno ve el menú según su rol: super_admin y admin ven todo; administrativo, plata y compras; vendedor vende, compra, entrega (sin pagar); viewer solo mira."
  },
  {
    "id": "inicio-buscador-y-ayuda-en-todas-las-pantallas",
    "grupo": "Inicio",
    "titulo": "Buscador y Ayuda (en todas las pantallas)",
    "ruta": null,
    "modulo": null,
    "texto": "**Buscador:** el cuadro \"Buscar clientes, PR, facturas...\" de arriba (Ctrl+K). Con 2 letras busca clientes (razón social), presupuestos (número), facturas (número) y productos (código o nombre), hasta 3 de cada uno, de la sociedad activa.\n**Ayuda (botón violeta abajo a la derecha):** muestra la guía de la pantalla donde estás y tiene un buscador (\"¿Qué necesitás hacer?\") que es gratis. Atajos: **Resumen de hoy**, **Stock bajo**, **Clientes dormidos**, **Top facturado**. Si la guía no alcanza, **¿No alcanza? Preguntarle a la IA**: responde con la guía y con los datos que tu usuario puede ver; solo consulta, no carga ni cambia nada. Tiene un tope de gasto por mes (US$ 5); al llegar, queda la búsqueda gratis. **Solo Augusto (por ahora): Preguntale o pedile algo a la IA**: además de consultar, le podés pedir cambios chicos (mail, teléfono, dirección, notas o datos bancarios de un cliente o proveedor; agregar o corregir un contacto; a quién se envió una factura o su nota interna; observaciones de una OC; cuánto llegó de un renglón de OC). Te muestra **antes → después** y no guarda nada hasta que apretás **Hacer**; **Descartar** la deja sin hacer. Arriba, **Historial** (\"Lo que hizo la IA\") lista lo hecho con **Deshacer** (no pisa lo que alguien cambió después). No factura, no toca precios, pagos ni ARCA, y no borra."
  },
  {
    "id": "inicio-calendario",
    "grupo": "Inicio",
    "titulo": "Calendario",
    "ruta": "/calendario",
    "modulo": "calendario",
    "texto": "**Para qué sirve:** agenda de visitas, seguimientos, entregas y reuniones.\n**Cómo se hace:** 1) **Nuevo evento**: Título, Tipo, Fecha inicio, Cliente, Responsable, \"Quién puede verlo\" → **Crear evento**. 2) A la derecha, \"Próximos 14 días y vencidos\"; ✓ lo completa. 3) En el detalle, **Editar** o **Eliminar**. 4) Filtros por tipo, usuario y público/privado.\n**Ojo:** \"Privado\" lo ven vos y el responsable. Cada uno edita lo suyo; admin edita todo."
  },
  {
    "id": "vender-clientes",
    "grupo": "Vender",
    "titulo": "Clientes",
    "ruta": "/clientes",
    "modulo": "clientes",
    "texto": "**Para qué sirve:** padrón de clientes con datos, contactos, sucursales, cuenta corriente y Ficha 360.\n**Cómo se hace:** 1) **Nuevo cliente** → CUIT → **Consultar ARCA** → **Crear cliente**. 2) Buscar por razón social, CUIT o email, o filtrar. 3) En el cliente: Datos, Contactos, Sucursales, Relevamiento, **Ficha 360**, Actividad, Cta. Cte. 4) Ficha 360: cotizado, ganado, conversión, última compra, saldo, oportunidades, PR, artículos, facturas, cobros y muestras en su poder. 5) Tarjeta **Central de Deudores (BCRA)**: semáforo, deuda en bancos, cheques rechazados; **Actualizar ahora**, **Ver detalle por banco**.\n**Ojo:** \"cliente parecido / CUIT repetido\" y BCRA son avisos: se puede guardar igual. **Pide OC para facturar** lo muestra en Finanzas Lazza → Facturar (no bloquea). **Eliminar** pide motivo; con historial queda desactivado."
  },
  {
    "id": "vender-presupuestos",
    "grupo": "Vender",
    "titulo": "Presupuestos",
    "ruta": "/presupuestos",
    "modulo": "presupuestos",
    "texto": "**Para qué sirve:** armar, enviar y seguir los presupuestos (PR). Dos pestañas: **Presupuestos** (la lista) y **Armar presupuesto** (la IA arma el PR desde el pedido del cliente).\n**Cómo se hace:** 0) Pestaña **Armar presupuesto**: pegá el mail o WhatsApp (con la firma), o arrastrá foto, PDF o Excel → **Armar presupuesto con IA**. La IA busca al cliente, elige artículo y proveedor de la lista de costos y propone el precio (el último que le cobraste si deja margen; si no, el de la lista). Si le falta un dato (talle, modelo, marca) pregunta: respondé o **Seguir sin responder**. Revisá el semáforo (Listo / Revisar / Falta), cambiá artículo con **Buscar** o el precio a mano, y usá \"Decile a la IA qué cambiar\" (**Deshacer** vuelve atrás). **Crear presupuesto** lo deja en la lista y lo abre. 1) **Nuevo PR** → cliente → **Agregar item**, **Lista de costos** o **Repetir presupuesto anterior** → **Crear presupuesto**. 2) Pedido largo: **Cotización express (IA)** (Excel, PDF, imagen o mensaje) → **Armar cotización** (si a la IA le falta un dato como talle, modelo o marca, pregunta: respondé o **Seguir sin responder**) → revisá; en \"Decile a la IA qué cambiar\" podés pedir \"agregame 20 guantes nitrilo T9\", \"cambiá los anteojos a Segufer\" o \"sacá X\" → **Aplicar** → **Agregar … al presupuesto**. 3) Si todavía no se cotiza: **Crear como Solicitud** → escribí lo que pide el cliente y/o **Elegir productos (como en un PR)** o **Armar con IA** → después **Convertir**. 4) Enviar: **Descargar PDF**, **Enviar por email**, **Copiar resumen** (para WhatsApp). 5) Estado: Solicitud, Pendiente, Aprobado, Rechazado (dentro: Rechazado o Postergado, con motivo). 6) **Seguimiento**: renglones apretados con días sin respuesta por colores, estado y **Llamar**. 7) Arriba, la franja roja \"X vencidos (últimos 30 días)\" → **Ver**; el botón **Vencido** está al lado de Pendiente. En cada PR vencido, **Extender 5 días** (vence hoy + 5). 8) En el detalle: franja con ítems, total, ganancia y margen; **Ocultar costos** (para mostrarle la pantalla al cliente) y la pantalla completa se recuerdan en la compu. 9) **Eliminar** (papelera): el admin cualquiera; el vendedor solo los suyos sin aprobar. Pide motivo (puede ir vacío) y queda en notas internas; el admin los ve en **Papelera** y los puede restaurar.\n**Ojo:** margen mínimo 15 % = aviso, se guarda igual. Cantidad a la argentina: \"1.000\" = mil; cantidad con decimales o precio 0 = aviso amarillo, no frena. **Ganancia / Margen** descuenta 7 % de gastos (2 % si es manual sin ARCA): rojo < 15 %, ámbar < 20 %; es interno. En la ventana del PR, debajo de **Descuento general**: Subtotal · IVA · Total y abajo lo interno 🔒 (Margen · Ganancia · neto). Aprobar sin costos avisa (**Aprobar de todos modos**) y después ofrece enviar las OC. Aprobado: **+ Cargar OC** del cliente. \"Facturado\" lo pone la factura. Los recuadros son del mes en curso; \"Todos\" no muestra facturados."
  },
  {
    "id": "vender-facturas",
    "grupo": "Vender",
    "titulo": "Facturas",
    "ruta": "/consulta-facturas",
    "modulo": "consulta_facturas",
    "texto": "**Para qué sirve:** consultar facturas de venta y de compra (solo lectura).\n**Cómo se hace:** 1) **De venta** / **De compra**; buscar por cliente o proveedor, CUIT, número, PR u OC. 2) Venta: **Ver / bajar PDF**, **Reenviar al cliente**. 3) Compra: **Ver factura del proveedor**.\n**Ojo:** acá no se emite, cobra, paga ni anula (eso es Finanzas Lazza)."
  },
  {
    "id": "comprar-proveedores",
    "grupo": "Comprar",
    "titulo": "Proveedores",
    "ruta": "/proveedores",
    "modulo": "proveedores",
    "texto": "**Para qué sirve:** ficha de cada proveedor (fiscales, administración, vendedores, \"Cómo se le paga\", banco, deuda) y pestañas **Lista de costos** y **Listas de precios**.\n**Cómo se hace:** 1) **Nuevo proveedor** → CUIT → **Buscar en ARCA**; **Leer papeles con IA (ARCA, CBU…)** completa lo vacío → **Crear**. 2) \"Vendedores (a ellos se les mandan las OC)\" → **Agregar vendedor** (mail/WhatsApp de administración solo para facturas y pagos). 3) **Cómo se le paga**: condición, \"Se paga a (desde factura)\", medio, \"Cheque diferido a\" (\"Queda así: …\"). 4) Deuda: filtro **Con deuda**, **Ver cuenta corriente →**. 5) **Eliminar** con **Motivo**; para pausar, **Desactivar** / **Reactivar**. 6) \"¿Es transporte o taller?\" para que aparezca en Transportes o Personalización.\n**Ojo:** con historial no se borra, se desactiva. Días de pago desde la fecha de factura. **Lista de costos** es solo consulta: los precios vienen del catálogo, nunca se cambian a mano. Semáforo 🟢 ≤30 días, 🟡 30-60, 🔴 >60 → **Pedir actualización**. BCRA de proveedores: Finanzas → Informes (aviso)."
  },
  {
    "id": "comprar-compras-lazza-ordenes-de-compra",
    "grupo": "Comprar",
    "titulo": "Compras Lazza: órdenes de compra",
    "ruta": "/compras-lazza",
    "modulo": "ordenes_compra",
    "texto": "**Para qué sirve:** controlar que llegue todo lo que se compró. Los vendedores no compran: al aprobar un PR la OC se arma sola (una por proveedor) y cae acá \"Por pedir\".\n**Cómo se hace:** 1) Pedir: **Copiar** (artículos y cantidades, sin precios) → pegalo en el WhatsApp o mail del proveedor → tocá **Por pedir** y pasa a **Pedido** con la fecha de hoy (el lápiz ✏️ cambia la fecha). 2) Llegó: **Llegó** → **Completo** o **Parcial** por artículo; si te equivocaste, **Corregir cantidades**. 3) Abrir la OC (tocá su número): proveedor de toda la OC o de un artículo (pasa a otra OC de ese proveedor), cantidades, moneda y precio (pasan al PR), entrega estimada, **Operador**, observaciones. 4) **Nueva OC**: a mano, sin PR (stock, insumos, complementaria). 5) **Anular OC**: queda en la pestaña **Anuladas** (no se borra) y se puede **Reactivar**.\n**Ojo:** la OC no lleva factura ni pago: \"Terminada\" = llegó todo. Filtros: persona (Op/Ven), proveedor, cliente, estado, fecha y **Atrasadas**. Nada traba: lo raro avisa."
  },
  {
    "id": "comprar-compras-lazza-facturas-del-proveedor",
    "grupo": "Comprar",
    "titulo": "Compras Lazza: facturas del proveedor",
    "ruta": "/compras-lazza",
    "modulo": "ordenes_compra",
    "texto": "**Para qué sirve:** cargar la factura o nota de crédito del proveedor: va directo a su cuenta corriente (no se ata a ninguna OC).\n**Cómo se hace:** 1) **Cargar factura** → subí el PDF: lee el **QR de ARCA** o el texto, sin IA (\"Buscando proveedor…\" y lo encuentra por CUIT). **Leer con IA** es opcional (para ver los artículos). 2) Revisá tipo, número, neto, IVA, percepciones y total. 3) \"¿Cómo se paga?\": **Va a Pagos** (transferencia o eCheq a __ días: calcula el vencimiento) o **Ya pagada con Visa**. 4) **Nota para Finanzas** (opcional) → **Guardar**.\n**Ojo:** si al proveedor le falta el mail o el CBU/alias, lo pide y lo guarda en su ficha. La nota de crédito queda como crédito del proveedor."
  },
  {
    "id": "comprar-personalizacion",
    "grupo": "Comprar",
    "titulo": "Personalización",
    "ruta": "/personalizacion",
    "modulo": "ordenes_compra",
    "texto": "**Para qué sirve:** bordados y estampados en talleres externos: qué se lleva, cuánto cuesta, liquidación del mes.\n**Cómo se hace:** 1) **Talleres y precios** → **Nuevo** (o marcar un proveedor como taller) y su lista por técnica. 2) **Nuevo trabajo**: taller, cliente, PR; **Traer prendas del presupuesto**; técnica, ubicación, logo. 3) Estado: En el taller → Listo parcial / Listo → Retirado; cargá **Listas** y **Fallas**. 4) Logos por cliente (técnica, ubicación, taller, último costo). 5) **Generar liquidación interna** o **Liquidar con su factura**.\n**Ojo:** el costo se completa solo (✨). Liquidar es de administración. Si el taller factura, la factura se carga antes en Cargar facturas."
  },
  {
    "id": "entregar-remitos",
    "grupo": "Entregar",
    "titulo": "Remitos",
    "ruta": "/remitos",
    "modulo": "remitos",
    "texto": "**Para qué sirve:** documentar entregas.\n**Cómo se hace:** 1) **Nuevo remito**: **Remito R (con CAI)** o **Muestras (sin CAI)**. 2) Cliente y PR aprobado (o ítems a mano); varias sucursales → **Crear N Remitos**. 3) **Entrega parcial**, **Dividir remito**, **Marcar entregado** / **Desmarcar entregado**. 4) PDF, correo o copiar resumen. 5) Flete: **Agregar transporte** → **Crear transporte**.\n**Ojo:** con transporte, el valor declarado es obligatorio. El CAI se asigna al crear. Eliminar un remito no se deshace. Si el PR ya está todo remitido, avisa."
  },
  {
    "id": "entregar-transportes",
    "grupo": "Entregar",
    "titulo": "Transportes",
    "ruta": "/transportes",
    "modulo": "remitos",
    "texto": "**Para qué sirve:** viajes (camión propio o tercero) y su factura a pagos.\n**Cómo se hace:** 1) **Viajes** → **Nuevo viaje**: **Interno** o **Externo**. 2) Transportista, cliente, **Remito**, destino, costo, bultos → **Crear viaje**. 3) **Enviar factura a pagos**: **Con factura del transportista** (se lee sola) o **Factura manual · sin comprobante** → **Enviar a pagos**. 4) **Catálogo transportistas** → **Nuevo transportista**.\n**Ojo:** varios viajes en una factura solo si son del mismo transportista y moneda. Un viaje enviado a pagos no se borra. El pago lo hace administración."
  },
  {
    "id": "entregar-stock",
    "grupo": "Entregar",
    "titulo": "Stock",
    "ruta": "/stock",
    "modulo": "stock",
    "texto": "**Para qué sirve:** inventario propio.\n**Cómo se hace:** 1) **Nuevo articulo** (código y nombre obligatorios, \"Stock minimo\"). 2) **Ajustar stock**: Sumar/Restar o Fijar cantidad. 3) **Ver detalle** → \"Historial de precios\".\n**Ojo:** no queda negativo. Modifican admin y administrativo. **Stock propio** en Compras no genera OC."
  },
  {
    "id": "plata-plata",
    "grupo": "Plata",
    "titulo": "Plata",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Abre en un inicio con tarjetas en 4 filas (**Cobrar, pagar y ventas**, **Pagos, cobros e impuestos**, **Tesorería**, **Informes**); cada tarjeta muestra un dato del momento y al tocarla abre su sección. **← Finanzas** vuelve al inicio. Todo es de la sociedad elegida arriba.\nSi falta subir algún archivo del banco, arriba aparece **¿Está todo al día?** con **Ir a Bancos**. Los demás roles ven \"No tenés acceso a esta pantalla.\""
  },
  {
    "id": "plata-facturar",
    "grupo": "Plata",
    "titulo": "Facturar",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Abre **Facturas** en la pestaña **Facturar**: los PR aprobados que faltan facturar y los restos (\"PR-… · resto\"). Estado **Listo** o **Esperando OC** (es un aviso: se puede facturar igual).\n1) **Facturar** abre la misma ventana de emitir de Ventas. 2) En dólares, **Traer BNA**; la moneda sale de la ficha (**USD divisa** o **USD billete**). 3) **Emitir con ARCA** o, en manual, **Guardar manual**. 4) En un resto: **Facturar** o **No facturar**; una factura anulada por NC sale con **Re-facturar**.\nSi el cliente pasó su límite de crédito, avisa \"Límite de crédito alcanzado; podés continuar con la emisión.\"\n**Ojo:** facturar solo en el sistema publicado, nunca en una compu de prueba. Corteva, Synthon y Aerolíneas se facturan en ARS o USD **divisa**, nunca billete."
  },
  {
    "id": "plata-cobrar",
    "grupo": "Plata",
    "titulo": "Cobrar",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Abre **Facturas** en **Ventas** (facturas de venta a cobrar).\n1) Tildá las facturas de un cliente: abajo queda fija la barra con cuántas y cuánto, **Destildar** y **Cobrar (n)**. 2) Se abre la **Liquidación de cobro**: medios de pago, retenciones/percepciones, **Aplicar saldo a favor**. 3) **Adjuntar comprobante y leer con IA** (OP del cliente, transferencia, cheque o retención); si es una OP, **Cobrar todas las facturas de esta orden de pago**. 4) En US$: **Divisas** o **Billetes** y la cotización. 5) Si falta plata: **Saldo en la factura más nueva** o **Diferencia a la cuenta corriente (las facturas quedan pagadas)**. 6) **Confirmar cobro**.\n**Nuevo cobro** sirve para cobrar sin factura o eligiendo el cliente. Facturas en $ y en US$ se cobran por separado.\n**Ojo:** con diferencia se confirma igual; si sobra, queda a favor del cliente."
  },
  {
    "id": "plata-pagar",
    "grupo": "Plata",
    "titulo": "Pagar",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Abre **Facturas** en **Compras** (facturas de compra a pagar).\n1) Tildá las facturas de un proveedor → **Pagar (n)** en la barra fija. 2) Se abre la misma ventana de **Nueva Orden de pago** (ver Órdenes de pago). 3) **Guardar** la deja creada sin mandar nada; **Guardar y enviar** la crea y abre el mail al proveedor con la OP y los comprobantes.\n**Nueva OP** sirve para un pago a cuenta (sin factura) o eligiendo el proveedor. Una OP es de un solo proveedor: si tildás de más, avisa y sigue con el primero."
  },
  {
    "id": "plata-facturas",
    "grupo": "Plata",
    "titulo": "Facturas",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Una fila por factura, con pestañas **Facturar**, **Ventas** y **Compras**, filtros **Pendientes**, **Por vencer**, **Vencidas**, **Todas** y buscador. En Ventas arriba: **Facturado** del mes (◀ ▶), vencidas y las que vencen en 7 días (un clic filtra).\n- Tocá una fila para ver la ficha: **Ver**, **Descargar**, **Enviar al cliente**, **Cobrar** y **Hacer NC** (abre la ventana de nota de crédito sin salir de Finanzas: **Total**, **Por ítems** o **Importe libre**, y **Emitir NC con ARCA**).\n- **Nueva factura**: emitir sin PR, eligiendo el cliente. En **Enviada**, **Enviar** manda la factura por mail. El lápiz en **Vence** cambia el vencimiento.\n- En Compras, **Pagada con** muestra la OP (Ver, Descargar, Enviar y los adjuntos).\n**Ojo:** si la NC es mayor que el saldo pendiente se emite igual y la diferencia queda a favor del cliente."
  },
  {
    "id": "plata-cuentas-corrientes",
    "grupo": "Plata",
    "titulo": "Cuentas corrientes",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Arriba tres pestañas: **Saldos**, **Riesgo BCRA · Clientes** y **Riesgo BCRA · Proveedores**.\nEn Saldos: **Todos / Clientes / Proveedores**, buscador, **Solo con saldo**, **Ocultar menores a $ 100** y **Moneda: $ y US$ separados** o **Moneda: la de cada cuenta** (solo para ver). Abajo **Nos deben** y **Les debemos**.\nTocá una cuenta para abrir su ficha: saldo, vencido, **Facturas pendientes** (tildar → **Cobrar** o **Pagar**, con barra fija) y el resumen con todos los movimientos (**Excel**, PDF, **Mail**).\n**Ajuste manual**: corrige el saldo sin tocar la caja ni el banco (a favor/crédito o cargo/débito). En el resumen, **Anular** un ajuste lo deja tachado con quién y cuándo.\n**Ojo:** anular un ajuste no tiene vuelta atrás; si fue un error, cargá un ajuste nuevo."
  },
  {
    "id": "plata-ordenes-de-pago",
    "grupo": "Plata",
    "titulo": "Órdenes de pago",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Lista de OP del mes (**Todas las fechas** / **Este mes**), buscador por N°, proveedor, CUIT, medio o N° de cheque, filtros de estado y de enviadas. En cada una: ver, descargar, mandar por mail y anular.\n**Nueva OP**: proveedor → documentos a pagar (las notas de crédito del proveedor restan) → **Ret. Ganancias** → **Agregar medio** (Transferencia, Depósito, Cheque tercero, Cheque propio, E-Cheq, Efectivo, Tarjeta) → **Guardar** o **Guardar y enviar**. Si los medios no alcanzan, **Pagar parcial**. En **Comprobantes**, la IA autocompleta los medios.\n**Anular** no borra: la OP queda tachada, el pago y la retención anulados, las facturas vuelven a quedar a pagar y los cheques no cambian. **Anular y pagar de nuevo** reabre la OP con las mismas facturas.\n**Ojo:** solo Lazzari retiene Ganancias; **Grupo LA no es agente de retención**. Mínimo bienes $224.000 en el mes, servicios/transporte $67.170. Si la OP ya se mandó por mail, avisale al proveedor que la anulaste."
  },
  {
    "id": "plata-recibos",
    "grupo": "Plata",
    "titulo": "Recibos",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Un recibo por cobro, con su N°, medios, facturas, importe, estado en el banco y si se envió. Abre en el mes (**Todas las fechas** / **Este mes**); se busca por N°, cliente, factura, medio o N° de cheque.\nEn cada uno: ver, descargar y mandar por mail al cliente. **Nuevo cobro** abre la misma liquidación de Cobrar."
  },
  {
    "id": "plata-retenciones",
    "grupo": "Plata",
    "titulo": "Retenciones",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Dos botones: **Practicadas** (las de nuestras OP) y **Sufridas** (las que nos hicieron los clientes), con fechas y buscador.\n- Practicadas: arriba **Mes**, **1ª quincena** y **2ª quincena** con su total; **TXT SICORE** (antes avisa si algo no coincide; **Bajar el TXT igual**), **Excel** y **Sin concepto** (proveedores sin concepto de Ganancias, se calculan como bienes).\n- Sufridas: **Falta certificado (n)**, **Excel** para el contador y **Cargar certificado (IA)**: arrastrás uno o varios PDF o fotos, la IA lee cada certificado y propone a qué retención va; **Confirmar** de a uno o **Confirmar los que coinciden**. Nada se guarda solo.\n- En la columna **Certificado**, \"falta\" se toca para escribir el N° a mano; el cargado se puede ver y **Quitar** (queda anulado, no se borra).\n**Ojo:** sin el N° de certificado la retención sufrida no se puede computar."
  },
  {
    "id": "plata-iva",
    "grupo": "Plata",
    "titulo": "IVA",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "IVA del mes estimado con lo cargado en el sistema (◀ mes ▶ arriba): **IVA ventas (débito)** menos **IVA compras (crédito)** (con el IVA de comisiones del banco) menos retenciones de IVA sufridas con certificado = **A pagar, estimado** o **A favor, estimado**.\nCada número tiene su **Ver facturas**, **Ver comprobantes**, **Ver retenciones**, **Ver líneas del banco** o **Ver VEP**. Las percepciones y las retenciones sin certificado van aparte (no se restan).\n**Ojo:** no incluye saldo a favor de meses anteriores; es una estimación, no la declaración jurada."
  },
  {
    "id": "plata-bancos",
    "grupo": "Plata",
    "titulo": "Bancos",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Cuatro pestañas. Arriba, **¿Está todo al día?** dice qué archivo del banco falta subir.\n- **Cuentas y tarjetas**: una tarjeta por cuenta (el saldo del BBVA no se muestra: \"El saldo se mira en el home banking\"; BAVSA con su caución). En cada tarjeta de crédito, **Subir resumen**: la IA lee el PDF y vos revisás.\n- **Préstamos**: **Lo que debo** y **Lo que me deben**, con **Ver cuotas** / **Ver pagos**, **Anotar pago** y marcar cuotas pagadas.\n- **Cheques**: **Todos los cheques** (en fecha para pagar y para cobrar, próxima semana, por estado, **Próximas 4 semanas** y la lista con **Pendientes** / **Ver todos**) y **Martín F.** (**Copiar mensaje para mandarle**, **Ya cubrió**). Los estados cambian solos con cobros, OP y los archivos del banco.\n- **Movimientos**: **Para confirmar** (**Subir archivos del banco**: los Excel \"Movimientos\" una vez por mes y los reportes de eCheq todos los días hábiles; después confirmás cada línea) y **Ver por tipo** (solo lectura).\n**Ojo:** las transferencias se guardan pero no se cruzan: los cobros y pagos los cargás vos en Cobrar y Pagar."
  },
  {
    "id": "plata-gastos",
    "grupo": "Plata",
    "titulo": "Gastos",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Una sola lista del mes (◀ mes ▶ arriba) con gastos fijos y eventuales, en grupos, todo editable.\n**Nuevo gasto** → detalle, grupo, monto y pago; **Leer VEP (IA)** completa impuesto, período, N° de VEP y monto y adjunta el PDF (no guarda solo).\n**Editar gastos fijos** muestra los fijos (lo que se repite todos los meses; los cambios valen para los próximos). El fijo de Impuestos puede ir con **SICORE auto**: su monto son las retenciones de Ganancias del mes anterior. Los débitos automáticos (🔁) se cargan solos al abrir el mes, con **Deshacer**.\n**Ojo:** borrar un gasto anula su pago en Movimientos (queda el registro). Si ya está cruzado con el banco (**✓ banco**) y cambiás el monto, avisa y deja guardar igual."
  },
  {
    "id": "plata-movimientos",
    "grupo": "Plata",
    "titulo": "Movimientos",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Historial de todos los cobros, pagos, retenciones y ajustes, desde el 1° del mes. Filtros: tipo (**Cobro / ingreso**, **Pago / egreso**, **Retención sufrida**, **Ajuste**, **Otro**, **Anulados**), **Conciliados / Sin conciliar**, fechas y buscador. Lo anulado queda tachado.\n**Nuevo movimiento**: tipo (Cobro, Pago, Cheque emitido, Cheque recibido, Transferencia, Efectivo, Depósito, Ajuste), cliente o proveedor, descripción, monto, moneda y fecha → **Guardar**. No lleva retenciones."
  },
  {
    "id": "plata-reportes",
    "grupo": "Plata",
    "titulo": "Reportes",
    "ruta": "/finanzas",
    "modulo": "finanzas",
    "texto": "Resultado del mes (◀ mes ▶ arriba): **Venta neta** − **Costo de lo vendido** − **Gastos del mes** (fijos y eventuales) = **Resultado del mes**. Solo lee.\nAdentro está la barra de **Objetivos** del mes sobre el neto facturado: **Mínimo**, **Bueno** y **Muy bueno**, con cuánto falta. Abajo, **Para revisar (no frena nada)**."
  },
  {
    "id": "sistema-configuracion",
    "grupo": "Sistema",
    "titulo": "Configuración",
    "ruta": "/configuracion",
    "modulo": "configuracion",
    "texto": "**Usuarios** (solo super_admin: **Invitar usuario**, rol, quitar acceso). **Integraciones** (ARCA, banco, mail, IA). **Comisiones** (super_admin y admin: **Nueva regla de comisión**). **Retenciones** (mínimos y tasas). **Fechas de cheque** (días del mes en que se centralizan los cheques emitidos; la OP los propone)."
  },
  {
    "id": "sistema-papelera",
    "grupo": "Sistema",
    "titulo": "Papelera",
    "ruta": "/papelera",
    "modulo": null,
    "texto": "Lo eliminado: buscá y **Restaurar** (solo presupuestos). Facturas, OP y remitos anulados quedan como historial."
  }
];
