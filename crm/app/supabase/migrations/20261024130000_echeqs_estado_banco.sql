-- Estado del cheque según el banco (ACTIVO, PAGADO, REPUDIADO, CUSTODIA, etc.), tal cual viene en los reportes de eCheq.
-- No reemplaza "estado" (el del CRM, que usan varias pantallas): convive con él. Los cheques físicos o sin reporte quedan vacíos.
-- Cambio aditivo: dos columnas opcionales; no toca ningún dato existente.
-- Vuelta atrás: supabase/rollback/20261024130000_echeqs_estado_banco.sql
begin;

alter table public.echeqs
  add column if not exists estado_banco text,
  add column if not exists estado_banco_at timestamptz;

comment on column public.echeqs.estado_banco is 'Estado según el banco, sin traducir (reporte eCheq). El "estado" del CRM no cambia.';
comment on column public.echeqs.estado_banco_at is 'Cuándo se leyó ese estado del banco.';

commit;
