# Traspaso — sesión del pedido de Consultas (Inicio y Cheques), 03/11/2026

## 1. A medias o sin publicar

- **Punto 4 (Cheques → «Próximas 4 semanas»): PUBLICADO en V1.1.663** (commit `be9ae12`, deploy `dpl_GcadcWDuWxCzgBntq7VK8jsL9x64`, Ready, alias lazzari-crm.vercel.app).
  - «Esta semana» va de hoy al domingo (`semanaACubrir`). Los propios se cuentan con `fechaACubrir` y los recibidos en cartera ya en fecha entran hoy.
  - Al tocar la celda, la lista filtra desde 30 días atrás (`desdeEnFecha`).
  - Las tarjetas se llaman «Próximos 7 días a pagar / a cobrar».
  - Probado en local sin guardar: «Esta semana» a pagar = «A cubrir esta semana» = $ 23.549.954,72 (37 cheques).
  - **No se vio la pantalla en producción** (pide sesión). Ya está anotado en `docs/ESTADO.md`.
- **Puntos 1 a 3 del pedido de Consultas (Inicio, pestaña Administración): SIN EMPEZAR EN CÓDIGO.** Solo hay plan y mediciones de solo lectura.
  - **1. Ganancia del mes:** el neto de `estadoDeResultados`, con `traerDatosContabilidad` (`sociedad`, `[mes]`, `esLazzari`). Para un mes da igual que la columna del año: octubre en Lazzari = $ 4.738.606,84.
    - Lo estimado sale del `origen` de cada ítem: costo cotizado del PR (línea `costo_mercaderia` entera; octubre $ 81,8 M), IIBB 6 %, Ganancias 25 %, premios, comisión de José y sueldos sin cargar (`origen: "estimado"`).
  - **2. Caja del mes:** las líneas del extracto de las cuentas en $ (CC EPP, CC INDU, Caja de ahorro $), con `traerDatosCashflow` + `filaDeLineaBanco`. Es la misma base que las semanas pasadas del Cashflow y que el lado «banco» del cruce de Nati.
    - Octubre: entró $ 78.595.754 (cobros 77.736.038 + otros 859.717), salió del negocio $ 174.502.517 y quedó −$ 95.906.762.
    - Retiros (fila `retiros`, aparte): −$ 10.161.176.
    - Pases/FCI (no cuentan, se informan): +$ 74.200.000.
    - Total de las líneas: −$ 31.867.939, igual que el cruce.
    - Saldo del extracto: de $ 35.736.983 (01/10) a $ 3.698.087 (01/11). La diferencia de $ 170.957 contra las líneas ya está en el borrador de Nati.
  - **3. Mismo número (medido hoy, Lazzari):**
    - Cheques a cubrir esta semana: Inicio = Finanzas = Cashflow = $ 23.549.954,72. **OK.**
    - Me deben: Inicio $ 142.074.236; el Cashflow cuenta $ 4.355 más.
    - Debo pagar: Inicio $ 21.974.207; el Cashflow cuenta $ 14.635 más.
    - Causa: `traerDatosCashflow` usa `deudas.vencimientos` **con** los 3 saldos chicos sacados de pendientes (el Inicio y Finanzas usan `separarSacados`).
    - Grupo LA: todo en 0 en los tres.
  - **Plan propuesto:** cuentas puras en un `src/lib` nuevo con su prueba, más un hook o función de datos nuevo para que Diseño CRM lo use en el Inicio, con ◀ ▶ de mes. **Sin tocar `tablero-inicio.tsx`** (ver aviso 4).
- **Copia limpia `ch4`:** `C:\Users\lazza\AppData\Local\Temp\claude\C--Users-lazza-lazzari\fca1891c-75af-457b-bc73-ee63c7ca4e9b\scratchpad\ch4`
  - Es un worktree, hoy en `be9ae12` = V1.1.663.
  - Tiene `.env.local` y `.vercel` copiados, y `node_modules` como junction a la carpeta principal.
  - Servidor `crm-cheques-semana`, puerto 3027, en `.claude/launch.json` (quedó corriendo).
  - Scripts de solo lectura en el mismo scratchpad: `retiros-oct.ts`, `punto3.ts` y `leer.cjs`.

## 2. Espera un OK de Augusto

- «¿Arranco con el plan de los puntos 1 a 3?» (el plan está arriba).
- «¿El Cashflow también deja afuera los saldos chicos sacados?» Recomendado: sí, para que me deben y debo pagar den igual en todos lados. El 02/11 se había dejado el Cashflow contándolos.
- La caja: confirmar que «quedó» = entró − salió del negocio (sin retiros ni FCI), con los retiros y el saldo del banco al principio y al final del mes en líneas aparte.

## 3. Espera a otra persona

- **Nati:** validar el borrador del cruce resultado → caja de octubre (paso 4, hoy es un Excel), antes de llevarlo al CRM. Quedan $ 14.227.479 sin explicar.
- **Chat de Contabilidad (Nati) / CRM:** `a_retiros` del bloque informativo da $ 18.932 más que el banco. Son 2 suscripciones de Apple (US$ 2,99 y US$ 9,49) cargadas en Gastos › Personales sin línea del banco. Si se pagaron con la Mastercard, se cuentan dos veces, porque el pago de la Mastercard ya es retiro. No se tocó.

## 4. Avisos para el chat CRM

- **No tocar ni pisar `lz-campana`** (`C:\Users\lazza\lz-campana`): tiene cambios sin commitear en `tablero-inicio.tsx`, `lib/tablero-inicio.ts`, `test-tablero-inicio.ts`, el header, el sidebar, `auth-context` y el login (margen bajo en el Inicio, P05). Por eso los puntos 1 a 3 deben ir en archivos nuevos.
- **No publicar desde `C:\Users\lazza\lazzari`:** está en V1.1.597 con cambios viejos sin commitear. Publicar desde una copia limpia de `origin/main`.
- **Para borrar la copia `ch4`:** primero sacar la junction `crm\app\node_modules` (si no, borra el `node_modules` de la carpeta principal) y después `git worktree remove`. También quitar su entrada de `launch.json`.
- **La Visa de la empresa es salida del negocio** (Augusto). En la caja no se separan los consumos personales de la Visa; `a_retiros` de Contabilidad sí los suma cuando hay resumen cargado. Hay que cuidar no contarlos dos veces.
