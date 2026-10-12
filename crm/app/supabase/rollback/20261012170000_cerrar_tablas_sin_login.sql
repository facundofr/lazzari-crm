-- Vuelta atrás de 20261012170000_cerrar_tablas_sin_login.sql: las reglas vuelven a valer para "public" (como estaban el 12/10/2026).
begin;

alter policy "ordenes_pago_all" on public.ordenes_pago to public;
alter policy "op_fc_modify" on public.op_facturas_compra to public;
alter policy "op_fc_read" on public.op_facturas_compra to public;
alter policy "cobro_aplicaciones_all" on public.cobro_aplicaciones to public;
alter policy "read echeqs" on public.echeqs to public;
alter policy "insert echeqs" on public.echeqs to public;
alter policy "update echeqs" on public.echeqs to public;
alter policy "delete echeqs" on public.echeqs to public;
alter policy "email_templates_all" on public.email_templates to public;
alter policy "gastos_manuales_all" on public.gastos_manuales to public;
alter policy "saldos_caja_all" on public.saldos_caja to public;

commit;
