-- Auditoría integral, Tanda 5 — H14 (02/11/2026, OK de Augusto): "Dividir remito" en UNA transacción.
-- Antes el navegador cambiaba la sucursal, borraba TODOS los renglones del remito, los volvía a cargar, pedía el
-- número de CAI y creaba cada remito nuevo, sin mirar si algún paso fallaba: el original podía quedar sin
-- renglones o un remito nuevo vacío con su número de CAI gastado. Ahora:
--  * dividir_remito bloquea el remito y sus renglones (FOR UPDATE) y hace todo junto. Si algo falla no se guarda
--    nada (tampoco se gasta el número de CAI: next_cai_number corre dentro de la misma transacción).
--  * p_grupos: [{sucursal_id, renglones: [{item_id, cantidad}]}, ...]. El primero se queda en el remito original
--    (le cambia la sucursal y le deja esas cantidades, sin borrar y volver a cargar); cada uno de los demás
--    es un remito nuevo, igual que antes (mismo cliente, fecha, PR, valor declarado, "Dividido de R-...").
--  * Lo repartido de cada renglón no puede pasar de lo que tiene en la base. El renglón que no queda en el
--    original se saca de él (igual que antes). Los renglones conservan producto_id y presupuesto_item_id.
--  * Si el original tenía CAI y no quedan números, el remito nuevo sale sin CAI (como antes) y se avisa.
--  * SECURITY INVOKER: los permisos son los mismos de hoy (las reglas de la tabla).
-- Aditivo: solo agrega una función. Vuelta atrás: supabase/rollback/20261102120000_dividir_remito.sql
begin;

create or replace function public.dividir_remito(p_remito_id uuid, p_sociedad_id uuid, p_grupos jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rem record;
  v_g jsonb;
  v_r jsonb;
  v_gi integer := 0;
  v_cant numeric;
  v_item uuid;
  v_orig jsonb;
  v_rep jsonb := '[]'::jsonb;
  v_mal record;
  v_suc uuid;
  v_suc_nombre text;
  v_cai_numero text;
  v_cai_pv integer;
  v_cai_nro integer;
  v_nuevo uuid;
  v_numero text;
  v_creados jsonb := '[]'::jsonb;
  v_sin_cai integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;
  if p_grupos is null or jsonb_typeof(p_grupos) <> 'array' or jsonb_array_length(p_grupos) < 2 then
    raise exception 'Asigná al menos un artículo a otra sucursal' using errcode = '22023';
  end if;

  select * into v_rem from public.remitos where id = p_remito_id and sociedad_id = p_sociedad_id for update;
  if not found then
    raise exception 'No se encontró el remito' using errcode = 'P0002';
  end if;
  if coalesce(v_rem.anulado, false) then
    raise exception 'El remito % está anulado', v_rem.numero using errcode = '22023';
  end if;

  -- Copia de los renglones como están en la base (de acá salen los de los remitos nuevos).
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_orig
  from (select * from public.remito_items where remito_id = p_remito_id order by orden for update) i;

  -- Reparto: grupo, renglón y cantidad (sin los ceros).
  for v_g in select * from jsonb_array_elements(p_grupos) loop
    if jsonb_typeof(v_g->'renglones') is distinct from 'array' then
      raise exception 'Faltan los artículos' using errcode = '22023';
    end if;
    for v_r in select * from jsonb_array_elements(v_g->'renglones') loop
      begin
        v_cant := round(coalesce((v_r->>'cantidad')::numeric, 0), 4);
      exception when invalid_text_representation then
        raise exception 'Cantidad inválida' using errcode = '22023';
      end;
      if v_cant < 0 then
        raise exception 'Cantidad inválida' using errcode = '22023';
      end if;
      v_item := (v_r->>'item_id')::uuid;
      if not exists (select 1 from jsonb_to_recordset(v_orig) o(id uuid) where o.id = v_item) then
        raise exception 'Un artículo ya no está en %: volvé a abrirlo', v_rem.numero using errcode = 'P0002';
      end if;
      if v_cant > 0 then
        v_rep := v_rep || jsonb_build_object('gi', v_gi, 'item_id', v_item, 'cantidad', v_cant);
      end if;
    end loop;
    v_gi := v_gi + 1;
  end loop;

  -- Nada puede pasar de lo que tiene cada renglón en la base.
  for v_mal in
    select o.descripcion, o.cantidad
    from jsonb_to_recordset(v_rep) r(gi integer, item_id uuid, cantidad numeric)
    join jsonb_to_recordset(v_orig) o(id uuid, descripcion text, cantidad numeric) on o.id = r.item_id
    group by o.id, o.descripcion, o.cantidad
    having sum(r.cantidad) > o.cantidad + 0.0001
  loop
    raise exception 'La suma de cantidades para "%" supera el total del remito (%)', v_mal.descripcion, v_mal.cantidad using errcode = '22023';
  end loop;

  if not exists (select 1 from jsonb_to_recordset(v_rep) r(gi integer) where r.gi = 0) then
    raise exception 'El remito original tiene que quedarse con al menos un artículo' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_to_recordset(v_rep) r(gi integer) where r.gi > 0) then
    raise exception 'Asigná al menos un artículo a otra sucursal' using errcode = '22023';
  end if;

  -- 1) El original: su sucursal y lo que se queda (se actualiza en el lugar; el que se va entero se saca).
  update public.remitos set sucursal_id = nullif(p_grupos->0->>'sucursal_id', '')::uuid where id = p_remito_id;
  update public.remito_items i set cantidad = q.cantidad
  from (select r.item_id, sum(r.cantidad) as cantidad
        from jsonb_to_recordset(v_rep) r(gi integer, item_id uuid, cantidad numeric) where r.gi = 0 group by r.item_id) q
  where i.id = q.item_id and i.cantidad <> q.cantidad;
  delete from public.remito_items i
  where i.remito_id = p_remito_id
    and not exists (select 1 from jsonb_to_recordset(v_rep) r(gi integer, item_id uuid) where r.gi = 0 and r.item_id = i.id);

  -- 2) Un remito nuevo por cada uno de los demás grupos.
  for v_gi in select distinct r.gi from jsonb_to_recordset(v_rep) r(gi integer) where r.gi > 0 order by r.gi loop
    v_suc := nullif(p_grupos->v_gi->>'sucursal_id', '')::uuid;
    v_suc_nombre := null;
    if v_suc is not null then
      select nombre into v_suc_nombre from public.cliente_sucursales where id = v_suc;
    end if;

    v_cai_numero := null; v_cai_pv := null; v_cai_nro := null;
    if v_rem.cai_numero is not null then
      select c.cai_numero, c.punto_venta, c.nro_comprobante into v_cai_numero, v_cai_pv, v_cai_nro
      from public.next_cai_number(p_sociedad_id, 'remito_r') c limit 1;
      if v_cai_numero is null then v_sin_cai := v_sin_cai + 1; end if;
    end if;

    insert into public.remitos (numero, cliente_id, fecha, observaciones, presupuesto_id, estado, sociedad_id, sucursal_id,
                                valor_declarado, created_by, remito_origen_id, cai_numero, punto_venta_cai, nro_comprobante_cai)
    values (null, v_rem.cliente_id, v_rem.fecha,
            'Dividido de ' || coalesce(v_rem.numero, '') || coalesce(' — Suc: ' || nullif(v_suc_nombre, ''), ''),
            v_rem.presupuesto_id, 'pendiente', p_sociedad_id, v_suc, v_rem.valor_declarado, auth.uid(), p_remito_id,
            v_cai_numero, v_cai_pv, v_cai_nro)
    returning id, numero into v_nuevo, v_numero;

    insert into public.remito_items (remito_id, producto_id, descripcion, cantidad, unidad, orden, presupuesto_item_id)
    select v_nuevo, o.producto_id, o.descripcion, q.cantidad, o.unidad, o.orden, o.presupuesto_item_id
    from (select r.item_id, sum(r.cantidad) as cantidad
          from jsonb_to_recordset(v_rep) r(gi integer, item_id uuid, cantidad numeric) where r.gi = v_gi group by r.item_id) q
    join jsonb_to_recordset(v_orig) o(id uuid, producto_id uuid, descripcion text, unidad text, orden integer, presupuesto_item_id uuid)
      on o.id = q.item_id
    order by o.orden;

    v_creados := v_creados || to_jsonb(v_numero);
  end loop;

  return jsonb_build_object('numero', v_rem.numero, 'creados', v_creados, 'sin_cai', v_sin_cai);
end;
$$;

grant execute on function public.dividir_remito(uuid, uuid, jsonb) to authenticated;

commit;
