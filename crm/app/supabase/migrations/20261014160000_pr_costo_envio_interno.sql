-- Costo de envío INTERNO del presupuesto — 14/10/2026, pedido de Augusto.
-- El flete que cobra el proveedor en su factura y NO se le cobra al cliente. Resta de la ganancia y el margen del PR,
-- pero nunca se imprime en el PDF, ni va al texto del cliente, ni al total, IVA o factura.
-- El detalle (de qué factura vino) queda en notas_internas del PR, que ya existe.
-- Aditiva: 1 columna nueva en presupuestos (los PR viejos quedan en 0). No toca datos ni funciones.
-- Vuelta atrás: supabase/rollback/20261014160000_pr_costo_envio_interno.sql
begin;

alter table public.presupuestos
  add column if not exists costo_envio_interno numeric(14, 2) not null default 0;

comment on column public.presupuestos.costo_envio_interno is 'Flete interno (en la moneda del PR): resta de la ganancia, nunca se muestra al cliente.';

commit;
