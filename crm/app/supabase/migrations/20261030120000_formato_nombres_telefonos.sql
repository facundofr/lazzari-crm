-- Formato parejo de nombres y teléfonos (Augusto 30/10/2026: "todo en el CRM tiene que respetar lo que va en mayúscula
-- y en minúscula" y los celulares "algunos con guion, otros con la característica adelante, otros todo junto"; "Sí, todo").
-- 1) public.nombre_propio(texto): "COOPERATIVA DE TRABAJO MILONGUITAS LIMITADA" → "Cooperativa de Trabajo Milonguitas
--    Limitada". Respeta siglas (S.A., S.R.L., SRL, B.I.D.), iniciales, romanos y palabras con números. Lo que ya está
--    escrito en mayúscula y minúscula no se toca. No agrega tildes.
-- 2) public.telefono_ar(texto): "2477 688498", "11 33968405", "351 8354530" (como guardan las dos casillas de WhatsApp de
--    Proveedores; las pantallas lo muestran con guion: "2477 68-8498"). Saca ".0", +54 / 54 9, el 0 y el 15.
--    Si no queda en 10 números (o hay varios teléfonos juntos) lo deja como estaba.
--    Son la copia de lib/nombres-telefonos.ts y lib/whatsapp-ar.ts (prueba: scripts/test-nombres-telefonos.ts).
-- 3) Al guardar (alta o cambio, desde cualquier pantalla, la IA o una importación) clientes, proveedores, contactos,
--    sucursales y transportistas pasan por esas dos funciones.
-- 4) Arreglo de lo cargado: lo de antes queda guardado en public.formato_nombres_antes (para volver atrás).
-- Solo AGREGA (funciones, disparadores y una tabla de respaldo); los valores cambian solo en formato.
-- Vuelta atrás: supabase/rollback/20261030120000_formato_nombres_telefonos.sql
begin;

create or replace function public.nombre_propio(p text) returns text
language plpgsql immutable set search_path = public as $$
declare
  t text;
  res text := '';
  tok text := '';
  ch text;
  antes text := '';
  i int;
  n int;
  primera boolean := true;
  may text;
  min text;
  minusculas constant text[] := array['de','del','la','las','los','el','y','e','o','u','en','con','por','para','al'];
  siglas constant text[] := array['SA','SAS','SAU','SAI','SAC','SAIC','SAICF','SAICYF','SACI','SACIF','SACIFI','SAIF','SAICA','SAICAF',
    'SRL','SH','SC','SCA','SCS','SE','SGR','UTE','YPF','BBVA','ARCA','AFIP','INTA','INTI','UTN','UBA',
    'EPP','ART','ACA','CRM','IT','TV','GNC','BID','SGS','USA','AMBA','CABA'];
begin
  if p is null then return null; end if;
  t := btrim(regexp_replace(p, '\s+', ' ', 'g'));
  if t = '' then return t; end if;
  if (t ~ '[[:upper:]]' and t ~ '[[:lower:]]') or not (t ~ '[[:upper:]]' or t ~ '[[:lower:]]') then return t; end if;
  n := length(t);
  for i in 1..n + 1 loop
    ch := case when i <= n then substr(t, i, 1) else '' end;
    if ch <> '' and ch ~ '[[:alnum:]]' then
      tok := tok || ch;
      continue;
    end if;
    if tok <> '' then
      may := upper(tok);
      min := lower(tok);
      if tok ~ '[0-9]' then tok := may;
      elsif length(tok) = 1 and (ch = '.' or antes = '.') then tok := may;
      elsif may = any(siglas) or may ~ '^(II|III|IV|VI|VII|VIII|IX|XI|XII)$' then tok := may;
      elsif min = any(minusculas) and not primera then tok := min;
      elsif length(tok) = 1 then tok := may;
      elsif length(tok) <= 4 and may !~ '[AEIOUÁÉÍÓÚÜ]' then tok := may;
      else tok := upper(left(min, 1)) || substr(min, 2);
      end if;
      res := res || tok;
      tok := '';
      primera := false;
    end if;
    res := res || ch;
    if i <= n then antes := ch; end if;
  end loop;
  return res;
end $$;

-- `antes` es el carácter anterior a la palabra: se actualiza con cada separador (la palabra se arma aparte).
comment on function public.nombre_propio(text) is 'Nombre con mayúscula al principio de cada palabra (copia de lib/nombres-telefonos.ts nombrePropio).';

create or replace function public.telefono_ar(p text) returns text
language plpgsql immutable set search_path = public as $$
declare
  o text;
  d text;
  s text;
  largo int;
  caract3 constant text[] := array['220','221','223','230','236','237','249','260','261','263','264','266','280','291','294','297',
    '298','299','336','341','342','343','345','348','351','353','358','362','364','370','376','379','380','381','383','385','387','388'];
begin
  if p is null then return null; end if;
  o := btrim(p);
  if o = '' then return o; end if;
  if o ~* '[/,;]|\sy\s|\so\s' then return o; end if;
  d := regexp_replace(regexp_replace(o, '\.0$', ''), '\D', '', 'g');
  if d like '54%' then d := substr(d, 3); end if;
  if d like '9%' and length(d) = 11 then d := substr(d, 2); end if;
  if d like '0%' then d := substr(d, 2); end if;
  if length(d) = 12 then
    -- "11 15 5555-1234" / "2477 15 68-8498": el 15 va después de la característica.
    for largo in 2..4 loop
      if substr(d, largo + 1, 2) = '15' then
        s := left(d, largo) || substr(d, largo + 3);
        if length(s) = 10 then d := s; exit; end if;
      end if;
    end loop;
  end if;
  if length(d) <> 10 then return o; end if;
  largo := case when d like '11%' then 2 when substr(d, 1, 3) = any(caract3) then 3 else 4 end;
  return substr(d, 1, largo) || ' ' || substr(d, largo + 1);
end $$;

comment on function public.telefono_ar(text) is 'Teléfono como se guarda en el CRM: "2477 688498" (copia de lib/whatsapp-ar.ts guardarTelefono; las pantallas lo muestran con guion).';

create or replace function public.formato_nombres_telefonos() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'clientes' then
    new.razon_social := nombre_propio(new.razon_social);
    new.telefono := telefono_ar(new.telefono);
  elsif tg_table_name = 'proveedores' then
    new.razon_social := nombre_propio(new.razon_social);
    new.nombre_fantasia := nombre_propio(new.nombre_fantasia);
    new.telefono := telefono_ar(new.telefono);
  elsif tg_table_name = 'contactos' then
    new.nombre := nombre_propio(new.nombre);
    new.telefono := telefono_ar(new.telefono);
    new.whatsapp := telefono_ar(new.whatsapp);
  elsif tg_table_name = 'cliente_sucursales' then
    new.nombre := nombre_propio(new.nombre);
    new.telefono := telefono_ar(new.telefono);
  elsif tg_table_name = 'transportistas' then
    new.nombre := nombre_propio(new.nombre);
    new.razon_social := nombre_propio(new.razon_social);
    new.telefono := telefono_ar(new.telefono);
  end if;
  return new;
end $$;

-- Respaldo de lo que había antes del arreglo (no se borra).
create table if not exists public.formato_nombres_antes (
  tabla text not null,
  id uuid not null,
  campo text not null,
  antes text,
  guardado_at timestamptz not null default now(),
  primary key (tabla, id, campo)
);
alter table public.formato_nombres_antes enable row level security;
revoke all on public.formato_nombres_antes from anon, authenticated;
comment on table public.formato_nombres_antes is 'Nombres y teléfonos antes del arreglo de formato del 30/10/2026 (migración 20261030120000). Para volver atrás.';

insert into public.formato_nombres_antes (tabla, id, campo, antes)
select 'clientes', id, 'razon_social', razon_social from public.clientes where razon_social is distinct from nombre_propio(razon_social)
union all select 'clientes', id, 'telefono', telefono from public.clientes where telefono is distinct from telefono_ar(telefono)
union all select 'proveedores', id, 'razon_social', razon_social from public.proveedores where razon_social is distinct from nombre_propio(razon_social)
union all select 'proveedores', id, 'nombre_fantasia', nombre_fantasia from public.proveedores where nombre_fantasia is distinct from nombre_propio(nombre_fantasia)
union all select 'proveedores', id, 'telefono', telefono from public.proveedores where telefono is distinct from telefono_ar(telefono)
union all select 'contactos', id, 'nombre', nombre from public.contactos where nombre is distinct from nombre_propio(nombre)
union all select 'contactos', id, 'telefono', telefono from public.contactos where telefono is distinct from telefono_ar(telefono)
union all select 'contactos', id, 'whatsapp', whatsapp from public.contactos where whatsapp is distinct from telefono_ar(whatsapp)
union all select 'cliente_sucursales', id, 'nombre', nombre from public.cliente_sucursales where nombre is distinct from nombre_propio(nombre)
union all select 'cliente_sucursales', id, 'telefono', telefono from public.cliente_sucursales where telefono is distinct from telefono_ar(telefono)
union all select 'transportistas', id, 'nombre', nombre from public.transportistas where nombre is distinct from nombre_propio(nombre)
union all select 'transportistas', id, 'razon_social', razon_social from public.transportistas where razon_social is distinct from nombre_propio(razon_social)
union all select 'transportistas', id, 'telefono', telefono from public.transportistas where telefono is distinct from telefono_ar(telefono)
on conflict do nothing;

-- Arreglo de lo cargado.
update public.clientes set razon_social = nombre_propio(razon_social), telefono = telefono_ar(telefono)
 where razon_social is distinct from nombre_propio(razon_social) or telefono is distinct from telefono_ar(telefono);
update public.proveedores set razon_social = nombre_propio(razon_social), nombre_fantasia = nombre_propio(nombre_fantasia), telefono = telefono_ar(telefono)
 where razon_social is distinct from nombre_propio(razon_social) or nombre_fantasia is distinct from nombre_propio(nombre_fantasia) or telefono is distinct from telefono_ar(telefono);
update public.contactos set nombre = nombre_propio(nombre), telefono = telefono_ar(telefono), whatsapp = telefono_ar(whatsapp)
 where nombre is distinct from nombre_propio(nombre) or telefono is distinct from telefono_ar(telefono) or whatsapp is distinct from telefono_ar(whatsapp);
update public.cliente_sucursales set nombre = nombre_propio(nombre), telefono = telefono_ar(telefono)
 where nombre is distinct from nombre_propio(nombre) or telefono is distinct from telefono_ar(telefono);
update public.transportistas set nombre = nombre_propio(nombre), razon_social = nombre_propio(razon_social), telefono = telefono_ar(telefono)
 where nombre is distinct from nombre_propio(nombre) or razon_social is distinct from nombre_propio(razon_social) or telefono is distinct from telefono_ar(telefono);

-- De ahora en adelante, al guardar.
drop trigger if exists formato_nombres_telefonos on public.clientes;
create trigger formato_nombres_telefonos before insert or update of razon_social, telefono on public.clientes
  for each row execute function public.formato_nombres_telefonos();
drop trigger if exists formato_nombres_telefonos on public.proveedores;
create trigger formato_nombres_telefonos before insert or update of razon_social, nombre_fantasia, telefono on public.proveedores
  for each row execute function public.formato_nombres_telefonos();
drop trigger if exists formato_nombres_telefonos on public.contactos;
create trigger formato_nombres_telefonos before insert or update of nombre, telefono, whatsapp on public.contactos
  for each row execute function public.formato_nombres_telefonos();
drop trigger if exists formato_nombres_telefonos on public.cliente_sucursales;
create trigger formato_nombres_telefonos before insert or update of nombre, telefono on public.cliente_sucursales
  for each row execute function public.formato_nombres_telefonos();
drop trigger if exists formato_nombres_telefonos on public.transportistas;
create trigger formato_nombres_telefonos before insert or update of nombre, razon_social, telefono on public.transportistas
  for each row execute function public.formato_nombres_telefonos();

commit;

-- Prueba (todo tiene que dar 0 / true):
-- select count(*) from clientes where razon_social is distinct from nombre_propio(razon_social);
-- select nombre_propio('COOPERATIVA DE TRABAJO MILONGUITAS LIMITADA') = 'Cooperativa de Trabajo Milonguitas Limitada',
--        telefono_ar('3518354530.0') = '351 8354530';
