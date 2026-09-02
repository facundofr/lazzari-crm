alter table public.ordenes_compra
  add column if not exists estado_pago text not null default 'pendiente',
  add column if not exists medio_pago text,
  add column if not exists pagada_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ordenes_compra'::regclass
      and conname = 'ordenes_compra_estado_pago_check'
  ) then
    alter table public.ordenes_compra
      add constraint ordenes_compra_estado_pago_check
      check (estado_pago in ('pendiente', 'pagada'));
  end if;
end
$$;

create index if not exists ordenes_compra_estado_pago_idx
  on public.ordenes_compra(sociedad_id, estado_pago);

insert into public.proveedores (
  razon_social,
  cuit,
  condicion_iva,
  rubro,
  forma_pago,
  dias_cuenta_corriente,
  limite_credito,
  activo,
  sociedad_id,
  notas
)
select
  'MERCADO LIBRE',
  '30703088534',
  'RI'::public.condicion_iva_type,
  'Marketplace',
  'Tarjeta',
  0,
  0,
  true,
  sociedades_objetivo.sociedad_id,
  'Compras abonadas con tarjeta al momento de emitir la OC'
from (
  values
    ('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'::uuid),
    ('fee94607-747a-4e87-ba24-aff9032f7a56'::uuid)
) as sociedades_objetivo(sociedad_id)
where not exists (
  select 1
  from public.proveedores
  where sociedad_id = sociedades_objetivo.sociedad_id
    and lower(razon_social) = 'mercado libre'
);
