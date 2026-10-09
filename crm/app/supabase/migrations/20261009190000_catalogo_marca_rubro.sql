-- Agrega marca y rubro al catálogo de costos (columnas opcionales del CSV del chat de listas).
alter table public.catalogo_costos add column if not exists marca text;
alter table public.catalogo_costos add column if not exists rubro text;
create index if not exists catalogo_costos_marca_idx on public.catalogo_costos (marca);
