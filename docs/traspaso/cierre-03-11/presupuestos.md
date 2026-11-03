# Cierre del chat Presupuestos (03/11/2026)

## 1. A medias o sin publicar
**Aviso de margen bajo con los renglones (auditoría 02/11, P05): HECHO, SIN PUBLICAR.**
- Dónde está: copia limpia `C:\Users\lazza\AppData\Local\Temp\claude\C--Users-lazza-lazzari\fc0ba467-97b5-4de4-a5f8-d65f5015b68c\scratchpad\pub-avisos`. Está armada sobre origin/main 74cee76 (V1.1.656), y origin/main ya va por la V1.1.663: hay que traer lo nuevo de origin/main antes de publicar.
  - Adentro tiene una junction a node_modules: sacarla con `rmdir` antes del deploy.
  - También tiene una copia de `.env.local` (git la ignora). No subirla.
- Archivos:
  - `crm/app/src/lib/presupuesto-margen.ts`: función nueva `tituloMargenBajo`.
  - `crm/app/scripts/test-presupuesto-margen.ts`: su prueba.
  - `crm/app/src/components/presupuestos/presupuestos-lista.tsx`: el aviso de margen bajo (tabla `notificaciones`) se guarda después de grabar el PR, con el id del PR (antes, en los PR nuevos, quedaba sin PR), y no repite el mismo título sin leer.
  - `crm/app/scripts/db/pruebas/aviso_pr_aprobado.sql`: la prueba ampliada.
  - `supabase/migrations/20261102230000_aviso_pr_sin_repetidos.sql` y su rollback.
  - `docs/ESTADO.md` y `docs/traspaso/presupuestos.md`: entrada del 02/11. Solo existe en la copia; no está en la carpeta principal ni en origin/main.
- Probado: tsc 0, check-hooks OK, test-presupuesto-margen y test-presupuesto-seguimiento OK. No se probó guardando un PR (eso escribe en la base real).
- Al publicar hay que subir la versión.

**Avisos de PR aprobado/rechazado sin repetidos (P01, trigger): YA EN LA BASE.**
- La migración `20261102230000_aviso_pr_sin_repetidos.sql` se corrió el 02/11 con OK de Augusto. La prueba dio 7 de 7 y los 727 avisos quedaron intactos.
- Ya rige: el aviso no se repite mientras siga sin leer y no le llega a quien hizo el cambio.
- Los archivos de la migración y del rollback solo están en la copia `pub-avisos`. Hay que subirlos en el mismo commit que P05.

## 2. Espera OK de Augusto
- "¿Publico el aviso de margen bajo con los renglones (P05) junto con los archivos de la migración ya corrida?"
- "¿Querés que el seguimiento de PR salga en un solo aviso por día y por vendedor ("Tenés 6 PR para llamar")?" Está propuesto y no hecho. Cambia la campana y la forma en que el control diario (`api/cron/presupuestos-vencimiento`) evita repetir avisos: hoy lo hace PR por PR.

## 3. Espera a otra persona
- Seba: editar un precio de un PR, guardar y bajar el PDF, para ver que salga con el cambio (V1.1.590).
- Augusto: mirar en la campana que los avisos de seguimiento se vean bien (V1.1.610).
- El próximo envío real de un PR por mail (V1.1.616): que vaya al solicitante y no sugiera los mails de facturación o pagos del cliente.
- Que el Inicio muestre el aviso de margen bajo (uno por PR, el último) le toca al chat que elija Augusto: no es de Presupuestos.

## 4. Avisos para el chat CRM
- El `presupuestos-lista.tsx` de la carpeta principal está VIEJO: trabajar siempre sobre origin/main.
- Precios: solo desde el último `catalogo_crm.csv`. Nunca editarlos a mano.
- Nunca frenar al vendedor (margen mínimo, BCRA, etc.): solo avisar.
- Cualquiera edita cualquier PR, en cualquier estado.
- Avisos de seguimiento a los PR aprobados: NO.
- Los 274 avisos viejos sin sociedad se dejan como están.
- Flete: su costo va en Transportes, no en el PR, y no genera OC.
- Los mails de facturación o pagos del cliente nunca se sugieren para el PR, salvo que ese contacto sea el solicitante.
