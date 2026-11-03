# Pedidos de Consultas para el chat CRM (03/11/2026)

Desde el 03/11 hay un solo chat que cambia el sistema (CRM); Diseño CRM hace lo visual, Web la web y Consultas solo charla.
Se hacen **en este orden y de a uno**, cada uno con plan corto y OK de Augusto. Copia de trabajo del chat CRM: `C:\Users\lazza\lz-crm`
(worktree de origin/main; `node_modules` es un enlace a la carpeta principal; servidor local `crm-lz`, puerto 3031, en `.claude/launch.json`).

Reglas: cada número sale de un solo lugar en `src/lib`, nunca una cuenta nueva en una pantalla. Antes de cambios grandes, plan corto y OK.

## A) Mapa de números
Armar `docs/NUMEROS.md`. Para cada número que ve Augusto (ventas del mes, costo de lo vendido, transportes del mes, resultado y los 2 escalones,
gastos a cubrir, cheques a cubrir, me deben, debo pagar, objetivos y premios, dólar del día): qué función de `src/lib` lo calcula, qué pantallas
lo usan y quién lo cuida. Buscar con grep las pantallas que hoy lo recalculan por su cuenta y listarlas (sin tocarlas).
Agregar en `CLAUDE.md` la regla: "toda pantalla usa la función del mapa; si falta algo, se agrega en el lib dueño, nunca una cuenta nueva en la pantalla".

## B) Inicio › Administración: "cómo me fue en el mes" (con ◀ ▶ para elegir el mes)
Sin Ganancias ni Intereses aparte. Dos escalones, con las MISMAS líneas de `estadoDeResultados` (`lib/contabilidad.ts`), con una función pura nueva en ese lib:
- Vendiste − costo de lo vendido (PR) = **MARGEN** (lo generado)
- − transportes − sueldos y premios − sueldo Mariana − comisión de José − local, servicios y administración = **1) LO QUE DEJA EL NEGOCIO**
- − IIBB y tasas − crédito fiscal IVA comprado − gastos del banco − intereses = **2) TE QUEDÓ** (sin Ganancias)
- Octubre 2026 Lazzari tiene que dar: margen 37,8 M, escalón 1 15,9 M, escalón 2 6,3 M.

Además:
- **CAJA del mes** (entró / salió / quedó, real del banco, sin pases entre cuentas ni FCI, retiros de Augusto aparte), usando lo que ya armó Contabilidad
  (bloque "fuera del resultado" del paso 3 y el borrador del paso 4), sin cuenta nueva. Medido el 03/11 (octubre Lazzari, `traerDatosCashflow` + `filaDeLineaBanco`,
  cuentas en $): entró $ 78.595.754, salió del negocio $ 174.502.517, quedó −$ 95.906.762; retiros −$ 10.161.176; pases/FCI +$ 74.200.000; saldo del extracto
  de $ 35.736.983 (01/10) a $ 3.698.087 (01/11).
- La línea **"Para cubrir los gastos tenés que generar $X. Llevás $Y"**: X = todo lo que se resta después del margen en el último mes cerrado (octubre: 31,4 M),
  Y = margen del mes en curso. Siempre con lo generado, nunca con lo vendido. En el recuadro "Cubro los fijos" sacar "Falta vender".
- Confirmar que cheques a cubrir, me deben y debo pagar del Inicio den igual que en Finanzas y Cashflow. Medido el 03/11: cheques a cubrir esta semana igual en los
  tres ($ 23.549.954,72); me deben: el Cashflow cuenta $ 4.355 más; debo pagar: $ 14.635 más. Causa: `traerDatosCashflow` usa `deudas.vencimientos` con los 3 saldos
  chicos sacados de pendientes (Inicio y Finanzas usan `separarSacados`). Pregunta para Augusto: ¿el Cashflow también los deja afuera? (recomendado sí).
- No tocar `tablero-inicio.tsx` de la copia `lz-campana` (P05 no va). Lo visual lo arma después Diseño CRM: al terminar, dejar anotado qué datos le quedan disponibles.

## C) Transportes "mes del viaje"
Los transportistas facturan los primeros días del mes los viajes del mes anterior (Cargiulo Angélica FC C 00001-00000097 $ 380.000 y José Rodríguez FC C 0002-00000384
$ 93.000, ambas del 02/11, son de octubre) y hoy cuentan en el mes de la fecha de la factura. Al cargar una factura de transporte, si la fecha es del 1 al 10, se sugiere
el mes anterior (se puede cambiar; nunca frena). Reportes, Contabilidad, el Inicio y el Cashflow usan ese mes. Revisar las ya cargadas de principios de octubre y noviembre
y proponer el mes de cada una, sin cambiarlas solo. Si lleva migración: aditiva, con rollback, y explicarle antes a Augusto. **B y C tocan los números del mes: publicar uno y después el otro.**

## Recordatorio
Hasta enero 2027 los objetivos siguen sobre ventas (64 / 80 / 96 M sin IVA; premio $ 200.000 o $ 400.000 por persona). Desde enero 2027 pasan a ser sobre lo generado:
recordárselo a Augusto en diciembre.
