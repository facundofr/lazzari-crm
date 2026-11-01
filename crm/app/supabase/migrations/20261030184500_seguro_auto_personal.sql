-- Seguro del auto de Augusto (Federación Patronal, póliza 0436118496000000140926): es personal.
-- Augusto 30/10/2026: "federacion patronal es el seguro de mi auto".
-- Pasa a Personales (retiro de accionistas) el gasto fijo (débito automático del 14, $ 243.934) y los 2 gastos ya cargados
-- (14/09 y 14/10, $ 243.934 c/u). Solo cambian grupo y categoría: montos, fechas, pagos y cruces con el banco quedan iguales.
-- Efecto: deja de restar en el resultado (Contabilidad y Reportes) y en el Cashflow va a "Retiros de accionistas".
-- Vuelta atrás: supabase/rollback/20261030184500_seguro_auto_personal.sql
begin;

update gastos_fijos set grupo = 'Personales', categoria = 'Personales'
where id = 'e0329e16-da37-4e0d-ab73-02c640febe52' and grupo = 'Operativos';

update gastos_manuales set grupo = 'Personales', categoria = 'Personales'
where id in ('10a439e4-ea57-44b5-8206-bd8155ac137b', '6c59c4e4-c735-4275-8b0e-1662a2dba548') and grupo = 'Operativos';

commit;
