-- Corrección de datos con OK de Augusto (12/10/2026), segunda parte: 2 cheques emitidos cargados a mano como "Físico" que son eCheq.
-- Solo cambia tipo_cheque. Filtra por sociedad Lazzari, emitidos, número Y monto.
-- Vuelta atrás: el mismo update cambiando 'echeq' por 'fisico' (y al revés en el where).
update public.echeqs e
set tipo_cheque = 'echeq'
from (values
  ('90017362', 270075.03),  -- Cooperativa de Trabajo Sinpostre Ltda.
  ('90017368',  34140.75)   -- Conte Hnos y Cía SA
) as c(numero, monto)
where e.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and e.direccion = 'emitido'
  and e.tipo_cheque = 'fisico'
  and e.numero = c.numero
  and round(e.monto::numeric, 2) = c.monto
returning e.numero, e.monto, e.tipo_cheque, e.destino_nombre;
