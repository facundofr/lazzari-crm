-- Valor declarado siempre en pesos (Augusto 17/10/2026): 9 remitos de PR en dólares que quedaron cargados en US$
-- se pasan a pesos con el dólar BNA billete del día del remito. Solo cambia si el valor sigue siendo el viejo.
-- Vuelta atrás: supabase/rollback/20261017150000_remitos_valor_declarado_pesos.sql
update remitos set valor_declarado = 3416864 where id = '4d116938-8bb4-4ec4-b50c-f5d108060cb9' and valor_declarado = 2225.97; -- R-2026-1021: US$ 2225.97 x 1535
update remitos set valor_declarado = 1444043 where id = '97168c71-a799-4855-b860-52a7e3fd41d7' and valor_declarado = 937.69; -- R-2026-1043: US$ 937.69 x 1540
update remitos set valor_declarado = 1444043 where id = '3471b6c2-5496-410c-8eb3-6cf532ba5b70' and valor_declarado = 937.69; -- R-2026-1044: US$ 937.69 x 1540
update remitos set valor_declarado = 465787 where id = '6c9e013d-cf50-4122-97da-75666103f2a5' and valor_declarado = 301.48; -- R-2026-1049: US$ 301.48 x 1545
update remitos set valor_declarado = 2173094 where id = '883d65d7-fd31-414c-bc2b-ea1101966c4a' and valor_declarado = 1411.10; -- R-2026-1056: US$ 1411.10 x 1540
update remitos set valor_declarado = 7548279 where id = 'dae489da-f34c-4779-a2f6-10085d130f08' and valor_declarado = 4901.48; -- R-2026-1057: US$ 4901.48 x 1540
update remitos set valor_declarado = 4264476 where id = '2e6b7b1d-4410-4d99-bd69-00dbc3b922e0' and valor_declarado = 2778.16; -- R-2026-1065: US$ 2778.16 x 1535
update remitos set valor_declarado = 6017814 where id = '3449f2e1-7b1d-4c7f-9f80-d0883bbd237f' and valor_declarado = 3920.40; -- R-2026-1086: US$ 3920.40 x 1535
update remitos set valor_declarado = 5140915 where id = 'cb92c99b-458a-40b6-9893-e23f69a840c9' and valor_declarado = 3349.13; -- R-2026-1087: US$ 3349.13 x 1535
