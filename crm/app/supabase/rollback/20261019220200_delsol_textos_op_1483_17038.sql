-- Vuelta atrás de 20261019220200_delsol_textos_op_1483_17038.sql: vuelve los textos como estaban.
begin;
update public.movimientos set descripcion = replace(descripcion, 'OP 0001-00001483, Cert: 11236', 'certificado: ver OP de Del Sol')
 where id = '68c2df80-47ee-4095-b4cb-5ed7bd5748db';
update public.movimientos set descripcion = replace(descripcion, 'Remesa 0001-00017038 | Cert: 11718', 'Cert: A CONFIRMAR (pedido a Del Sol 17/10)')
 where id = '665ff21f-51f6-48e7-8012-dc33225f3238';
update public.movimientos set descripcion = replace(descripcion, 'Remesa 0001-00017038', 'remesa A CONFIRMAR (pedida 17/10)')
 where id = '55cbc3f9-af93-49a9-bed1-09b84145a440';
commit;
