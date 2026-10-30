-- Vuelta atrás de 20261029160000_transportistas_destinos.sql (borra lo que se haya escrito en destinos)
alter table public.transportistas drop column if exists destinos;
