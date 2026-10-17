# Traspaso — Remitos (16/10/2026)

## Objetivo
Una sola pantalla de Remitos (mejorando la vieja) y una sola ventana para crear/editar remitos, desde el PR o desde Remitos. Detalle histórico en `docs/ESTADO.md`, bloque "REMITOS: UNA SOLA PANTALLA".

## Terminado y PUBLICADO (todo lo de Remitos está en producción, última versión de este tema: V1.1.511, commit 40606e7)
- **Ventana única** `crm/app/src/components/remito-ventana.tsx`: Remitar desde el PR (Presupuestos), "Nuevo remito" desde Remitos ("Desde un PR" con lista tipo Presupuestos + casilla "Solo con algo por entregar", o "Remito independiente" con catálogo) y "Editar" (mismo número; con CAI avisa que el papel queda distinto, no bloquea).
  - Sucursal (Select de `components/ui/input`; "repartir en varias sucursales" = un remito por sucursal), OC editable (pregunta "solo remito / también PR"; el siguiente remito avisa "en el anterior usaste X"), renglones Artículo · Pedido · Remitar (arranca con lo que falta; pasarse = aviso amarillo), Tipo Con CAI / Sin CAI / Muestra (Select), fecha, observaciones, valor declarado 0 con ✨ sugerido = venta sin IVA, al final Descargar PDF / Enviar por mail.
  - PR "aprobado" con todo remitido → "remitido" (facturado no se toca). El estado "remitido" NO existe en el enum `pr_status` para buscar (bug corregido en V1.1.503).
  - Lista de PR en una sola consulta, guardada por sociedad (2ª vez abre en 0,04 s). Ventana translúcida con renglones grises mientras carga.
- **Pantalla Remitos** `crm/app/src/app/(crm)/remitos/page.tsx`: columnas Fecha · N° remito (igual al PDF: 0018-0000NNNN con CAI, si no R-2026-NNNN) · N° PR · N° OC · Cliente (+sucursal) · Descripción · Tipo · Transporte (solo muestra) · Foto (📷 o subir; IA lee quién recibió, marca entregado y avisa al vendedor) + Editar/PDF/Mail. Todo ordenable, buscador libre sin acentos.
- Lógica: `lib/remitos-crear.ts` (prueba `scripts/test-remitos-crear.ts`), `lib/remito-pdf.ts`, `lib/remitos-armado.ts`, `api/remitos/leer-foto`. PDF se llama "Remito <N°> - <Empresa>.pdf".
- **Remitos nueva ELIMINADA** (pantalla, `api/remitos/instruccion`, menú, casilla). En la base quedan `profiles.prueba_remitos_nueva` y la tabla `remito_respuestas` (no se borra nada).

## Publicado en V1.1.517 (commit 39e7fb4, 17/10/2026, lo publicó el chat de Finanzas)
- PDF con domicilio cambiado / "Retira el cliente" corregido (`entregaPDF` en lib/remito-entrega.ts, usada en lib/remito-pdf.ts; prueba scripts/test-remito-entrega.ts).
- Remito hecho = entregado: sin Marcar/Desmarcar entregado, sin estado ni filtro Estado en Remitos; Dividir remito siempre; foto solo comprobante (la primera avisa al vendedor "Remito firmado: PR-…"); Ventas toma como entregado el PR con remito (lib/ventas-etapas.ts + prueba), sin botón "Entregado"; Clientes muestra el remito como "Entregado". La columna `remitos.estado` queda en la base sin uso.
- Antes: "¿Quién lo lleva?" en V1.1.514/515 (commits 64fcf95 y 86129e2).

## A medias / próximo paso exacto
- Nada a medias. La prueba del PDF con "Retira el cliente" se DESCARTÓ (17/10, Augusto: "Retira el cliente y entregado es lo mismo, solo quiero que quede el registro del remito hecho y nada más, y la posibilidad de poner foto"). No hacer remitos de prueba para eso.

- **VALOR DECLARADO SIEMPRE EN PESOS — HECHO, SIN PUBLICAR (17/10/2026, chat Remitos; tsc 0, hooks OK, `scripts/test-remitos-crear.ts` OK):** en PR en dólares la ventana decía "Valor declarado (US$)" y el ✨ sugería en US$, pero el PDF imprime siempre "$": 9 remitos quedaron con el valor en dólares (ej. R-2026-1087 decía "$ 3.349,13"). Ahora la etiqueta es siempre "$" y el sugerido se pasa a pesos con el dólar BNA guardado del día (billete; si no hay, divisa), mostrando "(US$ X × billete $ Y)"; sin dólar no sugiere (no frena). Lógica `sugeridoEnPesos()` en lib/remitos-crear.ts. Datos viejos: `supabase/migrations/20261017150000_remitos_valor_declarado_pesos.sql` (+ rollback) pasa esos 9 remitos (valor < 10.000 en PR USD) a pesos con el BNA del día del remito. Migración CORRIDA el 17/10 con OK de Augusto y verificada (los 9 en pesos; quedan 0 en US$). **Falta: publicar el cambio de la ventana.**

## Decisiones de Augusto / lo que NO quiere
- Remito = registro de lo entregado + foto opcional. "Retira el cliente" es lo mismo que entregado; no es un detalle que necesite (17/10).
- Nada de botón "Parcial" de remito (el caso "salió 10, recibió 3 por el transporte" no le interesa). Parcial = PR pidió 10, remitimos 5.
- El remito se hace para entregar: no hay estado "sin entregar" ni avisos por días (16/10).
- Sin columnas Items, Entregado, Llegó, Falta; sin botones "Todo lo que falta / Solo lo que llegó / Todo en 0". Sin amarillo por días sin foto.
- Desplegables como Presupuestos (`Select` de `ui/input`), no botones ni `<select>` nativo ni buscador para listas cortas.
- Nunca bloquear: avisos amarillos.
- Remitos con CAI nunca se prueban desde local (gastan número real de ARCA; van 77 de 5000). Pruebas en producción: Sin CAI, en PR de Augusto, y borrar después.
- Publicar: ver antes si otro chat publica; si falla el push, NO hacer `vercel --prod`.

## Migraciones pendientes
- Ninguna de Remitos. (Corrida antes: `20261016140000_remitos_nueva_parte1.sql`, con rollback.)

## Errores conocidos
- `vercel --prod` a veces da "Not authorized": reintentar desde copia limpia. `publicar-limpio.sh` no aplica borrados de archivos.
- En local el servidor de :3000 puede quedar con "Internal Server Error" si otro chat usa el mismo `.next`.
- Quedan fotos de prueba sin uso en `comprobantes/remitos/` (2). Número interno R-2026-1083, R-2026-1089 y R-2026-1090 salteados (pruebas borradas).

## Ideas para después
- Foto del remito firmado: probarla con una foto real de un cliente (ya no cambia el estado).
- (Descartado) avisos de remitos +30 días sin entregar: el remito se hace para entregar, no se le cambia el estado.
