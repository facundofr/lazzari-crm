-- Prueba de 20261027151000_op_retencion_congelada_datos.sql (se corre con --probar: muestra resultados y DESHACE todo).
-- Requiere 20261027150000_op_retencion_congelada.sql ya corrida.
select 'OP con retención' as control, count(*)::text as valor, 'esperado 49 (o más si se hicieron OP nuevas)' as nota
  from public.ordenes_pago where retencion_ganancias_monto > 0
union all select 'OP con retención anotadas', count(*)::text, 'esperado 49'
  from public.ordenes_pago where retencion_ganancias_monto > 0 and retencion_ganancias_regimen is not null
union all select 'OP con retención sin anotar', coalesce(string_agg(numero, ', ' order by numero), 'ninguna'), 'esperado ninguna (las nuevas se anotan al guardarse)'
  from public.ordenes_pago where retencion_ganancias_monto > 0 and retencion_ganancias_regimen is null
union all select 'por régimen', string_agg(r || ' → ' || n, ', '), 'esperado 078 → 49'
  from (select retencion_ganancias_regimen r, count(*) n from public.ordenes_pago where retencion_ganancias_regimen is not null group by 1) x
union all select 'OP-000049', retencion_ganancias_regimen || ' · mínimo ' || retencion_ganancias_minimo || ' · antes ' || retencion_ganancias_base_previa || ' · retenido ' || retencion_ganancias_monto,
       'esperado 078 · mínimo 224000.00 · antes 48560.86 · retenido 1835.90'
  from public.ordenes_pago where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and numero = 'OP-000049'
union all select 'OP-000034 (segundo pago del mes de Star-Tex)', retencion_ganancias_base_previa || ' · retenido antes ' || retencion_ganancias_retenido_antes,
       'esperado 2207518.42 · retenido antes 39670.37'
  from public.ordenes_pago where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and numero = 'OP-000034'
union all select 'la cuenta anotada da lo retenido', count(*) filter (where abs(round(greatest(0, (coalesce(retencion_ganancias_base_previa, 0) + base_retencion_ganancias - retencion_ganancias_minimo) * retencion_ganancias_pct / 100 - retencion_ganancias_retenido_antes), 2) - retencion_ganancias_monto) <= 0.05)::text || ' de ' || count(*),
       'esperado 49 de 49'
  from public.ordenes_pago where retencion_ganancias_regimen is not null;
