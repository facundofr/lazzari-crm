-- Vuelta atrás de 20261029190000: las 4 facturas de flete vuelven a "mercadería" (como estaban).
begin;
update public.facturas_compra set tipo = 'mercaderia'
where tipo = 'transporte' and id in (
  '8a6250af-cc80-41c8-bed6-af2bd81149b8', '263968c1-e7ec-48a1-9a43-89497582ab40',
  '2b1e388a-f960-4d83-b44d-684a9c5b4827', 'dc88f81b-4af3-4bb6-a8e5-4d6b94d543b1'
);
commit;
