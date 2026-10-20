-- Vuelta atrás de 20261018120000_comisionista_ingrid_martin.sql (deja los valores que había el 18/10/2026).
begin;
update public.proveedores set nombre_fantasia = null, email = null, cbu = null, alias_bancario = null, numero_cuenta = null,
  titular_cuenta = null, tipo_cuenta = null, banco = null, cuit_titular_cuenta = null, rubro = null, es_transportista = false, notas = ''
where id = '943ff860-9015-47bb-ba86-6d3b468c5977';
update public.proveedores set notas = '' where id = '0ecda561-20ef-44e0-9447-0523a6feb825';
update public.transportistas set razon_social = null, cuit = null, email = null, observaciones = null
where id = '774457dc-a0dd-4e71-9b58-c2aacfbcdb05';
commit;
