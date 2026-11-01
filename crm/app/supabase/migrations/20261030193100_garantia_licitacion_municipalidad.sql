-- Garantía de una licitación (30/10/2026). Augusto: "el pago a la municipalidad es por mantenimiento de oferta por una licitación".
-- La transferencia del 27/10 a la Municipalidad de Pergamino (CUIT 30-99903451-5, $ 212.950, BBVA CC EPP) no es un gasto: es plata
-- que vuelve cuando termina la licitación. La línea queda explicada ("otro", garantía) y no resta en el resultado; cuando la
-- devuelvan, la entrada se marca "garantía devuelta".
-- Respaldo: lz_backup_garantia_municipalidad_20261030. Vuelta atrás: supabase/rollback/20261030193100_garantia_licitacion_municipalidad.sql
begin;

create table if not exists public.lz_backup_garantia_municipalidad_20261030 (
  id uuid primary key,
  fila jsonb not null,
  creado timestamptz not null default now()
);
alter table public.lz_backup_garantia_municipalidad_20261030 enable row level security;

insert into public.lz_backup_garantia_municipalidad_20261030 (id, fila)
select e.id, to_jsonb(e) from public.extracto_movimientos e where e.id = 'ca613d1f-29b9-4038-9f08-9a3aea17ce64'
on conflict do nothing;

select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);
select public.aplicar_cruces_extracto('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', jsonb_build_array(jsonb_build_object(
  'linea_id', 'ca613d1f-29b9-4038-9f08-9a3aea17ce64', 'clasificacion', 'otro', 'subtipo', 'garantia', 'solo_pendiente', true,
  'nota', 'Garantía de mantenimiento de oferta de una licitación de la Municipalidad de Pergamino ($ 212.950): no es gasto, se devuelve cuando termina la licitación (Augusto 30/10/2026).')))
 where exists (select 1 from public.extracto_movimientos where id = 'ca613d1f-29b9-4038-9f08-9a3aea17ce64' and estado::text = 'pendiente');

commit;
