-- SOLO LECTURA. No cambia nada.
-- Muestra el código de la función que guarda los cobros masivos (la hizo Manu a mano y no está en el repo),
-- para confirmar cómo reparte cuando el cliente paga de menos o de más.
select pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'registrar_cobro_masivo';
