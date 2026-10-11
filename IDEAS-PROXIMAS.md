# Ideas próximas — CRM Lazzari

Estas son las ideas que Augusto quiere desarrollar después de la V1.1.410.

**Regla:** ninguna se construye sin que Augusto cierre antes sus preguntas abiertas. Primero se las hacés (pocas por vez, con opciones concretas), después proponés el plan y recién ahí se programa.

Orden sugerido:
1. Base común (venta cobrada y margen real por factura)
2. Comisiones
3. Margen de José
4. Ordenar pantallas a gusto
5. App de José
6. IA en la web

---

## 1. Comisiones con reglas

**Idea de Augusto**
- Seba y Jero trajeron clientes que son de ellos. Augusto quiere darles un porcentaje chico como incentivo durante los primeros 3 o 6 meses de esos clientes en la empresa.
- No aplica a todo cliente nuevo: solo a los que Augusto marca a mano. Ejemplo: Jero le vendió a la Cooperativa de Bogado, su pueblo.
- Se liquida **trimestralmente** y solo sobre lo que ya está **cobrado**.

**Propuesta**
- En la ficha del cliente se marca "Cliente aportado por: [vendedor]", con fecha de inicio, duración (3 o 6 meses) y %. Solo un admin puede crearla o cambiarla.
- Cuentan las facturas emitidas dentro de la ventana, netas de notas de crédito y sin IVA. Cada factura suma cuando está cobrada completa; si se cobra en otro trimestre, entra en ese trimestre.
- Al cierre de cada trimestre se arma la liquidación por vendedor con el detalle factura por factura. Augusto la aprueba, queda "a pagar" y después se registra el pago.
- Que el vendedor vea su acumulado y lo que falta cobrar.
- Ya existe `comision_reglas` (Configuración), pero Reportes calcula la comisión con un % fijo del código y no usa esas reglas. Hay que conectarlas y sumar esta regla nueva.

**Preguntas abiertas**
- ¿% sobre venta sin IVA o % sobre margen? ¿Qué % para cada vendedor?
- ¿3 o 6 meses, o se elige en cada caso? ¿Desde la primera factura o desde una fecha manual?
- ¿Qué clientes son de cada uno? (Cooperativa de Bogado → Jero; ¿cuáles de Seba?)
- ¿Tope por trimestre?

## 2. El margen para José Alvarez (abuelo de Augusto)

**Idea de Augusto**
- Después de los gastos, el margen positivo de las ventas es para José. Se le paga **mensualmente**.

**Propuesta: "Resultado del mes"**
- Cálculo, todo sin IVA:
  - ventas menos notas de crédito
  - − costo de la mercadería vendida
  - − personalización y fletes
  - − gastos fijos y gastos manuales
  - − comisiones
  - − impuestos sobre la venta (Ingresos Brutos, impuesto al cheque)
  - = resultado del mes
- Si el resultado es positivo, va a José. Si es negativo, no se paga y se descuenta de los meses siguientes.
- Augusto revisa, aprueba y se genera el pago en Finanzas.

**Preguntas abiertas**
- ¿Sobre lo cobrado (recomendado) o sobre lo facturado?
- ¿Solo Lazzari o Lazzari + Grupo LA?
- ¿Se retiene una reserva antes? ¿De qué %?
- ¿Qué gastos faltan cargar (sueldos, alquiler, contador)?
- ¿Cómo se le paga formalmente? Esto se consulta con el contador; no automatizarlo antes.

## 3. Ordenar pantallas a gusto

**Idea de Augusto**
- Poder ordenar a gusto el menú (Proveedores, Clientes, etc.), las columnas de las tablas y las pestañas horizontales.

**Cómo hacerlo sin riesgo**
- Es solo **preferencia de vista**: no toca datos.
- Se guarda **por usuario en la base**, así lo ve igual en cualquier compu o celular. Va en una tabla nueva (por ejemplo `user_preferencias`, con RLS: cada usuario solo lee y escribe la suya) y con su script de vuelta atrás.
- Se ordena arrastrando: menú lateral, columnas de tablas y pestañas.
- Opcionalmente se pueden ocultar columnas, pero sin ocultar módulos a los que el usuario tiene permiso.
- Siempre visible un botón **"Restablecer orden"**.
- Si aparece un módulo o una columna nueva que no estaba en el orden guardado, se agrega al final. Nunca desaparece.
- Los permisos por rol no cambian: ordenar no da acceso a nada nuevo.
- Hacerlo de a una pantalla primero (el menú lateral) y después extenderlo a las tablas.

## 4. App de pedidos para José (79 años)

**Idea de Augusto**
- José quiere salir a vender. Necesita una app muy fácil para levantar pedidos en la calle, con IA que lo ayude a pasarlos en limpio y con productos limitados.

**Propuesta**
- La app se instala en el celular como ícono (una página del CRM que se usa como app); no hace falta publicarla en las tiendas.
- Rol nuevo "vendedor calle", que solo ve esta app y sus pedidos.
- Tres pantallas con botones grandes:
  1. **Cliente:** buscarlo o crear uno con nombre y teléfono.
  2. **Pedido:** tocar productos de su lista corta (20 a 40 artículos con foto, + y −, talle), **dictar con la voz** o sacar una **foto a un papel**. La IA arma el pedido.
  3. **Revisar y enviar.**
- Sin señal, guarda el pedido y lo envía después. Nunca lo traba: siempre puede enviar "como esté".
- No puede cambiar precios ni descuentos.
- Entra al CRM como solicitud de presupuesto asignada a José, que formaliza la oficina.
- Antes de programar: mostrarle a José un diseño de prueba de 15 minutos y ajustar lo que no entienda.

**Preguntas abiertas**
- ¿Qué productos ve?
- ¿Android o iPhone?
- ¿Quién de la oficina recibe sus pedidos?

## 5. Asistente con IA en la web de precios

**Idea de Augusto**
- En la web con precios de venta, que el cliente cuente lo que necesita y la IA le arme un presupuesto. Si da poca información, que le pregunte. También puede armarlo a mano.

**Propuesta**
- Botón "Armame el presupuesto". La IA pregunta lo que falta y arma un carrito. El cliente lo ajusta y lo envía. Entra al CRM como **solicitud** (el estado ya existe) asignada a su vendedor.
- La IA usa solo **precios de venta** de la lista: nunca costos, márgenes ni proveedores. No inventa productos (lo que falta queda "a cotizar"). El precio es orientativo; el presupuesto formal lo emite el vendedor.
- Antes de enviar pide nombre, empresa, CUIT, email y WhatsApp.
- Protección contra abuso: límite de consultas, verificación anti-robot y un modelo económico.
- La web hoy es un `index.html` estático en Netlify (`G:\Unidades compartidas\02 - LAZZARI\CRM - COSTO VENTA\WEB - subir a Netlify`). Se reaprovecha la búsqueda de `lib/catalogo-busqueda.ts` (Cotización express).

**Preguntas abiertas**
- ¿Precios con o sin IVA, y en qué moneda?
- ¿Quién recibe las solicitudes de clientes nuevos?
- ¿Tope de consultas por día?

## 6. Reportes y Dashboard de cero

**Idea de Augusto**
- Reportes y Dashboard están como los dejó Manu; Augusto nunca los configuró. Hay que rehacerlos de cero según sus necesidades.
- Lo que hay hoy (por ejemplo, la comisión fija de 3 % de venta + 10 % de margen en Reportes) **no es una regla del negocio**: no se toma como referencia.

**Preguntas abiertas**
- ¿Qué números quiere ver apenas entra al sistema (Dashboard)?
- ¿Qué reportes usa de verdad hoy, aunque sea en Excel?
- ¿El Dashboard cambia según quién entra (Augusto, vendedor, administración)?

## 7. Torneo de vendedores (en desarrollo, se va completando)

**Idea de Augusto**
- Una competencia interna divertida y productiva entre todos los vendedores, con puntajes según lo que van logrando.
- Se arranca parcial y se suman reglas a medida que aparecen ideas.
- **Objetivo número uno: que vendan el máximo posible todos los meses y que nadie "se guarde" ventas para el mes siguiente** ("ya llegué al objetivo, me guardo este presupuesto"). Toda regla nueva se revisa contra esto.

**Decisiones de Augusto**
- Todos ven la tabla de todos.
- Temporada **trimestral** con un premio grande para el campeón, y **premios chicos mensuales**.
- Tiene que haber **premios lindos y copados**, para que sea divertido y se esmeren de verdad. Se definen después.
- El juego **solo suma**: perder un presupuesto no resta.
- Rachas: sí, pero cuidando el margen.
- Quedan afuera, por ahora: muestra convertida en venta y venta con personalización (la personalización no le interesa hoy; se charla más adelante).
- Juegan Seba, Jero y **Augusto**. Más adelante se suma **Mariana** (administrativa), con puntos por lo administrativo. Mientras ella no está, Augusto la reemplaza.
- **Lo primordial: pasarla bien, ganar plata y hacer el trabajo más llevadero.** El torneo es más para el chiste y el buen ambiente que para la competencia.
- La tabla tiene que ser **divertida, tipo dibujito**, y **verse todo el tiempo**: un mini podio fijo en el CRM que se abre a la tabla completa.
- Ideas de puntos para Mariana (a definir con ella): facturas de compra cargadas al día, cobranzas registradas, conciliación bancaria al día, cheques cargados, legajos de clientes completos.

**Reglas propuestas (borrador)**
- Ideas de Augusto:
  - Cliente nuevo: primera factura cobrada.
  - Ganancia en pesos (no %): puntos por la ganancia vendida.
  - Velocidad de cierre: presupuesto ganado en pocos días. Solo suma si el margen supera el mínimo, para no premiar regalar precio.
- Sugeridas:
  - Rachas: semanas seguidas con al menos una venta con margen mínimo y ganancia mínima.
  - Reactivar un cliente dormido (lo detecta Oportunidades).
  - Venta complementaria a un cliente actual (por ejemplo, le compraba calzado y ahora también guantes).
  - Respuesta rápida: presupuesto enviado en menos de 24 h desde la solicitud.
  - Seguimiento: presupuesto con respuesta antes de que venza.
- Medallas o logros únicos: primera venta del mes, venta récord, "rescatista" (3 clientes dormidos reactivados).

**Contra "guardarse ventas" (propuesta)**
- Sin objetivo ni tope mensual: no hay un número a partir del cual "ya está". Cada venta suma siempre.
- Puntos que crecen dentro del mes: los primeros pesos de ganancia del mes valen x1, pasado un tramo x1,5, después x2. Guardar una venta para el mes siguiente hace perder puntos, porque el mes nuevo arranca de nuevo en x1.
- Récord personal: bonus si supera su mejor mes.
- La venta cuenta en el mes en que se factura. Los puntos quedan "en espera" hasta que se cobra, pero se acreditan en el mes de la factura, no en el del cobro.
- Velocidad: el reloj corre desde que el presupuesto se envía. Un presupuesto que se cajonea pierde los puntos de velocidad.
- Aviso a Augusto (nunca bloqueo): presupuestos aprobados o en negociación en los últimos días del mes que se facturan recién en los primeros días del mes siguiente.

**Formato propuesto**
- Tabla de posiciones del mes y de la temporada (trimestre).
- Cada punto se puede abrir para ver de qué venta salió, así nadie discute.
- Las reglas y los puntos se editan en Configuración, sin programar.
- Depende de la "base común" (venta cobrada y ganancia real por factura), la misma que necesitan Comisiones y el margen de José.

**Preguntas abiertas**
- ¿José juega?
- ¿Qué premios? (mensuales chicos y trimestral grande)
- ¿Los tramos de ganancia del mes, con qué montos?

---

## 8. "Para revisar": acciones graves con motivo y OK de Augusto

**Idea de Augusto**
- Las acciones graves no se bloquean: se piden con un **motivo obligatorio** y caen en un sector **"Para revisar"**.
- Augusto entra, ve qué pasó y por qué, y aprueba o rechaza sin tener que preguntarle a nadie.
- Ejemplo: eliminar una OC que ya tiene factura, o corregirla porque se equivocaron de número de OC.

**Propuesta**
- Menú "Para revisar" con contador, más aviso en la campanita.
- Cada pedido muestra: quién, cuándo, qué acción, sobre qué (con link), el motivo y cómo estaba antes.
- Aprobar o rechazar, con comentario opcional. Queda todo en un historial.
- Acción útil para el caso del número de OC equivocado: **"Mover factura a otra OC"**, en vez de borrar y volver a cargar.

**Decisiones de Augusto**
- **Se hace al toque.** Lo borrado va a la Papelera, y cualquiera que borró algo por error lo puede restablecer. Si Augusto rechaza, se deshace.
- Cuando lo hace Augusto: va directo, pide el motivo igual (queda registrado) y no pasa por revisión.
- Avisa al que se equivocó y a Augusto (y a Mariana cuando vuelva).
- Acciones graves:
  - eliminar una OC con factura;
  - mover una factura a otra OC;
  - eliminar un cliente o proveedor con movimientos;
  - vender por debajo del margen mínimo.

---

## 9. Listas de costos y de venta centralizadas en el CRM (a futuro)

**Idea de Augusto**
- Hoy las listas se arman en el chat de listas y viven en el Drive. No todos tienen acceso, y en algún momento eso se va a trabar.
- Que todo esté en el CRM:
  - cargar las listas de los proveedores;
  - autorizar a otra persona para que lo haga;
  - desde ahí generar la lista de venta del CRM y la de la web (www.lazzari.com.ar).
- Que todo use **una sola lista**.
- Al actualizar: un resumen ("se actualizaron N artículos") y el historial de los artículos que aumentaron.
- Vencimiento de listas: el CRM recuerda y avisa para pedirle la lista nueva al proveedor o renovar la fecha.
- Hoy los chicos usan además la app **"COSTOS LAZZARI"**, con todos los productos y fotos. Desde ahí se filtra qué se muestra en la web. Centralizar todo lo posible.
- **Mientras no se construya, sigue valiendo la regla 7 de CLAUDE.md** (las listas se actualizan solo en el chat de listas).

**Propuesta (por etapas, sin cortar nada de lo que funciona)**
1. Traer al CRM los productos de COSTOS LAZZARI, con fotos, marca, rubro y la marca "se muestra en la web".
2. Que la web lea los precios directo del CRM: solo precio de venta y artículos visibles, nunca costos ni proveedores. Ya no hace falta subir el index.html a Netlify en cada actualización.
3. Carga de listas en el CRM, con IA:
   - se sube el Excel, PDF o foto del proveedor;
   - la IA reconoce las columnas y se acuerda del formato de cada proveedor;
   - muestra un resumen (nuevos, aumentos, bajas y cambios raros, por ejemplo +40 % o un código cambiado);
   - se aprueba y se aplica.
   - Lo puede hacer quien tenga el permiso "Listas".
4. Precio de venta con reglas, no a mano:
   - margen por proveedor, rubro o marca, con excepción por artículo;
   - redondeo;
   - dólar BNA para las listas en USD.
   - De ahí salen el precio del CRM y el de la web.
5. Vencimiento:
   - fecha de vigencia por lista y aviso unos días antes;
   - botón "Pedir lista" que arma el email o WhatsApp al proveedor;
   - "Renovar fecha" en un clic si mantiene precios.
6. Resumen de cada actualización:
   - artículos actualizados, aumento promedio y los que más subieron;
   - historial por artículo;
   - aviso a los vendedores;
   - presupuestos abiertos afectados.
7. El chat de listas y el Drive quedan de respaldo y se retiran cuando todo ande bien.
- Toda la empresa usa la misma lista: Cotización express, presupuestos, la app de José (idea 4) y el asistente de la web (idea 5).

**Respuestas de Augusto (10/10/2026)**
- Las listas las pueden cargar **todos**, siempre que quede un **historial de carga**: quién, cuándo, qué cambió.
- Los márgenes para el precio sugerido de venta hoy se manejan **por marca/rubro**.
- En la web los precios **no incluyen IVA**.
- La fuente de las reglas es `G:\Unidades compartidas\02 - LAZZARI\CRM - COSTO VENTA\Base_de_Costos_Lazzari_Oct2026.xlsx` (no modificarlo):
  - **Hoja "Reglas":**
    - tabla 1: por proveedor, moneda, vigencia, Desc. 1/2, opcional, otro, cómo se calcula el COSTO, condiciones;
    - tabla 2: criterio general;
    - tabla 3: cómo leer las hojas;
    - tabla 4: márgenes por rubro/marca (General 40 %, 3M 35 %, Aire Libre 38 %, Funcional/Voran 30 %, etc.) y el redondeo: pesos hacia arriba a $100 ($10 si es menos de $1.000), dólares al centavo.
  - **"Observaciones":** compara proveedores para el mismo producto (ARS, y 3M Segufer vs Segutécnica).
  - **Hojas por proveedor:** columnas de opcionales (Antic., Contado, Al día, Por cantidad, 12+, +10M, Excep.), Control "Verificar", Estado "PEDIR ACTUALIZACIÓN" (Prisina).
  - Regla clave: **los opcionales y los descuentos por volumen NO entran en el COSTO**; son margen extra de cada operación.

**Preguntas abiertas**
- Link y tipo de app de COSTOS LAZZARI (¿AppSheet, Glide, otra?). ¿Dónde están las fotos?
- ¿A quién se autoriza a cargar listas? ¿Lo que carga otro necesita el OK de Augusto (idea 8) o se aplica directo?
- ¿Cómo se define hoy el margen en el chat de listas? ¿Por proveedor, por rubro o por artículo?
- Web: ¿precios con o sin IVA? (también está abierta en la idea 5)

---

## Otros pendientes ya conocidos

- **Cheques:** importar a Finanzas → cheques los del Flujo de Fondos desde el 01/01/2026.
  - El archivo está en `C:\Users\lazza\lazzari\ideas\cheques_desde_2026.csv`, con 695 cheques. No subirlo a git: tiene datos de plata.
  - Los 15 de Martín Fernández van marcados aparte.
  - Antes de importar, mostrar a Augusto un resumen y pedirle OK.
- **BBVA Net Cash:** generar el archivo de pagos cuando Augusto pase el formato del banco. El botón ya existe en Plan de pagos.
- **Lista de costos en el CRM:** sumar fotos, rubro, marca y las reglas comerciales por proveedor. Las listas se siguen actualizando solo en el chat de listas, con `catalogo_crm.csv`.
- Centro de alertas unificado.
- Descuento visible en el PDF del presupuesto.
- Filtro por moneda en facturas de venta.
- Revisar migraciones viejas de Manu que puede que no estén corridas.
- Seguridad: rotar la clave de Anthropic y activar MFA en Supabase y Vercel.
- Configurar en Vercel `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET`, si no están, para el BCRA automático. Solo verificar los nombres; nunca pedir ni mostrar los valores.
