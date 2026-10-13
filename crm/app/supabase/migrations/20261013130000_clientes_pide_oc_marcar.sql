-- Marca "Pide OC para facturar" en los clientes que dijo Augusto (12/10/2026): Synthon, Corteva Agriscience, Corteva Seeds,
-- Adecco (Recursos Humanos y Specialties), Termocórdoba y Soenergy. OK de Augusto 13/10/2026. Antes: los 7 en false.
-- Vuelta atrás: supabase/rollback/20261013130000_clientes_pide_oc_marcar.sql
begin;

update public.clientes set pide_oc_para_facturar = true
where id in (
  '5447f922-7bb5-416c-be6e-556bce90c8dc', -- ADECCO RECURSOS HUMANOS ARGENTINA SA
  '4f39811c-01cc-4a2a-953e-d3183f2085a7', -- ADECCO SPECIALTIES S.A.
  'cfcaad7b-4bfb-4d9b-9e1b-578f6fc618b6', -- CORTEVA AGRISCIENCE ARGENTINA SRL
  'e5c58c50-a375-4bcf-93fd-22daff081327', -- CORTEVA SEEDS ARGENTINA S. R. L.
  'a4c461d9-c8e8-4cdb-8826-17fbc2e3944d', -- SOENERGY ARGENTINA S.A.
  '290b7bc8-fa7f-44fd-b02b-3733006128e4', -- SYNTHON ARGENTINA SA
  'c108385c-6b53-40ce-9707-ce6935ed85c5'  -- TERMO CORDOBA S.A.U.
)
  and coalesce(pide_oc_para_facturar, false) = false;

commit;
