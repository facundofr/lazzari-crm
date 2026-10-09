-- Conserva el tipo electronico al registrar desde una OP un e-cheq propio
-- emitido manualmente. La funcion ya desplegada trataba todos los cheques
-- propios nuevos como fisicos aunque el comprobante fuera un e-cheq.
do $$
declare
  v_oid oid;
  v_definition text;
  v_old text := '''fisico'', ''emitido'', v_numero_cheque';
  v_new text := 'case when coalesce(v_medio->>''tipo_cheque'', '''') = ''echeq'' then ''echeq'' else ''fisico'' end,' || chr(10) ||
    '          ''emitido'', v_numero_cheque';
begin
  select p.oid
    into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'registrar_pago_proveedor_seguro'
    and pg_get_function_identity_arguments(p.oid) like 'p_sociedad_id uuid,%';

  if v_oid is null then
    raise exception 'No se encontro registrar_pago_proveedor_seguro';
  end if;

  v_definition := pg_get_functiondef(v_oid);
  if position('v_medio->>''tipo_cheque''' in v_definition) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception 'La funcion de OP no tiene el bloque esperado para cheque propio';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$;
