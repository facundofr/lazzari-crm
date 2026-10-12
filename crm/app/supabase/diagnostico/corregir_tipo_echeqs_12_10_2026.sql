-- Corrección de datos con OK de Augusto (12/10/2026): 8 cheques emitidos cargados como "Físico" que en el BBVA son eCheq.
-- Solo cambia tipo_cheque de 'fisico' a 'echeq'. Filtra por sociedad Lazzari, emitidos, número Y monto (si algo no coincide, no lo toca).
-- Vuelta atrás: el mismo update cambiando 'echeq' por 'fisico' (y al revés en el where).
update public.echeqs e
set tipo_cheque = 'echeq'
from (values
  ('90017369', 3376940.00),  -- Agrología
  ('90017370', 1365403.78),  -- TKW
  ('90017371', 1365403.77),  -- TKW
  ('90017372', 1365403.77),  -- TKW
  ('90017364',  197186.44),  -- Ayre Libre
  ('90017373',  321517.45),  -- Speed Business
  ('90017365',   58758.64),  -- Speed Business
  ('90000172',   91234.00)   -- Saez Omar José
) as c(numero, monto)
where e.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and e.direccion = 'emitido'
  and e.tipo_cheque = 'fisico'
  and e.numero = c.numero
  and round(e.monto::numeric, 2) = c.monto
returning e.numero, e.monto, e.tipo_cheque, e.destino_nombre;
