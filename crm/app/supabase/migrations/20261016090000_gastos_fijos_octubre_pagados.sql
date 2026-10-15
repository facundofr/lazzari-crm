-- Gastos fijos de octubre 2026 de Lazzari marcados como PAGADOS (pedido de Augusto 16/10: "estos están todos pagos,
-- no tengo los comprobantes, ponelos como pagos y listo").
-- Solo agrega un gasto en "Gastos" atado a cada gasto fijo (así deja de decir "Falta pagar octubre").
-- NO crea movimiento de pago: no toca saldos de bancos ni la lista "sin cuenta". El débito del banco
-- de cada pago (sueldos, Porcel, Inga) se cruza con este gasto al conciliar el extracto.
-- Fecha 10/10 aproximada (vencen del 1 al 10 / 1 al 15). Si ya hay un gasto del mes para ese gasto fijo, no duplica.
begin;
insert into public.gastos_manuales
  (sociedad_id, fecha, descripcion, proveedor_id, categoria, monto, moneda, notas, tipo_gasto, medio_pago, tipo_recurrencia, gasto_fijo_id)
select g.sociedad_id, date '2026-10-10', g.descripcion || ' — octubre 2026', g.proveedor_id, g.categoria, g.monto, g.moneda,
       'Pagado según Augusto (16/10/2026), sin comprobante. Fecha aproximada. Carga gastos-fijos-octubre-2026',
       'Gasto fijo', 'transferencia', 'mensual', g.id
from public.gastos_fijos g
where g.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and g.activo
  and g.id in (
    '6a1f0c10-0001-4e00-9a00-000000000002', -- Alquiler
    'ef9c546b-4f81-4493-8e34-877b4a4c13ce', -- Leandro Porcel
    '038dbd51-880f-4ff4-b2d3-76520cc8ce46', -- Natalia Inga
    'f8054044-a73f-4a41-978a-36120134b046', -- Sueldo Augusto
    '6a1f0c10-0001-4e00-9a00-000000000004', -- Sueldo Jerónimo Casadidio
    '6a1f0c10-0001-4e00-9a00-000000000003', -- Sueldo Mariana Santinelli
    '6a1f0c10-0001-4e00-9a00-000000000005'  -- Sueldo Sebastián Pereyra
  )
  and not exists (
    select 1 from public.gastos_manuales m
    where m.gasto_fijo_id = g.id and m.fecha >= date '2026-10-01' and m.fecha < date '2026-11-01'
  );
commit;
