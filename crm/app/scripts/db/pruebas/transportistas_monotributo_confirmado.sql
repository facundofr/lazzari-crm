-- Prueba de 20261103140000: los dos quedan Monotributo y la nota dice con qué factura.
select razon_social, condicion_iva, notas,
       (condicion_iva = 'Monotributo' and notas like '%FC C%') as ok
from public.proveedores
where id in ('7c2e51a4-3b9d-4f60-a1d8-29102026b0c4', '42bff233-a8c7-47a7-ae46-7bcf1f24fcde')
order by razon_social;
