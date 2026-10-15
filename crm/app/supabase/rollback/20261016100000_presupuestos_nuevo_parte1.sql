-- Vuelta atrás de 20261016100000_presupuestos_nuevo_parte1.sql (pierde lo cargado en esas columnas nuevas).
begin;
drop trigger if exists lz_proteger_prueba_presupuestos on public.profiles;
drop function if exists public.lz_proteger_prueba_presupuestos();
alter table public.profiles drop column if exists prueba_presupuestos_nuevo;
alter table public.presupuestos
  drop column if exists origen_pedido,
  drop column if exists origen_ref,
  drop column if exists ia_armado_at,
  drop column if exists ia_resumen;
alter table public.presupuesto_items
  drop column if exists pedido_texto,
  drop column if exists catalogo_id,
  drop column if exists proveedor_sugerido_id,
  drop column if exists ia_confianza,
  drop column if exists ia_nota;
commit;
