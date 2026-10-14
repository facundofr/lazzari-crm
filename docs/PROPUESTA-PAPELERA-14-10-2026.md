# Propuesta: "Para revisar" / Papelera para OC, clientes y proveedores

Armada la noche del 14/10/2026 para que Augusto la apruebe. **No se tocó código ni base: esto es solo el plan.**
Motivo: la idea 8 no tenía detalle escrito en ningún archivo, y borrar OC con facturas vinculadas toca plata. No quise adivinar.

## Cómo está hoy
- **Papelera** (`/papelera`): lista presupuestos eliminados (`eliminado = true`), y solo los presupuestos se pueden recuperar. Muestra también OC, facturas y OP, pero solo para mirar.
- **Clientes y proveedores** (V1.1.425): "Eliminar" pide motivo y guarda copia completa en la tabla `registros_eliminados` (si tiene historial se desactiva, si no se borra). Esa copia **no se ve en la Papelera** y no se puede recuperar desde la pantalla.
- **OC**: "Eliminar" borra de verdad (renglones y OC). Si tiene facturas vinculadas, avisa y no deja. No hay forma de recuperarla.

## Propuesta (de menor a mayor riesgo)
1. **Clientes y proveedores en la Papelera (riesgo bajo, sin migración).** La Papelera lee `registros_eliminados` y muestra: tipo, nombre, motivo, quién y cuándo. Botón "Recuperar":
   - si fue "desactivado" → vuelve a activo (un `update`);
   - si fue "eliminado" → se vuelve a crear desde la copia guardada (`datos`), con el mismo id.
2. **OC a la Papelera en vez de borrarla (riesgo medio, migración aditiva).** Columnas nuevas en `ordenes_compra`: `eliminada boolean default false`, `eliminada_motivo`, `eliminada_at`, `eliminada_por`. "Eliminar" pasa a marcarla (pide motivo, como en clientes) y se esconde de Compras. Se recupera desde la Papelera. Con su script de vuelta atrás en `supabase/rollback/`.
3. **OC con facturas vinculadas (riesgo alto, necesita tu decisión).** Hoy no se puede borrar y es lo correcto: la factura de compra y su pago dependen de la OC. Opciones:
   - **A (recomendada):** que se pueda mandar a la Papelera **sin tocar las facturas** (la OC se esconde, las facturas siguen y se ven desde Facturas/Finanzas), y avisar en amarillo "esta OC tiene N facturas vinculadas". Es un aviso, nunca un bloqueo.
   - **B:** seguir sin permitirlo y que el vendedor anule la factura primero.

## Preguntas para Augusto (respondé con la letra)
- ¿Está bien el orden 1, 2, 3?
- Punto 3: ¿opción **A** o **B**?
- ¿Quién puede recuperar algo de la Papelera? Sugerencia: solo administración (super_admin, admin, administrativo).

## Lo que hay que correr si se aprueba
- Una migración (solo el punto 2) en el SQL Editor, con su vuelta atrás. Los puntos 1 y 3 son solo código.
- Prueba antes de publicar: en local, **sin guardar**, mirando la Papelera con los datos reales.
