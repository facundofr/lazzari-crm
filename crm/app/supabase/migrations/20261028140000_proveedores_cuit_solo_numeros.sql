-- Proveedores: CUIT solo con números (auditoría integral 28/10/2026, H24; Augusto: "Sí, dale").
-- Con guiones el índice único (cuit, sociedad_id) no los veía iguales y se colaron fichas repetidas.
-- Desde esta versión el alta y la edición guardan solo números y avisan si el CUIT ya existe.
--   1. A los 12 proveedores de Lazzari que tienen guiones o espacios en el CUIT se les dejan solo los números.
--   2. Las 2 fichas repetidas (NESTLE ARGENTINA S A 30-54676404-0 y FERNANDEZ ANDRES ALBERTO 20-25294635-8, cargadas
--      en septiembre) quedan INACTIVAS: no tienen facturas, OC ni OP; la ficha buena de cada uno (sin guiones) sigue igual.
--      No se borra nada y el CUIT de esas 2 queda como estaba.
-- Vuelta atrás: supabase/rollback/20261028140000_proveedores_cuit_solo_numeros.sql
begin;

update public.proveedores
set cuit = regexp_replace(cuit, '\D', '', 'g')
where id in (
  '3853ce96-c24d-4fa3-9602-7cdf7ea88bd4', -- AMOBLAMIENTOS NEXO
  '07950ef3-0e57-416a-8d07-764dd56d3259', -- BIOMED MEDICAL DEVICES
  '44f56fdc-c0ab-460d-b460-17b0d4c1bbcf', -- CASELLA FRANCISCO JAVIER
  '8bb47420-1272-498e-b340-ab10b955fea1', -- COSMACA SRL
  '40f36974-c031-4692-9312-71a21db88ee4', -- DUHAU DALBY MERCEDES
  '177bf686-3e45-4d49-a644-b1b6990439f7', -- FRAVEGA SACIEI
  'b9f9b907-38ff-41f9-85fa-08147407f435', -- HORNI MIGUEL EDGARDO
  '894a18e3-404c-4857-ae71-7032440f0d57', -- INMUOVI
  '5a606d8d-6880-4113-abd7-e6f40bb86bfc', -- MOLIVA NEUMATICOS
  '1e941f97-f2ce-471f-838e-64bc324b91bd', -- NORNES S.A.S
  '2d79086a-239d-43b6-bbfd-5432cab4474e', -- TRIPODI DOMINGO JOSE
  'a13ccbf0-e7e2-4bd0-b5d6-31ab0b27ed94'  -- VETERINARIA PERGAMINO
)
and cuit ~ '\D';

update public.proveedores
set activo = false
where id in (
  'de2b1c8d-8c9c-42c0-9b13-2eb0631274cb', -- NESTLE ARGENTINA S A (30-54676404-0), repetida
  '6b06d5bd-5786-4d30-9fa8-d1a6847269ff'  -- FERNANDEZ ANDRES ALBERTO (20-25294635-8), repetida
)
and not exists (select 1 from public.facturas_compra f where f.proveedor_id = proveedores.id)
and not exists (select 1 from public.ordenes_compra o where o.proveedor_id = proveedores.id)
and not exists (select 1 from public.ordenes_pago op where op.proveedor_id = proveedores.id);

commit;
