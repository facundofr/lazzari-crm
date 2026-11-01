-- Auditoría de la plata, Tanda C, Etapa 0 del banco simple (30/10/2026; Augusto: "Sí, dale a todo"). Solo vínculos: no cambia
-- montos, fechas, gastos ni el resultado.
-- 1. Transferencias que pagaron varios gastos (hoy "ignoradas" con nota porque una línea no se podía atar a varios movimientos):
--    06/10 José Alvarez $ 560.000 = comisión septiembre 303.048,74 + interés octubre 150.000 + viajes septiembre 106.951,26;
--    07/10 Jerónimo $ 589.100 y Mariana $ 589.100 = premio agosto 400.000 + monotributo 61.100 + mutual 128.000 c/u;
--    07/10 Sebastián $ 400.000 = premio agosto. Cada línea queda cruzada con todos sus pagos (los pagos apuntan a la línea).
-- 2. Vínculo de los dos lados: 130 líneas cruzadas con un movimiento que no apuntaba a su línea (movimientos.extracto_movimiento_id).
-- 3. Se cierran ("descartada") las propuestas viejas de la IA cuya línea ya está resuelta.
-- Respaldo: lz_backup_banco_vinculos_20261030. Vuelta atrás: supabase/rollback/20261030191000_banco_vinculos.sql
begin;

create table if not exists public.lz_backup_banco_vinculos_20261030 (
  tabla text not null,
  id uuid not null,
  fila jsonb not null,
  creado timestamptz not null default now(),
  primary key (tabla, id)
);
alter table public.lz_backup_banco_vinculos_20261030 enable row level security;

create temp table _vinc (linea uuid, pago uuid, orden int) on commit drop;
insert into _vinc values
  ('6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a', '01c77bf8-5112-4040-a38b-00a6d8c03e46', 1),
  ('6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a', '16ff05ef-48e4-46e0-95e2-f1d73163753e', 2),
  ('6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a', 'e182a4ba-029a-4101-a653-a9007bdd0c0e', 3),
  ('1a22e8f6-3a75-4d60-8936-9ca31046a71e', '280adfe0-face-4b65-9344-8cc820039a8b', 1),
  ('1a22e8f6-3a75-4d60-8936-9ca31046a71e', 'c282fce6-ce37-4c3f-b077-c786efbf21d6', 2),
  ('1a22e8f6-3a75-4d60-8936-9ca31046a71e', '464ad006-54e9-42b4-a66d-70d76be3c718', 3),
  ('3eff963e-9084-4788-aba4-f373a91e7d1f', '4e36dd3a-2f50-4884-86fe-9e672221e0ba', 1),
  ('3eff963e-9084-4788-aba4-f373a91e7d1f', 'ae33d9db-d11e-45f8-b053-1107962cc5da', 2),
  ('3eff963e-9084-4788-aba4-f373a91e7d1f', '48f4f60a-a3ed-48fd-9f75-548b8f87553d', 3),
  ('020d8e52-52c1-4850-bcf2-716b7cb59832', 'ee38acef-8e6a-4bcd-9ba7-141b51fff8a6', 1);

-- Control: cada línea tiene que sumar exacto con sus pagos (si no, no se toca nada).
do $$
begin
  if exists (
    select 1 from _vinc v join public.extracto_movimientos e on e.id = v.linea join public.movimientos m on m.id = v.pago
    group by v.linea, e.monto having round(sum(m.monto), 2) <> round(e.monto, 2) or bool_or(coalesce(m.anulado, false))
  ) then
    raise exception 'Alguna transferencia no suma exacto con sus pagos: no se cambia nada';
  end if;
end $$;

-- Respaldo de todo lo que se toca.
insert into public.lz_backup_banco_vinculos_20261030 (tabla, id, fila)
select 'extracto_movimientos', e.id, to_jsonb(e) from public.extracto_movimientos e where e.id in (select linea from _vinc)
on conflict do nothing;
insert into public.lz_backup_banco_vinculos_20261030 (tabla, id, fila)
select 'movimientos', m.id, to_jsonb(m) from public.movimientos m
 where m.id in (select pago from _vinc)
    or (m.extracto_movimiento_id is null and not coalesce(m.anulado, false)
        and exists (select 1 from public.extracto_movimientos e where e.match_movimiento_id = m.id))
on conflict do nothing;
insert into public.lz_backup_banco_vinculos_20261030 (tabla, id, fila)
select 'finanzas_propuestas', p.id, to_jsonb(p) from public.finanzas_propuestas p
  join public.extracto_movimientos e on e.id = p.linea_id
 where p.estado = 'propuesta' and e.estado::text <> 'pendiente'
on conflict do nothing;

-- 1. Las 4 líneas, cruzadas con todos sus pagos.
update public.movimientos m
   set extracto_movimiento_id = v.linea,
       conciliado = true,
       conciliado_at = coalesce(m.conciliado_at, now()),
       conciliado_por = coalesce(m.conciliado_por, (select id from public.profiles where email = 'augusto@lazzari.com.ar'))
  from _vinc v
 where m.id = v.pago and m.extracto_movimiento_id is null;
update public.extracto_movimientos e
   set estado = 'matcheado',
       match_movimiento_id = v.pago,
       clasificado_at = now(),
       nota = concat_ws(' ', nullif(e.nota, ''), '· Cruzada con sus ' || (select count(*) from _vinc x where x.linea = e.id) || ' pagos (banco simple, 30/10/2026).')
  from _vinc v
 where e.id = v.linea and v.orden = 1 and e.estado::text = 'ignorado';

-- 2. Vínculo de los dos lados.
update public.movimientos m
   set extracto_movimiento_id = e.id
  from public.extracto_movimientos e
 where e.match_movimiento_id = m.id and m.extracto_movimiento_id is null and not coalesce(m.anulado, false);

-- 3. Propuestas viejas de la IA con su línea ya resuelta.
update public.finanzas_propuestas p
   set estado = 'descartada',
       motivo = concat_ws(' · ', nullif(p.motivo, ''), 'Cerrada: la línea ya estaba resuelta (banco simple, 30/10/2026).'),
       resuelto_at = now()
  from public.extracto_movimientos e
 where e.id = p.linea_id and p.estado = 'propuesta' and e.estado::text <> 'pendiente';

commit;
