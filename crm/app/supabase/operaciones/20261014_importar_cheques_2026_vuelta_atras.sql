-- Vuelta atrás de scripts/db/importar-cheques-2026.cjs --aplicar
-- Borra SOLO los cheques que el importador agregó (llevan la marca en observaciones). No toca ningún otro.
-- Antes de borrar, mirá cuántos son: select count(*) from public.echeqs where observaciones like 'Importado de cheques_desde_2026.csv (14/10/2026)%';
delete from public.echeqs
where observaciones like 'Importado de cheques_desde_2026.csv (14/10/2026)%';
