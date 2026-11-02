-- Prueba de 20261102200000_tarjeta_consumos.sql (se corre con migrar.cjs --probar: todo se deshace).
-- Como Augusto: un resumen de la Visa con 4 renglones, volver a subirlo (no duplica), clasificar comercios; como vendedor: ve solo
-- las compras y marca «No tiene» en una compra pero no en un servicio.
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);

insert into tarjeta_resumenes (id, sociedad_id, cuenta_id, cierre, vencimiento, total_ars, total_usd)
values ('0b0b0b0b-0000-4000-8000-000000000001', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'f2caa8a4-594a-4055-aea4-f2a58e953b25', date '2026-10-29', date '2026-11-11', 7827968.12, 374.18);

select 'guardar' q, public.guardar_consumos_tarjeta('0b0b0b0b-0000-4000-8000-000000000001', '[
  {"fecha":"2026-10-08","descripcion":"MERPAGO*MERCADOLIBRE","comercio":"MERPAGO*MERCADOLIBRE","cupon":"577808","importe":21597,"moneda":"ARS","tipo":"consumo","clave":"a|1"},
  {"fecha":"2026-10-02","descripcion":"CLARO DEB AUT","comercio":"CLARO DEB AUT","cupon":null,"importe":20394.01,"moneda":"ARS","tipo":"consumo","clave":"b|1"},
  {"fecha":"2026-10-09","descripcion":"SUPABASE","comercio":"SUPABASE","cupon":"005154","importe":25,"moneda":"USD","tipo":"consumo","clave":"c|1"},
  {"fecha":"2026-10-29","descripcion":"IMPUESTO DE SELLOS","comercio":"IMPUESTO DE SELLOS","importe":92926.93,"moneda":"ARS","tipo":"cargo","clave":"d|1"}
]'::jsonb) r;
select 'otra_vez' q, public.guardar_consumos_tarjeta('0b0b0b0b-0000-4000-8000-000000000001', '[
  {"fecha":"2026-10-08","descripcion":"MERPAGO*MERCADOLIBRE","comercio":"MERPAGO*MERCADOLIBRE","cupon":"577808","importe":21597,"moneda":"ARS","tipo":"consumo","clave":"a|1"}
]'::jsonb) r;
select 'clasificar_ml' q, public.clasificar_consumo_tarjeta('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'MERPAGO*MERCADOLIBRE', 'compra') r;
select 'clasificar_claro' q, public.clasificar_consumo_tarjeta('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'CLARO DEB AUT', 'servicio') r;
select 'filas' q, descripcion, tipo, clase, importe, moneda from tarjeta_consumos where resumen_id = '0b0b0b0b-0000-4000-8000-000000000001' order by clave;
select 'augusto_ve' q, jsonb_array_length(x->'consumos') consumos, jsonb_array_length(x->'movimientos') movimientos, x->'finanzas' finanzas,
  jsonb_array_length(x->'resumenes') resumenes
from (select public.consumos_de_tarjeta('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021') x) s;

create temp table _r (caso text, resultado text) on commit drop;
do $$
declare
  v_ml uuid := (select id from tarjeta_consumos where clave = 'a|1');
  v_claro uuid := (select id from tarjeta_consumos where clave = 'b|1');
  v_cargo uuid := (select id from tarjeta_consumos where clave = 'd|1');
  v_fc uuid := (select id from facturas_compra where estado::text <> 'anulada' order by created_at desc limit 1);
  x jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where role = 'vendedor' and coalesce(active, true) limit 1), 'role', 'authenticated')::text, true);
  x := public.consumos_de_tarjeta('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021');
  insert into _r values ('vendedor ve', format('%s consumos (%s), %s movimientos, todos con factura: %s', jsonb_array_length(x->'consumos'),
    (select string_agg(e->>'descripcion', ', ') from jsonb_array_elements(x->'consumos') e), jsonb_array_length(x->'movimientos'),
    coalesce((select bool_and(e->>'factura_compra_id' is not null) from jsonb_array_elements(x->'movimientos') e), true)));
  begin perform public.marcar_consumo_tarjeta(v_ml, null, 'Pagó Seba'); insert into _r values ('vendedor: No tiene en compra', 'marcado');
  exception when others then insert into _r values ('vendedor: No tiene en compra', sqlerrm); end;
  begin perform public.marcar_consumo_tarjeta(v_claro, null, 'x'); insert into _r values ('vendedor: en servicio', 'NO FALLÓ');
  exception when others then insert into _r values ('vendedor: en servicio', sqlerrm); end;
  begin perform public.marcar_consumo_tarjeta(v_ml, v_fc, null); insert into _r values ('vendedor: factura en compra', 'unida');
  exception when others then insert into _r values ('vendedor: factura en compra', sqlerrm); end;
  begin perform public.clasificar_consumo_tarjeta('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'SUPABASE', 'compra'); insert into _r values ('vendedor: clasificar', 'NO FALLÓ');
  exception when others then insert into _r values ('vendedor: clasificar', sqlerrm); end;
  begin perform public.guardar_consumos_tarjeta('0b0b0b0b-0000-4000-8000-000000000001', '[]'::jsonb); insert into _r values ('vendedor: guardar', 'NO FALLÓ');
  exception when others then insert into _r values ('vendedor: guardar', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);
  begin perform public.marcar_consumo_tarjeta(v_cargo, null, 'x'); insert into _r values ('augusto: cargo del banco', 'NO FALLÓ');
  exception when others then insert into _r values ('augusto: cargo del banco', sqlerrm); end;
  begin perform public.marcar_consumo_tarjeta(v_claro, null, 'Débito sin factura'); insert into _r values ('augusto: No tiene en servicio', 'marcado');
  exception when others then insert into _r values ('augusto: No tiene en servicio', sqlerrm); end;
  begin perform public.clasificar_consumo_tarjeta('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', null, 'personal', v_claro); insert into _r values ('augusto: solo este personal', 'ok');
  exception when others then insert into _r values ('augusto: solo este personal', sqlerrm); end;
  perform public.clasificar_consumo_tarjeta('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'CLARO DEB AUT', 'servicio');
end $$;
select 'controles' q, caso, resultado from _r;
select 'final' q, descripcion, clase, clase_manual, factura_compra_id is not null con_factura, sin_factura_motivo
from tarjeta_consumos where resumen_id = '0b0b0b0b-0000-4000-8000-000000000001' order by clave;
select 'comercios' q, comercio, clase from tarjeta_comercios order by comercio;
