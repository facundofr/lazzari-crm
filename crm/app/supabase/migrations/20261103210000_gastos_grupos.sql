-- Pestañas (grupos) de Finanzas › Gastos editables (Augusto 03/11/2026: "dejame que pueda crear una pestaña nueva y ponerle con
-- el nombre que yo quiera, o editar las que están ahí, así Nati puede reordenar toda la parte de reportes, contabilidad y gastos").
-- 1. Tabla nueva gastos_grupos: una fila por pestaña y por sociedad (clave guardada en los gastos, nombre que se ve, orden,
--    a qué línea del Estado de resultados va, oculta). `linea` null = la regla de siempre (lib/contabilidad clasificarGasto);
--    solo las pestañas de base la tienen en null. Arranca con las 9 de hoy, mismos nombres ("Sueldos", "Augusto") y mismas reglas:
--    ningún número cambia.
-- 2. Los checks gastos_manuales_grupo_check y gastos_fijos_grupo_check limitaban `grupo` a las 8 de siempre: se sacan para que un
--    gasto pueda ir a una pestaña nueva (la pantalla solo ofrece las pestañas de esta tabla). No toca ningún gasto.
-- Vuelta atrás: supabase/rollback/20261103210000_gastos_grupos.sql
begin;

create table if not exists public.gastos_grupos (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  clave text not null check (btrim(clave) <> ''),
  nombre text not null check (btrim(nombre) <> ''),
  orden integer not null default 0,
  linea text check (linea is null or linea in (
    'compras_sin_factura', 'credito_fiscal_iva', 'colaboradores_lsj', 'comisiones', 'consultoria', 'colaborador_m',
    'administrativos', 'bancarios', 'intereses', 'transportes', 'retiros', 'impuestos_pago')),
  oculto boolean not null default false,
  base boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sociedad_id, clave)
);

alter table public.gastos_grupos enable row level security;
drop policy if exists gastos_grupos_select on public.gastos_grupos;
create policy gastos_grupos_select on public.gastos_grupos for select using (true);
drop policy if exists gastos_grupos_all on public.gastos_grupos;
create policy gastos_grupos_all on public.gastos_grupos for all
  using (lz_tiene_rol(array['super_admin', 'admin', 'administrativo']))
  with check (lz_tiene_rol(array['super_admin', 'admin', 'administrativo']));

-- Las 9 de hoy, en el orden de la pantalla, para cada sociedad.
insert into public.gastos_grupos (sociedad_id, clave, nombre, orden, base)
select s.id, g.clave, g.nombre, g.orden, true
from public.sociedades s
cross join (values
  ('Personal', 'Sueldos', 1), ('Premios', 'Premios', 2), ('Transportes', 'Transportes', 3), ('Local y servicios', 'Local y servicios', 4),
  ('Profesionales', 'Profesionales', 5), ('Impuestos', 'Impuestos', 6), ('Bancos y financieros', 'Bancos y financieros', 7),
  ('Operativos', 'Operativos', 8), ('Personales', 'Augusto', 9)
) as g(clave, nombre, orden)
on conflict (sociedad_id, clave) do nothing;

alter table public.gastos_manuales drop constraint if exists gastos_manuales_grupo_check;
alter table public.gastos_fijos drop constraint if exists gastos_fijos_grupo_check;

comment on table public.gastos_grupos is
  'Pestañas de Finanzas › Gastos por sociedad (03/11/2026). linea null = regla de siempre de clasificarGasto (lib/contabilidad).';

commit;
