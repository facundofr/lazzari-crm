-- Prueba (se deshace siempre): crea un PR como lo hace Presupuestos nuevo y guarda los datos de la IA.
create temp table _r as select public.crear_presupuesto_atomico(
  'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'::uuid,
  jsonb_build_object('cliente_id', (select id from public.clientes where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' limit 1),
    'vendedor_id', (select id from public.profiles where email = 'augusto@lazzari.com.ar'), 'created_by', (select id from public.profiles where email = 'augusto@lazzari.com.ar'),
    'fecha', current_date, 'vencimiento', current_date + 30, 'estado', 'pendiente', 'enviado_at', now(), 'markup_general', 30,
    'subtotal', 519, 'iva', 108.99, 'total', 627.99, 'moneda', 'USD', 'tipo_cambio', 1535, 'tipo_cambio_divisas', 1513, 'cotizacion_modalidad', 'divisas',
    'observaciones', '', 'notas_internas', 'prueba', 'tipo_comprobante', null, 'modalidad_emision', 'sin_definir'),
  jsonb_build_array(
    jsonb_build_object('codigo', 'X1', 'descripcion', 'Botin prueba - Talle 42', 'categoria', null, 'cantidad', 10, 'unidad', 'UN', 'precio_costo', 39.56, 'markup_porcentaje', 31.2, 'precio_venta', 51.9, 'iva_porcentaje', 21, 'orden', 1, 'proveedor_id', null, 'stock_propio', false, 'lista_item_id', null, 'proveedor_nombre', 'Delta Plus', 'costo_moneda', 'USD Divisa')
  )
) as id;
update public.presupuestos set origen_pedido = 'texto', ia_armado_at = now(), ia_resumen = 'prueba' where id = (select id from _r);
update public.presupuesto_items set pedido_texto = 'botines talle 42', ia_confianza = 'alta', ia_nota = 'n' where presupuesto_id = (select id from _r) and orden = 1;
select p.numero, p.estado, p.subtotal, p.iva, p.total, p.origen_pedido, i.pedido_texto, i.ia_confianza, i.precio_venta, i.cantidad from public.presupuestos p join public.presupuesto_items i on i.presupuesto_id = p.id where p.id = (select id from _r);
