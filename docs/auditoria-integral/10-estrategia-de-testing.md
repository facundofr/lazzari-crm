# 10 — Estrategia de pruebas

Pensada para cómo se trabaja acá: Augusto no programa, los cambios los hace la IA en tandas, se publica directo a producción y la base local es la real.

## 1. Situación actual (medida en la auditoría)

| Qué | Estado |
|---|---|
| `tsc --noEmit` | 0 errores (24 s). Pero los tipos son del 08/10: les faltan más de 60 tablas y hay 550 `supabase as any` en 109 archivos, así que **no protege las consultas** |
| `check-hooks` | 0 errores en 361 archivos; corre en el build |
| Pruebas puras de `src/lib` | 143 de 168 archivos tienen prueba. Las que se corrieron pasan |
| `test:regressions` | **Fallan 13 de 23.** Leen texto de archivos que se mudaron en la mudanza de Finanzas |
| `test:fce` | 10 de 11 pasan; simula ARCA y nunca lo llama |
| ¿Corren al publicar? | **No.** Ninguna prueba está en el build ni hay CI |
| Pruebas de pantallas o de punta a punta | No hay |

**Por qué un cambio rompe otra parte sin que se note:** las reglas están copiadas en varios lugares (C1), las pruebas existentes cubren la copia de `lib` y no las otras (por ejemplo, `test-saldo-factura-compra` protege una función que ninguna pantalla usa), y nada corre automáticamente.

## 2. Estrategia en 4 niveles (de más barato a más caro)

### Nivel 1 — Que las pruebas que ya existen frenen la publicación (Tanda 0)
- Comando `test:lib` con las pruebas puras de `src/lib` (no tocan base, red ni ARCA).
- Sumarlo al `build`, antes de `next build`: si falla una, Vercel no publica.
- Arreglar o retirar las 14 rotas, una por una.

### Nivel 2 — "Casos de oro" por cada regla de plata
Un archivo por regla con 10 a 20 casos fijos y el resultado esperado, escrito en criollo para que Augusto pueda leerlo:

| Regla | Casos mínimos |
|---|---|
| Saldo factura de venta | pago parcial, NC parcial y total, cobro anulado, factura en US$ cobrada en pesos, retenciones sufridas |
| Saldo factura de compra | pago parcial, NC, pagada por otro medio, tarjeta, OP anulada |
| Retención Ganancias | debajo del mínimo, acumulado del mes, OP del Plan vs OP suelta, bienes vs servicios |
| Estado de OC | nada llegó, llegó parcial, llegó todo, se movió un renglón, se editó el PR |
| FA / FB | RI, monotributo, exento, consumidor final |
| Margen | ARS, US$, mezcla, sin TC |

Cuando la regla está copiada en SQL (RPC o trigger), el mismo caso se corre también contra la función SQL en una base de prueba en memoria (PGlite; ya existe `test-fiscal-emission-sql.cjs` con ese patrón). Así se detecta si la pantalla y la base dan distinto.

### Nivel 3 — Chequeos de consistencia de datos de solo lectura (semanales)
Un script `scripts/lectura/salud.cjs` que corra SELECT de solo lectura y liste diferencias, sin corregir nada:
- facturas cuyo estado no coincide con lo cobrado;
- OC "Completo" sin recepción;
- líneas de banco conciliadas contra movimientos anulados;
- renglones de OC o remito sin `presupuesto_item_id`;
- facturas cuyo total no coincide con lo enviado a ARCA;
- proveedores con CUIT repetido.

Los agentes de esta auditoría ya escribieron esas consultas en sus notas. Si una lista crece, avisa: es la mejor alarma temprana para un sistema que se toca seguido.

### Nivel 4 — Prueba de humo en producción después de publicar (sin guardar)
Una lista corta de pantallas para abrir después de cada publicación (Inicio de Finanzas, un PR, una OC, Cuentas corrientes, Facturar) y mirar que carguen sin error y con los mismos números de antes. La puede hacer la IA con el navegador.

## 3. Reglas de trabajo para no volver a romper

1. **Antes de cambiar una regla**, buscar por nombre todas las copias (`grep`) y cambiarlas juntas o unificarlas.
2. **Toda migración regenera los tipos.** Lo que no está en los tipos no se escribe con `as any` en código de plata.
3. **Toda operación que escribe en más de una tabla va en una RPC.**
4. **Cada arreglo de un error suma un caso de oro** que lo reproduce.
5. **Pantalla vieja:** si existe una nueva, la vieja no escribe.

## 4. Qué NO conviene hacer ahora
- Pruebas automáticas de pantallas con navegador (Playwright/Cypress) para todo el CRM: son caras de mantener con pantallas de 5.000 líneas que cambian todas las semanas. Mejor los niveles 1 a 3 y, más adelante, unas pocas pruebas de punta a punta de los circuitos de plata.
- Una base de pruebas separada completa: sería ideal (hoy la compu local usa la real), pero es un cambio de infraestructura. Queda como sugerencia para cuando se estabilice.
