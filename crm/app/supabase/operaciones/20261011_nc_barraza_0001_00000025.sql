-- Carga única de la NC A 0001-00000025 (hecha en ARCA el 30/09/2026) que anula las 3 facturas de BARRAZA JESICA PAOLA.
-- NO emite nada en ARCA: solo registra la NC en el CRM, con su CAE.
-- Correr RECIÉN cuando los 3 cheques (00000074, 00000176 y 00000131) estén rechazados en el sistema.
-- Requiere la migración 20261011150000_cobros_fecha_conciliado_nc_multiple.sql.
-- Se puede correr dos veces sin duplicar (misma request_key).
begin;

-- La función pide un usuario con permiso: se usa el de Augusto.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text,
  true);

do $$
begin
  if exists (
    select 1 from public.echeqs
    where id in ('346b9a89-8863-4299-adf3-b139ef3352e9', 'fff7184f-bdf1-4e17-a974-3fbeb238bd21', '16df94ad-6300-46c3-84e2-6edd7cac69ad')
      and estado <> 'rechazado'
  ) then
    raise exception 'Todavía hay cheques de Barraza sin rechazar: primero rechazalos desde Finanzas > Cheques.';
  end if;
end;
$$;

select public.crear_nota_credito_manual_venta_multiple(
  p_request_key     := 'b4a7e1c2-0025-4c0a-9a25-000000000025',
  p_sociedad_id     := 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021',
  p_facturas        := '[
    {"id": "d14caf46-c725-447d-aa93-08087b3ea0ad", "monto": 7623000.00},
    {"id": "6f19bfa5-409e-41e6-9b21-589256bf2df5", "monto": 10110492.35},
    {"id": "9d70418b-17ee-4760-8697-9c700d4075cc", "monto": 9220848.56}
  ]'::jsonb,
  p_tipo            := 'NCA',
  p_punto_venta     := 1,
  p_numero          := 25,
  p_fecha           := date '2026-09-30',
  p_subtotal        := 22276314.80,
  p_iva             := 4678026.11,
  p_total           := 26954340.91,
  p_items           := '[{"descripcion": "Error de facturación. Fac. A: 00015-00000010 / 00015-00000019 / 00015-00000030", "cantidad": 1, "precio_unitario": 22276314.80, "iva_porcentaje": 21}]'::jsonb,
  p_cae             := '86416795481784',
  p_cae_vencimiento := date '2026-10-10',
  p_observaciones   := 'NC emitida en ARCA (no desde el CRM). Anula FA 0015-00000010, 0015-00000019 y 0015-00000030: cheques rechazados.'
) as resultado;

commit;
