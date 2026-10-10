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
