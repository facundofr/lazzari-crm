select estado, count(*), sum(monto) from public.echeqs where observaciones like '%[16/10/2026:%' group by 1;
select case when fecha_pago <= date '2026-10-15' then 'en fecha (vencido sin debitar)' else 'futuro' end cuando, count(*), sum(monto)
from public.echeqs where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and direccion = 'emitido' and estado in ('entregado','pendiente') group by 1;
