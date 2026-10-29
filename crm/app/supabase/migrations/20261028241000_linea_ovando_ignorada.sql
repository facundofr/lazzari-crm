-- 28/10/2026 (Augusto: "no quiero confirmar ningún movimiento"): la línea del banco del pago a Ovando ($ 2.680.080, 22/09) quedó pendiente al borrar el gasto
-- (20261028240000). Se deja como "ignorado" con la explicación, para que no aparezca en Para confirmar y no haya que hacer nada.
-- Aditivo: solo cambia el estado y la nota de 1 línea. Vuelta atrás: supabase/rollback/20261028241000_linea_ovando_ignorada.sql
begin;

update public.extracto_movimientos
set estado = 'ignorado',
    nota = 'Pago de mercadería importada a Gaspar Federico Ovando: ya está en el costo de los PR, no va como gasto (Augusto 28/10/2026).'
where id = '0ffb1b73-7941-4654-a489-0871bd69b5ea' and estado = 'pendiente';

commit;
