-- Personalización borrada (29/10/2026, pedido de Augusto: "borra la tabla esa, no me interesa").
-- La pantalla nunca se usó: las 5 tablas personalizacion_* están vacías (0 filas) y ninguna otra tabla, vista ni función las usa.
-- Si alguna tuviera algo, no se borra nada (la migración se corta).
-- Quedan: la marca de taller en proveedores (es_personalizador, tipo_personalizacion) y las funciones compartidas de los disparadores.
-- Vuelta atrás (las vuelve a crear vacías, igual que antes): supabase/rollback/20261029180000_borrar_tablas_personalizacion.sql
begin;

do $$
declare
  v_t text;
  v_n bigint;
begin
  foreach v_t in array array['personalizacion_items', 'personalizacion_trabajos', 'personalizacion_liquidaciones', 'personalizacion_logos', 'personalizacion_precios'] loop
    execute format('select count(*) from public.%I', v_t) into v_n;
    if v_n > 0 then
      raise exception '% tiene % fila(s): no se borra nada', v_t, v_n;
    end if;
  end loop;
end $$;

drop table public.personalizacion_items;
drop table public.personalizacion_trabajos;
drop table public.personalizacion_liquidaciones;
drop table public.personalizacion_logos;
drop table public.personalizacion_precios;

commit;
