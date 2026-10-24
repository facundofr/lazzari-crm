-- Vuelta atrás de 20261024130000_echeqs_estado_banco.sql
-- Borra las columnas estado_banco y estado_banco_at de echeqs. Si ya se cargaron, se pierden (se pueden volver a cargar desde los reportes de eCheq).
begin;

alter table public.echeqs drop column if exists estado_banco_at;
alter table public.echeqs drop column if exists estado_banco;

commit;
