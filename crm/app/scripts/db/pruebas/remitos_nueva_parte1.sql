select email, prueba_remitos_nueva from public.profiles where prueba_remitos_nueva;
select count(*) as remitos, count(entregado_at) as con_entrega from public.remitos;
select count(*) as respuestas from public.remito_respuestas;
