-- Vuelta atras de 20261020100000_remitos_anulado.sql
-- OJO: pierde la marca de cuales remitos estaban anulados (esos remitos pasan a verse como normales).
alter table public.remitos drop column if exists anulado_por;
alter table public.remitos drop column if exists anulado_at;
alter table public.remitos drop column if exists anulado;
