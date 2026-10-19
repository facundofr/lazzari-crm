-- Del Sol Constructora (Lazzari): completa textos con las OP que mandó Augusto (19/10/2026). Solo cambia descripciones.
-- OP 0001-00001483: la retención de $ 206.067,88 es el certificado 11236.
-- OP 0001-00017038: el eCheq 4019 y la retención de $ 23.066,24 (certificado 11718) eran "A CONFIRMAR".
begin;

update public.movimientos
   set descripcion = replace(descripcion, 'certificado: ver OP de Del Sol', 'OP 0001-00001483, Cert: 11236')
 where id = '68c2df80-47ee-4095-b4cb-5ed7bd5748db';

update public.movimientos
   set descripcion = replace(descripcion, 'remesa A CONFIRMAR (pedida 17/10)', 'Remesa 0001-00017038')
 where id = '55cbc3f9-af93-49a9-bed1-09b84145a440';

update public.movimientos
   set descripcion = replace(descripcion, 'Cert: A CONFIRMAR (pedido a Del Sol 17/10)', 'Remesa 0001-00017038 | Cert: 11718')
 where id = '665ff21f-51f6-48e7-8012-dc33225f3238';

commit;
