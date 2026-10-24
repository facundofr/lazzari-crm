-- Vuelta atrás de 20261024120000_echeqs_cheq_id.sql
-- Borra el índice y la columna cheq_id de echeqs. Si ya se cargaron ID Cheque, se pierden (se pueden volver a cargar desde los reportes de eCheq).
begin;

drop index if exists public.echeqs_sociedad_cheq_id_unique;
alter table public.echeqs drop column if exists cheq_id;

commit;
