-- Vuelta atrás de 20261029171000: saca la función (la OC de Compras Lazza vuelve sola al guardado de antes, paso por paso).
begin;
drop function if exists public.guardar_oc_lazza(uuid, uuid, jsonb, boolean);
commit;
