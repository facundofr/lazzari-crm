-- Vuelta atrás de 20261020160000_transportes_recuperar_viajes_remito.sql (valores del 20/10/2026).
-- Borra solo las 5 copias que agregó (por id) y vuelve el nombre de Julio. Los viajes de los remitos no se tocaron.
begin;
delete from public.transportes where id in (
  'adedfd68-a914-4f16-a243-5b2d631b640d','1383a886-673b-40e2-83c8-d94ea64200ab','da207404-6918-4497-9841-dcda3cdf07c6',
  '20eeb271-ee8d-47eb-870b-537f406c6e99','32d88649-44de-481c-ac25-8f5a650377d9');
update public.transportistas set nombre = 'JULIO CERNUDA' where id = '774457dc-a0dd-4e71-9b58-c2aacfbcdb05';
update public.transportes set transportista = 'JULIO CERNUDA'
where transportista_id = '774457dc-a0dd-4e71-9b58-c2aacfbcdb05' and transportista = 'JULIO CERNUDA (Ingrid Martin)';
commit;
