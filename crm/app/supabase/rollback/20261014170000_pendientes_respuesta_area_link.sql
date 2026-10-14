-- Vuelta atrás de 20261014170000. ⚠️ Se pierden las respuestas escritas en Pendientes (copiarlas antes con "Copiar respuestas").
begin;
alter table public.pendientes drop constraint if exists pendientes_tipo_check;
alter table public.pendientes drop column if exists tipo;
alter table public.pendientes drop column if exists link;
alter table public.pendientes drop column if exists area;
alter table public.pendientes drop column if exists respuesta;
commit;
