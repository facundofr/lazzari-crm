-- Rollback no destructivo: conserva comprobantes y columnas con datos.
-- Solo retira la funcion ejecutable. Las columnas e indices se dejan para no
-- perder NC emitidas durante la vigencia de la migracion.
revoke all on function public.registrar_nota_credito_venta_autorizada(uuid,uuid,uuid,jsonb,jsonb)
  from authenticated;
drop function if exists public.registrar_nota_credito_venta_autorizada(uuid,uuid,uuid,jsonb,jsonb);
