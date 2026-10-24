-- ID Cheque (CheqID) del banco para los eCheq: identificador único e irrepetible, a diferencia del número de cheque (se puede repetir entre bancos).
-- Cambio aditivo: una columna de texto opcional y un índice único por sociedad (solo donde no es nulo). No toca ningún dato existente.
-- Vuelta atrás: supabase/rollback/20261024120000_echeqs_cheq_id.sql
begin;

alter table public.echeqs add column if not exists cheq_id text;

create unique index if not exists echeqs_sociedad_cheq_id_unique
  on public.echeqs (sociedad_id, cheq_id) where cheq_id is not null;

comment on column public.echeqs.cheq_id is 'CheqID del eCheq (reporte del banco). Identifica al cheque de forma única; el número de cheque solo no alcanza.';

commit;
