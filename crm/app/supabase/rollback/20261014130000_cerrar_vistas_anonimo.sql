-- Vuelta atrás de 20261014130000_cerrar_vistas_anonimo.sql
-- (vuelve a abrir las 4 vistas al visitante sin login; usar solo si algo se rompió)

grant select on public.v_cuenta_corriente_clientes to anon;
grant select on public.v_cuenta_corriente_proveedores to anon;
grant select on public.v_ordenes_compra_progreso to anon;
grant select on public.v_stock_alertas to anon;
