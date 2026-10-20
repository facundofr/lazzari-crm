-- Comisionista Julio Cernuda = INGRID MARTIN (ella factura). Solo datos, en Lazzari. Pedido de Augusto 18/10/2026.
-- Vuelta atrás: supabase/rollback/20261018120000_comisionista_ingrid_martin.sql
begin;

-- Ingrid Martin: banco de Julio (la cuenta es de él), mail y "Julio Cernuda" como nombre de fantasía.
update public.proveedores i set
  nombre_fantasia = 'Julio Cernuda',
  email = j.email,
  cbu = j.cbu,
  alias_bancario = j.alias_bancario,
  numero_cuenta = j.numero_cuenta,
  titular_cuenta = nullif(j.titular_cuenta, ''),
  tipo_cuenta = nullif(j.tipo_cuenta, ''),
  banco = nullif(j.banco, ''),
  cuit_titular_cuenta = j.cuit_titular_cuenta,
  rubro = 'Transporte',
  es_transportista = true,
  notas = 'Comisionista Bs. As. (lleva y trae). Maneja Julio Arturo Cernuda; factura Ingrid Martin. Cuenta bancaria a nombre de Julio.'
from public.proveedores j
where i.id = '943ff860-9015-47bb-ba86-6d3b468c5977'
  and j.id = '0ecda561-20ef-44e0-9447-0523a6feb825';

-- Julio: no se borra; queda la nota para no cargarle nada.
update public.proveedores set notas = 'NO USAR: las facturas y pagos van a INGRID MARTIN (misma persona, ella factura).'
where id = '0ecda561-20ef-44e0-9447-0523a6feb825';

-- Transportista "JULIO CERNUDA" (sus viajes): datos de Ingrid.
update public.transportistas set
  razon_social = 'INGRID MARTIN',
  cuit = '27256231498',
  email = 'julioarturocernuda@gmail.com',
  observaciones = 'Factura INGRID MARTIN (proveedor).'
where id = '774457dc-a0dd-4e71-9b58-c2aacfbcdb05';

commit;
