-- Seguridad: 4 vistas devolvían datos a un visitante SIN login (rol anon).
-- Las vistas corren con permisos de su dueño y saltean el RLS de las tablas.
-- Se les saca el permiso al rol anon. El CRM las lee con el usuario logueado
-- (rol authenticated), que NO cambia: todo sigue funcionando igual.
-- Vuelta atrás: supabase/rollback/20261014130000_cerrar_vistas_anonimo.sql

revoke all on public.v_cuenta_corriente_clientes from anon;
revoke all on public.v_cuenta_corriente_proveedores from anon;
revoke all on public.v_ordenes_compra_progreso from anon;
revoke all on public.v_stock_alertas from anon;
