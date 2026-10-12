-- Cerrar a usuarios NO logueados las tablas de plata que estaban abiertas — 12/10/2026, con OK de Augusto.
--
-- Qué arregla:
--   Estas reglas eran para "public" con "true": cualquiera con la clave pública de Supabase (que está dentro de la página web)
--   podía leer, crear, cambiar o borrar órdenes de pago, eCheqs, gastos, saldos de caja, aplicaciones de cobros y plantillas de mail.
--   Ahora valen solo para usuarios logueados ("authenticated"). Para los usuarios del CRM no cambia NADA (misma regla, mismo alcance).
--   Los procesos del servidor (SICORE, cron, invitaciones) usan la clave de servidor, que no pasa por estas reglas.
--   No se toca cotizaciones_dolar (la carga automática del dólar la usa sin login).
--
-- Aditiva: no borra datos ni reglas; solo cambia a quién aplican.
-- Vuelta atrás: supabase/rollback/20261012170000_cerrar_tablas_sin_login.sql
begin;

alter policy "ordenes_pago_all" on public.ordenes_pago to authenticated;
alter policy "op_fc_modify" on public.op_facturas_compra to authenticated;
alter policy "op_fc_read" on public.op_facturas_compra to authenticated;
alter policy "cobro_aplicaciones_all" on public.cobro_aplicaciones to authenticated;
alter policy "read echeqs" on public.echeqs to authenticated;
alter policy "insert echeqs" on public.echeqs to authenticated;
alter policy "update echeqs" on public.echeqs to authenticated;
alter policy "delete echeqs" on public.echeqs to authenticated;
alter policy "email_templates_all" on public.email_templates to authenticated;
alter policy "gastos_manuales_all" on public.gastos_manuales to authenticated;
alter policy "saldos_caja_all" on public.saldos_caja to authenticated;

commit;
