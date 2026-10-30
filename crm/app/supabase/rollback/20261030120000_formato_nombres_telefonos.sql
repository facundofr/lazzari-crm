-- Vuelta atrás de 20261030120000_formato_nombres_telefonos.sql.
-- Saca los disparadores (deja de acomodar al guardar) y vuelve los nombres y teléfonos a como estaban antes del arreglo,
-- desde public.formato_nombres_antes. Ojo: si alguien cambió a mano uno de esos campos después del arreglo, se pisa
-- con el valor viejo. La tabla de respaldo queda (no se borra).
begin;

drop trigger if exists formato_nombres_telefonos on public.clientes;
drop trigger if exists formato_nombres_telefonos on public.proveedores;
drop trigger if exists formato_nombres_telefonos on public.contactos;
drop trigger if exists formato_nombres_telefonos on public.cliente_sucursales;
drop trigger if exists formato_nombres_telefonos on public.transportistas;

update public.clientes x set razon_social = a.antes from public.formato_nombres_antes a where a.tabla = 'clientes' and a.campo = 'razon_social' and a.id = x.id;
update public.clientes x set telefono = a.antes from public.formato_nombres_antes a where a.tabla = 'clientes' and a.campo = 'telefono' and a.id = x.id;
update public.proveedores x set razon_social = a.antes from public.formato_nombres_antes a where a.tabla = 'proveedores' and a.campo = 'razon_social' and a.id = x.id;
update public.proveedores x set nombre_fantasia = a.antes from public.formato_nombres_antes a where a.tabla = 'proveedores' and a.campo = 'nombre_fantasia' and a.id = x.id;
update public.proveedores x set telefono = a.antes from public.formato_nombres_antes a where a.tabla = 'proveedores' and a.campo = 'telefono' and a.id = x.id;
update public.contactos x set nombre = a.antes from public.formato_nombres_antes a where a.tabla = 'contactos' and a.campo = 'nombre' and a.id = x.id;
update public.contactos x set telefono = a.antes from public.formato_nombres_antes a where a.tabla = 'contactos' and a.campo = 'telefono' and a.id = x.id;
update public.contactos x set whatsapp = a.antes from public.formato_nombres_antes a where a.tabla = 'contactos' and a.campo = 'whatsapp' and a.id = x.id;
update public.cliente_sucursales x set nombre = a.antes from public.formato_nombres_antes a where a.tabla = 'cliente_sucursales' and a.campo = 'nombre' and a.id = x.id;
update public.cliente_sucursales x set telefono = a.antes from public.formato_nombres_antes a where a.tabla = 'cliente_sucursales' and a.campo = 'telefono' and a.id = x.id;
update public.transportistas x set nombre = a.antes from public.formato_nombres_antes a where a.tabla = 'transportistas' and a.campo = 'nombre' and a.id = x.id;
update public.transportistas x set razon_social = a.antes from public.formato_nombres_antes a where a.tabla = 'transportistas' and a.campo = 'razon_social' and a.id = x.id;
update public.transportistas x set telefono = a.antes from public.formato_nombres_antes a where a.tabla = 'transportistas' and a.campo = 'telefono' and a.id = x.id;

drop function if exists public.formato_nombres_telefonos();
drop function if exists public.nombre_propio(text);
drop function if exists public.telefono_ar(text);

commit;
