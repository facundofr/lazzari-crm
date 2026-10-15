-- Cheques propios: el CRM queda igual que el banco (reporte eCheqs emitidos BBVA del 15/10/2026, 400 cheques).
-- Pedido de Augusto 16/10: "actualizá esto". Revisado: no hay cheques viejos sin cobrar fuera del reporte.
-- 1) 26 cheques que el banco ya PAGÓ y el CRM tenía "entregado" ($ 17.040.264,26) → cobrado.
--    El cruce del extracto los sigue encontrando por número cuando se cargue el débito (no mira el estado).
-- 2) 90017380 Droguería EYG cargado dos veces el 13 y 14/10 → se anula la segunda copia (no se borra).
-- Las notas guardan el estado anterior; la vuelta atrás está en supabase/rollback/ con el mismo nombre.
begin;
with pagados(id, numero, monto) as (values
    ('43498444-afaf-4247-962a-2d53c88f5b21'::uuid, '90017368', 34140.75), -- 2026-10-12 CONTE HERMANOS Y CIA S A
    ('b331a6c6-b835-4d0c-ac98-9884ac81e226'::uuid, '90017344', 500000), -- 2026-10-12 AMOBLAMIENTOS NEXO
    ('074a78d1-f475-422e-a4ca-967ba44f99d3'::uuid, '90000171', 250000), -- 2026-10-12 BRUNO FRANCIONE
    ('6529feae-236c-4b72-894c-dc48962c76c7'::uuid, '90017299', 28390.67), -- 2026-10-12 RAFADA SA
    ('1f2aeb33-5e58-49e4-976f-20ed6271dc93'::uuid, '90017298', 135193.39), -- 2026-10-12 RAFADA SA
    ('e150ddf6-5ab0-4951-9135-487644457579'::uuid, '90017291', 761055.61), -- 2026-10-12 SEGUFER SA
    ('2b3ebd17-d1c6-41b9-b0fb-1c804310aef9'::uuid, '90017290', 761055.61), -- 2026-10-12 SEGUFER SA
    ('06f3bfed-f83a-4f84-8b41-8c9871dde1eb'::uuid, '90017277', 250268), -- 2026-10-12 TKW S.A.
    ('d8329eda-3d83-4a45-968a-014ce1d94729'::uuid, '90017288', 3144953.35), -- 2026-10-12 SEGUTECNICA SRL
    ('24377aa1-3214-488b-bdc3-99cd181f0a80'::uuid, '90017278', 798091), -- 2026-10-12 MEDIGLOVE SRL
    ('829a77a4-3145-4fcb-8f5f-6782dd1a4b4d'::uuid, '90017275', 776525.64), -- 2026-10-12 RAFADA SA
    ('1ada0da8-595a-4a78-94be-545532081fa6'::uuid, '90017260', 276661.29), -- 2026-10-12 MOLIVA NEUMATICOS S.A.
    ('e63a44b6-3112-46ff-97ec-56b83033b708'::uuid, '90017246', 1000000), -- 2026-10-12 PRISINA SA
    ('b8267732-001b-44b9-9c33-8cc26f8cbbb6'::uuid, '90017247', 1000000), -- 2026-10-12 PRISINA SA
    ('cd7c6206-f68d-4654-882a-5549f397691e'::uuid, '90017224', 562707.56), -- 2026-10-12 JOSE CURI ANTUN E HIJOS SA
    ('ff668d75-bb6d-43a4-9c63-73ec04e396e8'::uuid, '90017227', 562707.56), -- 2026-10-12 JOSE CURI ANTUN E HIJOS SA
    ('272229ff-aad8-4610-bb8d-203063c8bf62'::uuid, '90017225', 562707.56), -- 2026-10-12 JOSE CURI ANTUN E HIJOS SA
    ('5d4d68dd-952a-4432-a842-14565d81d82a'::uuid, '90017226', 562707.56), -- 2026-10-12 JOSE CURI ANTUN E HIJOS SA
    ('327fa163-bf44-4929-b2f4-c6b53bbc1bcb'::uuid, '90017217', 736885.24), -- 2026-10-12 PRISINA SA
    ('583920c0-1592-465f-b772-7c72f509bc30'::uuid, '90017218', 736885.24), -- 2026-10-12 PRISINA SA
    ('e5a045a6-ee38-4f93-8eae-f8b8f62b8363'::uuid, '90017203', 834256.53), -- 2026-09-20 ABRAHAM MIZRAHI
    ('f4c31a36-8f8c-4240-b303-2f0812cc0906'::uuid, '90017094', 733617.1), -- 2026-10-12 PRISINA SA
    ('f1d101fc-2e18-456b-bff4-d9bee3816d13'::uuid, '90017022', 507863.65), -- 2026-10-12 PRISINA SA
    ('a597429b-f842-422f-992c-7166cbc20759'::uuid, '90017021', 507863.65), -- 2026-10-12 PRISINA SA
    ('b8ee7c8a-dc74-4829-8bca-a41d4e8909ab'::uuid, '90017023', 507863.65), -- 2026-10-12 PRISINA SA
    ('2d1ab60c-2b1f-4e32-9e99-fbb5a7075612'::uuid, '90017024', 507863.65) -- 2026-10-12 PRISINA SA
)
update public.echeqs e
set estado = 'cobrado',
    observaciones = trim(both ' ' from coalesce(e.observaciones, '') || ' [16/10/2026: PAGADO según reporte eCheqs BBVA 15/10; antes entregado]')
from pagados p
where e.id = p.id and e.numero = p.numero and round(e.monto::numeric, 2) = round(p.monto::numeric, 2)
  and e.direccion = 'emitido' and e.estado = 'entregado'
  and e.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';

update public.echeqs
set estado = 'anulado',
    observaciones = trim(both ' ' from coalesce(observaciones, '') || ' [16/10/2026: copia repetida del cheque 90017380 (la buena es 6088d060); antes entregado]')
where id = '134517d3-a9de-45a3-8720-61b508cd901d' and numero = '90017380' and estado = 'entregado';
commit;
