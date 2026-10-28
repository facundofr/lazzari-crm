# 01 — Resumen ejecutivo

**Auditoría integral del CRM Lazzari — 28/10/2026 (versión V1.1.595)**
Hecha por 9 agentes (8 por área y 1 revisor cruzado), en solo lectura: no se cambió nada del sistema ni de la base, y no se llamó a ARCA ni a otros servicios.

## Conclusión en una línea

**El CRM tiene problemas estructurales reales, pero localizados.** Lo más delicado (cobros, órdenes de pago, emisión en ARCA) está bien construido. Los errores que "se mudan" de un módulo a otro tienen causas concretas que se pueden corregir sin reescribir el sistema.

## Números

- 103 hallazgos crudos → **62 consolidados**: **51 confirmados** y **11 probables**. Ninguno quedó en "crítico" después de la revisión cruzada: **11 altos**, 30 medios y 21 bajos.
- 86 módulos y submódulos revisados: 30 con confiabilidad alta, 46 media y 10 baja.
- 100 conexiones entre módulos: 34 incompatibles, 34 dudosas y 32 coherentes.

## Respuestas a las 12 preguntas

**1. ¿Tiene problemas estructurales reales?**
Sí. Son 8 causas ([07-causas-raiz.md](07-causas-raiz.md)), y las tres que más pesan son:
- la misma regla copiada en varios lugares;
- el mismo dato guardado en dos lugares que no siempre coinciden;
- operaciones de varios pasos que se hacen desde la pantalla y pueden quedar a medias.

**2. ¿Cuáles son los más importantes?**
- **Seguridad (H01–H05):** con la clave pública que baja cualquier navegador se pueden leer facturas pendientes y presupuestos, escribir la cotización del dólar y listar comprobantes y facturas de compra guardadas. Además, en las tablas viejas la separación entre Lazzari y Grupo LA está solo en la pantalla, no en la base.
- **Editar un PR corta sus vínculos (H06):** se borran y recrean los renglones, y ya hay 35 renglones de OC y 47 de remito sueltos.
- **PR rechazado no avisa a Compras (H09):** hay 4 OC recibidas y pagadas de PR rechazados, por ≈ $19,1 M.
- **Anular un cobro deja el banco "conciliado" (H15)** contra un movimiento anulado.
- **Cta. Cte. del cliente (H08):** cuenta las NC como deuda y no descuenta cobros parciales. Esa pantalla se copia y se manda al cliente.
- **Factura común autorizada por ARCA sin recuperación (H13)** si falla el guardado.
- **Las pruebas automáticas están rotas y no corren al publicar (H16).**

**3. ¿Qué módulos están bien?**
Cobros (RPC atómicas, 0 diferencias entre estado y cálculo), órdenes de pago (idempotentes, con retención congelada), emisión ARCA (reserva por intento, lock por PV), NC, conciliación de compras, BCRA, ficha 360, pendientes, el asistente con Deshacer y toda la IA (nunca guarda sola).

**4. ¿Cuáles están desconectados o mal integrados?**
- PR ↔ Compras (renglones y venta caída).
- Cobros/gastos ↔ conciliación bancaria.
- Factura de compra ↔ Finanzas/OP/Plan de pagos (7 cálculos del saldo).
- Cta. Cte. y Consumo del cliente ↔ la regla de saldo.
- Las pantallas viejas (finanzas-vieja, ordenes-compra), que siguen escribiendo con sus reglas.

**5. ¿Estamos duplicando lógica de negocio?**
Sí. El saldo de factura de compra está en 7 lugares, el de factura de venta en 6, el estado de la OC en 4, el margen en 3, y la retención, FA/FB, la cotización y el saldo a favor en 2 cada uno.

**6. ¿Hay distintas fuentes de verdad?**
Sí, al menos 5 datos están guardados dos veces:
- el estado de la factura de compra;
- el estado de la OC;
- el saldo del cliente;
- el total de la factura (difiere en 1–2 centavos de lo autorizado por ARCA en 20 de 120);
- el "conciliado" del banco.

**7. ¿Por qué corregir algo rompe otra cosa?**
Porque se corrige una copia de la regla y las otras siguen con la vieja. Además, ninguna prueba corre al publicar, y los tipos de la base están desactualizados, así que el sistema no avisa cuando algo queda inconsistente.

**8. ¿Qué procesos son los más vulnerables?**
1. Presupuesto → OC → remito (edición y rechazo del PR).
2. Saldo de facturas de compra al pagar.
3. Conciliación bancaria cuando se anula algo.
4. Facturación común si falla el guardado.

**9. ¿Qué corregir primero?**
- **Tanda 0:** que las pruebas que ya existen frenen la publicación.
- **Tanda 1:** cerrar el acceso anónimo en la base.
- **Tanda 2:** los arreglos de plata que hoy dan mal (Cta. Cte. del cliente, banco al anular, casos puntuales de pagos que hay que revisar con vos).

Detalle en [09-plan-de-correccion.md](09-plan-de-correccion.md).

**10. ¿Qué evitaría que vuelva a pasar?**
- Una función única por regla de plata, con "casos de oro".
- Toda operación que escribe en más de una tabla, en una RPC.
- Las pantallas viejas en solo lectura.
- Los tipos regenerados con cada migración.
- Un chequeo semanal de consistencia de solo lectura.

Detalle en [10-estrategia-de-testing.md](10-estrategia-de-testing.md).

**11. ¿Cuánto esfuerzo implica estabilizar?**
- Lo urgente (tandas 0–2): ≈ 1,5 a 2 semanas de trabajo con IA.
- Lo estructural (tandas 3–5): ≈ 3 a 4 semanas.
- El resto, sin apuro.

**12. ¿Se puede seguir desarrollando sobre esta arquitectura?**
**Sí.** No hace falta reescribir. Hay que intervenir tres puntos:
- la seguridad en la base;
- las reglas de plata duplicadas;
- el circuito PR → OC.

Y hay que poner una red de pruebas mínima. Mientras tanto, conviene que cada cambio nuevo de plata use las funciones de `lib` existentes en vez de calcular por su cuenta.

## Índice

| Archivo | Contenido |
|---|---|
| [02-mapa-arquitectura.md](02-mapa-arquitectura.md) | Tecnologías, módulos, diagramas y conexiones faltantes |
| [03-auditoria-modulos.md](03-auditoria-modulos.md) | Confiabilidad de cada módulo (los 15 puntos de cada uno, en `trabajo/`) |
| [04-auditoria-integraciones.md](04-auditoria-integraciones.md) | ARCA, IA, BCRA, BNA, mail, Storage, crons e integraciones internas |
| [05-problemas-confirmados.md](05-problemas-confirmados.md) | 51 hallazgos con evidencia |
| [06-riesgos-potenciales.md](06-riesgos-potenciales.md) | 11 probables y riesgos sin verificar |
| [07-causas-raiz.md](07-causas-raiz.md) | Las 8 causas estructurales |
| [08-matriz-dependencias.md](08-matriz-dependencias.md) | Matriz entre procesos y fuentes de verdad |
| [09-plan-de-correccion.md](09-plan-de-correccion.md) | Tandas ordenadas por riesgo |
| [10-estrategia-de-testing.md](10-estrategia-de-testing.md) | Cómo evitar regresiones |
| [11-limitaciones-auditoria.md](11-limitaciones-auditoria.md) | Qué no se pudo ver y nivel de confianza |
| [12-informe-agentes.md](12-informe-agentes.md) | Qué hizo cada agente y cómo se resolvieron sus contradicciones |
| `trabajo/` | Notas completas de los 9 agentes (evidencia, consultas, 15 puntos por módulo) |
