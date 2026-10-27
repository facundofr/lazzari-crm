-- Prueba de 20261027170000_certificados_retencion.sql (se corre con --probar: muestra resultados y DESHACE todo).
-- Simula a Augusto (con los permisos de la app, no los de administrador de la base) y carga los certificados de IVA de
-- Corteva del 13/10 (cobro en pesos) y del 20/10 (cobro en US$, que no deja cambiar su texto), como «Cargar certificado».
select 'tabla nueva' as control, count(*)::text as valor, 'esperado 0 (vacía)' as nota from public.certificados_retencion
union all select 'permisos', count(*)::text, 'esperado 3' from pg_policies where schemaname = 'public' and tablename = 'certificados_retencion';

select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', true);
set local role authenticated;

insert into public.certificados_retencion (sociedad_id, movimiento_id, numero, fecha, monto, agente_cuit, origen)
select m.sociedad_id, m.id,
       case when m.fecha = '2026-10-13' then '0000-00074701' else '0000-00074762' end,
       m.fecha,
       case when m.fecha = '2026-10-13' then 143060.69 else 1481021.27 end,
       '30636021578', 'ia'
  from public.movimientos m join public.clientes c on c.id = m.cliente_id
 where m.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and m.tipo = 'retencion_iva' and c.cuit = '30636021578'
   and m.fecha in ('2026-10-13', '2026-10-20') and not coalesce(m.anulado, false);

select 'certificados cargados con los permisos de la app' as control, count(*)::text as valor, 'esperado 2' as nota
  from public.certificados_retencion where created_by = 'cb8fdf3e-d171-4042-9da7-248fe863b96d'
union all select 'el del cobro en US$ (20/10)', string_agg(r.numero || ' · ' || r.monto || ' · CRM ' || m.monto, ', '), 'esperado 0000-00074762 · 1481021.27 · CRM 1481021.26'
  from public.certificados_retencion r join public.movimientos m on m.id = r.movimiento_id where m.liquidacion_fx_id is not null;

-- Dos certificados vigentes para la misma retención: se rechaza.
do $$
begin
  insert into public.certificados_retencion (sociedad_id, movimiento_id, numero, origen)
  select sociedad_id, movimiento_id, 'OTRO', 'manual' from public.certificados_retencion limit 1;
  raise exception 'FALLA: aceptó dos certificados vigentes para la misma retención';
exception when unique_violation then null;
end $$;
select 'dos certificados vigentes en una retención' as control, 'rechazado' as valor, 'esperado rechazado' as nota;

-- Un movimiento que no es retención sufrida: se rechaza.
do $$
begin
  insert into public.certificados_retencion (sociedad_id, movimiento_id, numero, origen)
  select sociedad_id, id, '123', 'manual' from public.movimientos
   where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and tipo::text not like 'retencion\_%' limit 1;
  raise exception 'FALLA: aceptó un certificado en un movimiento que no es retención';
exception when raise_exception then
  if sqlerrm like 'FALLA%' then raise; end if;
end $$;
select 'certificado en un movimiento que no es retención' as control, 'rechazado' as valor, 'esperado rechazado' as nota;

-- «Quitar»: no borra, marca anulado; después se puede cargar otro en la misma retención.
update public.certificados_retencion set anulado = true, anulado_at = now(), anulado_por = auth.uid() where numero = '0000-00074701';
insert into public.certificados_retencion (sociedad_id, movimiento_id, numero, origen)
select sociedad_id, movimiento_id, '0000-00074701', 'manual' from public.certificados_retencion where numero = '0000-00074701' and anulado;

reset role;

select 'después de Quitar y volver a cargar' as control,
       count(*) filter (where not anulado) || ' vigentes · ' || count(*) filter (where anulado) || ' anulado' as valor,
       'esperado 2 vigentes · 1 anulado' as nota
  from public.certificados_retencion;
