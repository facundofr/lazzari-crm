-- Prueba (se deshace): inserta, lee y borra una fila de seguimiento.
insert into public.presupuesto_seguimiento (sociedad_id, presupuesto_id, tipo, canal, proxima_fecha)
  select sociedad_id, id, 'contacto', 'mail', current_date + 3 from public.presupuestos where estado = 'pendiente' limit 1;
select tipo, canal, proxima_fecha, user_id is null as sin_usuario from public.presupuesto_seguimiento;
select policyname, cmd from pg_policies where tablename = 'presupuesto_seguimiento' order by 1;
