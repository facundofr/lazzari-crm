# 06 — Riesgos potenciales

Cosas con fundamento que **no se pudieron demostrar del todo** (veredicto *probable*), más los riesgos que los agentes marcaron sin verificar. Antes de corregirlos hay que validarlos.

### H20 — Pagos de Inga y Porcel de octubre registrados dos veces en Grupo LA (gasto manual + FC pagada) y ninguno mueve Bancos

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Riesgo fundamentado · **Veredicto cruzado:** probable
- **Detectado por:** Revisor cruzado, A3 Finanzas, A2 Compras, A6 Base y seguridad
- **Evidencia:** gastos_manuales 48d20099 (Inga oct US$1.100) y d41a42d0 (Porcel oct $500.000) Grupo LA con nota 'Pagado por Grupo LA desde Galicia el 09/10', sin movimiento; y FC C 00002-00000145 y 0001-00000415 (fecha 01/10) pagadas sin movimiento
- **Causa raíz:** Dos registros independientes del mismo pago, ambos sin movimiento bancario
- **Verificación cruzada:** Datos confirmados; no verifiqué si Reportes/Estado de resultados suma ambos

### H23 — Mismo número de factura de Speed Business pagado dos veces en OP-000044

- **Severidad:** MEDIO · **Tipo:** Error funcional · **Certeza:** Confirmado con datos/ejecución · **Veredicto cruzado:** probable
- **Detectado por:** A2 Compras, A6 Base y seguridad
- **Evidencia:** SELECT: 4240-00004929 tipo transporte, 2 registros pagados, $58.758,64. Migración 20261007113000 permite igual número a propósito y su trigger (ausente en la base) solo compara ids
- **Síntoma:** Una factura posiblemente pagada dos veces.
- **Causa raíz:** Sin aviso de duplicado en Transportes ni al armar la OP
- **Consecuencia:** Posible pago de más de $29.379,32.
- **Solución propuesta (del agente):** Verificar el PDF; aplicar duplicadosComprobanteCompra (lib/saldo-factura-compra) como aviso también en Transportes y al armar la OP. (esfuerzo S)
- **Verificación cruzada:** Puede ser legítimo (dos viajes) o pago doble: necesita ver el PDF

### H27 — Plan de pagos usa la retención calculada al armar el plan

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Riesgo fundamentado · **Veredicto cruzado:** probable
- **Detectado por:** A3 Finanzas
- **Evidencia:** plan-pagos.tsx:322-336 y 386-391 (según A3)
- **Síntoma:** Si entre el armado y el pago hubo otra OP al mismo proveedor en el mes, la retención queda mal.
- **Causa raíz:** Retención depende del acumulado del mes pero se congela antes de pagar
- **Consecuencia:** Se retiene de menos o de más, y el TXT SICORE no cumple el art. 26.
- **Solución propuesta (del agente):** Recalcular base y retención al registrar el pago, o comparar con el acumulado actual y avisar la diferencia. (esfuerzo S)
- **Verificación cruzada:** No re-verificado línea a línea; consistente con H25

### H51 — Dos circuitos de carga de facturas de compra vivos; uno sin control de duplicado

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Riesgo fundamentado · **Veredicto cruzado:** probable
- **Detectado por:** A2 Compras
- **Evidencia:** cargar-factura-oc.tsx:1380-1415 inserts sueltos; carga-masiva-global abierta desde 3 pantallas
- **Síntoma:** Facturas duplicadas o a medias; costos del PR que cambian o no según por dónde se cargó.
- **Causa raíz:** Circuito viejo accesible
- **Consecuencia:** Pagos dobles y deuda inflada.
- **Solución propuesta (del agente):** Toda carga por RPC con control de duplicado (incluye Transportes y Personalización); retirar o adaptar la carga masiva. Revisar con Augusto el caso Speed Business. (esfuerzo M)
- **Verificación cruzada:** Relacionado con H19 y H23; no re-verificado en detalle

### H58 — Consultas sin paginar cerca del límite de 1000 filas (presupuestos, ventas, remitos, stock, agente-mail)

- **Severidad:** MEDIO · **Tipo:** Riesgo estructural · **Certeza:** Riesgo fundamentado · **Veredicto cruzado:** probable
- **Detectado por:** A1 Comercial, A4 Facturación y logística, A5 Integraciones e IA
- **Evidencia:** presupuestos-lista.tsx:990-1002; remitos/page.tsx:267; agente-mail-server.ts:131 .limit(3000) (PostgREST corta en 1000)
- **Síntoma:** Estados parcial/total o facturados incorrectos sin error visible
- **Causa raíz:** Consultas directas sin traerTodo
- **Consecuencia:** Datos truncados en silencio en 3–6 meses
- **Solución propuesta (del agente):** traerTodo + lotes de 150 ids o RPC/vista con el estado ya calculado (esfuerzo S)
- **Verificación cruzada:** Riesgo fundamentado, no ocurre hoy

### H21 — Gastos: alta en dos pasos y borrado físico aunque falle la anulación

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** probable
- **Detectado por:** A3 Finanzas
- **Evidencia:** gastos.tsx:182-190 y 205-212. 3 de los 4 'gastos sin pago' vienen de migraciones que a propósito no crean movimiento (20261016090000 'NO crea movimiento de pago'); solo 'Compra crédito fiscal IVA FC 00005-00019878' sin explicación
- **Causa raíz:** Operación de varios pasos sin transacción
- **Verificación cruzada:** Código confirmado, evidencia de datos refutada (por diseño); el daño del borrado ya está en H15. Bajado de medio a bajo

### H48 — Operaciones multi-paso en pantallas activas (Llegó sin concurrencia, fallback de pago con tarjeta)

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Riesgo fundamentado · **Veredicto cruzado:** probable
- **Detectado por:** A8 Arquitectura y QA, A2 Compras
- **Evidencia:** pago-tarjeta.ts:46-50 solo corre si falta la RPC (faltaFuncion); cargar-factura-oc 'pagada sin movimiento' es por diseño (H19); compras-lazza-llego.tsx:62/81
- **Causa raíz:** Lectura-modificación-escritura en el cliente
- **Verificación cruzada:** El fallback está inactivo hoy; queda el riesgo de concurrencia

### H57 — Ventas asume una sola factura por PR y no muestra restos

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Riesgo fundamentado · **Veredicto cruzado:** probable
- **Detectado por:** A1 Comercial
- **Evidencia:** lib/ventas-etapas.ts etapaVenta; 0 PR con 2 facturas vigentes
- **Síntoma:** Cuando se facture un resto, el saldo de la primera factura deja de verse en Ventas
- **Causa raíz:** Modelo anterior al resto a facturar
- **Consecuencia:** Bandejas Cobrar/Facturar incompletas
- **Solución propuesta (del agente):** Sumar saldo de todas las facturas no anuladas del PR y listar restos pendientes en Facturar (esfuerzo S)
- **Verificación cruzada:** Sin casos hoy; medio → bajo

### H59 — Personalización: editar borra renglones antes de reinsertar; liquidar no es atómico

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** probable
- **Detectado por:** A1 Comercial
- **Evidencia:** personalizacion/page.tsx:317-330, 721-746; 0 trabajos
- **Síntoma:** Si falla el insert en una edición, el trabajo queda sin renglones; dos liquidaciones simultáneas podrían tomar los mismos trabajos
- **Causa raíz:** Multi-paso en el navegador
- **Consecuencia:** Pérdida de datos o doble deuda con el taller
- **Solución propuesta (del agente):** RPC para guardar trabajo y para liquidar, en transacción (esfuerzo M)
- **Verificación cruzada:** No re-verificado; sin uso

### H62 — delete_presupuesto_safe y change_pr_operator sin control de sociedad

- **Severidad:** BAJO · **Tipo:** Riesgo estructural · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** probable
- **Detectado por:** A6 Base y seguridad
- **Evidencia:** Ejecutables por anon pero usan auth.uid (anon falla); sin lz_es_de_sociedad
- **Síntoma:** La función definer saltea la política de borrado.
- **Causa raíz:** Chequeos internos incompletos
- **Consecuencia:** Borrado de presupuestos de otra sociedad o no borrador por API.
- **Solución propuesta (del agente):** Agregar lz_es_de_sociedad y rol. (esfuerzo S)
- **Verificación cruzada:** Parcialmente verificado

### H90 — Bajos y mejoras no re-verificados: API manual acepta NC sin origen, cuit-lookup TLS, lista de precios IA, tope gasto IA, agente mail sin reintento, ARQUITECTURA.md desactualizado, rol por pantalla, stock sin kardex, eje pago OC cliente vs base, código muerto, cobro+saldo a favor en dos transacciones, control de sociedad laxo en pago proveedor, handlePagarOP de Finanzas vieja, CC sin deuda previa, centavos y columnas muertas, muestras sin facturar

- **Severidad:** BAJO · **Tipo:** Mejora / deuda · **Certeza:** Confirmado leyendo el código · **Veredicto cruzado:** probable
- **Detectado por:** A1 Comercial, A2 Compras, A3 Finanzas, A4 Facturación y logística, A5 Integraciones e IA, A7 Flujos y fuentes de verdad, A8 Arquitectura y QA
- **Evidencia:** Ver cada agente; detalle en revision-cruzada.md §3 'Bajos y mejoras'
- **Causa raíz:** Varias (ver causas estructurales)
- **Verificación cruzada:** Severidad baja: no exigían verificación adversarial; se mantienen según evidencia de los agentes

## Riesgos sin consolidar marcados por los agentes (6)

Hallazgos crudos con certeza *riesgo* o *hipótesis*. Muchos quedaron agrupados en H48, H58 o H90; acá se listan tal como los dejó cada agente.

| Agente | Severidad | Título | Evidencia |
|---|---|---|---|
| A1 Comercial | medio | Ventas asume una sola factura por PR y no muestra restos a facturar | lib/ventas-etapas.ts etapaVenta (vigente = última factura no anulada); resto-facturar.ts y emitir-factura-modal.tsx:437 permiten varias facturas por PR. Hoy 0 PR con 2 facturas vigentes y 1 resto pendiente |
| A1 Comercial | medio | Consultas sin paginar que se acercan al límite de 1000 filas | presupuestos-lista.tsx:990 (234 PR, ~120/mes), 1124, 1156 y 1165 (.in remito_items/presupuesto_items; remito_items 363 en 2 meses); ventas/page.tsx:168-190; alertas del dashboard sin limit |
| A1 Comercial | bajo | Doble aprobación puede crear OC duplicadas | chequeo de OC existentes en el navegador presupuestos-lista.tsx:1931 sin restricción en base |
| A2 Compras | bajo | Llegó escribe valores absolutos sin control de concurrencia | compras-lazza-llego.tsx:81 (cantidad_recibida = c.despues calculado al abrir), compras-nueva/page.tsx:514; compras-lazza-llego.tsx:62 no revisa el error del update de estado. |
| A3 Finanzas | medio | Plan de pagos usa la retención calculada al armar el plan | plan-pagos.tsx:322-336 guarda retencion_monto y base_retencion en pagos_lote_items. plan-pagos.tsx:386-391 los manda tal cual al RPC al pagar; solo avisa si cambia el mes (:376-378). |
| A5 Integraciones e IA | bajo | cuit-lookup baja la seguridad TLS de todo el proceso | api/cuit-lookup/route.ts:7-9 (tls.DEFAULT_CIPHERS += ':@SECLEVEL=0'); :411 y :425 devuelven debug al navegador |
