-- Prueba de 20261028220000_aviso_pr_aprobado_con_sociedad.sql. Las 3 filas tienen que dar ok = true.
-- Cambia un PR a 'aprobado' y a 'rechazado' DENTRO de una transacción y la deshace al final: no guarda nada.
begin;
create temp table _pr on commit drop as
  select id, numero, sociedad_id, moneda from public.presupuestos
  where estado = 'pendiente' and moneda::text = 'USD' and sociedad_id is not null and total > 0
  order by created_at desc limit 1;
update public.presupuestos p set estado = 'aprobado' from _pr where p.id = _pr.id;
update public.presupuestos p set estado = 'rechazado', motivo_rechazo = 'prueba' from _pr where p.id = _pr.id;
select 'Aviso de aprobado con la sociedad del PR' as prueba,
       exists (select 1 from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR aprobado: ' || _pr.numero
               and a.sociedad_id = _pr.sociedad_id) as ok
union all
select 'Importe con US$ y formato argentino',
       exists (select 1 from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR aprobado: ' || _pr.numero
               and a.description ~ 'aprobado por US\$ [0-9.]+,[0-9]{2}$')
union all
select 'Aviso de rechazado con la sociedad del PR',
       exists (select 1 from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR rechazado: ' || _pr.numero
               and a.sociedad_id = _pr.sociedad_id);
rollback;
