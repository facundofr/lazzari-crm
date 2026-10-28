-- Vuelta atrás de 20261028140000_proveedores_cuit_solo_numeros.sql: devuelve los 12 CUIT a como estaban el 28/10/2026
-- (con guiones o espacios) y vuelve a activar las 2 fichas repetidas.
begin;

update public.proveedores p set cuit = v.cuit
from (values
  ('3853ce96-c24d-4fa3-9602-7cdf7ea88bd4'::uuid, '30-70821403-1'),
  ('07950ef3-0e57-416a-8d07-764dd56d3259'::uuid, '30-71080906-9'),
  ('44f56fdc-c0ab-460d-b460-17b0d4c1bbcf'::uuid, '20-13512837-7'),
  ('8bb47420-1272-498e-b340-ab10b955fea1'::uuid, '30707857303 '),
  ('40f36974-c031-4692-9312-71a21db88ee4'::uuid, '27-45675429-0'),
  ('177bf686-3e45-4d49-a644-b1b6990439f7'::uuid, '30-52687424-9'),
  ('b9f9b907-38ff-41f9-85fa-08147407f435'::uuid, '20-11611220-6'),
  ('894a18e3-404c-4857-ae71-7032440f0d57'::uuid, '30-71634836-5 '),
  ('5a606d8d-6880-4113-abd7-e6f40bb86bfc'::uuid, '30-71642009-0'),
  ('1e941f97-f2ce-471f-838e-64bc324b91bd'::uuid, '30-71631479-7'),
  ('2d79086a-239d-43b6-bbfd-5432cab4474e'::uuid, '20-16929665-1'),
  ('a13ccbf0-e7e2-4bd0-b5d6-31ab0b27ed94'::uuid, '33-52862469-9')
) as v(id, cuit)
where p.id = v.id;

update public.proveedores set activo = true
where id in ('de2b1c8d-8c9c-42c0-9b13-2eb0631274cb', '6b06d5bd-5786-4d30-9fa8-d1a6847269ff');

commit;
