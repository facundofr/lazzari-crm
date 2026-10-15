-- Vuelta atrás de 20261015130000_compras_piloto_parte1.sql (pierde lo cargado en esas columnas nuevas).
begin;
drop trigger if exists lz_proteger_prueba_compras on public.profiles;
drop function if exists public.lz_proteger_prueba_compras();
alter table public.profiles drop column if exists prueba_compras_nueva;
drop index if exists public.idx_oc_items_pr_item;
alter table public.orden_compra_items drop column if exists presupuesto_item_id;
alter table public.ordenes_compra
  drop column if exists pedido_at,
  drop column if exists pedido_via,
  drop column if exists pedido_por,
  drop column if exists nota_ia;
commit;
