-- Prueba de 20261103090000_lz_migraciones_corridas.sql (se corre con migrar.cjs --probar: todo se deshace al final).
-- Anota dos archivos, vuelve a anotar uno (como hace migrar.cjs) y muestra que queda una fila por archivo.
insert into public.lz_migraciones_corridas (archivo, tipo) values
  ('supabase/migrations/99999999999999_prueba.sql', 'migracion'),
  ('supabase/rollback/99999999999999_prueba.sql', 'vuelta_atras');
insert into public.lz_migraciones_corridas (archivo, tipo) values ('supabase/migrations/99999999999999_prueba.sql', 'migracion')
  on conflict (archivo) do update set corrida_at = now(), usuario = current_user;

select
  (select count(*) from public.lz_migraciones_corridas where archivo like '%99999999999999_prueba.sql') as filas_de_prueba_2,
  (select relrowsecurity from pg_class where oid = 'public.lz_migraciones_corridas'::regclass) as rls_prendido_true,
  (select count(*) from pg_policies where tablename = 'lz_migraciones_corridas') as politicas_0;
