-- Vuelta atrás de 20261012180000_oc_diferencias.sql
-- Saca el disparador de saldo cerrado y las funciones nuevas. No deshace ajustes ya hechos (para eso, antes de correr esto,
-- usar "Deshacer ajuste" en cada OC). La tabla lz_oc_ajustes queda con el historial.
begin;

drop trigger if exists lz_saldo_cerrado_oc on public.ordenes_compra;
drop function if exists public.lz_trg_saldo_cerrado_oc();
drop function if exists public.deshacer_ajuste_oc(uuid, uuid);
drop function if exists public.ajustar_oc_a_factura(uuid, uuid);
drop function if exists public.diagnostico_diferencia_oc(uuid, uuid);

commit;
