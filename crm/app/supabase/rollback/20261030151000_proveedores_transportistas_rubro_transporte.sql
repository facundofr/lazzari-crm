-- Vuelta atrás de 20261030151000_proveedores_transportistas_rubro_transporte.sql (estado del 30/10/2026):
-- las 3 cooperativas (Sinpostre y las 2 Milonguitas) estaban sin dato (null); el resto, vacío ('').
begin;
update public.proveedores set rubro = null
where id in ('b132b3b5-a0dc-4e61-8d01-bbff47c08b2b', '8e7bf500-7f5f-41bb-a990-e46bef717213', '6730ae6f-3a03-4f91-a7f0-5649ff7539e5');
update public.proveedores set rubro = ''
where id in ('5e6323bb-e56c-4243-a046-0819a003ba9f', '641b4887-b7d3-4e1b-af1d-8418f1af4db8', '226e0ae1-bbd7-40e8-b9dc-be2107cefa78',
  '714409d5-7391-4756-a6cd-4a5667846bc7', 'fa6c4349-cca3-4638-a1d6-6daef13b5c4e', '3f52cb50-6fc6-4f5b-aa5e-fc07f3322e3e',
  '1f87eea4-1743-42a1-8168-f37c0d6404ed', 'c118d26c-1d34-4ca0-b74a-7f850670d87d', '47ecfc13-097c-48f0-b398-8154a1d9e0cc',
  '40185775-94dd-4400-811a-755d485968a3');
commit;
