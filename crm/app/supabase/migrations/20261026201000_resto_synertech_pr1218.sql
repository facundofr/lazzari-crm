-- Synertech PR-2026-1218 (Augusto 26/10/2026: "recuperame los items que quedaron sin facturar"):
-- la FA 0015-00000086 facturó 200 de 1.000 respiradores N95 y no llevó las 12 suspensiones H700.
-- Agrega UN resto pendiente con eso (USD 1.671,84 + IVA = USD 2.022,93). No toca la factura ni el PR.
-- Requiere 20261026200000_presupuesto_restos_facturar.sql. Vuelta atrás: supabase/rollback/20261026201000_resto_synertech_pr1218.sql
begin;

insert into public.presupuesto_restos_facturar (sociedad_id, presupuesto_id, factura_id, moneda, items, subtotal, total, created_by)
select p.sociedad_id, p.id, '54b77805-1d94-4862-8390-2803660e2238', 'USD',
  '[{"descripcion": "RESPIRADOR P/ PARTICULAS N95 (3M 8210)", "cantidad": 800, "precio_venta": 1.92, "iva_porcentaje": 21, "total": 1858.56},
    {"descripcion": "SUSPENSION 3M P/ CASCO H700", "cantidad": 12, "precio_venta": 11.32, "iva_porcentaje": 21, "total": 164.37}]'::jsonb,
  1671.84, 2022.93, null
from public.presupuestos p
where p.id = '0ee2ed36-a24f-4967-ba55-9d3f5b8cb078'
  and not exists (select 1 from public.presupuesto_restos_facturar r where r.presupuesto_id = p.id and r.factura_id = '54b77805-1d94-4862-8390-2803660e2238');

commit;
