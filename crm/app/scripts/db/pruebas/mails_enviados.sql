-- Prueba de 20261028210000_mails_enviados.sql (solo lectura). Las 5 filas tienen que dar ok = true.
select 'tabla creada' as prueba, to_regclass('public.mails_enviados') is not null as ok
union all
select 'RLS activa', (select relrowsecurity from pg_class where oid = 'public.mails_enviados'::regclass)
union all
select 'anon sin permiso', not has_table_privilege('anon', 'public.mails_enviados', 'select')
union all
select 'usuarios leen y anotan; no borran ni cambian destinatarios',
  has_table_privilege('authenticated', 'public.mails_enviados', 'insert')
  and not has_table_privilege('authenticated', 'public.mails_enviados', 'delete')
  and has_column_privilege('authenticated', 'public.mails_enviados', 'estado', 'update')
  and not has_column_privilege('authenticated', 'public.mails_enviados', 'enviado_a', 'update')
union all
select 'envíos de PR copiados', not exists (
  select 1 from public.presupuesto_envios e
  where not exists (select 1 from public.mails_enviados m where m.documento_tipo = 'presupuesto' and m.documento_id = e.presupuesto_id
                      and m.resend_id is not distinct from e.resend_id));
