-- Prueba (siempre se deshace): Jero (vendedor) modifica un PR creado por Seba. Tiene que afectar 1 fila.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"41989f6c-4cb0-487a-aa2a-2290a462949f","role":"authenticated"}', true);
with u as (
  update public.presupuestos set observaciones = observaciones where id = '020bb4b1-64c5-48b0-bc2d-213e0dc2f63a' returning id
) select count(*) as filas_que_jero_puede_editar from u;
