-- Vuelta atrás de 20261030184500_seguro_auto_personal.sql: el seguro del auto (Federación Patronal) vuelve a Operativos.
begin;

update gastos_fijos set grupo = 'Operativos', categoria = 'Operativos'
where id = 'e0329e16-da37-4e0d-ab73-02c640febe52' and grupo = 'Personales';

update gastos_manuales set grupo = 'Operativos', categoria = 'Operativos'
where id in ('10a439e4-ea57-44b5-8206-bd8155ac137b', '6c59c4e4-c735-4275-8b0e-1662a2dba548') and grupo = 'Personales';

commit;
