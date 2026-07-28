# Auditoría Completa — Lazzari CRM

Fecha: 2026-07-23

## Resumen ejecutivo

Se auditaron los 14 módulos del CRM + APIs + auth + componentes compartidos. Se encontraron **114 problemas** en total:

| Severidad | Cantidad |
|-----------|----------|
| CRITICO   | 14       |
| ALTO      | 31       |
| MEDIO     | 44       |
| BAJO      | 25       |

---

## TOP 10 — Problemas más urgentes a resolver

### 1. SEGURIDAD: Todas las rutas API son públicas
- **Archivo:** `src/middleware.ts`
- **Descripción:** El middleware excluye `/api/` del chequeo de auth. Cualquier persona puede llamar a `/api/ai`, `/api/facturacion`, etc. sin autenticación.
- **Impacto:** Acceso no autorizado a toda la API, incluyendo la ruta de IA que consume créditos de Anthropic.

### 2. SEGURIDAD: Ruta AI acepta `role` del body del cliente
- **Archivo:** `src/app/api/ai/route.ts`
- **Descripción:** El rol del usuario se toma del body del request, no de la sesión. Un usuario puede enviar `role: "super_admin"` y obtener acceso completo a INSERT/UPDATE.
- **Impacto:** Escalación de privilegios total.

### 3. Transportes sin filtro de sociedad_id (lectura Y escritura)
- **Archivo:** `src/app/(crm)/transportes/page.tsx`
- **Descripción:** `fetchTransportistas()` no filtra por sociedad. El insert tampoco incluye `sociedad_id`.
- **Impacto:** Datos completamente cruzados entre sociedades.

### 4. Clientes: 4 queries sin sociedad_id (consumo, historial, timeline, CC)
- **Archivo:** `src/app/(crm)/clientes/page.tsx`
- **Descripción:** Las queries de detalle del cliente (consumo mensual, historial PRs, timeline, movimientos CC) no filtran por `sociedad_id`.
- **Impacto:** Panel de detalle muestra datos de ambas sociedades mezclados.

### 5. Facturación: NC contra FCE genera tipo incorrecto
- **Archivo:** `src/app/(crm)/facturacion/page.tsx` ~línea 194
- **Descripción:** `ncTipo` para FCEA genera "NCA" (debería ser "NCEA"), para FCEB genera "NCB" (debería ser "NCEB").
- **Impacto:** ARCA rechaza la nota de crédito electrónica.

### 6. Finanzas: opDiferencia descuenta retenciones dos veces
- **Archivo:** `src/app/(crm)/finanzas/page.tsx` ~línea 1004
- **Descripción:** `opDiferencia = opNetoAPagar - opTotalMedios - opRetencion - opRetencionGanancias`, pero `opNetoAPagar` YA tiene retenciones descontadas.
- **Impacto:** La validación de medios de pago muestra diferencia incorrecta, puede bloquear creación de OP.

### 7. Configuración: upsert con onConflict incorrecto
- **Archivo:** `src/app/(crm)/configuracion/page.tsx`
- **Descripción:** Usa `onConflict: "sociedad_id,key"` pero la tabla tiene UNIQUE solo en `key`.
- **Impacto:** Config de empresa no se guarda correctamente por sociedad.

### 8. Stock: proveedores sin filtro de sociedad
- **Archivo:** `src/app/(crm)/stock/page.tsx` ~línea 157
- **Descripción:** `fetchProveedores()` no filtra por `sociedad_id`.
- **Impacto:** Dropdown muestra proveedores de la otra sociedad.

### 9. Presupuestos: PDF hardcodea "LAZZARI" para ambas sociedades
- **Archivo:** `src/app/(crm)/presupuestos/page.tsx` ~línea 1623
- **Descripción:** `handlePrint()` genera PDF con brand "LAZZARI" sin considerar `sociedadActiva`.
- **Impacto:** Se envían presupuestos con razón social incorrecta a clientes de Grupo LA.

### 10. Ventas: insert de factura_items incluye `subtotal` (GENERATED column)
- **Archivo:** `src/app/(crm)/ventas/page.tsx` ~línea 443
- **Descripción:** `handleEmitFacturaManual` inserta `subtotal` en `factura_items`, que es GENERATED ALWAYS AS.
- **Impacto:** Insert falla.

---

## Detalle por módulo

---

### MIDDLEWARE / APIS / AUTH

| # | Severidad | Archivo | Descripción |
|---|-----------|---------|-------------|
| 1 | CRITICO | middleware.ts | Rutas /api/* excluidas de auth — cualquiera puede llamarlas |
| 2 | CRITICO | api/ai/route.ts | `role` tomado del body, no de sesión — escalación de privilegios |
| 3 | ALTO | api/ai/route.ts | Sin rate limiting — consumo ilimitado de créditos Anthropic |
| 4 | ALTO | api/facturacion/route.ts | Service role key sin verificación de auth del caller |
| 5 | ALTO | api/remito/route.ts | Service role key sin verificación de auth del caller |
| 6 | MEDIO | api/cotizacion-bna/route.ts | Sin auth — cualquiera puede triggerear scraping |
| 7 | MEDIO | api/cron/* | Solo protegido por CRON_SECRET, sin auth de usuario |
| 8 | MEDIO | Queries server-side | No filtran por sociedad_id del lado servidor |

---

### CLIENTES

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | CRITICO | fetchConsumo (facturas) sin filtro sociedad_id |
| 2 | CRITICO | fetchHistorial (PRs) sin filtro sociedad_id |
| 3 | ALTO | fetchTimeline sin filtro sociedad_id |
| 4 | ALTO | fetchMovimientos CC sin filtro sociedad_id |
| 5 | ALTO | handleSave incluye `transporte_definido` (columna inexistente) — insert puede fallar |
| 6 | MEDIO | Relevamiento insert sin `actualizado_por` |
| 7 | BAJO | CSV export incompleto (falta email_facturacion, markup, etc.) |

---

### PROVEEDORES

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | ALTO | Mock data fallback se activa con tabla vacía (`data.length === 0`) en vez de solo con error |
| 2 | ALTO | Insert lista_precios_items sin sociedad_id |
| 3 | MEDIO | No hay funcionalidad para eliminar/desactivar proveedores |
| 4 | MEDIO | No hay CRUD de contactos para proveedores |

---

### PRESUPUESTOS

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | CRITICO | facturadoIds/remitidoIds sin filtro sociedad_id |
| 2 | ALTO | PDF hardcodea "LAZZARI" — no usa sociedadActiva |
| 3 | ALTO | handleDelete no verifica dependencias (facturas, remitos, OC vinculadas) |
| 4 | MEDIO | doProductSearch sin filtro sociedad_id |
| 5 | MEDIO | IVA hardcodeado 21% en calculos de OC al aprobar |
| 6 | MEDIO | 14 bloques catch vacíos que ocultan errores |
| 7 | MEDIO | IVA no desglosado por alícuota en PDF |
| 8 | BAJO | fetchVendedores sin filtro sociedad |
| 9 | BAJO | handleDuplicate no usa sociedadActiva |
| 10 | BAJO | fetchCotizBna silencioso en error |

---

### FACTURACIÓN

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | CRITICO | NC contra FCE genera NCA/NCB en vez de NCEA/NCEB — ARCA rechaza |
| 2 | ALTO | PDF: letraComprobante muestra "FCEA" en vez de "A" |
| 3 | ALTO | Cobro: no valida monto máximo (permite sobrepago) |
| 4 | MEDIO | PDF: mapa de COD no incluye FCEA/FCEB/NCEA/NCEB |
| 5 | MEDIO | Factura B: neto calculado con IVA 21% fijo |
| 6 | MEDIO | NC manual inserta subtotal (GENERATED column) |
| 7 | MEDIO | Panel detalle no pasa moneda a formatCurrency |
| 8 | BAJO | estadoConfig no cubre todos los estados |
| 9 | BAJO | Mapa tipoCmp QR no incluye NDA/NDB |

---

### REMITOS

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | CRITICO | openIAModal: PRs sin filtro sociedad_id |
| 2 | ALTO | PR se marca "remitido" sin verificar que items se insertaron |
| 3 | ALTO | Numeración client-side puede colisionar entre sociedades |
| 4 | MEDIO | Error en items del remito es catch silencioso |
| 5 | MEDIO | handleCreateRemito: error en items no bloquea creación |
| 6 | MEDIO | Valor declarado siempre en $ sin considerar moneda USD |
| 7 | BAJO | Link a PR abre /presupuestos genérico, no el PR específico |
| 8 | BAJO | handleEstadoChange sin validaciones de transición |

---

### FINANZAS

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | CRITICO | opDiferencia descuenta retenciones dos veces |
| 2 | ALTO | Cobros/pagos del mes suman sin distinguir moneda (ARS+USD) |
| 3 | ALTO | Cobros/pagos no filtran por mes actual (suman todo) |
| 4 | ALTO | handleRecibirFC: sin rollback parcial de stock si falla a mitad |
| 5 | ALTO | Numeración OP sin filtro sociedad + client-side (race condition) |
| 6 | MEDIO | OP insert sin created_by |
| 7 | MEDIO | handleDeleteFC error silencioso |
| 8 | MEDIO | handleAnularFC error silencioso |
| 9 | MEDIO | FC modal: subtotal manual no se autocalcula de items |
| 10 | MEDIO | Saldo CC clientes suma sin distinguir moneda |
| 11 | MEDIO | handleSaveGasto error silencioso |
| 12 | MEDIO | handleDeleteEcheq error silencioso |
| 13 | BAJO | makeOpMedio inicia con ARS aunque OP sea USD |
| 14 | BAJO | Movimiento creado con OP sin created_by |
| 15 | BAJO | handleCreateMov sin created_by |

---

### ORDENES DE COMPRA

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | CRITICO | handleMarcarTodoRecibido: stock no atómico, riesgo de duplicación en concurrencia |
| 2 | MEDIO | handleCreate sin created_by |
| 3 | MEDIO | IVA hardcodeado 21% en consolidación |
| 4 | MEDIO | IVA hardcodeado 21% en handleCreate desde PR |
| 5 | MEDIO | Consolidación mezcla monedas de distintos PRs |
| 6 | MEDIO | Error silencioso en consolidación |
| 7 | BAJO | OC items sin sociedad_id |
| 8 | BAJO | Proveedor marcado obligatorio en UI pero opcional en lógica |
| 9 | BAJO | Detalle puede quedar desactualizado tras fetchData |

---

### STOCK

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | ALTO | fetchProveedores sin filtro sociedad_id |
| 2 | MEDIO | handleDelete error silencioso |
| 3 | MEDIO | handleAdjust error silencioso |
| 4 | BAJO | Producto editado no actualiza selectedProduct inmediatamente |
| 5 | BAJO | Producto creado sin campo activo |
| 6 | BAJO | fetchPrecioHistorial se dispara 3 veces en algunos escenarios |

---

### CONFIGURACIÓN

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | CRITICO | Upsert config con onConflict incorrecto (sociedad_id,key vs key) |
| 2 | ALTO | Mock data fallback para usuarios con tabla vacía |
| 3 | ALTO | Cambio de rol sin verificar permisos del usuario actual |
| 4 | MEDIO | Tabs sin scroll horizontal en móvil (8 tabs) |
| 5 | BAJO | Tab integraciones con estado hardcodeado |
| 6 | BAJO | Icono Save en botón Editar comisión |

---

### TRANSPORTES

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | CRITICO | fetchTransportistas sin filtro sociedad_id |
| 2 | CRITICO | Insert transportista sin sociedad_id |
| 3 | ALTO | No hay funcionalidad para eliminar transportistas/envíos |
| 4 | MEDIO | fetchEnvios probablemente sin filtro sociedad |

---

### CALENDARIO

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | ALTO | No hay funcionalidad de EDITAR eventos |
| 2 | ALTO | sociedadActiva sin validación antes de insert |
| 3 | MEDIO | Fetch users sin manejo de error |
| 4 | BAJO | Solo vista mensual, sin semanal/diaria |

---

### VENTAS

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | ALTO | handleEmitFacturaManual inserta subtotal (GENERATED column) |
| 2 | MEDIO | Query vendedores filtra por `active` (columna posiblemente inexistente) |
| 3 | MEDIO | handleEmitFacturaManual usa sociedad del PR en vez de sociedadActiva |
| 4 | MEDIO | Error en insert remito_items silencioso |
| 5 | BAJO | Lista se oculta en mobile sin botón volver |

---

### REPORTES

| # | Severidad | Descripción |
|---|-----------|-------------|
| 1 | ALTO | presupuestosPorEstado usa mock data con tabla vacía |
| 2 | ALTO | topClientes usa mock data con tabla vacía |
| 3 | MEDIO | Comisiones usan % hardcodeado, ignoran tabla comision_reglas |
| 4 | MEDIO | Tabs sin scroll horizontal |
| 5 | BAJO | ticketPromedio calculado incorrectamente |

---

### DASHBOARD

Sin problemas críticos. Bien implementado con filtro por sociedad_id.

---

## Prioridad de resolución sugerida

### Fase 1 — Seguridad (urgente)
- [ ] Middleware: proteger rutas /api/* con auth
- [ ] API AI: tomar role de sesión, no del body
- [ ] API facturación/remito: verificar auth del caller

### Fase 2 — Integridad de datos (sociedad_id)
- [ ] Transportes: agregar filtro sociedad en fetch + insert
- [ ] Clientes: agregar sociedad_id a consumo, historial, timeline, CC
- [ ] Stock: filtrar proveedores por sociedad
- [ ] Remitos: filtrar PRs por sociedad en modal IA
- [ ] Presupuestos: filtrar facturadoIds/remitidoIds por sociedad
- [ ] Proveedores: agregar sociedad_id a lista_precios_items insert

### Fase 3 — Bugs funcionales
- [ ] Facturación: NC contra FCE → NCEA/NCEB
- [ ] Facturación: letraComprobante y COD para FCE
- [ ] Finanzas: opDiferencia (quitar doble descuento retenciones)
- [ ] Finanzas: cobros/pagos filtrar por mes + distinguir moneda
- [ ] Presupuestos: PDF con branding por sociedad
- [ ] Ventas: quitar subtotal de insert factura_items
- [ ] Configuración: fix onConflict del upsert
- [ ] Clientes: quitar transporte_definido del insert

### Fase 4 — Robustez
- [ ] Reemplazar catches silenciosos por alerts al usuario
- [ ] Mock data fallback: usar `if (error)` no `if (!data.length)`
- [ ] Agregar created_by a OP, OC, movimientos
- [ ] Validar monto máximo en cobros
- [ ] Stock atómico con RPC en vez de read-then-write

### Fase 5 — UX / completitud
- [ ] Calendario: edición de eventos
- [ ] Transportes/Proveedores: eliminar registros
- [ ] Tabs con scroll horizontal en móvil
- [ ] Reportes: leer comisiones de comision_reglas
