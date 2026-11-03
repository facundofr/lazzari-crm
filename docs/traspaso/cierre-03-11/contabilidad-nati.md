# Cierre del chat Contabilidad (Nati) — 03/11/2026

## 1. A medias o sin publicar
- **Nada sin publicar.** La V1.1.662 (commit `c28c193`) se publicó el 03/11 a las 11:31. Incluye el paso 3 de Nati (el bloque informativo en dos partes), el P16 (el IIBB del Cashflow neto) y el P07 del lado del Cashflow (los cheques a cubrir con la regla única, y los de Martín F. suman). Producción apunta a ese deploy. La anotación del paso 4 en `docs/ESTADO.md` se subió en el commit `75d7778`, solo documentación.
- **Falta una sola prueba:** mirar en producción, con sesión, *Finanzas › Contabilidad*. No la pude hacer porque el navegador pide login, así que lo probé con el mismo cálculo de la pantalla en scripts de solo lectura. Pruebas, tsc y hooks dieron bien. Qué mirar:
  - *Estado de resultados*: el bloque "Fuera del resultado" con a) y b), con las líneas que se abren, y que el Excel salga con las dos partes.
  - *Cashflow*: la línea "Saldo a favor de IIBB (estimado)" debajo de Otras disponibilidades.
- **Copia limpia para borrar:** `C:\Users\lazza\AppData\Local\Temp\claude\C--Users-lazza-lazzari\15d2a28f-a72a-4f67-b1bb-80336f53bf7a\scratchpad\p16`. Es un git worktree "detached" que quedó en `75d7778`, ya sin el enlace a node_modules ni a .env.local. Tiene una copia de `.vercel`. Se borra con `git worktree remove --force <ruta>`. En `.claude/launch.json` la apunta la entrada `crm-contabilidad-iibb` (puerto 3019), que también se puede borrar.

## 2. Espera un OK de Augusto
- Nada.

## 3. Espera a Nati (paso 4)
- **Archivo:** `C:\Users\lazza\lazzari\Claude outputs\Cruce resultado-caja octubre 2026 - Lazzari (borrador para Nati).xlsx`, con las hojas *Cruce octubre*, *Banco octubre* y *Para revisar*. Es el cruce de octubre de Lazzari por rubro: resultado + ajustes (parte b, meses anteriores, IVA) contra lo que pasó en el banco.
- **Números principales:**
  - Resultado neto: $ 4.738.607.
  - Banco: bajó $ 32.038.896 y entraron $ 74,2 M del FCI.
  - Quedan **$ 14.227.479 sin explicar**: stock o compras de otros meses $ 8,55 M, gastos pagados con la Visa o en efectivo $ 3,92 M, cobros de facturas del sistema anterior $ 1,85 M.
- **Las 2 preguntas para Nati** (están en la hoja *Para revisar*): "¿Te sirve este formato (por rubro) o preferís una cascada desde el resultado neto?" y "¿Querés el stock aparte?".
- **Scripts de lectura** (solo leen la base; se corren desde una copia con node_modules y .env.local enlazados), en `…\scratchpad\lect\` de la misma sesión:
  - `cruce-oct.ts` junta los números en `cruce-oct.json`;
  - `excel-cruce.cjs` arma el Excel;
  - `info-oct.ts` saca el bloque informativo de sep–nov;
  - `iibb-cf.ts` y `cheques-cf.ts` sacan el antes y el después de P16 y P07.
- Hasta que Nati lo valide, el cruce **no se lleva al CRM**.

## 4. Avisos para el chat CRM
- **"No son gasto" de Reportes** usa `er.fuera` (`resultado-mes.ts`), que va por lo devengado. No hay que reemplazarlo por el bloque nuevo (`bloqueInformativo`), que va por fecha de pago. Se dejaron separados a propósito para que Reportes no cambie.
- `traerDatosInformativo` (`datos.ts`) es pesado: trae cobros, aplicaciones y pagos con fecha. Lo usa solo la pantalla de Contabilidad, no Reportes ni el Inicio.
- **Visa:** todavía no hay ningún resumen cargado (`tarjeta_consumos` está vacía), así que todo lo de la Visa da 0. Cuando se carguen resúmenes:
  - los cargos (intereses y sellos) suman al resultado;
  - si ya hay un gasto en *Bancos y financieros* con el mismo importe (±$ 1) y fecha cercana (25 días), no se suman;
  - los consumos personales van a Retiros, salvo que ya haya un gasto en *Personales* con el mismo importe y fecha cercana;
  - conviene revisar los primeros números.
- **IIBB neto (P16):** el saldo a favor se arrastra desde `DESDE_IIBB_NETO = 2026-09` y es una estimación: no hay DDJJ del contador. Si un mes tiene su VEP de IIBB cargado en Gastos, el saldo vuelve a 0. **No separar el 6 % por impuesto:** Augusto dijo "no volver a proponerlo".
- **Cheques de Martín F.:** suman en "a cubrir" en todas las pantallas, también en el Cashflow (decisión de Augusto).
- El impuesto de sellos del banco (subtipo `sellos`) ahora va a Gastos bancarios en el Estado de resultados.
- **La carpeta principal `C:\Users\lazza\lazzari` está muy atrasada** respecto de origin/main y tiene muchos cambios sin publicar de otros chats: no hay que publicar desde ahí. Hay que publicar desde una copia limpia de origin/main (`git fetch` + `merge` justo antes) y de a un chat por vez.
- `docs/ESTADO.md`: las entradas que dicen CONTABILIDAD (NATI) de arriba están al día en origin/main, no en la carpeta local.
