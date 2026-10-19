-- Compras Lazza (Augusto 19/10): "En la OC cada artículo tiene su costo en su moneda".
-- Agrega la moneda a cada renglón de la OC. Vacía = la moneda de la OC (como hasta hoy).
-- Llena la columna nueva con la moneda del costo del renglón del PR del que salió (solo donde hay PR atado).
-- Solo AGREGA una columna: no cambia precios, cantidades ni nada de lo que ya existe.
-- Vuelta atrás: supabase/rollback/20261019180000_oc_items_moneda.sql
begin;

alter table public.orden_compra_items
  add column if not exists moneda text check (moneda is null or moneda in ('ARS', 'USD'));

comment on column public.orden_compra_items.moneda is 'Compras Lazza: moneda del precio de este renglón. Vacía = la moneda de la OC.';

update public.orden_compra_items oci
set moneda = pi.costo_moneda
from public.presupuesto_items pi
where oci.presupuesto_item_id = pi.id
  and oci.moneda is null
  and pi.costo_moneda in ('ARS', 'USD');

commit;
