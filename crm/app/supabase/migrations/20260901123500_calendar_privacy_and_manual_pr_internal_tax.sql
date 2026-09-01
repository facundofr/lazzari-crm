-- Calendario: los eventos existentes siguen siendo públicos. Los nuevos pueden
-- ser públicos o privados (visibles solo para creador y responsable asignado).
alter table public.eventos
  add column if not exists visibilidad text not null default 'publico';

alter table public.eventos
  drop constraint if exists eventos_visibilidad_check;

alter table public.eventos
  add constraint eventos_visibilidad_check
  check (visibilidad in ('publico', 'privado'));

drop policy if exists "Users can read eventos" on public.eventos;
drop policy if exists "Users can insert eventos" on public.eventos;
drop policy if exists "Users can update eventos" on public.eventos;
drop policy if exists "Users can delete eventos" on public.eventos;

create policy "Authenticated users read visible eventos"
on public.eventos for select to authenticated
using (
  visibilidad = 'publico'
  or created_by = auth.uid()
  or user_id = auth.uid()
);

create policy "Authenticated users create own eventos"
on public.eventos for insert to authenticated
with check (created_by = auth.uid());

create policy "Owners assignees and admins update eventos"
on public.eventos for update to authenticated
using (
  created_by = auth.uid()
  or user_id = auth.uid()
  or exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('super_admin', 'admin')
  )
)
with check (
  created_by = auth.uid()
  or user_id = auth.uid()
  or exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('super_admin', 'admin')
  )
);

create policy "Owners assignees and admins delete eventos"
on public.eventos for delete to authenticated
using (
  created_by = auth.uid()
  or user_id = auth.uid()
  or exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('super_admin', 'admin')
  )
);

-- La versión anterior puso en cero la alícuota de items manuales para ocultarla
-- en el PR. La visualización ya se resuelve por modalidad; internamente se
-- restaura la alícuota para facturas y órdenes de compra posteriores.
update public.presupuesto_items pi
set iva_porcentaje = 21
from public.presupuestos p
where p.id = pi.presupuesto_id
  and p.modalidad_emision = 'manual'
  and coalesce(pi.iva_porcentaje, 0) = 0;

-- El encabezado del PR manual continúa expresando el precio final, sin IVA
-- agregado, aunque los items conserven su alícuota para procesos internos.
update public.presupuestos p
set iva = 0,
    total = p.subtotal
where p.modalidad_emision = 'manual';
