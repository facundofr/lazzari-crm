-- Vuelta atrás de 20261030190000_comision_cheques_del_banco.sql: vuelven el gasto cargado a mano, su pago (sin anular, cruzado
-- con la comisión) y las 2 líneas del banco tal como estaban, desde lz_backup_comision_cheques_20261030.
begin;

insert into public.gastos_manuales
select * from jsonb_populate_record(null::public.gastos_manuales,
  (select fila from public.lz_backup_comision_cheques_20261030 where que = 'gasto'))
on conflict (id) do nothing;

-- El pago anulado se reemplaza por la fila guardada (mismo id). Primero se sueltan las líneas que lo apunten.
update public.extracto_movimientos set match_movimiento_id = null
 where match_movimiento_id = '846e2040-6a8d-4a46-af30-e3442062ab0c';
delete from public.movimientos
 where id = '846e2040-6a8d-4a46-af30-e3442062ab0c'
   and exists (select 1 from public.lz_backup_comision_cheques_20261030 where que = 'pago');
insert into public.movimientos
select * from jsonb_populate_record(null::public.movimientos,
  (select fila from public.lz_backup_comision_cheques_20261030 where que = 'pago'))
on conflict (id) do nothing;

update public.extracto_movimientos e
   set estado = r.estado, clasificacion = r.clasificacion, subtipo = r.subtipo, match_movimiento_id = r.match_movimiento_id, nota = r.nota
  from public.lz_backup_comision_cheques_20261030 b, jsonb_populate_record(null::public.extracto_movimientos, b.fila) r
 where b.que in ('linea_comision', 'linea_iva') and e.id = r.id;

commit;
