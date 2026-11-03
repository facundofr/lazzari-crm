-- Prueba de 20261028220000_aviso_pr_aprobado_con_sociedad.sql y 20261102230000_aviso_pr_sin_repetidos.sql.
-- Todas las filas tienen que dar ok = true.
-- Cambia un PR de estado DENTRO de una transacción y la deshace al final: no guarda nada.
-- Se elige un PR pendiente en US$ que nunca tuvo avisos de aprobado/rechazado (así lo viejo no cambia la cuenta).
begin;
create temp table _pr on commit drop as
  select p.id, p.numero, p.sociedad_id, p.moneda, p.created_by from public.presupuestos p
  where p.estado = 'pendiente' and p.moneda::text = 'USD' and p.sociedad_id is not null and p.total > 0
    and p.created_by is not null
    and not exists (select 1 from public.alertas a where a.entity_id = p.id and a.title in ('PR aprobado: ' || p.numero, 'PR rechazado: ' || p.numero))
  order by p.created_at desc limit 1;

-- 1) Lo cambia el sistema (sin usuario): aprobar 3 veces = 1 aviso.
update public.presupuestos p set estado = 'aprobado' from _pr where p.id = _pr.id;
update public.presupuestos p set estado = 'pendiente' from _pr where p.id = _pr.id;
update public.presupuestos p set estado = 'aprobado' from _pr where p.id = _pr.id;
update public.presupuestos p set estado = 'pendiente' from _pr where p.id = _pr.id;
update public.presupuestos p set estado = 'aprobado' from _pr where p.id = _pr.id;
create temp table _tres on commit drop as
  select count(*) as n from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR aprobado: ' || _pr.numero;

-- 2) Ya lo leyó: si se vuelve a aprobar, sale otra vez.
update public.alertas a set read = true from _pr where a.entity_id = _pr.id and a.title = 'PR aprobado: ' || _pr.numero;
update public.presupuestos p set estado = 'pendiente' from _pr where p.id = _pr.id;
update public.presupuestos p set estado = 'aprobado' from _pr where p.id = _pr.id;
create temp table _leido on commit drop as
  select count(*) as n from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR aprobado: ' || _pr.numero;

-- 3) Lo rechaza el mismo que creó el PR: no se manda el aviso a sí mismo.
select set_config('request.jwt.claims', json_build_object('sub', _pr.created_by, 'role', 'authenticated')::text, true) from _pr;
update public.presupuestos p set estado = 'rechazado', motivo_rechazo = 'prueba' from _pr where p.id = _pr.id;
create temp table _autor on commit drop as
  select count(*) as n from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR rechazado: ' || _pr.numero;

-- 4) Lo rechaza otro (el sistema): el creador sí lo recibe, con la sociedad del PR.
select set_config('request.jwt.claims', '', true);
update public.presupuestos p set estado = 'pendiente' from _pr where p.id = _pr.id;
update public.presupuestos p set estado = 'rechazado', motivo_rechazo = 'prueba' from _pr where p.id = _pr.id;

select 'Hay un PR para probar' as prueba, (select count(*) from _pr) = 1 as ok
union all
select 'Aprobar 3 veces = 1 aviso', (select n from _tres) = 1
union all
select 'Leído y aprobado de nuevo = sale otro', (select n from _leido) = 2
union all
select 'Quien rechaza su propio PR no recibe el aviso', (select n from _autor) = 0
union all
select 'Aviso de aprobado para el creador, con la sociedad del PR',
       exists (select 1 from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR aprobado: ' || _pr.numero
               and a.sociedad_id = _pr.sociedad_id and a.user_id = _pr.created_by)
union all
select 'Importe con US$ y formato argentino',
       exists (select 1 from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR aprobado: ' || _pr.numero
               and a.description ~ 'aprobado por US\$ [0-9.]+,[0-9]{2}$')
union all
select 'Rechazado por otro: 1 aviso, con la sociedad del PR',
       (select count(*) from public.alertas a, _pr where a.entity_id = _pr.id and a.title = 'PR rechazado: ' || _pr.numero
          and a.sociedad_id = _pr.sociedad_id) = 1;
rollback;
