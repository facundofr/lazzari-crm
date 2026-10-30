-- Los proveedores con el tilde Transporte tenían el rubro escrito de tres maneras ("Transporte", vacío y sin dato).
-- Se unifica en "Transporte" solo para los que lo tienen vacío o sin dato. El rubro es una etiqueta: no cambia números. Aditivo.
-- Vuelta atrás: supabase/rollback/20261030151000_proveedores_transportistas_rubro_transporte.sql
begin;
update public.proveedores set rubro = 'Transporte'
where es_transportista and coalesce(trim(rubro), '') = '';
commit;
