-- Remitos: anular en vez de borrar. Aditiva: no borra ni cambia nada existente.
-- Un remito anulado queda en la lista (tachado) con su numero, PDF y foto, y deja de contar como remitido/entregado.
alter table public.remitos add column if not exists anulado boolean not null default false;
alter table public.remitos add column if not exists anulado_at timestamptz;
alter table public.remitos add column if not exists anulado_por uuid;
comment on column public.remitos.anulado is 'true = remito anulado (no cuenta como remitido ni entregado; no se borra).';
