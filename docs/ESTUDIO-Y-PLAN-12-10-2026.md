# Estudio del sistema y plan — 12/10/2026

Para leer con calma. Nada de esto está programado todavía: **espera tu OK**.
Al final hay una lista de preguntas para vos.

---

## 0. Lo que ya quedó hecho hoy

- **Publicada la V1.1.417** (commit `f5b725c`, sin migración). Antes de publicar: chequeo de tipos 0 errores, orden de hooks OK,
  pruebas de extracto, saldo de cuentas, FCI, grupos de Finanzas y tipo de cambio USD: todas OK. Vercel: "READY" en https://lazzari-crm.vercel.app.
- `docs/ESTADO.md` actualizado.

---

## 1. Tarea 1 — Cobro masivo que deje confirmar con diferencia

### Cómo está hoy
En la "Liquidación de cobro" (`components/cobro-masivo-liquidacion.tsx`) el botón **Confirmar** queda gris si la diferencia
entre lo que pagó el cliente (medios + retenciones) y el saldo de las facturas no es $0, y dice
"La diferencia debe ser $0 para confirmar el cobro". Esto va contra la regla 1. Caso real que lo trabó:
eCheq de Del Sol $6.210.728,30 contra 5 facturas por $6.463.222,05 → faltan **$252.493,75** (seguramente retenciones sin certificado todavía).

### Qué propongo
1. **El botón Confirmar siempre se puede apretar** (si hay al menos un medio de pago con importe y, en dólares, el tipo de cambio cargado).
2. Si hay diferencia, antes de guardar aparece un **cartel amarillo que avisa y pregunta**:
   - **Falta plata** (pagó menos): "Faltan $252.493,75. Se aplica el cobro empezando por la factura más vieja;
     la FA 15-54 queda con saldo $252.493,75. ¿Seguir?" → Sí / Cancelar.
     Con una casilla tildada por defecto: **"Dejar en Revisar: diferencia a confirmar (¿retenciones?)"** (cuando exista la pestaña Revisar, ver tarea 2).
   - **Sobra plata** (pagó de más): "Sobran $X. Quedan como saldo a favor del cliente en su cuenta corriente. ¿Seguir?" (igual que ya hace la NC).
3. El cuadro de abajo cambia de rojo a **amarillo** con el texto "Diferencia: −$252.493,75 — podés confirmar igual" y debajo
   un detalle de **cómo queda cada factura** después del cobro (pagada / queda debiendo $X).
4. La cuenta de "a qué factura va cada peso" la hago en una función aparte y probada (`src/lib/cobro-reparto.ts` + prueba
   `scripts/test-cobro-reparto.mjs`): ordena por fecha (más vieja primero), llena cada factura y la última queda con el saldo.
   En facturas en dólares reparte en dólares usando el tipo de cambio del cobro.
5. Cuando después lleguen los certificados de retención, se cargan en la factura que quedó con saldo como un cobro normal y queda en $0.

### Lo que hay que mirar antes (paso 0, solo lectura)
La parte que guarda de verdad es una función de la base hecha a mano por Manu (`registrar_cobro_masivo`) que **no está en el repositorio**.
Antes de programar necesito ver cómo reparte cuando la plata no alcanza. Es una consulta de solo lectura, no cambia nada:

```sql
select pg_get_functiondef('public.registrar_cobro_masivo'::regproc);
```

- **Si ya reparte bien** (aplica a cada factura lo que le mandamos) → **no hace falta migración**: solo cambia la pantalla.
- **Si no** (por ejemplo, marca todas como pagadas igual) → hago una migración **aditiva** (con su vuelta atrás) que ajuste
  la función "segura" que ya está en el repo para que respete el reparto. Te la paso con los pasos para el SQL Editor.

De paso, esa definición queda guardada en el repo (en `supabase/diagnostico/`) para que no vuelva a ser una caja negra.

### Riesgo ⚠️
Toca cómo se guardan cobros (plata). Por eso: función probada, prueba en local **sin guardar**, y el primer cobro real con diferencia
(Del Sol 3968) lo hacés vos mirando que la FA 15-54 quede con $252.493,75 de saldo.

---

## 2. Tarea 2 — Pestaña "Revisar" en Finanzas > Hoy

### Para qué
Un solo lugar donde quedan **las cosas con dudas**, para no tenerlas anotadas en el ESTADO, en CSV o en la cabeza.
Hoy hay varias esperando: fecha de recepción de los cheques de Del Sol y Bichara, cobros con fecha futura (Barraza, Del Sol),
125 líneas pendientes del extracto, FA 16-18 que quizá está facturada dos veces, OP-000038/52 con tarjeta, etc.

### Cómo se vería
Finanzas > **Hoy** > **Revisar** (con un número rojo con la cantidad pendiente, como la campana). Dos partes:

**A) "Lo que dejaste para revisar" (lo cargás vos o lo deja el sistema cuando confirmás algo con aviso)**
- Cada fila: fecha, qué es (cheque, cobro, pago, factura, línea del extracto, otro), a quién (cliente/proveedor), importe,
  **motivo** ("diferencia por retenciones", "falta fecha de recepción", "¿facturada dos veces?"), nota libre y **"Recordarme el"** (fecha opcional).
- Botones: **Abrir** (te lleva al cheque/cobro/factura), **Resuelto** (pide una nota corta de qué se hizo) y **Posponer**.
- Filtros: pendientes / resueltos, por motivo, por cliente.
- Si ponés "Recordarme el 13/10", ese día te avisa la campana.

**B) "Lo que encontró el sistema" (automático, no hay que cargarlo)**
- Líneas del extracto sin cruzar (con link a Extractos filtrado).
- Cobros o retenciones con fecha futura.
- Cheques en cartera con fecha de pago vencida hace más de 3 días (¿se depositó?).
- Movimientos de plata sin cuenta asignada.
- Facturas con diferencia de cobro (las que deje la tarea 1).
Cada uno con su botón para ir a resolverlo. No bloquea nada: solo muestra.

**C) Botón "🚩 Dejar para revisar"** en las pantallas donde aparecen las dudas: detalle de cheque, detalle de cobro/factura de venta,
orden de pago, línea del extracto y factura de compra. Abre una ventanita con motivo + nota + fecha y listo.

### Qué hace falta
- **Migración nueva (aditiva) + vuelta atrás:** tabla `finanzas_revisar` (sociedad, qué tipo de cosa es y su id, motivo, nota,
  importe, recordar el, estado pendiente/resuelto, quién y cuándo lo cargó y lo resolvió). No toca ninguna tabla existente.
  Tiene las mismas reglas de acceso que el resto de Finanzas (solo administración y la sociedad activa).
- Componente nuevo en archivo propio (`components/finanzas-revisar.tsx`), lógica de la parte automática en `src/lib/revisar-finanzas.ts` con prueba.
- Agregar la pestaña al grupo "Hoy" en `lib/finanzas-grupos.ts`.
- Aviso de la campana: se suma al cron diario que ya existe (`presupuestos-vencimiento`, que ya avisa de los cheques de Martín).
- **Carga inicial** (con tu OK, después de publicar): paso a "Revisar" lo que hoy está anotado como REVISAR en el ESTADO
  (fechas de recepción de cheques Del Sol/Bichara, Barraza y Del Sol con fecha futura, FA 16-18, diferencia Del Sol 3644 $193.792,37, etc.).

### Orden sugerido
Primero la tarea 2 (Revisar) y después la 1 (cobro con diferencia), así el cobro con diferencia ya puede dejar su aviso en Revisar.
Se publican juntas en la misma tanda.

---

## 3. Transportes y talleres: cómo está y qué propongo

### Cómo está hoy (lo que encontré en el código)
- **Dos listas de transportistas.** Manu empezó a unificarlos con Proveedores (migración del 07/10: tilde "es transportista" en el proveedor
  y una copia automática en la tabla vieja `transportistas`), pero quedó a medias: la pantalla Transportes tiene su propio
  "Catálogo transportistas" y los viajes apuntan a esa tabla vieja, no al proveedor.
- **Viajes internos:** el chofer se escribe a mano (texto libre, sin proveedor). Se agrupan por día y chofer y se les pone un costo por día.
  No se sabe a qué proveedor pagarle hasta el momento de "enviar a pagos", donde se elige a mano.
- **Viajes externos:** uno por viaje, con costo, cliente y un remito (la lista de remitos trae solo los últimos 200).
- **Enviar a pagos:** se elige proveedor, se sube la factura (la IA la lee) o se tilda "sin factura" (crea una "FC Manual" `MAN-TR-…`).
  Queda como factura de compra pendiente y aparece en Pagar. Problemas:
  - Se guarda en 3–4 pasos sueltos desde el navegador (crear factura, subir archivo, vincular viajes). Si se corta internet a la mitad,
    puede quedar una factura sin viajes o viajes sin factura.
  - No queda una **liquidación** con número ni un PDF para mandarle al transportista con el detalle de lo que se le paga.
  - La factura se marca como de "mercadería" (debería ser "servicio/flete": importa para la retención de Ganancias y los reportes).
  - No compara lo que factura el transportista con lo que dicen los viajes (si te factura de más, nadie avisa).
  - Borrar un viaje lo borra del todo (sin Papelera).
- **Talleres (Personalización)** están **mejor resueltos**: trabajos → pestaña "Liquidaciones" por taller y período →
  "con factura" o "liquidación interna" (`LIQ-PERS-…`, que crea la deuda) → aparece en Pagar. Igual tiene el mismo problema de
  guardar en pasos sueltos y también marca la factura como "mercadería".

### Propuesta: un solo circuito "Liquidar servicios" para transportistas y talleres

**Paso 1 — Una sola ficha: el proveedor.**
En la ficha del proveedor, para transportistas y talleres:
- **Interno / Externo** (interno = trabaja para vos de forma fija; externo = empresa de transporte o fletero ocasional).
- **¿Te hace factura?** Sí (A/B/C) / No → liquidación interna. Se usa como sugerencia al liquidar (siempre se puede cambiar).
- **Tarifa** sugerida: por viaje, por zona, por día o fija por mes (la ✨ completa el costo del viaje con esto).
- **Cada cuánto se le liquida** (semanal, quincenal, mensual) y CBU/alias.
- Los viajes nuevos guardan el **proveedor** directamente. Los choferes internos pasan a ser proveedores (sin CUIT si no tienen; con tu OK).
- La pestaña "Catálogo transportistas" se reemplaza por un link a Proveedores filtrado "transportistas". La tabla vieja **no se borra**.

**Paso 2 — Pestaña "Liquidar" en Transportes (igual a la de Personalización).**
1. Elegís transportista y período (por defecto, desde la última liquidación hasta hoy).
2. Ves todos sus viajes sin liquidar con su costo y total. Tildás los que entran.
3. **Si te factura:** subís la factura, la IA la lee y la compara con el total de los viajes. Si no coincide → **aviso amarillo**
   ("te factura $X, los viajes suman $Y"), nunca bloquea.
4. **Si no te factura:** genera la **Liquidación interna `LIQ-TR-0001`** con un **PDF** (detalle de viajes, fechas, destinos, total)
   para mandarle por WhatsApp o mail.
5. Se guarda **todo junto o nada** (una sola función en la base, como cobros y OP), queda como factura de compra pendiente
   tipo "servicio" y aparece en **Pagar** y en el **Plan de pagos**.
6. **Anular liquidación** (no borrar): libera los viajes para volver a liquidarlos.
7. **Descuentos y adelantos** (combustible, peajes, adelantos en efectivo): renglones que restan en la liquidación.

**Paso 3 — Lo mismo para talleres.** Personalización usa el mismo componente y la misma función "todo o nada", y la factura pasa a "servicio".

**Paso 4 — En Finanzas > Pagar, cuadro "Servicios por liquidar".**
Muestra por transportista y taller lo trabajado y todavía no liquidado (es deuda que ya existe aunque no esté en pagos).
Esto entra también en la proyección de caja.

**Paso 5 (más adelante) — Costo real de cada venta.**
Cada viaje ya puede ir atado a un remito/cliente: sumar flete y bordado/estampado al costo de la venta para ver el **margen real**
(hoy el margen no descuenta flete ni personalización).

**Retención de Ganancias:** los fletes y los servicios tienen su propio mínimo y porcentaje en la RG 830 (distinto de bienes).
Hoy el Plan de pagos usa uno solo. Va junto con el punto A5 pendiente (confirmar montos con el contador).

**Necesita:** una migración aditiva (campos nuevos en proveedores y viajes, tabla de liquidaciones de transporte, la función "todo o nada")
con su vuelta atrás. Es una tanda mediana; propongo hacerla **después** de las tareas 1 y 2.

---

## 4. Estudio general: qué está flojo y cómo lo mejoraría

Ordenado por importancia. 🔴 = puede costar plata o datos · 🟠 = orden y velocidad · 🟡 = menor.

### 🔴 1. Funciones de plata que no están en el repositorio
`registrar_cobro`, `registrar_cobro_masivo`, `recalcular_saldo_cliente/_proveedor`, `get_balance_projection` (Caja/Balance)
y `get_dashboard_kpis` (Dashboard) las hizo Manu a mano en Supabase. Nadie sabe bien qué hacen y no hay copia.
**Mejora:** bajar sus definiciones al repo (consulta de solo lectura, como la del paso 0), revisarlas y agregarles prueba.
Beneficio: si algo de saldos da raro, se puede explicar y corregir sin adivinar.

### 🔴 2. Guardados de plata en varios pasos sueltos
Hay unos 36 lugares que escriben directo en facturas, movimientos, cheques u OP desde el navegador, en varios pasos
(Transportes, Personalización, partes de Finanzas). Si algo falla a mitad, el sistema intenta "deshacer" borrando, y si se corta internet queda a medias.
Cobros y órdenes de pago ya se pasaron a funciones "todo o nada".
**Mejora:** pasar los que mueven plata al mismo esquema, empezando por Transportes y Personalización (sección 3).

### 🔴 3. Borrados físicos
55 lugares borran registros del todo (cheques, viajes, ítems, etc.). En plata, borrar deja agujeros en la historia.
**Mejora:** en lo que toca plata, "Anular" en vez de borrar, y lo demás a la Papelera (ya existe y está el pendiente 5).

### 🔴 4. Dos cálculos distintos de "cuánta plata hay"
La pestaña **Cuentas** (nueva, basada en el banco) y los botones **Caja/Balance** (función vieja `get_balance_projection`,
que suma cheques en cartera, cheques propios diferidos y tarjeta como plata del día) pueden dar números distintos.
**Mejora:** que Caja/Balance y el Dashboard usen el mismo cálculo que Cuentas. Un solo número de "plata disponible".

### 🔴 5. Retención de Ganancias con un solo mínimo
Bienes, servicios, fletes y honorarios tienen mínimos y porcentajes distintos. Hoy hay uno solo (y dos valores, 224.000 y 400.000).
Riesgo: retener mal y que el proveedor reclame o ARCA observe. Es el pendiente A5: necesita el archivo de Netegia y confirmar con el contador.

### 🟠 6. Finanzas es una sola pantalla gigante
`finanzas/page.tsx` tiene **7.579 líneas** y pesa 242 kB solo esa pantalla (las demás pesan entre 5 y 50 kB).
Tarda más en abrir y cada cambio toca un archivo enorme (más riesgo de romper otra pestaña).
**Mejora:** separar cada pestaña en su propio archivo y que se cargue cuando la abrís (como ya se hizo con Cuentas y Extractos).
No cambia nada de lo que ves; abre más rápido. Lo mismo, más adelante, Presupuestos (4.657) y Compras (3.740).

### 🟠 7. Pruebas viejas que fallan
De 59 pruebas automáticas, **13 fallan** (son de cómo era el código antes; ej. pagos, OP, notas de crédito de compra, factura de transporte).
Una prueba que siempre falla deja de avisar cuando algo se rompe de verdad.
**Mejora:** actualizarlas (es el pendiente 0b). Tanda chica, sin riesgo, sin migración.

### 🟠 8. El sistema "no conoce" bien su propia base
Hay 373 lugares que usan tablas que el chequeo de tipos no conoce (las tablas nuevas no están en la descripción de la base).
Eso hace que algunos errores (un nombre de columna mal escrito) no se vean hasta que falla en uso.
**Mejora:** regenerar la descripción de la base (un comando de solo lectura) y sacar esos atajos de a poco.

### 🟠 9. Ventanitas del navegador para avisar
Hay 332 `alert`/`confirm` (las ventanitas grises del navegador). Son feas, no dejan anotar nada y a veces se pierden.
**Mejora:** un único cartel propio de "Avisar y preguntar" que además tenga **"Seguir"**, **"Cancelar"** y **"Seguir y dejar en Revisar"**.
Encaja con la regla 1 y con la tarea 2. Se va reemplazando de a poco, primero en Finanzas.

### 🟠 10. Carteles que traban (regla 1)
Encontré unos 25 mensajes tipo "no se puede…" o "debe ser $0". Algunos están bien (ej. no facturar sin CUIT para ARCA),
otros van contra la regla 1 (como el del cobro masivo). **Mejora:** revisarlos uno por uno y pasarte la lista con mi recomendación para cada uno.

### 🟠 11. Listas que se cortan
Transportes trae solo los últimos 200 remitos; varias listas de clientes y proveedores no usan el paginado (si pasan de 1.000 se cortan sin avisar).
Y 6 consultas mezclan datos "sin sociedad" con la sociedad activa. **Mejora:** usar el paginado y el buscador en todas.

### 🟠 12. Muchas cosas pendientes viven en el ESTADO y en CSV
Dudas, recordatorios y "REVISAR" están en `docs/ESTADO.md`, en `Claude outputs/*.csv` y en recordatorios sueltos.
**Mejora:** la pestaña Revisar (tarea 2) + un **centro de avisos único** (campana + Revisar + alertas del BCRA + cheques de Martín) en un solo lugar.

### 🟡 13. Seguridad
- Pendiente: rotar la clave de Anthropic y activar la verificación en dos pasos (MFA) en Supabase y Vercel. Lo tenés que hacer vos; te guío.
- El envío de mails con adjuntos descarga archivos de cualquier dirección que mande la pantalla (solo usuarios logueados).
  **Mejora:** que solo acepte archivos del Storage propio. Cambio chico.
- Al publicar desde la terminal "Bash" Vercel dijo "Not authorized"; desde PowerShell anduvo bien. No es un problema del sistema, solo lo anoto.

### 🟡 14. Datos de calendario
Feriados 2026 cargados; faltan los móviles de 2027 (para los avisos de débitos de cheques). Cargarlos en diciembre.

### Ideas de producto (cuando lo de arriba esté firme)
- **Proyección de caja 30/60/90 días** con todo: cobros esperados, cheques, gastos fijos, créditos, servicios por liquidar y préstamos familiares.
- **Margen real por venta** (precio − costo − flete − personalización − comisiones).
- **Botón "Próximo paso"** en cada operación (presupuesto → venta → OC cliente → factura → cobro).
- **Cobros sugeridos desde el extracto:** en "Para revisar" del extracto, sugerir las facturas del cliente cuyo saldo neto de retenciones coincida.

---

## 5. Orden que te propongo

1. **Tanda 1 (ahora):** pestaña Revisar + cobro masivo con diferencia. Una migración (tabla `finanzas_revisar`) y, según el paso 0, quizá otra chica.
2. **Tanda 2:** arreglar las 13 pruebas viejas + bajar al repo las funciones hechas a mano (solo lectura). Sin riesgo; deja la base firme para lo que sigue.
3. **Tanda 3:** Liquidar servicios (transportes y talleres), sección 3.
4. **Tanda 4:** separar Finanzas en archivos (más rápido) + cartel propio "Avisar y preguntar".
5. **Tanda 5:** un solo cálculo de "plata disponible" (Cuentas = Caja = Dashboard) + proyección 30/60/90.
6. En paralelo, cuando tengas los datos: A5 retenciones (contador + Netegia).

---

## 6. Preguntas para vos

**Sobre las tareas 1 y 2**
1. Cuando el cliente paga de menos, mi propuesta es pagar primero las facturas más viejas, así lo que falta queda en la **más nueva**. ¿Te sirve así o preferís elegir vos en qué factura queda?
2. ¿Querés poder dejar en Revisar cosas que **no son de Finanzas** (ej. una OC, un cliente)? Propuesta: por ahora solo Finanzas.
3. ¿Quién más debería ver la pestaña Revisar? (propuesta: solo administración).

**Sobre transportes y talleres**
4. Los **internos**: ¿son empleados tuyos o fleteros que trabajan solo para vos? ¿Cobran por viaje, por día o fijo por mes?
5. ¿Cada cuánto les liquidás? (semanal, quincenal, mensual) ¿Y a los talleres?
6. ¿Tenés **tarifas fijas** (por zona, por viaje)? ¿Me pasás una lista?
7. ¿Les das **adelantos** (combustible, peajes, efectivo) que después se descuentan?
8. ¿Les pagás por **transferencia o en efectivo**? (el efectivo mueve tu caja)
9. ¿A veces le **cobrás el flete al cliente**? (para facturarlo en la venta)
10. Los que no facturan, ¿tienen CUIT? ¿Necesitás algún papel firmado de ellos (recibo)?
