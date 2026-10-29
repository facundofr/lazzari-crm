-- Vuelta atrás de 20261028250000: el costo del renglón vuelve a figurar en USD.
begin;
update public.presupuesto_items set costo_moneda = 'USD' where id = '5e81bbd6-9fce-49ca-a259-709602f4618d';
commit;
