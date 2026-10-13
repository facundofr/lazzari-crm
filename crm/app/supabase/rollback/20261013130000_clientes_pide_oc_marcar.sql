-- Vuelta atrás de 20261013130000_clientes_pide_oc_marcar.sql: los 7 clientes vuelven a false (así estaban el 13/10/2026).
begin;

update public.clientes set pide_oc_para_facturar = false
where id in (
  '5447f922-7bb5-416c-be6e-556bce90c8dc',
  '4f39811c-01cc-4a2a-953e-d3183f2085a7',
  'cfcaad7b-4bfb-4d9b-9e1b-578f6fc618b6',
  'e5c58c50-a375-4bcf-93fd-22daff081327',
  'a4c461d9-c8e8-4cdb-8826-17fbc2e3944d',
  '290b7bc8-fa7f-44fd-b02b-3733006128e4',
  'c108385c-6b53-40ce-9707-ce6935ed85c5'
);

commit;
