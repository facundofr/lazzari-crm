-- Vuelta atrás de 20261027152000_fravida_concepto_bienes.sql: Fravida en Lazzari vuelve a «Alquileres de inmuebles» al 10 %.
-- Solo si sigue en bienes al 2 % (si alguien la cambió después en la ficha, no se toca).
update public.proveedores
   set concepto_retencion_ganancias = 'alquileres_inmuebles', alicuota_ganancias = 10
 where id = 'ca47e974-5e7c-4b5a-8eec-bba0dc9ecf03' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
   and concepto_retencion_ganancias = 'compraventa_bienes' and alicuota_ganancias = 2;
