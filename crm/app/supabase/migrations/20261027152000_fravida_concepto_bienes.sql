-- Fravida (FRANCISCO VICENTE DAMIANO S A, CUIT 30500600183) en Lazzari pasa a «Compraventa de bienes» al 2 %
-- (mejora H de la auditoría de Impuestos; Augusto 27/10: "Fravida pasa a bienes 2 % porque le compro mercadería").
-- Estaba como «Alquileres de inmuebles» al 10 %. No tiene OP ni facturas de compra todavía: no cambia nada hecho, solo
-- cómo se calcula la retención de las próximas OP. Grupo LA no retiene: su ficha de Fravida queda igual.
-- Lo mismo que elegir el concepto en la ficha del proveedor (concepto y alícuota).
-- Vuelta atrás: supabase/rollback/20261027152000_fravida_concepto_bienes.sql

update public.proveedores
   set concepto_retencion_ganancias = 'compraventa_bienes', alicuota_ganancias = 2
 where id = 'ca47e974-5e7c-4b5a-8eec-bba0dc9ecf03' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
   and concepto_retencion_ganancias = 'alquileres_inmuebles' and alicuota_ganancias = 10;

do $$
begin
  if not exists (select 1 from public.proveedores where id = 'ca47e974-5e7c-4b5a-8eec-bba0dc9ecf03'
                  and concepto_retencion_ganancias = 'compraventa_bienes' and alicuota_ganancias = 2) then
    raise exception 'Fravida no quedó en bienes al 2 %%: cambió desde que se armó la migración. No se guarda nada.';
  end if;
end $$;
